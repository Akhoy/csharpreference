---
id: middleware
title: Middleware and the Request Pipeline
summary: The heart of ASP.NET Core. What middleware is, how the pipeline is literally built from delegates, Use/Run/Map/UseWhen, the correct order and why, every built-in middleware and where it goes, writing your own (conventional, IMiddleware, factory), short-circuiting, response timing traps, and middleware vs filters.
layer: framework
where: ASP.NET Core › Request pipeline › Middleware
fits: The pipeline is the **spine of layer 3**. Hosting ([Hosting](ch:aspnet-hosting)) creates it, routing ([Routing](ch:routing)) is one of its middleware, auth ([Auth](ch:auth)) lives in it, and your endpoints ([Building APIs](ch:building-apis)) sit at its end. Cross-cutting concerns from layer 8 (logging, exception handling, security headers, rate limiting) are mostly implemented here.
levels: b,i,a
prereqs: aspnet-hosting, delegates-events, dependency-injection
next: routing, errors-logging, auth
---

## TL;DR

- **Middleware** is a chain of components every request passes through before reaching your actual endpoint — each one can look at the request, pass it on, and look at the response on the way back.
- Under the hood it's just nested functions: each middleware wraps the next one. That's why "before" code runs in registration order and "after" code runs in reverse.
- Order is real behavior, not a style choice — e.g. `UseAuthorization` must come after `UseAuthentication`, `UseCors` before auth, and `UseRouting` before anything that reads the selected endpoint's metadata.
- A middleware written as a plain class is built **once**, at startup — effectively a singleton. Never put a scoped dependency (like a `DbContext`) in its constructor; put it in `InvokeAsync`'s parameters instead.
- **Short-circuiting** means a middleware doesn't call `next()` and answers the request itself (auth failures, rate limits, cache hits, static files).
- Once the response has started sending, you can no longer change headers or the status code — use `Response.OnStarting` to set them just before that happens.

## Every request walks through the same corridor of rooms {b}

Picture a request arriving at your app. Before it reaches the code you actually wrote — the handler that looks up an order, say — it has to pass through a sequence of checkpoints: is this HTTPS? does it need CORS headers? who's making this request, and are they allowed to? None of that is *your* endpoint's job to check every single time; it would be absurd to repeat "is this HTTPS" logic inside every single handler in the app.

**Middleware** is how ASP.NET Core avoids that repetition. Each middleware is a component sitting in a chain, and each one gets exactly four jobs available to it for every request:

1. receive the `HttpContext`,
2. optionally do work **before** the rest of the pipeline runs — inspect the request, start a timer, check a header,
3. **either** call `next()` to hand control to the next middleware in line, **or** stop right there ("short-circuit") and write the response itself,
4. optionally do work **after** `next()` returns — inspect the response that came back, log the final status code, stop the timer.

```text
           ┌───────────────────────── request ─────────────────────────▶
 Client ─▶ │ ExceptionHandler │ HTTPS │ StaticFiles │ Routing │ CORS │ AuthN │ AuthZ │ … │ ENDPOINT
           ◀───────────────────────── response ────────────────────────┘
             (each middleware's "after next()" code runs on the way back, in REVERSE order)
```

:::analogy Russian dolls (or an onion)
Each middleware wraps everything that comes after it. The request travels inward through each layer to the endpoint at the centre, and the response travels back out through the same layers, but in reverse. A layer can also simply refuse to let the request go any further inward and send a response straight back — like a security guard at the door who doesn't bother calling upstairs.
:::

:::why Why build it as a pipeline at all, instead of one big function?
Error handling, HTTPS enforcement, CORS, authentication, compression, logging, correlation IDs, rate limiting — all of these apply to **every** request, or every request under some path, regardless of which specific endpoint eventually handles it. Writing each one as a separate, composable middleware means you write it **once**, slot it into a clear, explicit order, and turn it on or off with one line in `Program.cs`. This is a deliberate departure from the old `System.Web` model, which had a large, largely hidden pipeline you couldn't easily see or reorder. Here, if you don't add a middleware, it simply doesn't run — the pipeline is exactly what you wrote and nothing more.
:::

## Seeing it work before seeing how it's built {b}

```csharp
var app = builder.Build();

app.Use(async (context, next) =>
{
    var sw = Stopwatch.StartNew();
    Console.WriteLine($"→ {context.Request.Method} {context.Request.Path}");   // BEFORE

    await next(context);                                                       // run the rest of the pipeline

    Console.WriteLine($"← {context.Response.StatusCode} in {sw.ElapsedMilliseconds} ms");  // AFTER
});

app.Use(async (context, next) =>
{
    if (context.Request.Headers.ContainsKey("X-Block-Me"))
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;          // SHORT-CIRCUIT:
        await context.Response.WriteAsync("Blocked");                          // don't call next
        return;
    }
    await next(context);
});

app.MapGet("/", () => "Hello");      // the endpoint at the end
app.Run();
```

For `GET /`, that prints:

```text
→ GET /
← 200 in 3 ms
```

Notice the shape: the first middleware's "before" line prints first, then control passes all the way down to the endpoint, then — only once everything downstream has finished — its "after" line prints. If a request came in carrying `X-Block-Me`, the second middleware would write `403 Blocked` and return, and the endpoint at `app.MapGet("/", ...)` would never run at all. Hold onto that example; the next section explains exactly why it behaves this way.

## Use, Run, Map, MapWhen, UseWhen {b}

| Method | What it does |
|---|---|
| `app.Use(middleware)` | Adds middleware that **can** call `next` |
| `app.Run(handler)` | Adds a **terminal** handler; it never calls next. Anything after it never runs |
| `app.Map("/path", branch => …)` | **Branches** the pipeline for requests whose path starts with `/path`. The branch doesn't rejoin the main pipeline |
| `app.MapWhen(predicate, branch => …)` | Branches on any condition |
| `app.UseWhen(predicate, branch => …)` | Conditionally runs extra middleware, then **rejoins** the main pipeline |
| `app.UseMiddleware<T>()` / `app.UseXyz()` | Adds a middleware class (`UseXyz` are extension methods wrapping this) |

```csharp
app.Map("/legacy", legacy =>
{
    legacy.Run(ctx => ctx.Response.WriteAsync("Legacy endpoint"));   // only /legacy/* goes here
});

app.UseWhen(ctx => ctx.Request.Path.StartsWithSegments("/api"), api =>
{
    api.UseMiddleware<ApiKeyMiddleware>();      // only for /api/*, then continues to the main pipeline
});
```

:::gotcha Map vs MapGet — same word, two unrelated mechanisms
`app.Map("/x", ...)` branches the **middleware pipeline** itself — an older, low-level tool. `app.MapGet("/x", ...)` registers a **routing endpoint**, a completely different and much more commonly used feature covered in [Routing](ch:routing). They sound almost identical and that's exactly the trap; 99% of the time, you want `MapGet`/`MapPost`/`MapGroup`, not `Map`.
:::

## Now here's the aha: a middleware is just a function wrapping a function {i}

Go back to that worked example above and ask the question it was quietly setting up: how does `await next(context)` actually know what "the rest of the pipeline" even is? There's no global list being walked at request time — the real mechanism is simpler than that, and once you see it, middleware stops feeling like magic.

The core type is one plain delegate:

```csharp
public delegate Task RequestDelegate(HttpContext context);
```

A middleware, stripped down to its essence, is a function that **takes one `RequestDelegate` (the rest of the pipeline) and returns a new `RequestDelegate` that wraps it**:

```csharp
Func<RequestDelegate, RequestDelegate> middleware
```

Every call to `app.Use(...)` just appends one of these wrapping functions to a list — nothing executes yet. The actual composition happens once, when the host calls `Build()`, and it happens **in reverse**:

```csharp
// Simplified version of ApplicationBuilder.Build()
RequestDelegate app = context => { context.Response.StatusCode = 404; return Task.CompletedTask; }; // the end

for (int i = _components.Count - 1; i >= 0; i--)
    app = _components[i](app);        // each middleware wraps the one after it

return app;                           // the outermost delegate: the first middleware
```

Walk through what this does with three middleware, `Use(A); Use(B); Use(C);`, and a terminal endpoint. The loop starts from the *last* component, `C`, and wraps it around the 404 fallback: `C(endpoint)`. Then it wraps `B` around that: `B(C(endpoint))`. Then `A` around all of it: `A(B(C(endpoint)))`. The diagram below traces exactly this: Kestrel ends up holding a single outermost delegate, `A`, and calls it once per request.

![The middleware pipeline composed as nested delegates, with the request flowing inward and the response flowing back out in reverse](visuals/middleware-pipeline.svg)

Follow the request's path through that nesting and the reversal in the worked example stops being surprising. Calling `A`'s `next` invokes `B`'s whole delegate. `B` calling its `next` invokes `C`'s. `C` calling `next` finally reaches the endpoint. Each of those calls is still *running* — sitting on the call stack — waiting for the one it invoked to return. So the endpoint finishes and returns up to `C`. `C`'s code after `await next()` runs and returns up to `B`. That code runs and returns up to `A`. You get exactly the reverse order the pipeline diagram at the top of this chapter showed. It isn't a special rule the framework enforces; it's just how nested function calls unwind — the same way any `await` in [Async and await](ch:async-await) resumes its caller only once the thing it awaited is done.

```csharp
// Exactly equivalent to app.Use(async (ctx, next) => ...)
app.Use(next => async context =>
{
    // before
    await next(context);
    // after
});
```

## The correct order, and precisely what breaks when you get it wrong {b}

Since each middleware only ever sees what the ones *before* it have already done, and only wraps what comes *after* it, the order you register things in isn't a style choice — it's the actual behaviour. Here's Microsoft's recommended order for a typical API or web app:

```csharp
var app = builder.Build();

app.UseForwardedHeaders();          // 0. Behind a proxy: fix scheme/IP FIRST so everything after sees the real values
app.UseExceptionHandler();          // 1. Outermost: catches exceptions from EVERYTHING after it
if (!app.Environment.IsDevelopment())
    app.UseHsts();                  // 2. Tell browsers to always use HTTPS
app.UseHttpsRedirection();          // 3. Redirect http → https
app.UseStaticFiles();               // 4. Serve wwwroot files and short-circuit: no auth/routing cost for images, css
                                    //    (or app.MapStaticAssets() in .NET 9+, as an endpoint)
app.UseRouting();                   // 5. Choose the endpoint (implicit if omitted; explicit call controls position)
app.UseRequestLocalization();       //    Culture from headers/query/cookies
app.UseCors();                      // 6. After routing (to read endpoint CORS metadata), before auth (preflight requests carry no credentials)
app.UseAuthentication();            // 7. Who are you? Sets HttpContext.User
app.UseAuthorization();             // 8. Are you allowed? Reads the endpoint's [Authorize]/policy metadata
app.UseRateLimiter();               // 9. After auth if limits are per-user
app.UseRequestTimeouts();
app.UseOutputCache();               // 10. Serve cached responses (after auth, so cache respects authorization)
app.UseResponseCompression();       //    (often before static files; depends on whether you compress them)
app.UseMiddleware<CorrelationIdMiddleware>();   // your custom middleware
app.MapControllers();               // 11. Endpoints (endpoint middleware executes the chosen endpoint)
app.MapOrderEndpoints();
```

Each row below is a real-world bug report with the same root cause: a middleware placed before something it secretly depended on.

| If you get this wrong… | Symptom |
|---|---|
| `UseAuthorization` before `UseAuthentication` | Every request looks anonymous: 401/403 everywhere |
| `UseAuthentication`/`UseAuthorization` before `UseRouting` (explicit) | Authorization can't see endpoint metadata, so `[Authorize]` is ignored or throws |
| Exception handler not first | Exceptions from earlier middleware aren't converted to ProblemDetails |
| `UseCors` after auth | Preflight `OPTIONS` requests rejected with 401: "CORS error" in the browser |
| `UseStaticFiles` after auth | Static files require auth, and every image request pays the auth cost |
| `UseForwardedHeaders` late | HTTPS redirect loops; wrong client IPs in logs and rate limiting |
| Custom middleware that needs `User` placed before `UseAuthentication` | `context.User` is empty |

:::interview Say it like this
"Middleware runs in registration order on the way in and reverse order on the way out. The exception handler goes first so it wraps everything; HTTPS and static files go early; routing selects the endpoint; CORS, then authentication then authorization, because authorization needs both the user and the endpoint's metadata; then rate limiting and caching; endpoints last."
:::

## The built-in middleware catalogue {i}

| Middleware | Add with | Purpose | Short-circuits? |
|---|---|---|---|
| Forwarded headers | `UseForwardedHeaders` | Apply `X-Forwarded-*` from a trusted proxy | No |
| Exception handler | `UseExceptionHandler` | Catch exceptions → ProblemDetails / error page | Writes error response |
| Developer exception page | (automatic in Dev) | Detailed error page with stack trace | Yes, on error |
| Status code pages | `UseStatusCodePages` | Bodies for empty 4xx/5xx responses | — |
| HSTS | `UseHsts` | `Strict-Transport-Security` header | No |
| HTTPS redirection | `UseHttpsRedirection` | 307/308 redirect to https | Yes |
| Static files | `UseStaticFiles` / `MapStaticAssets` | Serve files from wwwroot | Yes, when file found |
| Routing | `UseRouting` | Match URL to endpoint | No (sets endpoint) |
| Request localization | `UseRequestLocalization` | Set culture | No |
| CORS | `UseCors` | Cross-origin headers, answer preflight | Yes, for preflight |
| Authentication | `UseAuthentication` | Build `HttpContext.User` | No (challenge comes later) |
| Authorization | `UseAuthorization` | Enforce policies | Yes: 401/403 |
| Antiforgery | `UseAntiforgery` | CSRF token validation for forms | Yes, on failure |
| Rate limiter | `UseRateLimiter` | Throttle | Yes: 429 |
| Request timeouts | `UseRequestTimeouts` | Cancel slow requests | — |
| Output caching | `UseOutputCache` | Cache whole responses server-side | Yes, on hit |
| Response caching | `UseResponseCaching` | HTTP cache-header based caching | Yes, on hit |
| Response compression | `UseResponseCompression` | gzip/brotli | No |
| Session | `UseSession` | Server-side session state | No |
| WebSockets | `UseWebSockets` | Upgrade connections | — |
| Health checks | `MapHealthChecks` (endpoint) | `/health` responses | (endpoint) |
| W3C logging / HTTP logging | `UseHttpLogging`, `UseW3CLogging` | Log request/response details | No |
| Endpoint | (implicit at the end) | Execute the selected endpoint | Terminal |

## Writing your own middleware: three styles, one real tradeoff {i}

Inline lambdas like the ones above are fine for a handful of lines you won't reuse. For anything reusable, write a class — and there are three ways to do that, each trading off a little speed for a little safety.

### 1. Convention-based middleware (the common case)

```csharp
public sealed class CorrelationIdMiddleware(RequestDelegate next, ILogger<CorrelationIdMiddleware> logger)
{
    private const string Header = "X-Correlation-Id";

    // Constructor: runs ONCE at startup. Only singleton-safe dependencies here.
    // InvokeAsync: runs per request. Scoped dependencies go in its PARAMETERS.
    public async Task InvokeAsync(HttpContext context, ICurrentRequest current)
    {
        var id = context.Request.Headers[Header].FirstOrDefault() ?? Activity.Current?.TraceId.ToString() ?? Guid.NewGuid().ToString("n");
        // Activity.Current is .NET's built-in distributed-tracing object: if one is already running for this
        // request, its TraceId makes a better correlation ID than a random GUID. More in Observability.
        current.CorrelationId = id;
        context.Response.OnStarting(() => { context.Response.Headers[Header] = id; return Task.CompletedTask; });

        using (logger.BeginScope(new Dictionary<string, object> { ["CorrelationId"] = id }))
        {
            await next(context);
        }
    }
}

// Registration: an extension method keeps Program.cs readable
public static class CorrelationIdExtensions
{
    public static IApplicationBuilder UseCorrelationId(this IApplicationBuilder app) => app.UseMiddleware<CorrelationIdMiddleware>();
}
app.UseCorrelationId();
```

The rules behind the convention: a public constructor taking `RequestDelegate` first, a public `Invoke` or `InvokeAsync` method taking `HttpContext` first and returning `Task`, and any extra `InvokeAsync` parameters get resolved fresh from the **request scope** every time.

:::gotcha Conventional middleware is effectively a singleton — and that has teeth
It's constructed exactly **once**, when the pipeline is built at startup, not once per request. Inject a **scoped** service — a `DbContext`, say — into its **constructor**, and you've captured the very first request's instance and trapped it there forever: a captive dependency, the same failure mode [Dependency injection](ch:dependency-injection#the-captive-dependency-the-single-most-common-di-bug) covers. Scoped services belong in `InvokeAsync`'s parameters, which the framework correctly re-resolves on every call.
:::

### 2. Factory-based middleware: IMiddleware

```csharp
public sealed class TenantMiddleware(ShopDb db, ITenantContext tenant) : IMiddleware   // scoped deps in ctor are fine
{
    public async Task InvokeAsync(HttpContext context, RequestDelegate next)
    {
        var host = context.Request.Host.Host;
        tenant.Current = await db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Host == host, context.RequestAborted);
        if (tenant.Current is null) { context.Response.StatusCode = 404; return; }
        await next(context);
    }
}

builder.Services.AddScoped<TenantMiddleware>();   // must be REGISTERED in DI (any lifetime)
app.UseMiddleware<TenantMiddleware>();
```

The difference that justifies the extra ceremony: `IMiddleware` instances are **resolved from DI per request**, honouring whatever lifetime you registered, which is exactly why constructor injection of a scoped service is safe here when it wasn't above. It costs a little more — an extra DI resolution per request — in exchange for not having to think about the captive-dependency trap at all.

### 3. Inline with app.Use

Best for a handful of lines you genuinely won't reuse anywhere else. Since .NET 6 there's an overload, `app.Use(async (context, next) => …)`, where `next` is a plain `RequestDelegate` rather than the older `Func<Task>` — worth knowing because it avoids an extra allocation per request compared with the older form.

## Short-circuiting and terminal middleware {i}

Short-circuiting — the "security guard at the door" move from the opening analogy — just means deliberately **not calling `next`**. The places you'll see it on purpose:

- Authorization failure: 401/403.
- Rate limit exceeded: 429.
- Cache hit: serve the stored response.
- Static file found: stream it.
- Health or ping endpoints that should skip everything.

```csharp
// .NET 8: endpoints that skip the remaining middleware entirely
app.MapGet("/ping", () => "pong").ShortCircuit();
app.MapShortCircuit(404, "robots.txt", "favicon.ico");   // fast 404s for noise requests
```

## Working with the response: the "has started" trap {a}

Once the response's **headers have been sent** — the moment the body starts being written, or the first explicit flush — you can no longer touch the status code or headers. Try anyway, and you get a precise, unforgiving exception: `InvalidOperationException: Headers are read-only, response has already started.`

```csharp
app.Use(async (ctx, next) =>
{
    await next(ctx);
    ctx.Response.Headers["X-Server-Time"] = DateTime.UtcNow.ToString("O");   // ✘ may throw if the endpoint wrote a body
});

app.Use(async (ctx, next) =>
{
    ctx.Response.OnStarting(() =>                                              // ✔ runs just before headers are sent
    {
        ctx.Response.Headers["X-Server-Time"] = DateTime.UtcNow.ToString("O");
        return Task.CompletedTask;
    });
    await next(ctx);
});
```

Why does the first version only *sometimes* throw? Because "has the body started writing" depends on exactly what the endpoint did. A small enough response might still be sitting in a buffer when your "after `next()`" code runs, and only starts streaming afterward — so the bug hides until someone's response happens to be large enough to flush early. `Response.OnStarting` sidesteps the whole race: it registers a callback guaranteed to run at the one moment that's actually safe. Check `context.Response.HasStarted` before attempting to write an error response, for the same reason. `Response.OnCompleted` is different again — it runs after the response has fully gone out, which makes it useful for metrics but useless for modifying anything.

### Reading the request body more than once

The request body arrives as a forward-only stream — read it once, and it's gone. If a middleware reads it early (for logging, or to verify a signature), the endpoint downstream finds nothing left, unless you explicitly enable rewinding first:

```csharp
app.Use(async (ctx, next) =>
{
    ctx.Request.EnableBuffering();                    // allow rewinding (buffers to memory, then disk)
    using var reader = new StreamReader(ctx.Request.Body, leaveOpen: true);
    var body = await reader.ReadToEndAsync();
    ctx.Request.Body.Position = 0;                    // rewind for the next reader
    await next(ctx);
});
```

### Rewriting the response body

To transform a response on the way out, swap `Response.Body` for a `MemoryStream`, call `next`, then copy the buffered result back into the real response stream. This is a genuine tradeoff, not a free trick: it costs memory (you're holding the entire response in memory) and it breaks true streaming (nothing reaches the client until you're done). Prefer the built-in middleware that already does this carefully — compression, output caching — or an endpoint filter, before reaching for this by hand.

## Middleware vs filters vs endpoint filters {i}

| | Middleware | MVC filters (controllers) | Endpoint filters (minimal APIs) |
|---|---|---|---|
| Runs for | **Every** request through that pipeline position | Only MVC actions | Only the endpoints they're attached to |
| Knows about | `HttpContext` (raw HTTP) | Action descriptor, model state, **bound arguments**, `IActionResult` | Endpoint **arguments**, returned result |
| Runs | Before routing selects, or around the endpoint | Inside the endpoint, after binding | Inside the endpoint, after binding |
| Good for | App-wide concerns: errors, HTTPS, CORS, auth, compression, correlation IDs, rate limits | Action-specific validation, transactions, auditing, caching per action | Validation, argument transformation, per-endpoint auditing |

The distinction that actually matters here is what each one is allowed to *see*. Middleware only ever sees the raw HTTP context — headers, the body as a stream, the path — because it runs before (or around) the model-binding machinery that turns a JSON body into a typed C# object. A filter runs *after* binding, so it can inspect the already-typed, already-bound argument directly:

```csharp
// Endpoint filter: sees the typed arguments, which middleware can't
public sealed class ValidationFilter<T>(IValidator<T> validator) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext ctx, EndpointFilterDelegate next)
    {
        if (ctx.Arguments.OfType<T>().FirstOrDefault() is { } arg)
        {
            var result = await validator.ValidateAsync(arg, ctx.HttpContext.RequestAborted);
            if (!result.IsValid) return TypedResults.ValidationProblem(result.ToDictionary());
        }
        return await next(ctx);
    }
}
orders.MapPost("/", CreateOrder).AddEndpointFilter<ValidationFilter<CreateOrderRequest>>();
```

The rule of thumb that falls out of this: **if it needs to know about the request as raw HTTP, use middleware; if it needs to know about the action and its already-typed inputs, use a filter.** See [Building APIs](ch:building-apis#filters-seeing-the-handlers-actual-typed-arguments) for the MVC filter pipeline in full.

## Middleware that reads endpoint metadata {a}

Here's something that looks like it contradicts the rule just given, but doesn't: after `UseRouting` has run, middleware placed *later* in the pipeline **can** see the selected endpoint and whatever metadata it carries — attributes, `.WithMetadata(...)`, `.RequireAuthorization()`. That's precisely how authorization, CORS, rate limiting and output caching each know what to do for a given endpoint without being filters themselves. You can use the exact same trick in your own middleware:

```csharp
public sealed record AuditAttribute(string Action);

app.Use(async (ctx, next) =>
{
    var audit = ctx.GetEndpoint()?.Metadata.GetMetadata<AuditAttribute>();
    await next(ctx);
    if (audit is not null && ctx.Response.StatusCode < 400)
        await ctx.RequestServices.GetRequiredService<IAuditLog>().WriteAsync(audit.Action, ctx.User);
});

orders.MapPost("/{id}/refund", Refund).WithMetadata(new AuditAttribute("order.refund"));
```

## Testing middleware {a}

```csharp
[Fact]
public async Task Adds_correlation_header()
{
    using var host = await new HostBuilder()
        .ConfigureWebHost(web => web.UseTestServer()
            .ConfigureServices(s => s.AddScoped<ICurrentRequest, CurrentRequest>())
            .Configure(app => { app.UseCorrelationId(); app.Run(ctx => ctx.Response.WriteAsync("ok")); }))
        .StartAsync();

    var response = await host.GetTestClient().GetAsync("/");
    Assert.True(response.Headers.Contains("X-Correlation-Id"));
}
```

Or, for a pure unit test with no host at all, call `InvokeAsync` directly with a `DefaultHttpContext` and a fake `RequestDelegate`.

:::qa What is middleware in ASP.NET Core?
Components assembled into a pipeline that handle every HTTP request and response. Each receives the HttpContext, can do work before and after invoking the next component, or can short-circuit by producing the response itself. The pipeline is built from RequestDelegate functions composed in registration order.
:::

:::qa Why does middleware order matter? Give examples.
Each middleware only sees the effects of the ones before it and wraps the ones after it. The exception handler must be first to catch everything. Authentication must precede authorization or users look anonymous. Routing must precede authorization so endpoint metadata like [Authorize] is available. CORS must run before auth so preflight requests aren't rejected. Static files go early to avoid unnecessary work.
:::

:::qa What's the difference between Use, Run and Map?
Use adds middleware that can call next. Run adds terminal middleware that ends the pipeline. Map branches the pipeline for a path prefix, and the branch doesn't rejoin. UseWhen conditionally adds middleware and then rejoins the main pipeline.
:::

:::qa How is the middleware pipeline built internally?
Each middleware is a Func&lt;RequestDelegate, RequestDelegate&gt;. On startup, ApplicationBuilder.Build composes them in reverse order, starting with a terminal 404 delegate, so each wraps the next, producing one outermost RequestDelegate that the server invokes per request.
:::

:::qa How do you write custom middleware, and how do you inject scoped services into it?
Create a class with a constructor taking RequestDelegate and an InvokeAsync(HttpContext, …) method, then register it with app.UseMiddleware&lt;T&gt;(). The instance is created once, so scoped services must be InvokeAsync parameters, not constructor parameters. Alternatively implement IMiddleware and register it in DI, which resolves it per request and allows constructor injection of scoped services.
:::

:::qa What does short-circuiting mean in the pipeline?
A middleware not calling next and writing the response itself, so later middleware and the endpoint never run. Examples: auth failures (401/403), rate limiting (429), cache hits, static files, CORS preflight responses.
:::

:::qa Why might setting a response header after await next() fail?
Once the response has started (headers flushed because the body began writing), headers and status code are read-only, and modifying them throws. Use Response.OnStarting to set headers just before they're sent, and check Response.HasStarted before writing error responses.
:::

:::qa Middleware vs filters: when do you use each?
Middleware for app-wide, HTTP-level concerns that apply regardless of endpoint (errors, HTTPS, CORS, auth, compression, correlation IDs). Filters (MVC or endpoint filters) for endpoint-specific concerns that need the action context or the typed, bound arguments and results (validation, auditing, transactions).
:::

:::qa How can middleware read the request body without breaking the endpoint?
Call Request.EnableBuffering() so the stream can be rewound, read it (leaving the stream open), then set Request.Body.Position = 0 before calling next.
:::

:::qa How does authorization middleware know which policy an endpoint needs?
Routing runs first and attaches the selected endpoint to the HttpContext. Endpoint metadata (from [Authorize], RequireAuthorization, etc.) is available via context.GetEndpoint().Metadata, which the authorization middleware reads to evaluate the right policies.
:::

## Further reading

- [ASP.NET Core Middleware (official, including the order diagram)](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/middleware/)
- [Write custom ASP.NET Core middleware](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/middleware/write)
- [Factory-based middleware](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/middleware/extensibility)
- Andrew Lock, *ASP.NET Core in Action*, chapter on the middleware pipeline.

## Verify this chapter

Run with `dotnet run` in a console project (`dotnet new web`, then `dotnet add package Microsoft.AspNetCore.TestHost`). It checks the before/after ordering, short-circuiting, that conventional middleware is built once, and that `UseWhen` rejoins the main pipeline.

```csharp
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

void Check(bool condition, string claim)
{
    if (!condition) throw new Exception($"FAIL: {claim}");
    Console.WriteLine($"OK: {claim}");
}

// 1. "Before" code runs in registration order (A, B); "after" code runs in REVERSE order (B, A).
var order = new List<string>();
var builder1 = WebApplication.CreateBuilder();
builder1.WebHost.UseTestServer();
var app1 = builder1.Build();
app1.Use(async (ctx, next) => { order.Add("A-before"); await next(ctx); order.Add("A-after"); });
app1.Use(async (ctx, next) => { order.Add("B-before"); await next(ctx); order.Add("B-after"); });
app1.MapGet("/", () => "ok");
await app1.StartAsync();
await app1.GetTestClient().GetStringAsync("/");
await app1.StopAsync();
Check(order.SequenceEqual(new[] { "A-before", "B-before", "B-after", "A-after" }),
    "Middleware runs 'before' code in registration order and 'after' code in reverse order");

// 2. Short-circuiting (not calling next()) stops everything after it, including the endpoint, from running.
var endpointRan = false;
var builder2 = WebApplication.CreateBuilder();
builder2.WebHost.UseTestServer();
var app2 = builder2.Build();
app2.Use(async (ctx, next) =>
{
    if (ctx.Request.Headers.ContainsKey("X-Block-Me")) { ctx.Response.StatusCode = 403; return; }
    await next(ctx);
});
app2.MapGet("/", () => { endpointRan = true; return "ok"; });
await app2.StartAsync();
var client2 = app2.GetTestClient();
var req = new HttpRequestMessage(HttpMethod.Get, "/");
req.Headers.Add("X-Block-Me", "1");
var blocked = await client2.SendAsync(req);
await app2.StopAsync();
Check(blocked.StatusCode == System.Net.HttpStatusCode.Forbidden, "A short-circuiting middleware returns its own status code");
Check(!endpointRan, "Short-circuiting prevents the endpoint from ever running");

// 3. Conventional middleware (used with app.UseMiddleware<T>()) is constructed ONCE at startup,
//    not once per request — so it behaves like a singleton even with no DI lifetime involved.
CountingMiddleware.ConstructedCount = 0;
var builder3 = WebApplication.CreateBuilder();
builder3.WebHost.UseTestServer();
var app3 = builder3.Build();
app3.UseMiddleware<CountingMiddleware>();
app3.MapGet("/", () => "ok");
await app3.StartAsync();
var client3 = app3.GetTestClient();
await client3.GetStringAsync("/");
await client3.GetStringAsync("/");
await client3.GetStringAsync("/");
await app3.StopAsync();
Check(CountingMiddleware.ConstructedCount == 1, "Conventional middleware is constructed exactly once for 3 separate requests, not once per request");

// 4. UseWhen conditionally runs extra middleware and REJOINS the main pipeline (the endpoint still runs).
var branchRan = false;
var mainEndpointRan = false;
var builder4 = WebApplication.CreateBuilder();
builder4.WebHost.UseTestServer();
var app4 = builder4.Build();
app4.UseWhen(ctx => ctx.Request.Path.StartsWithSegments("/api"), api => api.Use(async (ctx, next) => { branchRan = true; await next(ctx); }));
app4.MapGet("/api/ping", () => { mainEndpointRan = true; return "pong"; });
await app4.StartAsync();
await app4.GetTestClient().GetStringAsync("/api/ping");
await app4.StopAsync();
Check(branchRan && mainEndpointRan, "UseWhen runs the branch's middleware AND still reaches the main endpoint afterward");

Console.WriteLine("All middleware claims verified.");

class CountingMiddleware
{
    public static int ConstructedCount;
    private readonly Microsoft.AspNetCore.Http.RequestDelegate _next;
    public CountingMiddleware(Microsoft.AspNetCore.Http.RequestDelegate next) { _next = next; ConstructedCount++; }
    public Task InvokeAsync(Microsoft.AspNetCore.Http.HttpContext context) => _next(context);
}
```

Not attempted here: `IMiddleware`'s per-request DI resolution and the response-already-started exception both need a slightly heavier TestServer setup than is worth inlining — try them yourself with the code earlier in this chapter; the behaviour described matches the official middleware docs linked above.
