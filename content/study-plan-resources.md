---
id: study-plan-resources
title: Study Plan, Practice Projects and Resources
summary: Turning this book into interview readiness. An eight-week study plan, how to study (active recall, the question bank, explain-it-back), practice projects that exercise every layer, a self-assessment checklist per level, the books and resources this guide draws on, and how to answer interview questions well.
layer: cross
where: Interview preparation › Study plan & resources
fits: This is the companion to [The Big Picture](ch:big-picture). That chapter gives you the map; this one gives you a route through it, plus the books and courses for going deeper than any single guide can.
levels: b,i,a
prereqs: big-picture
---

## TL;DR

- Rereading feels like learning but mostly tests recognition, not recall — **active recall** (explain it without looking) and **spaced repetition** actually stick.
- Follow the **eight-week plan** roughly in order; the order matters more than the exact pace.
- Build **one practice project** ("Shop") that exercises every layer — a bug you actually debugged beats a definition recited from memory in an interview.
- Use the **self-assessment checklist** to know what "Beginner/Intermediate/Advanced" actually means for each topic.
- Answer interview questions with a structure: **definition → why it exists → how it works → trade-offs → your own experience.**

## How to study (so it sticks) {b}

Reading isn't learning, and it's worth being honest with yourself about why: recognising an explanation when you reread it feels like understanding, but it tests recognition, not recall — the exact skill an interview actually demands. These techniques are backed by learning research and work especially well for interview preparation:

| Technique | How to apply it here |
|---|---|
| **Active recall** | After each section, close the page and explain it out loud or on paper. Use the **Question bank** in drill mode and **answer before revealing** |
| **Spaced repetition** | Revisit the drill for each part after 1 day, 3 days, 1 week, 2 weeks. Re-drill questions you got wrong more often |
| **Feynman technique** | Explain a concept as if to a junior developer. Where you hesitate or use jargon you can't unpack, that's the gap: go back to the section |
| **Interleaving** | Mix topics in drills ("All parts" mode) instead of doing one chapter at a time; interviews jump between topics |
| **Build things** | Implement each concept in a small project. Writing middleware or an outbox once beats reading about it five times |
| **Map placement** | For every new term, say which of the 8 layers it lives in and what it connects to. This is the "light bulb" habit |

## An eight-week plan {b}

Around 1–2 hours on weekdays, plus a longer weekend session for the project. Adjust to your timeline; the **order** matters more than the pace.

| Week | Read (Beginner + Intermediate sections first) | Build | Drill |
|---|---|---|---|
| **1** | [Big Picture](ch:big-picture), Part I (platform), [Type system](ch:type-system), [OOP](ch:oop), [Generics](ch:generics) | Console app exploring value vs reference types, boxing, records; look at IL in SharpLab | Part 0–II |
| **2** | [Delegates](ch:delegates-events), [Collections](ch:collections), [LINQ](ch:linq), [Exceptions](ch:exceptions-disposal), [async/await](ch:async-await), [Modern C#](ch:modern-csharp) | Re-implement `Where`/`Select` with `yield`; write an async fan-out with `WhenAll` + cancellation | Part II |
| **3** | [Hosting](ch:aspnet-hosting), [DI](ch:dependency-injection), [Configuration](ch:configuration-options), [Middleware](ch:middleware), [Routing](ch:routing), [Building APIs](ch:building-apis) | Start the **practice API** (below): minimal APIs, DI lifetimes demo, custom middleware, options with validation | Part III (first half) |
| **4** | [Errors & logging](ch:errors-logging), [Auth](ch:auth), [HttpClient](ch:http-client), [Caching/rate limiting/CORS](ch:caching-ratelimit-cors), [Background work](ch:background-work), [API design](ch:api-design) | Add ProblemDetails, JWT auth with policies, a typed HttpClient with resilience, HybridCache, rate limiting, a BackgroundService with Channel | Part III |
| **5** | Part IV: [Relational fundamentals](ch:relational-fundamentals), [EF Core](ch:efcore-fundamentals), [Querying](ch:efcore-querying), [Advanced](ch:efcore-advanced), [Dapper](ch:ado-dapper), [NoSQL & Redis](ch:nosql-redis) | EF Core with migrations; reproduce and fix an N+1; optimistic concurrency; a Dapper read model; Redis cache | Part IV |
| **6** | Part V: [Principles](ch:design-principles), [Patterns](ch:design-patterns), [Architectures](ch:app-architectures), [CQRS & Result](ch:cqrs-mediator-result), [DDD](ch:ddd), Part VI: [testing](ch:unit-testing) | Refactor the API into Clean Architecture or vertical slices; rich domain model; Result pattern; unit tests + integration tests with Testcontainers | Parts V–VI |
| **7** | Part VII: [Messaging](ch:messaging-events), [Resilience](ch:resilience), [Observability & Aspire](ch:observability-aspire), [Microservices](ch:microservices); Part VIII: [Cloud](ch:cloud-azure-overview), [Docker](ch:docker) | Add an Aspire AppHost, a worker service, RabbitMQ/Service Bus emulator + outbox, OpenTelemetry; containerise | Parts VII–VIII |
| **8** | [Azure compute](ch:azure-compute), [Azure data](ch:azure-data-messaging), [Identity & secrets](ch:azure-identity-secrets), [CI/CD & IaC](ch:cicd-iac), [Kubernetes](ch:kubernetes), Part IX, Part X, [System design](ch:system-design) | GitHub Actions pipeline; deploy to Azure Container Apps with managed identity + Key Vault (azd/Bicep); load test with k6 | Everything, mixed. Do two mock system-design sessions |

**Then:** go back through every **Advanced** section, and keep drilling daily (15 minutes) until the interview.

## The practice project: one app, every layer {i}

Build a small but complete **"Shop" backend**. Each feature exercises specific chapters, and together they give you real stories to tell in interviews ("When I implemented the outbox, I ran into…") — which matters more than it sounds, because a concrete bug you actually debugged is a far more convincing answer than a correct definition recited from memory.

| Feature | Exercises |
|---|---|
| Products & categories CRUD with paging, filtering, sorting | Minimal APIs, routing groups, validation, EF Core, projections, indexes, API design |
| Cart (Redis) and checkout | Redis, HybridCache, idempotency keys, Result pattern, domain model with invariants |
| Orders with status lifecycle | DDD aggregate, State pattern / transitions, optimistic concurrency (ETags) |
| Auth: customers and admins | JWT bearer (Entra ID or a local dev IdP), policies, resource-based authorization (own orders only) |
| `OrderPlaced` → email + stock update | Outbox, Service Bus/RabbitMQ (MassTransit or Wolverine), idempotent consumers, worker service |
| Calls to a fake payment API | Typed HttpClient, resilience handler, WireMock in tests |
| Nightly cleanup of stale carts | BackgroundService + PeriodicTimer, or Hangfire |
| Observability | OpenTelemetry traces across API → broker → worker, custom metrics, Aspire dashboard |
| Tests | Unit tests for the domain, integration tests with WebApplicationFactory + Testcontainers + Respawn, an architecture test |
| Delivery | Dockerfile (multi-stage, chiseled), GitHub Actions CI, deploy to Azure Container Apps with Bicep/azd, managed identity to Azure SQL + Key Vault |
| Performance | BenchmarkDotNet for one hot method; k6 load test; fix one measured bottleneck |

Microsoft's **eShop** reference application (github.com/dotnet/eShop) is a good model to compare against once you've built your own.

## Self-assessment checklist {i}

### Beginner: can you explain these clearly in 1–2 minutes each?

- [ ] .NET vs .NET Framework vs .NET Core; SDK vs runtime; what the CLR, JIT and IL are
- [ ] Value vs reference types; struct vs class vs record; boxing
- [ ] The four OOP pillars; interface vs abstract class; access modifiers
- [ ] `List`, `Dictionary`, `HashSet` and their Big-O; `IEnumerable` vs `IList`
- [ ] LINQ basics and **deferred execution**; `IEnumerable` vs `IQueryable`
- [ ] Exceptions: `throw` vs `throw ex`; `using` and `IDisposable`
- [ ] What `async`/`await` does and why not to use `.Result`
- [ ] The two phases of Program.cs; what Kestrel is
- [ ] **DI lifetimes** (transient/scoped/singleton) and the captive dependency
- [ ] Configuration precedence; the Options pattern
- [ ] **Middleware**: what it is, the pipeline, **order** of the standard middleware
- [ ] Minimal APIs vs controllers; model binding; validation
- [ ] HTTP methods, status codes, idempotency; 401 vs 403
- [ ] Authentication vs authorization; what a JWT contains
- [ ] SQL joins, indexes, transactions (ACID)
- [ ] EF Core: DbContext lifetime, migrations, tracking
- [ ] SOLID with examples
- [ ] Unit vs integration tests; mocks vs stubs
- [ ] IaaS/PaaS/serverless; what a container is

### Intermediate: can you explain, use and compare?

- [ ] Generics, constraints and variance; delegates, closures and events
- [ ] async concurrency (`WhenAll`), cancellation, `ConfigureAwait`, `ValueTask`
- [ ] Writing custom middleware; middleware vs filters; endpoint filters
- [ ] ProblemDetails and `IExceptionHandler`; structured logging
- [ ] Policy-based and resource-based authorization; cookies vs JWT
- [ ] `IHttpClientFactory` (why); resilience strategies
- [ ] Caching layers and strategies; stampedes; rate-limiting algorithms; CORS preflight
- [ ] Hosted services, Channels; running a job once across replicas
- [ ] N+1, projections, `AsNoTracking`, split queries; clustered vs non-clustered indexes; isolation levels
- [ ] EF Core vs Dapper; optimistic concurrency
- [ ] GoF patterns you've used (Strategy, Decorator, Factory, Observer, Chain of Responsibility)
- [ ] Clean Architecture vs vertical slices; repository debate; CQRS; Result pattern
- [ ] Messaging: queues vs topics, commands vs events, outbox, idempotent consumers
- [ ] Observability: logs vs metrics vs traces; OpenTelemetry
- [ ] Docker multi-stage builds; App Service vs Container Apps vs Functions vs AKS; managed identity
- [ ] CI/CD pipeline stages; blue/green vs canary; IaC

### Advanced: can you go deep and discuss trade-offs?

- [ ] JIT tiering and PGO; Native AOT trade-offs; source generators vs reflection
- [ ] async state machine internals; SynchronizationContext deadlocks; thread-pool starvation diagnosis
- [ ] GC generations, LOH, server GC/DATAS; diagnosing memory leaks (`gcroot`)
- [ ] Threading primitives, deadlocks, memory model; thread-safe singletons
- [ ] `Span<T>`/`Memory<T>`, pooling, allocation-free code
- [ ] The full request lifecycle in detail; endpoint routing internals
- [ ] DDD aggregates and boundaries; domain vs integration events
- [ ] Sagas (orchestration vs choreography); ordering; exactly-once myths; event sourcing
- [ ] Microservices boundaries, data ownership, strangler fig; distributed monolith
- [ ] Cosmos DB partitioning; CAP/PACELC; Service Bus vs Event Grid vs Event Hubs
- [ ] OAuth/OIDC flows (code + PKCE, client credentials, OBO), token validation, BFF
- [ ] OWASP risks and .NET mitigations (IDOR, SSRF, mass assignment)
- [ ] Performance methodology and tools; percentiles; load testing
- [ ] Kubernetes probes, resources, autoscaling; zero-downtime deploys and DB migrations
- [ ] Full system design of an e-commerce checkout or a URL shortener

## Answering interview questions well {i}

A reliable structure for technical questions: **definition → why it exists → how it works / example → trade-offs or pitfalls → your experience.**

> **Q: What's the difference between scoped and singleton services?**
> *Definition:* "Singleton means one instance for the app's lifetime; scoped means one per scope, which in ASP.NET Core is one per HTTP request." *Why:* "Lifetimes match how long state should live and whether it can be shared across threads." *Example:* "DbContext is scoped because it isn't thread-safe and tracks per-request changes; an HttpClient handler or a cache is singleton." *Pitfall:* "A singleton depending on a scoped service creates a captive dependency, a classic bug; scope validation catches it in Development, and the fix is IServiceScopeFactory." *Experience:* "I hit this when a background service injected a DbContext directly…"

More tips:

- **Say "it depends", then say on what.** Then pick one and justify it.
- **Use the right vocabulary** (captive dependency, deferred execution, idempotent, outbox, N+1): it signals depth.
- **Admit gaps honestly**, then reason from first principles: "I haven't used Event Hubs in production, but since it's a partitioned log like Kafka, I'd expect…"
- **Draw** for anything with more than two moving parts: pipelines, request flows, architectures.
- **Prepare 5–6 stories** (STAR: Situation, Task, Action, Result) about bugs you fixed, performance you improved, designs you chose, and incidents you handled. Tie them to topics in this book.
- **Ask clarifying questions** in design and coding exercises before you start.

## Books this guide draws on {b}

The structure and depth of this guide follow the standard references. Read these for more than any single guide can give you:

| Area | Books |
|---|---|
| C# & runtime | *C# in Depth* (Jon Skeet) · *CLR via C#* (Jeffrey Richter, the classic runtime book, Framework era) · *C# 12 in a Nutshell* (Joseph Albahari) · *Pro .NET Memory Management* (Konrad Kokosa) · *Writing High-Performance .NET Code* (Ben Watson) · *Concurrency in C# Cookbook* (Stephen Cleary) |
| ASP.NET Core | ***ASP.NET Core in Action*, 3rd ed. (Andrew Lock): the best single book for Part III** · *Pro ASP.NET Core* (Adam Freeman) |
| Data | *Entity Framework Core in Action* (Jon P Smith) · *Designing Data-Intensive Applications* (Martin Kleppmann) · *SQL Performance Explained* / use-the-index-luke.com (Markus Winand) |
| Design & architecture | *Clean Architecture* and *Clean Code* (Robert C. Martin) · *Design Patterns* (GoF) · *Head First Design Patterns* · *Patterns of Enterprise Application Architecture* (Fowler) · *Dependency Injection Principles, Practices, and Patterns* (van Deursen & Seemann) · *Refactoring* (Fowler) |
| DDD | *Domain-Driven Design* (Eric Evans) · *Implementing Domain-Driven Design* (Vaughn Vernon) · *Learning Domain-Driven Design* (Vlad Khononov) |
| Distributed systems | *Building Microservices* and *Monolith to Microservices* (Sam Newman) · *Enterprise Integration Patterns* (Hohpe & Woolf) · *Release It!* (Michael Nygard) |
| Testing | *Unit Testing Principles, Practices, and Patterns* (Vladimir Khorikov) · *The Art of Unit Testing* (Roy Osherove) |
| Delivery & operations | *Accelerate* (Forsgren, Humble, Kim) · *Continuous Delivery* (Humble & Farley) · *Site Reliability Engineering* (Google, free online) · *Kubernetes Up & Running* |
| Interviews | *System Design Interview* Vol. 1–2 (Alex Xu) |

## Free resources {b}

| Resource | Use |
|---|---|
| **Microsoft Learn** (learn.microsoft.com/dotnet, /aspnet/core, /ef/core, /azure) | The authoritative docs every chapter links to; also free learning paths |
| **Free Microsoft eBooks** | *.NET Microservices: Architecture for Containerized .NET Applications*, *Architecting Modern Web Applications with ASP.NET Core and Azure*, *Cloud-native .NET* |
| **.NET Blog** (devblogs.microsoft.com/dotnet) | Release notes; Stephen Toub's performance posts; deep dives |
| **Andrew Lock's blog** (andrewlock.net) | ASP.NET Core internals, explained brilliantly |
| **Milan Jovanović**, **Nick Chapsas**, **Steve "Ardalis" Smith**, **Jimmy Bogard**, **Khalid Abuhakmeh**, **Code Opinion (Derek Comartin)** | Practical .NET architecture articles and videos |
| **dotnet/eShop**, **Clean Architecture templates** (Jason Taylor, Ardalis) | Reference code |
| **SharpLab.io** | See IL, JIT asm and lowered C# for any snippet |
| **OWASP Cheat Sheet Series** | Security how-tos |
| **Azure Architecture Center** | Reference architectures, cloud design patterns |
| **AZ-204 learning path** | Structured Azure developer curriculum (certification optional) |
| **Exercism C# track**, **LeetCode** (for algorithm rounds) | Practice |

## Keeping this guide up to date {b}

.NET ships every November. When a new version arrives, check the **"What's new in .NET / C# / ASP.NET Core / EF Core"** pages on Microsoft Learn, then update the relevant chapters. The site is generated from Markdown files in `content/`: edit a chapter, run `node tools/build.mjs`, and refresh.

:::qa How should I prepare for a .NET backend interview in the last week?
Drill the question bank daily in mixed mode, answering out loud before revealing. Re-read the Beginner sections of DI, middleware, async/await, EF Core querying and API design (the most-asked topics). Rehearse the request-lifecycle walkthrough and two system designs out loud. Prepare 5–6 STAR stories from your work or practice project. Review the job description's specific technologies (e.g. Service Bus, AKS) in their chapters.
:::

:::qa How do you answer a question you don't fully know?
Be honest about the gap, connect it to what you do know, and reason from first principles out loud, e.g. "I haven't used X directly, but it's a partitioned log like Kafka, so I'd expect ordering per partition and consumers tracking offsets." Interviewers value structured reasoning and honesty over bluffing.
:::

## Further reading

- [.NET documentation hub](https://learn.microsoft.com/en-us/dotnet/)
- [ASP.NET Core documentation](https://learn.microsoft.com/en-us/aspnet/core/)
- [.NET architecture guides (free eBooks)](https://dotnet.microsoft.com/en-us/learn/dotnet/architecture-guides)
- [Exam AZ-204: Developing Solutions for Microsoft Azure](https://learn.microsoft.com/en-us/credentials/certifications/azure-developer/)

## Verify this chapter

This chapter is mostly study advice and a reading list, which isn't something code can verify. One concrete, checkable claim it does make — in the sample interview answer about scoped vs singleton services — is that a singleton capturing a scoped dependency ("captive dependency") is a real bug, and that DI's scope validation catches it. Run with `dotnet new console -o studyplancheck && cd studyplancheck && dotnet add package Microsoft.Extensions.DependencyInjection`, replace `Program.cs`, then `dotnet run`:

```csharp
using Microsoft.Extensions.DependencyInjection;

// Reproduces the "captive dependency" bug from the sample interview answer above, with real DI.

var services = new ServiceCollection();
services.AddScoped<IScopedThing, ScopedThing>();
services.AddSingleton<SingletonCaptor>();

// With scope validation ON (the default in ASP.NET Core's "Development" environment),
// resolving a singleton that captures a scoped service throws immediately.
using var providerWithValidation = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true });
bool threw = false;
try { providerWithValidation.GetRequiredService<SingletonCaptor>(); }
catch (InvalidOperationException) { threw = true; }
if (!threw) throw new Exception("FAIL: expected ValidateScopes=true to catch the captive dependency");
Console.WriteLine("OK: a singleton capturing a scoped service throws InvalidOperationException when ValidateScopes=true, confirming the captive-dependency claim.");

// Without validation, it silently succeeds — but the "scoped" instance is captured forever,
// defeating the whole point of a per-request lifetime.
using var providerNoValidation = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = false });
var captor1 = providerNoValidation.GetRequiredService<SingletonCaptor>();
using (var scope = providerNoValidation.CreateScope())
{
    var scopedHere = scope.ServiceProvider.GetRequiredService<IScopedThing>();
    if (captor1.Scoped.Id == scopedHere.Id)
        throw new Exception("FAIL: expected the captured instance to differ from a freshly-scoped instance");
}
Console.WriteLine("OK: without validation, the singleton silently keeps the first scoped instance forever instead of getting a fresh one per scope — the real-world bug behind the interview answer.");

Console.WriteLine("All runtime-checkable claims verified.");

public interface IScopedThing { Guid Id { get; } }
public sealed class ScopedThing : IScopedThing { public Guid Id { get; } = Guid.NewGuid(); }
public sealed class SingletonCaptor(IScopedThing scoped) { public IScopedThing Scoped { get; } = scoped; }
```

Everything else in this chapter (the study schedule, book recommendations, interview-answer structure) is advice, not a falsifiable technical claim — treat the book/resource list's descriptions as this author's opinion, not something to fact-check, and go to the linked sources for anything you want to verify directly.
