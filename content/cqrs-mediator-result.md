---
id: cqrs-mediator-result
title: CQRS, the Mediator Pipeline and the Result Pattern
summary: Three patterns that shape modern .NET application layers. CQS vs CQRS, levels of CQRS from separate models to separate stores, commands and queries with handlers, the mediator and its pipeline behaviours (validation, logging, transactions), alternatives to MediatR, and the Result pattern for expected failures, compared with exceptions.
layer: arch
where: Application architecture › Application layer patterns
fits: These patterns live in the **application layer** of [Clean Architecture](ch:app-architectures) or inside [vertical slices](ch:app-architectures#vertical-slice-architecture-organising-by-feature-instead-of-by-role). Commands use the domain model ([DDD](ch:ddd)) and EF Core; queries often use projections or Dapper ([ADO.NET & Dapper](ch:ado-dapper)). At system scale, CQRS read models are fed by events ([Messaging & events](ch:messaging-events)).
levels: b,i,a
prereqs: app-architectures, design-patterns
next: ddd, messaging-events
---

## TL;DR

- **CQS** says a *method* shouldn't both change state and return data. **CQRS** scales that same idea up to a whole *architecture*: separate models for writes (commands) and reads (queries).
- CQRS is a spectrum: most teams should stop at "separate handlers, same database" (immediate consistency, low complexity) — separate physical read/write stores (eventual consistency) is a big jump, only worth it at real scale.
- A **mediator** (e.g. MediatR) just forwards a command/query to its one handler, but the real value is the **pipeline** wrapped around every handler: logging, validation, transactions, done once instead of in every handler.
- The **Result pattern** turns "this can fail" into part of a method's return type, instead of an exception the caller might forget to catch — use it for *expected* failures (not found, declined), keep exceptions for bugs and infrastructure failures.

## From a rule about methods to a rule about architecture {b}

**CQS** (Command-Query Separation, Bertrand Meyer) is a rule for **methods**: a method should either be a **command** (changes state, returns nothing) or a **query** (returns data, has no side effects), never both. Asking a question shouldn't change the answer — a useful discipline on its own, mentioned briefly back in [Design principles](ch:design-principles#other-principles-worth-naming).

**CQRS** (Command Query Responsibility Segregation, Greg Young) takes that exact same split and scales it up from a method to an entire architecture: use **separate models** (and code paths) for **writes** and **reads**.

```text
                        ┌─────────── Write side ───────────┐
POST /orders ─▶ PlaceOrder command ─▶ handler ─▶ domain model (aggregate rules) ─▶ EF Core ─▶ DB
                        └──────────────────────────────────┘
                        ┌─────────── Read side ────────────┐
GET /orders?… ─▶ ListOrders query ─▶ handler ─▶ projection / Dapper / read model ─▶ DTOs
                        └──────────────────────────────────┘
```

:::why Why separate reads and writes
They have **different needs**. Writes need **rich behaviour and invariants**: load an aggregate, apply rules, save atomically. Reads need **speed and shape**: flat DTOs tailored to each screen, joins across aggregates, no tracking, often cached. Force one model to serve both and it ends up mediocre at either job: entities get polluted with UI fields, read queries get forced through aggregates, and N+1 queries creep in. Reads also usually outnumber writes 10–100×, so splitting them means each side can be **scaled and optimised separately**.
:::

## Levels of CQRS: a spectrum, not a binary choice {i}

CQRS is a spectrum, and most teams should stop well before the far end:

| Level | Write side | Read side | Consistency | Complexity |
|---|---|---|---|---|
| **0: none** | Same model for everything | Same | Immediate | Lowest |
| **1: separate code paths** | Command handlers + domain model + EF Core | Query handlers + projections (`Select`) / Dapper, **same database** | **Immediate** | Low; a great default |
| **2: separate read models in the same DB** | Same | Denormalised read tables/views, updated in the same transaction or by triggers/events | Immediate or near-immediate | Medium |
| **3: separate stores** | SQL (or an event store) | Read DB (Cosmos, Elasticsearch, Redis), updated **asynchronously** from events | **Eventual** | High: projections, replay, lag handling |
| **+ Event Sourcing** | Store events, not state | Projections built from the event stream | Eventual | Highest |

Notice where the complexity genuinely jumps: levels 1 and 2 stay inside one database and one transaction, so consistency is immediate and the mental model barely changes from a normal CRUD app. Level 3 introduces something qualitatively different — **eventual consistency** — because the read model is now updated asynchronously, after the fact, by something reacting to events rather than participating in the original transaction.

:::gotcha CQRS is not Event Sourcing
They're often mentioned together, but they're independent. You can do CQRS without event sourcing (levels 1–3) and, rarely, event sourcing without separate read models. Level 3 introduces **eventual consistency**: after a POST, an immediate GET may not see the change yet, and the UI must handle that.
:::

## Commands and queries in code {i}

```csharp
// ── Commands: intent to change state; imperative names; return little (an id, a Result) ──
public sealed record PlaceOrderCommand(CustomerId CustomerId, IReadOnlyList<OrderLineInput> Lines, string PaymentToken);

public sealed class PlaceOrderHandler(IOrderRepository orders, IPricing pricing, IPaymentGateway payments, IUnitOfWork uow)
{
    public async Task<Result<OrderId>> Handle(PlaceOrderCommand cmd, CancellationToken ct)
    {
        var priced = await pricing.PriceAsync(cmd.Lines, ct);
        var order = Order.Place(cmd.CustomerId, priced);                 // domain rules
        var charge = await payments.ChargeAsync(order.Total, cmd.PaymentToken, ct);
        if (!charge.Succeeded) return OrderErrors.PaymentDeclined(charge.Reason);
        orders.Add(order);
        await uow.SaveChangesAsync(ct);
        return order.Id;
    }
}

// ── Queries: return data, no side effects; shaped for the caller ──
public sealed record GetOrderHistoryQuery(CustomerId CustomerId, int Page, int PageSize);
public sealed record OrderHistoryItem(Guid Id, DateTimeOffset PlacedAt, string Status, decimal Total, int Items);

public sealed class GetOrderHistoryHandler(ShopDb db)
{
    public async Task<PagedResult<OrderHistoryItem>> Handle(GetOrderHistoryQuery q, CancellationToken ct)
    {
        var query = db.Orders.AsNoTracking().Where(o => o.CustomerId == q.CustomerId);
        var total = await query.CountAsync(ct);
        var items = await query.OrderByDescending(o => o.PlacedAt)
            .Skip((q.Page - 1) * q.PageSize).Take(q.PageSize)
            .Select(o => new OrderHistoryItem(o.Id.Value, o.PlacedAt, o.Status.ToString(), o.Total.Amount, o.Lines.Count))
            .ToListAsync(ct);
        return new(items, q.Page, q.PageSize, total);
    }
}
```

Notice how different these two handlers actually are in shape, not just in name: `PlaceOrderHandler` loads a rich `Order` aggregate and calls its own methods, while `GetOrderHistoryHandler` never touches the domain model at all — it projects straight from `DbSet` to DTO, exactly the pattern [EF Core querying](ch:efcore-querying#projection-the-single-biggest-win-in-this-chapter) recommended for every read endpoint. Rules of thumb that fall out of this: **queries never modify state**; queries can bypass the domain model entirely; **commands go through aggregates**; one handler per command or query.

## The mediator pattern and pipeline behaviours {i}

A **mediator** dispatches a request object to its **single handler**, so the sender doesn't need a reference to the handler directly. That indirection alone is a modest convenience — its real value is the **pipeline** it enables: behaviours that wrap **every** handler, giving you one place to put cross-cutting concerns, exactly the role [Middleware](ch:middleware) plays for HTTP requests, now scoped to your application layer instead.

```text
Endpoint ─▶ mediator.Send(cmd) ─▶ [Logging] ─▶ [Validation] ─▶ [Authorization] ─▶ [Transaction] ─▶ Handler
                                    pipeline behaviours (a chain of responsibility around handlers)
```

With **MediatR** (the best-known library):

```csharp
public sealed record PlaceOrderCommand(…) : IRequest<Result<OrderId>>;
public sealed class PlaceOrderHandler(…) : IRequestHandler<PlaceOrderCommand, Result<OrderId>>
{
    public async Task<Result<OrderId>> Handle(PlaceOrderCommand cmd, CancellationToken ct) { /* … */ }
}

public sealed class ValidationBehavior<TRequest, TResponse>(IEnumerable<IValidator<TRequest>> validators)
    : IPipelineBehavior<TRequest, TResponse> where TRequest : notnull where TResponse : IResult
{
    public async Task<TResponse> Handle(TRequest request, RequestHandlerDelegate<TResponse> next, CancellationToken ct)
    {
        var failures = (await Task.WhenAll(validators.Select(v => v.ValidateAsync(request, ct))))
            .SelectMany(r => r.Errors).ToList();
        if (failures.Count > 0) return (TResponse)ResultFactory.ValidationFailure(typeof(TResponse), failures);  // short-circuit
        return await next();
    }
}

public sealed class LoggingBehavior<TRequest, TResponse>(ILogger<TRequest> log) : IPipelineBehavior<TRequest, TResponse> where TRequest : notnull
{
    public async Task<TResponse> Handle(TRequest request, RequestHandlerDelegate<TResponse> next, CancellationToken ct)
    {
        var name = typeof(TRequest).Name;
        var sw = Stopwatch.StartNew();
        log.LogInformation("Handling {Request}", name);
        var response = await next();
        log.LogInformation("Handled {Request} in {Elapsed} ms", name, sw.ElapsedMilliseconds);
        return response;
    }
}

builder.Services.AddMediatR(c =>
{
    c.RegisterServicesFromAssemblyContaining<PlaceOrderHandler>();
    c.AddOpenBehavior(typeof(LoggingBehavior<,>));
    c.AddOpenBehavior(typeof(ValidationBehavior<,>));
    c.AddOpenBehavior(typeof(TransactionBehavior<,>));
});

app.MapPost("/orders", async (PlaceOrderCommand cmd, ISender sender, CancellationToken ct) => (await sender.Send(cmd, ct)).ToHttp());
```

Notice `ValidationBehavior`'s `next()` call is exactly the same shape as the request delegate chain in the middleware pipeline — it either calls onward or short-circuits, and the registration order of the three behaviours above determines the order they wrap the handler in, the same reverse-composition idea covered in full in [Middleware](ch:middleware#now-heres-the-aha-a-middleware-is-just-a-function-wrapping-a).

MediatR also has **notifications** (`INotification` with multiple `INotificationHandler`s, i.e. in-process publish/subscribe), often used to dispatch domain events.

### Is a mediator library necessary?

| Option | Notes |
|---|---|
| **MediatR** | Popular and mature. **Commercial licence since v13 (2025)** for organisations above a revenue threshold |
| **Mediator** (martinothamar) | Source-generated, MIT, very fast, near-identical API |
| **Wolverine** | Mediator + messaging + outbox in one framework |
| **Brighter / Darker** | Command processor plus messaging |
| **No library** | Inject handlers directly (`PlaceOrderHandler`) and use **decorators** or endpoint filters for cross-cutting concerns. Simplest, explicit, and "Go to definition" works |

The honest tradeoff behind all of this: indirection hides call graphs, a mediator is "service locator in disguise" when overused, and it's genuinely unnecessary ceremony for a small app with a handful of use cases. Against that: a uniform pipeline, decoupled endpoints, and an easy, repeatable per-use-case structure that scales well as the number of use cases grows. A good interview answer acknowledges both sides rather than picking a tribe.

## The Result pattern: making expected failure part of the method's contract {i}

**Problem:** many failures are **expected outcomes**, not exceptional situations: "order not found", "insufficient stock", "email already registered", "card declined". Using exceptions for them creates a specific, recurring set of problems:

- is **invisible in the signature**: `Task<Order> PlaceAsync()` doesn't tell you it can fail in five ways,
- is **expensive** (stack trace capture and unwinding) under load,
- turns control flow into `try/catch` at a distance,
- makes it easy to forget a case.

**Result pattern:** return an object that is **either a success with a value or a failure with an error**, and make callers handle both — turning "this can fail" from something buried in documentation (or nowhere) into something the compiler can see.

```csharp
public sealed record Error(string Code, string Message, ErrorType Type = ErrorType.Failure)
{
    public static readonly Error None = new("", "");
}
public enum ErrorType { Failure, Validation, NotFound, Conflict, Unauthorized }

public class Result
{
    protected Result(bool ok, Error error) { IsSuccess = ok; Error = error; }
    public bool IsSuccess { get; }
    public bool IsFailure => !IsSuccess;
    public Error Error { get; }
    public static Result Success() => new(true, Error.None);
    public static Result Failure(Error e) => new(false, e);
    public static Result<T> Success<T>(T value) => new(value, true, Error.None);
    public static Result<T> Failure<T>(Error e) => new(default, false, e);
}

public sealed class Result<T> : Result
{
    private readonly T? _value;
    internal Result(T? value, bool ok, Error e) : base(ok, e) => _value = value;
    public T Value => IsSuccess ? _value! : throw new InvalidOperationException("No value for a failed result");
    public static implicit operator Result<T>(T value) => Success(value);          // return order.Id;
    public static implicit operator Result<T>(Error error) => Failure<T>(error);   // return OrderErrors.NotFound(id);
}

public static class OrderErrors
{
    public static Error NotFound(OrderId id) => new("order.not_found", $"Order {id} was not found", ErrorType.NotFound);
    public static readonly Error AlreadyShipped = new("order.already_shipped", "Shipped orders can't be cancelled", ErrorType.Conflict);
    public static Error PaymentDeclined(string reason) => new("order.payment_declined", $"Payment declined: {reason}", ErrorType.Failure);
}
```

Notice the two implicit operators on `Result<T>`: they're what let `PlaceOrderHandler`, back in the commands section, simply `return order.Id;` on success or `return OrderErrors.PaymentDeclined(charge.Reason);` on failure, with no explicit `Result.Success(...)` wrapping needed at either call site — the type conversion happens invisibly, which is exactly why the handler code reads so cleanly.

Using it, and mapping to HTTP **once** at the edge:

```csharp
// Domain/application code returns errors as values
public Result Cancel(string reason)
{
    if (Status == OrderStatus.Shipped) return OrderErrors.AlreadyShipped;
    Status = OrderStatus.Cancelled;
    Raise(new OrderCancelled(Id, reason));
    return Result.Success();
}

// Presentation: one mapping for the whole API
public static IResult ToHttp<T>(this Result<T> r) => r.IsSuccess ? Results.Ok(r.Value) : r.Error.ToProblem();
public static IResult ToProblem(this Error e) => Results.Problem(
    title: e.Message, type: e.Code,
    statusCode: e.Type switch
    {
        ErrorType.Validation => 400, ErrorType.NotFound => 404, ErrorType.Conflict => 409, ErrorType.Unauthorized => 403, _ => 422
    });
```

The payoff of `ToHttp` and `ToProblem` existing as exactly two small, shared methods: every single endpoint in the API maps a `Result` to an HTTP response the same way, once, rather than each handler re-deciding what status code "not found" should mean. Libraries: **ErrorOr**, **FluentResults**, **Ardalis.Result**, **OneOf** (discriminated-union style), **CSharpFunctionalExtensions**. "Railway-oriented programming" adds `Map`/`Bind` combinators to chain operations that may fail.

### Exceptions vs Results

| Use **exceptions** for | Use **Results** for |
|---|---|
| Bugs and broken invariants (null where impossible, invalid state) | Business rule rejections |
| Infrastructure failures: DB down, timeouts, network errors | Validation failures |
| Things the immediate caller can't handle meaningfully | "Not found", "already exists", "not allowed" in normal flow |
| Constructors and framework callbacks that can't return a value | Anything the caller is *expected* to branch on |

Both coexist in a healthy codebase: Results for the expected paths this whole section covers, plus a global `IExceptionHandler` ([Errors & logging](ch:errors-logging#iexceptionhandler-mapping-exception-types-to-http-responses)) for the unexpected ones nobody wrote a specific handler for. C# doesn't yet have built-in discriminated unions (a frequently discussed future feature), which is exactly why libraries like the ones above exist to fill that gap in the meantime.

:::qa What is CQRS and when is it worth using?
Separating the write model (commands handled through the domain model) from the read model (queries returning DTOs via optimised projections or a separate store). Worth it when reads and writes have very different shapes or loads, or the domain is complex. Start with separate handlers on one database; separate stores add eventual consistency and should be justified by scale.
:::

:::qa What is the difference between CQS and CQRS?
CQS is a method-level rule: a method either changes state or returns data, not both. CQRS applies the idea to architecture, with separate models, handlers and possibly data stores for commands and queries.
:::

:::qa Is CQRS the same as event sourcing?
No. CQRS separates reads from writes; event sourcing stores state as a sequence of events. They're complementary (event-sourced systems usually need CQRS read models) but independent.
:::

:::qa What problem does the mediator pattern solve in an application layer?
It decouples senders (endpoints, consumers) from handlers and provides a pipeline of behaviours around every request: validation, logging, authorization, transactions, caching. Cross-cutting concerns are implemented once instead of in every handler.
:::

:::qa What are the downsides of MediatR?
Indirection (it's harder to navigate from caller to handler), runtime reflection-based resolution, possible overuse for trivial calls, and since 2025 a commercial licence for larger companies. Alternatives include source-generated Mediator, Wolverine, or injecting handlers directly with decorators.
:::

:::qa What is the Result pattern and why use it instead of exceptions?
Returning an explicit success-or-failure object (with a typed error) from operations whose failures are expected. It makes failure part of the method contract, forces callers to handle it, avoids the cost and non-local control flow of exceptions, and allows mapping errors to HTTP responses in one place. Exceptions remain for truly exceptional, unexpected conditions.
:::

:::qa How would you implement validation in a CQRS/MediatR setup?
FluentValidation validators per command, executed by a ValidationBehavior pipeline behaviour before the handler, which short-circuits with a validation-failure Result (or throws a ValidationException mapped to 400 ProblemDetails). Keep business-rule checks that need aggregates inside the domain.
:::

## Further reading

- Martin Fowler, ["CQRS"](https://martinfowler.com/bliki/CQRS.html) and ["CommandQuerySeparation"](https://martinfowler.com/bliki/CommandQuerySeparation.html)
- [CQRS pattern (Azure Architecture Center)](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs)
- [MediatR on GitHub](https://github.com/jbogard/MediatR) · [Mediator (source-generated)](https://github.com/martinothamar/Mediator) · [ErrorOr](https://github.com/amantinband/error-or)
- Scott Wlaschin, "Railway Oriented Programming" (talk/article).

## Verify this chapter

MediatR and the other libraries mentioned above aren't referenced here — the checks below build a minimal, dependency-free `Result<T>` and a minimal mediator pipeline to verify the actual mechanics this chapter describes (implicit conversions, error-to-status mapping, pipeline ordering and short-circuiting), without needing a package. Save as `Program.cs` in a new console project (`dotnet new console`) and run with `dotnet run`.

```csharp
// Verifies claims from this chapter: Result<T>'s implicit conversions let a handler
// just "return value" or "return error", mapping an error to the right HTTP-style status, and a minimal
// mediator pipeline runs its behaviours in registration order and can short-circuit before the handler.
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

// --- Result<T>: implicit operators let a method "return value" or "return error" directly ---
Result<Guid> Place(bool approve)
{
    if (!approve) return OrderErrors.PaymentDeclined("insufficient_funds");   // implicit Error -> Result<T>
    return Guid.NewGuid();                                                    // implicit T -> Result<T>
}

var declined = Place(approve: false);
var approved = Place(approve: true);
Check(declined.IsFailure && declined.Error.Code == "order.payment_declined", "Result<T>: an Error converts implicitly into a failed Result");
Check(approved.IsSuccess && approved.Value != Guid.Empty, "Result<T>: a T converts implicitly into a successful Result");
Check(Throws(() => _ = declined.Value), "Result<T>.Value throws on a failed result instead of returning a default value silently");

// --- Mapping a Result's error to an HTTP-style status happens once, not per-handler ---
Check(declined.Error.Type == ErrorType.Failure && StatusFor(declined.Error) == 422, "Error -> status mapping: a generic failure maps to 422");
Check(StatusFor(OrderErrors.NotFound()) == 404, "Error -> status mapping: NotFound maps to 404");

// --- Mediator pipeline: behaviours run in registration order and can short-circuit before the handler ---
var trace = new List<string>();
var pipeline = BuildPipeline(trace,
    next => () => { trace.Add("Logging"); var r = next(); return r; },
    next => () => { trace.Add("Validation"); return "short-circuited"; },   // fails validation, never calls next()
    next => () => { trace.Add("Handler"); return next(); });
var result = pipeline();
Check(trace.SequenceEqual(new[] { "Logging", "Validation" }), "Mediator pipeline: behaviours run in the order they were registered");
Check(result == "short-circuited" && !trace.Contains("Handler"), "Mediator pipeline: a behaviour can short-circuit and skip the handler entirely");

Console.WriteLine(fails == 0 ? "\nAll checks passed." : $"\n{fails} check(s) failed.");
if (fails > 0) Environment.Exit(1);

static bool Throws(Action a) { try { a(); return false; } catch { return true; } }

static int StatusFor(Error e) => e.Type switch
{
    ErrorType.Validation => 400, ErrorType.NotFound => 404, ErrorType.Conflict => 409, ErrorType.Unauthorized => 403, _ => 422
};

static Func<string> BuildPipeline(List<string> trace, params Func<Func<string>, Func<string>>[] behaviours)
{
    Func<string> pipeline = () => { trace.Add("(unreachable terminal)"); return "unreachable"; };
    for (int i = behaviours.Length - 1; i >= 0; i--) pipeline = behaviours[i](pipeline);
    return pipeline;
}

sealed record Error(string Code, string Message, ErrorType Type = ErrorType.Failure)
{
    public static readonly Error None = new("", "");
}
enum ErrorType { Failure, Validation, NotFound, Conflict, Unauthorized }

class Result
{
    protected Result(bool ok, Error error) { IsSuccess = ok; Error = error; }
    public bool IsSuccess { get; }
    public bool IsFailure => !IsSuccess;
    public Error Error { get; }
    public static Result<T> Success<T>(T value) => new(value, true, Error.None);
    public static Result<T> Failure<T>(Error e) => new(default, false, e);
}

sealed class Result<T> : Result
{
    private readonly T? _value;
    internal Result(T? value, bool ok, Error e) : base(ok, e) => _value = value;
    public T Value => IsSuccess ? _value! : throw new InvalidOperationException("No value for a failed result");
    public static implicit operator Result<T>(T value) => Success(value);
    public static implicit operator Result<T>(Error error) => Failure<T>(error);
}

static class OrderErrors
{
    public static Error NotFound() => new("order.not_found", "Order was not found", ErrorType.NotFound);
    public static Error PaymentDeclined(string reason) => new("order.payment_declined", $"Payment declined: {reason}", ErrorType.Failure);
}
```
