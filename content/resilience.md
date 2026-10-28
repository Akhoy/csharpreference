---
id: resilience
title: Resilience: Retries, Timeouts, Circuit Breakers and Beyond
summary: Designing for failure. Transient vs permanent faults, the resilience strategies (timeout, retry with backoff and jitter, circuit breaker, fallback, hedging, rate limiter and bulkhead), Polly v8 and Microsoft.Extensions.Resilience, the standard HTTP resilience handler, ordering strategies correctly, retry storms and idempotency, plus health checks, graceful degradation and chaos testing.
layer: comms
where: Service communication › Fault handling
fits: Resilience wraps every outbound call in layer 6, whether HTTP ([HttpClient](ch:http-client)), gRPC ([App models](ch:app-models)), database ([EF Core advanced](ch:efcore-advanced#transactions-when-savechangess-own-transaction-isnt-enough)) or broker ([Messaging & events](ch:messaging-events)). It's what makes microservices ([Microservices](ch:microservices)) survivable, and what observability ([Observability & Aspire](ch:observability-aspire)) lets you tune.
levels: b,i,a
prereqs: http-client, async-await
next: observability-aspire, messaging-events
---

## TL;DR

- In the cloud, failures are **normal**, not exceptional — design for them instead of hoping they won't happen.
- Match the strategy to the fault: **retry** transient errors, **circuit-break** prolonged outages, **don't retry** permanent errors (4xx), **timeout** slow calls.
- **Backoff + jitter** on retries, and retry at **one layer only** — otherwise retries multiply into a retry storm.
- Only retry **idempotent** operations, or non-idempotent ones with an idempotency key — a blind retry of a POST can double-charge a customer.
- `Microsoft.Extensions.Http.Resilience`'s `.AddStandardResilienceHandler()` gives you timeout + retry + circuit breaker for HttpClient calls with one line.
- **Liveness** checks "is the process alive?"; **readiness** checks "can it serve traffic right now?" — don't confuse the two, or a dependency blip restarts your whole fleet.

## Everything fails {b}

In the cloud, failure is **normal**: instances restart during deployments, networks blip, load balancers move connections, databases fail over, dependencies throttle you (429), and noisy neighbours cause latency spikes. A resilient system **expects** these and keeps working, perhaps degraded, instead of turning a 2-second blip into an outage.

| Fault type | Examples | Response |
|---|---|---|
| **Transient** | Timeouts, connection resets, 503, 429, 408, deadlock victims, SQL failover errors | **Retry** (with backoff), wait for recovery |
| **Prolonged** | A dependency down for minutes | **Stop calling** (circuit breaker), **fallback**, degrade gracefully |
| **Permanent** | 400 Bad Request, 401/403, 404, validation errors, bugs | **Don't retry**: fail fast, surface the error |
| **Slowness** | Dependency at 10 s instead of 100 ms | **Timeout**, limit concurrency, hedge |

Notice the table's shape: each fault type gets a *different* response, and the rest of this chapter is really a toolbox of strategies, each matched to one row.

## The resilience strategies {b}

| Strategy | Problem it solves | How |
|---|---|---|
| **Timeout** | A slow call holds threads, sockets and the user's patience indefinitely | Give up after N; cancel the operation |
| **Retry** | Transient faults that succeed on a second try | Try again, with **exponential backoff and jitter**, a limited number of times |
| **Circuit breaker** | Hammering a failing dependency makes it worse and wastes your resources | After a failure threshold, **fail fast** for a break period, then probe |
| **Fallback** | The user should get *something* when a dependency fails | Return a cached, default or degraded value |
| **Hedging** | Tail latency: some requests are slow for no reason | Send a second request after a delay and use whichever responds first |
| **Rate limiter / concurrency limiter** | Protect yourself or a dependency from overload | Cap requests per period or in flight |
| **Bulkhead** | One failing dependency exhausting shared resources (threads, connections) | Isolate resources per dependency (separate pools/limits) |

## Retry, done properly {i}

```text
Attempt 1 ── fail ──▶ wait 200ms ±jitter ──▶ Attempt 2 ── fail ──▶ wait 400ms ±jitter ──▶ Attempt 3 ── fail ──▶ wait 800ms ──▶ Attempt 4 → give up
```

- **Exponential backoff** gives the dependency time to recover.
- **Jitter** (randomising delays) prevents thousands of clients retrying **in lockstep**, the "thundering herd" that hits a recovering service in synchronised waves — the exact same stampede problem [Caching, rate limiting & CORS](ch:caching-ratelimit-cors#caching-strategies-and-invalidation-the-part-thats-actually-) described for expiring cache keys, here showing up as retries instead.
- **Limit attempts** (2–5) and the **total time** budget.
- **Retry only transient faults**: network exceptions, 5xx (especially 502/503/504), 408, 429. Respect **`Retry-After`** headers.
- **Retry only idempotent operations** (GET, PUT, DELETE), or non-idempotent ones **with idempotency keys** ([API design](ch:api-design#idempotency-keys-for-post-making-the-one-unsafe-by-default-m)). A retried POST without a key can charge a card twice.

:::gotcha Retry storms and retry amplification
If every layer retries 3 times (gateway → API → service → database), one failure becomes 3 × 3 × 3 = **27** attempts on the bottom layer, right when it's struggling. Retry at **one** layer (usually closest to the failing dependency), keep counts low, combine with circuit breakers, and set **timeout budgets** that shrink as calls go deeper.
:::

## Circuit breaker {i}

```text
            failure ratio > threshold within the sampling window
   ┌────────┐ ─────────────────────────────────────────────▶ ┌────────┐
   │ CLOSED │                                                 │  OPEN  │  calls fail immediately
   │ normal │ ◀──── trial call succeeds ─── ┌───────────┐ ◀─── │ (fast) │  (BrokenCircuitException)
   └────────┘                               │ HALF-OPEN │      └────────┘
                                            │ one probe │ ── trial fails ──▶ back to OPEN
                                            └───────────┘      after the break duration elapses
```

Why bother: waiting for every call to a down dependency to time out wastes threads and connections, adds latency for your users, and piles more load onto a service that's already struggling — the opposite of what it needs to recover. The breaker **fails fast** instead (so you can fall back immediately) and gives the dependency a quiet window to recover. The OPEN state is deliberate rest, not a malfunction.

Tune: the failure ratio (e.g. 50%), the **minimum throughput** before evaluating (to avoid tripping on 2 of 3 calls), the sampling window, and the break duration. **Log state changes** and expose them as metrics — a circuit flipping open is exactly the kind of event worth paging someone over.

## Timeouts {i}

Two levels, and conflating them is a common mistake:

- **Per-attempt timeout**: how long one try may take (e.g. 2 s).
- **Total timeout**: the overall budget including retries (e.g. 10 s), which should fit inside the caller's own deadline.

Always pass `CancellationToken`s so timeouts actually **cancel** the underlying work (EF Core commands, HTTP requests) — a timeout that only stops *waiting* for the result, without actually cancelling the work, still leaves the dependency doing pointless work for a caller that's already given up. And remember `HttpClient.Timeout` defaults to 100 seconds, far too long for most calls, exactly as [Calling other services](ch:http-client#timeouts-and-cancellation-getting-the-layering-right) warned; with a resilience pipeline, let the pipeline own timeouts instead.

## Polly v8 and Microsoft.Extensions.Resilience {i}

**Polly** is .NET's resilience library. **v8** introduced **resilience pipelines** with strategies composed in order — notice the word "composed," because the ordering section below matters as much as which strategies you pick. Microsoft builds on it with `Microsoft.Extensions.Resilience` (DI integration, telemetry) and `Microsoft.Extensions.Http.Resilience` (HttpClient integration).

### The standard HTTP handler

```csharp
builder.Services.AddHttpClient<CatalogClient>(c => c.BaseAddress = new("https://catalog"))
    .AddStandardResilienceHandler(o =>
    {
        o.Retry.MaxRetryAttempts = 3;
        o.AttemptTimeout.Timeout = TimeSpan.FromSeconds(2);
        o.TotalRequestTimeout.Timeout = TimeSpan.FromSeconds(10);
        o.CircuitBreaker.FailureRatio = 0.5;
        o.CircuitBreaker.SamplingDuration = TimeSpan.FromSeconds(30);   // must be ≥ 2× attempt timeout
    });
```

The standard handler stacks, from outermost to innermost:

```text
Rate limiter (concurrency) → Total request timeout → Retry → Circuit breaker → Attempt timeout → HTTP call
```

Defaults retry transient HTTP failures (5xx, 408, 429, `HttpRequestException`, timeouts) with exponential backoff and jitter, honouring `Retry-After`. Also available: **`AddStandardHedgingHandler()`**, which sends parallel attempts (optionally to different endpoints) for latency-critical reads — the hedging strategy from the strategies table, now as a drop-in handler.

### Custom pipelines

```csharp
builder.Services.AddResiliencePipeline("inventory-db", pipeline => pipeline
    .AddTimeout(TimeSpan.FromSeconds(5))
    .AddRetry(new RetryStrategyOptions
    {
        ShouldHandle = new PredicateBuilder().Handle<SqlException>(ex => ex.IsTransient).Handle<TimeoutException>(),
        MaxRetryAttempts = 3,
        BackoffType = DelayBackoffType.Exponential,
        UseJitter = true,
        Delay = TimeSpan.FromMilliseconds(200),
        OnRetry = args => { Log.Warning("Retry {Attempt} after {Delay}", args.AttemptNumber, args.RetryDelay); return default; }
    })
    .AddCircuitBreaker(new CircuitBreakerStrategyOptions
    {
        FailureRatio = 0.5, MinimumThroughput = 20, SamplingDuration = TimeSpan.FromSeconds(30), BreakDuration = TimeSpan.FromSeconds(15)
    }));

public sealed class StockReader([FromKeyedServices("inventory-db")] ResiliencePipeline pipeline, IStockRepository repo)
{
    public ValueTask<int> GetAsync(string sku, CancellationToken ct) =>
        pipeline.ExecuteAsync(async token => await repo.GetQuantityAsync(sku, token), ct);
}

// Typed result with fallback
var withFallback = new ResiliencePipelineBuilder<decimal?>()
    .AddFallback(new FallbackStrategyOptions<decimal?>
    {
        ShouldHandle = new PredicateBuilder<decimal?>().Handle<BrokenCircuitException>().Handle<TimeoutRejectedException>(),
        FallbackAction = _ => Outcome.FromResultAsValueTask<decimal?>(null)      // e.g. "price unavailable"
    })
    .AddTimeout(TimeSpan.FromSeconds(1))
    .Build();
```

### Strategy order matters

Strategies execute **outermost first** — the exact same nested-wrapping idea from [Middleware](ch:middleware#now-heres-the-aha-a-middleware-is-just-a-function-wrapping-a), now composing fault-handling strategies instead of HTTP concerns. Typical rules:

- A **total timeout outside the retry** bounds the whole operation; an **attempt timeout inside the retry** bounds each try.
- A **circuit breaker inside the retry** means each attempt is counted, and when the circuit is open, retries can stop quickly (handle `BrokenCircuitException` as non-retryable or with a delay).
- **Fallback outermost**, so it catches everything that fails below it.

### Older Polly syntax

Pre-v8 code looks like `Policy.Handle<HttpRequestException>().WaitAndRetryAsync(...)`, `Policy.WrapAsync(...)` and `AddPolicyHandler(...)` (Microsoft.Extensions.Http.Polly, now deprecated in favour of Http.Resilience). Same concepts, different API.

## Resilience beyond HTTP {i}

| Dependency | Built-in resilience |
|---|---|
| EF Core / SQL | `EnableRetryOnFailure()` execution strategy (wrap manual transactions with `CreateExecutionStrategy`) |
| Azure SDK clients | Built-in retry policies (`ClientOptions.Retry`: exponential, max retries, network timeout) |
| Service Bus / brokers | Delivery retries, delayed redelivery, dead-lettering ([Messaging](ch:messaging-events#retries-poison-messages-and-dead-lettering)) |
| Redis (StackExchange.Redis) | Reconnect/backoff, `AbortOnConnectFail = false` |
| gRPC | Built-in retry and hedging policies in the channel's service config, or the resilience handler |

## Designing for graceful degradation {a}

Resilience isn't only about libraries. Design so partial failure produces a **degraded but useful** experience, rather than an outright outage:

- **Fallbacks:** show cached recommendations, hide the reviews widget, use the last known exchange rate (and say so).
- **Asynchronous by default:** accept the order and process payment via a queue, so checkout works while Payments is down — the "fault isolation" benefit [Messaging & events](ch:messaging-events#what-putting-a-broker-in-the-middle-actually-buys-you) described, applied as a deliberate resilience tactic rather than just an architectural nicety.
- **Bulkheads:** separate HttpClient, connection pool and concurrency limits per dependency, so a slow reporting service can't starve checkout. Separate deployments for critical and non-critical workloads.
- **Load shedding:** reject excess work early with 429/503 (rate limiter, concurrency limiter) instead of collapsing under it.
- **Static stability:** keep working with the last known good configuration or data if the control plane (config service, identity provider metadata) is unavailable.
- **Timeouts everywhere**, with budgets that decrease along the call chain.
- **Idempotency everywhere**, so retries are safe.

## Health checks {i}

Health endpoints let orchestrators and load balancers route around unhealthy instances.

```csharp
builder.Services.AddHealthChecks()
    .AddCheck("self", () => HealthCheckResult.Healthy(), tags: ["live"])
    .AddSqlServer(cs, name: "sql", tags: ["ready"])                         // AspNetCore.HealthChecks.* packages
    .AddRedis(redisCs, name: "redis", tags: ["ready"])
    .AddAzureServiceBusQueue(sbNamespace, "orders", new DefaultAzureCredential(), tags: ["ready"]);

app.MapHealthChecks("/health/live",  new() { Predicate = r => r.Tags.Contains("live") });    // is the process OK? (restart if not)
app.MapHealthChecks("/health/ready", new() { Predicate = r => r.Tags.Contains("ready") });   // can it serve traffic? (remove from LB if not)
```

:::gotcha Don't put dependencies in liveness checks
If liveness checks the database and the database blips, the orchestrator **restarts every instance**, turning a dependency hiccup into a full outage. Liveness = "the process isn't stuck". Readiness = "dependencies are reachable, warm-up is done".
:::

## Chaos engineering {a}

Verify resilience by **injecting faults on purpose**: latency, exceptions, error responses, killed instances. It's the only reliable way to know the strategies above actually work the way you designed them — rather than hoping they do and finding out during a real outage.

- **Polly chaos strategies** (v8.3+): `AddChaosLatency`, `AddChaosFault`, `AddChaosOutcome` and `AddChaosBehavior` in pipelines, enabled by configuration in test environments.
- **Azure Chaos Studio**: platform-level faults (VM shutdown, network latency, AKS pod chaos).
- Game days: planned exercises where the team breaks things in staging and observes alerts, dashboards and recovery.

:::qa What is the difference between transient and non-transient faults?
Transient faults are temporary and likely to succeed on retry: timeouts, connection resets, 503/429, SQL failovers, deadlocks. Non-transient faults won't fix themselves (400, 401/403, 404, validation errors, bugs), so retrying wastes resources and they should fail fast.
:::

:::qa Why use exponential backoff with jitter for retries?
Backoff spaces retries out so a struggling dependency has time to recover. Jitter randomises the delays so many clients don't retry simultaneously in synchronised waves (thundering herd) that keep the dependency overloaded.
:::

:::qa How does a circuit breaker work?
Closed: calls flow and failures are tracked. When the failure ratio exceeds a threshold (with a minimum throughput) within a sampling window, it opens: calls fail immediately for a break duration. Then it goes half-open and allows a trial call; success closes it, failure re-opens it. It prevents wasting resources on, and piling load onto, a failing dependency.
:::

:::qa When is it unsafe to retry a request?
When the operation isn't idempotent (e.g. POST creating a payment) and has no idempotency key, because the original may have succeeded despite the error and a retry would duplicate it. Also for permanent errors like 400 or 401.
:::

:::qa What is a retry storm and how do you avoid it?
Retries at multiple layers multiplying load on a failing dependency (3 retries at 3 layers = 27 attempts), worsening the outage. Avoid it by retrying at one layer only, keeping attempt counts low, using jitter, adding circuit breakers, and propagating timeout budgets and cancellation.
:::

:::qa How do you add resilience to HttpClient in modern .NET?
Microsoft.Extensions.Http.Resilience: `.AddStandardResilienceHandler()` on the IHttpClientFactory registration gives a rate limiter, total timeout, retries with backoff and jitter, a circuit breaker and per-attempt timeouts with sensible defaults. Use AddResilienceHandler for a custom Polly v8 pipeline, or AddStandardHedgingHandler for hedging.
:::

:::qa What is the bulkhead pattern?
Isolating resources (connection pools, thread or concurrency limits, separate instances) per dependency or workload, so a failure or slowdown in one can't exhaust resources needed by others, like watertight compartments in a ship.
:::

:::qa Liveness vs readiness health checks?
Liveness tells the orchestrator whether the process is healthy or must be restarted, and should not depend on external services. Readiness tells the load balancer whether the instance can currently serve traffic (dependencies reachable, warmed up); failing readiness removes it from rotation without restarting it.
:::

## Further reading

- [Introduction to resilient app development (.NET)](https://learn.microsoft.com/en-us/dotnet/core/resilience/)
- [Build resilient HTTP apps](https://learn.microsoft.com/en-us/dotnet/core/resilience/http-resilience)
- [Polly documentation](https://www.pollydocs.org/)
- [Health checks in ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/health-checks)
- Michael Nygard, *Release It!* (2nd ed.): the book that popularised circuit breakers and bulkheads.
- [Azure Well-Architected Framework: Reliability](https://learn.microsoft.com/en-us/azure/well-architected/reliability/)

## Verify this chapter

Run with: `dotnet new console -o resiliencecheck && cd resiliencecheck && dotnet add package Polly.Core`, then replace `Program.cs` with the code below and `dotnet run`. This uses real Polly v8 pipelines — the chapter's actual subject — not a simulation.

```csharp
using Polly;
using Polly.CircuitBreaker;
using Polly.Retry;

// 1) Retry: succeeds on the 3rd attempt after two transient failures.
int attempt = 0;
var retryPipeline = new ResiliencePipelineBuilder().AddRetry(new RetryStrategyOptions
{
    ShouldHandle = new PredicateBuilder().Handle<InvalidOperationException>(),
    MaxRetryAttempts = 3,
    Delay = TimeSpan.FromMilliseconds(10),
    BackoffType = DelayBackoffType.Constant
}).Build();

string result = await retryPipeline.ExecuteAsync(async _ =>
{
    attempt++;
    if (attempt < 3) throw new InvalidOperationException("transient");
    return await ValueTask.FromResult("ok");
});

if (result != "ok" || attempt != 3) throw new Exception($"FAIL: expected success on attempt 3, got result={result} attempt={attempt}");
Console.WriteLine($"OK: retry pipeline succeeded on attempt {attempt} after transient failures, as the backoff-and-retry section describes.");

// 2) Retry gives up (and rethrows) once MaxRetryAttempts is exhausted — it doesn't retry forever.
int alwaysFailAttempts = 0;
try
{
    await retryPipeline.ExecuteAsync<string>(_ =>
    {
        alwaysFailAttempts++;
        throw new InvalidOperationException("still failing");
    });
    throw new Exception("FAIL: expected the pipeline to eventually rethrow");
}
catch (InvalidOperationException)
{
    if (alwaysFailAttempts != 4) throw new Exception($"FAIL: expected 4 total attempts (1 + 3 retries), got {alwaysFailAttempts}");
    Console.WriteLine($"OK: retry stopped after {alwaysFailAttempts} attempts (1 original + MaxRetryAttempts=3) and surfaced the failure, instead of retrying forever.");
}

// 3) Circuit breaker: opens after the failure threshold, then fails fast (BrokenCircuitException)
//    without even calling the inner action — "fail fast instead of waiting for every call to time out".
int innerCallsAfterOpen = 0;
var breakerPipeline = new ResiliencePipelineBuilder().AddCircuitBreaker(new CircuitBreakerStrategyOptions
{
    FailureRatio = 0.5,
    MinimumThroughput = 2,
    SamplingDuration = TimeSpan.FromSeconds(10),
    BreakDuration = TimeSpan.FromSeconds(5),
    ShouldHandle = new PredicateBuilder().Handle<InvalidOperationException>()
}).Build();

for (int i = 0; i < 2; i++)
{
    try { await breakerPipeline.ExecuteAsync<string>(_ => throw new InvalidOperationException("dependency down")); }
    catch (InvalidOperationException) { /* expected: feeding failures to trip the breaker */ }
}

try
{
    await breakerPipeline.ExecuteAsync<string>(_ => { innerCallsAfterOpen++; return ValueTask.FromResult("should not run"); });
    throw new Exception("FAIL: expected BrokenCircuitException once the circuit is open");
}
catch (BrokenCircuitException)
{
    if (innerCallsAfterOpen != 0) throw new Exception("FAIL: the inner action ran even though the circuit was open");
    Console.WriteLine("OK: once open, the circuit breaker rejected the call immediately without invoking the dependency at all.");
}

// Claims NOT verified here (need real network faults, multiple processes, or a running orchestrator):
// - Jitter actually preventing a thundering herd across many real clients — see Further reading: https://www.pollydocs.org/
// - The standard HTTP resilience handler's exact strategy stacking over a real HttpClient — see Further reading: https://learn.microsoft.com/en-us/dotnet/core/resilience/http-resilience
// - Liveness/readiness health check behavior under a real orchestrator (Kubernetes/App Service) — see Further reading: https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/health-checks
Console.WriteLine("All runtime-checkable claims verified.");
```
