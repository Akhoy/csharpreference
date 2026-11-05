---
id: async-await
title: "Async and Await: The Core Execution Model"
summary: "Most backend time is spent waiting on something outside the CPU: a database, another API, a disk. async/await lets a thread serve someone else while that wait is happening, instead of sitting idle. Covers I/O vs CPU work, the Task type, what await actually does, and the five rules for writing it correctly."
layer: language
where: C# language › Asynchrony › The core model
fits: Layer 1 syntax over layer 2 machinery (the thread pool). It's the single most important C# feature for backend work. Every ASP.NET Core endpoint, EF Core query and HttpClient call in layers 3–6 is async, and many production incidents (thread-pool starvation, deadlocks) come from misusing it. First of five chapters on async/await.
levels: b,i,a
prereqs: delegates-events, exceptions-disposal
next: async-concurrency
---

## Core Model

- Most backend time is spent **waiting**: for the database, another API, the disk. Synchronous code **holds a thread** the whole time it waits. Under load you run out of threads while the CPU sits idle. That's **thread-pool starvation**.
- **`await`** splits a method in two. If the work isn't done, the method **returns an unfinished `Task` and frees the thread**. When the work finishes, a pool thread runs the rest.
- A **`Task`** is a promise of a result later. **A Task is not a thread.** While a network call is pending, no thread is waiting for it at all.
- Async is about **scalability** (more requests with fewer threads), not making one request faster.
- The rules: **async all the way**, **never `.Result` or `.Wait()`**, **no `async void`**, **pass a `CancellationToken`**, and run independent calls together with **`Task.WhenAll`**.

## Terminology

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

:::note What you need first
- **[Delegates: Passing Behaviour Around (Lambdas, Closures, Events)](ch:delegates-events)**: a delegate is a variable that holds a method, and a lambda (`x => x * 2`) is the short way to write one.
- **[Exceptions and Cleanup: Failing Safely (try/catch, using, IDisposable)](ch:exceptions-disposal)**: exceptions jump to the nearest matching `catch`; `using` guarantees `Dispose` runs to release files and connections.
:::

## Why This Matters: Thread-Pool Starvation {b}

A checkout endpoint that reads from SQL and calls a payment API looks harmless written synchronously:

```csharp norun
public IActionResult Pay(int orderId)
{
    var order = db.Orders.Find(orderId);                 // waits ~20 ms for SQL
    var result = payments.Charge(order.Total);           // waits ~800 ms for the payment API (slow today)
    return Ok(result);
}
```

A web server handles requests on threads from a shared **thread pool**. This code takes a thread and then *sits on it* for 820 ms doing nothing but waiting. At 500 checkouts a second you'd need hundreds of threads all waiting. The pool adds threads only slowly, so new requests **queue up for a free thread** while the existing ones stare at the network.

Do the sums. One checkout holds a thread for 0.82 seconds. At 500 checkouts a second, that's 500 × 0.82 ≈ **410 threads** waiting at any moment, just for checkout. Each thread reserves about 1 MB of stack, and the pool only adds roughly one new thread per second when it's under pressure. So the queue grows faster than the pool can grow, and every page on the site, not just checkout, waits in that queue.

:::why Why not just add more threads?
Because the problem isn't a shortage of threads. It's that the threads are **doing nothing**. A thread is expensive (memory for its stack, and the OS has to switch between them). Thousands of threads that mostly sleep is a very costly way to wait for a network reply. What you really want is a way to say "I'm waiting, here's my thread back, call me when the reply arrives". That's what `await` is.
:::

## How Await Frees the Thread {b}

During those 800 ms the thread isn't *doing* anything. The network card is waiting for bytes. So why hold a thread at all?

**`await`** is how you say: *"start this, and if it isn't finished, give my thread back. Wake me when the answer arrives."* The thing you await is a **`Task`**, an object that stands for "a result that will arrive later". When the answer arrives, any free pool thread picks up where you left off. A handful of threads can then keep thousands of requests in flight.

:::scene visuals/scenes/async-threads.svg | Two threads, four checkouts
1. **Synchronous:** each thread takes a request, calls the payment API, then just **sits there** until it replies.
2. Both threads are busy doing nothing. Requests C and D queue up with no free thread. CPU is at 5%: this is **thread-pool starvation**, the checkout endpoint from above under load.
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

## The Await Execution Model {b}

Here's the exact sequence, in a program you can run. The "payment API" is a `TaskCompletionSource`, a Task that we finish by hand, so you can watch every step:

:::walk Watch `await` hand the thread back
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
@1 | paymentApi = not replied
A `TaskCompletionSource` is a task we finish by hand. It stands in for the payment API, so you decide when it "replies".
@3
Call `CheckoutAsync`. It starts running straight away, on this thread, like any method.
@14-15 | orderId = 42 | > 1. checkout starts and calls the payment API
The first part runs normally.
@16 | orderId = 42 (saved) ; paymentCall = not finished
`await` checks the task. It's **not finished**, so `await` saves the local variables, notes "resume at this line", and **returns** an unfinished task to the caller. The method is paused, but no thread is waiting inside it.
@4 | checkout = Task (not finished) | > 2. back in the caller: checkout finished? False  ← thread is free
We're back in the caller **before checkout has finished**. That's the whole trick: the thread is free.
@5 | | >    (the thread could serve other requests here)
On a real server, this is where the thread goes back to the pool and serves other shoppers.
@7 | paymentApi = replied 18.50
The payment API replies. Finishing the task triggers the **continuation**: the rest of `CheckoutAsync`.
@17 | orderId = 42 (restored) ; charged = 18.50 | > 4. resumed after await (order 42 remembered)
The method resumes at the exact line where it paused, with `orderId` still 42. (On a server it could be a different thread by now. It doesn't matter.)
@18 | checkout = Task (finished: "order 42: charged £18.50")
`return` completes the task.
@8 | | > 5. order 42: charged £18.50
The task is already finished, so reading `.Result` here doesn't block anything. The output order was 1, 2, 4, 5: the method left in the middle and came back later.
:::

Read the output order: **1, 2, 4, 5**. At the `await`, the method **returned** to its caller (step 2) before it finished. When the result arrived, it **resumed exactly where it stopped**, with `orderId` still set.

:::scene visuals/scenes/async-await-split.svg | `await` splits your method in two
1. Thread 7 runs the first part of the method like any normal code.
2. `ChargeAsync` starts the HTTP call and returns an **unfinished Task**. `await` sees "not done yet", saves the local variables, notes "resume here", and **returns an unfinished Task to the caller**.
3. Thread 7 goes back to the pool to serve other requests. During the wait, **no thread is waiting**. The network card is, and the OS tells .NET when bytes arrive.
4. The reply arrives. A free pool thread (maybe thread 3, not 7) restores the locals and runs the second part. This second part is called the **continuation**.
5. The compiler generated all of this for you: a **state machine** with a "where was I" number and your locals stored as fields. `return "paid"` completes the Task, which wakes up whoever awaited it. ([Full mechanism in the next chapter →](ch:async-internals))
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

## The Task Type and Its End States {b}

A **`Task`** is like a collection ticket at a dry cleaner's. It's proof the work is underway, and it's how you pick up the result (`Task<T>`) or find out it failed. It has three end states:

| End state | Means | `await` does |
|---|---|---|
| **RanToCompletion** | it worked | gives you the result |
| **Faulted** | it threw | rethrows the exception ([exceptions in async code](ch:exceptions-disposal#exceptions-in-async-code)) |
| **Canceled** | it was cancelled | throws `OperationCanceledException` |

:::walk A Task's three endings
```csharp
var ok = Task.FromResult(5);                       // an already-finished Task
Console.WriteLine($"{ok.Status}: {ok.Result}");

var tcs = new TaskCompletionSource<int>();
var failing = AddOne(tcs.Task);
tcs.SetException(new TimeoutException("payment API timed out"));
Console.WriteLine($"{failing.Status}: {failing.Exception!.InnerException!.Message}");   // stored, not thrown

static async Task<int> AddOne(Task<int> t) => await t + 1;
```
@1 | ok = Task (RanToCompletion, 5)
`Task.FromResult` makes a task that is already finished, with a result.
@2 | | > RanToCompletion: 5
@4-5 | tcs = not finished ; failing = Task (waiting)
`AddOne` awaits a task that hasn't finished, so it's paused.
@6 | failing = Task (Faulted, holding TimeoutException)
The task fails. `AddOne` resumes, the `await` rethrows the exception, and because `AddOne` is `async`, the exception is **stored in its task** instead of flying out.
@7 | | > Faulted: payment API timed out
Nothing crashed. The failure is sitting in the task, for whoever awaits it.
:::

Useful members: `Task.FromResult(x)` and `Task.CompletedTask` (ready-made finished tasks), `Task.Delay(ms, ct)` (wait without a thread; **never `Thread.Sleep`** in async code), and `Task.WhenAll` / `WhenAny` ([covered next](ch:async-concurrency)).

## I/O-Bound vs CPU-Bound {b}

| | I/O-bound | CPU-bound |
|---|---|---|
| Time spent | waiting for something outside | calculating |
| Example | SQL, payment API, sending email | resizing product photos, hashing |
| Tool | `await` the `*Async` APIs | needs a thread anyway: just run it (or a background worker) |

:::gotcha `Task.Run` in a web request doesn't help
`await Task.Run(() => DoWork())` inside an endpoint frees one pool thread and immediately takes another, plus some overhead. It helps in **UI apps** (to keep the UI thread responsive), not in ASP.NET Core.
:::

## Five Rules for Correct Async Code {b}

**1. Async all the way.** Once a method awaits, its callers should be async too, all the way up to the endpoint, which ASP.NET Core awaits for you.

**2. Never block on a Task.** No `.Result`, `.Wait()` or `.GetAwaiter().GetResult()` on unfinished work. It brings back the exact problem async solves, and in some apps it **deadlocks** ([covered in detail](ch:async-pitfalls)).

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

## Interviewer "why" deep-dives {a}

### "If I just return a Task instead of using async/await, what do I lose?"

Nothing changes in behaviour for the simple pass-through case, and you save the state-machine overhead:

```csharp norun
public Task<Order?> GetAsync(int id) => repo.GetAsync(id);   // no async/await keywords
```

Roslyn only generates a state machine for methods marked `async`. Skip the keyword, and the method just returns the inner `Task<Order?>` directly, no wrapping object, no `MoveNext`. The danger shows up the moment the method does anything *around* the call: a `using`, a `try/catch`, or a second statement. Wrap a disposable resource and elide `async`, and the resource is disposed as soon as the method returns the task, not when the awaited work actually finishes.

```csharp norun
public Task<string> Broken()
{
    using var client = new HttpClient();
    return client.GetStringAsync(url);     // ✗ client is disposed before the call completes
}
```

### "If the thread is freed during the wait, what wakes the method up?"

Nothing inside .NET is polling. For I/O, the operating system itself holds the pending operation (a socket read, a disk read) and raises a completion event when it's done; that event is what the runtime turns into "run this continuation on a pool thread". No thread is spinning or sleeping on your behalf in between. That's why a server with ten thousand `await`ed HTTP calls in flight doesn't need ten thousand threads, or even ten: it needs zero threads for the waiting part, and only as many as it takes to run continuations as they complete, one at a time.

## Summary {b}

`async`/`await` doesn't make one request faster. It lets a thread serve someone else while the current request is waiting on I/O, which is what lets a small thread pool carry a large number of concurrent requests. `await` splits a method at each await point: if the awaited `Task` isn't finished, the thread is freed immediately and the rest of the method runs later, on whichever thread is free, as a continuation.

Next: [Running async work concurrently](ch:async-concurrency) covers starting several independent calls together with `Task.WhenAll`, cancellation, and async streams — the tools you reach for once a single `await` isn't enough.

## Further reading

- [Asynchronous programming with async and await](https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/)
- [Task-based asynchronous pattern](https://learn.microsoft.com/en-us/dotnet/standard/asynchronous-programming-patterns/task-based-asynchronous-pattern-tap)
- Stephen Toub, [ConfigureAwait FAQ](https://devblogs.microsoft.com/dotnet/configureawait-faq/) and [How async/await really works](https://devblogs.microsoft.com/dotnet/how-async-await-really-works/)
- David Fowler, [Async guidance](https://github.com/davidfowl/AspNetCoreDiagnosticScenarios/blob/master/AsyncGuidance.md), a list of real-world mistakes.

## Verify this chapter

The browser runner is single-threaded, so this proves the mechanics with hand-completed tasks.

```csharp
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

static async Task Steps(Task<int> t, List<string> log) { log.Add("before await"); await t; log.Add("after await"); }
static void Check(bool ok, string claim) =>
    Console.WriteLine(ok ? $"OK: {claim}" : throw new Exception($"FAIL: {claim}"));
```
