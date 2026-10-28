---
id: microservices
title: Monoliths, Microservices and Distributed Architecture
summary: When and how to split a system. Monolith vs modular monolith vs microservices, the real costs of distribution, finding service boundaries, data ownership, synchronous vs asynchronous communication, API gateways and BFFs, service discovery, migration with the strangler fig, distributed monolith anti-patterns, and what you need operationally before going distributed.
layer: arch
where: Application architecture › System decomposition
fits: This is the top of layer 4, where architecture becomes **deployment topology**. Boundaries come from DDD's bounded contexts ([DDD](ch:ddd)); communication is layer 6 ([API design](ch:api-design), [Messaging & events](ch:messaging-events), [Resilience](ch:resilience)); and running many services needs layer 7 ([Docker](ch:docker), [Kubernetes](ch:kubernetes), [CI/CD](ch:cicd-iac)) plus layer 8 observability ([Observability & Aspire](ch:observability-aspire)).
levels: b,i,a
prereqs: app-architectures, ddd
next: messaging-events, resilience, observability-aspire
---

## TL;DR

- A monolith, a modular monolith, and microservices are points on one spectrum of coupling vs operational cost — not "the bad old way" vs "the modern way."
- Microservices buy independent deployment, scaling and team autonomy, but every one of the "fallacies of distributed computing" (the network fails, calls are slow, there's no shared transaction) becomes something your code must handle.
- Good service boundaries follow bounded contexts/business capabilities, not technical layers or single entities — and each service owns its own data.
- Querying across services means API composition, local replicas fed by events, or a CQRS-style read model — never a cross-service join.
- Prefer asynchronous events between services; a chain of synchronous calls multiplies latency and failure probability — four 99.9%-available services chained together are only ~99.6% available as a whole.
- The most common real failure mode is the **distributed monolith**: all the costs of microservices, none of the independent-deployment benefit that was supposed to justify them.

## Three ways to structure a system, and the real spectrum between them {b}

| | Monolith | Modular monolith | Microservices |
|---|---|---|---|
| Deployable units | One | One | Many (one per service) |
| Internal boundaries | Often weak | **Strong** modules (per bounded context) | Enforced by the network |
| Data | One database | One database, **schema/ownership per module** | **Database per service** |
| Communication | In-process calls | In-process calls through module contracts, in-process events | Network: HTTP/gRPC, messages |
| Transactions | ACID across everything | ACID within a module; events across modules | **Local only**; sagas and eventual consistency across services |
| Scaling | Whole app | Whole app | Per service |
| Team autonomy | Low | Medium | High: independent release cycles |
| Operational complexity | Low | Low | **High** |

The modular monolith column, revisited from [App architectures](ch:app-architectures#the-modular-monolith-most-of-microservices-benefits-none-of-), is really the midpoint of this table — most of the boundary discipline of microservices, none of the network. A **monolith is not bad**. A *big ball of mud* is bad. Many successful products (Shopify, Stack Overflow, Basecamp) run well-structured monoliths at large scale.

## Why microservices, and what they genuinely cost {i}

**Benefits** (when they're real):

- **Independent deployment**: teams ship without coordinating a release train.
- **Independent scaling**: scale the search service to 50 instances and the admin service to 2.
- **Fault isolation**: a crash in recommendations doesn't take down checkout (if designed for it).
- **Technology freedom** per service (use carefully).
- **Team ownership** aligned with business capabilities (Conway's Law, Team Topologies).

**Costs**, sometimes called the **fallacies of distributed computing** ("the network is reliable, latency is zero, bandwidth is infinite…") — each one a comfortable assumption a monolith's in-process calls let you make for free, and a microservices architecture forces you to confront directly:

| Cost | What it means in practice |
|---|---|
| Network failures and latency | Every call can fail or be slow, so you need timeouts, retries, circuit breakers ([Resilience](ch:resilience)) |
| No distributed transactions | Eventual consistency, sagas, outbox, idempotency ([Messaging](ch:messaging-events)) |
| Data duplication and joins across services | Data is replicated via events; queries spanning services become API composition or read models |
| Observability | You need distributed tracing, centralised logs and correlation IDs ([Observability](ch:observability-aspire)) |
| Testing | Contract tests, environment management, harder end-to-end tests |
| Versioning | APIs and message schemas must evolve compatibly |
| Infrastructure & DevOps | Containers, orchestration, CI/CD per service, service discovery, secrets, gateways |
| Cognitive load | Many repos and pipelines, on-call across services |

(Two terms from the table above, covered in full in [Messaging & events](ch:messaging-events): a **saga** coordinates a multi-step process across services as a chain of local transactions, each with a compensating "undo" step if a later one fails; the **outbox** is the write-the-event-and-the-data-atomically trick briefly introduced in [Background work](ch:background-work).)

:::interview "Should we use microservices?"
A strong answer: "It depends on the problem, not the trend. Microservices solve **organisational scaling** (many teams needing independent deployments) and **uneven scaling** needs, at the cost of distributed-systems complexity. With one or two teams and an evolving domain, I'd start with a **modular monolith** with strict bounded-context modules, and extract a service only when a module has a clear reason: different scaling, a different release cadence, a different team, or isolation needs."
:::

## Finding service boundaries {i}

Bad boundaries are the most expensive microservices mistake there is: services that must change together, call each other constantly, or share data have paid the full cost of distribution while getting none of its benefits.

Good boundaries:

1. **Align with bounded contexts / business capabilities** (Ordering, Catalog, Payments, Shipping) — exactly the strategic DDD boundary from [DDD](ch:ddd#strategic-ddd-ubiquitous-language-and-bounded-contexts) — **not** technical layers ("the database service", "the validation service") and **not** entities ("the Customer service" that everyone calls for everything).
2. **High cohesion inside, low coupling outside**: most changes stay within one service.
3. **Owns its data and the rules over it.**
4. **Can do its main job when other services are down**, often by keeping a local copy of the data it needs, fed by events.
5. Fits a **team** (two-pizza team, stream-aligned team).

**Granularity:** start coarse. Splitting later is easier than merging chatty nano-services — a mistake in the "too big" direction is a refactor; a mistake in the "too small" direction is a rewrite of how dozens of services talk to each other.

## Data ownership: database per service {i}

Each service **owns its data exclusively**. Others access it **only through the service's API or events**, never by querying its tables directly.

```text
✘ Shared database                         ✔ Database per service
Ordering ─┐                               Ordering ── Orders DB
Billing  ─┼─▶ one DB, shared tables       Billing  ── Billing DB      ◀── OrderPlaced event ──  Ordering
Shipping ─┘   (schema change = 3 teams)   Shipping ── Shipping DB     (keeps its own copy of the address)
```

Why: a shared schema couples services at the deepest level there is. Any schema change can silently break a service that was never told about it, and nobody can safely refactor a table they don't fully own. That kills the one benefit — independent deployment — that was the whole reason to go distributed.

How to answer queries across services, now that a join across two services' tables is no longer an option:

| Technique | How |
|---|---|
| **API composition** | A gateway or BFF calls several services and combines the results (fine for small fan-out) |
| **Data replication via events** | Service keeps a local, read-only copy of the data it needs (Shipping stores customer addresses from `CustomerAddressChanged`) |
| **CQRS read model** | A dedicated query service builds a denormalised view from many services' events |

Notice the second row is really the CQRS "separate stores" level from [CQRS & Result](ch:cqrs-mediator-result#levels-of-cqrs-a-spectrum-not-a-binary-choice), applied across a service boundary rather than within one service — the same eventual-consistency tradeoff, just at a larger scale.

## Communication: synchronous vs asynchronous {i}

| | Synchronous (HTTP/REST, gRPC) | Asynchronous (messages/events via broker) |
|---|---|---|
| Coupling in time | Both must be up **now** | Producer and consumer are decoupled in time |
| Latency | Caller waits | Fire and continue |
| Failure behaviour | Failures cascade unless guarded | Broker buffers; consumers catch up |
| Consistency | Immediate answer | Eventual |
| Use for | Queries needing an immediate answer, user-facing reads, commands needing a sync response | State-change notifications, workflows, integration, fan-out, load levelling |

**Prefer asynchronous events for integration between services.** Here's the math behind why: a chain of synchronous calls (A → B → C → D) is only as available as all four links being up **at once**, and those probabilities multiply. Four services each healthy 99.9% of the time don't stay at 99.9% as a chain — they combine to 0.999⁴ ≈ 99.6%. That looks like a small drop, but it's about **4x** the expected downtime of any single service's own number — and it gets worse the longer the chain gets.

## API gateway, BFF and service mesh {a}

```text
Mobile app ─┐                  ┌──▶ Ordering service
Web SPA ────┼─▶ API Gateway ───┼──▶ Catalog service
Partners ───┘   (or a BFF per   └──▶ Payments service
                 client type)
```

| Component | Responsibilities | .NET / Azure options |
|---|---|---|
| **API gateway** | Single entry point: routing, TLS, authentication offload, rate limiting, caching, request aggregation, versioning | **YARP** (ASP.NET Core reverse proxy library), **Azure API Management**, Azure Front Door / Application Gateway, Ocelot (older) |
| **BFF** (Backend for Frontend) | A gateway tailored to one client type (mobile vs web), aggregating calls and shaping responses; for SPAs, also holds tokens (cookie-based BFF) | ASP.NET Core + YARP, Duende BFF |
| **Service mesh** | Infrastructure layer (sidecar proxies) for service-to-service **mTLS** (mutual TLS: each side proves its identity with a certificate, not just the server), retries, traffic splitting, telemetry | Istio, Linkerd, Dapr (sidecar runtime with building blocks), Container Apps' built-in features |

The BFF row connects directly back to a decision from [Auth](ch:auth#cookies-vs-bearer-tokens-the-tradeoff-behind-how-do-i-stay-l): it's the same cookie-holding server-side component recommended there for SPAs, now framed as a specific flavour of gateway rather than purely an auth concern.

```csharp
// YARP gateway in a few lines
builder.Services.AddReverseProxy().LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));
app.MapReverseProxy();
// appsettings: Routes { "orders": { ClusterId: "ordering", Match: { Path: "/api/orders/{**rest}" } } }
//              Clusters { "ordering": { Destinations: { "d1": { Address: "http://ordering" } } } }
```

## Service discovery and configuration {a}

Services shouldn't hard-code each other's addresses, for exactly the stale-DNS reason [Calling other services](ch:http-client#the-two-classic-bugs-and-why-theyre-opposite-mistakes) raised for outbound HTTP clients, now at the scale of an entire topology that reshapes itself as instances come and go:

- **Platform DNS**: Kubernetes Services (`http://ordering.shop.svc.cluster.local`), Container Apps internal ingress names.
- **.NET service discovery** (`Microsoft.Extensions.ServiceDiscovery`, used by Aspire): `https+http://ordering` is resolved from configuration or DNS.
- **Central configuration**: Azure App Configuration, Key Vault, Kubernetes ConfigMaps/Secrets.

## Migrating a monolith: the strangler fig {a}

Rewriting everything at once ("big bang") is notoriously risky — all the business value sits behind one giant, unshippable cutover for months, with no way to validate pieces of it along the way. The **strangler fig pattern** (Martin Fowler) **incrementally replaces** pieces instead, so each step ships and proves itself independently:

```text
1. Put a proxy/gateway (YARP) in front of the monolith; all traffic flows through it.
2. Pick one capability with clear boundaries (e.g. product search).
3. Build it as a new service; route /search/* to it via the proxy.
4. Sync data (events/CDC) while both exist; then remove the code from the monolith.
5. Repeat. The monolith shrinks until it can be retired, or stays as a well-defined core.
```

Supporting patterns: **anti-corruption layer** (translate between the old and new models, the same DDD pattern from [DDD](ch:ddd#strategic-ddd-ubiquitous-language-and-bounded-contexts)), **change data capture** (stream database changes, e.g. Debezium or SQL Server CDC), **branch by abstraction**, and **feature flags** for switching traffic.

## Anti-patterns {i}

| Anti-pattern | Symptoms |
|---|---|
| **Distributed monolith** | Services must be deployed together; shared database; synchronous call chains; a change requires touching 5 services |
| **Nano-services** | A service per entity or function; every request fans out to 10 services |
| **Shared domain library** | A "Common.Domain" NuGet used by all services, coupling their models and release cycles (sharing *contracts* and *infrastructure helpers* is fine) |
| **Chatty synchronous chains** | Latency and availability collapse under load |
| **No observability** | Debugging takes hours of grepping logs across services |
| **Microservices first** | A new product, one team, unknown domain, and already 15 services |

The first row — the **distributed monolith** — is the most common real-world failure here. It means a team paid every cost from the table earlier (network failures, eventual consistency, DevOps overhead) and never actually got independent deployment, the one benefit that was supposed to justify paying them.

## Readiness checklist {a}

Before going distributed, you should have (or plan):

- [ ] Automated CI/CD per service, plus infrastructure as code ([CI/CD & IaC](ch:cicd-iac))
- [ ] Containerisation and an orchestrator or PaaS ([Docker](ch:docker), [Azure compute](ch:azure-compute))
- [ ] Centralised logging, metrics, **distributed tracing** with correlation ([Observability](ch:observability-aspire))
- [ ] Resilience defaults on every outbound call ([Resilience](ch:resilience))
- [ ] A message broker plus outbox/idempotency practices ([Messaging](ch:messaging-events))
- [ ] API versioning and contract tests ([API design](ch:api-design), [Testing](ch:integration-testing))
- [ ] Health checks, autoscaling, graceful shutdown
- [ ] Identity for service-to-service calls (managed identity, client credentials, mTLS)
- [ ] Clear ownership: who's on call for which service

:::qa What are the trade-offs between a monolith and microservices?
A monolith is simpler to develop, test, deploy and debug, with ACID transactions and fast in-process calls, but it scales and deploys as one unit and can become tightly coupled. Microservices allow independent deployment, scaling, fault isolation and team autonomy, but add network failure modes, eventual consistency, data duplication, observability and DevOps overhead, and versioning challenges.
:::

:::qa What is a modular monolith?
A single deployable application divided into strongly encapsulated modules aligned with bounded contexts, each owning its data and exposing explicit contracts. It provides most of the structural benefits of microservices without distributed-systems costs, and can be split later.
:::

:::qa How do you decide service boundaries?
Align them with bounded contexts and business capabilities (not technical layers or single entities), aiming for high cohesion and low coupling so most changes stay within one service. Each service should own its data and be able to function when others are down, and services should match team ownership. Start coarse-grained.
:::

:::qa Why should each microservice own its database?
A shared database couples services through the schema: changes break others, teams can't deploy or evolve independently, and boundaries erode. With database per service, data is accessed only via APIs or events, preserving autonomy and encapsulation.
:::

:::qa How do you query data that spans multiple services?
API composition (a gateway or BFF aggregates calls), local replicas of needed data maintained through events, or a dedicated CQRS read model built from multiple services' events, accepting eventual consistency.
:::

:::qa Sync vs async communication between microservices?
Synchronous HTTP/gRPC is for requests needing an immediate response, but it couples services in time and failures cascade. Asynchronous messaging decouples them in time, buffers load and isolates failures, at the cost of eventual consistency. Prefer async events for integration and minimise synchronous call chains.
:::

:::qa What is an API gateway and what is a BFF?
An API gateway is a single entry point that routes requests to services and handles cross-cutting concerns (TLS, auth, rate limiting, caching, aggregation), e.g. Azure API Management or YARP. A Backend-for-Frontend is a gateway specialised per client type (web, mobile) that tailors and aggregates APIs for it and, for SPAs, can hold tokens server-side.
:::

:::qa What is the strangler fig pattern?
Incrementally migrating a legacy system by routing traffic through a facade or proxy and replacing capabilities one at a time with new implementations, until the old system can be retired. It avoids a risky big-bang rewrite.
:::

:::qa What is a distributed monolith?
A system split into services that are still tightly coupled: a shared database, lockstep deployments, synchronous call chains, shared domain libraries. It has the costs of distribution and the rigidity of a monolith.
:::

## Further reading

- Sam Newman, *Building Microservices* (2nd ed.) and *Monolith to Microservices*.
- [.NET Microservices: Architecture for Containerized .NET Applications (free eBook)](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/)
- [Azure Architecture Center: microservices](https://learn.microsoft.com/en-us/azure/architecture/microservices/)
- Chris Richardson, [microservices.io](https://microservices.io) pattern language.
- [YARP documentation](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/yarp/getting-started)

## Verify this chapter

Run with `dotnet run` (plain console app, .NET 8/9, top-level statements, BCL only).

```csharp
// Claim: availability compounds as a product across a synchronous call chain.
// Four services each 99.9% available combine to roughly 99.9%^4 ≈ 99.6%, about 4x the downtime
// a single service's own number would suggest.
double perService = 0.999;
double chain = Math.Pow(perService, 4);
double singleDowntime = 1 - perService;
double chainDowntime = 1 - chain;
if (Math.Abs(chain - 0.996) > 0.0005) throw new Exception($"FAIL: expected chain availability ~0.996, got {chain:F6}");
double downtimeRatio = chainDowntime / singleDowntime;
if (downtimeRatio < 3.9 || downtimeRatio > 4.1) throw new Exception($"FAIL: expected ~4x the downtime for a 4-link chain, got {downtimeRatio:F2}x");
Console.WriteLine($"OK: a 4-service synchronous chain at 99.9% each is {chain:P2} available ({downtimeRatio:F1}x the single service's downtime)");

// Claim: database-per-service means other services can only see what was explicitly published,
// never another service's internal storage.
var ordering = new OrderingService();
var shipping = new ShippingService();
ordering.OrderPlaced += shipping.OnOrderPlaced; // integration happens via an event, not a shared table
ordering.PlaceOrder(orderId: 1, shipToAddress: "221B Baker St");
if (!shipping.HasLocalCopyOf(1)) throw new Exception("FAIL: shipping should have received its own copy of the data it needs");
if (shipping.HasLocalCopyOf(999)) throw new Exception("FAIL: shipping should not know about an order it was never told about");
Console.WriteLine("OK: services exchange data only through published events, each keeping its own local copy");

// Claim: a strangler fig proxy routes a chosen capability to the new service and leaves everything else on the monolith.
string RouteFor(string path) => path.StartsWith("/search/") ? "new-search-service" : "legacy-monolith";
if (RouteFor("/search/products") != "new-search-service") throw new Exception("FAIL: /search/* should route to the new service");
if (RouteFor("/orders/42") != "legacy-monolith") throw new Exception("FAIL: everything else should still route to the monolith");
Console.WriteLine("OK: a strangler fig proxy can migrate one capability (/search/*) while the rest keeps flowing to the monolith");

// --- supporting types for the data-ownership check above ---
sealed class OrderingService
{
    public event Action<int, string>? OrderPlaced;
    public void PlaceOrder(int orderId, string shipToAddress) => OrderPlaced?.Invoke(orderId, shipToAddress);
}

sealed class ShippingService
{
    private readonly Dictionary<int, string> _localAddressCopies = []; // Shipping's own DB, not Ordering's

    public void OnOrderPlaced(int orderId, string shipToAddress) => _localAddressCopies[orderId] = shipToAddress;
    public bool HasLocalCopyOf(int orderId) => _localAddressCopies.ContainsKey(orderId);
}
```
