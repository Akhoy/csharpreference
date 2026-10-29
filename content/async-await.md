---
id: async-await
title: "Async and Await: Don't Hold a Thread While You Wait"
summary: "Episode 8. Black Friday: the site freezes with the CPU at 5%, because every thread is stuck waiting for the payment API. async/await lets a thread serve someone else while it waits. Covers I/O vs CPU work, Task, what await really does, the rules, running work concurrently, cancellation, async streams, the compiler's state machine, SynchronizationContext and ConfigureAwait, deadlocks and thread-pool starvation, ValueTask, fire-and-forget, and async locks."
layer: language
where: C# language › Asynchrony › Task & async/await
fits: Layer 1 syntax over layer 2 machinery (the thread pool). It's the single most important C# feature for backend work. Every ASP.NET Core endpoint, EF Core query and HttpClient call in layers 3–6 is async, and many production incidents (thread-pool starvation, deadlocks) come from misusing it.
levels: b,i,a
prereqs: delegates-events, exceptions-disposal
next: threading-concurrency, aspnet-hosting, efcore-querying
---

## The 30-second version

- Most backend time is spent **waiting**: for the database, another API, the disk. Synchronous code **holds a thread** the whole time it waits. Under load you run out of threads while the CPU sits idle. That's **thread-pool starvation**.
- **`await`** splits a method in two. If the work isn't done, the method **returns an unfinished `Task` and frees the thread**. When the work finishes, a pool thread runs the rest.
- A **`Task`** is a promise of a result later. **A Task is not a thread.** While a network call is pending, no thread is waiting for it at all.
- Async is about **scalability** (more requests with fewer threads), not making one request faster.
- The rules: **async all the way**, **never `.Result` or `.Wait()`**, **no `async void`**, **pass a `CancellationToken`**, and run independent calls together with **`Task.WhenAll`**.

## Words you'll meet

| Word | In plain words |
|---|---|
| **thread** | A worker that runs your code, one instruction after another. |
| **thread pool** | The shared team of threads a server uses to handle requests. |
| **I/O** | Input/output: waiting on something outside the CPU, like a database, a network or a disk. |
| **`Task`** | An object standing for work that will finish later: a receipt you can redeem for the result. |
| **`await`** | "If this isn't finished, give my thread back and continue here when it is." |
| **continuation** | The rest of the method after an `await`, which runs once the awaited work is done. |
| **thread-pool starvation** | Every thread is busy *waiting*, so new requests queue up while the CPU sits idle. |
| **`CancellationToken`** | A "please stop" signal passed down through your calls. |
| **SynchronizationContext** | A rule some apps (UI apps) have about *which* thread may run the continuation. |
| **deadlock** | Two things each waiting for the other, forever. |

## Previously, and the incident {b}

In [Episode 7](ch:exceptions-disposal) Kettle learned to fail cleanly. Then came **Black Friday**. Traffic jumped 20×, and the site froze. Pages took 30 seconds, then timed out. The odd part was the server's **CPU at 5%**. It wasn't busy. A memory dump showed hundreds of threads, **every one of them waiting** on this line:

```csharp norun
public IActionResult Pay(int orderId)
{
    var order = db.Orders.Find(orderId);                 // waits ~20 ms for SQL
    var result = payments.Charge(order.Total);           // waits ~800 ms for the payment API (slow today)
    return Ok(result);
}
```

A web server handles requests on threads from a shared **thread pool**. This code takes a thread and then *sits on it* for 820 ms doing nothing but waiting. At 500 checkouts a second you'd need hundreds of threads all waiting. The pool adds threads only slowly, so new requests **queue up for a free thread** while the existing ones stare at the network.

## The lightbulb: free the thread while you wait {b}

During those 800 ms the thread isn't *doing* anything. The network card is waiting for bytes. So why hold a thread at all?

**`await`** is how you say: *"start this, and if it isn't finished, give my thread back. Wake me when the answer arrives."* The thing you await is a **`Task`**, an object that stands for "a result that will arrive later". When the answer arrives, any free pool thread picks up where you left off. A handful of threads can then keep thousands of requests in flight.

:::scene visuals/scenes/async-threads.svg | Two threads, four checkouts
1. **Synchronous:** each thread takes a request, calls the payment API, then just **sits there** until it replies.
2. Both threads are busy doing nothing. Requests C and D queue up with no free thread. CPU is at 5%. This is **thread-pool starvation**, the Black Friday incident.
3. **Async:** thread 1 starts A. At the `await` the thread is **handed back**, so it starts B, then C and D. All four are waiting at the payment API, and **no thread is blocked**.
4. As replies arrive, **any** free thread finishes each request. Same 2 threads, 4 requests, no queue. Real servers do this with thousands.
:::

```csharp norun
public async Task<IActionResult> Pay(int orderId, CancellationToken ct)
{
    var order = await db.Orders.FindAsync([orderId], ct);       // thread freed during the SQL wait
    var result = await payments.ChargeAsync(order!.Total, ct);  // and again during the API wait
    return Ok(result);
}
```

Same logic, same speed for one request, but the server can now handle far more at once.

:::analogy The waiter
A synchronous waiter takes your order to the kitchen and **stands there** until the food is ready. They serve one table at a time. An async waiter hands the order in and **serves other tables**, and when the kitchen rings the bell, any free waiter brings the food. The kitchen isn't any faster, but far more tables get served.
:::

:::qa Does async/await make code faster?
Not for a single operation, which actually gets a small overhead. It improves scalability: threads aren't blocked during I/O, so a server handles far more concurrent requests with fewer threads. Total latency can drop when independent operations run concurrently with `Task.WhenAll`.
:::

## What `await` actually does {b}

Here's the exact sequence, in a program you can run. The "payment API" is a `TaskCompletionSource`, a Task that we finish by hand, so you can watch every step:

```csharp
var paymentApi = new TaskCompletionSource<decimal>();      // stands in for a slow HTTP call

Task<string> checkout = Shop.CheckoutAsync(paymentApi.Task);
Console.WriteLine($"2. back in the caller: checkout finished? {checkout.IsCompleted}  ← thread is free");
Console.WriteLine("   (the thread could serve other requests here)");

paymentApi.SetResult(18.50m);                              // the payment API finally replies
Console.WriteLine($"5. {checkout.Result}");                // already complete, so this doesn't block

static class Shop
{
    public static async Task<string> CheckoutAsync(Task<decimal> paymentCall)
    {
        var orderId = 42;
        Console.WriteLine("1. checkout starts and calls the payment API");
        var charged = await paymentCall;                   // not finished → RETURN to the caller now
        Console.WriteLine($"4. resumed after await (order {orderId} remembered)");
        return $"order {orderId}: charged £{charged}";
    }
}
```

Read the output order: **1, 2, 4, 5**. At the `await`, the method **returned** to its caller (step 2) before it finished. When the result arrived, it **resumed exactly where it stopped**, with `orderId` still set.

:::scene visuals/scenes/async-await-split.svg | `await` splits your method in two
1. Thread 7 runs the first part of the method like any normal code.
2. `ChargeAsync` starts the HTTP call and returns an **unfinished Task**. `await` sees "not done yet", saves the local variables, notes "resume here", and **returns an unfinished Task to the caller**.
3. Thread 7 goes back to the pool to serve other requests. During the wait, **no thread is waiting**. The network card is, and the OS tells .NET when bytes arrive.
4. The reply arrives. A free pool thread (maybe thread 3, not 7) restores the locals and runs the second part. This second part is called the **continuation**.
5. The compiler generated all of this for you: a **state machine** with a "where was I" number and your locals stored as fields. `return "paid"` completes the Task, which wakes up whoever awaited it.
:::

So two keywords:

- **`async`** on a method allows `await` inside it and wraps the result (or exception) in a `Task`. It does **not** create a thread.
- **`await t`**: if `t` is already finished, carry straight on. If not, return to the caller now and run the rest of the method later, when `t` finishes.

:::qa What does the await keyword actually do?
If the awaited task is already complete, execution continues synchronously. Otherwise `await` registers the rest of the method as a continuation, returns an incomplete Task to the caller, and frees the thread. When the task completes, the continuation runs (on a pool thread in ASP.NET Core) and either returns the result or rethrows the exception.
:::

:::qa Does async create a new thread?
No. `async`/`await` doesn't create threads. For I/O, no thread is used at all while waiting, because the OS signals completion and a pool thread runs the continuation. Only `Task.Run` (or similar) explicitly queues work onto a pool thread.
:::

## Task: a receipt for work in progress {b}

A **`Task`** is like a collection ticket at a dry cleaner's. It's proof the work is underway, and it's how you pick up the result (`Task<T>`) or find out it failed. It has three end states:

| End state | Means | `await` does |
|---|---|---|
| **RanToCompletion** | it worked | gives you the result |
| **Faulted** | it threw | rethrows the exception ([Episode 7](ch:exceptions-disposal#exceptions-in-async-code)) |
| **Canceled** | it was cancelled | throws `OperationCanceledException` |

```csharp
var ok = Task.FromResult(5);                       // an already-finished Task
Console.WriteLine($"{ok.Status}: {ok.Result}");

var tcs = new TaskCompletionSource<int>();
var failing = AddOne(tcs.Task);
tcs.SetException(new TimeoutException("payment API timed out"));
Console.WriteLine($"{failing.Status}: {failing.Exception!.InnerException!.Message}");   // stored, not thrown

static async Task<int> AddOne(Task<int> t) => await t + 1;
```

Useful members: `Task.FromResult(x)` and `Task.CompletedTask` (ready-made finished tasks), `Task.Delay(ms, ct)` (wait without a thread; **never `Thread.Sleep`** in async code), and `Task.WhenAll` / `WhenAny`.

## I/O-bound vs CPU-bound {b}

| | I/O-bound | CPU-bound |
|---|---|---|
| Time spent | waiting for something outside | calculating |
| Kettle example | SQL, payment API, sending email | resizing product photos, hashing |
| Tool | `await` the `*Async` APIs | needs a thread anyway: just run it (or a background worker) |

:::gotcha `Task.Run` in a web request doesn't help
`await Task.Run(() => DoWork())` inside an endpoint frees one pool thread and immediately takes another, plus some overhead. It helps in **UI apps** (to keep the UI thread responsive), not in ASP.NET Core.
:::

## The five rules {b}

**1. Async all the way.** Once a method awaits, its callers should be async too, all the way up to the endpoint, which ASP.NET Core awaits for you.

**2. Never block on a Task.** No `.Result`, `.Wait()` or `.GetAwaiter().GetResult()` on unfinished work. It brings back the exact problem async solves, and in some apps it **deadlocks** ([see below](#deadlocks-and-thread-pool-starvation)).

```csharp norun
var user = GetUserAsync().Result;     // ✗ holds a thread hostage; can deadlock
var user = await GetUserAsync();      // ✓
```

**3. No `async void`** except UI event handlers. Nobody can await it, and an exception inside it **crashes the process**.

```csharp norun
async void Bad()  { await Task.Delay(1); throw new Exception(); }   // ✗ crashes the app
async Task Good() { await Task.Delay(1); throw new Exception(); }   // ✓ stored in the Task
```

**4. Pass a `CancellationToken` everywhere.** ASP.NET Core gives you one that fires if the user closes the page. Pass it on so the database and HTTP calls stop too:

```csharp norun
app.MapGet("/report", (IReportService svc, CancellationToken ct) => svc.BuildAsync(ct));

public async Task<Report> BuildAsync(CancellationToken ct)
{
    var rows = await db.Sales.Where(s => s.Year == 2026).ToListAsync(ct);   // EF cancels the SQL
    var fx = await http.GetFromJsonAsync<Rates>(url, ct);                   // HttpClient aborts
    return Compose(rows, fx);
}
```

**5. Use the real async APIs**: `ToListAsync`, `SaveChangesAsync`, `File.ReadAllTextAsync`, `SemaphoreSlim.WaitAsync`. A method that ends in `Async` but blocks inside doesn't free anything.

:::tip Passing a task straight through
`public Task<Order?> GetAsync(int id) => repo.GetAsync(id);` can skip `async`/`await` and save a little overhead. Keep the keywords if there's a `using`, a `try/catch`, or more than one statement. Otherwise the resource may be disposed before the task finishes.
:::

:::qa Why is calling .Result or .Wait() on a Task dangerous?
It blocks a thread until the task finishes. In ASP.NET Core that wastes pool threads and causes starvation under load. In apps with a SynchronizationContext (UI, classic ASP.NET) it can deadlock, because the continuation needs the very thread that's blocked. It also wraps exceptions in `AggregateException`. Use `await`.
:::

:::qa Why should you avoid async void?
Callers can't await it, so they can't know when it finishes, and exceptions can't be caught by the caller. They're raised on the SynchronizationContext or thread pool, where they typically crash the process. Use `async Task`. Reserve `async void` for event handlers.
:::

## Doing several things at once {i}

:::plain
If two slow calls don't depend on each other, start both before waiting for either. Then you wait for the slower one only, instead of both added together.
:::

The order page needs the customer and their recent orders, from two different services. Awaiting them one after the other takes the **sum** of the times. Starting both, *then* awaiting, takes only the **longest**:

:::scene visuals/scenes/async-whenall.svg | One after the other, or both at once?
1. `await customer`, *then* `await history`: the second call doesn't even start until the first finishes. That's 100 ms + 200 ms = **300 ms**, even though neither call needs the other's result.
2. Instead, start both calls *without* awaiting yet. Both requests are now in flight at the same moment.
3. Then `await Task.WhenAll(customerTask, historyTask)`. It finishes when the slowest one does: **200 ms** in total.
:::

```csharp norun
// one after the other: ~300 ms
var customer = await customers.GetAsync(id, ct);    // 100 ms
var history  = await orders.GetRecentAsync(id, ct); // 200 ms

// together: ~200 ms
var customerTask = customers.GetAsync(id, ct);      // both start now
var historyTask  = orders.GetRecentAsync(id, ct);
await Task.WhenAll(customerTask, historyTask);
var (c, h) = (customerTask.Result, historyTask.Result);   // .Result is fine: both are finished
```

| Tool | Finishes when | Use |
|---|---|---|
| `Task.WhenAll` | all are done (and fails if any fails) | fan-out calls |
| `Task.WhenAny` | the first one is done | timeouts, "fastest wins" |
| `Task.WhenEach` (.NET 9) | gives you each task as it finishes | process results as they come |
| `Parallel.ForEachAsync` | all items are done, with a concurrency limit | "sync 10,000 products, 8 at a time" |
| `task.WaitAsync(timeout, ct)` | the task finishes or the timeout passes | add a timeout to anything |

```csharp norun
await Parallel.ForEachAsync(productIds,
    new ParallelOptions { MaxDegreeOfParallelism = 8, CancellationToken = ct },
    async (id, token) => await SyncProductAsync(id, token));   // never 10,000 calls at once
```

:::gotcha One DbContext, one query at a time
`Task.WhenAll(db.Orders.ToListAsync(), db.Customers.ToListAsync())` on the **same** `DbContext` throws "A second operation was started on this context". Run EF queries one after another, or use separate contexts from `IDbContextFactory<T>`.
:::

:::qa How do you run multiple async operations concurrently?
Start them all without awaiting, so they run concurrently, then `await Task.WhenAll(...)`. Use `Task.WhenAny` for first-to-finish or timeouts, and `Parallel.ForEachAsync` or a `SemaphoreSlim` to limit concurrency. Don't share a non-thread-safe resource such as a DbContext between them.
:::

## Cancellation and timeouts {i}

:::plain
A `CancellationToken` is a "please stop" flag that you pass down through every call. When it's raised, each piece of code that's watching it stops its own work.
:::

Cancellation in .NET is **cooperative**. A `CancellationTokenSource` raises the flag, and the code holding the token **checks it and stops**. Nothing gets killed by force.

:::scene visuals/scenes/async-cancel.svg | One "stop" signal, passed all the way down
1. ASP.NET Core gives every request a token (`RequestAborted`). You pass the same token, usually called `ct`, down to every call you make.
2. The user closes the page halfway through.
3. The token flips to "cancelled". Each level is watching it: EF Core cancels the SQL command, and HttpClient aborts its request. No wasted work.
4. Nothing is killed by force. Code stops *itself* by throwing `OperationCanceledException`, which is normal flow, not an error. Forget to pass `ct` down one level, and that level carries on working for nobody.
:::

```csharp
using System.Threading;

using var cts = new CancellationTokenSource();
var token = cts.Token;

for (int page = 1; page <= 5; page++)
{
    if (page == 3) cts.Cancel();                    // e.g. the user closed the browser
    try
    {
        token.ThrowIfCancellationRequested();       // long loops check the flag themselves
        Console.WriteLine($"exported page {page}");
    }
    catch (OperationCanceledException)
    {
        Console.WriteLine($"stopped at page {page}: cancelled (normal, not an error)");
        break;
    }
}
```

Combine the request's token with your own timeout:

```csharp norun
using var cts = CancellationTokenSource.CreateLinkedTokenSource(requestToken);
cts.CancelAfter(TimeSpan.FromSeconds(5));
try { return await payments.ChargeAsync(total, cts.Token); }
catch (OperationCanceledException) when (!requestToken.IsCancellationRequested)
{
    return Results.StatusCode(504);     // OUR timeout fired (not the user leaving)
}
```

Cancellation shows up as `OperationCanceledException`. That's **normal flow**, so don't log it as an error. Dispose the `CancellationTokenSource` objects you create, because they can hold timers.

:::qa How does cancellation work in .NET?
It's cooperative. A `CancellationTokenSource` signals, and code that receives the `CancellationToken` observes it, either passing it to async APIs or calling `ThrowIfCancellationRequested`, and stops by throwing `OperationCanceledException`. ASP.NET Core provides `RequestAborted`, which fires when the client disconnects. Linked sources and `CancelAfter` add timeouts.
:::

## Async streams: results that arrive over time {i}

:::plain
Sometimes results arrive in batches over time, like pages from an API. An async stream lets you handle each item as it arrives, instead of waiting for all of them.
:::

If data arrives in pieces (pages from an API, rows from a database), you don't have to wait for all of it. `IAsyncEnumerable<T>` is the async version of the `yield return` from [Episode 6](ch:linq#how-the-laziness-works-yield-return):

```csharp norun
public async IAsyncEnumerable<Product> GetAllAsync([EnumeratorCancellation] CancellationToken ct = default)
{
    string? next = "/products?page=1";
    while (next is not null)
    {
        var page = await http.GetFromJsonAsync<Page<Product>>(next, ct);
        foreach (var p in page!.Items) yield return p;     // hand each one over as it arrives
        next = page.NextLink;
    }
}

await foreach (var p in GetAllAsync(ct)) { /* handle each product as it arrives */ }
```

ASP.NET Core streams an `IAsyncEnumerable` response as a JSON array without buffering it all in memory.

## Under the hood: the state machine {a}

:::plain
The compiler turns your async method into a small object that remembers where it paused and what its local variables were. Each `await` is a numbered bookmark, so the method can be resumed later from that exact spot, on any thread.
:::

The compiler rewrites every `async` method into a **state machine** (a struct). Its fields hold your **local variables**, a **state number** ("which await am I paused at?") and a **builder** that creates and completes the Task. You can see it with reflection:

```csharp
using System.Reflection;
using System.Runtime.CompilerServices;

var machine = typeof(Shop).GetMethod(nameof(Shop.CheckoutAsync))!
    .GetCustomAttribute<AsyncStateMachineAttribute>()!.StateMachineType;

Console.WriteLine($"{machine.Name} is a {(machine.IsValueType ? "struct" : "class")} with fields:");
foreach (var f in machine.GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic))
    Console.WriteLine($"  {f.FieldType.Name,-24} {f.Name}");

static class Shop
{
    public static async Task<string> CheckoutAsync(Task<decimal> payment)
    {
        var orderId = 42;                 // used after the await → becomes a FIELD
        var charged = await payment;
        return $"{orderId}: {charged}";
    }
}
```

You'll see `<>1__state` (where it's paused), `<>t__builder` (makes the Task), your parameter, `<orderId>5__2` (your local, now a field) and an awaiter. Simplified, the generated `MoveNext` looks like this:

```csharp norun
public void MoveNext()
{
    if (state != 0)
    {
        awaiter = payment.GetAwaiter();
        if (!awaiter.IsCompleted)
        {
            state = 0;                                              // "resume at await #0"
            builder.AwaitUnsafeOnCompleted(ref awaiter, ref this);  // call MoveNext again when done
            return;                                                 // ← the method "returns" here
        }
    }
    var charged = awaiter.GetResult();                              // resume: get the result, or rethrow
    builder.SetResult($"{orderId}: {charged}");                     // complete the Task
}
```

What follows from it:

- If every awaited task is **already finished**, the method runs straight through, synchronously and cheaply.
- The first real pause **copies the state machine to the heap**. That's why locals in async methods live on the heap, and why a `Span<T>` can't cross an `await` ([Episode 10](ch:advanced-csharp)).
- `await` works on anything with a `GetAwaiter()` method, not only `Task`.

:::qa What does the compiler generate for an async method?
A state-machine struct implementing `IAsyncStateMachine`. Locals and parameters become fields, each `await` becomes a numbered state, and `MoveNext()` runs code up to the next incomplete await, registers itself as the continuation and returns. An `AsyncTaskMethodBuilder` creates and completes the returned Task. The struct is boxed to the heap the first time it actually suspends.
:::

## Where does the code resume? SynchronizationContext and ConfigureAwait {a}

:::plain
In a desktop or mobile app, only one special thread may update the screen. So after an `await`, the rest of your method is sent back to that thread. ASP.NET Core has no such rule, so any free thread carries on.
:::

When an `await` resumes, *which thread* runs the rest? It depends on whether a **SynchronizationContext** was captured:

:::scene visuals/scenes/async-context.svg | Who runs the rest of the method?
1. A UI app (WPF, WinForms, MAUI) has one special **UI thread**, and only it may touch buttons and labels. It works through a mailbox of jobs.
2. So by default, `await` posts "the rest of the method" into that thread's mailbox. The rule that does this is the **SynchronizationContext**.
3. ASP.NET Core has no such context. Whichever pool thread is free runs the rest of the method.
4. `ConfigureAwait(false)` means "skip the mailbox, any thread will do". Libraries should use it, because they might be called from a UI app. In ASP.NET Core app code it changes nothing. It also prevents the deadlock in the next section.
:::

| App type | Context | The continuation runs on |
|---|---|---|
| WPF, WinForms, MAUI | UI context | **the UI thread** (so you can touch controls) |
| Old ASP.NET (.NET Framework) | per-request context | one thread at a time per request |
| **ASP.NET Core**, console apps, workers | **none** | any pool thread |

**`ConfigureAwait(false)`** means "don't go back to the captured context; resume anywhere".

- In **ASP.NET Core app code** it changes nothing (there's no context), so you can leave it out.
- In **libraries** that might be used from UI or old ASP.NET apps, put it on every `await`. It prevents deadlocks for callers who block, and avoids needless trips to the UI thread.

`ExecutionContext` is separate. It carries `AsyncLocal<T>` values (logging scopes, the current trace `Activity`, culture) and **always** flows across awaits.

:::qa What is ConfigureAwait(false) and do you need it in ASP.NET Core?
It tells `await` not to resume on the captured SynchronizationContext. ASP.NET Core has no SynchronizationContext, so in application code it makes no difference. Library code that might run under a UI or classic ASP.NET context should use it, to avoid deadlocks and unnecessary context switches.
:::

## Deadlocks and thread-pool starvation {a}

:::plain
Blocking on an unfinished task with `.Result` or `.Wait()` is always bad news. In UI apps it can freeze forever. In ASP.NET Core it ties up a thread for nothing, and under load you run out of threads.
:::

Blocking on async code (`.Result`, `.Wait()`) fails in two different ways, depending on the app:

:::scene visuals/scenes/async-deadlock.svg | What `.Result` does to an unfinished Task
1. In a **UI app**, the UI thread calls `GetDataAsync().Result` and **blocks**, waiting for the Task.
2. The HTTP call finishes. The rest of `GetDataAsync` (after its `await`) must run on the **UI thread**, because that's the captured context.
3. But the UI thread is blocked, waiting for that very Task. Each waits for the other: **deadlock**, forever.
4. **ASP.NET Core** has no context, so there's no deadlock. But each `.Result` holds a pool thread hostage, and the pool adds threads only about one per second. Under load: **thread-pool starvation**. Latency soars while CPU stays low, which is the Black Friday incident.
:::

How to diagnose starvation:

- **Symptoms:** latency climbs to seconds, **CPU stays low**, and the thread count creeps up. Health checks fail.
- **Tools:** `dotnet-counters monitor` shows a growing *ThreadPool Queue Length*. A `dotnet-dump` shows many threads stuck in `Task.Wait` or `GetResult`.
- **Fix:** remove the sync-over-async. Raising `ThreadPool.SetMinThreads` only buys time.

:::qa What is thread-pool starvation and how do you diagnose it?
Pool threads are all blocked (usually by sync-over-async or other blocking calls), so queued work waits while the pool slowly injects new threads. Symptoms are high latency with low CPU and a rising thread count. Diagnose with `dotnet-counters` (thread pool queue length and thread count) and `dotnet-dump` or `dotnet-stack` (threads blocked in `Wait`/`Result`). Fix by making the call chain async end to end.
:::

## ValueTask: skipping the allocation on the fast path {a}

:::plain
Returning a `Task` always creates a small object, even when the answer is ready instantly. `ValueTask` can carry an instant answer with no object at all, which matters only in very hot code.
:::

`Task<T>` is a class, so each call allocates one. **`ValueTask<T>`** is a struct that can hold the result directly when it's already known, so it allocates nothing:

:::scene visuals/scenes/async-valuetask.svg | Task vs ValueTask on a cache hit
1. The price is already in the cache. Returning `Task<decimal>` still has to **create a Task object** on the heap to carry £6.50, on every call.
2. `ValueTask<decimal>` is a **struct**. When the answer is already known, it carries it directly, with no allocation.
3. When the price isn't cached, the `ValueTask` wraps a real `Task`, so nothing is lost. The rules: await it **exactly once**, never from two places (call `.AsTask()` if you need that), and use it only in hot methods that usually finish instantly.
:::

```csharp
var catalogue = new ProductCatalogue();
var first = catalogue.GetPriceAsync("TEA-01");      // cache hit: finished immediately, no Task allocated
Console.WriteLine($"cache hit completed synchronously: {first.IsCompletedSuccessfully}, £{first.Result}");

class ProductCatalogue
{
    private readonly Dictionary<string, decimal> _cache = new() { ["TEA-01"] = 6.50m };

    public ValueTask<decimal> GetPriceAsync(string sku) =>
        _cache.TryGetValue(sku, out var price)
            ? ValueTask.FromResult(price)                  // hot path: no allocation
            : new ValueTask<decimal>(LoadPriceAsync(sku)); // cold path: wraps a real Task

    private static async Task<decimal> LoadPriceAsync(string sku) { await Task.Yield(); return 9.99m; }
}
```

Use it only for **hot methods that usually finish immediately** (cache hits, buffered reads). Await it **exactly once**, never concurrently. If you need to store it or await it twice, call `.AsTask()`. Use `Task` everywhere else.

:::qa When would you use ValueTask instead of Task?
For hot-path methods that usually complete synchronously, such as cache hits or buffered I/O, to avoid allocating a Task. A ValueTask must be awaited only once and never concurrently. Convert it with `.AsTask()` if you need to. Default to Task.
:::

## Fire-and-forget: don't, inside a request {i}

:::plain
Starting a task and not waiting for it seems harmless. But its errors vanish, it can be killed halfway through, and it may use objects that are thrown away when the request ends.
:::

```csharp norun
app.MapPost("/signup", async (User u, IEmailSender email) =>
{
    await SaveAsync(u);
    _ = email.SendWelcomeAsync(u);      // ✗ "fire and forget"
    return Results.Ok();
});
```

Three things go wrong. Its exceptions are never seen. It's killed if the app shuts down. And any per-request service it uses (like `DbContext`) is **disposed** when the request ends, possibly while it's still running. Put the work on a **background queue** (`Channel<T>` plus a hosted service) or a durable message queue ([Background work](ch:background-work)).

:::qa What's the risk of fire-and-forget tasks in a web request?
Unobserved exceptions, work lost on shutdown or recycle, and use of scoped services (DbContext, HttpContext) after the request scope disposed them. Hand the work to a background queue (a `Channel<T>` with a hosted service) or a durable message broker instead.
:::

## Locks and await {i}

You can't `await` inside a `lock` block. The compiler forbids it, and the reason is about *who holds the key*:

:::scene visuals/scenes/async-lock.svg | Why `await` can't go inside `lock`
1. Thread 7 enters `lock (_gate)`. A lock belongs to the **thread** that took it, so thread 7 holds the key.
2. Inside, the code awaits. Thread 7 is handed back to the pool and goes off to serve someone else.
3. When the work finishes, *thread 3* picks up the rest of the method and reaches the end of the `lock`, where the key must be returned. But thread 3 never took the key, so it can't release it. That's why the compiler refuses.
4. `SemaphoreSlim` counts permits instead of remembering a thread, so any thread may release it, and it has an async `WaitAsync`.
:::

```csharp norun
private readonly SemaphoreSlim _gate = new(1, 1);

public async Task RefreshTokenAsync(CancellationToken ct)
{
    await _gate.WaitAsync(ct);
    try { if (TokenExpired) _token = await FetchTokenAsync(ct); }
    finally { _gate.Release(); }
}
```

More in [Threading & concurrency](ch:threading-concurrency).

## Next episode {b}

Kettle survived Black Friday. With async all the way down, a few dozen threads handled the whole rush. Then at **3 a.m.** the pager goes off: `NullReferenceException` in the shipping-label code. A customer with no delivery address got through, and `customer.Address.Postcode` blew up. Nothing warned anyone that `Address` could be null. While you're in there, you notice that every simple data class is 40 lines of boilerplate. Modern C# fixes both: [Episode 9 · Modern C# →](ch:modern-csharp)

## Further reading

- [Asynchronous programming with async and await](https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/)
- [Task-based asynchronous pattern](https://learn.microsoft.com/en-us/dotnet/standard/asynchronous-programming-patterns/task-based-asynchronous-pattern-tap)
- Stephen Toub, [ConfigureAwait FAQ](https://devblogs.microsoft.com/dotnet/configureawait-faq/) and [How async/await really works](https://devblogs.microsoft.com/dotnet/how-async-await-really-works/)
- David Fowler, [Async guidance](https://github.com/davidfowl/AspNetCoreDiagnosticScenarios/blob/master/AsyncGuidance.md), a list of real-world mistakes.

## Verify this chapter

The browser runner is single-threaded, so this proves the mechanics with hand-completed tasks.

```csharp
using System.Threading;

// await returns to the caller when the task isn't finished, then resumes later
var log = new List<string>();
var gate = new TaskCompletionSource<int>();
var work = Steps(gate.Task, log);
log.Add("caller continues");
gate.SetResult(1);
Check(string.Join(",", log) == "before await,caller continues,after await", "await returns to the caller, then resumes");
Check(work.IsCompletedSuccessfully, "the Task completes when the method returns");

// an already-finished task means no pause at all
var sync = Steps(Task.FromResult(1), new List<string>());
Check(sync.IsCompleted, "awaiting a completed task runs straight through, synchronously");

// exceptions are stored in the Task
var bad = new TaskCompletionSource<int>();
var faulted = Steps(bad.Task, new List<string>());
bad.SetException(new TimeoutException());
Check(faulted.IsFaulted && faulted.Exception!.InnerException is TimeoutException, "an exception is stored in the Task");

// cancellation is cooperative
using var cts = new CancellationTokenSource();
cts.Cancel();
Check(Throws<OperationCanceledException>(() => cts.Token.ThrowIfCancellationRequested()), "a cancelled token throws when checked");

// ValueTask: the fast path finishes synchronously
Check(ValueTask.FromResult(3).IsCompletedSuccessfully, "ValueTask.FromResult is already complete");

static async Task Steps(Task<int> t, List<string> log) { log.Add("before await"); await t; log.Add("after await"); }
static bool Throws<T>(Action a) where T : Exception { try { a(); return false; } catch (T) { return true; } }
static void Check(bool ok, string claim) =>
    Console.WriteLine(ok ? $"OK: {claim}" : throw new Exception($"FAIL: {claim}"));
```
