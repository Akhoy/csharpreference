---
id: advanced-csharp-exprtrees
title: "Build the Query as Data: Expression Trees by Hand"
summary: "14:00: the owner wants an admin screen that filters orders by any field chosen from a dropdown, run as real SQL, with no SQL-injection hole. Building the same tree of objects the compiler builds from a lambda, by hand, from whatever the admin picked, is how EF Core stays both flexible and safe. Seventh of eight chapters on advanced C#."
layer: language
where: C# language › Advanced & low-level features › Expression trees
fits: The compiler side of [LINQ's deferred execution and IQueryable](ch:linq#where-does-the-query-run-ienumerable-vs-iqueryable): EF Core reads a tree the compiler built from your lambda, and this chapter builds that same tree by hand. `Activator.CreateInstance` in [reflection](ch:advanced-csharp-reflection) is the slow version of what a compiled expression tree does fast.
levels: a
prereqs: advanced-csharp-codegen
next: advanced-csharp-simd
---

:::plain
When the filters are chosen at runtime, build the query the same way the compiler builds a lambda, as a tree of small pieces. EF Core can still turn that tree into safe SQL.
:::

## Start from zero: the same lambda, compiled two ways

Write `o => o.Total > 50` and the compiler can turn it into one of two completely different things, depending on the type you assign it to:

| Assigned to | The compiler produces | What you can do with it |
|---|---|---|
| `Func<Order, bool>` | **IL code**, a normal method | Call it. You can't look inside. |
| `Expression<Func<Order, bool>>` | **Code that builds a tree** of objects describing the lambda | Read it, change it, translate it to SQL, or compile it into a `Func` later |

The tree for `o => o.Total > 50` is a handful of objects: a `Lambda` with one `Parameter` (`o`), whose body is a `GreaterThan` node, with a `Property` node (`o.Total`) on the left and a `Constant` node (`50`) on the right. EF Core walks that tree and writes SQL. LINQ to Objects doesn't need one, because it just calls the delegate.

In this act you build the tree yourself, from pieces, because the pieces aren't known until the admin picks them.

Afternoon. The owner wants an admin screen to **filter orders by any field**, chosen from dropdowns. For example "Total > 50 **and** Country = GB", or "Status = Unpaid **and** Total > 200". And it must run as **SQL** in the database, not by loading every order into memory ([Episode 6](ch:linq#where-does-the-query-run-ienumerable-vs-iqueryable)).

You can't write a lambda for every combination. Gluing SQL strings together (`"WHERE " + field + " > " + value`) is a textbook **SQL injection** hole.

**The lightbulb:** in Episode 6, EF Core *read* an expression tree that the compiler built from your lambda. Nothing stops **you** from building that tree yourself, node by node, from whatever the user picked. The `System.Linq.Expressions` API is a **code factory**. `Expression.Property`, `Expression.Constant`, `Expression.GreaterThan` and `Expression.AndAlso` assemble an `Expression<Func<Order, bool>>` at runtime. It's the same tree the compiler would have built from `o => o.Total > 50 && o.Country == "GB"`.

:::scene visuals/scenes/adv-exprbuild.svg | From dropdowns to a safe SQL query
1. The admin screen produces filter **rows** at runtime: `Total > 50`, `Country = "GB"`. You can't write a lambda in advance for every combination.
2. Each row becomes a few **nodes**: a `Property` access, a `Constant` value, and a comparison such as `GreaterThan`.
3. The rows are joined with `AndAlso` into **one** `Expression<Func<Order,bool>>`, the same tree the compiler would build from a lambda.
4. Use it two ways. `.Compile()` turns it into a delegate for in-memory lists. Or pass the tree to `db.Orders.Where(...)`, and EF Core writes the SQL itself.
5. Why not just build a SQL string? `"WHERE " + userInput` is SQL injection waiting to happen. In a tree, whatever the user typed is only ever a value node. EF Core formats it into the SQL itself, by its type, so it can never become SQL syntax.
:::

:::walk Build the query from what the admin picked
```csharp
using System.Globalization;
using System.Linq.Expressions;

var orders = new[] { new Order(1, 80m, "GB"), new Order(2, 30m, "GB"), new Order(3, 120m, "FR") };
Filter[] fromScreen = [new("Total", ">", "50"), new("Country", "=", "GB")];   // what the admin picked

Expression<Func<Order, bool>> where = Build(fromScreen);
Console.WriteLine($"built: {where}");

var matches = orders.Where(where.Compile());          // in memory: compile the tree to a delegate
Console.WriteLine("matches: " + string.Join(", ", matches.Select(o => $"#{o.Id}")));
// With EF Core you'd pass the tree itself:  db.Orders.Where(where)  → SQL with parameters

static Expression<Func<Order, bool>> Build(Filter[] rows)
{
    string[] allowed = ["Total", "Country", "Id"];                    // never let the screen reach any property
    var o = Expression.Parameter(typeof(Order), "o");
    Expression? body = null;
    foreach (var r in rows)
    {
        if (!allowed.Contains(r.Field)) throw new ArgumentException($"can't filter on {r.Field}");
        var prop = Expression.Property(o, r.Field);                                        // o.Total
        var value = Expression.Constant(Convert.ChangeType(r.Value, prop.Type, CultureInfo.InvariantCulture), prop.Type);   // 50m
        Expression test = r.Op switch
        {
            ">" => Expression.GreaterThan(prop, value),
            "<" => Expression.LessThan(prop, value),
            "=" => Expression.Equal(prop, value),
            _ => throw new NotSupportedException(r.Op),
        };
        body = body is null ? test : Expression.AndAlso(body, test);  // join rows with &&
    }
    return Expression.Lambda<Func<Order, bool>>(body ?? Expression.Constant(true), o);
}

record Order(int Id, decimal Total, string Country);
record Filter(string Field, string Op, string Value);
```
@4-5 | orders = [#1 £80 GB, #2 £30 GB, #3 £120 FR] ; fromScreen = [Total > 50, Country = GB]
Three orders, and two filter rows that came from dropdowns at runtime.
@7
Build a filter from the rows.
@16-18 | o = parameter "o" (an Order) ; body = null
`Expression.Parameter` makes the `o` in `o => …`. `body` will hold the condition as it grows.
@21-22 | r = Total > 50 ; prop = o.Total
First row. "Total" is on the allowed list. `Expression.Property` makes the node for `o.Total`.
@23 | r = Total > 50 ; prop = o.Total ; value = 50 (a decimal constant)
The user's text "50" is converted to the property's type and becomes a **constant node**. It's data, never code, which is what keeps this safe from injection.
@24-26 | test = (o.Total > 50)
`>` picks `Expression.GreaterThan`.
@31 | body = (o.Total > 50)
It's the first row, so it becomes the whole body.
@21-28 | r = Country = GB ; test = (o.Country == "GB")
Second row: the same steps, with `Equal`.
@31 | body = ((o.Total > 50) AndAlso (o.Country == "GB"))
Join it to what's there with `AndAlso`, which is `&&`.
@33 | where = o => ((o.Total > 50) AndAlso (o.Country == "GB"))
Wrap the body and the parameter into a lambda. This is exactly the tree the compiler would build from writing that lambda by hand.
@8 | | > built: o => ((o.Total > 50) AndAlso (o.Country == "GB"))
@10-11 | matches = [#1] | > matches: #1
`Compile()` turns the tree into a delegate for in-memory filtering. Only order 1 is over £50 *and* in GB. With EF Core you'd pass the tree to `db.Orders.Where(where)` instead, and EF Core would write the SQL. How the `50` and `'GB'` appear in that SQL turns out to matter; see *Expression trees in depth* below.
:::

Two cautions:

- **Whitelist the fields.** Without the `allowed` list, a crafted request could filter on any property, including internal ones.
- **`.Compile()` is expensive** (milliseconds), and under Native AOT it falls back to a slower interpreter. Cache compiled delegates. For EF Core you don't compile at all, because EF reads the tree.

The same trick powers object mappers and ORMs. They build a property-reading tree once per type, compile it and cache the delegate. From then on it runs as fast as hand-written code. That's the reflection "bill" from Act 5, paid once instead of on every call.

## Expression trees in depth {a}

**Constants become literals, and that fills EF Core's cache.** When EF Core translates a tree, it treats two kinds of value differently:

| In the tree | Where it comes from | In the SQL |
|---|---|---|
| A `Constant` node | `Expression.Constant(50m)`, or a literal written in a lambda | inlined as a **literal**: `WHERE Total > 50.0` |
| A member access on a captured variable | a lambda that uses a local variable, e.g. `o => o.Total > minimum` | sent as a **parameter**: `WHERE Total > @minimum` |

Literals are still injection-safe, because EF formats each value by its type rather than pasting text. But every different value produces a **different SQL string**. EF Core caches a compiled query per distinct tree shape and value, and the database caches an execution plan per distinct SQL text. A filter screen used with thousands of different values fills both caches with near-identical entries. For values that change per request, make them look like captured variables:

```csharp norun
// A tiny box. Reading .Value from it is a member access, which EF Core turns into a parameter
sealed record Box<T>(T Value);

static Expression AsParameter<T>(T value) =>
    Expression.Property(Expression.Constant(new Box<T>(value)), nameof(Box<T>.Value));
```

Use constants only for values that really are fixed, such as an enum value the code always filters on.

**Combining two trees needs a visitor.** Suppose you have `isPaid = o => o.Paid` and `isBig = o => o.Total > 100`, and want both. The two lambdas each have their **own** `o` parameter object. Gluing their bodies with `AndAlso` produces a tree that mentions two different `o`s, and most providers reject it. An **`ExpressionVisitor`** walks a tree and rebuilds it with changes. Here, it swaps one lambda's parameter for the other's:

```csharp
using System.Linq.Expressions;

Expression<Func<Order, bool>> isPaid = o => o.Paid;
Expression<Func<Order, bool>> isBig = x => x.Total > 100;
var both = And(isPaid, isBig);
Console.WriteLine(both);   // o => (o.Paid AndAlso (o.Total > 100))

var orders = new[] { new Order(true, 150), new Order(true, 20), new Order(false, 300) };
Console.WriteLine(orders.Count(both.Compile()));   // 1

static Expression<Func<T, bool>> And<T>(Expression<Func<T, bool>> a, Expression<Func<T, bool>> b)
{
    var p = a.Parameters[0];
    var bBody = new SwapParameter(b.Parameters[0], p).Visit(b.Body);   // b's body, rewritten to use a's parameter
    return Expression.Lambda<Func<T, bool>>(Expression.AndAlso(a.Body, bBody), p);
}

sealed class SwapParameter(ParameterExpression from, ParameterExpression to) : ExpressionVisitor
{
    protected override Expression VisitParameter(ParameterExpression node) => node == from ? to : node;
}

record Order(bool Paid, decimal Total);
```

The same pattern, a visitor that rewrites one kind of node, is how EF Core itself works internally: dozens of visitors, each translating or simplifying one part of the tree.

**What a lambda can't contain.** The compiler only converts **expression** lambdas into trees, and only a subset of C#. Lambdas with statement bodies, assignments, `?.`, throw expressions and some newer syntax won't convert, and you get a compile error such as CS8072 for `?.`. The `Expression` API itself is broader (`Expression.Block`, `Expression.Loop`, assignments), so hand-built trees can do more than lambdas can. LINQ providers like EF Core only translate the query-shaped subset, though.

**Compiling, and caching what you compile.** `Compile()` generates IL, which takes a noticeable fraction of a millisecond. Cache the delegate per shape, never per call. Under Native AOT there's no run-time code generation, so `Compile()` returns an **interpreter** over the tree instead. It's correct, but much slower.

:::qa Follow-up: why might a dynamic filter built from Expression.Constant hurt performance in EF Core?
EF Core inlines `ConstantExpression` values as SQL literals, so every distinct value produces distinct SQL. That defeats both EF Core's compiled-query cache and the database's plan cache, which fill with near-identical entries. Values that vary per request should appear as member accesses on a closure-like object, so EF Core sends them as parameters and reuses one plan.
:::

:::qa Follow-up: how do you combine two predicate expressions?
Take the first lambda's parameter, rewrite the second lambda's body so it uses that parameter (with an `ExpressionVisitor` that replaces `ParameterExpression` nodes), then join the bodies with `Expression.AndAlso` or `OrElse` and wrap them in a new lambda. Wrapping the second lambda in `Expression.Invoke` works in memory but produces a tree many LINQ providers can't translate.
:::

:::qa How would you build a dynamic, injection-safe filter for EF Core?
Build an `Expression<Func<T,bool>>` with the `System.Linq.Expressions` API (`Parameter`, `Property`, `Constant`, comparisons, `AndAlso`) from the user's choices, whitelisting which properties may be filtered, and pass it to `IQueryable.Where`. EF Core translates the tree to SQL and formats the values itself, so user input never becomes SQL syntax. Raw `Expression.Constant` values are inlined as SQL literals, so for values that vary per request, put them behind a member access (as a closure does) so EF sends them as parameters and reuses one cached query plan. Conditionally chaining `.Where` calls on an `IQueryable` also works when the set of filters is fixed.
:::

## Verify this chapter

```csharp
using System.Linq.Expressions;

var p = Expression.Parameter(typeof(Order), "o");
var tree = Expression.Lambda<Func<Order, bool>>(
    Expression.AndAlso(Expression.GreaterThan(Expression.Property(p, "Total"), Expression.Constant(50m)),
                       Expression.Equal(Expression.Property(p, "Country"), Expression.Constant("GB"))), p);
var hits = new[] { new Order(80m, "GB"), new Order(30m, "GB"), new Order(90m, "FR") }.Where(tree.Compile()).Count();
Check(hits == 1, "a hand-built tree compiles to a working filter");
object boxed = "tea";
Check(boxed.GetType() == typeof(string), "GetType returns the run-time type, not the declared one");

static void Check(bool ok, string claim) =>
    Console.WriteLine(ok ? $"OK: {claim}" : throw new Exception($"FAIL: {claim}"));

record Order(decimal Total, string Country);
```
