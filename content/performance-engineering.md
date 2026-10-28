---
id: performance-engineering
title: Performance Engineering: Measure, Profile, Optimise
summary: A disciplined approach to speed. Latency vs throughput and percentiles, where time actually goes in a .NET backend, BenchmarkDotNet micro-benchmarks done right, the diagnostics toolbox (dotnet-counters, dotnet-trace, dumps, PerfView, profilers), load testing, a catalogue of high-impact optimisations from database to JSON, startup performance and Native AOT, and keeping performance from regressing.
layer: cross
where: Cross-cutting › Performance
fits: Performance is a layer-8 concern that pulls everything together: the runtime ([How code runs](ch:how-code-runs), [Memory & GC](ch:memory-gc), [Threading](ch:threading-concurrency)), the language ([async](ch:async-await), [Span](ch:advanced-csharp)), the framework ([Caching](ch:caching-ratelimit-cors)), data ([EF Core querying](ch:efcore-querying), [indexes](ch:relational-fundamentals#indexes-the-single-most-important-performance-tool-in-this-c)) and the infrastructure ([Azure compute](ch:azure-compute)). Observability ([Observability](ch:observability-aspire)) tells you where to look.
levels: i,a
prereqs: memory-gc, threading-concurrency, efcore-querying
next: web-security, system-design
---

## TL;DR

- **Measure before you optimise.** Find the real bottleneck with traces/profilers first; guessing wastes effort on code that was never slow.
- Use **percentiles** (p95, p99), not averages — averages hide the slow requests that real users actually feel.
- Most backend slowness is the **database** (missing indexes, N+1), not CPU-bound C# code.
- **BenchmarkDotNet**, not a raw `Stopwatch` loop, for trusting micro-benchmark numbers — a bare loop is skewed by JIT warm-up, GC pauses and dead-code elimination.
- `dotnet-counters`/`dotnet-trace`/`dotnet-dump` are the day-to-day diagnostic toolbox; load testing (k6, NBomber) checks the whole system under concurrency, not just one method.
- Fix things in order of impact: indexes/N+1 first, then async/concurrency, then payload size, then micro-level allocations — in that order, because each later category's wins are usually dwarfed by the earlier ones.

## The method: measure, don't guess {i}

Every other technique in this chapter — profilers, benchmarks, the optimisation catalogue — only pays off once you've committed to one discipline: find out where time is *actually* going before changing anything. The alternative, guessing based on intuition about what "feels slow," reliably sends people optimising the wrong 95% of the code while the real bottleneck sits untouched.

```text
1. Define the goal       "p95 of GET /products < 150 ms at 500 RPS", not "make it faster"
2. Measure the baseline  in a production-like environment, with production-like data
3. Find the bottleneck   traces → profiler → the ONE thing dominating the time
4. Change one thing      the cheapest fix for that bottleneck
5. Measure again         did the target metric improve? any regressions elsewhere?
6. Repeat or stop        stop when the goal is met. Further optimisation has a cost (complexity)
```

> "Premature optimization is the root of all evil" (Knuth). The full quote continues: "…yet we should not pass up our opportunities in that critical 3%." Find the 3% with measurements.

## Latency, throughput and percentiles {i}

| Metric | Meaning |
|---|---|
| **Latency** | Time for one operation (request duration) |
| **Throughput** | Operations per unit of time (requests/s) |
| **Percentiles** | p50 (median), **p95**, **p99**, p99.9: the latency below which that % of requests fall |
| **Utilisation / saturation** | How busy a resource is / how much work is queued for it |

**Use percentiles, not averages.** Here's a concrete illustration of why: out of 100 requests, if 98 take 50 ms and 2 take 5,000 ms, the *average* is about 148 ms — already looks bad, but still hides what's going on — while the p99 is 5,000 ms, the number that actually describes the experience of the unluckiest 2% of users. (Source: this is just `latency[⌈p·N⌉ − 1]` on the sorted array — verified below.) At real traffic volumes, that 2% is thousands of people, and a user loading a page that fires ten API calls hits that unlucky tail on nearly every page load, not just rarely. **Little's Law** links the three core metrics precisely: concurrency = throughput × latency (so 500 RPS × 0.2 s = 100 concurrent requests in flight) — a formula worth keeping handy when sizing a thread pool or a connection pool, since it tells you exactly how many requests you need to support *simultaneously*, not just per second.

## Where time goes in a .NET backend {i}

Typical request time, in order of how often it's actually the culprit — notice this ordering is itself a product of experience across many real investigations, and it's worth checking top-down rather than jumping straight to whichever cause feels most interesting:

1. **Database**: missing indexes, N+1 queries, over-fetching, lock contention, chatty round trips ([EF Core querying](ch:efcore-querying#the-n-1-problem-the-single-most-common-ef-core-performance-b)).
2. **Remote calls**: sequential calls that could be concurrent, no caching, no timeouts, slow dependencies.
3. **Thread pool starvation**: sync-over-async, blocking calls ([async/await](ch:async-await)).
4. **Serialization**: huge payloads, reflection-based serializers, returning entire entity graphs.
5. **Allocations and GC**: per-request large buffers, LINQ-heavy hot paths, boxing, string concatenation ([Memory & GC](ch:memory-gc)).
6. **Lock contention**: a global lock in a singleton serialising all requests.
7. **Logging**: synchronous sinks, excessive logging, interpolated log strings.
8. **Pure CPU work** in your code: rarely the problem, but measurable when it is.

**Traces** ([Observability](ch:observability-aspire)) show which of these dominates for a slow request **before** you open a profiler — exactly the workflow the trace diagram in that chapter walked through, where one SQL span turned out to account for nearly the entire request's duration. Starting there, rather than guessing from this list, is what step 3 of the measurement loop above actually means in practice.

## Micro-benchmarking with BenchmarkDotNet {a}

Timing code with `Stopwatch` in a loop gives misleading numbers. Four things throw it off:

- **JIT warm-up**: your first iterations run on slow, unoptimised Tier 0 code before the JIT recompiles the hot method into fast Tier 1 code (the two-tier curve from [How code runs](ch:how-code-runs#now-zoom-into-the-jit-why-does-it-translate-a-method-twice)). An unwarmed loop measures a mix of slow-then-fast, not the steady state you actually care about.
- **GC pauses** landing at unpredictable moments.
- **Dead-code elimination**: the optimiser may notice nobody uses the result and skip the work entirely, timing nothing.
- **CPU frequency scaling** changing clock speed mid-run.

**BenchmarkDotNet** handles all four: it runs a separate process in Release mode, does warm-up and pilot runs, takes many iterations, and applies statistics — so the number you get back reflects your code, not noise.

```csharp
// dotnet new console; dotnet add package BenchmarkDotNet; run with: dotnet run -c Release
[MemoryDiagnoser]                         // allocations per operation + GC counts
[SimpleJob(RuntimeMoniker.Net80)]
[SimpleJob(RuntimeMoniker.Net10_0, baseline: true)]   // compare runtimes
public class SkuParsing
{
    private const string Line = "2026-10-27;KB-01;3;49.90";

    [Benchmark(Baseline = true)]
    public decimal Split() => decimal.Parse(Line.Split(';')[3], CultureInfo.InvariantCulture);

    [Benchmark]
    public decimal Span()
    {
        ReadOnlySpan<char> s = Line;
        return decimal.Parse(s[(s.LastIndexOf(';') + 1)..], CultureInfo.InvariantCulture);
    }

    [Params(10, 1_000)] public int N;
    private int[] _data = [];
    [GlobalSetup] public void Setup() => _data = Enumerable.Range(0, N).ToArray();
    [Benchmark] public int LinqSum() => _data.Where(x => x % 2 == 0).Sum();
    [Benchmark] public int LoopSum() { int s = 0; foreach (var x in _data) if (x % 2 == 0) s += x; return s; }
}

BenchmarkRunner.Run<SkuParsing>();
```

```text
| Method | Mean      | Ratio | Allocated |
|------- |----------:|------:|----------:|
| Split  | 112.40 ns |  1.00 |     216 B |
| Span   |  38.15 ns |  0.34 |         - |
```

Look at both columns of that result, not just `Mean`: `Span` is roughly three times faster *and* allocates zero bytes, where `Split` allocates 216 B per call purely from the intermediate array `Split(';')` creates. Multiply that 216 B by a hot path called a million times a minute, and it's 216 MB of garbage the GC now has to collect — exactly the allocation-pressure mechanism from [Memory & GC](ch:memory-gc) turning a "tiny" per-call cost into real, measurable GC time under load.

Rules: **always Release**, never with a debugger attached; return results (or use `Consumer`) so the JIT can't eliminate the work; benchmark realistic inputs; look at **Allocated**, not just time; remember a 70 ns win matters only if the code runs millions of times — on a code path called once per request at 50 RPS, 70 ns is immeasurable against a 150 ms database call, and chasing it would be exactly the "premature optimisation" Knuth warned about. Micro-benchmarks validate a hypothesis about a hot path that **profiling already identified**; they're a verification step, not where you start.

## The diagnostics toolbox {a}

| Tool | What it does | When |
|---|---|---|
| **dotnet-counters** | Live runtime and ASP.NET Core metrics: CPU, GC heap/gen counts, % time in GC, allocation rate, **thread pool queue length & thread count**, exceptions/s, requests/s, connection counts | First look at a running process; starvation and GC pressure |
| **dotnet-trace** | Collects an EventPipe trace (CPU samples, GC, allocations, contention, exceptions, custom events) | CPU hot paths, allocation sources, lock contention |
| **dotnet-dump** | Full process dump + SOS analysis (`clrstack`, `dumpheap`, `gcroot`, `syncblk`) | Hangs, deadlocks, memory leaks, crashes |
| **dotnet-gcdump** | Lightweight heap snapshot | Memory growth comparison |
| **dotnet-monitor** | A sidecar/agent exposing those diagnostics over HTTP with triggers ("collect a trace when CPU > 80% for 1 min") | Production containers / Kubernetes |
| **Visual Studio Profiler** / **JetBrains dotTrace & dotMemory** | CPU, allocation, async and database profiling with rich UIs | Development and staging deep dives |
| **PerfView** | Microsoft's free, powerful ETW/EventPipe analyser | GC and CPU analysis, flame graphs |
| **Speedscope** / flame graphs | Visualise traces (`dotnet-trace convert --format Speedscope`) | Seeing where CPU time goes |
| **Application Insights Profiler**, continuous profilers (Pyroscope, Datadog) | Sampled production profiling | Real-traffic hot paths |
| **SQL tools** | Execution plans, Query Store, `SET STATISTICS IO`, Azure SQL Insights | Database time |

```bash
dotnet-counters monitor -n Shop.Api --counters System.Runtime,Microsoft.AspNetCore.Hosting,System.Net.Http
dotnet-trace collect -n Shop.Api --profile cpu-sampling --duration 00:00:30 -o cpu.nettrace
dotnet-trace convert cpu.nettrace --format Speedscope                     # open at speedscope.app
dotnet-dump collect -n Shop.Api && dotnet-dump analyze <file>             # > clrstack -all   (look for threads blocked in Wait/GetResult)
```

### Reading the symptoms

This table is really a decision tree disguised as a table: each row's symptom narrows down which tool from above you reach for next, and *why* each symptom points where it does is worth tracing through once:

| Symptom | Likely cause | Confirm with |
|---|---|---|
| High latency, **low CPU**, rising thread count | Thread-pool starvation (sync-over-async) or waiting on I/O/locks | counters (ThreadPool Queue Length), dump `clrstack -all` |
| High CPU, latency rises with load | Hot code path, excessive GC, serialization, regex backtracking | dotnet-trace CPU sampling → flame graph |
| High % time in GC, saw-tooth memory | Allocation rate too high, LOH churn | counters (alloc rate, gen2 count), trace allocations |
| Memory grows forever | Leak | gcdump diff, `gcroot` ([Memory & GC](ch:memory-gc#actually-finding-a-leak-a-real-diagnostic-workflow)) |
| Slow only under concurrency | Lock contention, connection pool exhaustion, DB locking | trace contention events, pool counters, DB waits |
| A specific endpoint is slow | Its SQL, its remote calls | Distributed trace spans |

The first row is the one people most often get wrong: **high latency with low CPU** sounds like "the machine isn't working hard, so why is it slow?" But low CPU is exactly what thread-pool starvation looks like. The CPU really isn't busy — your requests are just sitting in a queue waiting for a free worker thread, because something upstream is blocking synchronously on async work and holding threads that should have gone back to the pool (the same mechanism as [Async and await's deadlock section](ch:async-await#deadlocks-and-thread-pool-starvation)). So "the server isn't even busy" is a clue *pointing at* a thread-pool problem, not evidence against one.

## Load testing {a}

Micro-benchmarks test methods; **load tests** test the **system** under realistic concurrency — a different question entirely, since a method that benchmarks fast in isolation can still fall over once a hundred requests are all contending for the same connection pool at once.

```js
// k6 script (JavaScript): ramp to 500 virtual users, assert SLOs
import http from 'k6/http';
import { check, sleep } from 'k6';
export const options = {
  stages: [{ duration: '2m', target: 100 }, { duration: '5m', target: 500 }, { duration: '2m', target: 0 }],
  thresholds: { http_req_duration: ['p(95)<150', 'p(99)<400'], http_req_failed: ['rate<0.01'] },
};
export default function () {
  const res = http.get('https://staging.shop.com/api/products?page=1');
  check(res, { 'status 200': r => r.status === 200 });
  sleep(1);
}
```

| Test type | Purpose |
|---|---|
| **Load** | Expected peak traffic: do we meet the SLOs? |
| **Stress** | Beyond peak: where and how does it break? (Gracefully, with 429/503, or by falling over?) |
| **Spike** | Sudden bursts: does autoscaling react in time? |
| **Soak / endurance** | Hours at steady load: memory leaks, connection leaks, degradation |
| **Capacity** | How many instances for N RPS → cost planning |

The Stress row's parenthetical — "gracefully, with 429/503, or by falling over" — is the whole point of a stress test. A system that starts returning 503s past its limit, while still serving the requests it *can* handle, is behaving correctly. A system that falls over entirely past that same limit is a future incident, waiting for the next traffic spike. Tools: **k6** (Grafana), **NBomber** (C#), **Azure Load Testing** (managed, runs JMeter or Locust scripts, integrates with CI and App Insights), JMeter, Locust, `bombardier`/`wrk` for quick HTTP blasts. Test against **production-like** environments and data volumes, watch server-side metrics during the test, and watch out for the load generator itself becoming the bottleneck: a test that's really measuring how fast the *test machine* can send requests, rather than how fast your API answers them, is an easy trap to fall into.

## High-impact optimisations, by layer {a}

### Data access (usually the biggest wins)

- Add or fix **indexes** for the actual query patterns; check plans ([Relational fundamentals](ch:relational-fundamentals#indexes-the-single-most-important-performance-tool-in-this-c)).
- Eliminate **N+1**; **project** to DTOs; `AsNoTracking`; split queries; pagination with sensible limits.
- Batch round trips (`WHERE Id IN …`, `ExecuteUpdate`, bulk copy); avoid chatty loops.
- **Cache** hot, rarely changing reads (HybridCache, output cache, CDN) ([Caching](ch:caching-ratelimit-cors)).
- Read replicas for read-heavy workloads; connection pooling and DbContext pooling.

This category tops the list because the gaps here are so much bigger than anywhere else: a missing index can turn a 2 ms query into a 2-second table scan, a thousand-fold difference no amount of C# optimisation elsewhere in the request can claw back. Fix the database layer first; everything else is comparatively marginal gains.

### Concurrency and I/O

- **Async all the way**; remove every `.Result`/`.Wait()`.
- Run independent remote calls **concurrently** (`Task.WhenAll`), with timeouts.
- Reuse connections: `IHttpClientFactory`, singleton SDK clients, HTTP/2 or HTTP/3.
- Move slow work **off the request path** (queues + workers; 202 Accepted).
- Remove global locks from hot singletons; use concurrent or immutable structures.

### Payloads and serialization

- Smaller responses: projections, paging, field selection, compression (Brotli/gzip), `JsonIgnoreCondition.WhenWritingNull`.
- **System.Text.Json source generation** for hot types; cache `JsonSerializerOptions` (never create one per call).
- Stream large results (`IAsyncEnumerable`, `Stream`) instead of buffering.
- gRPC/Protobuf for internal high-volume calls.

### Allocations and CPU

- Pool large buffers (`ArrayPool`), use `Span`/`Memory` for parsing, avoid boxing and per-call closures in hot paths, pre-size collections, `StringBuilder`, `FrozenDictionary` for static lookups, `[GeneratedRegex]` instead of new `Regex` instances, `[LoggerMessage]` for hot logging ([Advanced C#](ch:advanced-csharp)).
- **Seal** classes, avoid unnecessary virtual/interface dispatch in tight loops (the JIT devirtualises sealed types), and let Dynamic PGO work (it's on by default).
- Use `Vector<T>`/SIMD-accelerated BCL APIs (`span.IndexOfAny`, `SequenceEqual`, `Sum` on spans).

### Platform

- **Upgrade .NET**: each release brings significant free performance improvements (Stephen Toub's yearly posts document hundreds).
- Server GC with DATAS; correct container CPU/memory requests ([Kubernetes](ch:kubernetes#resources-qos-and-autoscaling)).
- Scale out horizontally; autoscale on the right signal (queue length, RPS, CPU).
- CDN and edge caching for static and cacheable content.

## Startup performance {a}

Startup matters for **serverless cold starts**, **scale-out speed**, and container **rolling deployments** — anywhere a brand-new process has to become ready to serve traffic as fast as possible, rather than a long-running process where startup cost is amortised over hours of uptime.

| Technique | Effect |
|---|---|
| **ReadyToRun** (`<PublishReadyToRun>`) | Precompiled code: less JIT at startup |
| **Native AOT** (`<PublishAot>`) | No JIT at all; ~10× faster startup, much lower memory; requires AOT-compatible code ([How code runs](ch:how-code-runs#what-if-you-skipped-the-jit-completely)) |
| `WebApplication.CreateSlimBuilder` | Fewer default services |
| Trimming | Smaller deployments |
| EF Core **compiled models** | Faster first query for big models |
| Avoid heavy work in startup | Defer cache warm-ups to a background service; lazy initialisation |
| Source generators (JSON, config binding, RDG) | No reflection at startup |
| Warm-up before taking traffic | Startup/readiness probes, slot warm-up (`applicationInitialization`) |

Native AOT's speedup isn't vague "it's more optimised" — it's the literal removal of a pipeline stage. With no JIT at all, there's no Tier 0 → Tier 1 warm-up period to pay for (the same curve from [How code runs](ch:how-code-runs#now-zoom-into-the-jit-why-does-it-translate-a-method-twice)), which is exactly where the roughly tenfold startup improvement comes from.

## Preventing regressions {a}

- **Performance budgets and SLOs** (p95 targets per critical endpoint) tracked on dashboards, with alerts.
- **Benchmarks in CI** for performance-critical libraries (BenchmarkDotNet with result comparison against the main branch).
- **Load tests in the pipeline** (Azure Load Testing with pass/fail criteria) before production for high-traffic services.
- **Canary deployments** with automated latency and error comparisons ([CI/CD](ch:cicd-iac#deployment-strategies)).
- Code review checklists: async all the way, no N+1, projections, timeouts, pagination limits, no per-request large allocations.

The common thread: left unguarded, performance degrades gradually and invisibly. One small regression per PR, each too small to notice on its own, compounds over months into a system that's quietly twice as slow — with no single commit anyone could point to as "the cause." Each of these five practices exists to catch that drift automatically, before it compounds.

:::qa How would you approach a performance problem in a .NET API?
Define a measurable goal (p95 latency at a given load). Measure a baseline in a production-like environment. Use distributed traces to see which component dominates (DB, remote calls, app code). Drill in with the right tool (execution plans for SQL, dotnet-counters/trace or a profiler for CPU/GC/thread-pool issues). Fix the single biggest bottleneck, re-measure, and repeat until the goal is met. Avoid optimising without evidence.
:::

:::qa Why use percentiles instead of averages for latency?
Averages hide the tail: a few very slow requests barely move the mean but hurt real users, and users making many requests encounter the tail frequently. p95/p99 show what most users and the worst-affected users experience, and SLOs are usually defined on them.
:::

:::qa What is BenchmarkDotNet and why not just use a Stopwatch?
A micro-benchmarking library that runs code in an isolated Release process with warm-up, many iterations and statistical analysis, and reports allocations with MemoryDiagnoser. A Stopwatch loop is skewed by JIT tiering, warm-up, GC, dead-code elimination and noise, so it produces unreliable numbers.
:::

:::qa High latency but low CPU: what do you suspect and how do you confirm it?
Thread-pool starvation from blocking calls (sync-over-async, sync I/O), or waiting on slow dependencies, locks or connection pools. Confirm with dotnet-counters (growing thread pool queue length and thread count), a dump showing threads blocked in Wait/GetResult, and traces showing long dependency spans.
:::

:::qa What tools would you use to diagnose a production performance issue in a container?
Distributed traces and metrics (App Insights / OpenTelemetry) first, then dotnet-counters for runtime health, dotnet-trace for CPU/allocation/contention profiles, dotnet-dump for hangs and leaks, typically via dotnet-monitor as a sidecar or kubectl debug with an ephemeral container, plus database execution plans and Query Store.
:::

:::qa Name high-impact optimisations for a typical CRUD API.
Fix indexes and N+1 queries, project to DTOs with AsNoTracking, paginate, cache hot reads (HybridCache, output caching), make everything async and parallelise independent remote calls, reuse HttpClient connections, compress and trim responses with System.Text.Json source generation, move slow work to background queues, and upgrade to the latest .NET.
:::

:::qa How do you improve cold-start time for a .NET service?
Native AOT (or ReadyToRun), the slim builder, trimming, source generators instead of reflection, EF compiled models, deferring heavy initialisation out of startup, pre-warming instances (Premium/Flex always-ready, readiness probes, slot warm-up), and smaller container images.
:::

## Further reading

- [.NET diagnostic tools overview](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/)
- [ASP.NET Core performance best practices](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/best-practices)
- [BenchmarkDotNet](https://benchmarkdotnet.org/)
- Stephen Toub, *Performance Improvements in .NET 8 / 9 / 10* (.NET Blog): enormous, invaluable.
- [Azure Load Testing](https://learn.microsoft.com/en-us/azure/load-testing/) · [k6 documentation](https://grafana.com/docs/k6/)
- Book: *Writing High-Performance .NET Code* (2nd ed.) by Ben Watson.

## Verify this chapter

Run with `dotnet run -c Release` (plain console app, .NET 8/9, no extra packages — `GC.GetAllocatedBytesForCurrentThread` and `Stopwatch`-free comparisons are enough to see the allocation difference this chapter talks about).

```csharp
using System.Globalization;

// 1) Percentiles vs averages: 98 fast requests + 2 slow ones.
var latenciesMs = new List<double>();
for (int i = 0; i < 98; i++) latenciesMs.Add(50);
latenciesMs.Add(5000);
latenciesMs.Add(5000);
latenciesMs.Sort();
double average = latenciesMs.Average();
double p99 = latenciesMs[(int)Math.Ceiling(0.99 * latenciesMs.Count) - 1];
if (!(average is > 140 and < 160)) throw new Exception($"FAIL: expected average ~148ms, got {average}");
if (p99 != 5000) throw new Exception($"FAIL: expected p99 = 5000ms, got {p99}");
Console.WriteLine($"OK: average={average:F1}ms looks tolerable, but p99={p99}ms reveals the real tail latency averages hide.");

// 2) Little's Law: concurrency = throughput (req/s) x latency (s)
double throughputRps = 500;
double latencySeconds = 0.2;
double concurrency = throughputRps * latencySeconds;
if (concurrency != 100) throw new Exception($"FAIL: expected concurrency=100, got {concurrency}");
Console.WriteLine($"OK: Little's Law — {throughputRps} RPS x {latencySeconds}s latency = {concurrency} concurrent requests in flight.");

// 3) Span-based slicing avoids the allocation that string.Split causes.
const string line = "2026-10-27;KB-01;3;49.90";

long before = GC.GetAllocatedBytesForCurrentThread();
decimal viaSplit = decimal.Parse(line.Split(';')[3], CultureInfo.InvariantCulture);
long splitAllocated = GC.GetAllocatedBytesForCurrentThread() - before;

before = GC.GetAllocatedBytesForCurrentThread();
ReadOnlySpan<char> s = line;
decimal viaSpan = decimal.Parse(s[(s.LastIndexOf(';') + 1)..], CultureInfo.InvariantCulture);
long spanAllocated = GC.GetAllocatedBytesForCurrentThread() - before;

if (viaSplit != viaSpan) throw new Exception("FAIL: Split and Span parsing disagree on the value");
if (!(splitAllocated > spanAllocated)) throw new Exception($"FAIL: expected Split ({splitAllocated}B) to allocate more than Span ({spanAllocated}B)");
Console.WriteLine($"OK: string.Split allocated {splitAllocated}B (the intermediate array), Span-based slicing allocated {spanAllocated}B — confirms the chapter's allocation claim, though exact byte counts vary by runtime/JIT.");

// Claims NOT verified here (they need an external profiler/benchmark harness, not a plain console check):
// - BenchmarkDotNet's own warm-up/statistics methodology and exact ns timings — see Further reading: https://benchmarkdotnet.org/
// - dotnet-counters/dotnet-trace/dotnet-dump behavior on a live process — see Further reading: https://learn.microsoft.com/en-us/dotnet/core/diagnostics/
// - Native AOT's ~10x startup improvement and k6/load-testing throughput numbers — environment-dependent; see the Further reading links above.
Console.WriteLine("All runtime-checkable claims verified.");
```
