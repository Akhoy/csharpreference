---
id: async-await
title: Asynchronous Programming: Task, async and await
summary: Why backends are asynchronous, what a Task is, what await actually does, the rules (async all the way, no .Result, CancellationToken), running work concurrently, async streams, the state machine, SynchronizationContext and ConfigureAwait, ValueTask, deadlocks and thread-pool starvation.
layer: language
where: C# language › Asynchrony › Task & async/await
fits: Layer 1 syntax over layer 2 machinery (the thread pool). It is the single most important C# feature for backend work. Every ASP.NET Core endpoint, every EF Core query and every HttpClient call in layers 3–6 is async, and many production incidents (thread-pool starvation, deadlocks) come from misusing it.
levels: b,i,a
prereqs: delegates-events, exceptions-disposal
next: threading-concurrency, aspnet-hosting, efcore-querying
---

## TL;DR

- Async/await is about **scalability**, not speed: it frees up the thread while waiting for I/O, so a server can handle many more concurrent requests with the same number of threads.
- `await` doesn't block. If the awaited `Task` isn't done, the method returns to its caller immediately and resumes later — possibly on a different thread — when the result is ready.
- Never block on async code (`.Result`, `.Wait()`): it causes deadlocks in UI/old ASP.NET apps and thread-pool starvation in ASP.NET Core.
- Pass a `CancellationToken` through every async call so work actually stops when the caller gives up.
- Start independent tasks together and `await Task.WhenAll(...)` to run them concurrently instead of one after another.
- Under the hood, the compiler turns every `async` method into a state machine; the first real suspension boxes it onto the heap.

## The problem: threads waiting on I/O {b}

A web server handles many requests concurrently, using threads from the **thread pool**. A typical request spends most of its time **waiting**: on the database, another API, a file, a cache. The CPU is idle during that wait.

**Synchronous code blocks the thread while it waits:**

```csharp
public IActionResult Get(int id)
{
    var order = db.Orders.Find(id);          // thread BLOCKED ~20 ms waiting for SQL
    var stock = http.GetString(url);          // thread BLOCKED ~100 ms waiting for HTTP
    return Ok(...);
}
```

With 100 concurrent requests, you need 100 blocked threads. Under load, the pool runs out, new requests queue, latency explodes, and the server falls over while the CPU sits at 10%. This is **thread-pool starvation**.

**Asynchronous code releases the thread while it waits:**

```csharp
public async Task<IActionResult> Get(int id, CancellationToken ct)
{
    var order = await db.Orders.FindAsync([id], ct);   // thread returns to the pool during the wait
    var stock = await http.GetStringAsync(url, ct);    // ...and again here
    return Ok(...);
}
```

While SQL works, the thread goes back to the pool and serves other requests. When the result arrives, *some* pool thread picks up where the method left off. A handful of threads can serve thousands of concurrent requests.

:::why The one-sentence answer
Async/await in a backend is about **scalability** (serving more concurrent requests with fewer threads), not about making a single request faster. For I/O-bound work there is no thread doing anything during the wait, and async lets you stop pretending there is.
:::

:::analogy The restaurant
A synchronous waiter takes your order, walks to the kitchen, and **stands there** until the food is ready. They serve one table at a time. An asynchronous waiter takes your order, hands it to the kitchen, and **serves other tables**; when the kitchen rings the bell, any free waiter brings the food over. Same kitchen speed, many more tables served.
:::

## I/O-bound vs CPU-bound {b}

| | I/O-bound | CPU-bound |
|---|---|---|
| Time spent | Waiting for something external | Computing |
| Examples | DB queries, HTTP calls, file/network I/O, message brokers | Image resizing, hashing, compression, big calculations |
| Right tool | `async`/`await` with truly async APIs (`*Async` methods) | Run on a thread: `Task.Run` (in UI/background code), `Parallel.For`, a background worker |
| In ASP.NET Core | Always async | Just do it synchronously in the request (it needs a thread anyway), or offload to a background queue if it's long |

:::gotcha Task.Run in ASP.NET Core
Wrapping synchronous work in `await Task.Run(() => DoWork())` inside a request handler **doesn't help**: you release one pool thread and immediately occupy another, with extra overhead. It's useful in UI apps (to keep the UI thread free), not in web requests.
:::

## Task and Task<T> {b}

A **`Task`** represents an operation that will complete in the future. **`Task<T>`** also carries a result of type `T`.

| Property / method | Meaning |
|---|---|
| `Status` | Created, WaitingForActivation, Running, **RanToCompletion**, **Faulted**, **Canceled** |
| `IsCompleted`, `IsCompletedSuccessfully`, `IsFaulted`, `IsCanceled` | State checks |
| `Result` (Task&lt;T&gt;) | The value; **blocks** if not complete (avoid) |
| `Exception` | An `AggregateException` if faulted |
| `await task` | Asynchronously wait, then get the result or rethrow the exception |
| `Task.FromResult(x)`, `Task.CompletedTask` | Already-completed tasks (for sync implementations of async interfaces) |
| `Task.Delay(ms, ct)` | Async wait (never `Thread.Sleep` in async code) |
| `Task.WhenAll`, `Task.WhenAny`, `Task.WhenEach` (.NET 9) | Combinators |

**A Task is not a thread.** For I/O, there's no thread running while the task is pending: the OS notifies the runtime (via I/O completion ports or epoll) when data arrives, and only then is a pool thread used to run your continuation.

## What async and await actually do {b}

- **`async`** on a method does two things: it allows `await` inside, and it makes the compiler wrap the return value or exception into a `Task`. It does **not** make the method run on another thread.
- **`await t`** means: *if `t` is already complete, just continue immediately.* Otherwise, it registers "the rest of this method" as a continuation on `t`, and **returns** to the caller right now instead of waiting. When `t` eventually completes, that continuation runs.

![What await does: the method pauses, hands the thread back, and resumes later possibly on a different thread](visuals/async-state-machine.svg)

That picture is the whole idea in one frame: `await` never blocks a thread waiting around for something slow. It pauses the method exactly where it is, remembers everything it needs to carry on (its local variables), hands the thread back so it can go do something else useful, and picks up again later — often on a completely different thread — right where it left off. The ["Under the hood" section](#under-the-hood-the-state-machine) below shows precisely how the compiler makes "remember everything and pick up later" actually work.

```csharp
public async Task<decimal> GetTotalAsync(int orderId)
{
    Console.WriteLine("A");                       // runs synchronously on the caller's thread
    var order = await repo.GetAsync(orderId);     // if not done: method returns an incomplete Task to the caller here
    Console.WriteLine("B");                       // runs later, on a pool thread, when GetAsync finishes
    return order.Total;                           // completes the Task<decimal> with this value
}
```

Return types: `Task`, `Task<T>`, `ValueTask`, `ValueTask<T>`, `IAsyncEnumerable<T>`, or `void` (event handlers only).

## The rules {b}

### 1. Async all the way

Once something is async, its callers should be async too, up to the framework entry point (the controller action or endpoint, which ASP.NET Core awaits for you).

### 2. Never block on async code

```csharp
var user = GetUserAsync().Result;              // ✘ blocks a thread; can deadlock
GetUserAsync().Wait();                          // ✘
var user2 = GetUserAsync().GetAwaiter().GetResult();  // ✘ same problem, nicer exception
var user3 = await GetUserAsync();               // ✔
```

This "sync over async" causes thread-pool starvation in ASP.NET Core, and **deadlocks** in UI apps and old ASP.NET (see [deadlocks](#deadlocks-and-thread-pool-starvation)).

### 3. Avoid async void

```csharp
async void Bad() { await Task.Delay(1); throw new Exception(); }   // ✘ crashes the process; can't be awaited
async Task Good() { await Task.Delay(1); throw new Exception(); }  // ✔ exception stored in the Task
```

### 4. Pass a CancellationToken through everything

```csharp
app.MapGet("/report", async (IReportService svc, CancellationToken ct) => await svc.BuildAsync(ct));
// ASP.NET Core binds ct to HttpContext.RequestAborted: cancelled if the client disconnects

public async Task<Report> BuildAsync(CancellationToken ct)
{
    var rows = await db.Sales.Where(...).ToListAsync(ct);      // EF Core cancels the SQL command
    var fx = await http.GetFromJsonAsync<Rates>(url, ct);       // HttpClient aborts the request
    ct.ThrowIfCancellationRequested();                          // check manually in long CPU loops
    return Compose(rows, fx);
}
```

Analyzer **CA2016** warns when you forget to forward a token.

### 5. Use the async APIs

Use `ToListAsync`, `SaveChangesAsync`, `ReadAsStringAsync`, `File.ReadAllTextAsync`, `Task.Delay`, `SemaphoreSlim.WaitAsync`, not their blocking equivalents.

### 6. Don't use async when you just pass the task through (optional)

```csharp
public Task<Order?> GetAsync(int id) => repo.GetAsync(id);   // no state machine; slightly cheaper
```

But keep `async`/`await` if there's a `using`, a `try/catch`, or more than one statement; otherwise the resource can be disposed before the task completes and exceptions behave differently.

## Running work concurrently {i}

Sequential awaits take the **sum** of the latencies. Starting tasks first and awaiting them together takes the **maximum**:

```csharp
// Sequential: ~300 ms
var user = await users.GetAsync(id, ct);           // 100 ms
var orders = await ordersApi.GetAsync(id, ct);     // 200 ms

// Concurrent: ~200 ms
var userTask = users.GetAsync(id, ct);             // both started
var ordersTask = ordersApi.GetAsync(id, ct);
await Task.WhenAll(userTask, ordersTask);
var (u, o) = (userTask.Result, ordersTask.Result); // .Result is fine here: the tasks are complete
```

| Combinator | Completes when | Use |
|---|---|---|
| `Task.WhenAll(tasks)` | All complete (faults if any fault) | Fan-out calls, batch processing |
| `Task.WhenAny(tasks)` | The first completes | Timeouts, "fastest wins", hedging |
| `Task.WhenEach(tasks)` (.NET 9) | `IAsyncEnumerable` yielding tasks as they finish | Process results in completion order |
| `Parallel.ForEachAsync(items, opts, body)` | All items processed with a max degree of parallelism | Bounded concurrency over a list |
| `task.WaitAsync(TimeSpan, ct)` (.NET 6) | Task completes or timeout | Adding a timeout to any task |

```csharp
// Bounded concurrency: never fire 10,000 HTTP calls at once
await Parallel.ForEachAsync(productIds, new ParallelOptions { MaxDegreeOfParallelism = 8, CancellationToken = ct },
    async (id, token) => await SyncProductAsync(id, token));
```

:::gotcha DbContext is not thread-safe
`Task.WhenAll(db.Orders.ToListAsync(), db.Customers.ToListAsync())` on the **same** DbContext throws "A second operation was started on this context". Run EF queries sequentially, or use separate contexts from `IDbContextFactory<T>`.
:::

## Cancellation and timeouts {i}

```csharp
using var cts = CancellationTokenSource.CreateLinkedTokenSource(requestToken);  // combine with the caller's token
cts.CancelAfter(TimeSpan.FromSeconds(5));                                        // add a timeout

try
{
    var data = await client.GetAsync(url, cts.Token);
}
catch (OperationCanceledException) when (!requestToken.IsCancellationRequested)
{
    // our 5 s timeout fired (not the client disconnecting)
    return Results.StatusCode(StatusCodes.Status504GatewayTimeout);
}
```

- **Cooperative:** cancelling a token doesn't kill anything. Code must observe the token (async APIs do this for you).
- Cancellation surfaces as `OperationCanceledException`, which is normal flow. Don't log it as an error.
- Dispose `CancellationTokenSource`s you create (they may hold timers).

## Async streams: IAsyncEnumerable {i}

When results arrive over time (DB rows, pages from an API, messages), stream them instead of buffering everything:

```csharp
public async IAsyncEnumerable<Product> GetAllAsync([EnumeratorCancellation] CancellationToken ct = default)
{
    string? next = "/products?page=1";
    while (next is not null)
    {
        var page = await http.GetFromJsonAsync<Page<Product>>(next, ct);
        foreach (var p in page!.Items) yield return p;
        next = page.NextLink;
    }
}

await foreach (var p in GetAllAsync(ct)) { /* process each as it arrives */ }

// ASP.NET Core streams IAsyncEnumerable responses as a JSON array without buffering
app.MapGet("/export", (ShopDb db) => db.Orders.AsNoTracking().AsAsyncEnumerable());
```

## Under the hood: the state machine {a}

The compiler rewrites every `async` method into a **struct state machine** implementing `IAsyncStateMachine`. Locals become fields; each `await` becomes a numbered state.

```csharp
// You write:
async Task<int> GetLengthAsync(string url)
{
    var s = await http.GetStringAsync(url);
    return s.Length;
}

// The compiler generates (simplified):
struct GetLengthStateMachine : IAsyncStateMachine
{
    public int state;                                  // -1 = running, 0 = waiting at first await
    public AsyncTaskMethodBuilder<int> builder;        // creates/completes the returned Task
    public string url;                                 // parameters and locals become fields
    private TaskAwaiter<string> awaiter;

    public void MoveNext()
    {
        try
        {
            if (state != 0)
            {
                awaiter = http.GetStringAsync(url).GetAwaiter();
                if (!awaiter.IsCompleted)
                {
                    state = 0;
                    builder.AwaitUnsafeOnCompleted(ref awaiter, ref this); // box to heap, register continuation
                    return;                                                // ← method "returns" here
                }
            }
            string s = awaiter.GetResult();            // resumes here; rethrows if faulted
            builder.SetResult(s.Length);               // completes the Task<int>
        }
        catch (Exception ex) { builder.SetException(ex); }
    }
}
```

Key insights:

- If every awaited task is **already complete**, the method runs entirely synchronously, with no allocation beyond the Task (the state machine stays on the stack).
- The first time it actually suspends, the state machine is **boxed onto the heap**, which is why locals in async methods live on the heap and why `Span<T>` can't cross an `await`.
- `await` works on anything with a `GetAwaiter()` method (the **awaitable pattern**), not just Task.

Look at any async method in **SharpLab** to see the real generated code.

## SynchronizationContext and ConfigureAwait {a}

When an `await` resumes, *where* does the continuation run? It depends on the captured **SynchronizationContext**:

| Environment | SynchronizationContext | Continuation runs on |
|---|---|---|
| WPF / WinForms / MAUI | UI context | The UI thread (so you can touch controls) |
| Old ASP.NET (Framework) | `AspNetSynchronizationContext` | One-at-a-time per request, with HttpContext.Current restored |
| **ASP.NET Core** | **None** | Any thread-pool thread |
| Console / worker apps | None | Any thread-pool thread |

**`ConfigureAwait(false)`** says "don't capture the context; resume anywhere".

- In **ASP.NET Core application code** it changes nothing (there's no context), so you can omit it.
- In **library code** that might be used from UI or legacy ASP.NET apps, use `ConfigureAwait(false)` on every await. It avoids deadlocks for callers who block, and avoids needless hops to the UI thread.

`ExecutionContext` is different: it carries `AsyncLocal<T>` values (used for logging scopes, `Activity.Current` for tracing, culture) and **always** flows across awaits, regardless of ConfigureAwait.

## Deadlocks and thread-pool starvation {a}

### The classic deadlock (UI apps, old ASP.NET)

```csharp
// In a WPF button handler or an ASP.NET (Framework) controller:
var data = GetDataAsync().Result;     // 1. blocks the UI/request thread, waiting for the task

async Task<string> GetDataAsync()
{
    var s = await http.GetStringAsync(url);   // 2. when the HTTP call finishes, the continuation
    return s;                                 //    must run on the captured context, which is the
}                                             //    blocked thread from step 1. Neither proceeds: DEADLOCK.
```

Fixes: don't block (await all the way), or use `ConfigureAwait(false)` inside the library.

### Thread-pool starvation (ASP.NET Core)

There's no deadlock in ASP.NET Core, but blocking still hurts. Each `.Result` holds a pool thread hostage. The pool adds threads slowly (about one or two per second once past its minimum) to avoid over-subscription. Under a burst of load:

- Symptoms: **latency climbs to seconds, CPU stays low, thread count slowly rises**, requests time out, health checks fail.
- Diagnose: `dotnet-counters monitor` shows a growing `ThreadPool Queue Length` and thread count; a `dotnet-dump` shows many threads blocked in `Task.Wait` / `GetResult`.
- Fix: remove sync-over-async. (Raising `ThreadPool.SetMinThreads` is only a stop-gap.)

## ValueTask {a}

`Task<T>` is a class, so every async call that completes allocates one. **`ValueTask<T>`** is a struct that can wrap either a direct result (no allocation) or a Task:

```csharp
public ValueTask<Product?> GetAsync(int id, CancellationToken ct)
{
    if (_cache.TryGetValue(id, out var p)) return ValueTask.FromResult<Product?>(p);   // hot path: no allocation
    return new ValueTask<Product?>(LoadAndCacheAsync(id, ct));                         // cold path: wraps a Task
}
```

Use it for **hot methods that usually complete synchronously** (cache hits, buffered reads). Rules: **await it exactly once**, never await it concurrently, and don't call `.Result` before it completes. If you need to store or await it twice, call `.AsTask()`. Default to `Task` everywhere else.

## Fire-and-forget and background work {i}

```csharp
app.MapPost("/signup", async (User u, IEmailSender email) =>
{
    await SaveAsync(u);
    _ = email.SendWelcomeAsync(u);     // ✘ fire-and-forget inside a request
    return Results.Ok();
});
```

Problems: exceptions are never observed, the work is killed on shutdown, and any scoped dependency (DbContext) may be **disposed** when the request ends while the task is still running. Instead, enqueue the work to a **background service** via a `Channel<T>`, or a durable queue. See [Background work](ch:background-work).

## Async and locks {i}

You can't `await` inside a `lock` block (the compiler forbids it, because the continuation may run on a different thread than the one that holds the lock). Use `SemaphoreSlim`:

```csharp
private readonly SemaphoreSlim _mutex = new(1, 1);

public async Task RefreshTokenAsync(CancellationToken ct)
{
    await _mutex.WaitAsync(ct);
    try { if (TokenExpired) _token = await FetchTokenAsync(ct); }
    finally { _mutex.Release(); }
}
```

More in [Threading & concurrency](ch:threading-concurrency).

:::qa Does async/await make code faster?
Not for a single operation; it adds a small overhead. It improves scalability: threads aren't blocked during I/O, so a server handles far more concurrent requests with fewer threads. Total latency can drop when independent operations run concurrently via Task.WhenAll.
:::

:::qa What does the await keyword actually do?
If the awaited task is already complete, execution continues synchronously. Otherwise, it registers the rest of the method as a continuation on the task and returns an incomplete Task to the caller, freeing the thread. When the task completes, the continuation resumes, on the captured SynchronizationContext if there is one, otherwise on a thread-pool thread.
:::

:::qa Does async create a new thread?
No. async/await doesn't create threads. For I/O-bound operations no thread is used while waiting; completion is signalled by the OS and a pool thread runs the continuation. Task.Run is what explicitly queues work to a pool thread.
:::

:::qa Why is calling .Result or .Wait() on a Task dangerous?
It blocks a thread until the task completes. With a single-threaded SynchronizationContext (UI apps, old ASP.NET) it deadlocks, because the continuation needs the blocked thread. In ASP.NET Core it causes thread-pool starvation under load. Exceptions are also wrapped in AggregateException.
:::

:::qa Why should you avoid async void?
The caller can't await it or know when it finishes, and exceptions can't be caught by the caller: they're raised on the context or thread pool and crash the process. Use async Task; async void is only for event handlers.
:::

:::qa What is ConfigureAwait(false) and do you need it in ASP.NET Core?
It tells await not to resume on the captured SynchronizationContext. ASP.NET Core has no SynchronizationContext, so it makes no difference in application code there. Library authors should still use it because their code may run in UI or legacy ASP.NET apps where it prevents deadlocks and unnecessary context switches.
:::

:::qa How do you run multiple async operations concurrently?
Start them without awaiting (store the tasks), then `await Task.WhenAll(...)`. Use Parallel.ForEachAsync or a SemaphoreSlim for bounded concurrency. Don't run concurrent operations on non-thread-safe objects like a single DbContext.
:::

:::qa How does cancellation work in .NET?
Cooperatively. A CancellationTokenSource issues tokens; calling Cancel (or CancelAfter) sets the token, and code that observes it (async APIs, ThrowIfCancellationRequested) stops by throwing OperationCanceledException. ASP.NET Core provides HttpContext.RequestAborted, bound to a CancellationToken endpoint parameter.
:::

:::qa What does the compiler generate for an async method?
A state machine struct with the locals as fields and a MoveNext method split at each await. It uses an AsyncTaskMethodBuilder to create and complete the returned Task. On the first real suspension the state machine is boxed to the heap and registered as the awaiter's continuation.
:::

:::qa When would you use ValueTask instead of Task?
For hot-path methods that frequently complete synchronously (cache hits), to avoid allocating a Task. It must be awaited only once and not concurrently. Default to Task otherwise.
:::

:::qa What is thread-pool starvation and how do you diagnose it?
All pool threads are blocked (usually by sync-over-async), so queued work waits while the pool slowly injects threads. You see high latency with low CPU and a growing thread count and queue length in dotnet-counters, and dumps show threads blocked in Wait/GetResult. Fix it by making the call chain async.
:::

:::qa What's the risk of fire-and-forget tasks in a web request?
Unobserved exceptions, work lost on shutdown, and use of scoped services (like DbContext) after the request scope disposes them. Use a background service with a queue (Channel&lt;T&gt;) or a durable job system instead.
:::

## Further reading

- [Asynchronous programming with async and await](https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/)
- [Task-based asynchronous pattern](https://learn.microsoft.com/en-us/dotnet/standard/asynchronous-programming-patterns/task-based-asynchronous-pattern-tap)
- Stephen Toub, *How Async/Await Really Works in C#* (.NET Blog): the definitive deep dive.
- David Fowler, *AspNetCoreDiagnosticScenarios: AsyncGuidance* (GitHub): practical rules for ASP.NET Core.
- Book: *Concurrency in C# Cookbook* by Stephen Cleary.

## Verify this chapter

Save as `Program.cs` in a new console project (`dotnet new console`) and run with `dotnet run`. It checks sequential vs. concurrent timing, cancellation, async streams, `ValueTask`, bounded concurrency, and `SemaphoreSlim`-based async locking — timing checks use generous margins, but on an extremely slow or loaded machine they could occasionally be flaky.

```csharp
using System.Diagnostics;
using System.Runtime.CompilerServices;

int failures = 0;
void Check(string claim, bool ok)
{
    if (ok) Console.WriteLine($"OK: {claim}");
    else { Console.WriteLine($"FAIL: {claim}"); failures++; }
}

// 1. Sequential awaits take the SUM of latencies; concurrent tasks take the MAX
var swSeq = Stopwatch.StartNew();
await DelayedValue(80); await DelayedValue(80);
swSeq.Stop();

var swConc = Stopwatch.StartNew();
var tA = DelayedValue(80);
var tB = DelayedValue(80);
await Task.WhenAll(tA, tB);
swConc.Stop();

Check("sequential awaits take roughly the sum of the delays (slower)", swSeq.ElapsedMilliseconds >= 140);
Check("Task.WhenAll on tasks started together takes roughly the max, not the sum (faster)",
    swConc.ElapsedMilliseconds < swSeq.ElapsedMilliseconds);

// 2. CancellationToken: cooperative cancellation, OperationCanceledException
using var cts = new CancellationTokenSource();
cts.CancelAfter(30);
bool cancelled = false;
try { await LongLoopAsync(cts.Token); }
catch (OperationCanceledException) { cancelled = true; }
Check("a cancelled CancellationToken causes OperationCanceledException to propagate", cancelled);

// 3. IAsyncEnumerable: results can be consumed as they arrive via await foreach
var collected = new List<int>();
await foreach (var n in CountAsync(5)) collected.Add(n);
Check("await foreach consumes an IAsyncEnumerable<T> item by item", collected.SequenceEqual(new[] { 1, 2, 3, 4, 5 }));

// 4. ValueTask: a hot path can complete synchronously without allocating a Task
var vt = GetCachedOrLoad(hit: true);
Check("a ValueTask created from a direct value completes synchronously", vt.IsCompletedSuccessfully);
Check("awaiting that ValueTask returns the right value", await vt == 42);

// 5. Parallel.ForEachAsync respects MaxDegreeOfParallelism (bounded concurrency)
int active = 0, maxObserved = 0;
var gate = new object();
await Parallel.ForEachAsync(Enumerable.Range(1, 20), new ParallelOptions { MaxDegreeOfParallelism = 3 },
    async (i, ct) =>
    {
        lock (gate) { active++; maxObserved = Math.Max(maxObserved, active); }
        await Task.Delay(15, ct);
        lock (gate) { active--; }
    });
Check("Parallel.ForEachAsync never exceeds MaxDegreeOfParallelism concurrent items", maxObserved <= 3);

// 6. SemaphoreSlim.WaitAsync serializes access the way lock would, but is awaitable
var semaphore = new SemaphoreSlim(1, 1);
int counter = 0;
bool sawOverlap = false;
async Task IncrementAsync()
{
    await semaphore.WaitAsync();
    try
    {
        int before = counter;
        await Task.Delay(5);
        if (counter != before) sawOverlap = true;
        counter = before + 1;
    }
    finally { semaphore.Release(); }
}
await Task.WhenAll(IncrementAsync(), IncrementAsync(), IncrementAsync());
Check("SemaphoreSlim.WaitAsync lets only one caller through at a time", !sawOverlap && counter == 3);

Console.WriteLine(failures == 0 ? "\nAll checks passed." : $"\n{failures} check(s) failed.");
if (failures > 0) Environment.Exit(1);

static async Task<int> DelayedValue(int ms) { await Task.Delay(ms); return ms; }

static async Task LongLoopAsync(CancellationToken ct)
{
    for (int i = 0; i < 1000; i++)
    {
        ct.ThrowIfCancellationRequested();
        await Task.Delay(5, ct);
    }
}

static async IAsyncEnumerable<int> CountAsync(int n, [EnumeratorCancellation] CancellationToken ct = default)
{
    for (int i = 1; i <= n; i++)
    {
        await Task.Delay(1, ct);
        yield return i;
    }
}

static ValueTask<int> GetCachedOrLoad(bool hit) =>
    hit ? ValueTask.FromResult(42) : new ValueTask<int>(Task.Run(() => 42));
```

Not runtime-verifiable here: that no thread sits blocked during an `await` (requires inspecting the thread pool, not just timing), and the exact deadlock/thread-pool-starvation scenarios in the "Deadlocks" section — those need a UI/old-ASP.NET host or a loaded server to reproduce. Take those on trust from [Further reading](#further-reading), or reproduce them deliberately in a throwaway WPF/console project.
