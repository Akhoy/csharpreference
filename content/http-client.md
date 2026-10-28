---
id: http-client
title: Calling Other Services: HttpClient and IHttpClientFactory
summary: Making outbound HTTP calls correctly. How HttpClient and its handler pipeline work, the socket-exhaustion and stale-DNS problems, IHttpClientFactory with named and typed clients, DelegatingHandlers, JSON helpers, timeouts and cancellation, resilience, generated clients (Refit, Kiota), and testing.
layer: comms
where: Service communication › Synchronous HTTP › Outbound calls
fits: This is the **outbound** side of layer 6. Your API receives requests through the pipeline in layer 3, and calls other APIs through this. It plugs into DI ([Dependency injection](ch:dependency-injection)) and configuration, and is where resilience ([Resilience](ch:resilience)) and distributed tracing ([Observability](ch:observability-aspire)) get attached.
levels: b,i,a
prereqs: dependency-injection, async-await
next: resilience, messaging-events, observability-aspire
---

## TL;DR

- `HttpClient` is a thin wrapper; the expensive part — connections, DNS, TLS — lives in the handler underneath it (`SocketsHttpHandler`), which is why *how you manage its lifetime* matters more than the calls themselves.
- Creating a new `HttpClient` per call eventually exhausts sockets; keeping one forever eventually serves stale DNS after a failover. Both are real production incidents, not theoretical.
- **`IHttpClientFactory`** fixes both: it pools and periodically recycles handlers, so connections are reused but DNS changes still get picked up.
- Prefer **typed clients** (a class wrapping `HttpClient`, exposing a domain API) over named clients, and never let a singleton capture one — that recreates the stale-DNS bug.
- **`DelegatingHandler`**s are middleware for outbound calls: auth tokens, correlation headers, logging, and resilience (retries, circuit breakers) all slot into the same chain.
- Pass the incoming request's `CancellationToken` through to every outbound call, and read the error body before calling `EnsureSuccessStatusCode()` — it throws away any `ProblemDetails` the server sent you.

## The basic calls {b}

```csharp
var response = await http.GetAsync("https://api.github.com/repos/dotnet/runtime", ct);
response.EnsureSuccessStatusCode();                                  // throws HttpRequestException on 4xx/5xx
var repo = await response.Content.ReadFromJsonAsync<Repo>(ct);

var repo2 = await http.GetFromJsonAsync<Repo>("repos/dotnet/runtime", ct);       // one-liner
var created = await http.PostAsJsonAsync("orders", new { sku = "KB-01", qty = 1 }, ct);

using var req = new HttpRequestMessage(HttpMethod.Put, $"orders/{id}")
{
    Content = JsonContent.Create(update),
    Headers = { { "If-Match", etag } }
};
using var res = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);   // stream big responses
```

Those calls look harmless, and they *are* harmless at this level of abstraction. The trouble starts with a question that looks unrelated: where does `http` — the `HttpClient` instance — actually come from, and how long does it live? Get that wrong, and the bugs that follow are some of the most notorious in all of ASP.NET Core history.

## What an HttpClient actually is, underneath {i}

`HttpClient` isn't the thing doing the real work — it's a thin, friendly front end over a chain of **message handlers**:

```text
HttpClient ──▶ DelegatingHandler (e.g. auth header) ──▶ DelegatingHandler (logging) ──▶ … ──▶ SocketsHttpHandler
 (API you call)        your cross-cutting handlers (a pipeline, like middleware)              (owns the CONNECTION POOL,
                                                                                               DNS, TLS, sockets)
```

The expensive part — the thing that actually opens TCP connections, negotiates TLS, and keeps a **connection pool** alive for reuse — lives at the far end, in the **primary handler** (`SocketsHttpHandler`). `HttpClient` itself is a lightweight wrapper around that chain. Hold onto that one fact; it's the key to understanding both classic bugs below, because each one comes from misjudging *which* part of this picture is actually expensive.

## The two classic bugs, and why they're opposite mistakes {b}

### Bug 1: a new HttpClient per request → socket exhaustion

```csharp
public async Task<Rates> GetRatesAsync()
{
    using var http = new HttpClient();               // ✘ new handler + new connection pool every call
    return await http.GetFromJsonAsync<Rates>(url);
}                                                    // disposed → socket closed → sits in TIME_WAIT for ~2–4 min
```

This looks responsible — `using`, proper disposal, nothing left dangling. The problem is exactly what that `using` throws away: a fresh `HttpClient` means a fresh `SocketsHttpHandler`, which means a fresh connection pool, every single call. Disposing it doesn't instantly free the socket either — TCP requires the closing side to sit in `TIME_WAIT` for roughly 2–4 minutes, as a protocol-level safeguard. Under real load, that adds up fast: thousands of sockets pile up in `TIME_WAIT` simultaneously, and the machine eventually runs out of ephemeral ports entirely, surfacing as `SocketException: Only one usage of each socket address is normally permitted`. On top of that, every single call pays for a brand-new TCP handshake and TLS negotiation, work that a pooled connection would have skipped entirely.

### Bug 2: one static HttpClient forever → stale DNS

```csharp
private static readonly HttpClient Http = new();     // ✘ connections live forever
```

This is the overcorrection — treating `HttpClient` as expensive to create (true for the handler, not really true for `HttpClient` itself) and so creating exactly one, forever. The connections it opens now live indefinitely, reused for every call. That sounds efficient, and it is — right up until the target's DNS record changes: a blue/green deployment flips the active environment, a failover happens, a load balancer gets a new IP. The static client never re-resolves DNS, because it never has a reason to — its existing connection still works, technically, just to the wrong place now.

![Three HttpClient lifetimes: a fresh one per request accumulates sockets in TIME_WAIT, one static client pins to a stale IP after a failover, and IHttpClientFactory periodically swaps the underlying handler so DNS changes are picked up without losing connection reuse](visuals/httpclient-lifecycle.svg)

### The fix: let something else own the lifetime decision

| Fix | How |
|---|---|
| **IHttpClientFactory** (recommended in ASP.NET Core) | Pools and **recycles handlers** (every 2 minutes by default), so connections are reused but DNS changes are picked up; integrates config, DI, logging and resilience |
| Static/singleton `HttpClient` + `PooledConnectionLifetime` | `new HttpClient(new SocketsHttpHandler { PooledConnectionLifetime = TimeSpan.FromMinutes(2) })`: fine for simple apps and libraries |

Notice what `IHttpClientFactory` actually buys you, looking back at the diagram: it isn't "faster disposal" or "fewer allocations" — it's **periodic handler replacement**, which reuses connections for the common case (most calls, most of the time) while still bounding how long any one connection can go stale.

## IHttpClientFactory in practice {i}

### Named clients

```csharp
builder.Services.AddHttpClient("github", c =>
{
    c.BaseAddress = new Uri("https://api.github.com/");
    c.DefaultRequestHeaders.UserAgent.ParseAdd("shop-api/1.0");
    c.Timeout = TimeSpan.FromSeconds(15);
});

public sealed class RepoService(IHttpClientFactory factory)
{
    public Task<Repo?> GetAsync(string name, CancellationToken ct) =>
        factory.CreateClient("github").GetFromJsonAsync<Repo>($"repos/{name}", ct);
}
```

### Typed clients (preferred)

A better shape wraps the raw HTTP calls behind a class that receives a pre-configured `HttpClient` through its constructor, and exposes a domain-friendly API instead of raw URLs and verbs:

```csharp
public sealed class InventoryClient(HttpClient http)
{
    public async Task<StockLevel?> GetStockAsync(string sku, CancellationToken ct)
    {
        using var res = await http.GetAsync($"stock/{Uri.EscapeDataString(sku)}", ct);
        if (res.StatusCode == HttpStatusCode.NotFound) return null;
        res.EnsureSuccessStatusCode();
        return await res.Content.ReadFromJsonAsync<StockLevel>(ct);
    }

    public async Task ReserveAsync(Reservation r, CancellationToken ct) =>
        (await http.PostAsJsonAsync("reservations", r, ct)).EnsureSuccessStatusCode();
}

builder.Services.AddHttpClient<InventoryClient>(c => c.BaseAddress = new Uri(builder.Configuration["Services:Inventory"]!))
    .AddHttpMessageHandler<CorrelationIdHandler>()
    .AddStandardResilienceHandler();               // retries, timeouts, circuit breaker (see Resilience)
```

The typed client itself is registered as **transient** — cheap to create, because the expensive part lives in the shared, recycled handler underneath it, not in this thin wrapper. Inject it wherever you need it.

:::gotcha Don't capture typed clients in singletons
Here's a trap that recreates the exact stale-DNS bug from above, wearing a different disguise: if a singleton holds onto a typed client (or any `HttpClient` the factory handed it) for the app's whole lifetime, that handler is never recycled, because nothing ever lets go of it. Inject typed clients into transient or scoped services instead — the same captive-dependency shape covered in [Dependency injection](ch:dependency-injection#the-captive-dependency-the-single-most-common-di-bug) — or, if a singleton genuinely needs HTTP access, inject `IHttpClientFactory` directly and create a fresh client per use. (Configuring `SocketsHttpHandler.PooledConnectionLifetime` on the primary handler is the other escape hatch.)
:::

## DelegatingHandlers: the exact same idea as middleware, running outbound {i}

The handler chain introduced earlier is a pipeline in the fullest sense — composable, ordered, each one wrapping the next — which should feel familiar after [Middleware](ch:middleware#now-heres-the-aha-a-middleware-is-just-a-function-wrapping-a). The difference is direction: this pipeline runs on the way **out**, for requests your app is making to someone else, not on the way in.

```csharp
public sealed class AccessTokenHandler(ITokenProvider tokens) : DelegatingHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var token = await tokens.GetAsync("api://inventory/.default", ct);     // cached client-credentials token
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return await base.SendAsync(request, ct);                             // call the next handler
    }
}

public sealed class CorrelationIdHandler(IHttpContextAccessor accessor) : DelegatingHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        if (accessor.HttpContext?.Request.Headers["X-Correlation-Id"] is { Count: > 0 } id)
            request.Headers.TryAddWithoutValidation("X-Correlation-Id", id.ToString());
        return base.SendAsync(request, ct);
    }
}

builder.Services.AddTransient<AccessTokenHandler>().AddTransient<CorrelationIdHandler>();
builder.Services.AddHttpClient<InventoryClient>(...).AddHttpMessageHandler<AccessTokenHandler>().AddHttpMessageHandler<CorrelationIdHandler>();
```

Typical jobs for a handler: attaching auth tokens, propagating correlation or tenant headers, logging, caching, request signing. Resilience itself — retries, circuit breakers — is implemented as a handler too, which is why `.AddStandardResilienceHandler()` above slots in exactly like any other entry in this chain. (One thing you *don't* need a handler for: W3C `traceparent` propagation for distributed tracing happens automatically.)

## Timeouts and cancellation: getting the layering right {i}

- `HttpClient.Timeout` (default **100 seconds**, far too long for most APIs) applies to the entire request. When it fires, it surfaces as a `TaskCanceledException` with an inner `TimeoutException` (since .NET 5) — the only reliable way to tell "it timed out" apart from "the caller cancelled it," since both throw the same outer exception type.
- Always pass the incoming request's `CancellationToken` through to outbound calls, so that if the original client disconnects, your app stops waiting on a downstream call nobody's going to read the answer to.
- Once the resilience handler is in play, prefer *its* **total request timeout** and **per-attempt timeout** over `HttpClient.Timeout` — and set `HttpClient.Timeout` itself to `Infinite` or something larger, so it doesn't quietly compete with the timeouts you actually configured.

```csharp
catch (TaskCanceledException ex) when (ex.InnerException is TimeoutException) { /* timed out */ }
catch (TaskCanceledException) when (ct.IsCancellationRequested) { /* caller cancelled */ }
```

## Handling responses properly: resist the urge to just EnsureSuccessStatusCode {i}

```csharp
using var res = await http.GetAsync(url, ct);
switch (res.StatusCode)
{
    case HttpStatusCode.OK:          return await res.Content.ReadFromJsonAsync<Dto>(ct);
    case HttpStatusCode.NotFound:    return null;
    case HttpStatusCode.TooManyRequests:
        var retryAfter = res.Headers.RetryAfter?.Delta;              // respect server throttling
        throw new ThrottledException(retryAfter);
    default:
        var problem = await res.Content.ReadFromJsonAsync<ProblemDetails>(ct);   // read the error body before throwing
        throw new DownstreamException(res.StatusCode, problem?.Title);
}
```

Three habits worth making automatic:

- Dispose every `HttpResponseMessage` (or wrap it in `using`) — this matters especially with `ResponseHeadersRead`, since the connection only returns to the pool once you're actually done with it.
- Use `ResponseHeadersRead` for large responses, so the body streams instead of being fully buffered into memory before you see a single byte.
- Don't reach for `EnsureSuccessStatusCode` reflexively when the error response carries a body worth reading — calling it first throws away the `ProblemDetails` payload the server went to the trouble of sending you.

## Generated and declarative clients {a}

Writing a typed client by hand, as above, works well for a handful of endpoints. For a large external API, generating the client from its contract avoids hand-transcribing dozens of endpoints and keeps the client in sync as the contract evolves:

| Tool | Approach |
|---|---|
| **Refit** | Declare an interface with attributes; Refit generates the implementation (source generator) |
| **Kiota** (Microsoft) | Generates strongly typed clients from OpenAPI descriptions |
| **NSwag / OpenAPI Generator** | Generate C# clients from OpenAPI |
| gRPC client | Generated from `.proto` files ([App models](ch:app-models)) |

```csharp
public interface IGitHubApi
{
    [Get("/repos/{owner}/{repo}")]
    Task<Repo> GetRepoAsync(string owner, string repo, CancellationToken ct = default);
}
builder.Services.AddRefitClient<IGitHubApi>().ConfigureHttpClient(c => c.BaseAddress = new Uri("https://api.github.com"))
    .AddStandardResilienceHandler();
```

## Service discovery {a}

In .NET Aspire and Kubernetes, you address services by **logical name** rather than a URL hard-coded to a specific host: `c.BaseAddress = new("https+http://inventory")`, with `Microsoft.Extensions.ServiceDiscovery` resolving the actual endpoint from configuration or DNS at runtime. This sidesteps the stale-DNS problem from a different angle entirely — the address itself is never a fixed IP to begin with. See [Observability & Aspire](ch:observability-aspire).

## Testing code that uses HttpClient {i}

```csharp
// A stub handler: no network, deterministic responses
public sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage req, CancellationToken ct) => Task.FromResult(respond(req));
}

[Fact]
public async Task Returns_null_when_sku_unknown()
{
    var http = new HttpClient(new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.NotFound))) { BaseAddress = new("https://inv/") };
    var client = new InventoryClient(http);
    Assert.Null(await client.GetStockAsync("NOPE", CancellationToken.None));
}
```

Notice the test constructs `InventoryClient` directly with a hand-built `HttpClient`, bypassing the factory entirely — this works precisely because the typed client's constructor just wants *an* `HttpClient`, and doesn't care how it was produced. For integration tests that need genuinely realistic HTTP behaviour — real headers, real status-code edge cases — run a fake server with **WireMock.Net** instead of a hand-rolled stub.

:::qa Why shouldn't you create a new HttpClient for every request?
Each instance (with its own handler) opens new connections. Disposing it closes sockets that linger in TIME_WAIT, so under load you exhaust ephemeral ports (socket exhaustion), and every call pays new TCP/TLS handshakes.
:::

:::qa Then why not just use one static HttpClient?
Its pooled connections live forever, so DNS changes aren't observed and you can keep hitting old IPs after failovers or deployments. Fix it with IHttpClientFactory, which recycles handlers, or by setting SocketsHttpHandler.PooledConnectionLifetime on a long-lived client.
:::

:::qa What does IHttpClientFactory do?
It creates HttpClient instances whose underlying handlers are pooled and periodically recycled (2 min default), avoiding both socket exhaustion and stale DNS. It centralises configuration (named/typed clients), lets you compose DelegatingHandlers, integrates logging and resilience (Polly), and works with DI.
:::

:::qa Named vs typed clients?
Named clients are configured under a name and created with factory.CreateClient("name"). Typed clients are classes that receive a preconfigured HttpClient via their constructor and expose domain methods; they're strongly typed, encapsulate the API and are usually preferred.
:::

:::qa What is a DelegatingHandler?
A handler in HttpClient's outbound pipeline that can inspect or modify requests and responses before passing them on with base.SendAsync. Used for auth tokens, correlation headers, logging and resilience; added with AddHttpMessageHandler.
:::

:::qa How do you set timeouts for outbound calls?
HttpClient.Timeout (default 100 s, usually too long), or better, the resilience pipeline's total and per-attempt timeouts. Always pass a CancellationToken from the incoming request so calls stop if the client disconnects.
:::

:::qa How do you unit test a class that uses HttpClient?
Construct the HttpClient with a stub HttpMessageHandler that returns canned responses (or use a mocking library for handlers), or run WireMock.Net for higher-fidelity tests. Don't mock HttpClient directly.
:::

## Further reading

- [Make HTTP requests using IHttpClientFactory](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/http-requests)
- [HttpClient guidelines for .NET](https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/http/httpclient-guidelines)
- [Build resilient HTTP apps](https://learn.microsoft.com/en-us/dotnet/core/resilience/http-resilience)

## Verify this chapter

The checks below cover handler ordering, a typed client built with a stub handler, and `HttpClient.Timeout` vs caller cancellation — all with a fake `HttpMessageHandler`, no real network. Save as a console app (`dotnet new console`), then `dotnet run`.

```csharp
using System.Net;
using System.Net.Http.Json;

// Claim: DelegatingHandlers form an ordered pipeline — each one runs, in registration order, before the final handler.
{
    var order = new List<string>();
    var final = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK));
    var handlerB = new RecordingHandler("B", order) { InnerHandler = final };
    var handlerA = new RecordingHandler("A", order) { InnerHandler = handlerB };

    using var http = new HttpClient(handlerA);
    using var res = await http.GetAsync("http://stub/orders");

    if (!order.SequenceEqual(new[] { "A", "B" }))
        throw new Exception($"FAIL: expected [A, B], got [{string.Join(", ", order)}]");
    if (res.StatusCode != HttpStatusCode.OK) throw new Exception("FAIL: final handler's response didn't come through");
    Console.WriteLine("OK: DelegatingHandlers run in registration order, wrapping the next one");
}

// Claim: a typed client's constructor just wants an HttpClient — you can hand it a stub handler directly, no factory needed.
{
    using var http = new HttpClient(new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.NotFound))) { BaseAddress = new Uri("http://inv/") };
    var client = new InventoryClient(http);
    var result = await client.GetStockAsync("NOPE", CancellationToken.None);
    if (result is not null) throw new Exception("FAIL: expected null for a 404");
    Console.WriteLine("OK: a typed client built directly with a stub handler behaves exactly like a factory-built one");
}

// Claim: HttpClient.Timeout firing produces TaskCanceledException with an inner TimeoutException (since .NET 5) —
// this is how you tell "it timed out" apart from "the caller cancelled it."
{
    using var slow = new HttpClient(new DelayingHandler(TimeSpan.FromSeconds(5))) { Timeout = TimeSpan.FromMilliseconds(100) };
    Exception? caught = null;
    try { await slow.GetAsync("http://stub/slow", CancellationToken.None); }
    catch (Exception ex) { caught = ex; }

    if (caught is not TaskCanceledException tce || tce.InnerException is not TimeoutException)
        throw new Exception($"FAIL: expected TaskCanceledException with inner TimeoutException, got {caught}");
    Console.WriteLine("OK: HttpClient.Timeout firing throws TaskCanceledException with an inner TimeoutException");
}

{
    using var slow = new HttpClient(new DelayingHandler(TimeSpan.FromSeconds(5))) { Timeout = Timeout.InfiniteTimeSpan };
    using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));
    Exception? caught = null;
    try { await slow.GetAsync("http://stub/slow", cts.Token); }
    catch (Exception ex) { caught = ex; }

    if (caught is not OperationCanceledException || caught is TaskCanceledException tce2 && tce2.InnerException is TimeoutException)
        throw new Exception($"FAIL: expected a plain cancellation, not a TimeoutException, got {caught}");
    Console.WriteLine("OK: the caller's own CancellationToken firing does NOT produce an inner TimeoutException");
}

Console.WriteLine("All checks passed.");

// Not runtime-verifiable here (needs a real network, real sockets, or real DNS):
// - socket exhaustion from a new HttpClient per request, or stale DNS from one static HttpClient forever — see Further reading: "HttpClient guidelines for .NET"
// - IHttpClientFactory's actual handler-recycling schedule (every 2 minutes by default) — see Further reading: "Make HTTP requests using IHttpClientFactory"
// - resilience handlers (retries, circuit breakers), Refit/Kiota-generated clients, service discovery — see Further reading: "Build resilient HTTP apps"

sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage req, CancellationToken ct) =>
        Task.FromResult(respond(req));
}

sealed class DelayingHandler(TimeSpan delay) : HttpMessageHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage req, CancellationToken ct)
    {
        await Task.Delay(delay, ct);
        return new HttpResponseMessage(HttpStatusCode.OK);
    }
}

sealed class RecordingHandler(string name, List<string> order) : DelegatingHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        order.Add(name);
        return await base.SendAsync(request, ct);
    }
}

sealed class InventoryClient(HttpClient http)
{
    public async Task<StockLevel?> GetStockAsync(string sku, CancellationToken ct)
    {
        using var res = await http.GetAsync($"stock/{Uri.EscapeDataString(sku)}", ct);
        if (res.StatusCode == HttpStatusCode.NotFound) return null;
        res.EnsureSuccessStatusCode();
        return await res.Content.ReadFromJsonAsync<StockLevel>(ct);
    }
}

record StockLevel(string Sku, int Quantity);
```
