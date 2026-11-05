---
id: async-valuetask
title: "ValueTask and Allocation-Free Completions"
summary: "Task<T> is a class, so every call allocates one, even when the answer was already known. ValueTask<T> is a struct that can carry an already-known answer with no allocation at all, which matters only in hot code. Fourth of five chapters on async/await."
layer: language
where: C# language › Asynchrony › ValueTask
fits: A direct application of the struct-vs-heap boxing rule from [the state machine chapter](ch:async-internals): ValueTask exists to skip the same kind of allocation on methods that usually complete synchronously.
levels: a
prereqs: async-internals
next: async-pitfalls
---

## Task vs ValueTask Allocation Behavior {a}

:::plain
Returning a `Task` always creates a small object, even when the answer is ready instantly. `ValueTask` can carry an instant answer with no object at all, which matters only in very hot code.
:::

`Task<T>` is a class, so each call allocates one. **`ValueTask<T>`** is a struct that can hold the result directly when it's already known, so it allocates nothing:

:::scene visuals/scenes/async-valuetask.svg | Task vs ValueTask on a cache hit
1. The price is already in the cache. Returning `Task<decimal>` still has to **create a Task object** on the heap to carry £6.50, on every call.
2. `ValueTask<decimal>` is a **struct**. When the answer is already known, it carries it directly, with no allocation.
3. When the price isn't cached, the `ValueTask` wraps a real `Task`, so nothing is lost. The rules: await it **exactly once**, never from two places (call `.AsTask()` if you need that), and use it only in hot methods that usually finish instantly.
:::

:::walk A cache hit with no Task allocated
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
@1 | catalogue = { TEA-01 → 6.50 }
A catalogue with one price cached.
@2 | first = ValueTask (already holding 6.50)
Ask for a price that's in the cache.
@10-11 | sku = "TEA-01" ; price = 6.50
Found it. `ValueTask.FromResult` wraps the answer **in the struct itself**. No `Task` object is created on the heap.
@3 | | > cache hit completed synchronously: True, £6.50
It's already finished. On a hot path called a million times, that's a million allocations saved.
@12 | -
On a cache miss, the `ValueTask` wraps a real `Task` instead, so it still works. It just isn't free.
:::

Use it only for **hot methods that usually finish immediately** (cache hits, buffered reads). Await it **exactly once**, never concurrently. If you need to store it or await it twice, call `.AsTask()`. Use `Task` everywhere else.

:::qa When would you use ValueTask instead of Task?
For hot-path methods that usually complete synchronously, such as cache hits or buffered I/O, to avoid allocating a Task. A ValueTask must be awaited only once and never concurrently. Convert it with `.AsTask()` if you need to. Default to Task.
:::

## Interviewer "why" deep-dives {a}

### "Why must a ValueTask be awaited exactly once?"

Unlike `Task`, which is a reference type that any number of callers can hold and await independently, a `ValueTask` may be backed by a pooled, reusable object implementing `IValueTaskSource` rather than a dedicated heap allocation. The runtime is allowed to recycle that backing object the moment the first `await` (or `.Result`) observes its result, so it can hand it to the next caller without allocating a new one. Awaiting the same `ValueTask` a second time, or from two places concurrently, can read a result that belongs to a completely different, later operation, because the slot it pointed to has already been reused. `Task` has no such rule, because a `Task` object is never pooled or reused underneath you. If more than one place in your code needs the result, call `.AsTask()` once and share that instead.

### "Isn't a struct always cheaper than a class? Why not use ValueTask everywhere?"

Because `ValueTask<T>` is larger than a plain `Task<T>` reference (it has to carry room for either the result or a reference to the backing task-or-source), and every time it's passed around, awaited indirectly, or stored in a field, it gets copied in full rather than passed as a single pointer. For code that suspends most of the time anyway, `Task<T>` is both simpler and no slower. ValueTask only wins on the specific shape of workload where the synchronous, no-allocation path is taken often enough to matter — caches, buffered readers, anything called in a hot loop.

## Summary {a}

`Task<T>` always allocates, even on a cache hit. `ValueTask<T>` is a struct that can carry an already-known result with zero heap allocation, at the cost of a stricter contract: await it exactly once, never concurrently, and convert to `.AsTask()` if you need to share or store it. Reach for it only on methods that are called often and usually complete synchronously; everywhere else, `Task` is simpler and just as fast in practice.

Next: [Diagnosing async failures](ch:async-pitfalls) covers what goes wrong when these rules are broken — deadlocks, thread-pool starvation, fire-and-forget tasks, and locking around `await`.

## Verify this chapter

```csharp
// ValueTask.FromResult carries its value directly: no Task object, already complete
var cached = ValueTask.FromResult(6.50m);
Check(cached.IsCompletedSuccessfully, "a ValueTask built from a known result is already complete");
Check(cached.Result == 6.50m, "the result is available immediately, with no await needed to observe it");

static void Check(bool ok, string claim) =>
    Console.WriteLine(ok ? $"OK: {claim}" : throw new Exception($"FAIL: {claim}"));
```
