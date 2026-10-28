---
id: background-work
title: Background Work: Hosted Services, Workers, Channels and Job Schedulers
summary: Doing work outside the request. IHostedService and BackgroundService, the lifecycle and pitfalls, worker services, scheduled work with PeriodicTimer, in-memory queues with Channel<T>, durable job systems (Hangfire, Quartz.NET), and when to use a broker or Azure Functions instead.
layer: framework
where: ASP.NET Core › Hosting › Background work
fits: Hosted services are run **by the host** ([Hosting](ch:aspnet-hosting)) alongside the web server, use DI scopes manually ([Dependency injection](ch:dependency-injection#scopes-made-concrete)), and are the usual home for message consumers ([Messaging & events](ch:messaging-events)) and outbox publishers. In the cloud, the same jobs might instead run as Azure Functions or Container Apps jobs ([Azure compute](ch:azure-compute)).
levels: b,i,a
prereqs: aspnet-hosting, dependency-injection, async-await
next: messaging-events, azure-compute
---

## TL;DR

- Work that doesn't need to finish before you reply should run outside the request, in a `BackgroundService` hosted by the same process.
- `BackgroundService` is a long-running loop the host starts at startup and stops at shutdown; because it's a singleton, create a fresh DI scope *inside* the loop for anything scoped, like a `DbContext`.
- `Channel<T>` hands work off to an in-process background worker fast, but loses everything if the process dies — use it only for work you can afford to lose or redo.
- For work that must survive a crash, retry automatically, or run once across several replicas, use a durable store: a job library (Hangfire, Quartz.NET) or a message broker.
- A **Worker Service** is the same host with background services but no web server — good for deploying queue consumers and schedulers separately from the API.

## Work that shouldn't make a request wait {b}

A request should return quickly — that's a constraint, not a preference, because something's actually waiting on the other end of it. But not every piece of work an app needs to do fits inside that window, and some of it isn't triggered by a request at all:

| Kind | Examples |
|---|---|
| **Deferred** (triggered by a request, done later) | Sending emails, generating PDFs/reports, resizing images, calling slow third parties, webhooks |
| **Scheduled / periodic** | Nightly cleanup, hourly sync with an ERP, refreshing caches, expiring carts |
| **Continuous** | Consuming a message queue, processing an outbox, streaming events |

The pattern for the first category is usually the same: the API responds **202 Accepted** (plus a status URL the client can poll), and the actual work continues running after the response has already gone out.

## IHostedService and BackgroundService: the host's slot for long-running code {b}

Recall from [ASP.NET Core architecture](ch:aspnet-hosting#the-generic-host-the-thing-that-owns-everything-else) that the host starts and stops a list of `IHostedService` instances alongside the web server itself — Kestrel is literally one of them. `IHostedService` is the plain contract behind that:

```csharp
public interface IHostedService
{
    Task StartAsync(CancellationToken cancellationToken);   // called at startup
    Task StopAsync(CancellationToken cancellationToken);    // called at graceful shutdown
}
```

Implementing that interface directly is rare in practice, because almost every real background job has the same shape: start a loop, keep it running for the app's entire lifetime, stop cleanly when asked. **`BackgroundService`** is the abstract base class that captures exactly that shape, so you only have to write the loop itself:

```csharp
public sealed class ExchangeRateRefresher(IServiceScopeFactory scopes, ILogger<ExchangeRateRefresher> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(15));
        do
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();               // scoped services need a scope
                var svc = scope.ServiceProvider.GetRequiredService<IRateService>();
                await svc.RefreshAsync(stoppingToken);
                log.LogInformation("Exchange rates refreshed");
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                log.LogError(ex, "Refreshing exchange rates failed; will retry next tick");   // don't let one failure kill the loop
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}

builder.Services.AddHostedService<ExchangeRateRefresher>();
```

Notice the `scopes.CreateAsyncScope()` call right at the top of the loop body, not outside it. The next section explains exactly why that placement is load-bearing.

## The lifecycle, and the pitfalls each fact in it quietly creates {i}

| Fact | Consequence |
|---|---|
| Hosted services are **singletons** | Use `IServiceScopeFactory` for scoped services (DbContext); never inject them directly (captive dependency) |
| `StartAsync` of each service is awaited **in registration order before the app starts serving** | Don't do long work in `StartAsync`. `BackgroundService.StartAsync` returns as soon as `ExecuteAsync` hits its first real `await`, so **synchronous work at the top of `ExecuteAsync` blocks startup** — add `await Task.Yield()` first if that's a risk |
| Unhandled exception in `ExecuteAsync` | Since .NET 6 the **host stops** (`BackgroundServiceExceptionBehavior.StopHost`). Catch and log inside the loop |
| `stoppingToken` is cancelled on shutdown | Pass it everywhere; finish or abandon the current item within the `ShutdownTimeout` |
| Every app instance runs its hosted services | With 3 replicas, the "nightly job" runs **3 times**. You need a distributed lock, a leader election, a single dedicated worker, or a job scheduler |
| In-memory work is lost when the process dies | Anything that must not be lost needs a durable store (DB, queue) |

The first row is the one mistake almost everyone makes once: a `BackgroundService` is built exactly once, at startup, and that same instance lives for the whole lifetime of the process — a singleton, in the same sense [Dependency injection](ch:dependency-injection#the-captive-dependency-the-single-most-common-di-bug) warned about. If you injected a scoped `DbContext` straight into its constructor, that one `DbContext` would be stuck there forever, slowly going stale and failing in ways that are hard to connect back to the real cause. The fix is to open a **new scope inside the loop**, once per iteration: each tick gets its own short-lived `DbContext`, used once and thrown away — the same lifetime a real HTTP request would give it.

```csharp
builder.Services.Configure<HostOptions>(o =>
{
    o.ServicesStartConcurrently = true;          // .NET 8: start hosted services in parallel
    o.BackgroundServiceExceptionBehavior = BackgroundServiceExceptionBehavior.Ignore;   // only if you really mean it
    o.ShutdownTimeout = TimeSpan.FromSeconds(30);
});
```

`IHostedLifecycleService` (.NET 8) adds four finer-grained hooks — `StartingAsync`, `StartedAsync`, `StoppingAsync` and `StoppedAsync` — for when you need to run code at a more precise point in the sequence than plain `StartAsync`/`StopAsync` allow.

## Worker services: the same host, deliberately without a web server {b}

Everything above assumed a web app that *also* runs background work alongside its HTTP server. A **Worker Service** flips that: it's the same Generic Host, with background services, but **no web server at all** — the natural shape for queue consumers, schedulers, and integration processes you want to deploy and scale completely separately from the API:

```csharp
// dotnet new worker -n Shop.Worker
var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddDbContext<ShopDb>(o => o.UseSqlServer(builder.Configuration.GetConnectionString("Shop")));
builder.Services.AddHostedService<OrderEventsConsumer>();
builder.Services.AddHostedService<OutboxPublisher>();
builder.Build().Run();
```

It gets exactly the same configuration, logging, DI and graceful shutdown as a web app — none of that plumbing is actually specific to having a web server — and runs as a container, a Windows Service (`UseWindowsService()`), or a systemd unit (`UseSystemd()`).

:::fits API + worker
A common deployable split: **Shop.Api** (handles HTTP, writes to the DB and an **outbox** — a table that stores events to publish, written in the same database transaction as the business change so the two can't disagree; see [Messaging & events](ch:messaging-events)) and **Shop.Worker** (consumes queues, publishes the outbox, runs schedules). Both reference the same Application/Domain/Infrastructure projects. They scale independently, and a slow job never steals threads from HTTP requests.
:::

## In-memory queues with Channel<T>: handing work off within one process {i}

Sometimes the work doesn't need to leave the process at all — it just needs to leave the *request*. For that, `System.Threading.Channels` gives you a fast, async-native producer/consumer queue:

```csharp
public sealed record ThumbnailJob(Guid ImageId, string BlobPath);

public sealed class ThumbnailQueue
{
    private readonly Channel<ThumbnailJob> _channel = Channel.CreateBounded<ThumbnailJob>(new BoundedChannelOptions(500)
    {
        FullMode = BoundedChannelFullMode.Wait,      // backpressure: producers wait when full
        SingleReader = false
    });
    public ValueTask EnqueueAsync(ThumbnailJob job, CancellationToken ct) => _channel.Writer.WriteAsync(job, ct);
    public IAsyncEnumerable<ThumbnailJob> ReadAllAsync(CancellationToken ct) => _channel.Reader.ReadAllAsync(ct);
}

public sealed class ThumbnailWorker(ThumbnailQueue queue, IServiceScopeFactory scopes, ILogger<ThumbnailWorker> log) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken) =>
        Parallel.ForEachAsync(queue.ReadAllAsync(stoppingToken), new ParallelOptions { MaxDegreeOfParallelism = 4, CancellationToken = stoppingToken },
            async (job, ct) =>
            {
                try
                {
                    await using var scope = scopes.CreateAsyncScope();
                    await scope.ServiceProvider.GetRequiredService<IThumbnailer>().CreateAsync(job, ct);
                }
                catch (Exception ex) { log.LogError(ex, "Thumbnail failed for {ImageId}", job.ImageId); }
            });
}

builder.Services.AddSingleton<ThumbnailQueue>();
builder.Services.AddHostedService<ThumbnailWorker>();

app.MapPost("/images", async (IFormFile file, IBlobStore blobs, ThumbnailQueue queue, CancellationToken ct) =>
{
    var (id, path) = await blobs.SaveAsync(file, ct);
    await queue.EnqueueAsync(new ThumbnailJob(id, path), ct);
    return Results.Accepted($"/images/{id}");
});
```

**Bounded** vs unbounded is a real decision, not a style choice. A bounded channel gives you **backpressure**: once it's full, `EnqueueAsync` just waits until a consumer frees a slot, so producers are forced to slow down to the speed consumers can actually keep up with. An unbounded channel is easier to write, but risky under load: nothing stops it growing forever if producers outpace consumers — right up until the process runs out of memory.

:::gotcha In-memory means losable
Here's the fact this whole section has been building toward: a deploy, a crash, or a scale-in event loses **everything** currently sitting in a `Channel<T>`, instantly and without a trace. Use it only for work you can genuinely afford to lose or simply recompute — thumbnails you can regenerate, cache warm-ups that will just happen again next time. For emails, payments, or anything business-critical, **persist first** — a database table, an outbox, or a message broker — and only then process; never let the only copy of important work exist purely in process memory.
:::

## Durable job systems: Hangfire and Quartz.NET {i}

`Channel<T>` solves "hand work off within this process." It deliberately doesn't solve "survive this process dying," "retry automatically," "run exactly once across many replicas," or "run on a cron schedule" — for those, you want a job library backed by a real database:

| | Hangfire | Quartz.NET |
|---|---|---|
| Model | Fire-and-forget, delayed, recurring (cron), continuations | Jobs + triggers (cron, calendars), clustering |
| Storage | SQL Server, PostgreSQL, Redis… | ADO.NET job store (any major DB) |
| Dashboard | **Built-in web dashboard** (retries, failures, history) | Third-party UIs |
| Distributed | Yes: workers on any instance pull jobs from storage | Yes: clustered mode with DB locks |
| Retries | Automatic with backoff | Configurable |

```csharp
builder.Services.AddHangfire(c => c.UseSqlServerStorage(builder.Configuration.GetConnectionString("Jobs")));
builder.Services.AddHangfireServer(o => o.WorkerCount = 10);

app.MapHangfireDashboard("/jobs").RequireAuthorization("Admin");

app.MapPost("/orders/{id}/invoice", (int id, IBackgroundJobClient jobs) =>
{
    jobs.Enqueue<IInvoiceService>(s => s.GenerateAndEmailAsync(id, CancellationToken.None));   // persisted, retried
    return Results.Accepted();
});

RecurringJob.AddOrUpdate<ICartCleanup>("cart-cleanup", s => s.RunAsync(CancellationToken.None), Cron.Daily(2));   // 02:00 daily, ONCE across the cluster
```

Jobs here should be **idempotent** — a retry after a partial failure must not send two invoices for the one order. That constraint comes straight from the "automatic retries with backoff" row above: if retries are automatic, a job *will* eventually run more than once for the same logical unit of work, whether or not the first attempt actually finished.

## Choosing where background work runs {i}

```text
Can the work be lost on restart?      ── yes ──▶ Channel<T> + BackgroundService (same process)
        │ no
Is it within one service?              ── yes ──▶ Hangfire / Quartz (DB-backed), or an outbox table + worker
        │ no (other services must react)
                                        ───────▶ Message broker (Service Bus / RabbitMQ) + consumers
Spiky / event-triggered / scale to zero? ──────▶ Azure Functions (queue/timer/blob triggers) or Container Apps jobs
Simple periodic job, single instance?  ────────▶ BackgroundService + PeriodicTimer (+ distributed lock if replicated)
```

## Running a job once across replicas {a}

The "every app instance runs its hosted services" row from the lifecycle table earlier has a direct consequence worth solving properly: with several replicas each independently running the same `BackgroundService`, a "nightly job" literally runs once per replica, not once total. The available fixes:

1. **Distributed lock**: acquire a lease before running (SQL `sp_getapplock`, Redis `SET NX PX`, Azure Blob lease, the `DistributedLock` NuGet package); any instance that fails to acquire it simply skips this run.
2. **Dedicated single-replica worker** deployment for schedulers — sidestep the problem by never having more than one instance of the thing that schedules.
3. **Job scheduler** with clustering (Hangfire, Quartz) — the library itself coordinates across instances so only one actually executes.
4. **Platform scheduler**: Kubernetes CronJob, Container Apps jobs, Azure Functions timer trigger (singleton by default) — let the orchestrator guarantee the single run instead of building that guarantee yourself.
5. **Competing consumers on a queue**: for continuous work rather than scheduled work, each message is delivered to only one instance anyway, so this category of problem doesn't even arise.

```csharp
await using var handle = await distributedLock.TryAcquireAsync("nightly-billing", TimeSpan.Zero, stoppingToken);
if (handle is null) return;   // another instance is running it
await billing.RunAsync(stoppingToken);
```

:::qa What is the difference between IHostedService and BackgroundService?
IHostedService is the interface the host calls (StartAsync/StopAsync). BackgroundService is an abstract implementation that starts your ExecuteAsync loop on StartAsync and cancels its stoppingToken on StopAsync, so you implement one long-running method.
:::

:::qa How do you use a DbContext inside a BackgroundService?
Hosted services are singletons, so inject IServiceScopeFactory and create a scope per unit of work (CreateAsyncScope), resolving DbContext from scope.ServiceProvider and disposing the scope afterwards. Or inject IDbContextFactory&lt;T&gt;.
:::

:::qa What happens if a BackgroundService throws an unhandled exception?
Since .NET 6 the default BackgroundServiceExceptionBehavior is StopHost, so the whole application shuts down. Catch exceptions inside the loop, log them and continue (or deliberately fail).
:::

:::qa How do you run periodic work?
A BackgroundService with PeriodicTimer and WaitForNextTickAsync(stoppingToken) for simple cases. For cron schedules, persistence, retries and single execution across a cluster, use Hangfire or Quartz.NET, or a platform scheduler (Functions timer trigger, Kubernetes CronJob).
:::

:::qa What is Channel<T> and when would you use it?
An async producer/consumer queue in System.Threading.Channels. Use it to hand off work from requests to an in-process background consumer with backpressure (bounded channels). It's in-memory only, so items are lost on restart; use durable queues for critical work.
:::

:::qa Your app runs on 3 instances: how do you make sure a scheduled job runs only once?
Use a distributed lock or lease (SQL app lock, Redis, Blob lease), a job scheduler with clustering (Hangfire/Quartz), a dedicated single-instance worker, or a platform scheduler like a Functions timer trigger or Kubernetes CronJob.
:::

:::qa Why is fire-and-forget (Task.Run without await) in a controller a bad idea?
The work isn't tracked by the host (lost on shutdown), exceptions go unobserved, and it often uses request-scoped services (DbContext, HttpContext) that are disposed when the request ends. Use a queue plus a hosted service or a durable job system.
:::

## Further reading

- [Background tasks with hosted services](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/host/hosted-services)
- [Worker services in .NET](https://learn.microsoft.com/en-us/dotnet/core/extensions/workers)
- [System.Threading.Channels](https://learn.microsoft.com/en-us/dotnet/core/extensions/channels)
- [Hangfire documentation](https://docs.hangfire.io/)

## Verify this chapter

Run with `dotnet run` (plain console app, .NET 8/9, top-level statements — `System.Threading.Channels` ships in the shared framework, no extra package needed).

```csharp
using System.Threading.Channels;

// Claim: a bounded Channel<T> gives real backpressure — once full, a write has to wait
// (or fails immediately with TryWrite) instead of growing without limit.
var bounded = Channel.CreateBounded<int>(new BoundedChannelOptions(2) { FullMode = BoundedChannelFullMode.Wait });
if (!bounded.Writer.TryWrite(1)) throw new Exception("FAIL: expected first write to succeed");
if (!bounded.Writer.TryWrite(2)) throw new Exception("FAIL: expected second write to succeed (capacity 2)");
if (bounded.Writer.TryWrite(3)) throw new Exception("FAIL: expected third TryWrite to fail — channel should be full");
Console.WriteLine("OK: bounded Channel<T> rejects writes once full (real backpressure)");

var writeTask = bounded.Writer.WriteAsync(3).AsTask();
await Task.Delay(50);
if (writeTask.IsCompleted) throw new Exception("FAIL: WriteAsync should still be waiting while the channel is full");
await bounded.Reader.ReadAsync(); // frees one slot
await writeTask; // now it can complete
Console.WriteLine("OK: a blocked WriteAsync on a full channel completes once the consumer reads (producer slows down to match the consumer)");

// Claim: PeriodicTimer.WaitForNextTickAsync asynchronously waits for each tick.
using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(20));
var ticked = await timer.WaitForNextTickAsync();
if (!ticked) throw new Exception("FAIL: expected a tick");
Console.WriteLine("OK: PeriodicTimer.WaitForNextTickAsync delivers ticks without blocking a thread");

// Claim: retried jobs must be idempotent — a retry after a partial failure must not double-apply.
var appliedInvoiceIds = new HashSet<int>();
int sideEffectCount = 0;
void ApplyInvoiceIdempotently(int orderId)
{
    if (!appliedInvoiceIds.Add(orderId)) return; // already applied: skip, this is what "idempotent" buys you
    sideEffectCount++;
}
ApplyInvoiceIdempotently(42); // first attempt
ApplyInvoiceIdempotently(42); // retry after the caller never saw the first attempt's result
if (sideEffectCount != 1) throw new Exception($"FAIL: expected exactly 1 side effect, got {sideEffectCount}");
Console.WriteLine("OK: an idempotent handler applies a retried job's effect exactly once");

// Not runtime-verifiable here — these need a real multi-instance deployment or a real crash:
//  - "every app instance runs its own hosted services" (needs more than one process)
//  - BackgroundServiceExceptionBehavior.StopHost shutting down the whole app (needs a real Generic Host)
//  - in-memory channel contents being lost on crash/restart
// See Further reading: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/host/hosted-services
```
