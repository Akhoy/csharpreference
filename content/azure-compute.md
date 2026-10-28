---
id: azure-compute
title: Azure Compute: Where Your .NET Code Runs
summary: Choosing and using Azure's hosting options. App Service (plans, slots, scaling, configuration), Azure Functions (triggers, bindings, isolated worker, plans, Durable Functions), Azure Container Apps (revisions, scaling with KEDA, jobs, Dapr), AKS, VMs, and a decision guide with interview-ready comparisons.
layer: infra
where: Hosting & infrastructure › Compute (where code runs)
fits: Compute is where the host from layer 3 ([Hosting](ch:aspnet-hosting)) actually runs: as code on App Service, as a container ([Docker](ch:docker)) on Container Apps or AKS ([Kubernetes](ch:kubernetes)), or as functions triggered by events ([Messaging & events](ch:messaging-events)). It's provisioned with IaC and deployed by pipelines ([CI/CD & IaC](ch:cicd-iac)).
levels: b,i,a
prereqs: cloud-azure-overview, docker
next: azure-data-messaging, azure-identity-secrets, kubernetes
---

## TL;DR

- Azure's compute options form a spectrum: **VMs** (most control, most ops work) → **AKS** → **Container Apps** → **App Service** → **Functions** (least ops work, most opinionated).
- **App Service**: classic managed web hosting. **Deployment slots** let you warm up a new version on its own hostname, then swap it into production with near-zero downtime.
- **Azure Functions**: small units of code triggered by events (HTTP, timer, queue, etc.), billed per execution, scaling to zero. Use the modern **isolated worker model**, not the legacy in-process one.
- **Durable Functions** extend Functions with stateful, checkpointed workflows that can wait for days and survive restarts.
- **Container Apps**: serverless containers on managed Kubernetes underneath — most of AKS's capability (autoscaling via KEDA, traffic-split revisions, Dapr) without having to run a cluster yourself.
- **AKS**: full Kubernetes, for when you genuinely need its API/ecosystem and have the team to operate it.
- Pick based on how much operational effort you want to own, not which option sounds most powerful.

## The options at a glance {b}

```text
More control, more ops ◀──────────────────────────────────────────────────────────────▶ Less ops, more opinionated
  Virtual Machines      AKS (Kubernetes)      Container Apps        App Service          Azure Functions
  any software          full K8s control      serverless containers  managed web hosting  event-driven functions
```

Every option on this spectrum is the exact same trade-off from [Cloud fundamentals](ch:cloud-azure-overview#service-models-who-manages-what), just sliced more finely — more control always means more of the operational burden sits with your team.

| | **App Service** | **Azure Functions** | **Container Apps** | **AKS** | **Virtual Machines** |
|---|---|---|---|---|---|
| Unit | Web app (code or container) | Function (code; containers supported) | Container app (one or more containers) | Pods in a Kubernetes cluster | VM |
| Abstraction | PaaS | Serverless FaaS | Serverless containers (managed K8s + KEDA + Envoy underneath) | Managed Kubernetes control plane | IaaS |
| Scale | Manual/autoscale rules per plan; scale out to N instances | Automatic per event load; **scale to zero** (consumption plans) | Automatic via **KEDA** (HTTP, queue length, CPU…); **scale to zero** | HPA, KEDA, cluster autoscaler | VM scale sets |
| Pricing | Per plan (always on) | Per execution (consumption) or per plan | Per vCPU-second/GiB-second (consumption) or dedicated workload profiles | Nodes (VMs) + optional uptime SLA | VM hours |
| Best for | Classic web apps & APIs, simple deployment | Event glue, background triggers, spiky/scheduled jobs | Microservices, APIs, workers, jobs, without running K8s | Large platforms needing full K8s control and ecosystem | Legacy, special OS needs, lift-and-shift |
| Ops effort | Low | Lowest | Low–medium | **High** | Highest |

## Azure App Service {b}

**App Service** hosts web apps, REST APIs and background WebJobs, on Windows or Linux, from **code** (.NET published output) or a **container image**.

**App Service plan** = the underlying compute (VM size and instance count) that one or more apps share. The tier determines features:

| Tier | Notes |
|---|---|
| Free/Shared (F1/D1) | Dev/test only; shared infrastructure |
| Basic (B) | Dedicated, manual scale, no slots |
| **Standard (S) / Premium v3 (P0v3–P5mv3)** | Autoscale, **deployment slots**, VNet integration, zone redundancy (Premium) |
| Isolated v2 (App Service Environment) | Single-tenant, fully network-isolated |

### Deployment slots

Slots are **live apps with their own hostnames** (e.g. `shop-api-staging.azurewebsites.net`) on the same plan. Deploy to `staging`, **warm it up** and run smoke tests, then **swap** with production: the swap is near-instant, and you roll back by swapping again — the same zero-downtime instinct behind blue/green deployments generally, just built directly into the platform.

```bash
az webapp deployment slot create -g rg-shop -n shop-api --slot staging
az webapp deploy -g rg-shop -n shop-api --slot staging --src-path app.zip --type zip
az webapp deployment slot swap -g rg-shop -n shop-api --slot staging --target-slot production
```

Settings can be marked **slot-specific** ("sticky"), like a connection string pointing to a staging database, so they don't swap.

### Configuration and features

- **App settings** become **environment variables** (`Payments__ApiKey`); connection strings likewise — exactly the environment-variable binding [Configuration](ch:configuration-options#environment-variables-need-their-own-naming-convention) described. Use **Key Vault references**: `@Microsoft.KeyVault(SecretUri=https://kv-shop.vault.azure.net/secrets/StripeKey/)`.
- **Managed identity** (system- or user-assigned) for passwordless access to SQL, Storage and Key Vault ([Identity & secrets](ch:azure-identity-secrets)).
- **Autoscale** rules (CPU > 70% → +1 instance) or **automatic scaling** (Premium v3: HTTP-traffic based).
- **Health check** path: unhealthy instances are removed from the load balancer and replaced.
- **VNet integration** (outbound to private resources) and **private endpoints** (private inbound).
- **Always On** (keeps the app loaded; avoids idle unloading), **ARR affinity** (sticky sessions; turn it **off** for stateless apps), HTTP/2, TLS, custom domains, managed certificates, Easy Auth (built-in authentication).
- **Diagnose and solve problems**, Kudu/SCM site, log streaming, Application Insights integration.
- **WebJobs** run background tasks alongside the app (prefer hosted services or Functions in new code).

## Azure Functions {i}

**Azure Functions** runs small pieces of code in response to **triggers**, with automatic scaling and pay-per-use pricing.

### Triggers and bindings

| Triggers | Bindings (inputs/outputs without SDK boilerplate) |
|---|---|
| HTTP, **Timer** (CRON), **Service Bus** queue/topic, **Storage Queue**, **Blob** (or Event Grid-based blob), **Event Grid**, **Event Hubs**, **Cosmos DB change feed**, Kafka, RabbitMQ, SignalR, SQL change tracking | Blob, Table, Cosmos DB, Service Bus, Event Hubs, SQL, SignalR, Storage Queues… |

### The isolated worker model

Modern .NET functions run in the **isolated worker model**: your code runs in a **separate process** from the Functions host, so you control the .NET version and dependencies, and get **normal DI, middleware and configuration** like any .NET app. The older **in-process** model is being retired — check the [isolated worker guide](https://learn.microsoft.com/en-us/azure/azure-functions/dotnet-isolated-process-guide) in Further reading for the current end-of-support date before relying on it, since Microsoft's retirement schedules can shift.

```csharp
// Program.cs
var builder = FunctionsApplication.CreateBuilder(args);
builder.ConfigureFunctionsWebApplication();                 // ASP.NET Core integration for HTTP triggers
builder.Services.AddApplicationInsightsTelemetryWorkerService().ConfigureFunctionsApplicationInsights();
builder.Services.AddDbContext<ShopDb>(o => o.UseSqlServer(builder.Configuration.GetConnectionString("Shop")));
builder.Services.AddScoped<IInvoiceService, InvoiceService>();
builder.Build().Run();

// Functions
public sealed class OrderFunctions(IInvoiceService invoices, ILogger<OrderFunctions> log)
{
    [Function(nameof(GenerateInvoice))]
    [BlobOutput("invoices/{OrderId}.pdf", Connection = "Storage")]               // output binding: return value written to a blob
    public async Task<byte[]> GenerateInvoice(
        [ServiceBusTrigger("order-placed", Connection = "ServiceBus")] OrderPlaced message, CancellationToken ct)
    {
        log.LogInformation("Generating invoice for {OrderId}", message.OrderId);
        return await invoices.RenderPdfAsync(message.OrderId, ct);
    }

    [Function(nameof(NightlyCleanup))]
    public Task NightlyCleanup([TimerTrigger("0 0 2 * * *")] TimerInfo timer, CancellationToken ct) => invoices.PurgeDraftsAsync(ct);   // 02:00 daily

    [Function(nameof(GetInvoice))]
    public async Task<IActionResult> GetInvoice([HttpTrigger(AuthorizationLevel.Function, "get", Route = "invoices/{id}")] HttpRequest req, string id)
        => await invoices.FindAsync(id) is { } inv ? new OkObjectResult(inv) : new NotFoundResult();
}
```

Service Bus triggers handle **message settlement** for you: complete on success; on exception, retry and eventually **dead-letter** according to the queue's max delivery count — exactly the retry/dead-letter pattern [Messaging & events](ch:messaging-events#retries-poison-messages-and-dead-lettering) described, here managed entirely by the trigger rather than hand-coded.

### Hosting plans

| Plan | Scale | Cold start | Notes |
|---|---|---|---|
| **Flex Consumption** (recommended) | Event-driven, to zero, fast scale-out | Reduced; optional always-ready instances | VNet integration, per-function scaling, configurable memory |
| Consumption (classic) | To zero | Yes | 5–10 min execution timeout; Linux Consumption is being retired in favour of Flex |
| **Premium (Elastic Premium)** | Pre-warmed instances + burst | **None** (always ready) | VNet, longer runs, pricier |
| Dedicated (App Service plan) | Like App Service | None | Predictable cost; reuse an existing plan |
| Container Apps | Functions on Container Apps | Configurable | Unify with other containers |

:::gotcha Functions pitfalls
**Cold starts** on consumption plans (first request after idle takes seconds: use Flex with always-ready instances or Premium for latency-sensitive HTTP); **execution time limits**; **don't block or hold state in memory** (instances come and go); make triggers **idempotent** (at-least-once delivery); **share HttpClient and SDK clients** via DI (singletons), not per invocation; watch concurrency settings so you don't overwhelm downstream databases.
:::

### Durable Functions

An extension for **stateful workflows** in code: **orchestrator** functions call **activity** functions, and every step's result is saved as a history of events rather than overwriting a single "current state" value — the same idea as **event sourcing** ([Messaging & events](ch:messaging-events#event-sourcing) covers it in depth later), just applied here to a *workflow's* progress instead of a domain object's state. That history is what lets an orchestration survive a restart: on recovery, it replays the saved events to rebuild exactly where it left off, which is also why it can sit paused waiting for something — a timer, a human approval — for days without holding any resources open.

```csharp
[Function(nameof(OrderWorkflow))]
public static async Task<string> OrderWorkflow([OrchestrationTrigger] TaskOrchestrationContext ctx)
{
    var order = ctx.GetInput<OrderPlaced>()!;
    await ctx.CallActivityAsync(nameof(ReserveStock), order);
    try { await ctx.CallActivityAsync(nameof(ChargePayment), order); }
    catch (TaskFailedException) { await ctx.CallActivityAsync(nameof(ReleaseStock), order); return "cancelled"; }   // compensation (saga)

    using var cts = new CancellationTokenSource();
    var approval = ctx.WaitForExternalEvent<bool>("ManagerApproval");             // human-in-the-loop
    var timeout = ctx.CreateTimer(ctx.CurrentUtcDateTime.AddDays(2), cts.Token);
    if (await Task.WhenAny(approval, timeout) == timeout) return "expired";
    cts.Cancel();

    await ctx.CallActivityAsync(nameof(ShipOrder), order);
    return "completed";
}
```

Notice `catch (TaskFailedException)` calling `ReleaseStock` — this is a saga's compensating action, exactly the orchestration style [Messaging & events](ch:messaging-events#sagas-and-process-managers) described, just hosted inside Durable Functions instead of a message-broker state machine. Patterns: **function chaining**, **fan-out/fan-in** (parallel activities, then aggregate), **async HTTP APIs** (202 plus a status endpoint built in), **monitors** (polling loops), **human interaction**, and **durable entities**. Orchestrator code must be **deterministic** (no `DateTime.Now`, random numbers or direct I/O; use the context's APIs), because it is replayed. The **Durable Task Scheduler** is a managed backend for it.

## Azure Container Apps {i}

**Container Apps** runs containers on a **managed, serverless Kubernetes-based platform**: you get revisions, ingress, autoscaling (KEDA), Dapr and jobs **without operating a cluster** — the middle point on the compute spectrum, deliberately positioned to give most of AKS's capability without most of AKS's operational cost.

| Concept | Meaning |
|---|---|
| **Environment** | A secure boundary (shared VNet and Log Analytics) for a group of apps that can talk to each other internally |
| **Container app** | One or more containers (main + sidecars) with ingress, scale rules, secrets and identity |
| **Revision** | An immutable snapshot of an app version. **Multiple revisions** can run with **traffic splitting** (e.g. 90/10 canary, blue/green) |
| **Ingress** | External (internet) or internal (environment-only) HTTP/TCP ingress with TLS, custom domains, session affinity options |
| **Scale rules** | **KEDA** scalers: HTTP concurrency, CPU/memory, **Service Bus queue length**, Kafka lag, cron… min replicas 0–N |
| **Jobs** | Run-to-completion containers: manual, **scheduled** (cron) or **event-driven** (one job per queue message batch) |
| **Dapr** (optional) | Sidecar building blocks: service invocation, pub/sub, state, bindings, secrets |
| **Workload profiles** | Consumption (serverless) or dedicated (reserved hardware, GPUs) |

```bash
az containerapp up -n shop-api -g rg-shop --environment cae-shop \
  --image shopacr.azurecr.io/shop-api:1.4.2 --ingress external --target-port 8080 \
  --env-vars ASPNETCORE_ENVIRONMENT=Production ConnectionStrings__Shop=secretref:sql-cs
```

```bicep
// Scale a worker on Service Bus queue length; scale to zero when idle
scale: {
  minReplicas: 0
  maxReplicas: 20
  rules: [ {
    name: 'orders-queue'
    custom: { type: 'azure-servicebus', metadata: { queueName: 'orders', namespace: 'sb-shop', messageCount: '50' }, identity: 'system' }
  } ]
}
```

It's a sweet spot for .NET microservices: run an API, a worker, an outbox publisher and scheduled jobs as containers with autoscaling and zero cluster management. **.NET Aspire deploys to Container Apps** out of the box (`azd up`).

## Azure Kubernetes Service (AKS) {a}

**AKS** is managed Kubernetes: Azure runs the **control plane**, and you manage the **node pools** (VM scale sets) and everything you deploy. Choose it when you need the full Kubernetes API and ecosystem (Helm charts, operators, service meshes, custom controllers), many workloads on a shared platform, multi-cloud consistency, or fine-grained control over networking and scheduling, **and** you have the platform-engineering capacity to run it. See [Kubernetes](ch:kubernetes).

Key AKS integrations: **Workload Identity** (pods get Entra identities), **Key Vault CSI driver**, **ACR integration**, Azure CNI networking, **KEDA** and **cluster autoscaler** add-ons, the application routing add-on (managed NGINX ingress), Azure Monitor Container Insights and managed Prometheus/Grafana, and **AKS Automatic** (an opinionated, more managed mode).

## Virtual machines and others {a}

- **Virtual Machines / VM Scale Sets**: full OS control. Lift-and-shift of legacy .NET Framework apps on IIS, software that needs special OS configuration, or licensing constraints. You own patching, hardening, backups and scaling.
- **Azure Spring Apps** has been retired (it was for Java). **Azure Static Web Apps** serves SPAs with optional Functions APIs. **Azure Batch** handles large parallel compute jobs.

## Choosing compute: a decision guide {i}

```text
Is it a small piece of code triggered by events/timers, spiky or infrequent?    → Azure Functions (Flex Consumption)
Long-running stateful workflow, fan-out/in, human approval?                     → Durable Functions (or Container Apps + Temporal/MassTransit sagas)
A web app / API, want the simplest PaaS, maybe a few apps on one plan?          → App Service (code or container)
Several containerised microservices + workers + jobs, autoscale (to zero), no cluster ops? → Container Apps
Need full Kubernetes, large multi-team platform, existing K8s tooling and skills? → AKS
Legacy Windows/IIS app, special OS dependencies, lift-and-shift?               → VMs (or App Service Windows / Managed Instance for SQL)
```

| Interview comparison | Key difference |
|---|---|
| App Service vs Container Apps | App Service: classic PaaS web hosting with slots, always-on plans, code or containers. Container Apps: containers-first, KEDA event scaling, scale to zero, revisions with traffic splitting, Dapr, jobs: better for microservices and workers |
| Container Apps vs AKS | Container Apps hides Kubernetes (no cluster upgrades, node management or K8s API access); AKS exposes the full Kubernetes API with all its power and operational responsibility |
| Functions vs Container Apps | Functions: a programming model with triggers/bindings and per-execution billing. Container Apps: any container and any framework (ASP.NET Core, workers), with event-driven scaling via KEDA |
| Functions consumption vs premium | Consumption: scale to zero, cold starts, time limits. Premium: pre-warmed instances (no cold start), VNet, longer executions, always paying for minimum instances |

:::qa How would you choose between App Service, Container Apps, Functions and AKS?
Functions for event-triggered or scheduled small units of work with per-execution billing; App Service for straightforward web apps and APIs with slots and minimal ops; Container Apps for containerised microservices, workers and jobs with KEDA autoscaling and scale to zero without managing Kubernetes; AKS when you need full Kubernetes control and ecosystem and can operate it. Trade control against operational effort.
:::

:::qa What are App Service deployment slots and why use them?
Separate live instances of an app (e.g. staging) on the same plan, each with its own hostname and settings. You deploy and warm up in staging, then swap with production for near-zero-downtime releases and instant rollback by swapping back. Sticky settings stay with a slot.
:::

:::qa What's the isolated worker model in Azure Functions?
Functions code runs in a separate .NET process from the Functions host, so you choose the .NET version and dependencies and use standard DI, middleware and configuration. It replaces the in-process model, which Microsoft is retiring (check the current end-of-support date before relying on it, since retirement schedules can shift).
:::

:::qa What causes cold starts in Azure Functions and how do you mitigate them?
On consumption plans idle apps scale to zero, so the next request must allocate an instance, start the runtime and load your app. Mitigate with Flex Consumption always-ready instances or the Premium plan (pre-warmed), smaller startup work, ReadyToRun/AOT, and avoiding heavy initialisation in the startup path.
:::

:::qa What are Durable Functions?
An Azure Functions extension for stateful, long-running workflows written as orchestrator code that calls activity functions. State is checkpointed and replayed, so orchestrations survive restarts. It supports chaining, fan-out/fan-in, timers, external events and human interaction, monitors and entities. Orchestrators must be deterministic.
:::

:::qa How does Azure Container Apps scale?
With KEDA-based scale rules: HTTP concurrency, CPU/memory, or event sources like Service Bus queue length, Kafka lag or cron, between min and max replicas, including scaling to zero. Revisions allow traffic splitting for canary and blue/green deployments.
:::

## Further reading

- [Choose an Azure compute service](https://learn.microsoft.com/en-us/azure/architecture/guide/technology-choices/compute-decision-tree)
- [App Service overview](https://learn.microsoft.com/en-us/azure/app-service/overview) · [Deployment slots](https://learn.microsoft.com/en-us/azure/app-service/deploy-staging-slots)
- [Azure Functions isolated worker guide](https://learn.microsoft.com/en-us/azure/azure-functions/dotnet-isolated-process-guide) · [Durable Functions](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-overview)
- [Azure Container Apps overview](https://learn.microsoft.com/en-us/azure/container-apps/overview)
- [AKS documentation](https://learn.microsoft.com/en-us/azure/aks/)

## Verify this chapter

Most of this chapter needs real Azure resources to exercise (App Service, Functions, Container Apps, AKS). What you can verify locally is the mechanism behind two specific claims: that replaying a saved event history is deterministic (why Durable Functions survives a restart), and how a KEDA-style scale rule computes replica count, including scale-to-zero. Run with `dotnet run` (plain console app, .NET 8/9, BCL only).

```csharp
// Claim: a Durable Functions orchestration survives a restart because its progress is saved as a history of
// events, and recovery REPLAYS that history to deterministically rebuild the same state. Model that directly:
// replaying the same event list twice, from scratch, must produce identical state both times.
var history = new List<string> { "ReserveStock", "ChargePayment", "ShipOrder" };

var firstReplay = Replay(history);
var secondReplay = Replay(history); // simulates "the process restarted and replayed from the saved history again"

if (firstReplay != secondReplay)
    throw new Exception($"FAIL: expected deterministic replay to produce the same result, got '{firstReplay}' vs '{secondReplay}'");
Console.WriteLine($"OK: replaying the same saved event history twice deterministically reproduces the same state ('{firstReplay}') — this is why an orchestration survives a restart");

// Claim: KEDA scale rules compute replica count from an event metric (e.g. queue length) against a threshold,
// clamped to [minReplicas, maxReplicas], and CAN scale to zero when minReplicas is 0 and the queue is empty.
int ComputeReplicas(int queueLength, int messageCountPerReplica, int minReplicas, int maxReplicas)
{
    var desired = queueLength == 0 ? 0 : (int)Math.Ceiling(queueLength / (double)messageCountPerReplica);
    return Math.Clamp(desired, minReplicas, maxReplicas);
}

var scaledToZero = ComputeReplicas(queueLength: 0, messageCountPerReplica: 50, minReplicas: 0, maxReplicas: 20);
if (scaledToZero != 0)
    throw new Exception($"FAIL: expected an empty queue with minReplicas=0 to scale to zero, got {scaledToZero}");
Console.WriteLine("OK: an empty queue with minReplicas=0 scales to 0 replicas — the scale-to-zero claim");

var scaledUp = ComputeReplicas(queueLength: 220, messageCountPerReplica: 50, minReplicas: 0, maxReplicas: 20);
if (scaledUp != 5) // ceil(220/50) = 5
    throw new Exception($"FAIL: expected 5 replicas for 220 queued messages at 50/replica, got {scaledUp}");
Console.WriteLine($"OK: 220 queued messages at 50/replica scales to {scaledUp} replicas, clamped to [0, 20]");

var clampedToMax = ComputeReplicas(queueLength: 5000, messageCountPerReplica: 50, minReplicas: 0, maxReplicas: 20);
if (clampedToMax != 20)
    throw new Exception($"FAIL: expected scaling to clamp at maxReplicas=20, got {clampedToMax}");
Console.WriteLine($"OK: a huge backlog clamps at maxReplicas ({clampedToMax}), not an unbounded number of replicas");

// Not runtime-verifiable here (needs real Azure resources: App Service, Functions, Container Apps, AKS) — see Further reading:
// - Deployment slot swap behavior, App Service tiers
// - Real Functions cold starts, hosting plans, isolated worker retirement dates
// - Container Apps revisions, traffic splitting, Dapr
// - AKS control plane / node pool mechanics

Console.WriteLine("All checkable claims verified.");

static string Replay(List<string> eventHistory)
{
    var state = "start";
    foreach (var step in eventHistory) state = $"{state}->{step}";
    return state;
}
```
