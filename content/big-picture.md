---
id: big-picture
title: The Big Picture: How Everything in .NET Fits Together
summary: Before any detail, the whole map. What the pieces of the .NET world are, which layer each belongs to, and how a single HTTP request touches almost all of them.
layer: runtime
where: Orientation › The whole map
fits: This chapter sits *above* every other chapter. Come back to it whenever a new term shows up and you can't tell what it is or what it is next to.
levels: b
next: what-is-dotnet, aspnet-hosting
---

## TL;DR

- .NET is organised in **8 layers**, each built on the one below: Language → Runtime → Frameworks → Architecture → Data → Service comms → Hosting/infra → Cross-cutting.
- Most confusion comes from one English word ("service", "context", "scope", "handler") meaning something different at each layer — know the layer, know the meaning.
- A single HTTP request touches almost every layer on its way in and back out; that end-to-end trip is the backbone of the "walk me through a request" interview question.
- Microsoft reuses a few product-name families (the platform family, the web family, the data family, the `Microsoft.Extensions.*` glue, the cloud family) — recognising the family tells you what something is for even if you've never seen its exact name.
- Read Beginner sections everywhere first for a shallow full map, then go deeper where interviews actually probe (C#/async, DI, middleware, EF Core, SOLID, REST, auth, testing, cloud).

## Why .NET feels like a maze {b}

You feel lost because you learned the pieces one by one, from tutorials that each assume you already know the other pieces. "Add a scoped service", "register the middleware", "inject `IOptions<T>`", "deploy to Container Apps": each sentence comes from a different layer of the system, and nobody showed you the layers.

The fix is a **map with layers**. Every concept in .NET belongs to exactly one layer, and each layer only builds on the layers beneath it. Once you know the layer, you know:

- **what it depends on** (the layers below it),
- **what depends on it** (the layers above it),
- **what it is *not*** (a middleware is not a design pattern; a DI lifetime is not a cloud setting).

:::analogy A building
Think of a backend system as a building. **C#** is the bricks. **The runtime** (CLR) is the foundation and the plumbing: water (memory) and electricity (threads) are supplied without you thinking about them. **ASP.NET Core and EF Core** are pre-built floors you move into. **Architecture** is how you arrange the rooms. **Data** is the storage in the basement. **Communication** is the corridors and lifts between buildings. **Infrastructure** is the land, the city and the roads (the cloud). **Cross-cutting concerns** are the building codes (security, fire inspections and maintenance) that apply to every floor.
:::

## The eight layers {b}

This is the map the whole book uses. Every chapter opens with this stack and highlights the layer you are in.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ 8  CROSS-CUTTING        Testing · Security · Observability · Performance     │  ← applies to every layer
├──────────────────────────────────────────────────────────────────────────────┤
│ 7  HOSTING & INFRA      Docker · Azure App Service/Functions/Container Apps  │  where it runs
│                         Kubernetes · CI/CD · Infrastructure as Code          │
├──────────────────────────────────────────────────────────────────────────────┤
│ 6  SERVICE COMMS        REST/HTTP · gRPC · SignalR · Message brokers         │  how services talk
│                         Events · Outbox · Sagas · Resilience (Polly)         │
├──────────────────────────────────────────────────────────────────────────────┤
│ 5  DATA & STATE         SQL Server/Postgres · EF Core · Dapper · Redis       │  where state lives
│                         Cosmos DB · Blob storage · Caching                   │
├──────────────────────────────────────────────────────────────────────────────┤
│ 4  ARCHITECTURE         SOLID · Design patterns · Clean/Onion · Vertical     │  how code is organised
│                         slices · CQRS · DDD · Microservices                  │
├──────────────────────────────────────────────────────────────────────────────┤
│ 3  FRAMEWORKS           ASP.NET Core: hosting, DI, config, middleware,       │  pre-built machinery
│                         routing, APIs, auth · EF Core · Worker services      │
├──────────────────────────────────────────────────────────────────────────────┤
│ 2  RUNTIME & PLATFORM   CLR · JIT · GC · Base Class Library · SDK · NuGet    │  what executes code
├──────────────────────────────────────────────────────────────────────────────┤
│ 1  LANGUAGE             C#: types, OOP, generics, LINQ, async/await …        │  what you write
└──────────────────────────────────────────────────────────────────────────────┘
```

| # | Layer | Question it answers | Typical interview question |
|---|---|---|---|
| 1 | Language | *How do I express logic?* | "Struct vs class?", "What does `await` do?" |
| 2 | Runtime & platform | *What runs my code and manages memory?* | "What is the JIT?", "How does the GC work?" |
| 3 | Frameworks | *What machinery handles HTTP, DI, config, DB mapping?* | "Explain middleware order", "Scoped vs singleton?" |
| 4 | Architecture | *How should I organise my own code?* | "Explain Clean Architecture", "When CQRS?" |
| 5 | Data & state | *Where does data live and how do I get it efficiently?* | "N+1 problem?", "Clustered index?" |
| 6 | Service communication | *How do separate processes talk reliably?* | "Outbox pattern?", "Circuit breaker?" |
| 7 | Hosting & infrastructure | *Where does it run and how does it get there?* | "App Service vs AKS?", "Multi-stage Dockerfile?" |
| 8 | Cross-cutting | *Is it correct, secure, visible and fast?* | "How do you test this?", "How do you find a slow endpoint?" |

:::tip How to use the map when you're lost
When you meet a new term, ask "which layer?" first. `IOptionsMonitor` is layer 3 (an ASP.NET Core/hosting feature). `Span<T>` is layer 1 and 2 (a C# type that the runtime treats specially). "Saga" is layer 6. "Managed identity" is layer 7, and it shows up in layer 5 when you connect to a database without a password. Once you know where something lives, it stops being random.
:::

## The same thing at different layers {b}

A lot of confusion comes from one word meaning different things on different layers, or one idea showing up at several layers. Here are the most common:

| Word | Layer 1–2 meaning | Layer 3 meaning | Layer 4+ meaning |
|---|---|---|---|
| **Pipeline** | — | The middleware pipeline (request → middleware → endpoint) | CI/CD pipeline (build → test → deploy); MediatR "pipeline behaviours" |
| **Host** | The process that loads the CLR | The **Generic Host**: object that owns DI, config, logging, lifetime | The machine/container/App Service that runs your app |
| **Service** | — | A class registered in the DI container | A deployable application ("the Orders service") |
| **Handler** | An event handler (delegate) | Route handler, authorization handler, `DelegatingHandler` | Command/query handler in CQRS |
| **Filter** | — | MVC/endpoint filters around an action | EF Core global query filters (data layer) |
| **Context** | `SynchronizationContext`, `ExecutionContext` | `HttpContext` (one request) | `DbContext` (one unit of work), DDD "bounded context" |
| **Scope** | Variable scope | DI scope (= one HTTP request) | Logging scope, transaction scope |
| **Repository** | — | — | Data-access pattern (layer 4/5); also "Git repository" |
| **Event** | C# `event` keyword | `IHostApplicationLifetime` events | Domain events, integration events, Event Grid |

:::gotcha The single biggest mix-up
"Service" in **`builder.Services.AddScoped<IOrderService, OrderService>()`** means "a class the DI container can create". "Service" in **"microservices"** means "a separately deployed application". An app with 200 DI services can still be one monolith.
:::

## Follow one request through every layer {b}

This trace touches nearly every chapter in the book, so it's the best way to see how the pieces connect. Imagine a mobile app calls:

```http
POST https://api.shop.com/orders
Authorization: Bearer eyJhbGciOi...
Content-Type: application/json

{ "customerId": 42, "lines": [ { "sku": "KB-01", "qty": 1 } ] }
```

### 1. Infrastructure: the request finds your code (layer 7)

DNS points `api.shop.com` at an **Azure Front Door** or **Application Gateway**. It ends the TLS connection and forwards the request to one of several running instances of your app. Those instances run in **Azure Container Apps**, as a container built from your **Dockerfile** and deployed by your **CI/CD pipeline**. There are several instances because the app is **stateless** and **scaled out**: any instance can handle any request. → [Cloud & Azure overview](ch:cloud-azure-overview), [Docker](ch:docker), [Azure compute](ch:azure-compute).

### 2. Runtime: a process is already running (layer 2)

Inside the container, `dotnet Shop.Api.dll` started earlier. The **CLR** loaded your assemblies. The **JIT** compiled each method to machine code the first time it ran. The **GC** manages every object you allocate, and the **thread pool** supplies the threads that do the work. → [How code runs](ch:how-code-runs), [Memory & GC](ch:memory-gc).

### 3. Framework: Kestrel and the host (layer 3)

**Kestrel**, ASP.NET Core's web server, reads the bytes off the socket and turns them into an **`HttpContext`**. The **Generic Host** that `Program.cs` built owns the **DI container**, **configuration** and **logging** for the whole app. For this one request, a new **DI scope** is created. → [Hosting](ch:aspnet-hosting), [Dependency injection](ch:dependency-injection), [Configuration](ch:configuration-options).

### 4. Framework: the middleware pipeline (layer 3)

The request walks through middleware, in the order you registered it:

```text
ExceptionHandler → HTTPS redirection → Routing → CORS → Authentication → Authorization
→ Rate limiting → (your custom middleware) → Endpoint
```

**Authentication** checks the JWT — its signature, issuer, audience and expiry — and fills in `HttpContext.User`. **Authorization** then checks the endpoint's policy, for example `RequireAuthorization("CanOrder")`. → [Middleware](ch:middleware), [Routing](ch:routing), [Auth](ch:auth), [OAuth & OIDC](ch:oauth-oidc-identity).

### 5. Framework: binding, validation, your endpoint (layers 1 + 3)

**Model binding** turns the request JSON into a `PlaceOrderRequest` record — an ordinary C# type (layer 1). **Validation** rejects bad input with a `400 ProblemDetails` response. If it passes, your **minimal API handler** or **controller action** runs, with its dependencies already injected. → [Building APIs](ch:building-apis), [Errors & logging](ch:errors-logging).

### 6. Architecture: your code's shape (layer 4)

The handler doesn't talk to SQL directly. It sends a `PlaceOrder` **command** to a **handler** (this is CQRS). That handler loads a `Customer` **aggregate** and calls `Order.Create(...)`, a **DDD** rich model that enforces rules like "an order needs at least one line". It returns a **Result** instead of throwing on failure. The project is structured as Domain / Application / Infrastructure / API, which is **Clean Architecture**, and its interfaces follow **SOLID**. → [Design principles](ch:design-principles), [App architectures](ch:app-architectures), [CQRS](ch:cqrs-mediator-result), [DDD](ch:ddd).

### 7. Language: async all the way down (layer 1)

Every I/O call is `await`ed with a `CancellationToken`. While the database does its work, the thread goes back to the pool and serves other requests instead of sitting idle. → [async/await](ch:async-await).

### 8. Data: EF Core and SQL (layer 5)

**EF Core** turns LINQ into SQL. The **`DbContext`**, scoped to this one request, tracks the new `Order`, and `SaveChangesAsync` writes it inside a **transaction**. In that same transaction, an `OrderPlaced` message is written to an **Outbox** table, so it can't be lost even if the next step fails. A product lookup earlier was served from **Redis** via `HybridCache` instead of hitting the database. → [EF Core](ch:efcore-fundamentals), [Querying](ch:efcore-querying), [Relational fundamentals](ch:relational-fundamentals), [NoSQL & Redis](ch:nosql-redis).

### 9. Communication: telling other services (layer 6)

A **background service** reads the outbox and publishes `OrderPlaced` to **Azure Service Bus**. The Payments service and the Email service each pick it up independently. Calls out to the external payment provider go through `HttpClient` wrapped in a **retry + circuit breaker** policy, so one flaky response doesn't take the whole request down. → [Messaging & events](ch:messaging-events), [Resilience](ch:resilience), [HttpClient](ch:http-client).

### 10. Response and observability (layers 3 + 8)

The handler returns `201 Created`, and the response travels **back out through the middleware, in reverse order**. Along the way, every step emitted **structured logs**, **metrics** and **trace spans** via **OpenTelemetry** — so in Application Insights you can see this one request traced across all three services. Finally the DI scope is disposed, which disposes the `DbContext` with it. → [Observability](ch:observability-aspire).

### 11. And before any of this happened (layer 8)

Before this code ever shipped, it passed **unit tests** (checking domain rules) and **integration tests** (the real pipeline plus a SQL container via Testcontainers) in CI, and was checked for **OWASP** issues. → [Unit testing](ch:unit-testing), [Integration testing](ch:integration-testing), [Web security](ch:web-security).

:::interview Use this in interviews
"Walk me through what happens when a request hits your API" is one of the most common senior .NET questions. The 11 steps above are a complete answer. Practise saying it in two minutes.
:::

## What belongs to what: the ecosystem by family {b}

The second source of confusion is product names. Microsoft ships many things with similar names. Here they are grouped by family, with the layer each lives in.

### The platform family (layer 2)

| Name | What it is |
|---|---|
| **.NET** (5, 6, 7, 8, 9, 10…) | The modern, cross-platform platform: runtime + libraries + SDK. |
| **.NET Framework** (4.x) | The old Windows-only platform. Still runs legacy apps. Not getting new features. |
| **.NET Core** (1.0–3.1) | The old name for modern .NET before version 5. |
| **.NET Standard** | A *specification* of APIs, used to write libraries that run on both Framework and modern .NET. |
| **CLR** | The runtime engine (JIT, GC, type system, threads). |
| **BCL** | Base Class Library: `System.*` types like `List<T>`, `HttpClient`, `Task`. |
| **SDK / `dotnet` CLI** | Build tools: compiler (Roslyn), MSBuild, templates. |
| **NuGet** | The package manager and package format. |
| **Mono / Xamarin** | Older cross-platform runtime used for mobile; merged into modern .NET. |

### The web family (layer 3)

| Name | What it is | Use it for |
|---|---|---|
| **ASP.NET Core** | The web framework (the umbrella) | Everything web |
| ↳ **Minimal APIs** | Lightweight HTTP endpoints as functions | JSON APIs, microservices |
| ↳ **MVC / Web API controllers** | Class-based endpoints | JSON APIs in larger/traditional codebases |
| ↳ **Razor Pages** | Page-focused server-rendered HTML | Server-rendered web apps |
| ↳ **Blazor** | C# UI components running on the server or in the browser (WebAssembly) | Interactive web UIs without JavaScript |
| ↳ **SignalR** | Real-time push over WebSockets | Chat, live dashboards |
| ↳ **gRPC** | High-performance binary RPC over HTTP/2 | Service-to-service calls |
| **Kestrel** | The web server inside ASP.NET Core | Always there |
| **ASP.NET** (no "Core") | The old Framework-only web stack (`System.Web`, Web Forms, MVC 5) | Legacy only |
| **YARP** | A reverse proxy library built on ASP.NET Core | API gateways |

### The data family (layer 5)

| Name | What it is |
|---|---|
| **ADO.NET** | The low-level DB access API (`DbConnection`, `DbCommand`). Everything else is built on it. |
| **EF Core** | The full ORM: LINQ to SQL, change tracking, migrations. |
| **Entity Framework 6** | The old ORM for .NET Framework. |
| **Dapper** | A micro-ORM: you write SQL, it maps results to objects. |
| **Microsoft.Data.SqlClient / Npgsql** | The ADO.NET drivers for SQL Server / PostgreSQL. |

### The "Microsoft.Extensions" family: the glue (layer 3)

These packages are the plumbing that ASP.NET Core, worker services and even console apps share. Recognising this family resolves a lot of confusion: **DI, configuration, logging, options and hosting are not ASP.NET Core features. They are general .NET libraries that ASP.NET Core uses.**

| Package family | Provides |
|---|---|
| `Microsoft.Extensions.DependencyInjection` | The DI container (`IServiceCollection`, `IServiceProvider`) |
| `Microsoft.Extensions.Configuration` | Layered configuration (`IConfiguration`) |
| `Microsoft.Extensions.Options` | `IOptions<T>`, validation |
| `Microsoft.Extensions.Logging` | `ILogger<T>` |
| `Microsoft.Extensions.Hosting` | The Generic Host, `IHostedService`, `BackgroundService` |
| `Microsoft.Extensions.Http` | `IHttpClientFactory` |
| `Microsoft.Extensions.Caching.*` | `IMemoryCache`, `IDistributedCache`, `HybridCache` |
| `Microsoft.Extensions.Resilience` | Polly-based resilience pipelines |

### The cloud family (layer 7)

| Need | Azure service |
|---|---|
| Run a web app/API | App Service, Container Apps, AKS, Functions |
| Relational DB | Azure SQL Database, Azure Database for PostgreSQL |
| Document DB | Cosmos DB |
| Files/blobs | Blob Storage |
| Cache | Azure Managed Redis |
| Messaging | Service Bus (commands), Event Grid (event routing), Event Hubs (streams) |
| Secrets | Key Vault |
| Identity | Microsoft Entra ID (formerly Azure AD), managed identities |
| Monitoring | Azure Monitor / Application Insights |
| Gateway | API Management, Front Door, Application Gateway |

## The vocabulary every chapter assumes {b}

Short definitions so no chapter surprises you. Each one is covered in depth later.

- **Assembly**: a compiled `.dll` (or `.exe`): IL code plus metadata. The unit you deploy and reference.
- **Namespace**: a naming scope (`System.Collections.Generic`). Has nothing to do with files or assemblies.
- **IL**: Intermediate Language, the CPU-independent bytecode C# compiles to.
- **JIT**: the compiler inside the runtime that turns IL into machine code at runtime.
- **GC**: the garbage collector, which frees memory you no longer reference.
- **Managed code**: code running under the CLR (memory managed for you).
- **Task**: an object representing work that completes later; the basis of `async`/`await`.
- **DI container**: the object that creates your classes and passes in their dependencies.
- **Lifetime**: how long the container keeps an instance: transient, scoped or singleton.
- **Middleware**: a component in the request pipeline that can act before and after the next one.
- **Endpoint**: the final handler for a route (a controller action or a minimal API delegate).
- **DTO**: Data Transfer Object, a simple type used to move data across a boundary (HTTP, messages).
- **Entity**: an object with identity that you persist (an `Order` with an `Id`).
- **ORM**: Object-Relational Mapper (EF Core): maps objects to tables.
- **Migration**: a versioned, code-generated change to the database schema.
- **Idempotent**: doing it twice has the same effect as doing it once.
- **Eventual consistency**: data in different places will agree *eventually*, not instantly.
- **Stateless**: no request depends on memory held by one specific server instance.

## How to read this book {b}

1. **First pass: breadth.** Read every chapter's Beginner sections, plus the "Where this fits" box. Skip Advanced sections. The goal is a complete, shallow map in your head.
2. **Second pass: depth where interviews go.** The most-asked areas for .NET backend roles are, in order: **C# fundamentals and async**, **DI lifetimes**, **middleware and the request pipeline**, **EF Core performance**, **SOLID and patterns**, **REST API design**, **authentication with JWT**, **testing**, then **cloud and distributed systems** for senior roles.
3. **Third pass: Advanced sections and internals.** GC, async state machines, threading, Kubernetes, sagas.
4. **Every day: the question bank.** Use drill mode. Say answers out loud before revealing them. If you can't explain it simply, go back to the linked section.

Each section heading has a level chip:

- **Beginner**: vocabulary and core usage. Expected of every candidate.
- **Intermediate**: how it works and how to use it well. Expected with 2+ years of experience.
- **Advanced**: internals, trade-offs and edge cases. Senior and lead interviews.

:::qa What is the difference between .NET, .NET Framework, .NET Core and ASP.NET Core?
.NET Framework is the original Windows-only platform. .NET Core was its cross-platform rewrite; from version 5 it is simply called ".NET" and is the current platform. ASP.NET Core is the web framework that runs on .NET (layer 3), not a platform itself.
:::

:::qa Are dependency injection, configuration and logging part of ASP.NET Core?
They are used by ASP.NET Core, but they live in the general-purpose `Microsoft.Extensions.*` libraries and work in any .NET app: worker services, console apps, Azure Functions. ASP.NET Core's `WebApplication.CreateBuilder` simply wires them up for you.
:::

:::qa Walk me through what happens when an HTTP request reaches a .NET API.
Infrastructure (load balancer/gateway) forwards it to an instance; Kestrel parses it into an HttpContext and a DI scope is created; it passes through middleware in order (exception handling, HTTPS, routing, CORS, authentication, authorization, rate limiting); the endpoint runs (model binding, validation, filters, handler); the handler calls application/domain code and EF Core asynchronously; the result is serialized; the response flows back out through the middleware; the scope is disposed. Logs, metrics and traces are emitted throughout.
:::

:::qa What is the difference between a DI "service" and a microservice?
A DI service is any class registered in the dependency injection container in one process. A microservice is a separately deployable application with its own data, communicating over the network. They share a word and nothing else.
:::

## Further reading

- [.NET architecture overview](https://learn.microsoft.com/en-us/dotnet/architecture/) — Microsoft's own layered view of the platform, close to the map used here.
- [ASP.NET Core fundamentals](https://learn.microsoft.com/en-us/aspnet-core/fundamentals/) — the canonical source for the middleware pipeline order shown in step 4 of the request trace.
- [.NET and .NET Framework — what's the difference](https://learn.microsoft.com/en-us/dotnet/standard/choosing-core-framework-server) — backs the ".NET vs .NET Framework vs .NET Core" claims in the platform family table.

## Verify this chapter

Most claims here are about *names and layers*, not runtime behaviour, so there's little to assert about infrastructure or cloud pieces — trust [Further reading](#further-reading) for those. What *is* checkable locally: that managed code really runs under the CLR, that a `Task` really represents work completing later, and that the GC really reclaims unreachable objects. Run with `dotnet run` (plain console app, .NET 8/9, no extra packages).

```csharp
// Claim: "Managed code" runs under the CLR, which reports its own runtime version.
var asm = System.Reflection.Assembly.GetExecutingAssembly();
if (string.IsNullOrEmpty(asm.ImageRuntimeVersion))
    throw new Exception("FAIL: no CLR runtime version reported — not managed code?");
Console.WriteLine($"OK: running under CLR {asm.ImageRuntimeVersion} (managed code)");

// Claim: a Task represents work that completes later, not immediately.
Task<int> slow = SlowlyComputeAsync();
if (slow.IsCompleted)
    throw new Exception("FAIL: task completed synchronously, can't demonstrate 'completes later'");
Console.WriteLine("OK: Task is pending immediately after starting (completes later)");
int result = await slow;
if (!slow.IsCompletedSuccessfully || result != 42)
    throw new Exception("FAIL: task did not complete successfully with the expected result");
Console.WriteLine("OK: awaited Task completed successfully with result 42");

// Claim: the GC frees memory you no longer reference.
var weak = AllocateAndDrop();          // helper method so the object is truly out of scope
GC.Collect(2, GCCollectionMode.Forced, blocking: true);
GC.WaitForPendingFinalizers();
GC.Collect(2, GCCollectionMode.Forced, blocking: true);
if (weak.IsAlive)
    throw new Exception("FAIL: unreferenced object was not collected");
Console.WriteLine("OK: GC reclaimed the unreferenced object");

static WeakReference AllocateAndDrop()
{
    object obj = new byte[1_000_000];
    return new WeakReference(obj);
}

// Claim: "idempotent" = doing it twice has the same effect as doing it once.
var set = new HashSet<int>();
set.Add(5); set.Add(5);
if (set.Count != 1)
    throw new Exception("FAIL: HashSet.Add was not idempotent in this check");
Console.WriteLine("OK: adding the same item twice to a set is idempotent (count stays 1)");

static async Task<int> SlowlyComputeAsync()
{
    await Task.Delay(50);
    return 42;
}

// Not runtime-verifiable here — see Further reading:
// - exact middleware execution order (needs a real ASP.NET Core host)
// - JIT compiling IL to machine code on first call (observable via profilers, not plain code)
// - cloud/infra claims (Front Door, Container Apps, Service Bus, Key Vault, etc.)
```
