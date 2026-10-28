---
id: app-architectures
title: Application Architectures: Layered, Clean, Hexagonal, Vertical Slice and Modular Monolith
summary: How to organise a whole solution. Why architecture matters, the classic layered (n-tier) architecture, Onion/Clean/Hexagonal with the dependency rule, a complete Clean Architecture solution in .NET, Repository and Unit of Work (and the debate around them), Vertical Slice Architecture, the modular monolith, and how to enforce boundaries.
layer: arch
where: Application architecture › Solution structure (system level)
fits: This chapter applies [design principles](ch:design-principles), especially Dependency Inversion, to the whole solution. Physically, architecture means **projects and project references** ([Projects & SDK](ch:projects-sdk-nuget)); at runtime, it's wired together in the DI composition root ([Dependency injection](ch:dependency-injection)). It's the bridge between layer 3 (frameworks at the edges) and the domain at the centre ([DDD](ch:ddd)).
levels: b,i,a
prereqs: design-principles, dependency-injection, efcore-fundamentals
next: cqrs-mediator-result, ddd, microservices
---

## TL;DR

- Architecture at the solution scale asks: how is the codebase divided, and which parts are allowed to depend on which?
- Classic layered (n-tier) architecture has business logic depend on data access, which couples business rules to persistence — Clean/Onion/Hexagonal fix this by putting the domain in the center and making all dependencies point **inward**.
- `DbContext`/`DbSet` already *are* a unit-of-work/repository — a generic repository wrapper on top of EF Core usually hides features rather than adding value; per-aggregate repositories are the version that actually earns its keep.
- Vertical Slice Architecture organizes by feature (one file per use case) instead of by technical layer; it combines well with a shared domain core.
- A **modular monolith** (strongly separated modules, one deployable) gets most of microservices' boundary benefits without the network/distributed-transaction cost — a common default before reaching for real microservices.

## What "architecture" means at this scale {b}

Everything in [Design principles](ch:design-principles) applied to individual classes. This chapter asks the same question at the scale of an entire solution: how do you divide a codebase into parts, what is each part responsible for, and **which parts may depend on which**? Good architecture keeps **business rules** independent of **delivery mechanisms** (HTTP, UI, messages) and **infrastructure** (databases, queues, external APIs), so that:

- business logic can be tested without a web server or database,
- frameworks and vendors can be upgraded or swapped with local changes,
- different people can work on different areas without stepping on each other,
- the code tells you what the system **does** (orders, payments), not just what it's **built with** (controllers, repositories).

## Layered (n-tier) architecture: the traditional starting point {b}

```text
┌──────────────────────────┐
│ Presentation (API / UI)  │  controllers, endpoints, view models
├──────────────────────────┤
│ Business Logic (BLL)     │  services, rules
├──────────────────────────┤
│ Data Access (DAL)        │  repositories, EF Core, SQL
├──────────────────────────┤
│ Database                 │
└──────────────────────────┘
Each layer depends on the one BELOW it.
```

**Pros:** simple, familiar, and a clear separation of technical concerns. **Cons:** trace the dependency arrows and the real problem becomes visible — the business layer **depends on data access**, so business rules are coupled to persistence (testing needs the DAL, entities are shaped by tables), and a single feature's logic is scattered across all four layers rather than living in one place. It tends toward anemic models and "service classes" holding all the actual logic.

## Onion, Hexagonal and Clean Architecture: three names, one fix {i}

All three names below are solving exactly the layered architecture's core problem: put the **domain at the centre**, and make **all dependencies point inward**, so business logic never has to know anything about the technology serving or persisting it.

```text
            ┌────────────────────────────────────────────────────────────┐
            │  Infrastructure & Presentation (outer ring)                 │
            │  ASP.NET Core endpoints · EF Core · Service Bus · Stripe    │
            │   ┌────────────────────────────────────────────────────┐   │
            │   │  Application (use cases)                            │   │
            │   │  PlaceOrderHandler · DTOs · interfaces it needs:     │   │
            │   │  IOrderRepository, IPaymentGateway, IEmailSender     │   │
            │   │   ┌────────────────────────────────────────────┐   │   │
            │   │   │  Domain (core)                              │   │   │
            │   │   │  Order · Money · OrderPlaced · rules         │   │   │
            │   │   │  no dependencies on anything outside         │   │   │
            │   │   └────────────────────────────────────────────┘   │   │
            │   └────────────────────────────────────────────────────┘   │
            └────────────────────────────────────────────────────────────┘
                    THE DEPENDENCY RULE: source code dependencies point INWARD only
```

| Name | Author | Emphasis |
|---|---|---|
| **Hexagonal / Ports & Adapters** | Alistair Cockburn (2005) | The app has **ports** (interfaces) and **adapters** (implementations) for each external actor: driving (HTTP, CLI, tests) and driven (DB, email) |
| **Onion** | Jeffrey Palermo (2008) | Concentric layers: domain model → domain services → application services → infrastructure/UI |
| **Clean** | Robert C. Martin (2012) | Entities → use cases → interface adapters → frameworks & drivers; the Dependency Rule |

How it works, concretely: the inner layers **define interfaces** for what they need (`IOrderRepository`), and the outer layers **implement** them (`EfOrderRepository`) — exactly the Dependency Inversion Principle from [Design principles](ch:design-principles#d-dependency-inversion-principle), now applied to the whole solution rather than one class. At runtime, control still flows outward (handler → repository → SQL), but the compile-time dependency points inward — the same inversion that single `OrderService` example demonstrated, scaled up to entire projects.

## A Clean Architecture solution in .NET {i}

```text
src/
├── Shop.Domain/                    ← references: NOTHING (maybe a small shared kernel)
│   ├── Orders/  Order.cs, OrderLine.cs, OrderStatus.cs, OrderPlaced.cs, IOrderRepository.cs
│   ├── Customers/  Customer.cs, CustomerId.cs
│   └── Common/  Entity.cs, ValueObject.cs, Money.cs, DomainException.cs
├── Shop.Application/               ← references: Domain
│   ├── Orders/PlaceOrder/  PlaceOrderCommand.cs, PlaceOrderHandler.cs, PlaceOrderValidator.cs
│   ├── Orders/GetOrder/    GetOrderQuery.cs, GetOrderHandler.cs, OrderDto.cs
│   ├── Abstractions/       IPaymentGateway.cs, IEmailSender.cs, IUnitOfWork.cs, IClock.cs
│   └── DependencyInjection.cs   (AddApplication)
├── Shop.Infrastructure/            ← references: Application, Domain
│   ├── Persistence/  ShopDb.cs, Configurations/*.cs, Migrations/, OrderRepository.cs
│   ├── Payments/     StripePaymentGateway.cs
│   ├── Messaging/    OutboxPublisher.cs
│   └── DependencyInjection.cs   (AddInfrastructure)
└── Shop.Api/                       ← references: Application, Infrastructure (only for DI wiring)
    ├── Endpoints/OrderEndpoints.cs
    ├── Program.cs  ← composition root
    └── appsettings.json
tests/
├── Shop.Domain.Tests/              unit tests: pure, fast
├── Shop.Application.Tests/         handler tests with fakes
├── Shop.Api.IntegrationTests/      WebApplicationFactory + Testcontainers
└── Shop.ArchitectureTests/         enforce the dependency rule
```

Notice what the `src/Shop.Domain/` comment says — "references: NOTHING" — and what that absence actually buys the test projects below it: `Shop.Domain.Tests` can run in milliseconds with no database, no HTTP server, no mocking framework needed for infrastructure, because the domain project genuinely has nothing external to fake.

```csharp
// Domain: pure C#, rules inside the model
public sealed class Order : Entity<OrderId>
{
    private readonly List<OrderLine> _lines = [];
    public CustomerId CustomerId { get; private set; }
    public OrderStatus Status { get; private set; }
    public IReadOnlyList<OrderLine> Lines => _lines;
    public static Order Place(CustomerId customer, IEnumerable<(ProductId, int, Money)> lines) { /* invariants, raise OrderPlaced */ }
}

// Application: orchestrates a use case using abstractions
public sealed class PlaceOrderHandler(IOrderRepository orders, IPaymentGateway payments, IUnitOfWork uow)
{
    public async Task<Result<OrderId>> HandleAsync(PlaceOrderCommand cmd, CancellationToken ct)
    {
        var order = Order.Place(cmd.CustomerId, cmd.Lines);
        var payment = await payments.ChargeAsync(order.Total, cmd.PaymentToken, ct);
        if (!payment.Succeeded) return Result.Failure<OrderId>(OrderErrors.PaymentDeclined);
        orders.Add(order);
        await uow.SaveChangesAsync(ct);
        return order.Id;
    }
}

// Infrastructure: implements the abstractions with real technology
public sealed class OrderRepository(ShopDb db) : IOrderRepository
{
    public Task<Order?> GetAsync(OrderId id, CancellationToken ct) => db.Orders.Include(o => o.Lines).FirstOrDefaultAsync(o => o.Id == id, ct);
    public void Add(Order order) => db.Orders.Add(order);
}

// API: thin HTTP adapter
orders.MapPost("/", async (PlaceOrderRequest req, PlaceOrderHandler handler, ClaimsPrincipal user, CancellationToken ct) =>
    (await handler.HandleAsync(req.ToCommand(user), ct)).ToHttpResult());

// Composition root
builder.Services.AddApplication().AddInfrastructure(builder.Configuration);
```

:::why What you get
The domain and application layers compile and test **without ASP.NET Core, EF Core or Stripe**. Switching Stripe for Adyen means a new adapter in Infrastructure. Adding a gRPC or message-driven entry point reuses the same handlers. The folder names under Application read like a list of use cases: the architecture **screams** what the system does.
:::

:::gotcha Common Clean Architecture mistakes
- **Leaking EF Core into the domain** (`[Table]` attributes, `DbSet`, `IQueryable` returned from repositories). Keep mapping in Infrastructure with the Fluent API.
- **Application depending on Infrastructure** "just for one class": the dependency rule is binary.
- **Ceremony overload**: an interface, a DTO, a mapper, a handler, a validator and a repository for a trivial CRUD screen. Apply it where the domain is complex enough to deserve it.
- **Anemic domain + fat "services"**: the architecture is clean but the model is a bag of getters and setters. See [DDD](ch:ddd).
:::

## Repository and Unit of Work: a debate that's really about EF Core {i}

- **Repository** (Fowler, *PoEAA*): mediates between the domain and data mapping, acting like an **in-memory collection of aggregates** — an "aggregate" here just means a cluster of related objects (say, an `Order` plus its `OrderLine`s) that's saved and loaded as one unit, a concept [DDD](ch:ddd) covers in full — exposed via `GetAsync`, `Add`, `Remove`, hiding how they're stored.
- **Unit of Work:** tracks changes during a business transaction and **commits them together**.

Here's the thing worth being direct about before picking a side: **EF Core already implements both of these**. `DbSet<T>` *is* a repository — it already gives you `Add`, `Find`, and querying over an in-memory-feeling collection. `DbContext` *is* a unit of work — it already tracks every change and commits them together via `SaveChanges()`, exactly the mechanism [EF Core fundamentals](ch:efcore-fundamentals#change-tracking-and-savechanges-how-ef-core-knows-what-to-wr) described. So the real debate isn't "should I use these patterns," it's "should I wrap EF Core's own implementation of them in another layer":

| Approach | Pros | Cons |
|---|---|---|
| **Use DbContext directly** in handlers | Least code; full EF power (projections, Include, `ExecuteUpdate`) | Application layer depends on EF Core; harder to enforce aggregate loading rules |
| **Generic repository** `IRepository<T>` over EF | Looks tidy | Usually **adds nothing**: hides EF features, leaks `IQueryable` or forces lowest-common-denominator queries. Often called an anti-pattern |
| **Specific repositories per aggregate** (`IOrderRepository`) | Domain language; one place to define how an aggregate is loaded; keeps EF out of Domain/Application; easy to fake | More code |
| **Specific repositories for writes + direct queries (EF/Dapper) for reads** | Best of both: aggregates protected, reads optimised (CQRS) | Two styles to learn |

A balanced answer, and a common modern choice: **specific aggregate repositories for the write side** (DDD), and **query handlers using DbContext or Dapper with projections for the read side** — which mirrors the exact write/read split [ADO.NET & Dapper](ch:ado-dapper#dapper-vs-ef-core-the-real-decision-not-a-popularity-contest) recommended for its own, narrower reasons.

```csharp
public interface IUnitOfWork { Task<int> SaveChangesAsync(CancellationToken ct = default); }
public sealed class ShopDb(DbContextOptions<ShopDb> o) : DbContext(o), IUnitOfWork { /* SaveChangesAsync already exists */ }
builder.Services.AddScoped<IUnitOfWork>(sp => sp.GetRequiredService<ShopDb>());
```

**Specification pattern:** encapsulates query criteria as objects (`new OrdersForCustomerSpec(customerId, includeLines: true)`), so repositories don't explode into dozens of `GetByXAndY` methods (e.g. the Ardalis.Specification library).

## Vertical Slice Architecture: organising by feature instead of by role {i}

Coined by Jimmy Bogard. Instead of organising by **technical layer** — the instinct every architecture above this section shares — organise by **feature**: each request type (a "slice" through all layers) owns everything it needs, in one place.

```text
Layered / Clean:                          Vertical slices:
Controllers/  OrdersController            Features/
Services/     OrderService                  Orders/
Repositories/ OrderRepository                 PlaceOrder.cs     ← request, validator, handler, endpoint
DTOs/         OrderDto                        GetOrder.cs
Validators/   OrderValidator                  CancelOrder.cs
                                            Products/
→ one feature touches 5 folders               SearchProducts.cs
                                          → one feature is one file or folder
```

```csharp
public static class CancelOrder
{
    public sealed record Command(int OrderId, string Reason);

    public sealed class Validator : AbstractValidator<Command>
    {
        public Validator() { RuleFor(x => x.Reason).NotEmpty().MaximumLength(500); }
    }

    internal static async Task<Results<NoContent, NotFound, Conflict<ProblemDetails>>> Handle(
        int id, CancelRequest body, ShopDb db, TimeProvider clock, CancellationToken ct)
    {
        var order = await db.Orders.FirstOrDefaultAsync(o => o.Id == id, ct);
        if (order is null) return TypedResults.NotFound();
        var result = order.Cancel(body.Reason, clock.GetUtcNow());          // rule lives in the domain model
        if (result.IsFailure) return TypedResults.Conflict(result.Error.ToProblem());
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    public static void Map(IEndpointRouteBuilder app) =>
        app.MapPost("/orders/{id:int}/cancel", Handle).AddEndpointFilter<ValidationFilter<CancelRequest>>();
}
```

| | Clean / layered | Vertical slices |
|---|---|---|
| Organised by | Technical role | Feature / use case |
| Change to one feature touches | Many folders/projects | One file/folder |
| Coupling between features | Shared services encourage it | Minimised; slices share little |
| Abstractions | Many shared ones | Added per slice only when needed |
| Risk | Ceremony, scattered features | Duplication; logic leaking into handlers instead of the domain |

These two approaches **combine well** rather than competing: a rich **domain** project shared by **vertical slices** in the API/application project is a very popular structure today — note `CancelOrder.Handle` above still calls `order.Cancel(...)`, keeping the actual business rule inside the domain model even though the surrounding plumbing is organised by feature. Minimal APIs, CQRS and the REPR pattern (FastEndpoints) fit slices naturally.

## The modular monolith: most of microservices' benefits, none of the network {i}

A **single deployable** application divided into **modules** that are as independent as microservices *logically*: one per bounded context, each with its own domain, data (its own schema or DbContext) and a small public API.

```text
Shop.Host (one ASP.NET Core app, one deployment)
├── Modules/Ordering/   Ordering.Api · Ordering.Application · Ordering.Domain · Ordering.Infrastructure (schema "ordering")
├── Modules/Catalog/    …                                                         (schema "catalog")
├── Modules/Billing/    …                                                         (schema "billing")
└── Shared/             building blocks (Result, Entity, in-process event bus)

Rules: modules talk only via public contracts (interfaces or integration events), never via another module's tables or internal classes.
```

**Why:** most of the structural benefits of microservices (clear boundaries, team ownership, independent evolution) come from exactly this kind of strict module separation — and this structure gets them with **none of the distributed-systems cost** (network failures, distributed transactions, many deployments) that real service-to-service calls would introduce. If a module later genuinely needs independent scaling, it's already shaped to be **extracted into a service** with comparatively little rework, because the boundary was already enforced. Many teams now recommend this as the default starting architecture (see [Microservices](ch:microservices)), reaching for actual microservices only once a concrete, specific reason demands it.

## Enforcing architecture {a}

Boundaries that aren't enforced erode — a well-drawn diagram on a wiki page stops anyone from accidentally violating it for approximately one sprint. The tools below make the boundary something the build itself checks:

1. **Project references:** the compiler rejects `using Shop.Infrastructure` in Domain if there's no reference. The strongest guarantee.
2. **`internal` by default**: only expose what other projects need.
3. **Architecture tests** with NetArchTest or ArchUnitNET:

```csharp
[Fact]
public void Domain_has_no_dependency_on_other_layers() =>
    Types.InAssembly(typeof(Order).Assembly).ShouldNot()
        .HaveDependencyOnAny("Shop.Application", "Shop.Infrastructure", "Shop.Api", "Microsoft.EntityFrameworkCore")
        .GetResult().IsSuccessful.ShouldBeTrue();

[Fact]
public void Modules_do_not_reference_each_others_internals() =>
    Types.InAssembly(typeof(OrderingModule).Assembly).ShouldNot()
        .HaveDependencyOn("Shop.Modules.Billing.Domain").GetResult().IsSuccessful.ShouldBeTrue();
```

4. **Analyzers / code review checklists**, and documenting decisions as **ADRs** (Architecture Decision Records).

## Choosing {i}

| Situation | Reasonable choice |
|---|---|
| Small CRUD service, simple rules | Minimal APIs + EF Core directly, feature folders; little layering |
| Rich business rules, long-lived product | Clean Architecture with a DDD domain; CQRS reads |
| Many features, fast-moving team | Vertical slices over a shared domain |
| Several bounded contexts, one team or a few | **Modular monolith** |
| Independent scaling/deployment, many teams, mature DevOps | Microservices (often extracted from a modular monolith) |

:::qa What is Clean Architecture?
An architecture that places the domain (entities and rules) and application use cases at the centre, with infrastructure and presentation in outer layers, governed by the Dependency Rule: source dependencies point only inward. Inner layers define interfaces (ports) that outer layers implement (adapters), so business logic is independent of frameworks, databases and UI, and is easy to test.
:::

:::qa What's the difference between layered architecture and Clean/Onion architecture?
In classic layered architecture, the business layer depends on the data access layer below it. In Clean/Onion, dependencies are inverted: the domain and application define the abstractions, and infrastructure depends on them. Persistence becomes a detail plugged into the core.
:::

:::qa What is Hexagonal (Ports and Adapters) architecture?
The application core exposes ports (interfaces) for everything it needs or offers. Adapters connect external actors: driving adapters (HTTP endpoints, message consumers, tests) call the core, and driven adapters (DB repositories, email, payment gateways) implement the core's outbound ports. It's essentially the same idea as Clean/Onion.
:::

:::qa Should you use the Repository pattern with EF Core?
DbContext already is a unit of work and DbSet a repository, so a generic repository wrapper usually adds little and hides EF capabilities. Specific repositories per aggregate are valuable in DDD/Clean Architecture to encapsulate aggregate loading and keep EF out of the inner layers. A common approach is repositories for writes and direct EF/Dapper projections for reads.
:::

:::qa What is Vertical Slice Architecture and how does it compare with Clean Architecture?
Organising code by feature, where each request or use case owns its endpoint, validation, handler and data access, instead of by technical layer. Changes are localised and coupling between features is low, but you must watch for duplication and keep business rules in the domain. It can be combined with a Clean-style domain core.
:::

:::qa What is a modular monolith and why is it popular?
A single deployable app split into strongly separated modules aligned to bounded contexts, each with its own data and public contracts. It offers clear boundaries and team ownership without the operational and consistency costs of microservices, and modules can be extracted into services later if needed.
:::

:::qa How do you enforce architectural boundaries in .NET?
Project references (the compiler forbids undeclared dependencies), internal visibility by default, architecture tests (NetArchTest/ArchUnitNET) in CI, analyzers, and documented ADRs plus code review.
:::

## Further reading

- [Common web application architectures (Microsoft eBook)](https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/common-web-application-architectures)
- Robert C. Martin, *Clean Architecture*.
- Jimmy Bogard, "Vertical Slice Architecture" (talk and blog).
- Jason Taylor's and Ardalis's (Steve Smith) Clean Architecture templates on GitHub. Milan Jovanović's blog for modular monolith examples.
- Martin Fowler, *Patterns of Enterprise Application Architecture* (Repository, Unit of Work, Service Layer).

## Verify this chapter

Run with `dotnet run` (plain console app, .NET 8/9, no packages). It checks the two claims that are actually mechanical facts, not design opinions: that `IUnitOfWork`/repository abstractions let a handler run against a fake with zero real infrastructure (the actual point of the Dependency Rule), and that the inward-pointing Dependency Rule is literally just "who references whom," checkable by reflection the same way an architecture test would.

```csharp
// --- The Dependency Rule in miniature: Application depends on an interface Domain defines;
//     Infrastructure implements it. Application never references Infrastructure's concrete type. ---
var fake = new FakeOrderRepositoryAndUow();
var handler = new PlaceOrderHandler(fake, fake);
var rows = await handler.HandleAsync("order-1");
if (rows != 1 || fake.All.Count != 1) throw new Exception("FAIL: handler should work against the fake with no real DB");
Console.WriteLine("OK: a use-case handler ran end-to-end against a pure in-memory fake — no EF Core, no SQL Server, no network");

// --- Architecture-test-style check: does any type whose name contains "Domain" reference a type from "Infrastructure"? ---
// (Real architecture tests use NetArchTest/ArchUnitNET and real assemblies; this reproduces the same idea
//  the chapter describes — reflecting over a type's members and failing if a forbidden reference is found.)
bool DomainTypeReferencesInfrastructure(Type domainType, Type infrastructureType) =>
    domainType.GetMembers().Any(m =>
        (m is System.Reflection.PropertyInfo p && p.PropertyType == infrastructureType) ||
        (m is System.Reflection.MethodInfo meth && meth.GetParameters().Any(prm => prm.ParameterType == infrastructureType)));

if (DomainTypeReferencesInfrastructure(typeof(PlaceOrderHandler), typeof(FakeOrderRepositoryAndUow)))
    throw new Exception("FAIL: PlaceOrderHandler (application layer) should depend only on interfaces, not the concrete fake");
Console.WriteLine("OK: PlaceOrderHandler's members reference only IOrderRepository/IUnitOfWork, never the concrete implementation — the Dependency Rule holds, and this is exactly the kind of check an architecture test automates");

// Not runtime-verifiable here — see Further reading: Common web application architectures (Microsoft), Clean Architecture (Martin)
// (which architecture style fits a given team/project, and whether modules are "strongly separated," are judgment calls, not facts)

interface IOrderRepository { void Add(string orderId); IReadOnlyList<string> All { get; } }
interface IUnitOfWork { int PendingChanges { get; } Task<int> SaveChangesAsync(); }

// "Application" layer: orchestrates using only the abstractions, exactly like PlaceOrderHandler in the chapter
class PlaceOrderHandler(IOrderRepository orders, IUnitOfWork uow)
{
    public async Task<int> HandleAsync(string orderId)
    {
        orders.Add(orderId);
        return await uow.SaveChangesAsync();
    }
}

// A fake standing in for "Infrastructure" (in the real chapter: EF Core / SQL Server) — no database involved at all
class FakeOrderRepositoryAndUow : IOrderRepository, IUnitOfWork
{
    private readonly List<string> _orders = [];
    public IReadOnlyList<string> All => _orders;
    public int PendingChanges { get; private set; }
    public void Add(string orderId) { _orders.Add(orderId); PendingChanges++; }
    public Task<int> SaveChangesAsync() { var n = PendingChanges; PendingChanges = 0; return Task.FromResult(n); }
}
```
