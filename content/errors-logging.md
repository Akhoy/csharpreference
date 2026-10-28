---
id: errors-logging
title: Error Handling, ProblemDetails and Logging
summary: Turning failures into consistent HTTP responses and searchable logs. The exception-handling middleware and IExceptionHandler, ProblemDetails (RFC 9457), status code pages, the ILogger abstraction, levels and categories, structured logging and message templates, scopes, high-performance logging, Serilog and sinks, and what (not) to log.
layer: framework
where: ASP.NET Core › Cross-cutting › Errors & logging
fits: Exception handling is a middleware ([Middleware](ch:middleware)) at the very front of the pipeline, and logging is host plumbing ([Hosting](ch:aspnet-hosting)). Together they are the first half of observability, a layer-8 concern; the second half (metrics and traces, OpenTelemetry) is in [Observability & Aspire](ch:observability-aspire).
levels: b,i,a
prereqs: middleware, exceptions-disposal
next: auth, observability-aspire, cqrs-mediator-result
---

## TL;DR

- A single failure has two audiences: the **client** gets a safe, consistent `ProblemDetails` response; your **logs** get the full, searchable detail (exception, context, trace ID). Never mix the two up.
- `app.UseExceptionHandler()` must be the outermost middleware, so it can catch exceptions from everything registered after it. `IExceptionHandler` implementations are tried in registration order until one claims the exception.
- **ProblemDetails** (RFC 9457) is a standard JSON shape for API errors — `type`/`title`/`status`/`detail` everywhere — so any client can handle errors from any endpoint the same way.
- `ILogger<T>` is one API with pluggable destinations (console, Application Insights, Serilog). Log with **message templates** (`"{OrderId}"`), not string interpolation, so fields stay queryable.
- **Scopes** attach extra fields (like `OrderId`) to every log line written inside a block, even across an `await`, because they ride on `AsyncLocal`.
- Never log secrets, tokens, or full PII. Log IDs, not whole objects, and reach for `[LoggerMessage]` in hot paths where the logging call itself costs enough to matter.

## Two very different audiences for the same failure {b}

Something goes wrong in your app — a payment fails, a database call times out, a bug throws a `NullReferenceException`. That single event has to serve **two completely different audiences**, each with a different need:

1. **The client** needs a consistent, safe, machine-readable error: the right status code, a predictable body shape, and critically, **no stack traces or internal implementation details** — those are a gift to an attacker and useless to a legitimate caller.
2. **The developers** need the opposite: a detailed, searchable record of exactly what happened — the exception, the surrounding context (which user, which order ID, which trace), and the request path — sitting in logs they can actually query later.

ASP.NET Core gives you one tool for each: **ProblemDetails** answers the client, **ILogger** answers the developers. They're deliberately separate, and conflating them — accidentally putting a stack trace in the response body, say — is exactly the mistake this chapter is structured to help you avoid.

## Exception handling in the pipeline: where it has to sit, and why {b}

An unhandled exception bubbles upward through the middleware chain exactly the way the "after `next()`" code did in [Middleware](ch:middleware#now-heres-the-aha-a-middleware-is-just-a-function-wrapping-a) — except instead of returning normally, it propagates as a thrown exception. For the exception handler to actually catch everything, it has to be the **outermost** wrapper, registered first:

```csharp
builder.Services.AddProblemDetails();                              // standard error bodies
builder.Services.AddExceptionHandler<DomainExceptionHandler>();     // your handlers, tried in order
builder.Services.AddExceptionHandler<GlobalExceptionHandler>();

var app = builder.Build();
app.UseExceptionHandler();      // FIRST: catches exceptions from everything after it
app.UseStatusCodePages();       // gives empty 4xx/5xx responses (e.g. 404 from routing) a ProblemDetails body
```

| Environment | Default behaviour |
|---|---|
| Development | **Developer Exception Page**: stack trace, query, headers, routing info (added automatically) |
| Production | `UseExceptionHandler`: logs the exception, returns a generic 500 ProblemDetails |

That split is deliberate, not accidental: you *want* the raw stack trace while you're developing, and you *never* want it once real users are hitting the app.

## IExceptionHandler: mapping exception types to HTTP responses {i}

Since .NET 8, this is the standard hook for turning exceptions into responses. Handlers are tried **in registration order**, and each one gets to say "not mine" by returning `false`, letting the next handler have a turn:

```csharp
public sealed class DomainExceptionHandler(IProblemDetailsService problems, ILogger<DomainExceptionHandler> log) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext ctx, Exception ex, CancellationToken ct)
    {
        var (status, title) = ex switch
        {
            NotFoundException          => (StatusCodes.Status404NotFound, "Resource not found"),
            DomainException d          => (StatusCodes.Status409Conflict, d.Message),
            DbUpdateConcurrencyException => (StatusCodes.Status409Conflict, "The resource was modified by someone else"),
            UnauthorizedAccessException => (StatusCodes.Status403Forbidden, "Forbidden"),
            _ => (0, null)
        };
        if (status == 0) return false;                       // not mine: let the next handler try

        log.LogWarning(ex, "Handled {ExceptionType}: {Title}", ex.GetType().Name, title);
        ctx.Response.StatusCode = status;
        return await problems.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = ctx,
            Exception = ex,
            ProblemDetails = { Status = status, Title = title, Type = $"https://errors.shop.com/{status}" }
        });
    }
}

public sealed class GlobalExceptionHandler(IProblemDetailsService problems, ILogger<GlobalExceptionHandler> log) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext ctx, Exception ex, CancellationToken ct)
    {
        if (ex is OperationCanceledException && ctx.RequestAborted.IsCancellationRequested)
        {
            ctx.Response.StatusCode = 499;                     // client closed request; not a server error
            return true;
        }
        log.LogError(ex, "Unhandled exception for {Method} {Path}", ctx.Request.Method, ctx.Request.Path);
        ctx.Response.StatusCode = StatusCodes.Status500InternalServerError;
        return await problems.TryWriteAsync(new() { HttpContext = ctx, Exception = ex,
            ProblemDetails = { Title = "An unexpected error occurred", Status = 500 } });
    }
}
```

Registration order matters here: `DomainExceptionHandler` (specific) goes first, so it gets first refusal on exception types it recognizes. `GlobalExceptionHandler` (catch-all) goes last, as the backstop for whatever nobody else claimed. (**Before .NET 8**, you'd see the same idea written by hand as custom middleware — `try { await next(ctx); } catch (Exception ex) { … }` — or `UseExceptionHandler(errorApp => …)` with `IExceptionHandlerFeature`. Same shape, considerably more boilerplate.)

:::tip Exceptions vs results for expected failures
Mapping exceptions centrally like this is convenient, but it's worth being honest about a real cost: throwing for **expected** outcomes — not found, a failed validation, a business rule rejecting the request — is genuinely expensive (exceptions capture stack traces) and it hides control flow behind `try`/`catch` instead of making the possible outcomes visible in a method's signature. Many teams instead return a **Result** from the application layer and map it to HTTP right in the endpoint, reserving `IExceptionHandler` for the exceptions that are genuinely unexpected. See [CQRS & Result](ch:cqrs-mediator-result#the-result-pattern-making-expected-failure-part-of-the-metho).
:::

## ProblemDetails: one shape for every error, across every API you'll ever call {b}

**RFC 9457** (which replaced the earlier RFC 7807) defines a standard JSON shape for HTTP API errors, served as `application/problem+json`:

```json
{
  "type": "https://errors.shop.com/409",
  "title": "Shipped orders can't be cancelled",
  "status": 409,
  "detail": "Order 1042 shipped on 2026-10-20.",
  "instance": "/api/orders/1042/cancel",
  "traceId": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  "requestId": "0HN7…"
}
```

| Field | Meaning |
|---|---|
| `type` | A URI identifying the **kind** of problem (documentation link); defaults to `about:blank` |
| `title` | Short, human-readable summary of the kind |
| `status` | HTTP status code |
| `detail` | Explanation specific to this occurrence |
| `instance` | URI of this occurrence (often the request path) |
| extensions | Anything else: `traceId`, `errors` (validation), `code` |

**ValidationProblemDetails** is the same shape with one addition — an `errors` dictionary, field name to list of messages:

```json
{ "title": "One or more validation errors occurred.", "status": 400,
  "errors": { "Lines": ["An order needs at least one line"], "CustomerId": ["Must be greater than 0"] } }
```

You can customise every ProblemDetails response centrally, in one place, instead of repeating logic across every handler:

```csharp
builder.Services.AddProblemDetails(o => o.CustomizeProblemDetails = ctx =>
{
    ctx.ProblemDetails.Instance = $"{ctx.HttpContext.Request.Method} {ctx.HttpContext.Request.Path}";
    ctx.ProblemDetails.Extensions["traceId"] = Activity.Current?.Id ?? ctx.HttpContext.TraceIdentifier;
});
```

:::why Why the trace ID matters more than it looks
Think about what happens without it: a customer reports "I got an error," and you have... a vague timestamp, maybe, and no way to find the exact request in millions of log lines. With a `traceId` in the response body, that single value lets you jump straight to **the exact logs and distributed trace** for that one request, in seconds rather than a frustrating search. It's the bridge connecting "what the client saw" to "what actually happened on the server" — and it only works if you actually put it in the response, which is precisely what the customization above does.
:::

## The logging abstraction: one API, many destinations {b}

`Microsoft.Extensions.Logging` gives your code a single API, **`ILogger<T>`**, and lets the *host* decide where those log entries actually end up — console, a file, Application Insights, several of these at once — through a set of configurable **providers**. Your business code never needs to know or care which.

```csharp
public sealed class PaymentService(ILogger<PaymentService> logger, IPaymentGateway gateway)
{
    public async Task<PaymentResult> ChargeAsync(Order order, CancellationToken ct)
    {
        logger.LogInformation("Charging order {OrderId} for {Amount} {Currency}", order.Id, order.Total.Amount, order.Total.Currency);
        try
        {
            var result = await gateway.ChargeAsync(order.Total, ct);
            if (!result.Succeeded)
                logger.LogWarning("Payment declined for order {OrderId}: {DeclineCode}", order.Id, result.DeclineCode);
            return result;
        }
        catch (HttpRequestException ex)
        {
            logger.LogError(ex, "Payment gateway call failed for order {OrderId}", order.Id);
            throw;
        }
    }
}
```

The **category** attached to every log line from this class is the full type name of `T` — `Shop.Payments.PaymentService` — and that's exactly what lets you dial logging verbosity up or down per namespace, as the next section shows.

### Log levels: a severity ladder, not just labels

| Level | Use for | Production default? |
|---|---|---|
| `Trace` | Very detailed, may include sensitive data | Off |
| `Debug` | Developer diagnostics | Off |
| `Information` | Normal flow milestones: "Order placed", "Job finished" | **On** |
| `Warning` | Unexpected but handled: retries, declined payments, slow calls | On |
| `Error` | A failure of the current operation: exceptions, failed requests | On |
| `Critical` | The app or a major subsystem is failing: data loss, startup failure | On |

```json
"Logging": {
  "LogLevel": {
    "Default": "Information",
    "Microsoft.AspNetCore": "Warning",                       // framework noise down
    "Microsoft.EntityFrameworkCore.Database.Command": "Warning",  // set to Information to see SQL
    "Shop.Payments": "Debug"                                 // more detail for one area
  }
}
```

This is the exact same layered configuration mechanism from [Configuration](ch:configuration-options#the-five-layers-lowest-priority-to-highest), applied to log-level settings specifically — which is why you can crank `Shop.Payments` up to `Debug` in one environment via an environment variable, without touching the base `appsettings.json` at all.

## Structured logging: keeping the data, not just the sentence {b}

Here's a distinction easy to miss on a first read: the string `"Charging order {OrderId} for {Amount}"` is a **message template**, not an interpolated string, and that's the whole point of writing it this way. The logger keeps `OrderId` and `Amount` as **named properties**, separately from the rendered text, and a structured sink — Application Insights, Seq, Elasticsearch, Loki, Datadog — stores each one as a real, queryable field rather than burying it inside an opaque sentence:

```text
// Query in Application Insights / Log Analytics (KQL)
traces | where customDimensions.OrderId == "1042"

// Seq
OrderId = 1042 and @Level = 'Error'
```

Now compare the three calls below, because the difference between the first and the other two is exactly what makes structured logging valuable in the first place:

```csharp
logger.LogInformation("Order {OrderId} placed", order.Id);        // ✔ structured: OrderId is a field
logger.LogInformation($"Order {order.Id} placed");                // ✘ one opaque string; also allocates even if Information is disabled
logger.LogInformation("Order placed: {@Order}", order);           // @ = destructure the object (Serilog); careful with size and PII
```

The second line *looks* equivalent and produces visually identical console output, but it has thrown away the structure — there's no `OrderId` field for a query tool to filter on, just a string that happens to contain a number. It also pays the cost of formatting that string **even when `Information` logging is disabled entirely**, which the template form avoids. Two naming disciplines keep this consistent across a codebase: **PascalCase** placeholder names, and the *same* name everywhere — always `OrderId`, never `orderId` in one place and `Id` in another — because a query tool treats those as entirely different fields. And never reach for string interpolation in a log call at all; the analyzer rule **CA2254** exists specifically to catch this.

## Log scopes: attaching context to everything inside a block {i}

A scope attaches a set of properties to **every single log line written inside it**, for as long as the block is open — which is exactly the mechanism correlation IDs rely on:

```csharp
using (logger.BeginScope(new Dictionary<string, object> { ["OrderId"] = order.Id, ["CustomerId"] = order.CustomerId }))
{
    logger.LogInformation("Reserving stock");     // carries OrderId and CustomerId
    await stock.ReserveAsync(order, ct);           // logs inside here carry them too (scopes flow via AsyncLocal)
    logger.LogInformation("Stock reserved");
}
```

The scope survives across that `await` — even onto a different thread — because it's carried by `AsyncLocal`, the same ambient-state mechanism the async state machine relies on in [Async and await](ch:async-await). Logging didn't have to invent anything new for this. ASP.NET Core uses the same trick automatically: it wraps every request in a scope carrying `RequestId`, `RequestPath`, `TraceId` and `SpanId`, so any log line anywhere in that request's call graph can be traced straight back to its request and its place in a distributed trace. Turn this on in the console provider with `"IncludeScopes": true`.

## High-performance logging: when the logging call itself becomes the bottleneck {a}

Every ordinary `logger.LogInformation(template, args)` call does real work before it even checks whether anything will be written: it boxes value-type arguments into an `object[]`, and looks up the (cached) parsed template. That overhead adds up in a hot path — something called thousands of times a second — and the source-generated **`[LoggerMessage]`** attribute exists to eliminate it:

```csharp
public static partial class OrderLog
{
    [LoggerMessage(EventId = 1001, Level = LogLevel.Information, Message = "Order {OrderId} placed by customer {CustomerId}")]
    public static partial void OrderPlaced(this ILogger logger, int orderId, int customerId);

    [LoggerMessage(EventId = 1002, Level = LogLevel.Warning, Message = "Stock low for {Sku}: {Remaining} left")]
    public static partial void StockLow(this ILogger logger, string sku, int remaining);
}

logger.OrderPlaced(order.Id, order.CustomerId);   // checks IsEnabled first, no boxing, no params array
```

The generated method checks `IsEnabled` as the very first thing, before touching the arguments at all, so a disabled log level costs almost nothing. For anything not covered by a generated method, the manual equivalent is `if (logger.IsEnabled(LogLevel.Debug)) { ... }` around any argument that's itself expensive to compute. Analyzer **CA1848** flags hot-path calls where `LoggerMessage` would help.

## Providers and Serilog: where the log lines actually go {i}

| Provider / library | Notes |
|---|---|
| Console, Debug, EventSource, EventLog | Built in |
| **OpenTelemetry** (`AddOpenTelemetry().WithLogging()`) | Export logs alongside traces and metrics via OTLP; vendor-neutral |
| **Application Insights** / Azure Monitor | Azure's APM; via the OpenTelemetry distro (`UseAzureMonitor()`) |
| **Serilog** | The most popular third-party library: rich sinks (Seq, Elasticsearch, files, Splunk), enrichers, structured destructuring |
| NLog | Long-standing alternative |

```csharp
// Serilog setup
builder.Host.UseSerilog((ctx, services, cfg) => cfg
    .ReadFrom.Configuration(ctx.Configuration)
    .Enrich.FromLogContext()
    .Enrich.WithProperty("Service", "shop-api")
    .WriteTo.Console(new RenderedCompactJsonFormatter())        // JSON to stdout: containers ship it
    .WriteTo.Seq("http://seq:5341"));

app.UseSerilogRequestLogging();   // one concise log line per request: method, path, status, elapsed
```

In containerised deployments specifically, the standard pattern is to **log JSON to stdout** and let whatever's running the container — Container Apps, Kubernetes, a Datadog agent — collect and ship it onward, or export directly via OpenTelemetry. This mirrors the "no file on disk" philosophy from [Configuration](ch:configuration-options#secrets-the-layer-systems-hardest-case): the app doesn't manage its own log files any more than it manages its own secrets — the platform handles both.

## HTTP request logging {i}

```csharp
builder.Services.AddHttpLogging(o =>
{
    o.LoggingFields = HttpLoggingFields.RequestMethod | HttpLoggingFields.RequestPath | HttpLoggingFields.ResponseStatusCode | HttpLoggingFields.Duration;
    o.CombineLogs = true;
});
app.UseHttpLogging();
```

Be deliberate about which fields you enable here: bodies and headers routinely contain tokens, cookies and personal data, and logging them by default is how sensitive data quietly ends up sitting in a log aggregator for months.

## What to log and what never to log {i}

| ✔ Log | ✘ Never log |
|---|---|
| Business events with IDs (order placed, payment declined) | Passwords, tokens, API keys, connection strings |
| Exceptions **with the exception object** | Full credit card numbers, CVV, bank details |
| Calls to external systems: target, duration, outcome | Personal data beyond what's necessary (GDPR): full addresses, health data |
| Retries, fallbacks, circuit breaker state changes | Entire request/response bodies by default |
| Startup configuration summary (non-secret) | Session cookies, `Authorization` headers |

A few habits worth adopting, each guarding against a specific recurring mistake:

- Log a failure **once**, at the boundary that actually handles it — not again at every layer as the exception rethrows upward and each `catch` block logs it a second time.
- Don't log a routine `OperationCanceledException` as an `Error`. A client closing the connection isn't a server failure.
- Log IDs, not whole objects, so a log line stays small and never accidentally serializes a field you didn't intend to expose.
- For anything approaching real PII, use the **Microsoft.Extensions.Compliance.Redaction** package — built for data classification and redaction — rather than trying to remember every sensitive field by hand.

:::qa How do you implement global exception handling in ASP.NET Core?
Register AddProblemDetails and one or more IExceptionHandler implementations (AddExceptionHandler&lt;T&gt;), and put app.UseExceptionHandler() first in the pipeline. Handlers map known exception types to status codes and ProblemDetails, log appropriately, and return true; unknown ones fall through to a generic 500. The Developer Exception Page is used only in Development.
:::

:::qa What is ProblemDetails?
The RFC 9457 (formerly 7807) standard JSON format for HTTP API errors: type, title, status, detail, instance, plus extensions like traceId or validation errors. ASP.NET Core produces it via AddProblemDetails, Results.Problem/ValidationProblem and [ApiController] conventions.
:::

:::qa Why shouldn't you return stack traces to clients?
They leak implementation details (framework versions, file paths, SQL, internal names) that help attackers, and they're useless to clients. Return a generic ProblemDetails with a trace ID and keep the details in server logs.
:::

:::qa What is structured logging and why is it better?
Logging with message templates whose placeholders are captured as named properties instead of being formatted into a string. Log stores can then index and query by those fields (all errors for OrderId 1042, p95 duration by endpoint), which plain text can't support well.
:::

:::qa Why not use string interpolation in log calls?
Interpolation produces a single pre-formatted string, so the structured properties are lost. It also always allocates and formats, even when the log level is disabled. Use message templates with placeholders (CA2254).
:::

:::qa What are log scopes?
Ambient properties attached to all log entries written within a using block (BeginScope), flowing across awaits via AsyncLocal. ASP.NET Core adds RequestId, TraceId and SpanId automatically; you can add OrderId, TenantId and so on for correlation.
:::

:::qa What is LoggerMessage and when would you use it?
A source generator ([LoggerMessage] on partial methods) that produces strongly typed, high-performance logging methods that check the level first, avoid boxing and params arrays, and pre-parse templates. Use it in hot paths and libraries.
:::

:::qa How do you choose log levels?
Information for normal business milestones, Warning for unexpected but handled situations (retries, declines), Error for failures of an operation (exceptions), Critical for system-wide failures, and Debug/Trace for diagnostics that are off in production. Turn framework categories down to Warning to reduce noise.
:::

:::qa How would you correlate logs across microservices?
Use W3C trace context propagation (traceparent header, automatic with HttpClient and OpenTelemetry) so every service logs with the same TraceId, include the trace ID in ProblemDetails responses, and send logs to a central store that can filter by TraceId and link to the distributed trace.
:::

## Further reading

- [Handle errors in ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/error-handling)
- [Handle errors in ASP.NET Core APIs (ProblemDetails)](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/error-handling-api)
- [Logging in .NET](https://learn.microsoft.com/en-us/dotnet/core/extensions/logging)
- [Compile-time logging source generation](https://learn.microsoft.com/en-us/dotnet/core/extensions/logger-message-generator)
- [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457)

## Verify this chapter

The checks below cover exception-to-status mapping, structured logging vs interpolation, scopes surviving an `await`, and `IsEnabled` gating — all pure C#, no ASP.NET host needed. Save as a console app (`dotnet new console`, `dotnet add package Microsoft.Extensions.Logging`), then `dotnet run`.

```csharp
using Microsoft.Extensions.Logging;

// Claim: exception-type-to-status mapping (the shape of IExceptionHandler.TryHandleAsync in this chapter).
{
    (int status, string? title) Map(Exception ex) => ex switch
    {
        NotFoundException => (404, "Resource not found"),
        DomainException d => (409, d.Message),
        UnauthorizedAccessException => (403, "Forbidden"),
        _ => (0, null)
    };

    if (Map(new NotFoundException()).status != 404) throw new Exception("FAIL: NotFoundException should map to 404");
    if (Map(new DomainException("Shipped orders can't be cancelled")).status != 409) throw new Exception("FAIL: DomainException should map to 409");
    if (Map(new UnauthorizedAccessException()).status != 403) throw new Exception("FAIL: UnauthorizedAccessException should map to 403");
    if (Map(new InvalidOperationException()).status != 0) throw new Exception("FAIL: unknown exception should fall through (status 0 = 'not mine')");
    Console.WriteLine("OK: exception types map to the status codes this chapter claims, and unknown types fall through");
}

var provider = new CapturingLoggerProvider();
using var factory = LoggerFactory.Create(b => b.AddProvider(provider).SetMinimumLevel(LogLevel.Information));
var logger = factory.CreateLogger("Shop.Payments");

// Claim: a message template keeps placeholders as named, queryable properties; string interpolation does not.
{
    provider.Entries.Clear();
    logger.LogInformation("Order {OrderId} placed", 1042);
    var templateEntry = provider.Entries[^1];
    if (!templateEntry.State.Any(kv => kv.Key == "OrderId" && Equals(kv.Value, 1042)))
        throw new Exception("FAIL: message template should produce a structured OrderId property");
    Console.WriteLine("OK: a message template keeps OrderId as a structured, named property");

    provider.Entries.Clear();
    logger.LogInformation($"Order {1042} placed");
    var interpolatedEntry = provider.Entries[^1];
    if (interpolatedEntry.State.Any(kv => kv.Key == "OrderId"))
        throw new Exception("FAIL: interpolated string should NOT have an OrderId property");
    Console.WriteLine("OK: a pre-interpolated string has no OrderId property — just an opaque sentence");
}

// Claim: BeginScope attaches properties to every log line inside the block, and they survive an await.
{
    provider.Entries.Clear();
    using (logger.BeginScope(new Dictionary<string, object> { ["OrderId"] = 1042, ["CustomerId"] = 7 }))
    {
        logger.LogInformation("Reserving stock");
        await Task.Yield(); // force a real continuation, possibly on a different thread-pool thread
        logger.LogInformation("Stock reserved");
    }
    logger.LogInformation("Outside the scope");

    var insideScope = provider.Entries[^2]; // "Stock reserved", after the await
    var scopeDict = insideScope.Scopes.OfType<Dictionary<string, object>>().FirstOrDefault();
    if (scopeDict is null || !Equals(scopeDict["OrderId"], 1042))
        throw new Exception("FAIL: the scope's OrderId should still be attached after an await");
    Console.WriteLine("OK: a scope's properties survive an await, even onto a different thread-pool thread");

    var outsideScope = provider.Entries[^1]; // "Outside the scope"
    if (outsideScope.Scopes.OfType<Dictionary<string, object>>().Any())
        throw new Exception("FAIL: the scope should not leak past its using block");
    Console.WriteLine("OK: a scope's properties do not leak past its using block");
}

// Claim: logger.IsEnabled(level) lets you skip expensive work for a disabled level, before any formatting happens.
{
    var expensiveWasCalled = false;
    string Expensive() { expensiveWasCalled = true; return "computed value"; }

    if (logger.IsEnabled(LogLevel.Debug)) // false: minimum level is Information
        logger.LogDebug("Expensive: {Value}", Expensive());

    if (expensiveWasCalled) throw new Exception("FAIL: Expensive() should not run when Debug logging is disabled");
    Console.WriteLine("OK: IsEnabled(level) lets you skip computing arguments for a disabled level");
}

Console.WriteLine("All checks passed.");

// Not runtime-verifiable here (needs a real ASP.NET Core host/HTTP pipeline):
// - UseExceptionHandler() ordering actually catching exceptions thrown by later middleware — see Further reading: "Handle errors in ASP.NET Core"
// - the exact ProblemDetails JSON shape served over HTTP, status code pages, Developer Exception Page — see Further reading: "RFC 9457"
// - [LoggerMessage] source-generator output and its measured allocation savings vs manual calls — see Further reading: "Compile-time logging source generation"
// - Serilog sinks, OpenTelemetry export, Application Insights — all external systems; see Further reading

class NotFoundException : Exception;
class DomainException(string message) : Exception(message);

sealed class CapturingLoggerProvider : ILoggerProvider, ISupportExternalScope
{
    IExternalScopeProvider? _scopeProvider;
    public List<(string Message, IReadOnlyList<KeyValuePair<string, object>> State, List<object> Scopes)> Entries = new();

    public ILogger CreateLogger(string categoryName) => new CapturingLogger(this);
    public void SetScopeProvider(IExternalScopeProvider scopeProvider) => _scopeProvider = scopeProvider;
    public void Dispose() { }

    sealed class CapturingLogger(CapturingLoggerProvider owner) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull =>
            owner._scopeProvider?.Push(state);

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            var kvps = (state as IReadOnlyList<KeyValuePair<string, object>>) ?? Array.Empty<KeyValuePair<string, object>>();
            var scopes = new List<object>();
            owner._scopeProvider?.ForEachScope((scope, list) => list.Add(scope!), scopes);
            owner.Entries.Add((formatter(state, exception), kvps, scopes));
        }
    }
}
```
