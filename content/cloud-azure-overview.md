---
id: cloud-azure-overview
title: Cloud Fundamentals and the Azure Landscape
summary: The cloud vocabulary before the services. IaaS, PaaS, serverless and SaaS, the shared responsibility model, regions and availability zones, scaling and elasticity, designing stateless cloud-native apps (the twelve factors), Azure's resource hierarchy, the Azure service map for .NET developers, cost, and the Well-Architected Framework.
layer: infra
where: Hosting & infrastructure › Cloud fundamentals
fits: This opens layer 7: the land your application is built on. Every later chapter in this part picks one area of the map below: [Docker](ch:docker), [compute](ch:azure-compute), [data & messaging](ch:azure-data-messaging), [identity & secrets](ch:azure-identity-secrets), [CI/CD & IaC](ch:cicd-iac), [Kubernetes](ch:kubernetes). Cloud-native design choices also reach back into layer 3 (stateless apps, configuration, graceful shutdown).
levels: b,i,a
prereqs: aspnet-hosting
next: docker, azure-compute, azure-data-messaging
---

## TL;DR

- Cloud = renting compute/storage/services on demand, paying for use, instead of owning hardware.
- **IaaS → PaaS → Serverless → SaaS** is a sliding scale of how much the provider manages for you. For .NET backends, default to PaaS/managed services — running your own VMs is operational work you probably don't need.
- **Shared responsibility**: the provider secures the cloud's infrastructure; you always own your data, identities and access policies, regardless of service model.
- Scaling **out** (more instances) needs a genuinely **stateless** app; scaling **up** (a bigger instance) doesn't, but hits a ceiling.
- The **twelve-factor app** rules (config from environment, statelessness, graceful shutdown, logs as streams, etc.) are what makes an app safe to scale out and redeploy without drama.
- Azure resources nest: tenant → management groups → subscriptions → resource groups → resources, with RBAC and Policy applying at any level.
- The **Well-Architected Framework**'s five pillars (Reliability, Security, Cost, Operations, Performance) are the lens interviewers use for system-design questions.

## What "the cloud" means {b}

Renting computing resources (servers, storage, databases, networking, managed services) **on demand, over the internet, paying for what you use**, instead of buying and running your own hardware.

Essential characteristics (NIST): **on-demand self-service** (create a database in minutes via the portal, CLI or code), **broad network access**, **resource pooling** (multi-tenant), **rapid elasticity** (scale up and down quickly), and **measured service** (pay per use).

## Service models: who manages what {b}

```text
                  On-premises    IaaS           PaaS            Serverless / FaaS   SaaS
Application       YOU            YOU            YOU             YOU (functions)     provider
Data              YOU            YOU            YOU             YOU                 provider*
Runtime (.NET)    YOU            YOU            provider        provider            provider
OS / patching     YOU            YOU            provider        provider            provider
Virtualisation    YOU            provider       provider        provider            provider
Servers/network   YOU            provider       provider        provider            provider
Azure examples    —              Virtual        App Service,    Azure Functions,    Microsoft 365,
                                 Machines       Azure SQL,      Container Apps      Dynamics, GitHub
                                                Container Apps  (scale to zero)
```
*You still own your data and its access control in SaaS.

Reading down any one column tells you exactly where your team's operational burden starts: in IaaS, the line is drawn right after "Virtualisation" — you own the OS and everything above it. In PaaS, the line moves up to "Runtime" — Azure patches the OS and keeps the .NET runtime current, and your job is just the app itself.

| Model | You manage | Trade-off |
|---|---|---|
| **IaaS** | VMs, OS, runtime, app | Maximum control, maximum operations work |
| **PaaS** | App code and configuration | Fast delivery, built-in scaling, patching and backups; less control |
| **Containers-as-a-service** | Container images | Portable packaging with managed orchestration |
| **Serverless** | Functions/containers; pay per execution; scale to zero | No idle cost, event-driven; cold starts, execution limits |
| **SaaS** | Nothing technical | Use it as a product |

**Rule of thumb for .NET backends: prefer PaaS and managed services.** Every VM you run is patching, monitoring, backup and security work your team owns — work that buys you very little unless you have a genuine, specific reason to need OS-level control.

## The shared responsibility model {b}

The provider secures **the cloud** (datacentres, hardware, hypervisor, the services' infrastructure); **you** secure what you put **in the cloud**: your code, data, identities, access policies, network rules and configuration. The split shifts with the service model, but **identities, data and access are always yours**. Most cloud breaches are customer misconfigurations (public storage containers, leaked keys, over-privileged identities), not provider failures — a sobering fact worth keeping in mind every time [Azure identity & secrets](ch:azure-identity-secrets) asks you to configure an access policy.

## Regions, availability zones and resilience {i}

| Concept | Meaning | Use |
|---|---|---|
| **Region** | A geographic area with one or more datacentres (West Europe, East US 2, Germany West Central) | Latency to users, data residency (GDPR), service availability, price |
| **Availability Zone (AZ)** | Physically separate datacentres within a region, with independent power, cooling and network | **Zone-redundant** deployments survive a datacentre failure |
| **Region pair** | Two regions in the same geography paired for disaster recovery and staggered updates | Geo-redundant storage, DR |
| **Geography** | A set of regions within a data-residency boundary | Compliance |

There's a ladder of resilience tiers, each one buying more availability at the cost of more complexity and money:

1. **Single instance** — cheapest, but any deployment or failure means downtime.
2. **Multiple instances across zones** — the standard baseline for production.
3. **Multi-region active-passive** — a second region on standby for disaster recovery; you define an RTO/RPO (below) and fail over to it.
4. **Multi-region active-active** — the most available and the most complex: global routing (Front Door) in front of data that's replicated across regions (Cosmos DB multi-region writes, or SQL geo-replication).

Pick the tier your workload's actual availability requirement justifies — not automatically the top of the list.

- **RTO** (Recovery Time Objective): how long you can be down.
- **RPO** (Recovery Point Objective): how much data (time) you can lose.

## Scaling and elasticity {b}

| | Scale **up** (vertical) | Scale **out** (horizontal) |
|---|---|---|
| How | A bigger machine/tier (more CPU and RAM) | More instances behind a load balancer |
| Limit | The largest SKU; usually requires a restart | Effectively unlimited, if the app is stateless |
| Resilience | Still one instance | Survives instance loss |
| Requirement | None | **Stateless application** + shared state stores |

The "Requirement" row is the important one: scaling out isn't free just because the cloud makes adding instances easy — it only works if the application genuinely doesn't care which instance handles which request. That requirement is exactly what the twelve-factor discipline below is built around.

**Autoscaling** adds or removes instances automatically, based on metrics (CPU, memory, requests per second, or queue length via **KEDA**, a Kubernetes add-on that scales workloads using metrics from outside the cluster, like a message queue's depth) or on a schedule. **Elasticity** specifically means scaling *down* too, not just up — so you stop paying for capacity nobody's using.

## Cloud-native app design: the twelve factors {i}

The **Twelve-Factor App** methodology (Heroku) summarises how to build apps that run well on cloud platforms, and ASP.NET Core supports each factor:

| Factor | Meaning | In .NET |
|---|---|---|
| 1. Codebase | One repo per app, many deploys | Git, one pipeline per deployable |
| 2. Dependencies | Declare and isolate | NuGet with lock files, container images |
| 3. **Config** | Store config in the **environment** | `IConfiguration` env vars, Key Vault, App Configuration ([Configuration](ch:configuration-options)) |
| 4. Backing services | Treat DBs and queues as attached resources via URLs | Connection strings from config; swap without code changes |
| 5. Build, release, run | Strictly separate stages | CI builds an immutable image; CD releases it with config |
| 6. **Processes** | Run as **stateless** processes | No in-memory session, no local file storage; use Redis or Blob |
| 7. Port binding | Self-contained, exports HTTP via a port | Kestrel on `ASPNETCORE_HTTP_PORTS` |
| 8. Concurrency | Scale out via processes | Instances/replicas; separate web and worker processes |
| 9. **Disposability** | Fast startup, **graceful shutdown** | Host shutdown handling, SIGTERM, `stoppingToken` ([Hosting](ch:aspnet-hosting#application-lifetime-and-graceful-shutdown-what-actually-hap)) |
| 10. Dev/prod parity | Keep environments similar | Containers, Aspire, Testcontainers, IaC |
| 11. **Logs** | Treat logs as event streams (stdout) | Console/OTLP logging; the platform collects them |
| 12. Admin processes | Run one-off tasks as separate processes | Migration bundles, jobs, `dotnet ef` in the pipeline |

Factors 3, 6 and 9 are bolded above because they're the ones ASP.NET Core chapters earlier in this book built entire sections around — configuration-from-environment, statelessness, and graceful shutdown each got dedicated treatment precisely because getting them wrong is what breaks an app the moment it's scaled past one instance.

:::gotcha The classic "it works with one instance" bugs
In-memory sessions or caches assumed to be shared, files written to the local disk, scheduled jobs running on every replica, Data Protection keys not shared (logged-out users), SignalR without a backplane, and sticky-session assumptions. All of them show up the first time you scale out to 2 instances. Design for N instances from day one.
:::

## Azure's resource hierarchy {i}

```text
Microsoft Entra tenant (identity boundary: users, groups, app registrations)
└── Management groups (policy & RBAC inheritance for many subscriptions)
    └── Subscriptions (billing + quota + access boundary; often one per environment or team)
        └── Resource groups (lifecycle container: deploy/delete together, e.g. "rg-shop-prod-weu")
            └── Resources (App Service, SQL database, Key Vault, Storage account…)
```

- **Azure Resource Manager (ARM)** is the control plane: every create/update goes through it, from the portal, CLI (`az`), PowerShell, SDKs, Bicep/Terraform.
- **RBAC** role assignments at any scope (management group → resource) grant **who can do what** (Owner, Contributor, Reader, plus data-plane roles like *Storage Blob Data Reader*).
- **Azure Policy** enforces rules ("only these regions", "storage must not allow public access", "tags required").
- **Tags** (`env=prod`, `owner=team-orders`, `costCenter=123`) enable cost reporting and governance.
- **Naming conventions** (Cloud Adoption Framework): `app-shop-api-prod-weu-001`, `kv-shop-prod-weu`.

## The Azure map for .NET backend developers {b}

| Need | Azure service(s) | Chapter |
|---|---|---|
| Run web apps / APIs | **App Service**, **Container Apps**, AKS, Functions | [Azure compute](ch:azure-compute) |
| Run background / event-driven code | **Functions**, Container Apps jobs, WebJobs | [Azure compute](ch:azure-compute) |
| Container registry | **Azure Container Registry (ACR)** | [Docker](ch:docker) |
| Relational database | **Azure SQL Database**, SQL Managed Instance, Azure Database for PostgreSQL | [Azure data](ch:azure-data-messaging) |
| NoSQL / global data | **Cosmos DB** | [NoSQL](ch:nosql-redis) |
| Files, blobs, static content | **Blob Storage** (Storage account), Azure Files | [Azure data](ch:azure-data-messaging) |
| Cache | **Azure Managed Redis** | [Caching](ch:caching-ratelimit-cors) |
| Messaging | **Service Bus**, **Event Grid**, **Event Hubs**, Storage Queues | [Azure data](ch:azure-data-messaging) |
| Secrets, keys, certificates | **Key Vault** | [Identity & secrets](ch:azure-identity-secrets) |
| Identity | **Microsoft Entra ID**, **managed identities**, Entra External ID (customers) | [Identity & secrets](ch:azure-identity-secrets) |
| Configuration and feature flags | **App Configuration** | [Configuration](ch:configuration-options) |
| API gateway | **API Management** | [Microservices](ch:microservices) |
| Global entry, CDN, WAF | **Front Door**, Application Gateway (regional L7 LB + WAF), Load Balancer (L4) | — |
| Monitoring | **Azure Monitor**, **Application Insights**, Log Analytics | [Observability](ch:observability-aspire) |
| Networking | Virtual Network (VNet), subnets, NSGs, **Private Endpoints**, Private DNS, VPN/ExpressRoute | below |
| AI | Azure OpenAI / AI Foundry, AI Search | — |
| IaC and deployment | ARM/**Bicep**, Terraform, **azd**, GitHub Actions/Azure DevOps | [CI/CD & IaC](ch:cicd-iac) |

## Networking essentials {a}

- **VNet**: your private network in Azure, divided into **subnets**. **NSGs** filter traffic per subnet/NIC.
- **Private Endpoints** give a PaaS service (SQL, Storage, Key Vault, Service Bus) a **private IP in your VNet**, and you then **disable public network access**. A common production security requirement. Requires **Private DNS zones** so names resolve to the private IPs.
- **VNet integration** lets App Service/Functions/Container Apps reach private resources.
- **Service endpoints**: an older, simpler alternative to private endpoints.
- **Hub-and-spoke** topology: shared services (firewall, VPN gateway) in a hub VNet, workloads in peered spokes.
- **Front Door** (global, edge) → **Application Gateway / API Management** (regional) → apps.

## Cost {i}

Cloud costs grow quietly — nobody decides to overspend, it accumulates from dozens of individually-reasonable-looking choices. Know the levers:

| Lever | Example |
|---|---|
| Right-sizing | P3v3 App Service plan at 10% CPU → P1v3 |
| Autoscale and scale to zero | Container Apps/Functions consumption for spiky workloads |
| Reservations / savings plans | 1–3 year commitments for steady workloads (Microsoft advertises up to ~60–70% off list price — see [Reservations pricing](https://azure.microsoft.com/en-us/pricing/reserved-vm-instances/) in Further reading; actual savings depend on the SKU and term) |
| Serverless/consumption tiers | Cosmos DB serverless or autoscale, Azure SQL serverless (auto-pause) |
| Dev/test environments | Smaller SKUs, shut down at night, dev/test pricing |
| Storage tiers | Hot → Cool → Cold → Archive lifecycle policies for blobs |
| Data egress | Traffic leaving Azure or crossing regions costs money |
| Logging volume | Application Insights ingestion: sampling, log levels, retention |

Tools: **Azure Cost Management** (budgets, alerts, cost analysis by tag), **Azure Advisor** (cost, reliability and security recommendations), the **Pricing Calculator**.

## The Azure Well-Architected Framework {a}

Five pillars to evaluate any workload design. They map directly onto interview "system design" discussions, and worth noticing: each pillar is really a lens this entire book has already applied chapter by chapter — Reliability is [Resilience](ch:resilience), Security is [Auth](ch:auth) and [Web security](ch:web-security), Performance Efficiency is [Performance engineering](ch:performance-engineering).

| Pillar | Key questions | Techniques |
|---|---|---|
| **Reliability** | Does it survive failures and recover? | Zones, redundancy, retries, health probes, backups, DR, chaos testing |
| **Security** | Is it protected end to end? | Entra ID + managed identity, least privilege, Key Vault, private endpoints, WAF, encryption, Defender for Cloud |
| **Cost Optimization** | Is spend aligned with value? | Right-sizing, autoscale, reservations, tiering, tagging |
| **Operational Excellence** | Can we deploy and run it safely? | IaC, CI/CD, observability, runbooks, safe deployment (slots, canaries) |
| **Performance Efficiency** | Does it scale to demand? | Scale-out, caching, CDN, async processing, partitioning, load testing |

:::qa What is the difference between IaaS, PaaS and serverless?
IaaS gives virtual machines and networking: you manage the OS, runtime and app. PaaS manages the OS and runtime and you deploy code or containers (App Service, Azure SQL). Serverless runs code on demand with automatic scaling, including to zero, and per-execution billing (Azure Functions, Container Apps consumption), with constraints like cold starts.
:::

:::qa What is the shared responsibility model?
The cloud provider is responsible for security of the cloud (physical infrastructure, hardware, virtualisation, managed service internals); the customer is responsible for security in the cloud (data, identities, access control, application code, network configuration). The split depends on IaaS, PaaS or SaaS, but data and identity are always the customer's.
:::

:::qa What are availability zones and why use them?
Physically separate datacentres within an Azure region with independent power, cooling and networking. Deploying instances and zone-redundant services across zones protects against a datacentre outage while keeping low latency.
:::

:::qa Scale up vs scale out?
Scale up (vertical) moves to a larger instance with more CPU and RAM; it's limited by the largest size and doesn't add redundancy. Scale out (horizontal) adds more instances behind a load balancer: near-unlimited and resilient, but it requires a stateless application with shared state in external stores.
:::

:::qa What makes an application cloud-native / twelve-factor?
Config from the environment, stateless processes with backing services attached via configuration, port binding, fast startup and graceful shutdown, logs as stdout streams, strict build/release/run separation, dev/prod parity, and scale-out via processes. In .NET: IConfiguration with env vars and Key Vault, Kestrel, Redis/Blob for state, hosted-service shutdown handling, container images and IaC.
:::

:::qa How is Azure organised (resource hierarchy)?
An Entra tenant contains management groups, which contain subscriptions (billing, quota and access boundaries), which contain resource groups (lifecycle containers), which contain resources. RBAC and Azure Policy can be applied at any level and are inherited downward. Everything is managed through Azure Resource Manager.
:::

:::qa What are private endpoints?
Network interfaces that give an Azure PaaS service a private IP address inside your VNet, so traffic stays on the Microsoft backbone and you can disable the service's public endpoint. They need Private DNS zone configuration.
:::

:::qa What are RTO and RPO?
Recovery Time Objective: the maximum acceptable downtime after a disaster. Recovery Point Objective: the maximum acceptable data loss measured in time. Both drive backup, replication and failover design.
:::

## Further reading

- [Azure fundamentals (Microsoft Learn path, AZ-900)](https://learn.microsoft.com/en-us/training/paths/azure-fundamentals-describe-cloud-concepts/)
- [Azure Well-Architected Framework](https://learn.microsoft.com/en-us/azure/well-architected/)
- [Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/)
- [The Twelve-Factor App](https://12factor.net/)
- [Azure for .NET developers](https://learn.microsoft.com/en-us/dotnet/azure/)
- Certifications that match this part: AZ-900 (fundamentals), **AZ-204 (Developing Solutions for Azure)**, AZ-305 (architect).
- [Reservations pricing](https://azure.microsoft.com/en-us/pricing/reserved-vm-instances/) — source for the reservation-discount figures above.

## Verify this chapter

Most of this chapter is about Azure services, pricing and network topology, which a console program can't exercise. What *can* be verified locally is the mechanism behind two core claims: config-from-environment (twelve-factor #3) and why scaling out needs a stateless app. Run with `dotnet run` (plain console app, .NET 8/9, BCL only).

```csharp
// Claim (twelve-factor, factor 3): "store config in the environment" — .NET's config system reads env vars directly.
Environment.SetEnvironmentVariable("SHOP_API_KEY", "demo-key-123"); // stands in for a real deployment setting this
var apiKeyFromEnv = Environment.GetEnvironmentVariable("SHOP_API_KEY");
if (apiKeyFromEnv != "demo-key-123")
    throw new Exception("FAIL: expected config to come from the environment, not a hardcoded value");
Console.WriteLine($"OK: config read from the environment ({apiKeyFromEnv}), exactly how IConfiguration's environment provider works");

// Claim: scaling OUT only works if the app is genuinely stateless (shares nothing per-instance that a later request needs).
// Simulate two "instances" with their own local, in-memory dictionary — the broken pattern the chapter warns about.
var instanceA = new Dictionary<string, string>();
var instanceB = new Dictionary<string, string>();

instanceA["cart-42"] = "2x widget"; // request 1 lands on instance A, which remembers the cart locally

// Request 2 for the same cart gets load-balanced to instance B instead.
bool statefulInstanceBSeesIt = instanceB.ContainsKey("cart-42");
if (statefulInstanceBSeesIt)
    throw new Exception("FAIL: expected instance B's local dictionary to know nothing about instance A's state");
Console.WriteLine("OK: with local in-memory state, a second instance has no idea about the first instance's cart — this is exactly why scale-out needs a stateless app + shared state store");

// Now the fix: a shared store (stands in for Redis/SQL/Blob) that every instance reads and writes to instead of local memory.
var sharedStore = new Dictionary<string, string>();
void HandleOnAnyInstance(string key, string value) => sharedStore[key] = value; // every "instance" calls this the same way
string? ReadFromAnyInstance(string key) => sharedStore.TryGetValue(key, out var v) ? v : null;

HandleOnAnyInstance("cart-42", "2x widget");                 // "instance A" handles this
var seenFromAnotherInstance = ReadFromAnyInstance("cart-42"); // "instance B" handles the next request
if (seenFromAnotherInstance != "2x widget")
    throw new Exception("FAIL: expected the shared store to make the cart visible from any instance");
Console.WriteLine("OK: with state moved to a shared store, any instance can see the same cart — this is the stateless-process pattern the twelve-factor app requires");

// Not runtime-verifiable here (needs real Azure resources, pricing, or network topology) — see Further reading:
// - Service model boundaries (IaaS/PaaS/serverless/SaaS), shared responsibility model
// - Regions, availability zones, RTO/RPO, resource hierarchy, RBAC, private endpoints
// - Reservation/savings-plan discount percentages
// - Well-Architected Framework pillars

Console.WriteLine("All checkable claims verified.");
```
