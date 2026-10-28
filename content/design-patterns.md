---
id: design-patterns
title: Design Patterns: The GoF Catalogue in Modern .NET
summary: The classic Gang of Four patterns as you'll meet them in .NET today. Creational (Factory Method, Abstract Factory, Builder, Singleton, Prototype), structural (Adapter, Decorator, Proxy, Facade, Composite, Bridge, Flyweight) and behavioural (Strategy, Observer, Command, Chain of Responsibility, Mediator, Template Method, State, Iterator, Visitor), each with intent, code and where the framework uses it.
layer: arch
where: Application architecture › Patterns (class level)
fits: Patterns are named recipes that apply the [design principles](ch:design-principles). Recognising them is the fastest way to understand layer-3 frameworks: middleware is Chain of Responsibility, `IHttpClientFactory` is a Factory, `DelegatingHandler` is a Decorator, `IOptionsMonitor.OnChange` is an Observer. Larger-scale patterns (CQRS, Repository, Outbox) are in [CQRS & Result](ch:cqrs-mediator-result), [DDD](ch:ddd) and [Messaging](ch:messaging-events).
levels: b,i,a
prereqs: design-principles, delegates-events
next: app-architectures, cqrs-mediator-result
---

## TL;DR

- A **design pattern** is just a named, reusable shape for a recurring problem — learning the name lets you recognise framework code ("that's a Decorator") without reading its internals.
- GoF patterns fall into three groups: **creational** (how objects get made), **structural** (how objects are composed), **behavioural** (how objects collaborate).
- Modern C# and DI absorb several patterns into the language itself: a delegate often replaces a one-method Strategy, `yield` *is* Iterator, and the DI container replaces hand-written Factories and Singletons.
- The most common ones in everyday ASP.NET Core code: Chain of Responsibility (middleware), Factory (`IHttpClientFactory`), Decorator (`DelegatingHandler`), Strategy (keyed DI services), Builder (`WebApplicationBuilder`).
- Bigger, architecture-scale patterns (Repository, CQRS, Outbox) live in their own chapters, not here.

## What patterns are, and why recognising them is worth the effort {b}

A **design pattern** is a reusable, named solution to a recurring design problem. The value of learning the name isn't abstract — it's that once you recognise "this is Decorator" or "this is Chain of Responsibility," you can predict how a piece of unfamiliar framework code behaves without reading its implementation line by line. The 1994 "Gang of Four" (GoF) book *Design Patterns* catalogued 23 of them in three groups:

| Group | Concern | Patterns |
|---|---|---|
| **Creational** | How objects are created | Factory Method, Abstract Factory, Builder, Singleton, Prototype |
| **Structural** | How objects are composed | Adapter, Decorator, Proxy, Facade, Composite, Bridge, Flyweight |
| **Behavioural** | How objects collaborate and share responsibility | Strategy, Observer, Command, Chain of Responsibility, Mediator, Template Method, State, Iterator, Visitor, Memento, Interpreter |

:::interview How to answer "tell me about a design pattern you've used"
Give **problem → pattern → .NET example → trade-off**. For example: "We had pricing rules that varied by customer type and kept growing a switch statement. We used the **Strategy** pattern: an `IPricingStrategy` per rule, registered in DI as keyed services, and selected at runtime. It made new rules a new class instead of an edit (Open/Closed), and each rule was easy to unit test. The cost is a few more types and an indirection."
:::

Keep one thing in mind as you read the catalogue below: modern C# and DI make many of these patterns lighter than the 1994 book describes them. A delegate can replace a one-method Strategy, the DI container replaces most hand-written Singletons and Factories, and `IEnumerable` + `yield` *is* Iterator — the pattern isn't missing, it's just been absorbed into the language itself.

---

## Factory Method and Simple Factory {b}

**Intent:** let a method or class decide **which concrete type** to create, so callers depend only on an abstraction.

```csharp
public interface INotifier { Task SendAsync(string to, string message, CancellationToken ct); }

public sealed class NotifierFactory(IServiceProvider sp) : INotifierFactory
{
    public INotifier Create(Channel channel) => channel switch
    {
        Channel.Email => sp.GetRequiredService<EmailNotifier>(),
        Channel.Sms   => sp.GetRequiredService<SmsNotifier>(),
        Channel.Push  => sp.GetRequiredService<PushNotifier>(),
        _ => throw new ArgumentOutOfRangeException(nameof(channel))
    };
}

// Static factory method on the type itself: name the intent, validate, hide constructors
public sealed class Order
{
    private Order() { }
    public static Order Create(CustomerId customer, IEnumerable<OrderLine> lines) { /* validate invariants */ return new Order { /* … */ }; }
}
```

**In .NET:** `IHttpClientFactory.CreateClient()`, `ILoggerFactory.CreateLogger()`, `IDbContextFactory<T>`, `Task.FromResult`, `TimeSpan.FromSeconds`, DI factory registrations (`AddScoped<IFoo>(sp => …)`). Keyed services (.NET 8) often replace hand-written factories.

## Abstract Factory {i}

**Intent:** create **families of related objects** without specifying concrete classes, so a family can be swapped as a whole.

```csharp
public interface IStorageFactory { IBlobStore CreateBlobStore(); IQueueClient CreateQueue(); ISecretStore CreateSecrets(); }
public sealed class AzureStorageFactory(…) : IStorageFactory { /* Blob Storage, Storage Queues, Key Vault */ }
public sealed class LocalStorageFactory : IStorageFactory { /* file system, in-memory channel, user secrets */ }
```

Notice the "swapped as a whole" part is the actual point here, distinguishing this from a plain Factory Method: you never want `AzureStorageFactory`'s blob store paired with `LocalStorageFactory`'s queue — the whole family has to move together, exactly as it would between a local dev environment and a cloud deployment. **In .NET:** `DbProviderFactory` (creates connections, commands and parameters for one provider). In practice, registering a coherent set of implementations per environment in DI achieves the same thing.

## Builder {b}

**Intent:** construct a complex object **step by step**, with a readable fluent API, separating construction from representation and validating once at `Build()`.

```csharp
var report = new ReportBuilder()
    .Titled("Q3 sales")
    .For(DateRange.Quarter(2026, 3))
    .GroupBy(ReportGrouping.Region)
    .IncludeChart(ChartType.Bar)
    .Build();                                // validates and creates an immutable Report

public sealed class ReportBuilder
{
    private string? _title; private DateRange? _range; private readonly List<ChartType> _charts = [];
    public ReportBuilder Titled(string t) { _title = t; return this; }
    public ReportBuilder For(DateRange r) { _range = r; return this; }
    public ReportBuilder IncludeChart(ChartType c) { _charts.Add(c); return this; }
    public ReportBuilder GroupBy(ReportGrouping g) { /* … */ return this; }
    public Report Build() => new(_title ?? throw new InvalidOperationException("Title required"), _range ?? DateRange.Today, [.. _charts]);
}
```

**In .NET, everywhere:** `WebApplication.CreateBuilder()` / `WebApplicationBuilder`, `HostApplicationBuilder`, `IServiceCollection` (a builder for the container), `ConfigurationBuilder`, `StringBuilder`, `UriBuilder`, `DbContextOptionsBuilder`, `ModelBuilder`, `AuthorizationPolicyBuilder`, `HubConnectionBuilder`. **Test data builders** (`new OrderBuilder().WithLines(3).Paid().Build()`) are a great use in test projects.

## Singleton {b}

**Intent:** exactly **one instance**, with global access.

```csharp
// The classic thread-safe lazy singleton
public sealed class Clock
{
    private static readonly Lazy<Clock> _instance = new(() => new Clock());
    public static Clock Instance => _instance.Value;
    private Clock() { }
}

// The modern way: let DI own the single instance
builder.Services.AddSingleton<IClock, SystemClock>();
```

:::gotcha Why the classic Singleton is considered an anti-pattern
`Clock.Instance` is **hidden global state**: dependencies aren't visible in constructors, it can't be replaced in tests, tests interfere through shared state, and lifetime is fixed forever. A **DI singleton** gives the one-instance benefit while keeping explicit dependencies and testability. Whatever approach you use, singletons must be **thread-safe**.
:::

## Prototype {a}

**Intent:** create new objects by **copying** an existing one.

**In .NET:** record `with` expressions (`var copy = order with { Status = Paid };`), `ICloneable` (discouraged: deep or shallow is ambiguous), `MemberwiseClone` (shallow). Useful for templates ("new order like the last one") and immutable updates.

---

## Adapter {b}

**Intent:** make an existing class with an **incompatible interface** work through the interface your code expects. It's a translator.

```csharp
// Your domain's port
public interface IPaymentGateway { Task<PaymentResult> ChargeAsync(Money amount, string paymentToken, CancellationToken ct); }

// Adapter over a vendor SDK with a completely different shape
public sealed class StripePaymentAdapter(PaymentIntentService stripe) : IPaymentGateway
{
    public async Task<PaymentResult> ChargeAsync(Money amount, string token, CancellationToken ct)
    {
        var intent = await stripe.CreateAsync(new PaymentIntentCreateOptions
        {
            Amount = (long)(amount.Amount * 100), Currency = amount.Currency.ToLowerInvariant(),
            PaymentMethod = token, Confirm = true
        }, cancellationToken: ct);
        return intent.Status == "succeeded" ? PaymentResult.Success(intent.Id) : PaymentResult.Declined(intent.LastPaymentError?.Code);
    }
}
```

**Why it matters:** this is exactly the **"adapter" in Ports & Adapters (Hexagonal)** architecture, the same pattern [Design principles](ch:design-principles#d-dependency-inversion-principle) described as infrastructure implementing an interface the business side owns. Vendor types never leak into your domain, and switching providers means writing a new adapter. **In .NET:** `StreamReader` (adapts a `Stream` to text reading), `TextWriter` adapters, logging providers adapting `ILogger` to Serilog/NLog.

## Decorator {b}

**Intent:** wrap an object with **another object implementing the same interface**, adding behaviour before/after delegating. Decorators can be stacked, and the inner object doesn't know.

```csharp
public interface IProductRepository { Task<Product?> GetAsync(int id, CancellationToken ct); }

public sealed class SqlProductRepository(ShopDb db) : IProductRepository
{
    public Task<Product?> GetAsync(int id, CancellationToken ct) => db.Products.FindAsync([id], ct).AsTask();
}

public sealed class CachingProductRepository(IProductRepository inner, HybridCache cache) : IProductRepository
{
    // HybridCache (a built-in two-level cache, covered in [Caching](ch:caching-ratelimit-cors)) just needs a
    // key and a function to call on a cache miss — here, "ask the inner repository".
    public async Task<Product?> GetAsync(int id, CancellationToken ct) =>
        await cache.GetOrCreateAsync($"product:{id}", async t => await inner.GetAsync(id, t), cancellationToken: ct);
}

public sealed class LoggingProductRepository(IProductRepository inner, ILogger<LoggingProductRepository> log) : IProductRepository
{
    public async Task<Product?> GetAsync(int id, CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();
        var p = await inner.GetAsync(id, ct);
        log.LogDebug("Loaded product {Id} in {Ms} ms (hit: {Found})", id, sw.ElapsedMilliseconds, p is not null);
        return p;
    }
}

// Composition: Logging → Caching → Sql   (Scrutor)
builder.Services.AddScoped<IProductRepository, SqlProductRepository>();
builder.Services.Decorate<IProductRepository, CachingProductRepository>();
builder.Services.Decorate<IProductRepository, LoggingProductRepository>();
```

Notice the `Decorate` calls build up exactly the same nested-wrapping shape [Middleware](ch:middleware#now-heres-the-aha-a-middleware-is-just-a-function-wrapping-a) showed for `A(B(C(endpoint)))` — a call to `GetAsync` here flows `Logging → Caching → Sql`, each layer free to act before and after delegating onward. **In .NET:** `DelegatingHandler` chains in HttpClient, `BufferedStream`/`GZipStream`/`CryptoStream` wrapping a `Stream`, MediatR pipeline behaviours, and middleware (conceptually). Decorator vs inheritance: you can combine N behaviours with N classes instead of 2^N subclasses.

## Proxy {i}

**Intent:** a stand-in with the **same interface** that **controls access** to the real object: lazy creation, remote access, caching, access control.

| Proxy kind | .NET example |
|---|---|
| Virtual (lazy) | EF Core **lazy-loading proxies**, `Lazy<T>` |
| Remote | gRPC/WCF client stubs, Refit-generated clients |
| Protection | A wrapper checking permissions before delegating |
| Dynamic | `DispatchProxy`, Castle DynamicProxy (used by mocking libraries like Moq and NSubstitute) |

Decorator and Proxy look identical in code — both wrap an object behind the same interface. What tells them apart is *why* you wrapped it. A decorator **adds behaviour** to an object that's already there. A proxy **controls access** to an object, often deciding *whether* or *when* it even exists. That's why EF Core's lazy-loading proxy counts as Proxy (it decides when to load the real entity) while `CachingProductRepository` above counts as Decorator (the real repository is already available; caching just adds a behaviour in front of it).

## Facade {b}

**Intent:** provide a **simple, unified interface** over a complex subsystem.

```csharp
public sealed class CheckoutFacade(ICartService carts, IPricingService pricing, IInventory inventory, IPaymentGateway payments, IOrderRepository orders)
{
    public async Task<Result<OrderId>> CheckoutAsync(Guid cartId, string paymentToken, CancellationToken ct)
    {
        var cart = await carts.GetAsync(cartId, ct);
        var total = pricing.Calculate(cart);
        await inventory.ReserveAsync(cart.Lines, ct);
        var payment = await payments.ChargeAsync(total, paymentToken, ct);
        if (!payment.Succeeded) { await inventory.ReleaseAsync(cart.Lines, ct); return Result.Fail<OrderId>("payment.declined"); }
        var order = Order.FromCart(cart, total, payment.Reference);
        orders.Add(order);
        return order.Id;
    }
}
```

**In .NET:** `WebApplication.CreateBuilder()` (a facade over host, config, logging and DI setup), `File.ReadAllTextAsync` (over streams and encodings), `JsonSerializer` (over readers/writers), `HttpClient.GetFromJsonAsync`. Application services and use-case handlers are often facades over the domain.

## Composite {i}

**Intent:** treat **individual objects and groups of objects uniformly** through one interface (tree structures).

```csharp
public interface IPriceRule { decimal Apply(decimal price, Order o); }
public sealed class PercentOff(decimal pct) : IPriceRule { public decimal Apply(decimal p, Order o) => p * (1 - pct); }
public sealed class CompositeRule(params IPriceRule[] rules) : IPriceRule
{
    public decimal Apply(decimal p, Order o) => rules.Aggregate(p, (acc, r) => r.Apply(acc, o));   // a group IS a rule
}
```

**In .NET:** `CompositeChangeToken`, `CompositeFileProvider`, UI control trees, expression trees, authorization requirements combined in a policy, and the `IConfiguration` sections tree.

## Bridge and Flyweight {a}

- **Bridge:** separate an **abstraction** from its **implementation** so both vary independently. Example: `ILogger` (abstraction) bridging to many logging providers (implementations); ADO.NET's abstract `DbConnection` with provider implementations.
- **Flyweight:** share common state among many fine-grained objects to save memory. **In .NET:** string interning, cached boxed values, `ArrayPool<T>`, `Task.CompletedTask`, cached `JsonSerializerOptions`, `FrozenDictionary` lookups shared across requests.

---

## Strategy {b}

**Intent:** define a **family of interchangeable algorithms** behind one interface and choose one at runtime.

```csharp
public interface IDiscountStrategy { string Name { get; } decimal Discount(Order o); }
public sealed class NoDiscount : IDiscountStrategy { public string Name => "none"; public decimal Discount(Order o) => 0; }
public sealed class VipDiscount : IDiscountStrategy { public string Name => "vip"; public decimal Discount(Order o) => o.Subtotal * 0.10m; }
public sealed class BlackFriday : IDiscountStrategy { public string Name => "blackfriday"; public decimal Discount(Order o) => o.Subtotal * 0.30m; }

// Select by key with .NET 8 keyed services
builder.Services.AddKeyedSingleton<IDiscountStrategy, VipDiscount>("vip");
builder.Services.AddKeyedSingleton<IDiscountStrategy, BlackFriday>("blackfriday");
builder.Services.AddKeyedSingleton<IDiscountStrategy, NoDiscount>("none");

public sealed class PricingService(IServiceProvider sp, ICampaignCalendar calendar)
{
    public decimal Price(Order o)
    {
        var key = calendar.IsBlackFriday ? "blackfriday" : o.Customer.IsVip ? "vip" : "none";
        return o.Subtotal - sp.GetRequiredKeyedService<IDiscountStrategy>(key).Discount(o);
    }
}

// Lightweight strategy: just a delegate
Func<Order, decimal> discount = o => o.Subtotal > 100 ? 10 : 0;
```

Notice how directly this maps onto the Open/Closed worked example from [Design principles](ch:design-principles#o-open-closed-principle): the shipping-rate carriers there were literally this same pattern, named. **In .NET:** `IComparer<T>` passed to `Sort`, `IEqualityComparer<T>` for dictionaries, authentication schemes, `JsonNamingPolicy`, retry strategies in Polly, `IPasswordHasher`, load-balancing policies in YARP. **Strategy is the most-used pattern in DI-based code.**

## Observer {b}

**Intent:** a **subject** notifies a list of **observers** when something happens, without knowing who they are.

```csharp
// Language-level: events
public event EventHandler<OrderPlacedEventArgs>? OrderPlaced;

// In-process "observer" via DI: all handlers of a notification
public interface IOrderPlacedHandler { Task HandleAsync(OrderPlaced e, CancellationToken ct); }
public sealed class DomainEventDispatcher(IEnumerable<IOrderPlacedHandler> handlers)
{
    public Task PublishAsync(OrderPlaced e, CancellationToken ct) => Task.WhenAll(handlers.Select(h => h.HandleAsync(e, ct)));
}
```

**In .NET:** C# `event`s, `IObservable<T>`/`IObserver<T>` (Reactive Extensions), `IOptionsMonitor<T>.OnChange`, `IChangeToken`, `INotifyPropertyChanged` (UI), `DiagnosticListener`/`ActivityListener`, MediatR notifications. **At system scale**, Observer becomes **publish/subscribe** with a message broker ([Messaging](ch:messaging-events)) — same idea, the subject and observers just live in different processes.

## Command {i}

**Intent:** encapsulate **a request as an object**, so you can queue it, log it, retry it, undo it, or send it elsewhere.

```csharp
public sealed record PlaceOrder(Guid CustomerId, IReadOnlyList<LineDto> Lines);    // the command: pure data
public interface ICommandHandler<in TCommand> { Task HandleAsync(TCommand command, CancellationToken ct); }
public sealed class PlaceOrderHandler(…) : ICommandHandler<PlaceOrder> { /* … */ }
```

**In .NET and architecture:** CQRS commands, MediatR `IRequest`, messages sent to a queue (a command sent to Service Bus is literally a serialised Command object), Hangfire jobs, undo stacks in UI apps. Commands are named in the imperative (`PlaceOrder`, `CancelSubscription`); events are named in the past tense (`OrderPlaced`) — a naming discipline that pays for itself the moment you're scanning a codebase and need to tell at a glance which messages can still be rejected and which already happened.

## Chain of Responsibility {b}

**Intent:** pass a request along a **chain of handlers**; each either handles it, passes it on, or both.

```csharp
public abstract class ApprovalHandler
{
    private ApprovalHandler? _next;
    public ApprovalHandler SetNext(ApprovalHandler next) => _next = next;
    public virtual ApprovalResult Handle(Expense e) => _next?.Handle(e) ?? ApprovalResult.Rejected("No approver");
}
public sealed class TeamLead : ApprovalHandler { public override ApprovalResult Handle(Expense e) => e.Amount <= 500 ? ApprovalResult.Approved("lead") : base.Handle(e); }
public sealed class Director : ApprovalHandler { public override ApprovalResult Handle(Expense e) => e.Amount <= 10_000 ? ApprovalResult.Approved("director") : base.Handle(e); }
```

**In .NET, the defining example:** the **ASP.NET Core middleware pipeline**. Each middleware handles the request, short-circuits, or calls `next`. Also: HttpClient's `DelegatingHandler` chain, MVC filters, MediatR pipeline behaviours, and authorization handlers. See [Middleware](ch:middleware).

## Mediator {i}

**Intent:** objects communicate **through a mediator** instead of referencing each other directly, which reduces many-to-many coupling to one-to-many.

```csharp
app.MapPost("/orders", (PlaceOrder cmd, ISender mediator, CancellationToken ct) => mediator.Send(cmd, ct));
// The endpoint doesn't know which handler, or which pipeline behaviours (validation, logging, transactions), will run.
```

**In .NET:** MediatR (commercial licence for larger companies since 2025), the source-generated **Mediator** library, Wolverine, Brighter; SignalR hubs (clients talk via the hub); and an aggregate root mediating access to its children. Trade-off: decoupling and a central pipeline vs indirection ("go to definition" no longer finds the handler). See [CQRS & Mediator](ch:cqrs-mediator-result).

## Template Method {i}

**Intent:** a base class defines the **skeleton of an algorithm**, and subclasses fill in specific steps.

```csharp
public abstract class ImportJob
{
    public async Task RunAsync(CancellationToken ct)          // the template: fixed sequence
    {
        var raw = await DownloadAsync(ct);
        var rows = Parse(raw);
        var valid = rows.Where(Validate).ToList();
        await SaveAsync(valid, ct);
        await OnCompletedAsync(valid.Count, ct);               // hook with a default
    }
    protected abstract Task<Stream> DownloadAsync(CancellationToken ct);
    protected abstract IEnumerable<ImportRow> Parse(Stream raw);
    protected virtual bool Validate(ImportRow r) => true;
    protected abstract Task SaveAsync(IReadOnlyList<ImportRow> rows, CancellationToken ct);
    protected virtual Task OnCompletedAsync(int count, CancellationToken ct) => Task.CompletedTask;
}
```

**In .NET:** `BackgroundService.ExecuteAsync`, `AuthenticationHandler<T>.HandleAuthenticateAsync`, `AuthorizationHandler<T>.HandleRequirementAsync`, `DbContext.OnModelCreating`/`OnConfiguring`, `JsonConverter<T>.Read/Write`, `Stream` subclasses. Strategy (composition) is often preferred when steps vary independently.

## State {i}

**Intent:** an object **changes its behaviour when its internal state changes**, with each state as its own class, instead of `if (status == …)` scattered everywhere.

```csharp
public abstract class OrderState
{
    public virtual OrderState Pay(Order o) => throw Invalid(nameof(Pay));
    public virtual OrderState Ship(Order o) => throw Invalid(nameof(Ship));
    public virtual OrderState Cancel(Order o) => throw Invalid(nameof(Cancel));
    private InvalidOperationException Invalid(string action) => new($"Cannot {action} an order that is {GetType().Name}");
}
public sealed class Placed : OrderState { public override OrderState Pay(Order o) => new Paid(); public override OrderState Cancel(Order o) => new Cancelled(); }
public sealed class Paid : OrderState { public override OrderState Ship(Order o) => new Shipped(); public override OrderState Cancel(Order o) { o.Refund(); return new Cancelled(); } }
public sealed class Shipped : OrderState { }
public sealed class Cancelled : OrderState { }
```

For simpler lifecycles, an **enum plus a transition table** or a library like **Stateless** is often enough. MassTransit sagas are state machines across services.

## Iterator, Visitor and the rest {a}

- **Iterator:** sequential access without exposing the structure. **Built into C#**: `IEnumerable<T>`/`IEnumerator<T>`, `foreach`, `yield return`, `IAsyncEnumerable<T>`.
- **Visitor:** add operations to a class hierarchy without changing it, via double dispatch. **In .NET:** `ExpressionVisitor` (EF Core's query translation is visitors all the way down, exactly the expression-tree walk [LINQ](ch:linq#expression-trees-how-c-becomes-sql) traced), Roslyn's `CSharpSyntaxVisitor`. Modern C# pattern matching (`switch` on types) often replaces simple visitors.
- **Memento:** capture and restore an object's state (undo, snapshots). Event sourcing snapshots are a relative.
- **Interpreter:** evaluate sentences in a small language (rule engines, query parsers). Expression trees and Roslyn scripting are related.

## Beyond GoF: patterns you'll meet in .NET backends {i}

| Pattern | Where it's covered |
|---|---|
| Dependency Injection / Service Locator (anti-pattern) | [Dependency injection](ch:dependency-injection) |
| Options pattern | [Configuration](ch:configuration-options) |
| Repository, Unit of Work, Specification | [App architectures](ch:app-architectures#repository-and-unit-of-work-a-debate-thats-really-about-ef-c) |
| CQRS, Mediator pipeline, Result | [CQRS & Result](ch:cqrs-mediator-result) |
| Aggregate, Value Object, Domain Event | [DDD](ch:ddd) |
| Outbox, Inbox, Saga, Competing Consumers | [Messaging & events](ch:messaging-events) |
| Retry, Circuit Breaker, Bulkhead, Timeout | [Resilience](ch:resilience) |
| API Gateway, BFF, Strangler Fig, Sidecar | [Microservices](ch:microservices) |
| Cache-Aside | [Caching](ch:caching-ratelimit-cors) |

:::qa Which design patterns does ASP.NET Core itself use?
Chain of Responsibility (the middleware pipeline, DelegatingHandlers, filters), Builder (WebApplicationBuilder, IServiceCollection, options builders), Factory (IHttpClientFactory, ILoggerFactory, IDbContextFactory), Decorator (DelegatingHandler, stream wrappers), Strategy (authentication schemes, naming policies, comparers), Observer (IOptionsMonitor.OnChange, change tokens), Template Method (BackgroundService, AuthenticationHandler), Adapter (logging providers), Facade (CreateBuilder) and Dependency Injection throughout.
:::

:::qa Strategy vs State?
Both put varying behaviour behind an interface. In Strategy, the client or configuration chooses an algorithm and the strategies are independent of each other. In State, the object itself transitions between state objects as its internal state changes, and states know about the transitions.
:::

:::qa Decorator vs Proxy vs Adapter?
Decorator and Proxy keep the same interface: a decorator adds behaviour (logging, caching), while a proxy controls access to the real object (lazy loading, remote, permissions). An adapter changes an interface into the one the client expects.
:::

:::qa How do you implement the Decorator pattern with DI?
Register the real implementation, then register the interface with a decorator that receives the inner instance, either via a factory lambda (`sp => new CachingRepo(sp.GetRequiredService<SqlRepo>(), …)`) or with Scrutor's Decorate&lt;TInterface, TDecorator&gt;(). Decorators can be stacked.
:::

:::qa Why is the Singleton pattern often called an anti-pattern, and what do you use instead?
A static Instance hides dependencies, introduces global mutable state, can't be replaced in tests, and couples callers to a concrete class. Use the DI container's singleton lifetime so there's still one instance, but it's injected explicitly and replaceable. It still must be thread-safe.
:::

:::qa Where does the Chain of Responsibility pattern appear in .NET?
The ASP.NET Core middleware pipeline (each component handles or passes to next), HttpClient's DelegatingHandler pipeline, MVC and endpoint filters, MediatR pipeline behaviours, and authorization handlers.
:::

:::qa What's the difference between the Command pattern and an event?
A command is a request to do something, addressed to one handler, named in the imperative (PlaceOrder), and it may be rejected. An event is a notification that something already happened, named in the past tense (OrderPlaced), published to zero or more subscribers, and it can't be rejected.
:::

:::qa When is the Builder pattern useful?
When constructing an object requires many optional parts or steps, when you want a readable fluent API and validation at Build(), or when the result should be immutable. Examples: WebApplicationBuilder, StringBuilder, test data builders.
:::

## Further reading

- *Design Patterns: Elements of Reusable Object-Oriented Software* (Gamma, Helm, Johnson, Vlissides), the original GoF book.
- *Head First Design Patterns* (2nd ed.): the most approachable introduction.
- [refactoring.guru/design-patterns](https://refactoring.guru/design-patterns) has excellent diagrams and C# examples for every GoF pattern.
- *Patterns of Enterprise Application Architecture* by Martin Fowler: Repository, Unit of Work, Data Mapper and more.

## Verify this chapter

The checks below instantiate six of the patterns above with plain, dependency-free stand-ins (no DI container, no HybridCache, no EF Core) and assert the one behavioural claim each pattern is actually known for. Save as `Program.cs` in a new console project (`dotnet new console`) and run with `dotnet run`.

```csharp
// Verifies claims from this chapter: Builder validates at Build(), Decorator composition
// order, Strategy picks an algorithm at runtime, Singleton (Lazy<T>) gives exactly one instance, State
// rejects invalid transitions, Composite treats a group of rules as a single rule.
using System;
using System.Collections.Generic;
using System.Linq;

int fails = 0;
void Ok(string s) => Console.WriteLine($"OK: {s}");
void Check(bool cond, string s)
{
    if (cond) Ok(s);
    else { Console.WriteLine($"FAIL: {s}"); fails++; }
}

// --- Builder: validates once at Build(), produces an immutable-ish result ---
Check(Throws(() => new ReportBuilder().Build()), "Builder.Build() throws when a required field (Title) was never set");
var report = new ReportBuilder().Titled("Q3 sales").Build();
Check(report.Title == "Q3 sales", "Builder.Build() succeeds once required fields are set");

// --- Decorator: stacking order is the order you wrap in, and wrapping doesn't change the interface ---
var trace = new List<string>();
IRepo traced = new TraceRepo(new SqlRepo(), trace, "Sql");
traced = new TraceRepo(traced, trace, "Caching");
traced = new TraceRepo(traced, trace, "Logging");
traced.Get();
Check(trace.SequenceEqual(new[] { "Logging", "Caching", "Sql" }), "Decorator: Logging→Caching→Sql registration runs outer-to-inner, in that order");

// --- Strategy: swapping the algorithm changes the result without changing the caller ---
IDiscount vip = new VipDiscount();
IDiscount none = new NoDiscount();
Check(vip.Discount(100) == 10 && none.Discount(100) == 0, "Strategy: selecting a different IDiscount changes behaviour without changing the caller");

// --- Singleton via Lazy<T>: every access returns the same instance ---
Check(ReferenceEquals(Clock.Instance, Clock.Instance), "Singleton (Lazy<T>): Clock.Instance always returns the same object");

// --- State: valid transitions succeed, invalid ones throw instead of silently doing nothing ---
OrderState placed = new Placed();
OrderState paid = placed.Pay();
Check(paid is Paid, "State: Placed.Pay() transitions to Paid");
Check(Throws(() => placed.Ship()), "State: Placed.Ship() is invalid and throws, instead of silently no-op'ing");

// --- Composite: a group of rules behaves like a single rule (uniform interface) ---
IPriceRule tenPct = new PercentOff(0.10m);
IPriceRule composite = new CompositeRule(new PercentOff(0.10m), new PercentOff(0.10m));
Check(composite.Apply(100) == tenPct.Apply(tenPct.Apply(100)), "Composite: applying a group of rules equals applying each rule in sequence");

Console.WriteLine(fails == 0 ? "\nAll checks passed." : $"\n{fails} check(s) failed.");
if (fails > 0) Environment.Exit(1);

static bool Throws(Action a) { try { a(); return false; } catch { return true; } }

sealed class ReportBuilder
{
    private string? _title;
    public ReportBuilder Titled(string t) { _title = t; return this; }
    public Report Build() => new(_title ?? throw new InvalidOperationException("Title required"));
}
sealed record Report(string Title);

interface IRepo { string Get(); }
sealed class SqlRepo : IRepo { public string Get() => "data"; }
sealed class TraceRepo(IRepo inner, List<string> trace, string name) : IRepo
{
    public string Get() { trace.Add(name); return inner.Get(); }
}

interface IDiscount { decimal Discount(decimal subtotal); }
sealed class NoDiscount : IDiscount { public decimal Discount(decimal s) => 0; }
sealed class VipDiscount : IDiscount { public decimal Discount(decimal s) => s * 0.10m; }

sealed class Clock
{
    private static readonly Lazy<Clock> _instance = new(() => new Clock());
    public static Clock Instance => _instance.Value;
    private Clock() { }
}

abstract class OrderState
{
    public virtual OrderState Pay() => throw new InvalidOperationException("Cannot Pay from " + GetType().Name);
    public virtual OrderState Ship() => throw new InvalidOperationException("Cannot Ship from " + GetType().Name);
}
sealed class Placed : OrderState { public override OrderState Pay() => new Paid(); }
sealed class Paid : OrderState { public override OrderState Ship() => new Shipped(); }
sealed class Shipped : OrderState { }

interface IPriceRule { decimal Apply(decimal price); }
sealed class PercentOff(decimal pct) : IPriceRule { public decimal Apply(decimal p) => p * (1 - pct); }
sealed class CompositeRule(params IPriceRule[] rules) : IPriceRule
{
    public decimal Apply(decimal p) => rules.Aggregate(p, (acc, r) => r.Apply(acc));
}
```
