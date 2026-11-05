---
id: advanced-csharp-pool
title: "Borrow, Don't Buy: ArrayPool<T>"
summary: "01:40: the import reads the file in 1 MB chunks, and a fresh 1 MB array for every chunk floods the Large Object Heap. ArrayPool<T> lends out a shelf of reusable arrays instead of allocating new ones. Second of eight chapters on advanced C#."
layer: language
where: C# language › Advanced & low-level features › Memory
fits: Builds on [spans](ch:advanced-csharp-span) and the Large Object Heap from [Memory & GC](ch:memory-gc#the-large-object-heap-and-the-pinned-object-heap). The pooled-buffer pattern here is the same one System.IO.Pipelines and Kestrel are built on.
levels: i
prereqs: advanced-csharp-span
next: advanced-csharp-ref
---

:::plain
Instead of creating a big new buffer every time you need one, borrow one from a shared pool and give it back when you're done.
:::

The import reads the file in 1 MB chunks, and every chunk allocates a fresh 1 MB array. Anything of 85 KB or more goes on the **Large Object Heap**, which is only cleaned by an expensive full GC ([Memory & GC](ch:memory-gc#the-large-object-heap-and-the-pinned-object-heap)). So the import keeps triggering the most expensive kind of garbage collection there is.

**The lightbulb:** the import only ever needs a few buffers *at once*, so keep a shelf of them and reuse them. That shelf is **`ArrayPool<T>.Shared`**. You **rent** an array, use it, and **return** it.

:::scene visuals/scenes/adv-pool.svg | Rent, use, return
1. **Before:** a new 1 MB array for every chunk. They pile up on the Large Object Heap until an expensive full GC clears them.
2. **`ArrayPool<byte>.Shared`** is a shelf of reusable arrays, shared by the whole app.
3. **`Rent`** borrows one for this chunk.
4. **`Return`** it in a `finally`, so it's returned even if processing throws. The next chunk rents the **same** array, so there's no new allocation.
5. Two rules. `Rent` may give you a **bigger** array than you asked for, so use only the length you requested. And after `Return`, the array **belongs to someone else**, so never touch it again.
:::

:::walk Rent, use, give back
```csharp
using System.Buffers;

var pool = ArrayPool<byte>.Shared;
byte[]? first = null;
for (int chunk = 1; chunk <= 3; chunk++)
{
    byte[] buffer = pool.Rent(100_000);              // may be bigger than requested
    try
    {
        var usable = buffer.AsSpan(0, 100_000);      // only use what you asked for
        usable.Fill((byte)chunk);
        first ??= buffer;
        Console.WriteLine($"chunk {chunk}: rented {buffer.Length:N0} bytes, same array as chunk 1? {ReferenceEquals(buffer, first)}");
    }
    finally
    {
        pool.Return(buffer);                         // give it back, even on errors
    }
}
```
@3-4 | pool = the shared shelf of arrays ; first = null
The pool is shared by the whole app.
@7 | chunk = 1 ; buffer = → array A (131,072 bytes)
Rent a buffer of at least 100,000 bytes. The pool hands out arrays in fixed sizes, so you get **131,072** (2¹⁷). That's why you must only use the part you asked for.
@10-11 | chunk = 1 ; buffer = → array A ; usable = window over A[0..100,000]
A span limits the code to the 100,000 bytes we asked for.
@12-13 | first = → array A | > chunk 1: rented 131,072 bytes, same array as chunk 1? True
@17 | chunk = 1 ; buffer = → array A (back on the shelf)
`Return` in a `finally`, so the array goes back even if processing throws. From now on, array A belongs to the pool, not to us.
@7 | chunk = 2 ; buffer = → array A (131,072 bytes)
The next chunk rents again, and gets **the same array** back.
@13 | | > chunk 2: rented 131,072 bytes, same array as chunk 1? True
@5-18 | chunk = 3 ; buffer = → array A | > chunk 3: rented 131,072 bytes, same array as chunk 1? True
Three chunks, one array. For the real import, that's thousands of 1 MB chunks and no new large arrays at all, so the expensive full GCs stop.
:::

Related tools: `ObjectPool<T>` (often used to pool `StringBuilder`s), `RecyclableMemoryStream`, `IBufferWriter<T>`, and **System.IO.Pipelines**, the pooled-buffer machinery Kestrel is built on.

## Start from zero: why reuse beats "new"

Creating an array is cheap: the runtime bumps a pointer and zeroes the memory. The expensive part comes later, when the GC has to find out the array is no longer used and reclaim it. For small, short-lived objects that's still cheap, because they die in Gen 0 ([Memory & GC](ch:memory-gc#generations-why-the-gc-doesnt-scan-everything-every-time)). For big arrays it isn't: anything of 85,000 bytes or more goes straight to the Large Object Heap, and only a full, expensive collection cleans that.

A pool turns "allocate, use, throw away" into "borrow, use, give back". The same few arrays get used again and again, so the GC has nothing new to clean up.

## ArrayPool in depth {a}

**How the shared pool is organised.** `ArrayPool<T>.Shared` keeps arrays in **buckets by size**, in powers of two (16, 32, 64 … elements). Asking for 100,000 bytes rounds up to the next bucket, 131,072, which is why the walk above got a bigger array than it asked for. To keep `Rent` and `Return` fast when many threads use the pool at once, each thread keeps a small cache of its own, backed by per-processor stores. Most calls never touch a lock. Very large requests, past the pool's upper size limit, aren't pooled: `Rent` simply allocates and `Return` drops the array.

**The mistakes, from worst to mildest:**

| Mistake | What happens |
|---|---|
| **Using an array after returning it** | Another request rents the same array and writes into it. Both requests now share one buffer and corrupt each other's data, only under load, never in a unit test. This is the worst pooling bug there is. |
| **Returning the same array twice** | Two later renters receive the same array, with the same corruption as above. |
| **Trusting `buffer.Length`** | Code that loops to `buffer.Length` processes leftover bytes from whoever used the array before. Always carry the length you asked for, or slice a span to it. |
| **Pooling sensitive data** | The next renter can read the previous contents. Use `Return(buffer, clearArray: true)` for passwords, tokens and personal data. |
| **Forgetting to return** | Not a memory leak: the GC eventually collects the array. You simply lose the reuse, so the pool allocates new arrays as if it weren't there. |

**When not to pool.** Pooling makes objects long-lived. A pooled array survives many collections and ends up in Gen 2, and the pool's own bookkeeping costs something. For small buffers used briefly, a plain `new` is often faster. Pool large buffers, and buffers on paths you've **measured** as hot.

**Other pools:**

- **`ArrayPool<T>.Create(maxArrayLength, maxArraysPerBucket)`** builds a private pool, so one component's usage pattern doesn't affect anyone else's.
- **`MemoryPool<T>`** hands out `IMemoryOwner<T>` buffers for async code, where ownership is clearer with `using`.
- **`ObjectPool<T>`** (`Microsoft.Extensions.ObjectPool`) pools whole objects. `CreateStringBuilderPool()` is the common case; the pool's policy resets each builder on return.

:::qa What is ArrayPool and when would you use it?
A pool of reusable arrays (`ArrayPool<T>.Shared`), organised in power-of-two size buckets with per-thread caches. Rent large temporary buffers instead of allocating them for every operation, which avoids Large Object Heap allocations and the full GCs that clean them up, and return them in a `finally` block. `Rent` may return a larger array than you asked for, so track the length you need.
:::

:::qa Follow-up: what can go wrong with pooled buffers?
Using an array after returning it, or returning it twice, lets two operations share one buffer and silently corrupt each other's data under load. Looping to `buffer.Length` reads stale bytes from the previous user. Sensitive data leaks to the next renter unless you return with `clearArray: true`. Forgetting to return is the mildest failure: the GC collects the array and you just lose the reuse.
:::

## Verify this chapter

```csharp
using System.Buffers;

var buf = ArrayPool<byte>.Shared.Rent(1000);
Check(buf.Length >= 1000, "Rent returns at least the requested size");
ArrayPool<byte>.Shared.Return(buf);

static void Check(bool ok, string claim) =>
    Console.WriteLine(ok ? $"OK: {claim}" : throw new Exception($"FAIL: {claim}"));
```
