---
id: async-concurrency
title: "Running Async Work Concurrently"
summary: "A single await is enough when there's one thing to wait for. Once there are several independent calls, a stop-and-ask-permission signal, or results that arrive in batches, you need Task.WhenAll, CancellationToken, and IAsyncEnumerable. Second of five chapters on async/await."
layer: language
where: C# language › Asynchrony › Concurrency and streams
fits: Builds directly on [the core execution model](ch:async-await). Fan-out calls, cancellation and async streams are what turn a single correct `await` into a backend that uses the network efficiently under real load.
levels: i
prereqs: async-await
next: async-internals
---

## Running Independent Calls Concurrently {i}

:::plain
If two slow calls don't depend on each other, start both before waiting for either. Then you wait for the slower one only, instead of both added together.
:::

The order page needs the customer and their recent orders, from two different services. Awaiting them one after the other takes the **sum** of the times. Starting both, *then* awaiting, takes only the **longest**:

:::scene visuals/scenes/async-whenall.svg | One after the other, or both at once?
1. `await customer`, *then* `await history`: the second call doesn't even start until the first finishes. That's 100 ms + 200 ms = **300 ms**, even though neither call needs the other's result.
2. Instead, start both calls *without* awaiting yet. Both requests are now in flight at the same moment.
3. Then `await Task.WhenAll(customerTask, historyTask)`. It finishes when the slowest one does: **200 ms** in total.
:::

You can watch the difference with two fake service calls that only finish when the code says so. First, the obvious way:

:::walk One after the other: the second call waits for the first
```csharp
var customerApi = new TaskCompletionSource<string>();
var historyApi  = new TaskCompletionSource<string>();

Task<string> GetCustomer() { Console.WriteLine("  customer call starts"); return customerApi.Task; }
Task<string> GetHistory()  { Console.WriteLine("  history call starts");  return historyApi.Task; }

Task<string> page = OneAfterTheOther();
Console.WriteLine($"page done? {page.IsCompleted}");

customerApi.SetResult("Ada");
Console.WriteLine("customer replied");

historyApi.SetResult("3 orders");
Console.WriteLine($"history replied. page: {page.Result}");

async Task<string> OneAfterTheOther()
{
    var c = await GetCustomer();     // wait for the customer...
    var h = await GetHistory();      // ...and only THEN start the history call
    return $"{c}, {h}";
}
```
@1-2 | customerApi = not replied ; historyApi = not replied
Two fake services. Their tasks only finish when we call `SetResult`, so you control the timing.
@7 | customerApi = not replied ; historyApi = not replied
Build the page.
@18 | | >   customer call starts
Start the customer call and `await` it. It hasn't replied, so the method pauses here and returns an unfinished task.
@8 | page = Task (not finished) | > page done? False
Notice what *hasn't* happened: the history call hasn't started. Line 19 can't run until line 18 is finished.
@10 | customerApi = replied "Ada" ; historyApi = not replied
The customer service replies.
@19 | c = "Ada" | >   history call starts
The method resumes, and only **now** does the history call start. All the time the customer call took, the history service sat idle.
@11 | | > customer replied
@13-14 | page = "Ada, 3 orders" | > history replied. page: Ada, 3 orders
The history replies and the page is done. Total time: customer time **plus** history time.
:::

Now start both, then wait:

:::walk Both at once: start everything, then wait once
```csharp
var customerApi = new TaskCompletionSource<string>();
var historyApi  = new TaskCompletionSource<string>();

Task<string> GetCustomer() { Console.WriteLine("  customer call starts"); return customerApi.Task; }
Task<string> GetHistory()  { Console.WriteLine("  history call starts");  return historyApi.Task; }

Task<string> page = BothAtOnce();
Console.WriteLine($"page done? {page.IsCompleted}");

historyApi.SetResult("3 orders");
Console.WriteLine($"history replied. page done? {page.IsCompleted}");

customerApi.SetResult("Ada");
Console.WriteLine($"customer replied. page: {page.Result}");

async Task<string> BothAtOnce()
{
    var c = GetCustomer();           // start both calls...
    var h = GetHistory();
    await Task.WhenAll(c, h);        // ...then wait once, for the slower one
    return $"{await c}, {await h}";
}
```
@7 | customerApi = not replied ; historyApi = not replied
Build the page again, this time with `BothAtOnce`.
@18-19 | c = Task (customer, in flight) ; h = Task (history, in flight) | >   customer call starts | >   history call starts
Call both methods **without** `await`. Each call starts its request and hands back a task straight away. Both requests are now in flight together.
@20 | c = Task (in flight) ; h = Task (in flight)
`Task.WhenAll` makes one task that finishes when **both** have. Awaiting it pauses the method once.
@8 | page = Task (not finished) | > page done? False
@10-11 | h = "3 orders" ; c = Task (in flight) | > history replied. page done? False
The history replies first. `WhenAll` is still waiting for the customer, so the page isn't done.
@13 | c = "Ada" ; h = "3 orders"
The customer replies. Now both are finished, and the method resumes.
@21 | page = "Ada, 3 orders" | > customer replied. page: Ada, 3 orders
`await c` and `await h` are instant now, because both tasks are already finished. Total time: the **slower** of the two, not the sum.
:::

The same two shapes with real services:

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

## Cancellation and Timeouts {i}

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

:::walk A "please stop" flag, checked by the worker
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
@3-4 | cts = not cancelled ; token = not cancelled
The source can raise the flag. The token can only *read* it, so you hand the token to the code doing the work.
@6-12 | page = 1 | > exported page 1
Page 1: the flag isn't raised, so `ThrowIfCancellationRequested` does nothing.
@6-12 | page = 2 | > exported page 2
Page 2, same.
@8 | page = 3 ; cts = cancelled ; token = cancelled
Before page 3 the user closes the browser, and the flag goes up. Nothing is stopped by force. The loop is still running.
@11 | page = 3 ; token = cancelled
The worker **checks** the flag and throws `OperationCanceledException`. Stopping is the worker's own decision. That's what "cooperative" means.
@16-17 | page = 3 | > stopped at page 3: cancelled (normal, not an error)
Catch it, stop cleanly, and don't log it as an error. Pages 4 and 5 are never exported, so no work is wasted.
:::

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

## Async Streams: IAsyncEnumerable\<T\> {i}

:::plain
Sometimes results arrive in batches over time, like pages from an API. An async stream lets you handle each item as it arrives, instead of waiting for all of them.
:::

If data arrives in pieces (pages from an API, rows from a database), you don't have to wait for all of it. `IAsyncEnumerable<T>` is the async version of the [`yield return`](ch:linq#how-the-laziness-works-yield-return) you already know from LINQ:

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

Here's the same shape with two "pages" that arrive when we say so. Watch each product appear as soon as its page lands, instead of all at the end:

:::walk Results that arrive over time
```csharp
var pages = new[] { new TaskCompletionSource<string[]>(), new TaskCompletionSource<string[]>() };
Task done = ShowAsync(Products());
Console.WriteLine("waiting for page 1…");
pages[0].SetResult(["Sencha", "Assam"]);
Console.WriteLine("waiting for page 2…");
pages[1].SetResult(["Rooibos"]);
Console.WriteLine($"all done: {done.IsCompleted}");

async IAsyncEnumerable<string> Products()
{
    foreach (var page in pages)
        foreach (var p in await page.Task) yield return p;
}

async Task ShowAsync(IAsyncEnumerable<string> items)
{
    await foreach (var p in items) Console.WriteLine($"  showing {p}");
}
```
@1 | pages = [page 1: not arrived, page 2: not arrived]
Two fake API pages, finished by hand.
@2 | done = Task (running)
Start showing products. `await foreach` asks the stream for its first item.
@12 | page = page 1 (not arrived)
The stream `await`s page 1. It hasn't arrived, so both methods pause and control returns to the caller.
@3 | | > waiting for page 1…
Nothing is shown yet, and no thread is blocked.
@4 | pages = [page 1: Sencha, Assam / page 2: not arrived]
Page 1 arrives. The stream resumes.
@12 | p = Sencha
`yield return` hands Sencha to the `await foreach`…
@17 | | >   showing Sencha
…which shows it right away…
@12-17 | p = Assam | >   showing Assam
…then Assam. Then the stream awaits page 2 and pauses again.
@5 | | > waiting for page 2…
@6 | pages = [page 1 ✓ / page 2: Rooibos]
Page 2 arrives.
@12-17 | p = Rooibos | >   showing Rooibos
@7 | done = Task (finished) | > all done: True
No more pages, so the stream ends and so does the loop. The user saw the first products while the second page was still on its way.
:::

## Interviewer "why" deep-dives {a}

### "Why does `await` inside a loop sometimes make things slower, not faster?"

Because `await` only overlaps work when you give it work to overlap. Writing `await` inside a `foreach` still runs one call, waits for it, then starts the next:

```csharp norun
foreach (var id in ids) results.Add(await FetchAsync(id));   // one at a time, however many ids
```

The thread isn't blocked during each wait, so this doesn't starve the pool, but the *total time* is still the sum of every call, because each one waits for the last to finish before starting. The fix is the same one from [running independent calls concurrently](#running-independent-calls-concurrently): start every call first, collect the tasks, then await them together with `Task.WhenAll` or bound the concurrency with `Parallel.ForEachAsync`. `await` frees threads; it doesn't parallelise anything by itself.

### "If `Task.WhenAll` throws, what happened to the tasks that didn't fail?"

`WhenAll` waits for every task to finish, successful or not, before it throws. So by the time the exception reaches your `catch`, all of them (failed and succeeded) are already complete — nothing is left running in the background. What `WhenAll` throws is only the **first** exception, wrapped as a single `Exception`; if more than one task failed, the rest are still sitting on `task.Exception` for each task individually. Checking only the exception `WhenAll` throws can hide a second, unrelated failure that happened in parallel.

## Summary {i}

A single `await` only ever waits for one thing. `Task.WhenAll` turns several independent calls into one wait for the slowest of them. `CancellationToken` is a cooperative "please stop" flag threaded through every call, not a forced kill. `IAsyncEnumerable<T>` lets a caller start processing results as they arrive instead of buffering all of them first.

Next: [The compiler-generated async state machine](ch:async-internals) looks at what the compiler actually builds to make all of this possible — the mechanism behind every `await` in this chapter.

## Verify this chapter

```csharp
// Task.WhenAll finishes when every task has, not the sum of their individual waits
var a = new TaskCompletionSource<int>();
var b = new TaskCompletionSource<int>();
var all = Task.WhenAll(a.Task, b.Task);
Check(!all.IsCompleted, "WhenAll isn't done until every task is");
a.SetResult(1);
Check(!all.IsCompleted, "still waiting on b");
b.SetResult(2);
Check(all.IsCompletedSuccessfully, "WhenAll completes once the last task does");

// cancellation is cooperative: nothing stops until the code checks the token
using var cts = new CancellationTokenSource();
cts.Cancel();
Check(Throws<OperationCanceledException>(() => cts.Token.ThrowIfCancellationRequested()), "a cancelled token throws when checked, not before");

static bool Throws<T>(Action act) where T : Exception { try { act(); return false; } catch (T) { return true; } }
static void Check(bool ok, string claim) =>
    Console.WriteLine(ok ? $"OK: {claim}" : throw new Exception($"FAIL: {claim}"));
```
