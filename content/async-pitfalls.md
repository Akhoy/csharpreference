---
id: async-pitfalls
title: "Diagnosing Async Failures: Deadlocks, Starvation and Misuse"
summary: "Blocking on a Task, forgetting one, or trying to await inside a lock each fail in a different, specific way. Knowing the exact mechanism behind each failure is what makes it diagnosable in production instead of mysterious. Fifth of five chapters on async/await."
layer: language
where: C# language › Asynchrony › Diagnosing failures
fits: Closes the loop on [the core model](ch:async-await): most production incidents attributed to "async/await" are really one of the specific misuses covered here.
levels: i,a
prereqs: async-valuetask
next: threading-concurrency, aspnet-hosting, efcore-querying, modern-csharp
---

## Deadlocks and Thread-Pool Starvation {a}

:::plain
Blocking on an unfinished task with `.Result` or `.Wait()` is always bad news. In UI apps it can freeze forever. In ASP.NET Core it ties up a thread for nothing, and under load you run out of threads.
:::

Blocking on async code (`.Result`, `.Wait()`) fails in two different ways, depending on the app:

:::scene visuals/scenes/async-deadlock.svg | What `.Result` does to an unfinished Task
1. In a **UI app**, the UI thread calls `GetDataAsync().Result` and **blocks**, waiting for the Task.
2. The HTTP call finishes. The rest of `GetDataAsync` (after its `await`) must run on the **UI thread**, because that's the captured context.
3. But the UI thread is blocked, waiting for that very Task. Each waits for the other: **deadlock**, forever.
4. **ASP.NET Core** has no context, so there's no deadlock. But each `.Result` holds a pool thread hostage, and the pool adds threads only about one per second. Under load: **thread-pool starvation**, the same failure mode as [the checkout endpoint](ch:async-await#why-this-matters-thread-pool-starvation) that opened this chapter cluster.
:::

How to diagnose starvation:

- **Symptoms:** latency climbs to seconds, **CPU stays low**, and the thread count creeps up. Health checks fail.
- **Tools:** `dotnet-counters monitor` shows a growing *ThreadPool Queue Length*. A `dotnet-dump` shows many threads stuck in `Task.Wait` or `GetResult`.
- **Fix:** remove the sync-over-async. Raising `ThreadPool.SetMinThreads` only buys time.

:::qa What is thread-pool starvation and how do you diagnose it?
Pool threads are all blocked (usually by sync-over-async or other blocking calls), so queued work waits while the pool slowly injects new threads. Symptoms are high latency with low CPU and a rising thread count. Diagnose with `dotnet-counters` (thread pool queue length and thread count) and `dotnet-dump` or `dotnet-stack` (threads blocked in `Wait`/`Result`). Fix by making the call chain async end to end.
:::

## Fire-and-Forget Tasks in a Web Request {i}

:::plain
Starting a task and not waiting for it seems harmless. But its errors vanish, it can be killed halfway through, and it may use objects that are thrown away when the request ends.
:::

:::walk Three ways a forgotten task goes wrong
```csharp norun
app.MapPost("/signup", async (User u, IEmailSender email) =>
{
    await SaveAsync(u);
    _ = email.SendWelcomeAsync(u);      // ✗ "fire and forget"
    return Results.Ok();
});
```
@3 | request = in progress
Save the user and wait for it. Good.
@4 | request = in progress ; email task = running, nobody holding it
Start the welcome email and **throw the task away**. `_ =` says "I don't care about the result", so nobody will ever await it.
@5 | request = finished (200 OK) ; email task = still running
The response goes out. ASP.NET Core now ends the request and **disposes its scoped services**, including any `DbContext` the email code is using.
@4 | email task = Faulted (ObjectDisposedException), and nobody looks
If the email code touches the disposed `DbContext`, it fails. The exception is stored in a task nobody holds, so no log line is written. Or the app restarts for a deploy, and the email is silently lost. Hand it to a background queue instead.
:::

Three things go wrong. Its exceptions are never seen. It's killed if the app shuts down. And any per-request service it uses (like `DbContext`) is **disposed** when the request ends, possibly while it's still running. Put the work on a **background queue** (`Channel<T>` plus a hosted service) or a durable message queue ([Background work](ch:background-work)).

:::qa What's the risk of fire-and-forget tasks in a web request?
Unobserved exceptions, work lost on shutdown or recycle, and use of scoped services (DbContext, HttpContext) after the request scope disposed them. Hand the work to a background queue (a `Channel<T>` with a hosted service) or a durable message broker instead.
:::

## Why Await Cannot Appear Inside a Lock {i}

You can't `await` inside a `lock` block. The compiler forbids it, and the reason is about *who holds the key*:

:::scene visuals/scenes/async-lock.svg | Why `await` can't go inside `lock`
1. Thread 7 enters `lock (_gate)`. A lock belongs to the **thread** that took it, so thread 7 holds the key.
2. Inside, the code awaits. Thread 7 is handed back to the pool and goes off to serve someone else.
3. When the work finishes, *thread 3* picks up the rest of the method and reaches the end of the `lock`, where the key must be returned. But thread 3 never took the key, so it can't release it. That's why the compiler refuses.
4. `SemaphoreSlim` counts permits instead of remembering a thread, so any thread may release it, and it has an async `WaitAsync`.
:::

:::walk The lock the compiler refuses, and the one that works
```csharp norun
private readonly object _lockGate = new();
private readonly SemaphoreSlim _gate = new(1, 1);

public async Task RefreshBrokenAsync(CancellationToken ct)
{
    lock (_lockGate)
    {
        _token = await FetchTokenAsync(ct);
    }
}

public async Task RefreshTokenAsync(CancellationToken ct)
{
    await _gate.WaitAsync(ct);
    try { if (TokenExpired) _token = await FetchTokenAsync(ct); }
    finally { _gate.Release(); }
}
```
@6 | key held by = thread 7
Say a service refreshes a payment API token, and two requests mustn't do it at once. `lock` takes the key, and the key belongs to **thread 7**.
@8 | ! CS1996: Cannot await in the body of a lock statement
After this `await`, the rest of the method may run on a different thread, which would then try to give back a key it never took. So the compiler refuses outright.
@2 | -
`SemaphoreSlim(1, 1)` is a counter with one permit. It doesn't care **which** thread returns the permit.
@14 | permits = 0 (taken by this request)
`WaitAsync` takes the permit. If another request has it, this one waits *asynchronously*, without blocking a thread.
@15 | permits = 0 ; token = refreshing…
Awaiting inside is fine now. Whichever thread resumes the method can carry on.
@16 | permits = 1
`Release` in a `finally` gives the permit back even if the fetch throws, so the next request can go in.
:::

More in [Threading & concurrency](ch:threading-concurrency).

:::tip Companion chapter
Files, streams and encodings, the IO that async exists for, have their own chapter: [Files, streams and text](ch:files-streams-io).
:::

## Interviewer "why" deep-dives {a}

### "The CPU is idle but latency is high. How do you know it's thread-pool starvation and not something else?"

Idle CPU with high latency rules out a CPU-bound bottleneck immediately — if the CPU isn't the thing doing the waiting, something upstream is. The specific signature of starvation is a *queue* forming in front of the thread pool: `dotnet-counters` will show `ThreadPool Queue Length` climbing while `ThreadCount` only inches up roughly one at a time. That one-at-a-time growth is itself a clue — the pool's hill-climbing algorithm injects new threads slowly and deliberately, by design, to avoid overreacting to a brief spike, which is exactly what turns a short burst of blocking calls into a sustained backlog. A `dotnet-dump` or `dotnet-stack` taken during the incident, filtered to threads sitting in `Task.Wait`, `.Result`, or `GetAwaiter().GetResult()`, usually finds the actual blocking call directly, rather than requiring guesswork.

### "Why does SemaphoreSlim solve the lock-and-await problem when a plain lock can't?"

A `lock` is really sugar over `Monitor.Enter`/`Exit`, and `Monitor` tracks ownership by **thread**: only the exact thread that entered may exit, which the runtime enforces. `SemaphoreSlim` tracks ownership as a plain integer count of available permits, with no notion of which thread took one. That's a deliberate design difference, not an oversight — it's what makes `Release()` safe to call from a different thread than the one that called `WaitAsync()`, which is unavoidable once a continuation might resume on any pool thread. The cost is that a semaphore gives you none of a lock's automatic release-on-exception safety; you supply that yourself with `try`/`finally`, as in the example above.

## Summary {i}

Each of these failures has one specific, nameable cause: blocking on a `Task` either deadlocks (a captured `SynchronizationContext`) or starves the thread pool (no context, ASP.NET Core); a fire-and-forget task loses its exceptions and can touch services the request already disposed; and `await` can't appear inside a `lock` because a lock's ownership is tied to a thread, while a continuation can resume on any thread. All three trace back to the same root idea from [the core model](ch:async-await): a thread is freed during an `await`, and anything that assumes it comes back is what breaks.

This closes the async/await cluster. Next: [Threading and concurrency](ch:threading-concurrency) covers the thread pool itself in more depth, or continue to [Modern C#](ch:modern-csharp) to pick the main line back up.
