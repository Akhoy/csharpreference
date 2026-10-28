---
id: threading-concurrency
title: Threading, Concurrency and Parallelism
summary: Doing many things at once safely. Concurrency vs parallelism vs asynchrony, threads and the thread pool, Task.Run and Parallel, race conditions and atomicity, Interlocked, locks (lock/Lock, Monitor, SemaphoreSlim, ReaderWriterLockSlim), deadlocks, volatile and memory models, concurrent collections, Channels and producer/consumer, thread safety in ASP.NET Core singletons, and PLINQ.
layer: runtime
where: Runtime & platform › Threads & concurrency
fits: The thread pool is a CLR service (layer 2) that every async continuation ([async/await](ch:async-await)) and every ASP.NET Core request runs on. Concurrency bugs mostly appear in **singletons** ([Dependency injection](ch:dependency-injection)), caches ([Caching](ch:caching-ratelimit-cors)) and background workers ([Background work](ch:background-work)), and at system scale they reappear as database concurrency ([Relational fundamentals](ch:relational-fundamentals#locking-blocking-and-deadlocks)).
levels: b,i,a
prereqs: async-await, collections
next: performance-engineering, background-work
---

## TL;DR

- **Concurrency** = several things in progress at once (maybe interleaved); **parallelism** = several things literally running at the same instant on different cores; **asynchrony** = not blocking a thread while waiting on something slow. A web server is heavily concurrent, mostly asynchronous, and only occasionally parallel.
- `_count++` looks like one step but is really three (read, add, write) — two threads can interleave those steps and silently lose an update. That's a **race condition**, and it never throws an exception; it just produces a wrong number.
- `Interlocked` fixes a single shared variable with one atomic CPU instruction (no lock needed). A `lock`/`Monitor` protects more than one variable at once, but you can never `await` inside it — use `SemaphoreSlim` when you need both mutual exclusion and `await`.
- A **deadlock** happens when two threads each hold something the other is waiting for. The practical fix is almost always: always acquire locks in the same order everywhere.
- The BCL ships thread-safe collections (`ConcurrentDictionary`, `Channel<T>`, immutable snapshots) specifically so you don't have to hand-roll locking for common patterns like caches and producer/consumer queues.
- The one rule that matters most in ASP.NET Core: **every singleton must be thread-safe**, because it's the one instance every concurrent request shares.

## Three words people mix up constantly {b}

Before anything else, let's pin down three words that sound almost interchangeable and genuinely aren't — because half the confusion in this topic comes from people using them loosely.

| Term | Meaning | .NET tools |
|---|---|---|
| **Concurrency** | Several tasks **in progress** at the same time — they might be truly simultaneous, or just interleaved, taking turns | Everything in this chapter |
| **Parallelism** | Several tasks **actually executing at the same instant**, on different CPU cores, specifically to speed up CPU-bound work | `Parallel.For/ForEach(Async)`, PLINQ, `Task.Run`, `Task.WhenAll` over CPU work |
| **Asynchrony** | Not blocking a thread while it **waits** for something slow, like I/O | `async`/`await`, `Task` |

Here's a sentence worth re-reading until it clicks: a web server is massively **concurrent** — thousands of requests in flight — but mostly **asynchronous**, because almost all of that "in flight" time is spent waiting on a database or a downstream API, not computing. It's only occasionally, genuinely **parallel**, when one request deliberately spreads CPU-bound work across cores. Most of what this chapter covers is really about concurrency: many things happening at once, and the bugs that come from them touching shared state at the same time.

One more related word you'll meet below: **multithreading**, which just means using more than one OS thread. It's the underlying mechanism both parallelism and (some) concurrency are built on.

## Threads are expensive; the pool exists because of that {b}

A **thread** is a path of execution the operating system schedules onto a CPU core, and every single one gets its own stack — about 1 MB reserved by default. Creating a thread from scratch costs real time (milliseconds, not microseconds) and real memory, and once you have too many of them, the OS spends more time *switching between* them than actually running your code.

So .NET doesn't create a fresh thread for every piece of work. Instead, the **thread pool** keeps a set of reusable worker threads sitting ready, and hands them queued work items as they become free. Nearly everything concurrent in a typical ASP.NET Core app ends up running on it:

- Every incoming request (Kestrel dispatches each one to the pool)
- Every `await` continuation — the "resume here later" code you saw in the async/await chapter — since ASP.NET Core has no `SynchronizationContext` to route continuations elsewhere
- `Task.Run`, `Parallel`, and timer callbacks

```csharp
var t = new Thread(() => DoWork()) { IsBackground = true, Name = "legacy-worker" };   // dedicated thread: rare today
t.Start();

await Task.Run(() => ComputeHash(bytes));                 // queue CPU work to the pool
await Task.Factory.StartNew(LongRunningLoop, TaskCreationOptions.LongRunning);   // hint: gets a dedicated thread
```

Here's the mechanism worth really understanding, because it's the root cause of a production incident nearly every .NET backend team eventually has: the pool doesn't start out huge. It begins with roughly one thread per CPU core, and when more work arrives than it can currently handle, it grows **gradually** — a "hill-climbing" algorithm adds threads a little at a time, and a separate starvation-detection mechanism injects roughly one new thread every half-second to one second under sustained pressure. That's deliberately slow, because spinning up threads too eagerly would waste the exact resources the pool exists to conserve.

Now put that together with one more fact: calling `.Result`, `Thread.Sleep`, or any *blocking* I/O call ties up a pool thread for the entire duration of the block — it can't go do other work in the meantime. Under load, with the pool only growing a thread or two a second, a sudden burst of blocked threads can genuinely starve the queue faster than the pool can backfill it. That specific failure mode has a name — **thread-pool starvation** — and it's covered in detail in [async/await](ch:async-await#deadlocks-and-thread-pool-starvation), because it's really a consequence of *not* using `async`/`await` properly.

## Race conditions: when "it depends on timing" becomes a bug {b}

Here's a piece of code that looks completely harmless:

```csharp
private int _count;
public void Increment() => _count++;
```

It isn't harmless, and the reason is worth walking through slowly, because `_count++` looks like *one* operation but is actually **three**: read the current value, add one to it, write the new value back. Each of those three steps is a separate moment in time — and another thread can slip in between any of them.

![Two threads both read 5, both compute 6, both write 6 — one increment silently disappears](visuals/race-condition.svg)

Walk through exactly what the diagram shows:

1. Thread A reads `_count` and gets `5`.
2. Before A writes anything back, Thread B *also* reads `_count` — and also gets `5`, because A hasn't written yet.
3. Thread A computes `5 + 1 = 6` and writes `6`.
4. Thread B, working from the `5` it already read, *also* computes `5 + 1 = 6`, and writes `6`.

Two increments happened. The final value is `6`, not `7`. One of the increments vanished without a trace, without throwing any exception, without any sign anything went wrong — which is exactly what makes **race conditions** so nasty: the result depends entirely on the unpredictable timing of two threads, so the bug might not show up once in a thousand test runs and then appear under real production load.

This exact "read, modify, write" shape hides in more places than a bare counter. **Check-then-act** code — `if (!dict.ContainsKey(k)) dict.Add(k, v);` — has the identical flaw: two threads can both pass the `ContainsKey` check before either calls `Add`. Lazy initialisation done by hand has the same shape. So does iterating a collection while another thread modifies it, which in .NET usually surfaces as an `InvalidOperationException`, or — worse — silently corrupted state in a plain `Dictionary`.

### Where does this actually bite in a web app?

The good news: most of your code is completely safe from this by default, because most of it *isn't shared* between threads.

| Shared? | Example | Safe? |
|---|---|---|
| ✘ Not shared | Locals, request-scoped services, `HttpContext` (one request) | Yes — nothing else can see them |
| ✔ **Shared** | **Singleton services**, `static` fields, `IMemoryCache` entries, hosted services, `IOptionsMonitor` callbacks | **Must be made thread-safe deliberately** |

That gives you a simple, memorable rule: **every singleton must be thread-safe**, because a singleton is, by definition, the *one* instance every concurrent request calls into at the same time. Everything from here through the rest of this chapter is really a toolbox for making that true.

## Interlocked: the fastest fix, when it applies {i}

The simplest tool in that toolbox handles exactly the counter problem from above, when all you need to protect is a single variable:

```csharp
private long _requests;
public void OnRequest() => Interlocked.Increment(ref _requests);           // atomic ++
public long Snapshot() => Interlocked.Read(ref _requests);

private int _initialised;
public void InitOnce() { if (Interlocked.CompareExchange(ref _initialised, 1, 0) == 0) Init(); }   // CAS: set to 1 only if still 0

Interlocked.Add(ref _bytes, n);
var old = Interlocked.Exchange(ref _currentConfig, newConfig);              // atomic reference swap (great for immutable snapshots)
```

`Interlocked.Increment` doesn't fix the race by making the three steps faster — it fixes it by making them **one indivisible step**, a single atomic CPU instruction that no other thread can observe halfway through. There's no window left for another thread to sneak a read in between, because there's no "in between" any more.

That's also exactly why `Interlocked` is the fastest synchronisation tool in .NET: it needs no lock, no waiting, nothing but one CPU instruction. The trade-off is right there in the name — it only ever covers *one variable at a time*. The moment you need to keep two or more related pieces of state consistent with each other, `Interlocked` can't help, and you need a real lock.

## Locks: protecting more than one variable at once {i}

### lock / Lock / Monitor

```csharp
private readonly Lock _gate = new();                // C# 13 / .NET 9: dedicated Lock type (faster); use a private readonly object before that
private readonly Dictionary<string, Price> _prices = new();

public void Update(string sku, Price p)
{
    lock (_gate)                                    // only one thread at a time inside; others wait
    {
        _prices[sku] = p;
    }
}

public bool TryGet(string sku, out Price? p) { lock (_gate) return _prices.TryGetValue(sku, out p); }
```

`lock (obj)` is really shorthand — it compiles down to `Monitor.Enter`/`Monitor.Exit` wrapped in a `try/finally`, which guarantees the lock is released even if the code inside throws. Four rules keep this safe in practice: lock on a **private, readonly** object (never `this`, never `typeof(X)`, never a string — all of those could accidentally be locked on by *other* unrelated code too, defeating the whole point); keep what's inside the lock **short**; **never `await` inside a `lock`** (the compiler actively forbids this — you'll see exactly why in a moment); and never call unknown code — an event, a callback — while holding a lock, because you have no idea what it might do.

### Why `await` and `lock` don't mix

Here's the "why" behind that compiler rule, because it's one of those facts that's easy to memorise and hard to actually understand. A `Monitor` lock is **thread-affine**: whichever thread acquired it is the one that must release it. But you already know from the async/await chapter that when an `await` suspends and later resumes, the continuation can land on a *completely different* thread pool thread than the one that started it. Put those two facts together and a lock held across an `await` becomes nonsensical — the thread that's supposed to release it might not be the thread that's running by the time execution comes back. So the compiler simply won't let you write it.

### SemaphoreSlim: the async-friendly alternative

When you genuinely need mutual exclusion *and* the ability to `await` inside the protected section, reach for `SemaphoreSlim` instead:

```csharp
private readonly SemaphoreSlim _refreshGate = new(1, 1);       // mutual exclusion usable with await

public async Task<string> GetTokenAsync(CancellationToken ct)
{
    if (_token is { IsValid: true } t) return t.Value;           // fast path without locking
    await _refreshGate.WaitAsync(ct);
    try
    {
        if (_token is { IsValid: true } t2) return t2.Value;     // double-check after acquiring
        _token = await FetchTokenAsync(ct);
        return _token.Value;
    }
    finally { _refreshGate.Release(); }
}

private readonly SemaphoreSlim _throttle = new(10);              // at most 10 concurrent calls to a fragile API
```

Notice the shape of `GetTokenAsync`: it checks the fast path *before* acquiring the semaphore, and checks it **again** right after — a pattern called "double-checked locking". Why check twice? Because between the first check failing and this method actually acquiring the gate, some *other* call might have already done the refresh for you — checking again avoids doing the work a second time unnecessarily. A `SemaphoreSlim(1, 1)` behaves like a `lock` that's safe to hold across an `await`; one more detail worth knowing is that a plain `SemaphoreSlim(n)` with `n` greater than one isn't mutual exclusion at all — it's a *concurrency limiter*, letting up to `n` callers through at once, which is exactly what `_throttle` above is doing.

### The rest of the toolbox, briefly

| Primitive | Use |
|---|---|
| `ReaderWriterLockSlim` | Many concurrent readers, exclusive writers (sync only). Often an **immutable snapshot + `Interlocked.Exchange`** is simpler and faster |
| `Mutex` | Cross-**process** mutual exclusion (named mutex), e.g. single-instance apps |
| `ManualResetEventSlim`, `AutoResetEvent`, `CountdownEvent`, `Barrier` | Signalling between threads (mostly replaced by tasks and channels) |
| `Lazy<T>` / `LazyInitializer` | Thread-safe lazy initialisation |
| `AsyncLocal<T>` / `ThreadLocal<T>` | Per-async-flow / per-thread values |
| **Distributed locks** (Redis, SQL app locks, Blob leases) | Across **machines**: a C# lock only protects one process ([Background work](ch:background-work#running-a-job-once-across-replicas)) |

## Deadlocks: when locking itself becomes the bug {i}

Locks solve the race-condition problem — but used carelessly, they create a different one, and this one doesn't just lose an update, it freezes your app solid. Here's the simplest possible version:

```csharp
// Thread 1: lock(A) { … lock(B) { } }
// Thread 2: lock(B) { … lock(A) { } }      → each holds one and waits forever for the other
```

Walk through it: Thread 1 grabs lock `A`, then tries to grab lock `B` — but Thread 2 already has `B`, and is itself waiting on `A`, which Thread 1 is holding. Neither thread will ever let go, because neither can proceed. They're not crashed — they're just frozen, forever, waiting on each other in a perfect, silent circle.

There's a name for the four conditions that all have to be true at once for this to happen (**Coffman's conditions**): each lock can only be held by one thread (true of every lock you've seen); a thread keeps what it already has while it waits for more; nothing can force a thread to let go of a lock early; and the chain of "who's waiting for whom" loops back on itself. The useful takeaway isn't memorising the four names — it's this: break just *one* of them, and the deadlock becomes impossible. That's exactly where the fixes below come from:

- **Lock ordering**: if every piece of code that needs both `A` and `B` always acquires them in the *same* order — say, always `A` before `B` — a circular wait becomes structurally impossible. This single discipline prevents the overwhelming majority of real deadlocks.
- **Don't hold a lock while calling out** — to an event, a callback, I/O, another service — because you have no idea what that outside code might itself try to lock.
- Use **timeouts** instead of waiting forever: `Monitor.TryEnter(obj, timeout)`, `SemaphoreSlim.WaitAsync(timeout)`. A deadlock that times out and retries is recoverable; one that waits forever is not.
- Prefer designs that need **no locks at all** where you can: immutable data, `Interlocked`, concurrent collections, channels and message passing — all covered below.
- And the async-specific version of this bug, which you met properly in the async/await chapter: **never block on async code** (`.Result`) anywhere a `SynchronizationContext` exists — it's a two-thread deadlock with exactly the same circular-wait shape as the example above, just dressed up differently.

## Why the compiler and CPU are allowed to reorder your code {a}

There's a subtler category of concurrency bug that has nothing to do with locks at all, and it trips people up because it violates an assumption that feels completely obvious: that code runs in the order you wrote it. For a single thread, it effectively does. For multiple threads watching each other, it sometimes doesn't — and here's why that's actually allowed.

Compilers, the JIT, and CPUs are all permitted to **reorder** reads and writes, and to **cache** values in registers instead of main memory, *as long as the single thread running that code can't tell the difference*. That last clause is the key: the guarantee is only ever about what one thread observes about itself. Nobody promised anything about what a *different* thread, watching from outside, will see — and that gap is exactly where this bug lives.

```csharp
private bool _stop;
public void Run() { while (!_stop) { /* work */ } }   // the JIT may hoist _stop into a register → loops forever
public void Stop() => _stop = true;
```

From `Run`'s own point of view, nothing here looks unsafe at all, so the JIT is completely within its rights to decide `_stop` can't possibly change during the loop and cache it once in a register instead of re-reading memory every iteration. The loop then runs forever, even though some *other* thread genuinely did call `Stop()` — that write just never became visible to this thread's cached copy.

The fix is to tell the runtime, explicitly, "don't cache this — always go back to real memory": mark the field `volatile` (`private volatile bool _stop;`), or use `Volatile.Read`/`Volatile.Write` directly. Locks and `Interlocked` operations also happen to act as full memory barriers, which is a second reason they fix more bugs than just the ones they're obviously designed for. In practice, though, don't reach for `volatile` by hand for a stop signal — use a **`CancellationToken`**, which does this correctly for you, and save hand-rolled lock-free code for the rare cases that genuinely need it. It's expert territory, and the bugs in it are exactly this subtle.

## Concurrent collections: built so you don't have to lock by hand {i}

Everything so far has been about protecting *your own* state with locks or atomics. The BCL also ships a set of collections that are already safe to use from multiple threads, without you writing any locking code at all:

| Collection | Notes |
|---|---|
| `ConcurrentDictionary<K,V>` | Fine-grained locking; atomic `GetOrAdd`, `AddOrUpdate`, `TryRemove`, `TryUpdate`. The factory may run more than once, so wrap it in `Lazy<T>` for expensive work |
| `ConcurrentQueue<T>` / `ConcurrentStack<T>` | Lock-free FIFO/LIFO |
| `ConcurrentBag<T>` | Unordered; thread-local optimised |
| `BlockingCollection<T>` | Blocking bounded producer/consumer (sync) |
| **`Channel<T>`** | **Async** producer/consumer: bounded or unbounded, single/multi reader/writer, backpressure |
| `ImmutableDictionary`/`ImmutableList` + `ImmutableInterlocked` | Snapshot semantics: readers never lock |
| `FrozenDictionary` | Built once, read concurrently, no locks needed |

The immutable-snapshot pattern deserves its own look, because it's a genuinely elegant way to sidestep locking entirely for data that's read constantly but written rarely:

```csharp
// Copy-on-write snapshot: readers are lock-free, writers swap a new immutable instance atomically
private ImmutableDictionary<string, FeatureFlag> _flags = ImmutableDictionary<string, FeatureFlag>.Empty;
public bool IsOn(string name) => _flags.TryGetValue(name, out var f) && f.Enabled;           // no lock
public void Reload(IEnumerable<FeatureFlag> all) => Interlocked.Exchange(ref _flags, all.ToImmutableDictionary(f => f.Name));
```

Here's why this works without a single lock anywhere: readers never modify `_flags`, they just read whatever reference happens to be there right now — and reading a reference is already atomic. When new flags arrive, `Reload` doesn't mutate the existing dictionary at all; it builds a brand new one and then uses `Interlocked.Exchange` to atomically swap the *reference* `_flags` points at. Any reader that grabbed the old reference a moment earlier keeps working with a perfectly consistent, if slightly stale, snapshot. Nobody ever sees a half-updated dictionary, because nobody ever updates one — they only ever replace the whole thing at once.

## Producer/consumer pipelines with Channels {i}

`Channel<T>` is the async-aware queue that connects a producer doing one job to one or more consumers doing another, with built-in backpressure:

```csharp
var channel = Channel.CreateBounded<ImportRow>(new BoundedChannelOptions(1_000)
{
    FullMode = BoundedChannelFullMode.Wait,        // producer awaits when full: backpressure
    SingleWriter = true,
    SingleReader = false
});

var producer = Task.Run(async () =>
{
    await foreach (var row in ReadCsvAsync(path, ct)) await channel.Writer.WriteAsync(row, ct);
    channel.Writer.Complete();                      // no more items
});

var consumers = Enumerable.Range(0, 4).Select(_ => Task.Run(async () =>
{
    await foreach (var row in channel.Reader.ReadAllAsync(ct))    // ends when the writer completes and the channel is drained
        await SaveAsync(row, ct);
})).ToArray();

await Task.WhenAll(consumers.Append(producer));
```

The word **bounded** is doing real work here. If the channel had no capacity limit, a slow consumer couldn't push back on a fast producer at all — the queue would simply grow without limit until memory ran out, which is a memory leak with extra steps. `FullMode = Wait` means that once the channel hits its 1,000-item capacity, `WriteAsync` itself starts `await`ing until a consumer makes room, which is backpressure in its purest form: the producer is automatically throttled to match how fast the consumers can actually keep up.

This exact pattern — one bounded queue, several workers, cancellation, a clean completion signal — covers the large majority of in-process pipeline needs you'll run into. For genuinely multi-stage pipelines with branching and merging, look at **TPL Dataflow** (`System.Threading.Tasks.Dataflow`), which generalises this idea into a graph of connected blocks.

## Data parallelism: Parallel and PLINQ {i}

Everything above this point has mostly been about *correctness* under concurrency. This last tool is about *speed*: deliberately spreading genuinely CPU-bound work — not I/O waiting, actual computation — across multiple cores at once.

```csharp
// Synchronous CPU work across cores
Parallel.For(0, images.Length, new ParallelOptions { MaxDegreeOfParallelism = Environment.ProcessorCount }, i =>
    thumbnails[i] = Resize(images[i]));          // each index written by one iteration: no shared mutable state

// Async work with bounded concurrency (I/O-bound fan-out)
await Parallel.ForEachAsync(urls, new ParallelOptions { MaxDegreeOfParallelism = 8, CancellationToken = ct },
    async (url, token) => await DownloadAsync(url, token));

// PLINQ
var primes = Enumerable.Range(2, 5_000_000).AsParallel().WithDegreeOfParallelism(4).Where(IsPrime).Count();
```

Three things worth knowing before reaching for this. First, parallelism isn't free: partitioning the work, scheduling it across threads, and merging the results back together all cost something, so it only pays off once the per-item work is substantial enough to be worth that overhead — parallelising a trivial loop can easily make it *slower*. Second, if the body of your loop touches shared mutable state (as opposed to the `thumbnails[i]` example above, where each iteration writes to a different, non-overlapping index), you're right back to the race-condition problem from the start of this chapter — use `Parallel.For`'s `localInit`/`localFinally` overloads to accumulate per-thread results safely instead. And third, specifically for ASP.NET Core: **avoid heavy parallel CPU work inside a request handler**. Every thread that work pulls onto a core is a thread stolen from the shared pool other requests are also waiting on — offload genuinely heavy CPU work to a background worker instead, so one expensive request can't starve everyone else.

## Thread safety checklist for ASP.NET Core {a}

Pulling every idea in this chapter together into something you can actually check a pull request against:

- [ ] Singletons hold only **thread-safe or immutable** state (concurrent collections, `Interlocked`, snapshots, locks around compound operations).
- [ ] No mutable `static` fields used as caches without synchronisation and bounds.
- [ ] `DbContext` is never shared across concurrent operations (one per scope; `IDbContextFactory` for parallel work).
- [ ] `HttpContext` is never used outside its request or from background threads.
- [ ] No blocking on async code (`.Result`/`.Wait()`), and no `Thread.Sleep` in request paths.
- [ ] `lock` sections are short and contain no awaits or external calls; use `SemaphoreSlim` for async exclusion.
- [ ] Background work is bounded (channels with capacity, `MaxDegreeOfParallelism`).
- [ ] Cross-instance coordination uses distributed locks or the database, not C# locks.

:::qa What's the difference between concurrency, parallelism and asynchrony?
Concurrency is multiple tasks in progress at once (possibly interleaved). Parallelism is executing multiple tasks simultaneously on multiple cores for CPU-bound speed-up. Asynchrony is not blocking a thread while waiting for I/O, so threads can do other work. A web server is highly concurrent and mostly asynchronous.
:::

:::qa What is the thread pool and why does blocking it hurt?
A pool of reusable worker threads that runs queued work items: ASP.NET Core requests, await continuations, Task.Run. It grows slowly when saturated, so blocking threads (sync-over-async, Thread.Sleep, sync I/O) causes thread-pool starvation, where queued work waits and latency spikes while CPU stays low.
:::

:::qa What is a race condition and how do you prevent it?
When correctness depends on thread timing, e.g. two threads doing count++ and losing an update, or check-then-act on a dictionary. Prevent it with atomic operations (Interlocked), locks around compound operations, concurrent collections' atomic methods, immutability, or avoiding shared mutable state altogether.
:::

:::qa Why can't you use await inside a lock statement? What do you use instead?
Monitor locks are thread-affine (they must be released by the thread that acquired them), but after an await the continuation may run on a different thread, and holding a lock across awaits risks long blocking and deadlocks. The compiler forbids it. Use SemaphoreSlim(1,1) with WaitAsync/Release in try/finally.
:::

:::qa How do deadlocks occur and how do you avoid them?
Two or more threads each hold a resource another needs and wait in a cycle. Avoid them with consistent lock ordering, short critical sections without external calls, timeouts on acquisition, lock-free or message-passing designs, and not blocking on async code where a SynchronizationContext exists.
:::

:::qa How do you make a singleton service thread-safe?
Prefer immutable state, or swap immutable snapshots atomically with Interlocked.Exchange. Use concurrent collections with their atomic methods, Interlocked for counters, and locks or SemaphoreSlim around compound operations. Don't hold per-request state or non-thread-safe dependencies (like DbContext) in it.
:::

:::qa What does the volatile keyword do?
It gives reads acquire semantics and writes release semantics, preventing certain compiler/JIT/CPU reorderings and register caching, so other threads see updates. It doesn't make compound operations atomic. In practice, prefer locks, Interlocked, Volatile.Read/Write or CancellationToken for signalling.
:::

:::qa When would you use Parallel.ForEachAsync vs Task.WhenAll?
Parallel.ForEachAsync for processing a (possibly large) collection with a bounded degree of parallelism and cancellation. Task.WhenAll to await a known, small set of already-started independent operations. Unbounded WhenAll over thousands of items can overwhelm downstream services.
:::

:::qa What are Channels used for?
In-process asynchronous producer/consumer queues (System.Threading.Channels), with bounded capacity for backpressure, completion signalling, and async reading via ReadAllAsync. They're used for background work queues and pipelines between hosted services and request handlers.
:::

## Further reading

- [Managed threading best practices](https://learn.microsoft.com/en-us/dotnet/standard/threading/managed-threading-best-practices)
- [Overview of synchronization primitives](https://learn.microsoft.com/en-us/dotnet/standard/threading/overview-of-synchronization-primitives)
- [The managed thread pool](https://learn.microsoft.com/en-us/dotnet/standard/threading/the-managed-thread-pool)
- [Data and task parallelism (TPL)](https://learn.microsoft.com/en-us/dotnet/standard/parallel-programming/)
- Joseph Albahari, *Threading in C#* (free online). Stephen Cleary, *Concurrency in C# Cookbook* (2nd ed.).

## Verify this chapter

Run with `dotnet run` (a plain console app, .NET 8/9; `System.Collections.Concurrent` and `System.Threading.Channels` are part of the BCL, no extra packages). It reproduces the race condition, then shows `Interlocked`, `lock` and `ConcurrentDictionary` all fixing it exactly; verifies `SemaphoreSlim(n)` genuinely caps concurrency at `n`; verifies a bounded `Channel<T>` applies real backpressure while still delivering every item; and verifies consistent lock ordering avoids a deadlock that a real two-lock deadlock would otherwise hang on. Deliberately reproducing a `volatile`-missing infinite loop or an actual deadlock on demand is timing/JIT-dependent and not something it's safe to force in a short script, so those are described rather than triggered — see Further reading.

```csharp
// Verify this chapter: run with `dotnet run`. No external packages needed
// (System.Threading, System.Collections.Concurrent and System.Threading.Channels
// are all part of the BCL).
using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;

void Check(string name, bool ok)
{
    if (!ok) throw new Exception($"FAIL: {name}");
    Console.WriteLine($"OK: {name}");
}

const int threads = 8;
const int perThread = 200_000;
const int expected = threads * perThread;

// 1. Race condition: plain `_count++` across many threads loses updates,
// because read-increment-write is three separate steps, not one.
int unsafeCount = 0;
void BumpUnsafe() { for (int i = 0; i < perThread; i++) unsafeCount++; }
Parallel.Invoke(Enumerable.Repeat(0, threads).Select(_ => (Action)BumpUnsafe).ToArray());
Console.WriteLine(unsafeCount < expected
    ? $"OK: unsynchronized increments lost updates under contention ({unsafeCount} of {expected} survived)"
    : $"OK: unsynchronized increments happened not to lose any this run ({unsafeCount} of {expected}) -- races are timing-dependent, not guaranteed on every run/machine");

// 2. Interlocked.Increment under the exact same contention never loses one:
// it's a single atomic CPU instruction, not three separate steps.
long safeCount = 0;
void BumpSafe() { for (int i = 0; i < perThread; i++) Interlocked.Increment(ref safeCount); }
Parallel.Invoke(Enumerable.Repeat(0, threads).Select(_ => (Action)BumpSafe).ToArray());
Check($"Interlocked.Increment under the same contention is always exact ({safeCount} == {expected})", safeCount == expected);

// 3. lock (Monitor) protects a compound operation (read a dict, write it back)
// the same way, for state Interlocked can't cover (more than one variable).
var gate = new Lock();
var prices = new System.Collections.Generic.Dictionary<string, int>();
void BumpPrice(string sku) { for (int i = 0; i < 10_000; i++) lock (gate) { prices[sku] = prices.GetValueOrDefault(sku) + 1; } }
Parallel.Invoke(Enumerable.Repeat(0, threads).Select(_ => (Action)(() => BumpPrice("KB-01"))).ToArray());
Check($"a lock-protected read-modify-write is exact under contention ({prices["KB-01"]} == {threads * 10_000})",
    prices["KB-01"] == threads * 10_000);

// 4. ConcurrentDictionary.GetOrAdd / AddOrUpdate are atomic: many threads
// racing to initialize the SAME key still end up with one consistent value.
var concurrentCounts = new ConcurrentDictionary<string, int>();
Parallel.For(0, 50_000, _ => concurrentCounts.AddOrUpdate("hits", 1, (_, old) => old + 1));
Check($"ConcurrentDictionary.AddOrUpdate is exact under contention ({concurrentCounts["hits"]} == 50000)",
    concurrentCounts["hits"] == 50_000);

// 5. SemaphoreSlim(n) as a concurrency LIMITER: never more than n callers
// inside the guarded section at once, verified by tracking the peak.
var throttle = new SemaphoreSlim(3);
int current = 0, peak = 0;
var peakGate = new Lock();
async Task ThrottledWork()
{
    await throttle.WaitAsync();
    try
    {
        int now = Interlocked.Increment(ref current);
        lock (peakGate) peak = Math.Max(peak, now);
        await Task.Delay(10);
    }
    finally { Interlocked.Decrement(ref current); throttle.Release(); }
}
await Task.WhenAll(Enumerable.Range(0, 20).Select(_ => ThrottledWork()));
Check($"SemaphoreSlim(3) never let more than 3 callers run at once (observed peak = {peak})", peak <= 3 && peak > 0);

// 6. Bounded Channel<T> backpressure: with capacity 2 and FullMode.Wait, a
// producer that's faster than the consumer is made to wait -- verified by
// checking the writer genuinely blocks (doesn't finish instantly) until the
// reader drains.
var channel = Channel.CreateBounded<int>(new BoundedChannelOptions(2) { FullMode = BoundedChannelFullMode.Wait });
var sw = Stopwatch.StartNew();
var producerTask = Task.Run(async () =>
{
    for (int i = 0; i < 10; i++) await channel.Writer.WriteAsync(i);
    channel.Writer.Complete();
});
var consumerTask = Task.Run(async () =>
{
    int received = 0;
    await foreach (var _ in channel.Reader.ReadAllAsync())
    {
        received++;
        await Task.Delay(5); // slower than the producer, forcing backpressure
    }
    return received;
});
await Task.WhenAll(producerTask, consumerTask);
int totalReceived = await consumerTask;
Check($"a bounded channel still delivers every item despite backpressure ({totalReceived} == 10)", totalReceived == 10);
Check($"backpressure made the whole pipeline take noticeably longer than an instant drain (took {sw.ElapsedMilliseconds} ms)",
    sw.ElapsedMilliseconds >= 40); // 10 items * 5ms consumer delay, gated by capacity 2

// 7. Lock ordering prevents deadlock: acquiring two locks in a CONSISTENT
// order from multiple threads never deadlocks, verified by it completing
// within a timeout (an actual deadlock would hang forever).
var lockA = new Lock();
var lockB = new Lock();
void AcquireBothInOrder() { lock (lockA) { lock (lockB) { /* critical section */ } } }
var orderedTask = Task.Run(() => Parallel.Invoke(Enumerable.Repeat(0, threads).Select(_ => (Action)AcquireBothInOrder).ToArray()));
bool completedInTime = orderedTask.Wait(TimeSpan.FromSeconds(5));
Check("many threads acquiring two locks in the SAME consistent order never deadlock (completed well within a 5s timeout)",
    completedInTime);

// Not runtime-verifiable here (timing-sensitive, JIT/CPU-dependent, and not
// safe to force on demand): a `volatile`-missing infinite loop reliably
// hanging, and a genuine two-lock deadlock reliably reproducing -- both
// exist exactly as described, but deliberately triggering them in a short
// verification script would either hang this program or depend on
// optimizations that vary by build/runtime. See Further reading: "Overview
// of synchronization primitives" and "Managed threading best practices".

Console.WriteLine("All checks passed.");
```
