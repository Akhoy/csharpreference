---
id: cicd-iac
title: CI/CD and Infrastructure as Code
summary: Shipping safely and repeatably. Continuous integration, delivery and deployment, branching strategies, a complete GitHub Actions pipeline for .NET, Azure DevOps Pipelines, environments and approvals, deployment strategies (rolling, blue/green, canary, feature flags), database migrations in pipelines, versioning, and infrastructure as code with Bicep, Terraform and azd.
layer: infra
where: Hosting & infrastructure › Delivery pipeline & IaC
fits: The pipeline is how code from every layer becomes running infrastructure in layer 7. It builds with the SDK ([Projects & SDK](ch:projects-sdk-nuget)), runs [unit](ch:unit-testing) and [integration](ch:integration-testing) tests, builds images ([Docker](ch:docker)), applies migrations ([EF Core](ch:efcore-fundamentals#migrations-evolving-the-schema-in-step-with-the-model)), provisions resources with IaC, and deploys to [compute](ch:azure-compute) using federated identity ([Identity & secrets](ch:azure-identity-secrets#workload-identity-federation-ci-cd-and-kubernetes)).
levels: b,i,a
prereqs: docker, unit-testing
next: kubernetes, observability-aspire
---

## TL;DR

- **CI**: every push is built and tested automatically. **Continuous delivery**: every passing change *could* ship, but a human decides when. **Continuous deployment**: passing changes ship automatically, no human gate.
- Build the deployable artefact (container image, zip) **once**, then promote the exact same artefact through dev → staging → prod. Only configuration changes between environments.
- Deployment strategies trade complexity for a smaller blast radius if something's wrong: recreate (riskiest, simplest) → rolling → blue/green (instant switch, instant rollback) → canary (small % of traffic first) → feature flags (ship dark, turn on later).
- Database schema changes during rolling/blue-green deploys need **expand → migrate → contract**: add the new shape first (compatibly), deploy code that works with both old and new, backfill, then remove the old shape in a *later* release — never in the same release that stops using it.
- Infrastructure as Code (Bicep, Terraform) means infra lives in versioned, reviewed code instead of manual portal clicks — the same reproducibility argument as "define your app in code," now applied to the infra underneath it.

## CI, CD and CD {b}

| Practice | Definition | Gate |
|---|---|---|
| **Continuous Integration (CI)** | Everyone integrates into the main branch **frequently** (at least daily); **every push triggers an automated build and tests** | A broken build is fixed immediately |
| **Continuous Delivery** | Every change that passes the pipeline is **releasable**; deploying to production is a **business decision** (a button / approval) | Manual approval to prod |
| **Continuous Deployment** | Every passing change is **deployed to production automatically** | No human gate; relies on strong tests, monitoring and progressive delivery |

:::why Why it matters
Small, frequent, automated releases are **less risky** than big, rare, manual ones: each change is small enough to understand and roll back, problems surface within minutes of being written, and the process is the same every time (no "works when Dave deploys it"). The **DORA metrics** (deployment frequency, lead time for changes, change failure rate, time to restore) measure delivery performance; the research behind them — elite teams deploy on demand with low failure rates — is documented in *Accelerate* (Forsgren, Humble, Kim), cited in Further reading below.
:::

## Branching strategies {b}

| Strategy | How | Fits |
|---|---|---|
| **Trunk-based development** | Short-lived branches (hours to a day) or direct commits to `main`; **feature flags** hide unfinished work | CI/CD, high-velocity teams (recommended by DORA research) |
| **GitHub Flow** | `main` is always deployable; feature branch → PR (review + CI checks) → merge → deploy | Most web/API teams |
| **GitFlow** | `develop`, `feature/*`, `release/*`, `hotfix/*`, `main` | Versioned products with scheduled releases; heavyweight for services |
| **Release branches** | Cut `release/2026.10` for stabilisation; fixes cherry-picked | Libraries, on-premises products |

PR hygiene: branch protection on `main` (required reviews, required status checks: build, tests, analyzers, security scans), small PRs, conventional commit messages, and automated dependency updates (Dependabot/Renovate).

## Anatomy of a .NET pipeline {i}

```text
 push/PR ─▶ CI ───────────────────────────────────────────────────────────▶  merge to main ─▶ CD ───────────────────────────────────────────▶
           restore → build (warnings as errors) → unit tests → integration      build image once → push to ACR (tag = git SHA)
           tests (Testcontainers) → analyzers/format → coverage → SCA/SAST       → deploy to dev → smoke tests → deploy staging (slot/revision)
           → (PR) report status                                                    → migrations → smoke/E2E → approval → prod (swap/canary) → monitor
```

**Build once, deploy many**: the same artefact (container image digest or zip) is promoted through environments; only **configuration** differs — exactly the "promote the same image" principle from [Docker](ch:docker#configuration-secrets-and-storage-in-containers), now the organising idea for the whole pipeline rather than just one chapter's advice.

## GitHub Actions: a complete example {i}

```yaml
# .github/workflows/shop-api.yml
name: shop-api
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read
  id-token: write          # for OIDC login to Azure (no stored secrets)

env:
  DOTNET_VERSION: 10.0.x
  IMAGE: shopacr.azurecr.io/shop-api

jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: ${{ env.DOTNET_VERSION }}
          cache: true                                  # NuGet cache keyed on lock files
      - run: dotnet restore --locked-mode
      - run: dotnet build --no-restore -c Release -warnaserror
      - run: dotnet format --verify-no-changes --no-restore
      - run: dotnet test --no-build -c Release --logger trx --collect:"XPlat Code Coverage"   # Testcontainers works: Docker is available
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: test-results, path: "**/TestResults/**" }
      - run: dotnet list package --vulnerable --include-transitive 2>&1 | tee vuln.txt && ! grep -q "has the following vulnerable packages" vuln.txt

  image:
    needs: build-test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    outputs:
      tag: ${{ steps.meta.outputs.tag }}
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with:
          client-id: ${{ vars.AZURE_CLIENT_ID }}
          tenant-id: ${{ vars.AZURE_TENANT_ID }}
          subscription-id: ${{ vars.AZURE_SUBSCRIPTION_ID }}
      - run: az acr login -n shopacr
      - id: meta
        run: echo "tag=${GITHUB_SHA::12}" >> "$GITHUB_OUTPUT"
      - run: |
          docker build -t $IMAGE:${{ steps.meta.outputs.tag }} .
          docker push $IMAGE:${{ steps.meta.outputs.tag }}
      - uses: aquasecurity/trivy-action@0.28.0          # image vulnerability scan
        with: { image-ref: "${{ env.IMAGE }}:${{ steps.meta.outputs.tag }}", severity: "CRITICAL,HIGH", exit-code: "1" }

  deploy-staging:
    needs: image
    runs-on: ubuntu-latest
    environment: staging                               # environment-scoped vars/secrets + optional protection rules
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with: { client-id: "${{ vars.AZURE_CLIENT_ID }}", tenant-id: "${{ vars.AZURE_TENANT_ID }}", subscription-id: "${{ vars.AZURE_SUBSCRIPTION_ID }}" }
      - name: Apply database migrations (bundle)
        run: |
          dotnet tool restore
          dotnet ef migrations bundle -p src/Shop.Infrastructure -s src/Shop.Api -o efbundle --self-contained -r linux-x64
          ./efbundle --connection "${{ secrets.SQL_MIGRATION_CS }}"
      - name: Deploy new revision
        run: az containerapp update -n shop-api -g rg-shop-staging --image $IMAGE:${{ needs.image.outputs.tag }}
      - name: Smoke test
        run: curl --fail --retry 10 --retry-delay 6 https://shop-api-staging.example.com/health/ready

  deploy-prod:
    needs: [image, deploy-staging]
    runs-on: ubuntu-latest
    environment: production                            # required reviewers = manual approval gate (continuous DELIVERY)
    steps:
      - uses: azure/login@v2
        with: { client-id: "${{ vars.AZURE_CLIENT_ID }}", tenant-id: "${{ vars.AZURE_TENANT_ID }}", subscription-id: "${{ vars.AZURE_SUBSCRIPTION_ID }}" }
      - run: az containerapp update -n shop-api -g rg-shop-prod --image $IMAGE:${{ needs.image.outputs.tag }} --revision-suffix ${{ needs.image.outputs.tag }}
```

Notice `deploy-staging` runs the EF migration bundle and `curl`s the readiness endpoint **before** `deploy-prod` is even allowed to start — the pipeline itself enforces exactly the "migrate, then verify, then promote" sequencing that a human following a runbook could forget under pressure. Concepts: **workflows** (YAML in `.github/workflows`), **triggers** (`on:`), **jobs** (run in parallel unless `needs:`), **steps**, **actions** (reusable steps from the marketplace), **runners** (GitHub-hosted or self-hosted), **environments** (protection rules, approvals, scoped secrets), **matrix builds**, **reusable workflows** and **composite actions** for sharing across repos, and **caching**.

## Azure DevOps Pipelines {i}

Many enterprises use **Azure DevOps** (Boards, Repos, **Pipelines**, Artifacts, Test Plans). YAML pipelines are structured as **stages → jobs → steps**, with **tasks** instead of actions, **service connections** (use workload identity federation), **environments** with approvals and checks, **variable groups** (optionally linked to Key Vault) and **templates** for reuse.

```yaml
# azure-pipelines.yml
trigger: { branches: { include: [main] } }
pool: { vmImage: ubuntu-latest }

stages:
- stage: Build
  jobs:
  - job: build
    steps:
    - task: UseDotNet@2
      inputs: { version: 10.0.x }
    - script: dotnet build -c Release -warnaserror
    - script: dotnet test -c Release --no-build --logger trx
    - task: PublishTestResults@2
      inputs: { testResultsFormat: VSTest, testResultsFiles: "**/*.trx" }
    - task: Docker@2
      inputs: { containerRegistry: acr-connection, repository: shop-api, command: buildAndPush, tags: $(Build.SourceVersion) }

- stage: Prod
  dependsOn: Build
  jobs:
  - deployment: deploy
    environment: shop-prod          # approvals & checks configured on the environment
    strategy:
      runOnce:
        deploy:
          steps:
          - task: AzureWebAppContainer@1
            inputs: { azureSubscription: azure-prod-wif, appName: app-shop-api-prod, containers: "shopacr.azurecr.io/shop-api:$(Build.SourceVersion)" }
```

## Deployment strategies {i}

| Strategy | How | Rollback | Azure implementation |
|---|---|---|---|
| **Recreate** | Stop old, start new | Redeploy old | Simple; causes downtime |
| **Rolling** | Replace instances gradually | Roll forward/back gradually | Kubernetes Deployments, App Service multi-instance |
| **Blue/green** | Run the new version alongside, switch **all** traffic at once | Switch back instantly | **App Service slot swap**, Container Apps revisions (100% switch), two AKS deployments + service selector |
| **Canary** | Send a small % of traffic to the new version, increase while metrics stay healthy | Route 0% to canary | **Container Apps traffic splitting**, App Service "testing in production" (slot traffic %), Front Door weights, service mesh / Argo Rollouts / Flagger |
| **Feature flags** | Deploy code dark; enable features per user/percentage at runtime | Turn the flag off | Azure App Configuration + Microsoft.FeatureManagement ([Configuration](ch:configuration-options#feature-flags-configuration-that-controls-behaviour-not-just)) |
| **Ring deployment** | Internal users → early adopters → everyone (or region by region) | Halt the rollout | Multiple environments/regions in the pipeline |

Each row along this table trades a little more deployment complexity for a progressively smaller blast radius if something goes wrong — Recreate risks the whole user base at once, Canary risks a deliberately small slice, and **progressive delivery** pushes that idea furthest by combining canaries and flags with **automated health analysis** (error rate, latency SLOs from Application Insights or Prometheus) to promote or roll back without a human in the loop at all.

## Databases in the pipeline {a}

Schema changes are the hardest part of continuous deployment, because **old and new code run side by side** during a rolling or blue/green deploy — the exact scenario that forced [EF Core fundamentals](ch:efcore-fundamentals#migrations-evolving-the-schema-in-step-with-the-model) to introduce the expand/contract pattern in the first place:

- **Expand → migrate → contract**: (1) expand: add new columns/tables, nullable or with defaults, compatible with the old code; (2) deploy code that writes both and reads new; (3) backfill data; (4) contract: remove old columns in a **later** release.
- Never rename or drop a column in the same release that stops using it.
- Apply migrations with **idempotent scripts** or **EF migration bundles** as a pipeline step **before** deploying the app (with a dedicated migration identity that has DDL rights; the app identity gets only DML).
- For DBA-managed schemas: **SQL projects (DACPAC)**, DbUp, Flyway, Liquibase.
- Back up or verify point-in-time restore before risky migrations, and test migrations against a production-like copy.

## Versioning and artefacts {a}

- **SemVer** (`MAJOR.MINOR.PATCH`) for libraries and public APIs; services often use build numbers or **git SHA tags** for images (immutable, traceable).
- Tools: **MinVer** / **Nerdbank.GitVersioning** / GitVersion derive versions from Git tags or height. Set `<Version>`, `AssemblyInformationalVersion` (include the commit SHA), and expose it on `/health` or `/version` and in telemetry (`service.version`).
- Store build outputs in a registry (ACR, NuGet feed), with **retention policies**. Never deploy something that wasn't built by the pipeline.
- **Supply chain security**: SBOM generation, signed images and provenance (SLSA), pinned action versions (by SHA for third-party actions), least-privilege workflow `permissions`, and secret scanning (GitHub push protection).

## Infrastructure as Code {i}

**IaC** defines infrastructure (resource groups, App Service plans, Container Apps environments, SQL servers, Key Vaults, role assignments, networking) in **versioned code**, reviewed in PRs and applied by pipelines.

| Benefit | Explanation |
|---|---|
| **Reproducibility** | dev = staging = prod, created from the same templates with different parameters |
| **Reviewability** | Infrastructure changes go through PRs like code |
| **No drift** | Manual portal changes are overwritten or detected (`what-if` / `plan`) |
| **Disaster recovery** | Recreate an environment from code |
| **Documentation** | The code *is* the up-to-date description |

Approaches: **declarative** (describe the desired end state; the tool works out the changes: Bicep, ARM, Terraform) vs **imperative** (scripts of commands: az CLI, PowerShell). Prefer declarative and **idempotent** (running it twice changes nothing the second time) — the exact same idempotency principle [API design](ch:api-design#http-methods-the-promises-hiding-behind-safe-and-idempotent) cared about for HTTP, here applied to infrastructure deployments.

### Bicep

Azure's native DSL that compiles to ARM JSON: concise, type-safe, day-zero support for new Azure features, **no state file** (Azure itself is the state).

```bicep
// main.bicep
targetScope = 'resourceGroup'
param location string = resourceGroup().location
@allowed(['dev', 'staging', 'prod'])
param env string
param imageTag string

var prefix = 'shop-${env}'

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${prefix}-api'
  location: location
}

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${prefix}'
  location: location
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30 }
}

resource cae 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-${prefix}'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: { customerId: logs.properties.customerId, sharedKey: logs.listKeys().primarySharedKey }
    }
    zoneRedundant: env == 'prod'
  }
}

resource api 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-${prefix}-api'
  location: location
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      ingress: { external: true, targetPort: 8080 }
      registries: [ { server: 'shopacr.azurecr.io', identity: identity.id } ]
    }
    template: {
      containers: [ {
        name: 'api'
        image: 'shopacr.azurecr.io/shop-api:${imageTag}'
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: [
          { name: 'ASPNETCORE_ENVIRONMENT', value: env == 'prod' ? 'Production' : 'Staging' }
          { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
        ]
        probes: [ { type: 'Readiness', httpGet: { path: '/health/ready', port: 8080 } } ]
      } ]
      scale: { minReplicas: env == 'prod' ? 2 : 0, maxReplicas: 10 }
    }
  }
}

module sql 'modules/sql.bicep' = { name: 'sql', params: { prefix: prefix, location: location, adminGroupObjectId: '…' } }

output apiUrl string = 'https://${api.properties.configuration.ingress.fqdn}'
```

```bash
az deployment group what-if -g rg-shop-prod -f main.bicep -p env=prod imageTag=3f1c2a9b7d10   # preview changes
az deployment group create  -g rg-shop-prod -f main.bicep -p env=prod imageTag=3f1c2a9b7d10
```

Use **modules** for reuse, **Azure Verified Modules** (AVM) for well-architected building blocks, **parameter files** (`.bicepparam`) per environment, and **deployment stacks** to manage and lock groups of resources.

### Terraform

HashiCorp's **multi-cloud** IaC with HCL and a huge provider ecosystem (Azure, AWS, GCP, Kubernetes, GitHub, Datadog…). It keeps a **state file** (store it remotely, e.g. in an Azure Storage backend with locking) mapping code to real resources; `terraform plan` shows the diff and `apply` executes it.

```hcl
resource "azurerm_resource_group" "shop" {
  name     = "rg-shop-${var.env}"
  location = "westeurope"
}

resource "azurerm_key_vault" "kv" {
  name                      = "kv-shop-${var.env}"
  resource_group_name       = azurerm_resource_group.shop.name
  location                  = azurerm_resource_group.shop.location
  tenant_id                 = data.azurerm_client_config.current.tenant_id
  sku_name                  = "standard"
  enable_rbac_authorization = true
  purge_protection_enabled  = true
}
```

| | Bicep | Terraform | Pulumi |
|---|---|---|---|
| Clouds | Azure only | Multi-cloud + SaaS providers | Multi-cloud |
| Language | Bicep DSL | HCL | **C#**, TypeScript, Python, Go |
| State | None (ARM is the source of truth) | State file to manage | Managed state service or self-hosted |
| New Azure features | Day zero | Provider lag (AzAPI provider bridges it) | Native Azure provider |
| Best for | Azure-only shops | Multi-cloud, broad ecosystems | Teams wanting IaC in a general-purpose language |

### Azure Developer CLI (azd)

`azd` ties code, IaC (Bicep/Terraform) and deployment together around **templates**: `azd init`, `azd up` (provision + deploy), `azd pipeline config` (generates a CI/CD pipeline with federated credentials). **.NET Aspire** projects deploy to Azure Container Apps with `azd up` by generating the infrastructure from the AppHost model — the exact AppHost described in [Observability & Aspire](ch:observability-aspire#net-aspire), here feeding straight into real infrastructure rather than just local orchestration.

### GitOps

For Kubernetes, **GitOps** (Flux, Argo CD) makes a Git repository the source of truth for cluster state: the CI pipeline updates the image tag in the manifests repo, and an in-cluster agent **pulls** and reconciles. See [Kubernetes](ch:kubernetes).

:::qa What's the difference between continuous integration, continuous delivery and continuous deployment?
CI: developers merge frequently and every change is automatically built and tested. Continuous delivery: every passing change is kept in a releasable state and can be deployed to production at the push of a button (manual approval). Continuous deployment: every passing change is deployed to production automatically, with no manual gate.
:::

:::qa What does a typical CI/CD pipeline for a .NET API look like?
CI on each push/PR: restore (locked), build with warnings as errors, format/analyzer checks, unit and integration tests (Testcontainers), vulnerability scans, results and coverage. CD on main: build the container image once and tag it with the commit SHA, scan and push to ACR, deploy to staging (migration bundle, new revision or slot), smoke tests, approval, production via slot swap or canary, then monitoring with rollback.
:::

:::qa Blue/green vs canary deployments?
Blue/green runs the new version in a parallel environment and switches all traffic at once, with instant rollback by switching back (App Service slot swap). Canary routes a small percentage of traffic to the new version and increases it gradually while health metrics stay good (Container Apps traffic splitting), limiting the blast radius.
:::

:::qa How do you deploy database schema changes without downtime?
Expand/contract: make backward-compatible changes first (add nullable columns or new tables), deploy code that works with both old and new schemas, backfill, then remove old structures in a later release. Apply migrations from the pipeline (idempotent scripts or EF bundles) with a dedicated identity before deploying the app.
:::

:::qa What is Infrastructure as Code and why use it?
Defining cloud infrastructure in declarative, versioned code (Bicep, Terraform, Pulumi) that's reviewed in PRs and applied by pipelines. It gives reproducible environments, change previews (what-if/plan), no configuration drift, auditable history and fast disaster recovery.
:::

:::qa Bicep vs Terraform?
Bicep is Azure's native DSL compiling to ARM: Azure-only, no state file, immediate support for new features. Terraform is multi-cloud with a large provider ecosystem and a state file you must store and lock remotely. Choose Bicep for Azure-only teams and Terraform for multi-cloud or when you need non-Azure providers.
:::

:::qa How should a pipeline authenticate to Azure?
With workload identity federation (OIDC): a federated credential on an Entra app or user-assigned managed identity that trusts the specific repository/environment, so no client secret is stored. Grant that identity least-privilege RBAC per environment.
:::

## Further reading

- [GitHub Actions documentation](https://docs.github.com/actions) · [Building and testing .NET with GitHub Actions](https://docs.github.com/actions/use-cases-and-examples/building-and-testing/building-and-testing-net)
- [Azure Pipelines documentation](https://learn.microsoft.com/en-us/azure/devops/pipelines/)
- [Bicep documentation](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/overview) · [Azure Verified Modules](https://aka.ms/avm)
- [Azure Developer CLI](https://learn.microsoft.com/en-us/azure/developer/azure-developer-cli/overview)
- Books: *Accelerate* (Forsgren, Humble, Kim); *Continuous Delivery* (Humble, Farley).

## Verify this chapter

Most of this chapter is about GitHub Actions, Azure resources and Bicep/Terraform behaviour, which need real cloud infrastructure to actually exercise — not something a console program can verify. The checks below instead verify the three claims from this chapter that genuinely are just computation: idempotency, SemVer's numeric comparison, and the expand/contract migration pattern. Save as `Program.cs` in a new console project (`dotnet new console`) and run with `dotnet run`.

```csharp
// Verifies claims from this chapter that are actually local/computational: IaC should be
// idempotent (applying it twice changes nothing the second time), SemVer needs numeric comparison
// (not string comparison, which gets "1.10.0" vs "1.9.0" backwards), and the expand/contract migration
// pattern keeps both old and new code working during the transition window.
// Most of this chapter's claims are about GitHub Actions, Azure resources, Bicep/Terraform behaviour
// and DORA research — not runtime-verifiable in a console app. See Further reading (especially the
// GitHub Actions, Bicep and *Accelerate* links) for those.
using System;

int fails = 0;
void Ok(string s) => Console.WriteLine($"OK: {s}");
void Check(bool cond, string s)
{
    if (cond) Ok(s);
    else { Console.WriteLine($"FAIL: {s}"); fails++; }
}

// --- IaC should be idempotent: applying the same desired state twice changes nothing the 2nd time ---
var resource = new FakeAzureResource();
bool firstApplyChanged = Apply(resource, desiredSku: "P1v3");
bool secondApplyChanged = Apply(resource, desiredSku: "P1v3");
Check(firstApplyChanged, "IaC apply: the first apply, from an empty resource, makes a change");
Check(!secondApplyChanged, "IaC apply: applying the identical desired state again makes no change (idempotent)");

// --- SemVer: comparing versions numerically, not as strings, is the whole point of the format ---
var v1_9 = new Version(1, 9, 0);
var v1_10 = new Version(1, 10, 0);
Check(v1_10 > v1_9, "SemVer: 1.10.0 is correctly a later version than 1.9.0 under numeric comparison");
Check(string.Compare("1.10.0", "1.9.0", StringComparison.Ordinal) < 0, "SemVer: naive string comparison gets this backwards ('1.10.0' sorts before '1.9.0'), which is exactly why tools compare version parts numerically instead");

// --- Expand/contract: during the transition, code using the OLD shape and code using the NEW shape must both work ---
var row = new ExpandedRow();                  // "expand" step: write both old and new columns
row.WriteBoth(oldTotal: 100m, newTotalCents: 10000);
Check(ReadOld(row) == 100m, "Expand/contract: old-shape reader still works during the transition (reads OldTotal)");
Check(ReadNew(row) == 100m, "Expand/contract: new-shape reader already works too (reads NewTotalCents / 100)");

Console.WriteLine(fails == 0 ? "\nAll checks passed." : $"\n{fails} check(s) failed.");
if (fails > 0) Environment.Exit(1);

static bool Apply(FakeAzureResource resource, string desiredSku)
{
    if (resource.Sku == desiredSku) return false;   // already in the desired state: no-op
    resource.Sku = desiredSku;
    return true;
}

static decimal ReadOld(ExpandedRow r) => r.OldTotal;
static decimal ReadNew(ExpandedRow r) => r.NewTotalCents / 100m;

sealed class FakeAzureResource { public string? Sku; }

sealed class ExpandedRow
{
    public decimal OldTotal;
    public long NewTotalCents;
    public void WriteBoth(decimal oldTotal, long newTotalCents) { OldTotal = oldTotal; NewTotalCents = newTotalCents; }
}
```
