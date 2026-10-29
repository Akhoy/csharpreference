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

## Words you'll meet

| Word | In plain words |
|---|---|
| **LINQ** | A set of ready-made methods (`Where`, `Select`, `GroupBy`…) for asking questions of a sequence. |
| **operator** | One of those methods. |
| **predicate** | A test that returns true or false, like `o => o.Paid`. |
| **deferred execution** | Building a query runs nothing. It runs when something loops over it. |
| **materialise** | Run a query and store the results, with `ToList()` or `ToArray()`. |
| **iterator** | A method using `yield return`, which hands out items one at a time, on demand. |
| **`IQueryable`** | A query that's translated (to SQL, say) and run somewhere else, such as the database. |
| **provider** | The thing that does that translation, such as EF Core. |
| **expression tree** | A lambda stored as data, so a provider can read it. |

## Previously, and the problem {b}

In [Episode 5](ch:collections) Kettle got fast lookups. Now the owner wants a report: *the top 3 customers by money spent on paid orders*. Here's the loop version:

:::walk The loop version: every step by hand
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
@1 | orders = 6 orders (#3 unpaid)
Six orders. Ada's Rooibos order (#3) isn't paid, so it mustn't count.
@3 | totals = { }
A temporary dictionary to add up each customer's spending.
@4-9 | totals = { Ada → 30, Bob → 37, Cy → 55, Di → 9 }
Loop over every order: skip unpaid ones, read the running total (`TryGetValue` gives 0 the first time), add this order. Ada's unpaid £18 was skipped.
@10 | totals = { Ada → 30, Bob → 37, Cy → 55, Di → 9 } ; sorted = [Ada 30, Bob 37, Cy 55, Di 9]
Copy the dictionary into a list, because a dictionary can't be sorted.
@11 | sorted = [Cy 55, Bob 37, Ada 30, Di 9]
Sort it, biggest first. `b.Value.CompareTo(a.Value)` is backwards on purpose, to get descending order. That's easy to get wrong.
@12-13 | sorted = [Cy 55, Bob 37, Ada 30, Di 9] ; i = 0…2 | > Cy: £55 | > Bob: £37 | > Ada: £30
Print the first three, with `Math.Min` in case there are fewer than three customers. That's 11 lines of mechanics for one sentence of meaning.
:::

It works, but the *meaning* ("paid orders, grouped by customer, totalled, top 3") is buried. All you can see is mechanics: a temporary dictionary, `TryGetValue`, a copy, a sort, an index loop. Every new report means another 15 lines of the same kind of thing.

## The lightbulb: describe the result {b}

Here's the same report written as a description of what you want:

:::walk The LINQ version: say what you want
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
@1-6 | top3 = a query (nothing has run yet)
This builds a **query**: a description of the work. No order has been looked at yet. (The next section is all about why.)
@8 | top3 = a query (nothing has run yet)
The `foreach` asks for results, so now the work happens. Here's what each line does with the data.
@2 | after Where = [#1 Ada 30, #2 Bob 12, #4 Cy 55, #5 Bob 25, #6 Di 9]
`Where` keeps the orders for which your lambda says `true`. Order #3 is dropped.
@3 | after GroupBy = Ada [30], Bob [12, 25], Cy [55], Di [9]
`GroupBy` sorts them into piles, one per customer. Each pile's label is its `Key`.
@4 | after Select = [Ada 30, Bob 37, Cy 55, Di 9]
`Select` turns each pile into one small object: the name and the pile's total.
@5 | after OrderByDescending = [Cy 55, Bob 37, Ada 30, Di 9]
Biggest first. No backwards comparison to get wrong.
@6 | after Take = [Cy 55, Bob 37, Ada 30]
Keep three. If there were only two customers, you'd simply get two.
@8 | | > Cy: £55 | > Bob: £37 | > Ada: £30
Same answer as the loop. But each line now reads like the request: paid orders, by customer, totalled, biggest first, top 3.
:::

Each line reads like the spec. This is **LINQ**, short for **Language Integrated Query**. It isn't special syntax built into the compiler. It's a library of **extension methods** on `IEnumerable<T>` (in `System.Linq`). Each one takes a **delegate**, the lambda, which is the "slot for behaviour" from [Episode 4](ch:delegates-events). `Where` loops for you and calls your lambda to decide what to keep.

:::scene visuals/scenes/linq-inside-where.svg | What `Where` really is
1. `orders.Where(o => o.Paid)` looks like special syntax. It's just a method call.
2. `Where` is an ordinary method in `System.Linq`. The `this` on its first parameter makes it an **extension method**, which is why you can call it with a dot on any sequence.
3. Inside is a plain `foreach` and an `if`. Your lambda is plugged in as the **predicate**, the test in that `if`.
4. That's all LINQ is: ordinary methods with the loop already written. You only supply the part that changes, as a delegate, like the discount slot in Episode 4.
:::

The same vocabulary works on lists, arrays, dictionaries and, with EF Core, **database tables**, where it becomes SQL. That last part is the real superpower, and it's covered at the end of this chapter.

### Two spellings, one query

:::walk Two spellings, one query
```csharp
int[] prices = [12, 30, 8, 55];

var a = from p in prices where p > 10 orderby p select p * 2;     // query syntax
var b = prices.Where(p => p > 10).OrderBy(p => p).Select(p => p * 2);   // method syntax

Console.WriteLine(string.Join(",", a) + " = " + string.Join(",", b));
```
@1 | prices = [12, 30, 8, 55]
Four prices.
@3 | prices = [12, 30, 8, 55] ; a = query: where > 10, order, double
**Query syntax** looks a bit like SQL. The compiler rewrites it into method calls…
@4 | prices = [12, 30, 8, 55] ; a = query: where > 10, order, double ; b = the same query
…exactly these ones. `a` and `b` compile to the same thing.
@6 | | > 24,60,110 = 24,60,110
8 is filtered out, the rest are sorted (12, 30, 55) and doubled.
:::

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

Kettle learned this the hard way. A botched import created two orders with the same ID. The refund page used `First`, so it quietly refunded whichever one came first, which was the wrong customer. With `Single` it would have crashed on the first try, and someone would have found the duplicate that day:

:::walk First shrugs, Single shouts
```csharp
var orders = new[] { new Order(1, "Ada"), new Order(2, "Bob"), new Order(2, "Cy (imported twice!)") };

Console.WriteLine(orders.First(o => o.Id == 2).Customer);
Console.WriteLine(orders.FirstOrDefault(o => o.Id == 9)?.Customer ?? "none");

try { orders.Single(o => o.Id == 2); }
catch (InvalidOperationException) { Console.WriteLine("Single: two orders with ID 2. Data bug!"); }

record Order(int Id, string Customer);
```
@1 | orders = [#1 Ada, #2 Bob, #2 Cy]
Three orders, and two of them share ID 2. That should be impossible.
@3 | | > Bob
`First` stops at the first match and returns it. It doesn't look further, so it never notices the duplicate.
@4 | | > none
`FirstOrDefault` returns `null` when nothing matches, instead of throwing. `?.` and `??` turn that into "none".
@6 | orders = [#1 Ada, #2 Bob, #2 Cy]
`Single` keeps looking after the first match, to make sure there isn't a second one.
@7 | | > Single: two orders with ID 2. Data bug!
It finds Cy's order and throws. That's what you want for a lookup by a key that's supposed to be unique: a loud failure the first time, not a quiet wrong answer forever.
:::

### SelectMany, GroupBy, ToLookup and Join on Kettle data

Two of these trip people up, so here they are in pictures first:

:::scene visuals/scenes/linq-selectmany.svg | Select vs SelectMany
1. `Select(o => o.Teas)` gives one result per order, and each result is itself a list. You end up with a list *of lists*.
2. `SelectMany(o => o.Teas)` **flattens** them: one list of every tea from every order. Many lists become one.
3. Now counting, grouping and de-duplicating are easy. An overload also keeps the parent if you need it: `SelectMany(o => o.Teas, (o, t) => (o.Id, t))`.
:::

:::scene visuals/scenes/linq-groupby.svg | GroupBy: sorting into labelled piles
1. Start with a flat list of paid orders, in any order.
2. `GroupBy(o => o.Customer)` sorts them into **piles**, one per customer. Each pile is a *group*, and its label is the **`Key`**.
3. Then `Select` turns each pile into one result, such as the customer's name and the sum of their pile.
4. Sort the results and take three: that's the whole top-3 report from the start of the chapter.
:::

:::walk Flatten, group, look up and join
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
@1-7 | orders = [#1 (cust 10): Sencha, Assam / #2 (cust 20): Rooibos / #3 (cust 10): Sencha] ; customers = [10 Ada, 20 Bob]
Three orders, each with a list of teas, and two customers.
@10 | | > Sencha, Assam, Rooibos, Sencha
`SelectMany` takes each order's tea list and **flattens** them into one sequence. `Select` would have given three separate lists.
@13 | g = Sencha [Sencha, Sencha]
Group the flattened teas by name. Each group is a pile with a `Key`.
@14 | g = Sencha [Sencha, Sencha] | > Sencha × 2 | > Assam × 1 | > Rooibos × 1
One line per pile. Groups come out in the order their key was first seen.
@17 | byCustomer = lookup { 10 → [#1, #3], 20 → [#2] }
`ToLookup` builds the groups **now** (not lazily) and indexes them by key, like a dictionary of lists.
@18 | | > customer 10 has 2 orders, customer 99 has 0
The difference from a dictionary: a missing key gives an **empty** sequence, not an exception.
@21-23 | rows = query: orders matched to customers by ID
`join … on … equals …` pairs each order with the customer whose `Id` matches its `CustomerId`.
@24 | | > order 1 → Ada; order 2 → Bob; order 3 → Ada
:::

:::qa What's the difference between First, FirstOrDefault, Single and SingleOrDefault?
`First` returns the first match and throws if there's none. `FirstOrDefault` returns default instead of throwing. `Single` asserts there is exactly one match and throws if there are zero or several. `SingleOrDefault` returns default for zero matches but still throws for several. Use `Single` when duplicates would mean a bug, and `First` when you only want any or the top item.
:::

:::qa Select vs SelectMany?
`Select` maps each element to one result, so a sequence of orders becomes a sequence of line lists. `SelectMany` maps each element to a sequence and flattens them all into one sequence, such as every line of every order. An overload keeps the parent available alongside each child.
:::

## Deferred execution: a recipe, not a meal {i}

:::plain
A LINQ query is a set of instructions, not a result. Nothing happens until something asks for the items, and it happens all over again every time something asks.
:::

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

:::walk When does the lambda run?
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
@1 | prices = [5, 20, 40]
Three prices in a list.
@2 | prices = [5, 20, 40] ; expensive = a recipe: "prices where > 10"
Build the query. The lambda prints whenever it runs, so you'll see exactly when it does.
@3 | | > query built (nothing checked yet)
Nothing printed "checking". Building a query runs **nothing**.
@5 | prices = [5, 20, 40, 80] ; expensive = a recipe: "prices where > 10"
Add 80 to the list, *after* the query was written.
@7 | | >   checking 5 | >   checking 20 | >   checking 40 | >   checking 80 | > count = 3
`Count()` needs a real answer, so now the query runs. It reads the list **as it is now**, so it sees the 80.
@8 | | >   checking 5 | >   checking 20 | > first = 20
`First()` runs the query **again** from the start. It stops at the first match, 20, so 40 and 80 aren't checked this time.
@10 | snapshot = [20, 40, 80] | >   checking 5 | >   checking 20 | >   checking 40 | >   checking 80
`ToList()` runs it one more time and **keeps the results** in a real list.
@11-12 | snapshot = [20, 40, 80] | > snapshot has 3 items; reading it again checks nothing | > first = 20
Reading the list doesn't run the lambda at all. If this were a database query, that's the difference between one round trip and three.
:::

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

:::plain
`yield return` lets a method hand out its results one at a time. It gives one item, waits until the caller asks for another, then carries on from exactly where it stopped.
:::

You can write your own lazy operator. `yield return` hands **one** item to the caller and **pauses** the method right there, keeping every local variable, until the caller asks for the next item:

:::scene visuals/scenes/linq-yield.svg | Caller and iterator taking turns
1. The `foreach` asks for the first item by calling `MoveNext()`: "give me the next one".
2. The iterator runs its loop: 5 fails the test, 20 passes. It hands over **20** and **pauses** right at the `yield return`, remembering `x` and where it is in the loop.
3. Control goes back to the caller, which prints "got 20". Meanwhile the iterator is frozen mid-loop.
4. `MoveNext()` again. The iterator **resumes just after** its bookmark, checks 40, and hands it over.
5. How can a method pause halfway? The compiler rewrites it into a small object, a **state machine**, whose fields hold the loop position and the locals. Nothing runs until it's asked, which is why LINQ is lazy and why an infinite sequence is fine.
:::

:::walk Caller and iterator, taking turns
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
@6-13 | -
`KeepAbove` is a home-made `Where`. `yield return` hands over one item and **pauses** the method right there.
@1
`KeepAbove(...)` is called, but none of its body runs yet. You get back an object that will run it on demand.
@8-10 | x = 5 | >   looking at 5
The `foreach` asks for the first item, so the method starts. 5 is too small, so it isn't yielded…
@10-11 | x = 20 | >   looking at 20
…and the loop moves on to 20, which passes. `yield return 20` hands it over and **freezes** the method, remembering `x` and its place in the loop.
@2 | p = 20 | > got 20
Control is back in the caller, which prints it.
@11 | x = 20
The caller asks for the next item. The method **resumes just after** the `yield return`, exactly where it paused.
@10-11 | x = 40 | >   looking at 40
40 passes and is handed over.
@2 | p = 40 | > got 40
The source runs out, so the method ends and the `foreach` finishes. The output interleaves, because the two sides took turns.
@15-19 | (a, b) = (0, 1)
`Fibonacci` is an **infinite** loop. That's only safe because it pauses after every `yield return`.
@4 | | > 0,1,1,2,3,5,8,13,21,34
`Take(10)` asks for ten items, then stops asking, and the loop is never resumed again.
:::

The output interleaves "looking at" and "got". The loop and the method take turns. The compiler rewrites a `yield` method into a small **state machine** object that remembers where it paused. `foreach` drives it by calling `MoveNext()` again and again. Chaining `Where().Select().Take()` builds a pipeline of these, each pulling from the one before it. That's exactly the conveyor belt above.

:::qa How does yield return work?
The compiler turns an iterator method into a state-machine class that implements `IEnumerable<T>`/`IEnumerator<T>`. Each `MoveNext()` runs the method until the next `yield return`, saves its position and locals, and exposes the value as `Current`. That makes sequences lazy, including infinite ones.
:::

## Where does the query run? IEnumerable vs IQueryable {i}

:::plain
The same LINQ code can run in two places: in your app, over data you already have, or in the database, translated into SQL. The declared type of the variable decides which, and getting it wrong can download a whole table.
:::

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

:::walk Same LINQ, two very different trips
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
@1 | q = IQueryable<Order> (a query over the Orders table, not run)
`db.Orders` is an `IQueryable`. Nothing has been fetched.
@2 | q = query: WHERE Status = Paid
This `Where` is `Queryable.Where`. It takes an **expression tree**, so it adds a description to the query instead of running anything.
@3-4 | q = query: WHERE Status = Paid ORDER BY CreatedAt, TOP 20
More description: an ORDER BY and a TOP.
@5 | SQL sent = SELECT TOP(20) … WHERE Status = 1 ORDER BY CreatedAt ; rows back = 20
`ToListAsync` finally runs it. EF Core translates the whole tree into **one** SQL query, and the database sends back 20 rows.
@7 | all = IEnumerable<Order> (the same table)
Now the same table, but the variable is typed `IEnumerable<Order>`. That one word changes which `Where` the compiler picks.
@8 | SQL sent = SELECT * FROM Orders ; rows back = every order (1,000,000) ; kept = 20
This is `Enumerable.Where`, which takes a compiled delegate. EF Core can't read a delegate, so it can only fetch **the whole table** and let your C# filter it in memory. Same result, a million rows over the network.
:::

:::gotcha The silent full-table scan
Four things quietly switch a query from SQL to in-memory, with no compiler warning. Assigning it to an `IEnumerable<T>` variable. Calling `.AsEnumerable()`. Calling `.ToList()` before you've finished filtering. Or a repository method that returns `IEnumerable<T>`. Keep queries as `IQueryable` until the very last call, and `Select` only the columns you need.
:::

:::qa IEnumerable vs IQueryable?
`IEnumerable<T>` executes LINQ in memory, using compiled delegates. `IQueryable<T>` builds expression trees that a provider such as EF Core translates and executes at the source (SQL). Filtering on an `IQueryable` happens in the database. Switching to `IEnumerable` too early pulls all the rows into memory first.
:::

## Expression trees: how C# becomes SQL {a}

:::plain
To turn C# into SQL, EF Core needs to *read* your lambda, not run it. So `IQueryable` asks the compiler for the lambda as a tree of objects, which EF Core walks piece by piece to write the SQL.
:::

In [Episode 4](ch:delegates-events#the-same-lambda-compiled-two-ways-expression-trees) you saw that a lambda assigned to `Expression<Func<…>>` isn't compiled into runnable code. It becomes an **expression tree**, an object graph that describes the code. `IQueryable.Where` asks for exactly that, so EF Core can **read your lambda like data** and write SQL from it.

![An expression tree being built from a lambda, then walked node by node to produce SQL](visuals/expression-tree.svg)

The best way to believe it is to build a tiny EF Core yourself. This walks the tree and writes a `WHERE` clause:

:::walk Build a tiny EF Core
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
@3 | filter = tree: AndAlso(GreaterThan(Total, 100), Equal(Country, "GB"))
Because the type is `Expression<...>`, this lambda isn't compiled into code. It's a **tree of objects** describing it.
@4 | | > tree: ((o.Total > 100) AndAlso (o.Country == "GB"))
@5
Hand the tree's body to `ToSql`.
@13 | e = AndAlso node
The top node is a `BinaryExpression` (two sides and an operator). So translate the left side, the operator and the right side.
@13 | e = GreaterThan node
The left side is another binary node, `Total > 100`.
@14 | e = Member node (Total)
`o.Total` is a `MemberExpression`. A property becomes a column: `[Total]`.
@15 | e = Constant node (100)
`100` is a `ConstantExpression`, so it's written as a value. Then the same for `Country == "GB"`.
@5 | | > SQL:  WHERE (([Total] > 100) AND ([Country] = 'GB'))
The pieces come back up the tree and join into SQL. This is what EF Core does, with a lot more node types.
@7-8 | custom = tree: Call(Rules.IsVip, o)
Now a lambda that calls your own C# method.
@16 | e = Call node
There's no SQL for "call `Rules.IsVip`", because the database can't run C#. So the translator gives up.
@9 | | > error: can't translate a Call node to SQL
That's EF Core's "could not be translated" error, and now you know exactly where it comes from.
:::

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
`IQueryable` operators take `Expression<Func<…>>`, so the compiler builds expression trees instead of delegates. EF Core walks the combined tree with expression visitors. It maps entities and members to tables and columns, turns captured variables into SQL parameters, and generates the SQL. Anything it can't translate throws, rather than being run silently on the client.
:::

## Performance notes {a}

:::plain
LINQ is fast enough for almost all business code. The traps are doing more work than you meant to: sorting everything to keep one item, or running the same query twice.
:::

- LINQ to Objects allocates small objects (enumerators, delegates, closures). In normal business code that cost is negligible. In true hot paths (millions of items per request) a plain `for` loop over an array or span can be several times faster.
- **`Any()`** stops at the first match. `Count() > 0` may walk everything. (On a `List`, `Count` is a stored number, so it's free either way.) Here's the difference, counted:

:::walk Count every order each one touches
```csharp
var orders = Enumerable.Range(1, 10_000).Select(i => new Order(i, i % 500)).ToList();

int touched = 0;
IEnumerable<Order> Watched() { foreach (var o in orders) { touched++; yield return o; } }

bool any = Watched().Any(o => o.Total > 100);
Console.WriteLine($"Any:   touched {touched:N0} orders");

touched = 0;
bool count = Watched().Count(o => o.Total > 100) > 0;
Console.WriteLine($"Count: touched {touched:N0} orders");

record Order(int Id, decimal Total);
```
@1 | orders = 10,000 orders (totals 0 to 499)
Ten thousand orders.
@3-4 | touched = 0
A small iterator that hands out the orders one by one and counts how many it handed out.
@6 | touched = 101 ; any = true
`Any` asks "is there at least one over £100?". Order #101 is the first, so it stops there.
@7 | | > Any:   touched 101 orders
@10 | touched = 10,000 ; count = true
`Count(...) > 0` asks the same question in a worse way. `Count` has to see **every** order to count them all, and only then do you compare with 0.
@11 | | > Count: touched 10,000 orders
Same answer, a hundred times more work. Against a database, `Any` becomes `EXISTS`, which can also stop at the first row.
:::
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

Kettle's reports are now a few readable lines each. Then the payment provider has a bad afternoon. Halfway through checkout, the charge call fails. The order is half-saved and the stock is already reserved. Worse, a database connection is left open each time, until the pool runs dry and the whole site stops. You need a way to **fail cleanly** and to **always clean up**: [Episode 7 · Exceptions →](ch:exceptions-disposal)

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
