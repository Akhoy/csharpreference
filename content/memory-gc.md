---
id: memory-gc
title: Memory Management and the Garbage Collector
summary: How .NET allocates and frees memory. The stack and managed heap, allocation, the generational hypothesis, Gen0/1/2, the Large and Pinned Object Heaps, mark-sweep-compact, GC roots, workstation vs server GC, background GC, DATAS and container limits, finalization, weak references, memory leaks in .NET and how to diagnose them, and reducing allocations.
layer: runtime
where: Runtime & platform › Memory management (GC)
fits: The GC is a core service of the CLR (layer 2; see [How code runs](ch:how-code-runs)). Every choice in layer 1 (value vs reference types in [Type system](ch:type-system), closures in [Delegates](ch:delegates-events), async state machines in [async/await](ch:async-await), [Span](ch:advanced-csharp)) changes how much work it does. In layer 7, container memory limits ([Docker](ch:docker), [Kubernetes](ch:kubernetes)) shape how it behaves.
levels: b,i,a
prereqs: type-system, how-code-runs
next: threading-concurrency, performance-engineering
---

## TL;DR

- .NET frees memory for you: the **garbage collector (GC)** reclaims an object's memory once nothing can reach it any more — no `malloc`/`free`, no use-after-free, no double free.
- Objects are grouped by age into **generations** (Gen0 → Gen1 → Gen2) because most objects die young; collecting the small, young Gen0 often is cheap, and full Gen2 sweeps (which include the Large Object Heap) are rare and expensive.
- Big objects (≥ 85,000 bytes) skip straight to the **Large Object Heap**, which isn't compacted by default — allocate large buffers per request and you'll fragment it and trigger extra full GCs.
- **Server GC** (ASP.NET Core's default) trades memory for throughput using one heap per core; **DATAS** (.NET 9+) scales that to the real workload so containers don't get OOMKilled.
- A "memory leak" in .NET isn't freed-twice or dangling pointers — it's something still *reachable* (a static cache, an unsubscribed event, a captive DI dependency) that your app will never actually use again.
- Allocation rate drives GC frequency, which drives latency — so most performance tuning in .NET comes down to allocating less, not making the GC itself faster.

## The problem every language has to solve {b}

Every running program creates objects as it works, and every one of them eventually needs to disappear — otherwise memory just fills up until the machine falls over. Someone, or something, has to decide when an object is safe to free.

In C or C++, that someone is you. You call `malloc`/`free` or `new`/`delete` yourself, by hand, every time. Get it wrong and you get one of three classic bugs: a **leak** (you forgot to free something, and it sits there forever), a **use-after-free** (you freed something, then kept using it — often a security hole), or a **double free** (you freed the same thing twice, which can corrupt memory outright). These aren't rare mistakes; they're some of the most common, most dangerous bugs in systems programming.

.NET takes that decision away from you entirely. Its **garbage collector** (the **GC**) watches your objects and frees memory automatically, the moment it can prove nothing can reach an object any more. That one design choice is why `use-after-free` and `double free` essentially don't exist as bugs in C#.

It isn't free, though. The GC needs real CPU time to do this watching and freeing, and some of its work genuinely **pauses your running threads** while it happens. So here's the thing worth internalising before anything else in this chapter: almost all .NET performance tuning, once you dig past the surface, turns out to really be about **how much you're allocating** — because allocation is what creates the GC's workload in the first place. Understand the GC, and a huge amount of "why is this slow" advice stops being folklore and starts being obvious cause and effect.

## Two places your data can live {b}

Before any of that makes sense, you need to know there are two completely different places an object's data can sit: the **stack** and the **managed heap**. They behave almost nothing alike.

| | Stack | Managed heap |
|---|---|---|
| Belongs to | One thread (≈1 MB default on Windows, 8 MB on Linux's main thread) | The whole process, shared by every thread |
| Holds | Method frames: locals, parameters, return addresses | Reference-type objects, boxed values, arrays, closures, suspended async state machines |
| Allocating | Move a pointer — essentially free | Also just moving a pointer in most cases — also fast |
| Freeing | Automatic, the instant the method returns | **By the GC**, some unknown time after nothing references it any more |
| What happens if you overflow it | `StackOverflowException` (deep or infinite recursion — you can't even catch this one) | `OutOfMemoryException` |

Here's the part that surprises people: allocating on the heap is *also* cheap, most of the time. Each thread keeps a small chunk of heap space reserved for itself, called an **allocation context**, and handing out a new object from it is mostly just bumping a pointer forward — not meaningfully slower than the stack. So if heap allocation is cheap, where does the GC's reputation for being expensive actually come from?

It comes later. The *more* you allocate, the more often that allocation context fills up and the GC has to step in and do real work to make room for more. The cost isn't in the allocating — it's in how often allocating forces a collection. Keep that distinction in mind; it's the thread running through the rest of this chapter.

## Generations: why the GC doesn't scan everything, every time {i}

Here's an idea that sounds almost too simple to be the foundation of a whole optimisation strategy, but it is: **most objects die young.** Think about a typical web request — it creates a flurry of temporary strings, DTOs, LINQ enumerators, intermediate results — and nearly all of that garbage is unreachable again within milliseconds, the instant the request finishes. Meanwhile, a much smaller set of objects — caches, singletons, configuration — get created once and then stick around for the entire life of the process.

That observation has a name, the **generational hypothesis**, and .NET's GC is built directly around it. Instead of treating the whole heap as one big pool it has to re-scan from scratch every time, it splits the heap by *age*:

```text
 new objects                                                  long-lived objects
┌──────────┐  survives a GC  ┌──────────┐  survives a GC  ┌──────────────────────┐
│   Gen 0  │ ──────────────▶ │   Gen 1  │ ──────────────▶ │        Gen 2          │
│ small,   │                 │ buffer   │                 │ caches, singletons,   │
│ collected│                 │ between  │                 │ static data; FULL GCs │
│ very often│                │ 0 and 2  │                 │ are expensive         │
└──────────┘                 └──────────┘                 └──────────────────────┘
 LOH (Large Object Heap): objects ≥ 85,000 bytes. Logically part of Gen 2, collected with Gen 2, not compacted by default
 POH (Pinned Object Heap, .NET 5+): objects allocated pre-pinned, so they never fragment the other heaps
```

![Most objects allocated in Gen0 die there; only real survivors get promoted up to Gen1 and eventually Gen2](visuals/gc-generations.svg)

Here's what that diagram is actually showing, walked through concretely:

- Every object starts life in **Gen0**, the smallest generation. Because Gen0 is small, scanning it is fast — often well under a millisecond — and because *most* objects in it are already garbage by the time it fills up, a **Gen0 collection** reclaims a lot of memory for very little work.
- If an object is still reachable when Gen0 fills up and gets collected, it **survives**, and gets *promoted* up into **Gen1** — a kind of buffer zone between the churn of Gen0 and the stability of Gen2.
- If it survives *another* collection from there, it gets promoted again, into **Gen2** — where the genuinely long-lived stuff lives: caches, singletons, static data.
- A **Gen1 collection** sweeps Gen0 and Gen1 together. A **Gen2 collection** — often just called a **full GC** — sweeps absolutely everything, Gen0 through Gen2, including the Large Object Heap mentioned in the diagram (more on that shortly). Full GCs are the expensive ones, and the whole point of the generational design is to make them rare.

One more term you'll meet in GC logs: a Gen0-only collection still needs to know if some old Gen2 object secretly points at something in Gen0. Instead of rescanning all of Gen2 to check, the runtime keeps a **card table** — a small "which regions might contain a reference to something younger" scoreboard. Every time your code stores a reference from an older object into a younger one, a tiny bit of code called a **write barrier** marks the matching entry. A Gen0 collection then only has to check the marked entries, not all of Gen2.

:::why Why this actually matters for the code you write
Short-lived garbage — the kind that dies in Gen0 — is cheap, almost by design. The expensive case is the one hiding in the middle: objects that survive just long enough to get promoted to Gen1, and then die in Gen2 anyway. Developers sometimes call this a "mid-life crisis" — the object lived long enough to force an expensive full GC, but not long enough to actually be worth keeping around. This happens naturally with per-request objects that get held alive by a slow async operation spanning a Gen0 collection, or with caches whose expiry is set just a little too generously. It also happens automatically to anything **≥ 85 KB**, because of a rule you're about to meet: objects that size go straight onto the Large Object Heap, which is only ever cleaned up during a full Gen2 collection — so allocating big temporary buffers per request quietly forces frequent, expensive full GCs.
:::

## What actually happens during a collection {i}

You now know *when* generations get collected. Here's *how* a collection itself actually works, step by step, every single time one runs:

1. **Suspend your threads**, at points the runtime considers safe to pause them (called "safe points").
2. **Mark**: starting from a fixed set of known starting points — the **GC roots**, covered next — follow every reference outward and mark every object you can reach as *live*.
3. **Sweep and/or compact**: anything that *wasn't* marked is garbage, and its memory gets reclaimed. For the generations below the LOH, the GC usually also **compacts** — slides the surviving live objects together so they're contiguous, and fixes up every reference that pointed at them, which keeps the heap from fragmenting into a patchwork of unusable gaps. The LOH, by contrast, is swept into free lists rather than compacted by default — you'll see why that matters shortly.
4. **Resume your threads.**

Step 2 is doing something worth really sitting with: an object is only considered garbage if it's *unreachable*, full stop. It makes no difference whether your code will genuinely never touch it again — if something can still trace a path to it from a root, the GC keeps it alive. That single fact is the entire mechanism behind every .NET memory leak you will ever debug: somewhere, some root is holding a reference it shouldn't be.

So what actually counts as a root? Here's the full list:

| Root | Example |
|---|---|
| Static fields | `static readonly Dictionary<…> Cache` lives as long as the process does |
| Local variables and parameters on thread stacks (and CPU registers) | Anything a running method still uses — and the JIT tracks this precisely enough that a local can become collectable *before* its method even finishes, once the method is done using it |
| GC handles | Strong handles, pinned handles (`GCHandle.Alloc`), `fixed` |
| The finalization queue (f-reachable) | Objects waiting to have their finalizer run — you'll meet this properly below |
| Interop / COM references | Native code that's holding on to a managed object |

Keep that table nearby — later in this chapter, when "memory leak" comes up, every single cause traces back to one of these five rows holding a reference longer than it should.

## Choosing how the GC behaves {i}

The mark-sweep-compact cycle above is the mechanism. .NET also lets you choose *how* that mechanism is scheduled and parallelised, and the defaults genuinely differ depending on what kind of app you're running.

| Mode | Behaviour | Default for |
|---|---|---|
| **Workstation GC** | One heap; collections run on the thread that triggered them; favours responsiveness and low memory use | Desktop and console apps |
| **Server GC** | **One heap and one dedicated GC thread per logical core**; collections run in parallel across them; much higher throughput, at the cost of more memory | **ASP.NET Core** |
| **Background (concurrent) GC** | Gen2 collections run **concurrently** with your app's threads, so you only see brief pauses rather than a full stop; Gen0/1 collections still pause everything | On by default in both modes above |
| **DATAS** (Dynamic Adaptation To Application Sizes) | A refinement of Server GC that **adapts the number of heaps to the actual workload**, instead of always using one per core, so memory use stays roughly proportional to real load | **Default with Server GC since .NET 9** |

Why does ASP.NET Core default to Server GC instead of Workstation? A web server is, by nature, trying to maximise how many requests it can process per second across many cores at once — exactly the throughput-over-latency trade Server GC is built for. A desktop app, by contrast, cares more about not freezing the UI thread for a visible pause, which is Workstation GC's priority.

```xml
<!-- csproj or runtimeconfig.json -->
<PropertyGroup>
  <ServerGarbageCollection>true</ServerGarbageCollection>
  <ConcurrentGarbageCollection>true</ConcurrentGarbageCollection>
  <!-- <GarbageCollectionAdaptationMode>1</GarbageCollectionAdaptationMode>  DATAS on (default in .NET 9+ server GC) -->
</PropertyGroup>
```

Environment variable equivalents, useful when you can't touch the csproj (a container base image, for instance): `DOTNET_gcServer=1`, `DOTNET_GCgen0size`, `DOTNET_GCHeapHardLimit`, `DOTNET_GCHeapHardLimitPercent`, `DOTNET_GCHeapCount`, `DOTNET_GCConserveMemory`.

### Why this gets tricky inside containers

Here's a scenario worth walking through, because it genuinely used to cause production outages. The GC is **cgroup-aware**: it knows it's running inside a container with a memory limit, and by default caps its own heap at **75%** of that limit (tunable). The trap, before DATAS existed: Server GC's "one heap per core" rule doesn't ask whether memory is actually plentiful — it just counts cores. Put that on a node with *many* CPU cores but a *small* container memory limit (say, 32 cores, 512 MB) and Server GC happily creates 32 heaps, blows straight through the limit, and the container gets **OOMKilled** — with the app not leaking a single byte.

DATAS (.NET 9+) mostly fixes this by scaling the heap count to the real workload instead of blindly matching the core count. If you're still seeing `OOMKilled` after upgrading, the next things to check are: is the actual working set genuinely over the limit, is something consuming *native* memory the GC heap tracker can't see, and is this an actual leak — then reach for `GCHeapHardLimitPercent` or `GCConserveMemory` as tuning knobs, in that order.

### Latency modes and no-GC regions {a}

Two more dials exist for genuinely latency-sensitive code: `GCSettings.LatencyMode = GCLatencyMode.SustainedLowLatency` tries to avoid blocking full GCs wherever it can, and `GC.TryStartNoGCRegion(size)` runs a critical section with **no GC at all**, provided your allocation budget fits inside what you reserved. These are niche tools for things like trading systems or real-time workloads — the overwhelming majority of web apps never touch either one, and that's fine.

## The Large Object Heap and the Pinned Object Heap {a}

You've already seen the LOH mentioned twice — once in the generations diagram, once in the "mid-life crisis" box. Time to look at it properly.

Any object **≥ 85,000 bytes** — in practice, usually a big array or a big string — doesn't go through Gen0 at all. It's allocated directly onto a separate region called the **Large Object Heap**. That size threshold isn't arbitrary: copying a huge object around every time it survives a generation (which compaction normally does) would be expensive in its own right, so the runtime sidesteps the problem for big objects differently. Three consequences follow directly from that design:

- Allocating on the LOH costs more than a normal allocation, partly because the memory has to be cleared first.
- It's only ever collected alongside a full **Gen2** collection — never on its own.
- It isn't compacted by default, which means repeated large allocations and frees can leave it **fragmented**: lots of free space technically available, but scattered into pieces too small to satisfy the next big request.

The practical upshot: **avoid allocating large objects per request if you can help it.** Rent reusable buffers from `ArrayPool<T>.Shared` instead of `new byte[64 * 1024]`-ing a fresh one every time, stream data instead of loading whole files into one byte array, reach for `RecyclableMemoryStream` when you need a big in-memory stream, and lean on `System.IO.Pipelines` for high-throughput I/O. You *can* force a one-off LOH compaction (`GCSettings.LargeObjectHeapCompactionMode = GCLargeObjectHeapCompactionMode.CompactOnce; GC.Collect();`), but reaching for that is rarely the right fix — it's treating a symptom.

One more related idea: **pinning**. Normally the GC is free to move objects around during compaction — that's exactly what keeps the heap tidy. But some scenarios, mainly native interop and async I/O buffers, need an object to stay at a fixed memory address for a while, so the GC can be told not to move a specific object via `fixed` or `GCHandle.Alloc(obj, Pinned)`. The catch: a long-lived pin sits in the middle of the heap like a boulder the GC has to compact *around*, which fragments things. The **Pinned Object Heap** (POH, via `GC.AllocateArray<byte>(n, pinned: true)`) solves this cleanly: it gives you buffers that are pinned *from the moment they're born*, in a region set aside specifically for that purpose, so they never fragment the normal object heap at all.

## Finalizers: the GC's last resort, and why it's slow {i}

Every so often, an object wraps something the GC genuinely can't clean up on its own — a native handle, say. For those cases, C# offers a **finalizer**, written as `~T()`. It sounds like a safety net. In practice, it's a safety net you should almost never actually rely on, and understanding why tells you a lot about how the GC treats these objects differently from everything else.

Here's the sequence, once an object with a finalizer becomes unreachable:

1. The GC notices it's unreachable — but, because it has a finalizer still waiting to run, it **can't free it yet**. Instead, it moves the object to something called the **f-reachable queue**, which — notice the name — is itself a GC root. The object just got *re-rooted*, temporarily, by the very mechanism that was about to collect it. It also gets **promoted** to the next generation in the process.
2. At some later, genuinely unpredictable time, the single dedicated **finalizer thread** gets around to actually running that object's `Finalize` method.
3. Only *after* that has happened does a **later** GC finally free the memory for real.

Walk back through that and you'll see why finalizable objects are expensive: they survive at least one extra collection they otherwise wouldn't have, they get promoted to an older generation earlier than their actual usage pattern justifies, and their cleanup timing is completely outside your control. That's precisely why deterministic cleanup in .NET uses **`IDisposable`** plus `using` instead — and why a well-written `Dispose` method calls **`GC.SuppressFinalize(this)`**, which tells the runtime "cleanup already happened properly, you can skip the finalizer and the extra generation hop entirely." Where you genuinely need to wrap a native handle, prefer **`SafeHandle`** over writing a finalizer by hand — it already does this correctly. See [Exceptions & disposal](ch:exceptions-disposal#implementing-idisposable-yourself) for the full pattern.

:::gotcha The GC doesn't release unmanaged resources promptly
Everything above is about *managed* memory — the heap the GC actually tracks. File handles, sockets, database connections and native memory held by managed wrapper objects are a different story entirely: they get released when **you** dispose them, or, failing that, whenever a finalizer eventually gets around to it. A `DbConnection` left undisposed is a connection-pool leak the instant it happens, regardless of how much free RAM the machine has — the GC not having run yet is irrelevant.
:::

## Weak references and caches {a}

Sometimes you want to hold onto an object *if it's still around*, without that holding being the reason it stays around. That's what **`WeakReference<T>`** is for: it references an object without keeping it alive, so the GC is still free to collect it, and `TryGetTarget` simply returns `false` afterwards if it did. **`ConditionalWeakTable<TKey,TValue>`** does something similar but for attaching extra data to an object without extending its lifetime.

These show up in some cache and event-pattern implementations, but for the vast majority of web app caching you're better off with **`MemoryCache`**, configured with real size limits and expirations — it gives you *predictable* eviction, whereas weak references leave eviction entirely up to the GC's own timing, which is much harder to reason about in production.

## Memory leaks in .NET: still possible, just a different shape {i}

Earlier this chapter said something worth repeating exactly: an object is only garbage once it's **unreachable** — not once it's *useless*. A **managed memory leak** is precisely the gap between those two: objects that are still technically reachable from some root, but that your application will never actually use again. Every single row in this table traces back to one of the five GC roots from earlier, holding a reference it shouldn't be:

| Cause | Example | Fix |
|---|---|---|
| **Static collections that only grow** | `static List<Order> _processed`, a static `Dictionary` cache without eviction | Bounded caches (`MemoryCache` with `SizeLimit`/expiry), or don't keep them |
| **Event handlers never unsubscribed** | A transient subscribes to a singleton's event; the singleton keeps every subscriber alive | Unsubscribe in `Dispose`; weak events; avoid events between lifetimes |
| **Captive dependencies** | A singleton holding a scoped `DbContext` whose change tracker grows forever | Correct DI lifetimes ([DI](ch:dependency-injection#the-captive-dependency-the-single-most-common-di-bug)) |
| **Unbounded in-memory queues** | `Channel.CreateUnbounded` with a slow consumer | Bounded channels with backpressure |
| **Timers** | `System.Threading.Timer` callbacks referencing big objects; timers never disposed | Dispose timers; `PeriodicTimer` in hosted services |
| **Closures capturing too much** | A long-lived lambda capturing `this` or a large object | Capture only what's needed; static lambdas |
| **Resolving disposable transients from the root provider** | `app.Services.GetService<TransientDisposable>()` repeatedly: tracked until shutdown | Resolve inside scopes |
| **Large caches of EF entities / tracked graphs** | Long-lived DbContext | Short-lived contexts, `AsNoTracking` |
| **`HttpClient`/connection objects created per call** | Sockets and native buffers pile up | `IHttpClientFactory`, singletons for SDK clients |
| **Native memory** | Leaked unmanaged buffers, un-disposed native wrappers | `Dispose`, `SafeHandle`; diagnose with native tools |

How do you actually notice one of these is happening, as opposed to just normal memory use going up and down? The tell is specific: Gen2 size and total working set **grow steadily under constant, steady load, and never come back down** even after full GCs run. A healthy app's memory goes up and down as load varies; a leaking one's floor keeps rising. Left alone, that ends in either an `OutOfMemoryException` or a container getting **OOMKilled**.

## Actually finding a leak: a real diagnostic workflow {a}

Knowing the table above is one thing; actually finding *which* row applies, in a production service you didn't write the leaking code in, is another. Here's a workflow that works, step by step, using tools you install once with `dotnet tool install`:

```bash
dotnet tool install -g dotnet-counters
dotnet tool install -g dotnet-gcdump
dotnet tool install -g dotnet-dump

# 1. Watch live: GC heap size per generation, % time in GC, allocation rate, Gen0/1/2 counts, LOH size, working set
dotnet-counters monitor -n Shop.Api --counters System.Runtime

# 2. Snapshot the managed heap (lightweight: types, counts, sizes, roots), twice, minutes apart, then compare
dotnet-gcdump collect -n Shop.Api -o before.gcdump
dotnet-gcdump collect -n Shop.Api -o after.gcdump     # open both in Visual Studio / PerfView and diff: which types grew?

# 3. Full process dump for deep analysis (who roots this object?)
dotnet-dump collect -n Shop.Api
dotnet-dump analyze core_20261027.dmp
> dumpheap -stat                 # objects by type and total size
> dumpheap -mt <MethodTable>     # instances of a type
> gcroot <address>               # the reference chain keeping it alive (THE leak answer)
> eeheap -gc                     # heap/segment overview
```

Step 1 tells you *whether* you have a problem and roughly how fast it's growing. Step 2 tells you *which type* is growing — diffing two snapshots taken minutes apart under steady load shows exactly which object counts kept climbing when they should have stayed flat. Step 3's final command, `gcroot`, is the one that actually answers the question: given one specific surviving instance, it walks backward through live references and shows you the exact chain of objects keeping it alive — which, cross-referenced against the roots table from earlier, tells you exactly which of the ten leak patterns above you're looking at.

Beyond these three CLI tools, you'll also find **Visual Studio's Diagnostic Tools / memory profiler**, **JetBrains dotMemory**, **PerfView** (deep GC event and allocation sampling), Application Insights' own memory metrics and profiler, `dotnet-trace` with GC events enabled, and — specifically inside Kubernetes — `kubectl debug` with the diagnostics tools attached as an ephemeral container.

The numbers actually worth watching: **% time in GC** (sustained above roughly 10% is a real problem, not noise), **allocation rate** in MB/s, **Gen2 collection count**, **heap size right after a Gen2 collection finishes** (this is the single clearest leak signal — it should be flat under steady load, not climbing), **GC pause times** (directly affects your p99 latency), and LOH size.

## Writing allocation-friendly code {a}

Given everything above — that allocation rate is what drives GC frequency, and GC frequency is what drives latency and throughput — here's the direct, practical payoff: a table of common allocation-heavy patterns, and the lower-allocation alternative for each.

| Technique | Instead of |
|---|---|
| `StringBuilder`, `string.Join`, `string.Create`, interpolated string handlers | `+=` concatenation in loops |
| `Span<T>`, `ReadOnlySpan<char>` slicing and span-based parsing | `Substring`, `Split` on hot paths |
| `ArrayPool<T>.Shared.Rent/Return`, `stackalloc` (small) | `new byte[64 * 1024]` per request |
| Structs (`readonly struct`, `record struct`) for small values | Classes for tiny, short-lived data |
| Generics | Boxing via `object`/non-generic collections |
| Pre-sized collections `new List<T>(n)` | Repeated resize-and-copy |
| Static lambdas / avoiding captures in hot paths | Closures allocating per call |
| `ValueTask` for frequently-synchronous async methods | `Task` allocation per call |
| Cached `JsonSerializerOptions`, source-generated serializers and `[LoggerMessage]` | New options per call; boxing log arguments |
| `AsNoTracking` + projections in EF Core | Materialising and tracking full entity graphs |
| Streaming (`IAsyncEnumerable`, `Stream`, `PipeReader`) | Buffering whole payloads in memory |
| `FrozenDictionary` for static lookups | Rebuilding dictionaries |
| Object pooling (`ObjectPool<T>`) for expensive reusable objects | Allocating them per operation |

One honest caveat before you go rewrite everything: **measure first** (see [Performance engineering](ch:performance-engineering)). Most business code spends almost all of its time waiting on I/O, not allocating — and readability is worth more than shaving a handful of allocations off code that runs once per request and was never the bottleneck to begin with.

:::gotcha Don't call GC.Collect()
It's tempting, when you're debugging a memory issue, to just force a collection and see what happens. Resist it in production code. The GC's internal heuristics are already tuned to your app's actual allocation pattern over time, and forcing a collection out of turn almost always **hurts**: it promotes objects to older generations before they've earned it, wastes CPU on a collection that wasn't actually needed yet, and causes a pause at a moment you didn't choose. The legitimate uses are narrow: tests, benchmarks, and right after a genuinely one-off huge cleanup in a batch job — and even then, measure before and after to confirm it actually helped.
:::

:::qa How does the .NET garbage collector work?
It's a generational, tracing, mark-and-compact collector. Allocation bumps a pointer in Gen0. When a generation's budget fills, a GC suspends threads, marks all objects reachable from roots (statics, stack locals, GC handles, the finalization queue), reclaims the rest, compacts survivors and promotes them to the next generation. Gen0/1 collections are frequent and cheap; Gen2 (full, including the LOH) is expensive and mostly runs concurrently in background GC.
:::

:::qa What are GC generations and why do they exist?
Gen0 holds new objects, Gen1 is a buffer, and Gen2 holds long-lived objects. Based on the generational hypothesis that most objects die young, collecting the small young generation frequently reclaims most garbage cheaply, without scanning the whole heap each time.
:::

:::qa What is the Large Object Heap?
A separate heap region for objects of 85,000 bytes or more. It's collected only during Gen2 collections and not compacted by default, so frequent large allocations cause full GCs and fragmentation. Pool or stream large buffers instead.
:::

:::qa Workstation vs Server GC?
Workstation GC uses a single heap and favours low latency and memory, and is the default for client apps. Server GC uses a heap and dedicated GC thread per core with parallel collection for higher throughput, and is the default for ASP.NET Core. .NET 9+ adds DATAS so Server GC adapts heap count to load, keeping memory proportional in containers.
:::

:::qa What are GC roots?
The starting points for reachability: static fields, local variables and parameters on thread stacks (and registers), GC handles (strong and pinned), the finalization queue and interop references. Anything reachable from a root is live and won't be collected.
:::

:::qa Can you have memory leaks in .NET? Give examples.
Yes. Leaks are objects that stay reachable but are no longer needed: ever-growing static collections or caches without eviction, event handlers not unsubscribed from long-lived publishers, captive dependencies (a singleton holding a scoped DbContext), undisposed timers, closures capturing large objects, unbounded queues, and native resources not disposed.
:::

:::qa How would you investigate a memory leak in a production .NET service?
Confirm steady growth of Gen2/heap-after-GC with dotnet-counters or App Insights metrics. Take two gcdumps some time apart and diff them to find growing types. Then take a full dump with dotnet-dump and use gcroot on sample instances to find the reference chain keeping them alive, fix the root, and verify with load tests.
:::

:::qa Why are finalizers expensive?
Finalizable objects are tracked from allocation. When unreachable, they must survive an extra collection (promoted to the f-reachable queue) until the single finalizer thread runs them, and only a later GC frees their memory. That's more work, longer lifetimes and nondeterministic cleanup. Use IDisposable with GC.SuppressFinalize, and SafeHandle.
:::

:::qa Why shouldn't you call GC.Collect?
The GC's heuristics tune collection timing to allocation patterns. Forcing collections wastes CPU, causes pauses, and promotes still-live objects to older generations, making later collections more expensive. It's rarely justified outside tests and benchmarks.
:::

## Further reading

- [Fundamentals of garbage collection](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/fundamentals)
- [Runtime configuration options for garbage collection](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/garbage-collector)
- [Debug a memory leak in .NET](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/debug-memory-leak)
- Maoni Stephens' blog posts on the .NET GC (she leads the GC team).
- Book: *Pro .NET Memory Management* by Konrad Kokosa: the definitive deep dive.

## Verify this chapter

Run with `dotnet run` (a plain console app, .NET 8/9, no extra packages). It checks generation assignment, the LOH size threshold, promotion after a collection, `ArrayPool<T>` reuse, and `WeakReference<T>` behavior directly against the live GC in your process. Server GC/DATAS and container heap limits are process-wide startup configuration, not something an in-process console app can flip and observe, so those claims are left to the Microsoft Learn links above instead of faked here.

```csharp
// Verify this chapter: run with `dotnet run`. No external packages needed.
using System;
using System.Buffers;

void Check(string name, bool ok)
{
    if (!ok) throw new Exception($"FAIL: {name}");
    Console.WriteLine($"OK: {name}");
}

// 1. A new object starts life in Gen0.
var fresh = new byte[16];
Check("new small object starts in Gen0", GC.GetGeneration(fresh) == 0);

// 2. Objects >= 85,000 bytes go straight to the Large Object Heap, which is
//    logically part of Gen2 (GC.GetGeneration reports 2 for LOH objects).
var small = new byte[1000];
var large = new byte[100_000];
Check("small array (1,000 bytes) is not on the LOH (Gen0/1)", GC.GetGeneration(small) < 2);
Check("array >= 85,000 bytes is allocated on the LOH (reported as Gen2)", GC.GetGeneration(large) == 2);

// 3. Surviving a collection promotes an object to the next generation.
var survivor = new object();
int genBefore = GC.GetGeneration(survivor);
GC.Collect(0, GCCollectionMode.Forced, blocking: true); // collect Gen0 only
int genAfter = GC.GetGeneration(survivor);
Check("an object still referenced after a Gen0 collection is promoted (or already older)", genAfter >= genBefore);

// 4. GC.CollectionCount increases after a forced collection of that generation.
long countBefore = GC.CollectionCount(0);
GC.Collect(0, GCCollectionMode.Forced, blocking: true);
long countAfter = GC.CollectionCount(0);
Check("GC.CollectionCount(0) increases after forcing a Gen0 collection", countAfter > countBefore);

// 5. ArrayPool<T>.Shared.Rent can return the exact same backing array once
//    it has been returned to the pool -- demonstrating the "no new allocation"
//    reuse the chapter recommends for hot paths.
var pool = ArrayPool<byte>.Shared;
var rented1 = pool.Rent(4096);
pool.Return(rented1);
var rented2 = pool.Rent(4096);
bool sameArray = ReferenceEquals(rented1, rented2);
pool.Return(rented2);
Console.WriteLine(sameArray
    ? "OK: ArrayPool<T>.Shared reused the same backing array (no fresh heap allocation)"
    : "OK: ArrayPool<T>.Shared returned a different array this run (pool reuse is a best-effort optimization, not guaranteed every time)");

// 6. WeakReference<T> lets the GC collect an object even though a reference
//    to it technically still exists, unlike a normal (strong) reference.
object? strongTarget = new object();
var weak = new WeakReference<object>(strongTarget);
Check("WeakReference.TryGetTarget finds the object while a strong reference keeps it alive", weak.TryGetTarget(out _));
strongTarget = null; // drop the only strong reference
GC.Collect();
GC.WaitForPendingFinalizers();
GC.Collect();
// Not asserted as a hard failure: the GC is not obligated to collect on any
// particular call, but under GC.Collect() + WaitForPendingFinalizers() in a
// console app with no other roots, this reliably clears.
bool collected = !weak.TryGetTarget(out _);
Console.WriteLine(collected
    ? "OK: after dropping the only strong reference and forcing a collection, WeakReference no longer finds the object"
    : "OK: object survived this run (GC timing is not guaranteed) -- see Further reading: Fundamentals of garbage collection");

// 7. Server GC vs Workstation GC and DATAS are process-wide runtime
// configuration (csproj / runtimeconfig.json / env vars), not something a
// console app can flip at runtime and observe in-process -- see Further
// reading: "Runtime configuration options for garbage collection".
Console.WriteLine($"INFO (not asserted): GCSettings.IsServerGC = {System.Runtime.GCSettings.IsServerGC} for this process");

Console.WriteLine("All checks passed.");
```
