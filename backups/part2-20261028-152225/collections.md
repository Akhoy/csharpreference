---
id: collections
title: Collections and Data Structures
summary: Choosing the right container. Arrays, List, Dictionary, HashSet, queues, stacks, sorted and linked collections, their Big-O costs and internals, the interface hierarchy, plus concurrent, immutable and frozen collections.
layer: language
where: C# language › Base Class Library › Collections
fits: These types live in the BCL (layer 2) but you use them as part of the language every day. They are the data structures underneath LINQ ([LINQ](ch:linq)), caches ([Caching](ch:caching-ratelimit-cors)) and almost every algorithm question in interviews.
levels: b,i,a
prereqs: generics
next: linq, threading-concurrency
---

## TL;DR

- Each collection type trades away some capability for speed at one specific job — know what you need before picking one.
- `List<T>` = growable array, O(1) add on average but O(n) occasionally when it resizes ("amortised O(1)"). `Dictionary<K,V>`/`HashSet<T>` = O(1) average lookup via hashing, as long as `GetHashCode` spreads values out well.
- The biggest easy win: replace `list.Contains(x)` inside a loop with a `HashSet<T>` lookup — turns an O(n·m) scan into O(n+m).
- `IReadOnlyList<T>` only stops *you* from mutating through that reference; `ImmutableList<T>`/`FrozenDictionary<K,V>` mean nobody, ever, can change it.
- Plain collections aren't thread-safe for writes — use `ConcurrentDictionary<K,V>`, `Channel<T>`, etc. across threads, and prefer their atomic methods (`GetOrAdd`) over check-then-act.

## Why there isn't just one "list" type {b}

C# gives you a genuinely large number of collection types, and the reason isn't accidental sprawl — each one trades away some capability in exchange for being dramatically faster at one specific job. This chapter's real goal is to let you look at a problem ("I need to check membership a million times a second", "I need to always grab the smallest item") and immediately know which structure was built for exactly that.

Before the specific types, though, there's a layer of interfaces worth understanding, because it quietly shapes how you should design your own method signatures too.

## The interface hierarchy: each rung promises one more capability {b}

```text
IEnumerable<T>            foreach only (GetEnumerator)
 ├─ IReadOnlyCollection<T>   + Count
 │   ├─ IReadOnlyList<T>        + this[int] (read)
 │   ├─ IReadOnlySet<T>         + Contains, set comparisons
 │   └─ IReadOnlyDictionary<K,V>+ TryGetValue, Keys, Values
 └─ ICollection<T>           + Count, Add, Remove, Clear, Contains
     ├─ IList<T>                + this[int] get/set, Insert, RemoveAt, IndexOf
     ├─ ISet<T>                 + UnionWith, IntersectWith…
     └─ IDictionary<K,V>        + this[key], Add(key, value), TryGetValue
```

Read this ladder as a series of promises, each one stacking on the last: `IEnumerable<T>` promises nothing but "you can walk through me once, in order." `IReadOnlyCollection<T>` adds "and I know how many items I have." `IReadOnlyList<T>` adds "and you can jump straight to any index." Every rung up the ladder is a *stronger* promise — which means every rung up is also a *narrower* set of types willing to make that promise.

That asymmetry is exactly where the design rule comes from: **accept the least capable interface you actually need; return the most useful honest type you actually have.**

```csharp
public decimal Total(IEnumerable<OrderLine> lines) => lines.Sum(l => l.Price * l.Qty);  // only iterates
public IReadOnlyList<Order> GetRecent() => _orders.Take(10).ToList();                    // caller can index and count but not mutate
```

`Total` only ever walks `lines` once, so it asks for nothing more than `IEnumerable<T>` — which means it can accept a `List<OrderLine>`, an array, a LINQ query, *anything* enumerable, without forcing the caller to materialise something more specific first. `GetRecent`, on the return side, genuinely does have a concrete, indexable, countable list sitting behind it — so returning `IReadOnlyList<Order>` honestly advertises that capability to the caller, while still refusing to promise mutation the caller has no business doing.

:::gotcha An IEnumerable<T> parameter can quietly run twice
If a method takes `IEnumerable<T>` and loops over it twice — or calls `Count()` and *then* `foreach`s it — remember from [LINQ](ch:linq#deferred-vs-immediate-execution-the-one-idea-that-explains-m) that a lazy source doesn't hold a snapshot of results; it re-executes from scratch every single time it's enumerated. If that source is a database query, "loop over it twice" silently means "hit the database twice." Either materialise once (`var list = items.ToList();`) before touching it more than once, or accept `IReadOnlyCollection<T>` in your signature specifically when you need the count — which forces the caller to have already materialised it.
:::

## The core collections, and exactly what each one costs {b}

| Type | Structure | Index | Search | Add | Insert/Remove middle | Ordered? | Use for |
|---|---|---|---|---|---|---|---|
| `T[]` | Contiguous block | O(1) | O(n) | — (fixed size) | — | Insertion | Fixed-size data, max performance |
| `List<T>` | Growable array | O(1) | O(n) | **O(1) amortised** | O(n) | Insertion | Default list |
| `Dictionary<K,V>` | Hash table | — | **O(1)** by key | O(1) | O(1) remove | **Not guaranteed** | Lookup by key |
| `HashSet<T>` | Hash table (keys only) | — | **O(1)** contains | O(1) | O(1) remove | No | Uniqueness, membership |
| `SortedDictionary<K,V>` | Red-black tree | — | O(log n) | O(log n) | O(log n) | By key | Sorted iteration with frequent inserts |
| `SortedList<K,V>` | Sorted arrays | O(1) by index | O(log n) | O(n) | O(n) | By key | Sorted, mostly read, low memory |
| `SortedSet<T>` | Red-black tree | — | O(log n) | O(log n) | O(log n) | Sorted | Sorted unique values, ranges (`GetViewBetween`) |
| `Queue<T>` | Circular array | — | — | O(1) enqueue/dequeue | — | FIFO | Work queues, BFS |
| `Stack<T>` | Array | — | — | O(1) push/pop | — | LIFO | Undo, DFS, parsing |
| `PriorityQueue<T,P>` (.NET 6) | Binary heap | — | — | O(log n) | O(log n) dequeue | By priority | Scheduling, Dijkstra, top-k |
| `LinkedList<T>` | Doubly linked | O(n) | O(n) | O(1) at ends | **O(1) given a node** | Insertion | Rare; LRU caches with a dictionary |

:::tip The single highest-leverage fix in this whole table
`list.Contains(x)` inside a loop over another list is **O(n·m)** — for every item in the outer list, you scan the *entire* inner list looking for a match. Converting just the lookup list to a `HashSet<T>` turns that `Contains` call from a full scan into an O(1) average-case lookup, dropping the whole thing to **O(n+m)**. On a list of any real size, that's the difference between milliseconds and minutes. Interviewers ask about this specifically because it's such a common, easy-to-miss win in real code:

```csharp
var blocked = new HashSet<string>(blockedEmails, StringComparer.OrdinalIgnoreCase);
var allowed = users.Where(u => !blocked.Contains(u.Email)).ToList();
```
:::

## List<T> internals: what "amortised O(1)" actually means {i}

The table above calls `List<T>.Add` "O(1) amortised" rather than plain O(1), and that qualifier is worth unpacking rather than skipping past, because it explains a real, controllable cost.

Underneath, a `List<T>` is just an array (`_items`) plus a count (`_size`), with the array deliberately allocated a bit bigger than it currently needs to be. Most calls to `Add` are genuinely O(1): there's spare room in the array, so the new item just goes in the next free slot. But once that spare room runs out, `Add` has to **allocate a brand-new array at double the previous capacity, and copy every single existing element across** before it can add the new one — an O(n) operation, just for that one call.

"Amortised O(1)" is the honest way to describe what happens if you average that occasional expensive copy across *all* the calls leading up to it: because the array doubles each time, the expensive copies become exponentially rarer as the list grows, and the total cost of all the copying, spread evenly across every `Add` call ever made, works out to a constant amount per call. It's not that every call is cheap — it's that the expensive ones are rare enough, and the doubling strategy specifically guarantees rare enough, that the *average* stays constant.

```csharp
var list = new List<Order>(capacity: 10_000);   // pre-size when you know the count: avoids ~14 resize-copies
```

If you already know roughly how many items you're about to add, pre-sizing the list avoids paying for those resize-copies at all — each doubling from a default starting capacity up to 10,000 would otherwise cost you roughly 14 separate full-array copies along the way.

A couple of related facts worth having at hand: `Capacity` is always `≥ Count` (the array is at least as big as what's actually stored in it), and `TrimExcess()` shrinks the backing array back down if you've over-allocated. `Insert(0, x)` and `RemoveAt(0)` are each O(n), for a reason worth seeing clearly: inserting or removing at the front means every single element after that position has to physically shift over by one slot — there's no way around it for an array-backed structure. If you genuinely need fast operations at the front, that's precisely the signal to reach for `Queue<T>` instead. And `CollectionsMarshal.AsSpan(list)` gives you a zero-copy `Span<T>` view directly over the internal array, for hot loops — just don't add or remove from the list while you're holding that span, since a resize would invalidate it out from under you.

## Dictionary<K,V>: what's actually happening inside a hash lookup {i}

`Dictionary<K,V>` promises O(1) lookups — but *why* does hashing make that possible, when a list-based search is fundamentally O(n)? Walk through exactly what happens when you look up a key, step by step:

1. Compute `key.GetHashCode()` — a number, derived from the key's contents.
2. Map that hash to a **bucket** index: roughly `hash % buckets.Length`.
3. Walk that one bucket's short chain of entries, comparing each against your key with `Equals`, until you find a match (or run out).

The entire speed advantage over a list lives in step 2: instead of checking every single entry in the whole dictionary, you jump straight to one small bucket and only ever compare against the handful of entries that happen to share that bucket. **Good hash distribution** — hash codes spread evenly across the available buckets — keeps each bucket's chain short, which is what keeps step 3 fast. A genuinely terrible `GetHashCode` implementation (one that, say, always returns `1`) would funnel every single entry into the *same* bucket, and step 3 would degrade into exactly the O(n) linear scan you were trying to avoid in the first place — hashing only helps if the hash function actually spreads things out.

```csharp
var stock = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)
{
    ["KB-01"] = 12,
    ["MS-02"] = 0
};

if (stock.TryGetValue("kb-01", out var qty)) { /* one lookup instead of ContainsKey + indexer */ }
stock["NEW"] = 5;                         // add or overwrite
stock.Add("KB-01", 1);                    // throws ArgumentException: duplicate key
ref var slot = ref CollectionsMarshal.GetValueRefOrAddDefault(stock, "KB-01", out _);
slot++;                                   // update in place with a single hash lookup (perf trick)
```

Notice the comment on `TryGetValue`: calling `ContainsKey` followed by the indexer does the *entire* three-step lookup above **twice** — once to check existence, once to actually fetch the value. `TryGetValue` does the whole walk exactly once and hands you both pieces of information (found or not, and the value if so) from that single pass.

Given how central `Equals`/`GetHashCode` are to steps 2 and 3, the requirements for a usable key follow directly: **`Equals` and `GetHashCode` must agree with each other**, and — critically — **must not change** while the object is sitting inside the dictionary, because the bucket it was placed in was chosen based on its hash code *at insertion time*; if that hash code changes afterward, the dictionary will keep looking for it in the wrong bucket forever. This is exactly the mutable-hash-key trap from [Type system](ch:type-system#equality-three-different-questions-similar-syntax), showing up again here with real consequences. Stick to immutable keys — strings, numbers, records, IDs — and the problem can't arise.

:::gotcha Dictionary iteration order is an implementation detail, not a contract
A `Dictionary` usually *happens* to iterate in insertion order — right up until you remove an item, at which point the freed slot gets reused by a later insertion, and the order you observe can shift in ways that have nothing to do with when anything was actually added. Never write code that depends on this ordering; it isn't part of the type's actual contract, only an accident of the current implementation. If you genuinely need order, reach for `SortedDictionary`, the newer generic `OrderedDictionary<K,V>` (.NET 9), or sort explicitly at the point you need it.
:::

## Choosing a collection: a decision guide {b}

```text
Need lookup by key?                 → Dictionary<K,V>   (sorted keys → SortedDictionary)
Need "have I seen this?"            → HashSet<T>
Need ordered list, index access?    → List<T>           (fixed size & hot path → T[])
Need first-in-first-out?            → Queue<T>          (multi-threaded → Channel<T> / ConcurrentQueue<T>)
Need last-in-first-out?             → Stack<T>
Need "always take the smallest"?    → PriorityQueue<T,P>
Shared across threads?              → Concurrent* (or lock around a normal one)
Built once, read millions of times? → FrozenDictionary / FrozenSet
Must never change after creation?   → Immutable* (or IReadOnly* views)
Exposing from a class?              → IReadOnlyList<T> / IReadOnlyDictionary<K,V>
```

## Read-only, immutable and frozen: three guarantees people conflate {i}

These three sound like synonyms and genuinely aren't — each one makes a different, specific promise, and mixing them up leads to code that's less safe than it looks:

| | Can the holder modify it? | Can *anyone* modify it? | Cost |
|---|---|---|---|
| `IReadOnlyList<T>` (interface) | No (via that reference) | **Yes**: the underlying `List` can still change | Free (it's a view) |
| `ReadOnlyCollection<T>` (`list.AsReadOnly()`) | No | Yes, the wrapped list can still change | A thin wrapper |
| `ImmutableList<T>`, `ImmutableDictionary<K,V>` | No; "mutations" return a new collection, sharing structure | **No**, never | Tree-based: slower reads, efficient copies |
| `ImmutableArray<T>` | No | No | Array-backed: fast reads, full copy on change |
| `FrozenDictionary<K,V>` / `FrozenSet<T>` (.NET 8) | No | No | Expensive to create, **fastest possible reads** |

The distinction worth really sitting with is between the first two rows and the last three. `IReadOnlyList<T>` and `ReadOnlyCollection<T>` only ever restrict what *you* can do *through that particular reference* — somebody else, holding the original mutable `List<T>` the view was built from, can still change it out from under you, and you'd see that change the next time you read through your supposedly "read-only" view. `ImmutableList<T>`, `ImmutableArray<T>` and `FrozenDictionary<K,V>` make a fundamentally stronger promise: the data genuinely cannot change, by anyone, ever, after creation — full stop. That's why `FrozenDictionary` specifically exists: it accepts an expensive, slower *build* step in exchange for the fastest possible *reads* afterward, which is exactly the right trade for something built once at startup and then read on every single request for the rest of the process's life:

```csharp
// Built once at startup, read on every request
private static readonly FrozenDictionary<string, decimal> TaxRates =
    new Dictionary<string, decimal> { ["DE"] = 0.19m, ["FR"] = 0.20m, ["NL"] = 0.21m }
        .ToFrozenDictionary(StringComparer.OrdinalIgnoreCase);
```

## Concurrent collections: for when more than one thread touches the same collection {i}

Here's a fact worth stating plainly, because it surprises people who assume "it's a BCL type, it must be safe": ordinary collections are **not thread-safe for writes**. Two threads calling `Add` on the same plain `Dictionary` at the same moment can genuinely corrupt its internal structure — historically, this specific race has even caused infinite loops inside the dictionary's own bucket-chasing logic. For state shared across threads — singletons, background workers — reach for the collections built specifically to handle this:

| Type | Use |
|---|---|
| `ConcurrentDictionary<K,V>` | Thread-safe map; `GetOrAdd`, `AddOrUpdate`, `TryRemove` |
| `ConcurrentQueue<T>` / `ConcurrentStack<T>` | Lock-free FIFO/LIFO |
| `ConcurrentBag<T>` | Unordered; optimised for the same thread adding and taking |
| `BlockingCollection<T>` | Bounded producer/consumer with blocking (older; prefer `Channel<T>`) |
| `Channel<T>` (System.Threading.Channels) | **Async** producer/consumer queue; the modern choice |

```csharp
private readonly ConcurrentDictionary<string, Lazy<Task<Config>>> _cache = new();

public Task<Config> GetAsync(string tenant) =>
    _cache.GetOrAdd(tenant, t => new Lazy<Task<Config>>(() => LoadConfigAsync(t))).Value;
    // Lazy ensures the loader runs once even if two threads race into GetOrAdd
```

:::gotcha Thread-safe methods don't make compound operations thread-safe
`if (!dict.ContainsKey(k)) dict[k] = v;` is exactly the check-then-act race condition from [Threading & concurrency](ch:threading-concurrency#race-conditions-when-it-depends-on-timing-becomes-a-bug) — two separate operations, with a window between them for another thread to slip in, even though `ContainsKey` and the indexer are each individually safe to call. Use the genuinely atomic combined operations instead — `GetOrAdd`/`TryAdd`/`AddOrUpdate` — which perform the whole check-and-act as one indivisible step. One more sharp edge specific to `GetOrAdd`: under contention, its value factory **may run more than once**, even though only one of those results ever actually gets stored — which is exactly why the example above wraps the expensive load in `Lazy<T>` rather than calling `LoadConfigAsync` directly inside the factory.
:::

## Arrays, spans and collection expressions {i}

```csharp
int[] a = [1, 2, 3];                       // C# 12 collection expression
List<string> names = ["ana", "bo"];
int[] combined = [..a, 4, 5];              // spread operator
Span<int> slice = a.AsSpan(1, 2);          // view of {2, 3}, no copy
int last = a[^1];                          // index from end: 3
int[] middle = a[1..^1];                   // range: creates a NEW array {2}
int[,] grid = new int[3, 3];               // multi-dimensional (rectangular)
int[][] jagged = [[1], [2, 3]];            // array of arrays
```

Two of those lines look similar but behave completely differently, and it's worth being precise about which: `a.AsSpan(1, 2)` is a genuine zero-copy **view** into the original array — mutate through the span and you mutate `a` itself. `a[1..^1]`, the range syntax, instead **allocates and returns a brand-new array** containing copies of the selected elements — it looks like slicing syntax, but it isn't a view at all.

A few more facts worth having on hand: arrays are **reference types** with a genuinely **fixed length** — you can't resize one, only replace it with a different, differently-sized array. Array covariance (an `object[]` variable pointing at a real `string[]`) is permitted but unsafe for exactly the reason covered in [Generics](ch:generics#variance-when-is-listcat-actually-a-listanimal): `object[] o = new string[1]; o[0] = 1;` compiles, but throws `ArrayTypeMismatchException` at runtime, because arrays trade compile-time safety for a runtime check here. And `Array.Empty<T>()` (or the `[]` collection expression) gives you a cached, shared empty array at zero allocation cost — a genuinely good reason to never return `null` where an empty collection would do: callers can safely `foreach` over an empty collection with no special-case null check, but a `null` forces one everywhere it might appear.

## Equality comparers and custom ordering {a}

Hash-based and sorted collections both let you plug in your own comparison logic, rather than relying on a type's default `Equals`/`GetHashCode` or `CompareTo`:

```csharp
var byEmail = new HashSet<Customer>(EqualityComparer<Customer>.Create(
    (a, b) => string.Equals(a?.Email, b?.Email, StringComparison.OrdinalIgnoreCase),
    c => StringComparer.OrdinalIgnoreCase.GetHashCode(c.Email)));       // .NET 8 helper

var byPriceThenName = Comparer<Product>.Create((x, y) =>
    x.Price != y.Price ? x.Price.CompareTo(y.Price) : string.CompareOrdinal(x.Name, y.Name));
var sorted = new SortedSet<Product>(products, byPriceThenName);
```

This matters specifically when a type's *default* notion of equality or ordering doesn't match what a particular collection actually needs — `Customer` might not override `Equals` at all, but you can still build a `HashSet<Customer>` that treats two customers as the same whenever their emails match, without touching the `Customer` class itself.

:::qa What is the time complexity of List.Add, Dictionary lookup and HashSet.Contains?
List.Add is O(1) amortised: occasionally O(n) when the backing array doubles and is copied. Dictionary lookup and HashSet.Contains are O(1) on average, assuming a good hash function; worst case O(n) when many keys collide.
:::

:::qa How does a Dictionary work internally?
It hashes the key with GetHashCode, maps the hash to a bucket index, and walks that bucket's chain of entries, comparing with Equals. It resizes (to a larger prime-sized capacity) as it grows. That's why keys need consistent Equals/GetHashCode and must not mutate.
:::

:::qa IEnumerable vs ICollection vs IList?
IEnumerable only supports iteration. ICollection adds Count, Add, Remove, Contains. IList adds index-based access, Insert and RemoveAt. Accept the least capable interface a method needs.
:::

:::qa What's the difference between IReadOnlyList, ReadOnlyCollection and ImmutableList?
IReadOnlyList is an interface: a read-only view, but the underlying list may still change. ReadOnlyCollection is a wrapper that prevents changes through it, while the wrapped list can still change. ImmutableList can never change; modifications return a new list that shares structure with the old one.
:::

:::qa When would you use FrozenDictionary?
For lookup tables built once (often at startup) and read very frequently, such as config maps, routing tables or tax rates. Creation is slower because it analyses the keys to pick the optimal layout, but reads are faster than Dictionary.
:::

:::qa How do you make a Dictionary thread-safe?
Use ConcurrentDictionary with its atomic methods (GetOrAdd, AddOrUpdate, TryRemove), or protect a normal Dictionary with a lock. For read-mostly data, swap an immutable/frozen dictionary reference atomically.
:::

:::qa Is ConcurrentDictionary.GetOrAdd's factory guaranteed to run once?
No. Under contention it can run more than once (only one result is stored). Wrap the value in Lazy&lt;T&gt; if the factory is expensive or has side effects.
:::

:::qa How would you remove duplicates from a list efficiently?
`list.Distinct()` or `new HashSet<T>(list)` (O(n)), with a custom IEqualityComparer if needed, or `DistinctBy(x => x.Key)` (.NET 6) to dedupe by a property.
:::

## Further reading

- [Collections and data structures](https://learn.microsoft.com/en-us/dotnet/standard/collections/)
- [Thread-safe collections](https://learn.microsoft.com/en-us/dotnet/standard/collections/thread-safe/)
- [System.Collections.Frozen](https://learn.microsoft.com/en-us/dotnet/api/system.collections.frozen)

## Verify this chapter

Run with `dotnet run` (plain console app, .NET 8/9, no packages). It checks the concrete, checkable claims: `Dictionary`/`HashSet` are O(1)-average vs. list `Contains` being O(n), `TryGetValue` finding what `ContainsKey` found, `ConcurrentDictionary.GetOrAdd`'s factory possibly running more than once under contention, and `AsSpan` being a view while range slicing `[..]` copies.

```csharp
using System.Diagnostics;
using System.Collections.Concurrent;

// --- HashSet/Dictionary lookup is dramatically faster than List.Contains at scale ---
var n = 200_000;
var list = Enumerable.Range(0, n).ToList();
var set = new HashSet<int>(list);
var target = n - 1; // worst case for a linear scan: the last element

var swList = Stopwatch.StartNew();
for (int i = 0; i < 50; i++) list.Contains(target);
swList.Stop();

var swSet = Stopwatch.StartNew();
for (int i = 0; i < 50; i++) set.Contains(target);
swSet.Stop();

if (swSet.Elapsed >= swList.Elapsed) throw new Exception("FAIL: HashSet.Contains should be far faster than List.Contains here");
Console.WriteLine($"OK: HashSet.Contains ({swSet.ElapsedMilliseconds} ms) was faster than List.Contains ({swList.ElapsedMilliseconds} ms) for {50} lookups over {n} items");

// --- TryGetValue finds exactly what ContainsKey says is there, in one pass ---
var stock = new Dictionary<string, int> { ["KB-01"] = 12 };
if (!stock.ContainsKey("KB-01") || !stock.TryGetValue("KB-01", out var qty) || qty != 12)
    throw new Exception("FAIL: TryGetValue should agree with ContainsKey");
Console.WriteLine("OK: TryGetValue retrieves the same value ContainsKey confirms exists, in a single lookup");

// --- Dictionary.Add throws on a duplicate key; the indexer overwrites instead ---
try { stock.Add("KB-01", 1); throw new Exception("FAIL: Add should throw on a duplicate key"); }
catch (ArgumentException) { Console.WriteLine("OK: Dictionary.Add throws ArgumentException on a duplicate key"); }
stock["KB-01"] = 1; // the indexer is fine with overwriting
if (stock["KB-01"] != 1) throw new Exception("FAIL: indexer assignment should overwrite");
Console.WriteLine("OK: the indexer overwrites an existing key instead of throwing");

// --- ConcurrentDictionary.GetOrAdd's factory can run more than once under contention ---
var factoryCalls = 0;
var cd = new ConcurrentDictionary<int, int>();
Parallel.For(0, 50, _ => cd.GetOrAdd(1, _ => { Interlocked.Increment(ref factoryCalls); return 42; }));
Console.WriteLine(factoryCalls > 1
    ? $"OK: GetOrAdd's factory ran {factoryCalls} times under contention, as the chapter warns (only one result is stored: {cd[1]})"
    : "OK: GetOrAdd's factory ran once this time (the race is possible, not guaranteed, on every run)");

// --- AsSpan is a view (mutating it mutates the array); range slicing [..] copies ---
int[] arr = [1, 2, 3, 4];
var span = arr.AsSpan(1, 2);
span[0] = 99;
if (arr[1] != 99) throw new Exception("FAIL: AsSpan should be a view over the original array");
Console.WriteLine("OK: Span<T> from AsSpan is a zero-copy view — writing through it changed the original array");

int[] middle = arr[1..^1];
middle[0] = -1;
if (arr[1] == -1) throw new Exception("FAIL: range slicing should allocate a new array, not share storage");
Console.WriteLine("OK: range slicing (arr[1..^1]) copies into a new array — changing it left the original untouched");

// Not runtime-verifiable here — see Further reading: Microsoft "Collections and data structures" docs
// (Big-O costs for SortedDictionary/PriorityQueue/LinkedList etc. are documented guarantees, not something
// worth timing in a short-running demo, since constant factors and JIT warm-up dominate at small n)
```
