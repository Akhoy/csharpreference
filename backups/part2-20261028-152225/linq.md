---
id: linq
title: LINQ in Depth
summary: Language Integrated Query: the operators by category, query vs method syntax, deferred vs immediate execution, how iterators work, IEnumerable vs IQueryable, expression trees, and the performance traps.
layer: language
where: C# language › Querying data (LINQ)
fits: LINQ is defined in layer 1/2 (`System.Linq` in the BCL), but it shows up most in layer 5. EF Core ([EF Core querying](ch:efcore-querying)) is a LINQ *provider* that translates your queries into SQL. Most EF Core performance bugs are really LINQ misunderstandings.
levels: b,i,a
prereqs: delegates-events, collections
next: efcore-querying, async-await
---

## TL;DR

- LINQ is just extension methods (`Where`, `Select`, ...) that work on anything implementing `IEnumerable<T>` or `IQueryable<T>` — no compiler magic.
- Most operators are **deferred**: writing a query runs nothing; it only executes when something enumerates it (`foreach`, `ToList()`, `Count()`). Enumerate twice and it runs twice, against whatever the source looks like *now*.
- `yield return` is the mechanism that makes deferred execution possible: it turns a method into a pausable/resumable state machine.
- `IEnumerable<T>` runs in your process with compiled delegates; `IQueryable<T>` (EF Core, etc.) captures the query as an **expression tree** and translates it to SQL — switching to `IEnumerable` too early silently pulls the whole table into memory first.
- Prefer `Any()` over `Count() > 0`, and `MinBy`/`MaxBy` over `OrderBy(...).First()` — both avoid unnecessary full scans/sorts.

## What LINQ actually is, underneath the syntax {b}

**LINQ** is the set of query operators you already use constantly — `Where`, `Select`, `OrderBy`, `GroupBy`, `Join`, `Sum`, and dozens more — and the thing that makes them special is that they work on **any sequence**: an in-memory list, a database table, XML, JSON, anything that implements `IEnumerable<T>` or `IQueryable<T>`. Same vocabulary, wildly different data sources.

Here's the part worth knowing before anything else: LINQ isn't a special language feature baked into the compiler the way `if` or `for` are. It's just **extension methods** — `Where` lives in `System.Linq.Enumerable`, nothing more exotic than that — plus some optional query syntax the language layers on top for readability. Once you know that, a sentence like "LINQ operators chain together" stops being magic and starts being exactly what it looks like: one method call returning something you call the next method on.

```csharp
var bigSpenders = customers
    .Where(c => c.Country == "DE")
    .Select(c => new { c.Name, Total = c.Orders.Sum(o => o.Total) })
    .Where(x => x.Total > 1_000)
    .OrderByDescending(x => x.Total)
    .Take(10)
    .ToList();
```

:::why Why LINQ exists
Before LINQ, filtering, projecting and grouping meant hand-written `foreach` loops building up temporary lists and dictionaries by hand — and database queries were raw SQL strings the compiler had no way to check. LINQ replaces both of those with **one declarative vocabulary** that works the same way regardless of the data source, checked by the compiler at compile time, and — this is the part that becomes a whole section later in this chapter — lets providers like EF Core translate that *same* query into SQL instead of running it in memory.
:::

## Two ways to write the same query {b}

```csharp
// Query syntax: compiles to exactly the method calls below
var q1 = from o in orders
         where o.Status == OrderStatus.Paid
         orderby o.CreatedAt descending
         select new { o.Id, o.Total };

// Method syntax
var q2 = orders
    .Where(o => o.Status == OrderStatus.Paid)
    .OrderByDescending(o => o.CreatedAt)
    .Select(o => new { o.Id, o.Total });
```

These two produce **identical** compiled code — `q1` and `q2` aren't two different features, just two different spellings. Method syntax is far more common in code you'll actually see day to day. Query syntax earns its keep specifically for **joins** and **`let`** (naming an intermediate value partway through a query), where it reads noticeably cleaner than the method-chain equivalent. Worth knowing too: plenty of operators — `Take`, `Distinct`, `Any`, `Sum` among them — only exist as methods at all; there's no query-syntax spelling for them.

## The operators, organised by what they do {b}

| Category | Operators |
|---|---|
| **Filtering** | `Where`, `OfType<T>` |
| **Projection** | `Select`, `SelectMany`, `Select((x, i) => …)` with index |
| **Sorting** | `OrderBy`, `OrderByDescending`, `ThenBy`, `ThenByDescending`, `Order` (.NET 7), `Reverse` |
| **Partitioning** | `Take`, `Skip`, `TakeWhile`, `SkipWhile`, `TakeLast`, `SkipLast`, `Chunk` (.NET 6) |
| **Set** | `Distinct`, `DistinctBy`, `Union`, `UnionBy`, `Intersect`, `IntersectBy`, `Except`, `ExceptBy` |
| **Grouping** | `GroupBy`, `ToLookup`, `CountBy`, `AggregateBy` (.NET 9) |
| **Joining** | `Join` (inner), `GroupJoin`, `LeftJoin`/`RightJoin` (.NET 10), `Zip` |
| **Element** | `First`, `FirstOrDefault`, `Single`, `SingleOrDefault`, `Last`, `ElementAt`, `MinBy`, `MaxBy` |
| **Quantifiers** | `Any`, `All`, `Contains` |
| **Aggregation** | `Count`, `LongCount`, `Sum`, `Average`, `Min`, `Max`, `Aggregate` |
| **Generation** | `Enumerable.Range`, `Repeat`, `Empty` |
| **Conversion** | `ToList`, `ToArray`, `ToDictionary`, `ToHashSet`, `ToLookup`, `AsEnumerable`, `AsQueryable`, `Cast<T>` |
| **Other** | `Concat`, `Append`, `Prepend`, `DefaultIfEmpty`, `SequenceEqual`, `Index` (.NET 9) |

### First vs FirstOrDefault vs Single vs SingleOrDefault — four operators, one decision

These four get mixed up constantly, and the fix is a single table showing exactly where they diverge:

| Operator | 0 elements | 1 element | 2+ elements |
|---|---|---|---|
| `First()` | throws | returns it | returns first |
| `FirstOrDefault()` | `default` | returns it | returns first |
| `Single()` | throws | returns it | **throws** |
| `SingleOrDefault()` | `default` | returns it | **throws** |

Notice the real distinction isn't "First vs Single" so much as what each one is *asserting* about the data. `First`/`FirstOrDefault` make no claim about how many elements exist — they just want whichever one comes first, which is exactly right after an `OrderBy`, or for "give me any match". `Single`/`SingleOrDefault` are stricter: they're asserting "there should be **exactly one**", and throw loudly if that assertion turns out to be false — which is exactly the behaviour you want for a lookup by a unique key, where finding two rows means your data has a bug, not that you should silently pick one. `FirstOrDefault(predicate, defaultValue)` (.NET 6) additionally lets you pick what "not found" actually returns, instead of always falling back to `default`.

### SelectMany: turning a sequence of sequences into one sequence

```csharp
var allLines = orders.SelectMany(o => o.Lines);                      // IEnumerable<OrderLine>
var pairs = orders.SelectMany(o => o.Lines, (o, l) => new { o.Id, l.Sku });  // keep the parent
```

`Select` alone would give you a sequence of orders, each still holding its own list of lines — a sequence *of* sequences. `SelectMany` flattens that one level: instead of "ten orders, each with some lines", you get "every line from every order, as one flat list". The second overload above is worth remembering specifically because it solves a problem the first one creates: once you've flattened down to lines, how do you still know which order each line came from? The two-argument overload keeps the parent (`o`) available alongside each flattened child (`l`).

### GroupBy and lookups

```csharp
var revenueByCountry = orders
    .GroupBy(o => o.Country)
    .Select(g => new { Country = g.Key, Orders = g.Count(), Revenue = g.Sum(o => o.Total) })
    .OrderByDescending(x => x.Revenue);

var countsByStatus = orders.CountBy(o => o.Status);        // .NET 9: IEnumerable<KeyValuePair<Status,int>>
ILookup<int, Order> byCustomer = orders.ToLookup(o => o.CustomerId);  // immediate, multi-value dictionary
var forCustomer42 = byCustomer[42];                         // empty sequence if none, never throws
```

`ToLookup` is worth a specific mention because its behaviour quietly saves you a whole class of null-check and `ContainsKey` code: unlike a `Dictionary`, indexing an `ILookup` with a key that doesn't exist returns an **empty sequence**, not an exception and not `null`. `byCustomer[42]` is always safe to `foreach` over, whether or not customer 42 has any orders.

### Joins

```csharp
var rows = from o in orders
           join c in customers on o.CustomerId equals c.Id
           select new { o.Id, c.Name };

// Left join (classic pattern before .NET 10)
var withOptionalCoupon = from o in orders
                         join cp in coupons on o.CouponId equals cp.Id into gj
                         from cp in gj.DefaultIfEmpty()
                         select new { o.Id, Coupon = cp?.Code };
```

## Deferred vs immediate execution: the one idea that explains most LINQ bugs {i}

Here's the single most important thing in this entire chapter, and the thing worth slowing all the way down for: **when you write a LINQ query, nothing happens yet.** Not "almost nothing" — literally nothing. Most LINQ operators don't run your filter, your projection, anything — they just hand back an object that *describes* what you asked for, a plan, not a result. The actual work only happens later, at the exact moment something **enumerates** that plan — a `foreach`, a `ToList()`, anything that actually walks the sequence.

Operators split cleanly into two camps along this line. **Deferred (lazy)** operators — `Where`, `Select`, `OrderBy`, `Take`, `SelectMany`, and most others — build that plan and do nothing else. **Immediate** operators — `ToList`, `ToArray`, `ToDictionary`, `Count`, `Sum`, `First`, `Any`, `Max` — are the ones that actually trigger enumeration and hand back a real, concrete result right then.

Let's watch this happen, step by step, instead of just stating it:

```csharp
var numbers = new List<int> { 1, 2, 3 };
var query = numbers.Where(n => { Console.WriteLine($"checking {n}"); return n > 1; });
// nothing printed yet

numbers.Add(4);                    // the query will see this!

foreach (var n in query) { }       // NOW prints: checking 1, 2, 3, 4
var count = query.Count();         // runs the WHOLE query AGAIN: checking 1, 2, 3, 4
```

Walk through exactly what happens at each line, because every line here surprises someone the first time:

1. `numbers.Where(...)` runs. **Nothing is printed.** The lambda you wrote hasn't executed even once yet — `query` is just a description of "filter `numbers` by this predicate", sitting there, inert.
2. `numbers.Add(4)` — and here's the part that catches people out — this is **allowed**, and it matters, because `query` doesn't hold a snapshot of `numbers` from when it was declared. It holds a *reference* to the live list, and will read whatever is in it *whenever it's finally enumerated*.
3. The `foreach` is the first thing that actually enumerates `query`. Only **now** does the lambda run, once per element — on all four numbers, including the `4` you added after declaring the query.
4. `query.Count()` is a *second*, completely independent enumeration. The query has no memory of having already run once — it reruns the entire filter from scratch, printing "checking 1, 2, 3, 4" all over again.

Four consequences fall directly out of that trace, and each one is a real bug pattern you'll eventually meet in production:

1. **A query sees its source as it is when enumerated, not when declared.** If the source changes in between — as `numbers` did above — the query sees the *new* state, which is sometimes exactly what you want and sometimes a genuine bug.
2. **Every enumeration re-runs the whole query, from scratch.** Against a database, that's another full round trip; against an expensive in-memory `Select`, that's repeated work for no reason. The fix is simple once you know to look for it: call `ToList()` once, and reuse the resulting list, the moment you know you'll need the results more than once.
3. **Exceptions surface late** — at enumeration time, which can be far away, in a completely different method, from the line that actually built the faulty query.
4. **A disposed source breaks a query that hasn't run yet.** Return a lazy query built over a `DbContext`, let that `DbContext` get disposed, and *then* have the caller enumerate it — you'll get an `ObjectDisposedException` at the enumeration site, nowhere near where the real mistake was made.

### Not every deferred operator is lazy in the same way

One more distinction worth having, because it explains a specific performance trap: among the deferred operators, some **stream** — they can hand you the very first result item without first reading the whole source (`Where`, `Select`, `Take` all do this). Others must **buffer** the entire source before they can yield even their first output item, because they fundamentally can't know the answer without seeing everything (`OrderBy`, `GroupBy`, `Reverse`, and `Distinct` to a degree all fall into this camp — you can't know what the smallest element is, for a sort, until you've looked at all of them). That's exactly why `orders.OrderBy(...).First()` is wasteful: it sorts the *entire* collection just to throw away everything except the very first element. `MinBy`/`MaxBy` solve the same problem in a single streaming pass, with no sort and no buffering at all.

## How this laziness is actually implemented: yield return {i}

You now know LINQ operators are lazy. Here's the mechanism that makes that possible — and it's one you can use yourself, not just something happening behind the scenes:

```csharp
public static IEnumerable<T> MyWhere<T>(this IEnumerable<T> source, Func<T, bool> predicate)
{
    foreach (var item in source)
        if (predicate(item))
            yield return item;     // pause here, hand the item to the caller, resume on next MoveNext()
}

static IEnumerable<int> Fibonacci()          // infinite sequences are fine, because it's lazy
{
    (int a, int b) = (0, 1);
    while (true) { yield return a; (a, b) = (b, a + b); }
}
var first10 = Fibonacci().Take(10).ToList();
```

`yield return` is doing something genuinely clever under the hood: the compiler rewrites a method that uses it into a small object implementing `IEnumerable<T>`/`IEnumerator<T>`, whose code can **pause mid-execution**, hand one value back to whoever's asking, and later **resume exactly where it left off** — locals, loop position, everything intact — the next time it's asked for another value. That's precisely what lets `Fibonacci()` above return an *infinite* sequence without ever hanging: nothing computes the next Fibonacci number until something explicitly asks for it, and `Take(10)` only ever asks ten times.

`foreach` is what drives this machinery: it calls `GetEnumerator()` once, then repeatedly calls `MoveNext()` and reads `Current`, until `MoveNext()` says there's nothing left, and finally calls `Dispose()`. Chain several LINQ operators together — `Where().Select().Take()` — and you've actually built a **pipeline of enumerators**, each one pulling exactly one item at a time from the one before it, only when asked. Nothing is computed ahead of its actual use.

## IEnumerable<T> vs IQueryable<T>: the difference that decides where your query actually runs {i}

Everything so far has been "LINQ to Objects" — queries running entirely in your process, over data already sitting in memory. But the exact same `Where`, `Select`, `OrderBy` syntax also works against `db.Orders` in EF Core, and *that* code doesn't run in your process at all — it becomes SQL. How can identical-looking syntax do two completely different things?

| | `IEnumerable<T>` (LINQ to Objects) | `IQueryable<T>` (LINQ providers: EF Core…) |
|---|---|---|
| Operators take | `Func<T, bool>`: compiled delegates | `Expression<Func<T, bool>>`: expression trees |
| Executes | In your process, in C# | Translated by a provider (to SQL, etc.) and run at the source |
| Defined in | `System.Linq.Enumerable` | `System.Linq.Queryable` |
| Can call any C# method | Yes | Only what the provider can translate |

The whole answer is in that first row, and it's genuinely subtle: `IQueryable<T>`'s version of `Where` doesn't take a compiled `Func` at all — it takes an `Expression<Func<T, bool>>`, which, as the next section shows in detail, means the compiler hands the provider a *description* of your lambda instead of runnable code. EF Core reads that description and writes its own SQL from it. `IEnumerable<T>`'s `Where` takes an ordinary compiled delegate, which just runs, in C#, right there in your process. Same method name, same-looking lambda — two structurally different things happening underneath.

```csharp
IQueryable<Order> q = db.Orders;                         // nothing executed

var paid = q.Where(o => o.Status == OrderStatus.Paid)   // still IQueryable: becomes WHERE
            .OrderBy(o => o.CreatedAt)                   // ORDER BY
            .Take(20);                                   // TOP(20) / LIMIT 20
var list = await paid.ToListAsync();                    // ONE SQL query, 20 rows returned

// The trap: switching to IEnumerable too early
IEnumerable<Order> all = db.Orders;                      // static type is IEnumerable
var bad = all.Where(o => o.Status == OrderStatus.Paid).Take(20).ToList();
// SELECT * FROM Orders: the ENTIRE table comes over the network, then it's filtered in memory
```

Look closely at the two blocks above — the operators called are *identical*, `Where` then `Take`. The only difference is the **static type of the variable** they're called on: `IQueryable<Order>` versus `IEnumerable<Order>`. That one type annotation decides whether `.Where(...)` resolves to the `IQueryable` overload (build an expression tree, let EF Core translate it to `WHERE ... TOP(20)`) or the `IEnumerable` overload (compile a delegate, pull every single row across the network first, and only then filter in memory). The SQL difference between those two outcomes, on a million-row table, is enormous — and nothing about the *syntax* warns you which one you've written.

:::gotcha The silent full-table scan
Any of these flip a query from SQL to in-memory, usually without a compiler warning in sight: assigning the query to an `IEnumerable<T>` variable, calling `.AsEnumerable()`, calling `.ToList()` before you're done filtering, or a repository method whose return type is declared `IEnumerable<T>` instead of `IQueryable<T>`. The defence is simple to state: keep a query typed as `IQueryable` for as long as possible, right up until the one final call that actually materialises it, and `Select` down to only the columns you actually need before that happens.
:::

## Expression trees: what EF Core is actually reading {a}

The previous section promised a closer look at what an `Expression<Func<…>>` really is, as opposed to a plain delegate. Here it is. When a lambda gets assigned to an `Expression<Func<…>>` instead of a `Func<…>`, the compiler does something fundamentally different with it: instead of compiling the lambda into runnable code the way it normally would, it builds an **object graph that describes the code** — a tree of nodes you can walk, inspect, and even generate completely new code from.

```csharp
Expression<Func<Order, bool>> expr = o => o.Total > 100 && o.Country == "DE";
// AndAlso(
//   GreaterThan(Member(o, Total), Constant(100)),
//   Equal(Member(o, Country), Constant("DE")))
```

![An expression tree being built from a lambda, then walked node by node to produce SQL](visuals/expression-tree.svg)

Walk through what that diagram is showing, because it's genuinely the whole mechanism in one picture: the lambda `o.Total > 100 && o.Country == "DE"` becomes a small tree, with an `AndAlso` node at the root, two comparison nodes beneath it (`GreaterThan` and `Equal`), and each comparison pointing at a `Member` access and a `Constant` as its two leaves. That tree is just data — ordinary .NET objects you could inspect with a debugger, same as any other object graph. EF Core's query pipeline walks it exactly the way you'd walk any tree: visit the root, recurse into each child, and at each node emit the matching piece of SQL — `AndAlso` becomes `AND`, `GreaterThan` becomes `>`, a `Member` access becomes a column name, and a `Constant` becomes... not a literal value baked into the SQL string, but a **parameter**. That detail is exactly why LINQ queries are naturally safe from SQL injection: captured values never get string-concatenated into the query text at all — they travel as proper SQL parameters (`@__country_0`), the same mechanism you'd reach for by hand with raw ADO.NET.

Because an `IQueryable` is just this same kind of tree, waiting to be extended, you can build one up conditionally, piece by piece, and the provider still only ever sees — and only ever executes — one final query:

```csharp
public static IQueryable<Product> ApplyFilters(IQueryable<Product> q, ProductFilter f)
{
    if (f.MinPrice is { } min) q = q.Where(p => p.Price >= min);   // composing IQueryable conditionally
    if (!string.IsNullOrEmpty(f.Search)) q = q.Where(p => p.Name.Contains(f.Search));
    if (f.CategoryId is { } cat) q = q.Where(p => p.CategoryId == cat);
    return q;   // still one SQL query, built from only the filters that were supplied
}
```

There's a real limit on all of this, and it follows directly from how the translation works: the provider can only translate what it actually understands how to turn into SQL — it cannot run arbitrary C#. `q.Where(p => MyHelper(p))` throws "could not be translated" in EF Core 3 and later, precisely because `MyHelper` is just a `Member`/method-call node in the tree that EF Core has no SQL equivalent for. (Older EF Core versions used to silently fall back to evaluating the whole query in memory instead of throwing — which sounds more forgiving, but was actually a notorious, hard-to-spot performance trap: a query that looked like it ran as SQL was secretly pulling entire tables across the network instead.)

## Performance considerations {a}

A short, practical list, now that you understand *why* each of these is true rather than just that it is:

- LINQ to Objects allocates **enumerators and delegates**, plus closures if your lambdas capture variables — you saw exactly this mechanism in the `yield return` section above. For most business code this overhead is genuinely negligible; in true hot paths (per-item processing of millions of items, tight loops inside middleware), a plain `for`/`foreach` over arrays or spans can be several times faster with zero allocations.
- .NET 7–10 have vectorised many operators (`Sum`, `Min`, `Max`, `Average` over arrays/spans now use SIMD; `Order` and `ToArray` got faster too) — a good reminder that upgrading .NET versions sometimes buys you LINQ performance for free, no code changes needed.
- **`Any()`** stops the moment it finds a match. `Count() > 0` does not — on a lazy sequence it's a full pass through everything, just to throw the number away and check if it was nonzero (though on an `ICollection`, `Count` is a stored property and genuinely O(1)).
- **`Count` property vs `Count()` method:** `Count()` actually checks whether the source is an `ICollection<T>` and uses its stored `.Count` when it can, rather than blindly enumerating — but `TryGetNonEnumeratedCount` exists specifically to make that intent explicit in your own code, rather than relying on an internal optimisation.
- Avoid `OrderBy(...).First()` for the reason covered earlier — a full sort just to discard everything but one element; use `MinBy`/`MaxBy` instead.
- Avoid repeated `.ToList()` calls chained through a pipeline; each one allocates a brand-new full copy of whatever's been produced so far.
- `Where(...).Count()` vs `Count(predicate)` produce identical results — pick whichever reads more clearly to you.

:::qa What is deferred execution in LINQ?
Most operators don't run when called. They build a query that executes when it is enumerated (foreach, ToList, Count, First…), using the data as it is at that moment, and every enumeration runs it again. Immediate operators like ToList, Count, Sum and First force execution.
:::

:::qa IEnumerable vs IQueryable?
IEnumerable runs LINQ in memory using compiled delegates. IQueryable captures the query as expression trees that a provider (EF Core) translates and executes at the data source, e.g. as SQL. Switching to IEnumerable too early pulls all rows into memory and filters there.
:::

:::qa What's the difference between First, FirstOrDefault, Single and SingleOrDefault?
First returns the first element and throws if there are none; FirstOrDefault returns default instead. Single expects exactly one element and throws if there are zero or more than one; SingleOrDefault returns default for zero but still throws for more than one.
:::

:::qa Select vs SelectMany?
Select maps each element to exactly one result, so a sequence of lists stays a sequence of lists. SelectMany maps each element to a sequence and flattens them into one sequence (all order lines from all orders).
:::

:::qa How does yield return work?
The compiler turns the method into a state machine implementing IEnumerable/IEnumerator. Each MoveNext runs code until the next yield return, hands back that value, and pauses. Execution is lazy and resumes exactly where it left off.
:::

:::qa What is the multiple-enumeration problem?
Enumerating a lazy IEnumerable more than once re-executes the whole pipeline, including database queries or expensive projections, and results may differ between enumerations. Materialise once with ToList/ToArray when you need the results more than once.
:::

:::qa How does EF Core translate LINQ to SQL?
IQueryable operators take Expression&lt;Func&lt;…&gt;&gt; parameters, so the compiler builds expression trees instead of delegates. EF Core's query pipeline walks the tree, maps members to columns via the model, turns captured variables into SQL parameters, and generates provider-specific SQL. Untranslatable expressions throw.
:::

:::qa Any() vs Count() > 0?
Any stops at the first element (or the first match), so it's O(1) for the common case and maps to EXISTS in SQL. Count enumerates everything on lazy sequences and maps to COUNT(*). Prefer Any for existence checks.
:::

:::qa Is LINQ slow?
LINQ to Objects adds small overheads (enumerator and delegate allocations, interface calls) that are irrelevant for most business code. In hot paths over large data, hand-written loops or Span-based code can be faster. Recent .NET versions vectorised many operators. For databases, the cost is about the SQL generated, not LINQ itself.
:::

## Further reading

- [LINQ overview](https://learn.microsoft.com/en-us/dotnet/csharp/linq/)
- [Standard query operators](https://learn.microsoft.com/en-us/dotnet/csharp/linq/standard-query-operators/)
- Jon Skeet's *Edulinq* blog series: reimplementing LINQ to Objects, the best way to understand it.

## Verify this chapter

Run with `dotnet run` (plain console app, .NET 8/9, no packages; no database, so the `IQueryable` section is covered conceptually only — EF Core's actual SQL translation is verified in the EF Core chapters). It checks deferred vs. immediate execution, `yield return`'s pause/resume behavior, `Any()` short-circuiting where `Count()` doesn't, and that an `Expression<Func<...>>` is data you can inspect rather than runnable code.

```csharp
// --- Deferred execution: the query doesn't run until enumerated, and reruns on every enumeration ---
var checks = 0;
var numbers = new List<int> { 1, 2, 3 };
var query = numbers.Where(n => { checks++; return n > 1; });
if (checks != 0) throw new Exception("FAIL: Where should not run the predicate before enumeration");
Console.WriteLine("OK: building a LINQ query runs nothing yet (checks == 0)");

numbers.Add(4); // the query holds a reference to the live list, not a snapshot
var first = query.ToList();
if (checks != 4) throw new Exception($"FAIL: expected 4 predicate calls (including the late-added 4), got {checks}");
Console.WriteLine("OK: enumerating runs the predicate once per element, seeing the list as it is NOW (4 items)");

checks = 0;
var second = query.Count();
if (checks != 4) throw new Exception("FAIL: a second enumeration should re-run the whole query from scratch");
Console.WriteLine("OK: a second enumeration (Count()) re-ran the predicate from scratch instead of reusing the first result");

// --- Any() short-circuits; Count() walks the whole lazy sequence ---
var visited = 0;
IEnumerable<int> Source() { foreach (var n in Enumerable.Range(1, 1000)) { visited++; yield return n; } }
visited = 0;
var hasMatch = Source().Any(n => { return n == 1; }); // matches on the very first element
if (visited != 1) throw new Exception($"FAIL: Any should stop at the first match, visited {visited} elements");
Console.WriteLine("OK: Any() stopped after the first matching element instead of scanning everything");

visited = 0;
var total = Source().Count();
if (visited != 1000) throw new Exception("FAIL: Count() on a lazy sequence should enumerate everything");
Console.WriteLine("OK: Count() on a lazy IEnumerable<T> walked all 1000 elements, unlike Any()");

// --- yield return: pause/resume, proven by interleaving with external side effects ---
IEnumerable<int> Trace()
{
    Console.WriteLine("  trace: about to yield 1");
    yield return 1;
    Console.WriteLine("  trace: about to yield 2");
    yield return 2;
}
var it = Trace().GetEnumerator();
Console.WriteLine("main: before first MoveNext");
it.MoveNext(); // only now does "about to yield 1" print — proves the method body hadn't started yet
Console.WriteLine($"main: got {it.Current}, now calling MoveNext again");
it.MoveNext(); // resumes exactly after the first yield, not from the top
if (it.Current != 2) throw new Exception("FAIL: yield return should resume where it left off");
Console.WriteLine("OK: yield return paused and resumed exactly where it left off (saw 1 then 2, interleaved with main)");

// --- An Expression<Func<...>> is an inspectable object graph, not compiled, runnable code ---
System.Linq.Expressions.Expression<Func<int, bool>> expr = x => x > 100;
var body = (System.Linq.Expressions.BinaryExpression)expr.Body;
if (body.NodeType != System.Linq.Expressions.ExpressionType.GreaterThan)
    throw new Exception("FAIL: expected the expression tree's root node to be a GreaterThan comparison");
Console.WriteLine($"OK: Expression<Func<int,bool>> is data — its root node is {body.NodeType}, matching 'x > 100', inspectable without running it");

// Not runtime-verifiable here — see Further reading: LINQ overview, Standard query operators (Microsoft Learn)
// (actual SQL generated by an IQueryable provider like EF Core is covered and verified in the EF Core chapters)
```
