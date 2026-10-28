---
id: linq
title: "LINQ: Ask for the Result, Not the Loop"
summary: "Episode 6. The owner wants reports, and hand-written loops pile up. LINQ lets you describe the result (filter, sort, group, total) and the library does the looping. Covers the core operators, deferred execution, yield return, IEnumerable vs IQueryable (where the query actually runs), expression trees and how C# becomes SQL, and performance traps."
layer: language
where: C# language › Querying data (LINQ)
fits: LINQ is defined in layers 1 and 2 (`System.Linq` in the BCL), but it matters most in layer 5. EF Core ([EF Core querying](ch:efcore-querying)) is a LINQ *provider* that translates your queries into SQL. Most EF Core performance bugs are really LINQ misunderstandings.
levels: b,i,a
prereqs: delegates-events, collections
next: efcore-querying, async-await
---

## The 30-second version

- **LINQ** is a set of methods (`Where`, `Select`, `OrderBy`, `GroupBy`, `Sum`, …) for any sequence. Each one takes a **lambda** ([Episode 4](ch:delegates-events)). You describe *what* you want, and LINQ does the looping.
- **Deferred execution**: building a query runs **nothing**. It's a recipe. The work happens when something walks it (`foreach`, `ToList`, `Count`), and it happens **again every time** something walks it.
- The laziness comes from **`yield return`**: each stage hands over one item at a time, only when asked.
- **`IEnumerable<T>`** runs the query in your app, in C#. **`IQueryable<T>`** (EF Core) turns it into SQL that runs in the database. The variable's type decides which, so be careful.
- The bridge is the **expression tree**: a lambda stored as data, so EF Core can read it and write SQL.

## Previously, and the problem {b}

In [Episode 5](ch:collections) Kettle got fast lookups. Now the owner wants a report: *the top 3 customers by money spent on paid orders*. Here's the loop version:

```csharp
var orders = Sample.Orders;

var totals = new Dictionary<string, decimal>();
foreach (var o in orders)
{
    if (!o.Paid) continue;
    totals.TryGetValue(o.Customer, out var sum);
    totals[o.Customer] = sum + o.Total;
}
var sorted = new List<KeyValuePair<string, decimal>>(totals);
sorted.Sort((a, b) => b.Value.CompareTo(a.Value));
for (int i = 0; i < Math.Min(3, sorted.Count); i++)
    Console.WriteLine($"{sorted[i].Key}: £{sorted[i].Value}");

record Order(int Id, string Customer, string Tea, decimal Total, bool Paid);
static class Sample
{
    public static readonly Order[] Orders =
    [
        new(1, "Ada", "Sencha", 30m, true),   new(2, "Bob", "Assam", 12m, true),
        new(3, "Ada", "Rooibos", 18m, false), new(4, "Cy", "Sencha", 55m, true),
        new(5, "Bob", "Earl Grey", 25m, true), new(6, "Di", "Assam", 9m, true),
    ];
}
```

It works, but the *meaning* ("paid orders, grouped by customer, totalled, top 3") is buried under the mechanics: a temporary dictionary, `TryGetValue`, a copy, a sort, an index loop. Every new report means another 15 lines of the same kind of thing.

## The lightbulb: describe the result {b}

Here's the same report written as a description of what you want:

```csharp
var top3 = Sample.Orders
    .Where(o => o.Paid)                                       // keep paid orders
    .GroupBy(o => o.Customer)                                 // one group per customer
    .Select(g => new { Customer = g.Key, Spent = g.Sum(o => o.Total) })
    .OrderByDescending(x => x.Spent)                          // biggest first
    .Take(3);                                                 // top 3

foreach (var c in top3) Console.WriteLine($"{c.Customer}: £{c.Spent}");

record Order(int Id, string Customer, string Tea, decimal Total, bool Paid);
static class Sample
{
    public static readonly Order[] Orders =
    [
        new(1, "Ada", "Sencha", 30m, true),   new(2, "Bob", "Assam", 12m, true),
        new(3, "Ada", "Rooibos", 18m, false), new(4, "Cy", "Sencha", 55m, true),
        new(5, "Bob", "Earl Grey", 25m, true), new(6, "Di", "Assam", 9m, true),
    ];
}
```

Each line reads like the spec. This is **LINQ**, short for **Language Integrated Query**. It isn't special syntax built into the compiler. It's a library of **extension methods** on `IEnumerable<T>` (in `System.Linq`). Each one takes a **delegate**, the lambda, which is the "slot for behaviour" from [Episode 4](ch:delegates-events). `Where` loops for you and calls your lambda to decide what to keep.

The same vocabulary works on lists, arrays, dictionaries and, with EF Core, **database tables**, where it becomes SQL. That last part is the real superpower, and it's covered at the end of this chapter.

### Two spellings, one query

```csharp
int[] prices = [12, 30, 8, 55];

var a = from p in prices where p > 10 orderby p select p * 2;     // query syntax
var b = prices.Where(p => p > 10).OrderBy(p => p).Select(p => p * 2);   // method syntax

Console.WriteLine(string.Join(",", a) + " = " + string.Join(",", b));
```

The compiler turns query syntax into exactly the method calls. Method syntax is what you'll see most. Query syntax reads better for **joins** and **`let`**. Many operators (`Take`, `Distinct`, `Any`, `Sum`) only exist as methods.

## The operators you'll use 90% of the time {b}

| Job | Operators |
|---|---|
| **Filter** | `Where`, `OfType<T>` |
| **Transform** | `Select`, `SelectMany` (flatten) |
| **Sort** | `OrderBy`, `OrderByDescending`, `ThenBy` |
| **Slice** | `Take`, `Skip`, `TakeWhile`, `Chunk` |
| **Group** | `GroupBy`, `ToLookup`, `CountBy` (.NET 9) |
| **Combine** | `Join`, `GroupJoin`, `Zip`, `Concat`, `Union` |
| **Sets** | `Distinct`, `DistinctBy`, `Intersect`, `Except` |
| **Pick one** | `First`, `FirstOrDefault`, `Single`, `SingleOrDefault`, `MinBy`, `MaxBy` |
| **Yes/no** | `Any`, `All`, `Contains` |
| **Totals** | `Count`, `Sum`, `Average`, `Min`, `Max`, `Aggregate` |
| **Materialise** | `ToList`, `ToArray`, `ToDictionary`, `ToHashSet` |

### First, FirstOrDefault, Single, SingleOrDefault

| | 0 matches | 1 match | 2+ matches |
|---|---|---|---|
| `First()` | throws | returns it | returns the first |
| `FirstOrDefault()` | `default` (null / 0) | returns it | returns the first |
| `Single()` | throws | returns it | **throws** |
| `SingleOrDefault()` | `default` | returns it | **throws** |

The real difference is **what you're claiming about the data**. `First` means "any match will do", for example after sorting. `Single` means "there must be **exactly one**". Use it for lookups by a unique key, where finding two means your data has a bug and you want to hear about it loudly.

### SelectMany, GroupBy, ToLookup and Join on Kettle data

```csharp
var orders = new[]
{
    new Order(1, 10, ["Sencha", "Assam"]),
    new Order(2, 20, ["Rooibos"]),
    new Order(3, 10, ["Sencha"]),
};
var customers = new[] { new Customer(10, "Ada"), new Customer(20, "Bob") };

// SelectMany flattens: orders → every tea from every order, as one list
Console.WriteLine(string.Join(", ", orders.SelectMany(o => o.Teas)));

// GroupBy: count of each tea
foreach (var g in orders.SelectMany(o => o.Teas).GroupBy(t => t))
    Console.WriteLine($"{g.Key} × {g.Count()}");

// ToLookup: like a Dictionary of lists, and a missing key gives an EMPTY sequence, not an exception
var byCustomer = orders.ToLookup(o => o.CustomerId);
Console.WriteLine($"customer 10 has {byCustomer[10].Count()} orders, customer 99 has {byCustomer[99].Count()}");

// Join: match orders to customer names
var rows = from o in orders
           join c in customers on o.CustomerId equals c.Id
           select $"order {o.Id} → {c.Name}";
Console.WriteLine(string.Join("; ", rows));

record Order(int Id, int CustomerId, string[] Teas);
record Customer(int Id, string Name);
```

:::qa What's the difference between First, FirstOrDefault, Single and SingleOrDefault?
`First` returns the first match and throws if there's none. `FirstOrDefault` returns default instead of throwing. `Single` asserts there is exactly one match and throws if there are zero or several. `SingleOrDefault` returns default for zero matches but still throws for several. Use `Single` when duplicates would mean a bug, and `First` when you only want any or the top item.
:::

:::qa Select vs SelectMany?
`Select` maps each element to one result, so a sequence of orders becomes a sequence of line lists. `SelectMany` maps each element to a sequence and flattens them all into one sequence, such as every line of every order. An overload keeps the parent available alongside each child.
:::

## Deferred execution: a recipe, not a meal {i}

Here is the single most important idea in LINQ, and the cause of most LINQ bugs:

**Building a query runs nothing.** `orders.Where(…).Select(…)` doesn't filter anything. It returns an object that *describes* the work, a recipe. The cooking only happens when something **walks** the sequence (`foreach`, `ToList`, `Count`, `First`). And it happens **every time** something walks it.

That behaviour has a name: **deferred execution**. Operators that just add to the recipe (`Where`, `Select`, `OrderBy`, `Take`) are **deferred**. Operators that need an actual answer (`ToList`, `Count`, `Sum`, `First`, `Any`) are **immediate**, and they're the ones that trigger the work.

:::scene visuals/scenes/linq-pipeline.svg | Pulling items through `Where → Select → Take`
1. You've written `orders.Where(paid).Select(total).Take(2)`. Three stations are set up, but **no order has been looked at**. You only have a plan.
2. `foreach` asks for an item. `Take` asks `Select`, `Select` asks `Where`, and `Where` pulls order #1. It's unpaid, so it's dropped. Items are *pulled* one at a time, from the end.
3. `Where` pulls #2: paid. `Select` turns it into £30, and `Take` passes it to your loop.
4. #3 becomes £12, and `Take` now has 2, so **the whole pipeline stops**. Orders #4 and #5 are never even read. That's why laziness can be very efficient.
5. Loop over the same query again and **all of it runs again from scratch**. A query stores no results. Call `.ToList()` once if you need them more than once.
:::

Run this and watch *when* the lambda actually runs:

```csharp
var prices = new List<int> { 5, 20, 40 };
var expensive = prices.Where(p => { Console.WriteLine($"  checking {p}"); return p > 10; });
Console.WriteLine("query built (nothing checked yet)");

prices.Add(80);                          // the query will see this: it reads the source LATE

Console.WriteLine($"count = {expensive.Count()}");   // runs now: checks 5, 20, 40, 80
Console.WriteLine($"first = {expensive.First()}");   // runs AGAIN, and stops at 20

var snapshot = expensive.ToList();       // runs one last time and KEEPS the results
Console.WriteLine($"snapshot has {snapshot.Count} items; reading it again checks nothing");
Console.WriteLine($"first = {snapshot[0]}");
```

Four bugs follow directly from this, and you'll meet each of them:

1. **The query sees its source as it is when it *runs*,** not when it was written (the `80` above).
2. **Every walk runs it again.** On a database query, that's another round trip.
3. **Exceptions show up late,** where the query is walked, which can be far from where it was written.
4. **A disposed source breaks it.** Return an un-run query over a `DbContext`, dispose the context, and the caller gets `ObjectDisposedException`.

:::gotcha Some operators must read everything first
`Where`, `Select` and `Take` **stream**: they can hand over the first result immediately. `OrderBy`, `GroupBy` and `Reverse` must **buffer** the whole source before they can produce anything, because you can't know the smallest item until you've seen them all. So `orders.OrderBy(o => o.Total).First()` sorts *everything* just to keep one item. Use `orders.MinBy(o => o.Total)`, which takes one pass and needs no sort.
:::

:::qa What is deferred execution in LINQ?
Most operators don't run when they're called. They build a query that executes when it's enumerated (`foreach`, `ToList`, `Count`, `First`…), using the data as it is at that moment, and every enumeration runs it again. Immediate operators like `ToList`, `Count`, `Sum` and `First` force execution.
:::

:::qa What is the multiple-enumeration problem?
Enumerating a deferred `IEnumerable<T>` more than once re-runs the whole query each time. That repeats the work, can return different results if the source changed, and against a database causes repeated round trips. Materialise once with `ToList`/`ToArray` when you need the results more than once.
:::

## How the laziness works: yield return {i}

You can write your own lazy operator. `yield return` hands **one** item to the caller and **pauses** the method right there, keeping every local variable, until the caller asks for the next item:

```csharp
foreach (var p in KeepAbove(new[] { 5, 20, 40 }, 10))
    Console.WriteLine($"got {p}");

Console.WriteLine(string.Join(",", Fibonacci().Take(10)));   // an infinite sequence, made safe by laziness

static IEnumerable<int> KeepAbove(IEnumerable<int> source, int min)   // a home-made Where
{
    foreach (var x in source)
    {
        Console.WriteLine($"  looking at {x}");
        if (x > min) yield return x;          // hand over one item, pause here
    }
}

static IEnumerable<long> Fibonacci()
{
    (long a, long b) = (0, 1);
    while (true) { yield return a; (a, b) = (b, a + b); }    // never ends, but only runs when asked
}
```

The output interleaves "looking at" and "got". The loop and the method take turns. The compiler rewrites a `yield` method into a small **state machine** object that remembers where it paused. `foreach` drives it by calling `MoveNext()` again and again. Chaining `Where().Select().Take()` builds a pipeline of these, each pulling from the one before it. That's exactly the conveyor belt above.

:::qa How does yield return work?
The compiler turns an iterator method into a state-machine class that implements `IEnumerable<T>`/`IEnumerator<T>`. Each `MoveNext()` runs the method until the next `yield return`, saves its position and locals, and exposes the value as `Current`. That makes sequences lazy, including infinite ones.
:::

## Where does the query run? IEnumerable vs IQueryable {i}

So far everything has run in your app, over data in memory. That's **LINQ to Objects**. But EF Core lets you write the *same* `Where` and `Take` over `db.Orders`, and that code never runs in your app at all. It becomes SQL. How can the same code do two different things?

Through two interfaces that look alike:

| | `IEnumerable<T>` | `IQueryable<T>` |
|---|---|---|
| `Where` takes | `Func<T,bool>`: compiled code | `Expression<Func<T,bool>>`: a **description** of the code |
| Runs | in your app, in C# | translated (to SQL) and run **in the database** |
| Can call any C# method | yes | only what the provider can translate |

Which `Where` you get depends only on the **declared type of the variable**. The code looks identical either way:

:::scene visuals/scenes/linq-where-it-runs.svg | Same `.Where(...).Take(20)`, two very different trips
1. `db.Orders` is an `IQueryable<Order>`. `Where` and `Take` don't run. They build a **description** of the query (an expression tree).
2. When you call `ToListAsync()`, EF Core translates that description into SQL, `SELECT TOP 20 … WHERE Paid = 1`, and sends it to the database.
3. The **database** does the filtering and sends back 20 rows. It's small and fast.
4. Now the same code with the variable typed **`IEnumerable<Order>`**. `Where` is now the in-memory version, so EF has to fetch **the whole table**. A million rows cross the network, then your app throws away all but 20.
:::

```csharp norun
IQueryable<Order> q = db.Orders;
var page = await q.Where(o => o.Status == OrderStatus.Paid)   // → WHERE
                  .OrderBy(o => o.CreatedAt)                    // → ORDER BY
                  .Take(20)                                     // → TOP(20)
                  .ToListAsync();                               // ONE SQL query, 20 rows

IEnumerable<Order> all = db.Orders;                             // ← same data, wrong type
var oops = all.Where(o => o.Status == OrderStatus.Paid).Take(20).ToList();
// SELECT * FROM Orders: the WHOLE table, filtered in memory
```

:::gotcha The silent full-table scan
These all quietly switch a query from SQL to in-memory, with no compiler warning: assigning it to an `IEnumerable<T>` variable, calling `.AsEnumerable()`, calling `.ToList()` before you've finished filtering, or a repository method that returns `IEnumerable<T>`. Keep queries as `IQueryable` until the very last call, and `Select` only the columns you need.
:::

:::qa IEnumerable vs IQueryable?
`IEnumerable<T>` executes LINQ in memory, using compiled delegates. `IQueryable<T>` builds expression trees that a provider such as EF Core translates and executes at the source (SQL). Filtering on an `IQueryable` happens in the database. Switching to `IEnumerable` too early pulls all the rows into memory first.
:::

## Expression trees: how C# becomes SQL {a}

In [Episode 4](ch:delegates-events#the-same-lambda-compiled-two-ways-expression-trees) you saw that a lambda assigned to `Expression<Func<…>>` isn't compiled into runnable code. It becomes an **expression tree**, an object graph that describes the code. `IQueryable.Where` asks for exactly that, so EF Core can **read your lambda like data** and write SQL from it.

![An expression tree being built from a lambda, then walked node by node to produce SQL](visuals/expression-tree.svg)

The best way to believe it is to build a tiny EF Core yourself. This walks the tree and writes a `WHERE` clause:

```csharp
using System.Linq.Expressions;

Expression<Func<Order, bool>> filter = o => o.Total > 100 && o.Country == "GB";
Console.WriteLine($"tree: {filter.Body}");
Console.WriteLine($"SQL:  WHERE {ToSql(filter.Body)}");

Expression<Func<Order, bool>> custom = o => Rules.IsVip(o);
try { ToSql(custom.Body); }
catch (NotSupportedException ex) { Console.WriteLine($"error: {ex.Message}"); }   // EF says "could not be translated"

static string ToSql(Expression e) => e switch
{
    BinaryExpression b   => $"({ToSql(b.Left)} {Op(b.NodeType)} {ToSql(b.Right)})",
    MemberExpression m   => $"[{m.Member.Name}]",                     // property → column
    ConstantExpression c => c.Value is string s ? $"'{s}'" : $"{c.Value}",
    _ => throw new NotSupportedException($"can't translate a {e.NodeType} node to SQL"),
};

static string Op(ExpressionType t) => t switch
{
    ExpressionType.AndAlso => "AND", ExpressionType.OrElse => "OR", ExpressionType.Equal => "=",
    ExpressionType.GreaterThan => ">", ExpressionType.LessThan => "<",
    _ => throw new NotSupportedException(t.ToString()),
};

static class Rules { public static bool IsVip(Order o) => o.Total > 1000; }
record Order(decimal Total, string Country);
```

That's the real mechanism, minus a few thousand edge cases. Two details matter in the real EF Core:

- **Captured values become SQL parameters** (`@__country_0`), never text pasted into the SQL. That's why LINQ queries are naturally safe from SQL injection.
- **Only translatable code works.** Calling your own C# method inside a query is a node EF can't turn into SQL. Since EF Core 3 that throws "could not be translated", like the `IsVip` example above. Older versions silently pulled the whole table into memory instead.

Because an `IQueryable` is just a tree waiting to grow, you can build it up conditionally, and the database still receives **one** query:

```csharp norun
IQueryable<Product> q = db.Products;
if (filter.MinPrice is { } min) q = q.Where(p => p.Price >= min);
if (!string.IsNullOrEmpty(filter.Search)) q = q.Where(p => p.Name.Contains(filter.Search));
return await q.ToListAsync();   // one SQL query, with only the filters that were supplied
```

:::qa How does EF Core translate LINQ to SQL?
`IQueryable` operators take `Expression<Func<…>>`, so the compiler builds expression trees instead of delegates. EF Core walks the combined tree with expression visitors, maps entities and members to tables and columns, turns captured variables into SQL parameters, and generates SQL for the provider. Anything it can't translate throws, rather than being run silently on the client.
:::

## Performance notes {a}

- LINQ to Objects allocates small objects (enumerators, delegates, closures). In normal business code that cost is negligible. In true hot paths (millions of items per request) a plain `for` loop over an array or span can be several times faster.
- **`Any()`** stops at the first match. `Count() > 0` may walk everything. (On a `List`, `Count` is a stored number, so it's free either way.)
- Use **`MinBy` / `MaxBy`**, not `OrderBy(...).First()`.
- Each `.ToList()` in the middle of a chain makes a full copy. Only materialise at the end, or when you need the results more than once.
- Newer .NET versions make many operators faster (`Sum`, `Min` and `Max` over arrays use SIMD). Upgrading is often a free speed-up.

:::qa Any() vs Count() > 0?
`Any()` stops at the first element, so it's O(1) for this check. `Count()` may enumerate the whole sequence, although it uses the stored `Count` for collections. On EF Core, `Any()` translates to `EXISTS`, which is cheaper than `COUNT`. Prefer `Any()` for existence checks.
:::

:::qa Is LINQ slow?
For typical business code, no: its overhead is small and newer .NET versions optimise many operators. It allocates enumerators and delegates, so in extremely hot paths hand-written loops over arrays or spans can be faster. Measure with BenchmarkDotNet before rewriting.
:::

## Next episode {b}

Kettle's reports are now a few readable lines each. Then the payment provider has a bad afternoon. Halfway through checkout, the charge call fails. The order is half-saved, the stock is already reserved, and a database connection is left open, again and again, until the pool runs dry and the whole site stops. You need a way to **fail cleanly** and to **always clean up**: [Episode 7 · Exceptions →](ch:exceptions-disposal)

## Further reading

- [Language Integrated Query (LINQ)](https://learn.microsoft.com/en-us/dotnet/csharp/linq/)
- [Deferred execution and lazy evaluation](https://learn.microsoft.com/en-us/dotnet/standard/linq/deferred-execution-lazy-evaluation)
- [Expression trees](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/expression-trees/)
- [How EF Core queries work](https://learn.microsoft.com/en-us/ef/core/querying/how-query-works)

## Verify this chapter

```csharp
using System.Linq.Expressions;

// deferred: nothing runs until enumeration, and it re-runs every time
int runs = 0;
var src = new List<int> { 1, 2, 3 };
var q = src.Where(x => { runs++; return x > 1; });
Check(runs == 0, "building a query runs nothing");
src.Add(4);
Check(q.Count() == 3 && runs == 4, "the query sees items added after it was built");
q.Count();
Check(runs == 8, "a second enumeration runs the whole query again");

// streaming: Take stops early
int pulled = 0;
var firstTwo = Enumerable.Range(1, 1_000).Where(x => { pulled++; return true; }).Take(2).ToList();
Check(pulled == 2, "Take(2) stops pulling after two items");

// First vs Single
var dup = new[] { 1, 1 };
Check(dup.First() == 1, "First returns the first of several matches");
Check(Throws(() => dup.Single()), "Single throws when there are several matches");
Check(Array.Empty<int>().FirstOrDefault() == 0, "FirstOrDefault returns default when there are none");

// ToLookup: a missing key gives an empty sequence
Check(new[] { 1, 2 }.ToLookup(x => x % 2)[99].Any() == false, "a lookup returns empty for a missing key");

// yield return is lazy (an infinite sequence is fine)
Check(Naturals().Take(3).SequenceEqual(new[] { 0, 1, 2 }), "a yield-based infinite sequence works with Take");

// expression trees are data
Expression<Func<int, bool>> e = x => x > 5;
Check(e.Body is BinaryExpression { NodeType: ExpressionType.GreaterThan }, "a lambda can become an inspectable tree");

static IEnumerable<int> Naturals() { for (int i = 0; ; i++) yield return i; }
static bool Throws(Action a) { try { a(); return false; } catch (InvalidOperationException) { return true; } }
static void Check(bool ok, string claim) =>
    Console.WriteLine(ok ? $"OK: {claim}" : throw new Exception($"FAIL: {claim}"));
```
