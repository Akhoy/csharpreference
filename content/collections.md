---
id: collections
title: "Collections: Pick the Container That Fits the Question"
summary: "Episode 5. Kettle has 200,000 orders and finding one by ID is slow, because a List checks every item. A Dictionary jumps straight to it. Covers Big-O in plain words, List, Dictionary, HashSet, Queue, Stack and PriorityQueue, how List and Dictionary work inside, the collection interfaces, read-only vs immutable vs frozen, concurrent collections, and arrays and spans."
layer: language
where: C# language › Base Class Library › Collections
fits: These types live in the BCL (layer 2), but you use them every day as if they were part of the language. They're the data structures under LINQ ([LINQ](ch:linq)), caches ([Caching](ch:caching-ratelimit-cors)) and most algorithm interview questions.
levels: b,i,a
prereqs: generics
next: linq, threading-concurrency
---

## The 30-second version

- Each collection is built to answer **one kind of question fast**. Picking the right one matters more than any other optimisation.
- **Big-O** describes how the cost grows with the number of items, *n*. **O(1)** means the same speed at any size. **O(n)** means it checks every item.
- `List<T>`: an ordered list with fast access by position, but **searching is O(n)**. `Dictionary<K,V>`: **lookup by key in O(1)**. `HashSet<T>`: "have I seen this?" in O(1).
- A `Dictionary` works by turning the key into a number, its **hash code**, which picks a small **bucket** to look in. Keys need consistent `Equals`/`GetHashCode` and must never change.
- Accept the **least** capable interface you need (`IEnumerable<T>`), and return an honest read-only one (`IReadOnlyList<T>`).
- Ordinary collections aren't thread-safe. Use the `Concurrent*` types, or `Channel<T>`, when threads share data.

## Words you'll meet

| Word | In plain words |
|---|---|
| **Big-O** | A way to say how work grows as the data grows. |
| **O(1)** | "Constant": the same speed with 10 items or 10 million. |
| **O(n)** | "Linear": twice the items, twice the work, because it looks at each one. |
| **hash code** | A number worked out from a key. It says which bucket to look in. |
| **bucket** | One small shelf inside a `Dictionary` or `HashSet`. |
| **amortised** | "On average, over many calls", even if a few calls are slow. |
| **FIFO / LIFO** | First in, first out (a queue) / last in, first out (a stack). |
| **immutable** | Can never change. "Changes" return a new version. |
| **thread-safe** | Safe to use from several threads at the same moment. |

## Previously, and the problem {b}

In [Episode 4](ch:delegates-events) Kettle learned to swap discount rules and notify subscribers about every order. Business took off. There are 200,000 orders in memory, and the order-status page is slow:

```csharp
using System.Diagnostics;

var orders = new List<Order>();
for (int i = 0; i < 100_000; i++) orders.Add(new Order(i, 10m + i % 40));
var lookingFor = Enumerable.Range(99_900, 100).ToArray();   // 100 customers check their order

long checks = 0;
var sw = Stopwatch.StartNew();
foreach (var id in lookingFor)
    _ = orders.First(o => { checks++; return o.Id == id; });   // walks the list from the start
Console.WriteLine($"List:       {checks:N0} checks, {sw.ElapsedMilliseconds} ms");

var byId = orders.ToDictionary(o => o.Id);                     // same data, different container
sw.Restart();
foreach (var id in lookingFor) _ = byId[id];
Console.WriteLine($"Dictionary: ~{lookingFor.Length} lookups, {sw.ElapsedMilliseconds} ms");

record Order(int Id, decimal Total);
```

Run it. The `List` makes about **10 million** comparisons to find 100 orders, and the `Dictionary` takes almost no time. The data and the answers are the same. Only the container changed.

## The lightbulb: a container shaped like the question {b}

A `List` is a row of items in order. The only way to find "order #7319" in a row is to look at each item until you hit it. A `Dictionary` is built for exactly the question "give me the item with *this key*", so it can go straight there.

We describe that difference with **Big-O notation**. It says how the work grows as the number of items, *n*, grows. Scanning a list is **O(n)**: twice the orders, twice the work. A dictionary lookup is **O(1)**: the same work at 200 orders or 200 million. The trick that makes O(1) possible is called **hashing**. The key is turned into a number, its **hash code**, and that number tells the dictionary which small **bucket** to look in.

:::scene visuals/scenes/col-lookup.svg | Two ways to find order #7319
1. **List:** start at the first order. Is it #7319? No. Move on to the next.
2. Keep going, one by one. In the worst case that's **200,000 checks for one order**. That's O(n).
3. **Dictionary:** call `GetHashCode()` on the key 7319. The number it returns picks a **bucket**, here bucket 3 of 8.
4. Jump straight to bucket 3 and compare its one or two entries with `Equals`. Found. The size of the dictionary didn't matter. That's O(1).
5. The catch: if `GetHashCode` is bad (say it always returns 0), every key lands in one bucket and you're back to scanning, O(n). Good hashes spread keys out.
:::

How much does it matter? For *n* = 200,000:

| Big-O | In plain words | Checks for n = 200,000 | Example |
|---|---|---|---|
| **O(1)** | same at any size | ~1 | `dict[key]`, `set.Contains(x)`, `list[5]` |
| **O(log n)** | halves the problem each step | ~18 | `SortedDictionary` lookup, binary search |
| **O(n)** | looks at everything | 200,000 | `list.Contains(x)`, `list.First(…)` |
| **O(n²)** | everything × everything | 40,000,000,000 | `list.Contains` inside a loop over a list |

:::qa What is the time complexity of List.Add, Dictionary lookup and HashSet.Contains?
`List.Add` is amortised O(1), with an occasional O(n) resize. Dictionary lookup by key is O(1) on average, and only degrades to O(n) with a pathological hash function. `HashSet.Contains` is also O(1) on average. By contrast, `List.Contains` and `IndexOf` are O(n).
:::

## The everyday collections {b}

| Type | Answers fast | Slow at | Kettle uses it for |
|---|---|---|---|
| `List<T>` | "item at position *i*" O(1), add to the end | searching O(n), inserting at the front O(n) | lines in an order |
| `T[]` (array) | position *i*, with the least overhead | it can't grow | fixed-size buffers, hot loops |
| `Dictionary<K,V>` | "value for this key" O(1) | it has no order | orders by ID, stock by SKU |
| `HashSet<T>` | "is this in the set?" O(1), uniqueness | it has no order and no position | blocked emails, seen IDs |
| `Queue<T>` | first in, first out | the middle | orders waiting to be packed |
| `Stack<T>` | last in, first out | the middle | undo history |
| `PriorityQueue<T,P>` | "give me the most urgent one" O(log n) | finding a specific item | express orders first |
| `SortedDictionary<K,V>` | lookup **and** sorted order, O(log n) | slower than `Dictionary` | a price ladder |
| `LinkedList<T>` | insert or remove next to a node you hold, O(1) | everything else | rare (LRU caches) |

Three of those are about *order*, and they're easiest to see:

:::scene visuals/scenes/col-shapes.svg | Three ways to decide what comes out next
1. **`Queue<T>`** is first in, first out. `Dequeue()` gives the order that's been waiting longest, like a till queue.
2. **`Stack<T>`** is last in, first out. `Pop()` gives the newest item. That's exactly what "undo" needs: undo the last thing first.
3. **`PriorityQueue<T, P>`** gives the most *urgent* item, the one with the lowest priority number, whatever order they arrived in.
:::

```csharp
var packing = new Queue<string>();          // FIFO: fair order
packing.Enqueue("order 1"); packing.Enqueue("order 2");
Console.WriteLine($"pack next: {packing.Dequeue()}");          // order 1

var undo = new Stack<string>();             // LIFO: the most recent first
undo.Push("added Sencha"); undo.Push("removed Earl Grey");
Console.WriteLine($"undo: {undo.Pop()}");                      // removed Earl Grey

var dispatch = new PriorityQueue<string, int>();   // lowest priority number comes out first
dispatch.Enqueue("standard #3", 2);
dispatch.Enqueue("express #9", 1);
Console.WriteLine($"dispatch first: {dispatch.Dequeue()}");    // express #9
```

### The single best fix: `List.Contains` → `HashSet`

The most common slow code in real projects is a `Contains` on a list, inside a loop:

```csharp
var blockedList = Enumerable.Range(0, 2_000).Select(i => $"spam{i}@x.com").ToList();
var signups = Enumerable.Range(0, 2_000).Select(i => $"user{i}@kettle.shop").ToList();

long checks = 0;
var allowedSlow = signups.Where(s => blockedList.Any(b => { checks++; return b == s; })).Count();
Console.WriteLine($"List:    {checks:N0} comparisons");        // ~4,000,000: O(n × m)

var blocked = new HashSet<string>(blockedList, StringComparer.OrdinalIgnoreCase);
var allowedFast = signups.Count(s => !blocked.Contains(s));    // ~2,000 hash lookups: O(n + m)
Console.WriteLine($"HashSet: {signups.Count:N0} lookups, {allowedFast} allowed");
```

Turning the lookup list into a `HashSet` changes O(n×m) into O(n+m). Interviewers ask about this one because it's such an easy, common win.

:::qa How would you remove duplicates from a list efficiently?
Use a `HashSet<T>` (or LINQ `Distinct()`, which uses one internally). That's O(n) on average, compared with O(n²) for nested loops. Pass an `IEqualityComparer<T>` (or use `DistinctBy`) to control what counts as a duplicate, and use `StringComparer.OrdinalIgnoreCase` for case-insensitive strings.
:::

## Inside List: why Add is "amortised O(1)" {i}

:::plain
A `List` is an array with spare room at the end. When the room runs out, it moves everything into an array twice as big. That move is slow, but it happens so rarely that adding is still fast on average.
:::

:::scene visuals/scenes/col-resize.svg | What happens when a List fills up
1. Inside, a `List<int>` is an **array** plus a count. This one has 4 slots and 4 items. It's full, so `Add(5)` has nowhere to go.
2. So `Add` first **allocates a new array twice as big**, with 8 slots.
3. Then it **copies every item across** and puts 5 in. That single `Add` did O(n) work. The old array becomes garbage.
4. The next three `Add`s just drop into free slots, with no copying.
5. The 9th `Add` doubles the array again, to 16, then 32, then 64. The copies get rarer as the list grows, so averaged over every `Add` the cost is constant. That's what **amortised O(1)** means.
:::

```csharp
var list = new List<int>();
var lastCapacity = -1;
for (int i = 0; i < 100; i++)
{
    list.Add(i);
    if (list.Capacity != lastCapacity) { Console.Write($"{list.Capacity} "); lastCapacity = list.Capacity; }
}
Console.WriteLine("← each jump was a full copy");

var presized = new List<int>(capacity: 10_000);   // know the size? Skip the copies entirely
Console.WriteLine(presized.Capacity);
```

Related costs: `Insert(0, x)` and `RemoveAt(0)` are O(n), because every item after that position has to shift. Need fast removal from the front? That's what `Queue<T>` is for.

## Inside Dictionary: hash codes and buckets {i}

:::plain
A dictionary doesn't search. It turns your key into a number, the number picks one small shelf, and it only looks on that shelf.
:::

The lookup you stepped through above, in three steps:

1. Call `key.GetHashCode()` to get a number.
2. Turn the number into a bucket index (roughly `hash % bucketCount`).
3. Compare the few entries in that bucket with `Equals`.

```csharp
var stock = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)
{
    ["TEA-01"] = 12,
    ["TEA-02"] = 0,
};

if (stock.TryGetValue("tea-01", out var qty))      // ONE lookup gives "found?" and the value
    Console.WriteLine($"TEA-01: {qty} in stock");

stock["TEA-03"] = 5;                                // add or overwrite
try { stock.Add("TEA-01", 1); }                     // Add throws on a duplicate key
catch (ArgumentException) { Console.WriteLine("duplicate key"); }
```

- Use **`TryGetValue`**, not `ContainsKey` followed by the indexer, which does the whole lookup twice.
- **Keys must be immutable.** The bucket is chosen from the hash code *at insertion*. If the key changes later, the dictionary looks in the wrong bucket forever ([Episode 1](ch:type-system#equality-the-same-means-three-things)).
- Pass a **comparer** (`StringComparer.OrdinalIgnoreCase`) to define what "same key" means.

:::gotcha Never depend on Dictionary order
A `Dictionary` often *happens* to iterate in insertion order, until you remove something and a later insert reuses the gap. Order isn't part of its contract. If you need order, sort explicitly, or use `SortedDictionary` or `OrderedDictionary<K,V>` (.NET 9).
:::

:::qa How does a Dictionary work internally?
It's a hash table. `GetHashCode` picks a bucket, and the entries that share the bucket are compared with `Equals`. Lookups, inserts and removals are O(1) on average. It resizes (rehashes) when it fills up. Keys must have consistent `Equals`/`GetHashCode` and must not change while stored.
:::

## Interfaces: ask for little, return honestly {b}

Collections implement a ladder of interfaces. Each rung promises one more ability:

:::scene visuals/scenes/col-ladder.svg | The interface ladder
1. **`IEnumerable<T>`** is the bottom rung: you can `foreach` over it, and that's all. Lists, arrays, sets, LINQ queries and database results all qualify.
2. Up a rung, **`IReadOnlyCollection<T>`** adds `Count`, and **`IReadOnlyList<T>`** adds reading by position (`list[3]`).
3. Higher still, **`ICollection<T>`** adds `Add` and `Remove`, and **`IList<T>`** (which `List<T>` implements) adds writing by position and `Insert`.
4. **Accept the lowest rung you need.** A `Sum` method only loops, so it should take `IEnumerable<Order>`. Then a list, an array or a LINQ query can all be passed in.
5. **Return the most honest read-only rung.** Returning `IReadOnlyList<Order>` lets callers read and count, but not `Add` to your internal list.
:::

The design rule is **accept the least you need, and return what you honestly have**:

```csharp
var orders = new List<Order> { new(1, 12m), new(2, 30m) };
Console.WriteLine(Sum(orders));                     // a List works
Console.WriteLine(Sum(orders.Where(o => o.Total > 20)));   // so does a LINQ query, or an array

static decimal Sum(IEnumerable<Order> items) => items.Sum(o => o.Total);   // only needs foreach
static IReadOnlyList<Order> Recent(List<Order> all) => all.TakeLast(10).ToList();  // caller can't Add

record Order(int Id, decimal Total);
```

:::gotcha An `IEnumerable<T>` might run twice
An `IEnumerable<T>` may be a *lazy query*, not stored data. Loop over it twice and the query runs twice. If it's a database query, that's two database trips ([LINQ](ch:linq#deferred-execution-a-recipe-not-a-meal)). If you need to look more than once, call `.ToList()` first.
:::

:::qa IEnumerable vs ICollection vs IList?
`IEnumerable<T>` only allows iteration. `ICollection<T>` adds Count, Add, Remove, Contains and Clear. `IList<T>` adds index access and Insert/RemoveAt. Accept the least capable interface you need. Return `IReadOnlyList<T>` or `IReadOnlyCollection<T>` to expose data without allowing changes.
:::

## Choosing, in one glance {b}

```text
Lookup by key?                      → Dictionary<K,V>     (keys sorted → SortedDictionary)
"Have I seen this?" / no duplicates → HashSet<T>
Ordered list, access by position?   → List<T>             (fixed size, hot path → T[])
First in, first out?                → Queue<T>            (across threads → Channel<T>)
Last in, first out?                 → Stack<T>
"Always take the most urgent"?      → PriorityQueue<T,P>
Shared between threads?             → Concurrent* types, or a lock around a normal one
Built once, read on every request?  → FrozenDictionary / FrozenSet
Must never change at all?           → Immutable* types
Exposing from a class?              → IReadOnlyList<T> / IReadOnlyDictionary<K,V>
```

## Read-only, immutable and frozen are different promises {i}

:::plain
"Read-only" usually means *you* can't change it, but someone else still can. "Immutable" means *nobody* can, ever. "Frozen" is immutable and also tuned for the fastest possible lookups.
:::

:::scene visuals/scenes/col-readonly.svg | Three promises that sound the same
1. An `IReadOnlyList<T>` is a **window** onto someone else's list. You can't `Add` through it.
2. But the owner still can. They call `list.Add("Chai")`, and your "read-only" view now shows 3 items. Read-only only restricted *you*.
3. An **`ImmutableList<T>`** can't change, through any reference, ever.
4. "Adding" to it returns a **new** list (v2), and v1 stays exactly as it was. Whoever holds v1 is safe, even on another thread. The new list shares most of the old one's insides, so this is cheaper than it sounds.
5. A **`FrozenDictionary`** (.NET 8) is also unchangeable, but it's built for one job: being read millions of times. Building it is slow, because it studies your keys to choose the fastest layout. It's ideal for lookup tables made at startup.
:::

| | Can *you* change it? | Can *anyone* change it? | Notes |
|---|---|---|---|
| `IReadOnlyList<T>` | No, not through this reference | **Yes**: the underlying `List` can still change | Free. It's just a view |
| `ReadOnlyCollection<T>` (`list.AsReadOnly()`) | No | Yes, through the wrapped list | A thin wrapper |
| `ImmutableList<T>`, `ImmutableArray<T>` | No. "Changes" return a new collection | **Never** | Safe to share anywhere |
| `FrozenDictionary<K,V>`, `FrozenSet<T>` (.NET 8) | No | **Never** | Slow to build, **fastest possible reads** |

The first two only stop *you*. Whoever holds the original `List` can still change it under your feet. The last two guarantee the data can never change. `Frozen*` makes the ideal startup lookup table:

```csharp norun
private static readonly FrozenDictionary<string, decimal> VatRates =
    new Dictionary<string, decimal> { ["GB"] = 0.20m, ["DE"] = 0.19m, ["FR"] = 0.20m }
        .ToFrozenDictionary(StringComparer.OrdinalIgnoreCase);
```

:::qa What's the difference between IReadOnlyList, ReadOnlyCollection and ImmutableList?
`IReadOnlyList<T>` is an interface view: you can't modify through it, but the underlying list may still change. `ReadOnlyCollection<T>` is a wrapper with the same caveat. `ImmutableList<T>` can never change: operations return new instances that share structure, which makes it safe to share across threads.
:::

:::qa When would you use FrozenDictionary?
For lookup data that's built once (usually at startup) and then read very often, such as config maps, routing tables or tax rates. Creating it costs more, but its reads are faster than `Dictionary`'s because it optimises its layout for the exact keys it holds.
:::

## When several threads share a collection {i}

:::plain
Normal collections assume only one thread touches them at a time. When several threads share one, you need the special concurrent versions, and you must do "check, then change" as a single step.
:::

Ordinary collections are **not thread-safe for writes**. Two threads adding to one `Dictionary` at the same moment can corrupt it. For shared state, such as in singletons and background workers, use the types built for it:

| Type | Use |
|---|---|
| `ConcurrentDictionary<K,V>` | A thread-safe map with `GetOrAdd`, `AddOrUpdate` and `TryRemove` |
| `ConcurrentQueue<T>` / `ConcurrentStack<T>` | Lock-free FIFO and LIFO |
| `Channel<T>` | An **async** producer/consumer queue, and the modern choice ([Background work](ch:background-work)) |

```csharp norun
private readonly ConcurrentDictionary<string, Lazy<Task<Config>>> _cache = new();

public Task<Config> GetAsync(string tenant) =>
    _cache.GetOrAdd(tenant, t => new Lazy<Task<Config>>(() => LoadConfigAsync(t))).Value;
```

The subtle part is the one even careful code gets wrong:

:::scene visuals/scenes/col-race.svg | The gap between "check" and "act"
1. Thread A checks the shared cache: "GB" isn't there yet.
2. Before A gets to act, thread B checks too. It also sees "no GB". Now both plan to add it.
3. A loads the exchange rates and stores v1.
4. B stores v2 over it. The rates were loaded twice, and anyone already holding v1 now disagrees with the cache. Each call was thread-safe on its own; the **gap between the check and the act** wasn't. This is called a **race condition**.
5. The fix is to make check-and-add **one step**: `GetOrAdd`. Under a race the loading code may still *run* twice, but only one result is ever stored. Wrap it in `Lazy<T>` (as in the code above) to make it run once.
:::

More on races in [Threading](ch:threading-concurrency#race-conditions-when-it-depends-on-timing-becomes-a-bug).

:::qa How do you make a Dictionary thread-safe?
Use `ConcurrentDictionary<K,V>` with its atomic operations (`GetOrAdd`, `AddOrUpdate`, `TryRemove`), or protect a normal `Dictionary` with a lock. For read-only data built once, use `FrozenDictionary` or an immutable dictionary, which need no locking.
:::

:::qa Is ConcurrentDictionary.GetOrAdd's factory guaranteed to run once?
No. Under contention, several threads can run the factory, but only one result is stored. If the factory is expensive or has side effects, store `Lazy<T>` values so that only the winning `Lazy` is evaluated.
:::

## Arrays, spans and collection expressions {i}

```csharp
int[] a = [1, 2, 3, 4];                 // collection expression (C# 12)
List<string> teas = ["Sencha", "Assam"];
int[] more = [..a, 5, 6];               // spread
Console.WriteLine(string.Join(",", more));

Console.WriteLine(a[^1]);               // index from the end: 4
int[] middle = a[1..3];                 // range: a NEW array {2, 3} (a copy)
Span<int> view = a.AsSpan(1, 2);        // a VIEW of {2, 3}, with no copy
view[0] = 99;
Console.WriteLine($"{middle[0]} vs {a[1]}");   // 2 vs 99: the span wrote into a itself
```

The two lines that look alike behave differently. A **range** (`a[1..3]`) on an array makes a *copy*. A **span** is a *window* onto the original memory. Spans get their own episode in [Advanced C#](ch:advanced-csharp).

Arrays are reference types with a **fixed length**. Return `[]` or `Array.Empty<T>()` rather than `null`, so callers can always `foreach` without a null check.

## Custom equality and ordering {a}

:::plain
You can tell a set or a sorted collection what "the same" and "comes first" mean, without changing the class itself.
:::

Hash-based and sorted collections accept your own rules for "same" and "order", without changing the type itself:

```csharp
var customers = new[] { new Customer("Ada", "ADA@x.com"), new Customer("Ada L.", "ada@x.com") };

var byEmail = new HashSet<Customer>(EqualityComparer<Customer>.Create(
    (a, b) => string.Equals(a?.Email, b?.Email, StringComparison.OrdinalIgnoreCase),
    c => StringComparer.OrdinalIgnoreCase.GetHashCode(c.Email)));
foreach (var c in customers) byEmail.Add(c);
Console.WriteLine(byEmail.Count);        // 1: same email means the same customer here

var byName = new SortedSet<Customer>(customers, Comparer<Customer>.Create((x, y) => string.CompareOrdinal(x.Name, y.Name)));
Console.WriteLine(byName.Min!.Name);

record Customer(string Name, string Email);
```

## Next episode {b}

Kettle's lookups are now instant. Then the owner asks for reports: top 10 customers this month, revenue per tea, every unpaid order over £100. You start writing `foreach` loops with counters, temporary lists, sorting and grouping, and each report is 30 lines of fiddly code. You don't want to write *how* to loop. You want to say *what* you want: [Episode 6 · LINQ →](ch:linq)

## Further reading

- [Collections and data structures](https://learn.microsoft.com/en-us/dotnet/standard/collections/)
- [Selecting a collection class](https://learn.microsoft.com/en-us/dotnet/standard/collections/selecting-a-collection-class)
- [Thread-safe collections](https://learn.microsoft.com/en-us/dotnet/standard/collections/thread-safe/)
- [`List<T>.Add` remarks](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.list-1.add), the source for the resize-and-copy behaviour.

## Verify this chapter

```csharp
// List grows by doubling (amortised O(1) Add)
var l = new List<int>(); var caps = new List<int>();
for (int i = 0; i < 20; i++) { l.Add(i); if (caps.Count == 0 || caps[^1] != l.Capacity) caps.Add(l.Capacity); }
Check(caps.SequenceEqual(new[] { 4, 8, 16, 32 }), "List capacity doubles: 4, 8, 16, 32");

// Dictionary: TryGetValue, duplicate Add throws, comparer controls "same key"
var d = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase) { ["TEA"] = 1 };
Check(d.TryGetValue("tea", out var v) && v == 1, "a comparer makes keys case-insensitive");
Check(Throws(() => d.Add("Tea", 2)), "Add with an existing key throws");

// a mutable key gets lost
var key = new MutableKey { Id = 1 }; var set = new HashSet<MutableKey> { key };
key.Id = 2;
Check(!set.Contains(key), "changing a key after insertion makes it unfindable");

// HashSet removes duplicates
Check(new HashSet<int> { 1, 1, 2 }.Count == 2, "HashSet keeps only unique items");

// Queue is FIFO, Stack is LIFO, PriorityQueue takes the lowest priority first
var q = new Queue<int>([1, 2]); var s = new Stack<int>([1, 2]); var pq = new PriorityQueue<string, int>();
pq.Enqueue("b", 2); pq.Enqueue("a", 1);
Check(q.Dequeue() == 1 && s.Pop() == 2 && pq.Dequeue() == "a", "FIFO, LIFO and priority order");

// IReadOnlyList is only a view
var src = new List<int> { 1 }; IReadOnlyList<int> view = src; src.Add(2);
Check(view.Count == 2, "IReadOnlyList reflects changes made to the underlying list");

// a range copies, a span views
int[] a = [1, 2, 3]; var copy = a[0..2]; var span = a.AsSpan(0, 2); span[0] = 9;
Check(copy[0] == 1 && a[0] == 9, "a range copies; a span writes through to the array");

static bool Throws(Action act) { try { act(); return false; } catch (ArgumentException) { return true; } }
static void Check(bool ok, string claim) =>
    Console.WriteLine(ok ? $"OK: {claim}" : throw new Exception($"FAIL: {claim}"));

class MutableKey
{
    public int Id;
    public override bool Equals(object? o) => o is MutableKey k && k.Id == Id;
    public override int GetHashCode() => Id;
}
```
