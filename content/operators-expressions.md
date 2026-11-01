---
id: operators-expressions
title: "Operators, Expressions and Statements: The Small Print of C#"
summary: "The everyday syntax interviewers use to check you've really read the language: expressions vs statements, precedence and evaluation order, short-circuiting, the null operators (?., ??, ??=, !), increments, operator overloading and conversion operators done safely, switch statements vs expressions, what foreach, using and lock really compile to, and tuples vs anonymous types."
layer: language
where: C# language › Operators, expressions and statements
fits: "A companion to [Types](ch:type-system) and [Everyday types](ch:everyday-types). Pattern matching and switch expressions get their full story in [Modern C#](ch:modern-csharp); equality contracts in [Types](ch:type-system#equality-the-same-means-three-things)."
levels: b,i,a
prereqs: everyday-types
next: oop
---

## The 30-second version

- An **expression** produces a value (`price * qty`); a **statement** does something (`if`, `return`, a declaration). Expression-bodied members and switch expressions let more code be expressions.
- **Precedence** decides grouping (`*` before `+`, `&&` before `||`); **evaluation order** is always left to right.
- `&&` and `||` **short-circuit**: the right side runs only if needed. `&` and `|` always evaluate both sides.
- `?.` stops at null, `??` supplies a fallback, `??=` assigns only when null, and `!` only silences a compiler warning: it checks nothing.
- Overload operators only where the meaning is obvious (money, vectors), keep `==`, `Equals` and `GetHashCode` consistent, and make lossy conversions `explicit`.
- `foreach`, `using` and `lock` are **compiler rewrites** into simpler code, which explains their rules.
- **Tuples** are mutable value types with names that vanish at run time; **anonymous types** are immutable reference types with value equality, for use inside one method.

## Words you'll meet

| Word | In plain words |
|---|---|
| **expression** | Code that produces a value. |
| **statement** | Code that performs an action, like a loop or a return. |
| **precedence** | Which operator groups first when there are no brackets. |
| **associativity** | Which side groups first when the same operator repeats: `10 - 4 - 3` is `(10 - 4) - 3`. |
| **short-circuit** | Skipping the right-hand side because the left already decides the answer. |
| **lifted operator** | An operator on `int?` that gives `null` if either side is null. |
| **lowering** | The compiler rewriting a convenient construct into simpler code before compiling it. |

:::note What you need first
- **[Everyday Types: Numbers, Text, Dates and IDs Done Right](ch:everyday-types)**: strings are immutable, `decimal` is for money, `DateTimeOffset` for moments in time, and parsing must state its culture.
:::

## Previously at Kettle {b}

Kettle's numbers, strings and dates are under control. Code review keeps finding small things, though: a discount check that called an expensive service even when it didn't need to, a `!` that hid a null until production, a `Money` type where `==` and `Equals` disagreed, and a tuple whose field names "disappeared" when it was serialised.

**The problem:** none of these are design flaws. They're the small print of the language.

**This episode:** operators, expressions and statements, read carefully.

## Expressions vs statements {b}

:::plain
An expression is a question with an answer, like `2 + 3`. A statement is an instruction, like "repeat this ten times". C# keeps letting you write more things as expressions, because expressions are shorter and can't forget to produce a value.
:::

```csharp norun
// statements
string label;
if (order.Total > 100) label = "free shipping";
else label = "standard";

// the same as one expression
string label = order.Total > 100 ? "free shipping" : "standard";

// switch expression: every case produces a value, and the compiler warns if a case is missing
string band = order.Total switch { > 500 => "gold", > 100 => "silver", _ => "standard" };

// expression-bodied member
public decimal Vat => Total * 0.2m;
```

The switch **expression** is not just shorter than the switch **statement**. It must produce a value on every path, so the compiler warns about unhandled cases, for example when you add a new enum member ([Modern C#](ch:modern-csharp#pattern-matching-test-the-shape-of-a-value)). The switch **statement** still has its place when each case does several things. Its rules: no fall-through from one case into the next (each section must end with `break`, `return`, `throw` or `goto case`), but several labels can share one section.

## Precedence and evaluation order {b}

:::walk Which part runs first?
```csharp
int x = 2 + 3 * 4;
Console.WriteLine(x);
Console.WriteLine(10 - 4 - 3);

int i = 1;
int r = i++ + ++i;
Console.WriteLine($"{r} {i}");

Console.WriteLine(true || false && false);

int? missing = null;
Console.WriteLine(missing + 1 is null);
```
@1-2 | x = 14 | > 14
`*` has higher **precedence** than `+`, so this is `2 + (3 * 4)`.
@3 | | > 3
Repeated `-` groups left to right: `(10 - 4) - 3`.
@5 | i = 1
A counter, to show the difference between `i++` and `++i`.
@6 | r = 4 ; i = 3
**Evaluation order** is always left to right. `i++` gives 1, then makes `i` 2. `++i` makes `i` 3, then gives 3. So `r` is 1 + 3. Code like this is legal, but don't write it: nobody reading it should have to work that out.
@7 | | > 4 3
@9 | | > True
`&&` binds tighter than `||`, so this is `true || (false && false)`. When mixing them, add brackets for the reader even though the compiler doesn't need them.
@11-12 | missing = null | > True
Arithmetic on `int?` is **lifted**: if either side is null, the result is null, not an exception.
:::

The precedence you need day to day, highest first:

| Group | Operators |
|---|---|
| Primary | `x.y`, `x?.y`, `f(x)`, `a[i]`, `x++`, `x--`, `new`, `typeof`, `nameof`, `x!` |
| Unary | `+x`, `-x`, `!x`, `~x`, `++x`, `--x`, `(T)x`, `await`, `^x` |
| Range | `x..y` |
| Switch, with | `x switch { … }`, `x with { … }` |
| Multiplicative | `*`, `/`, `%` |
| Additive | `+`, `-` |
| Shift | `<<`, `>>`, `>>>` |
| Relational and type tests | `<`, `>`, `<=`, `>=`, `is`, `as` |
| Equality | `==`, `!=` |
| Logical (bitwise) | `&`, then `^`, then `\|` |
| Conditional | `&&`, then `\|\|` |
| Null-coalescing | `??` |
| Conditional operator | `c ? a : b` |
| Assignment and lambda | `=`, `+=`, `??=`, `=>` |

## Short-circuiting and the null operators {b}

:::walk When does the right-hand side run?
```csharp
Customer? customer = null;
Console.WriteLine(customer?.Name ?? "guest");

string? note = null;
note ??= "none";
Console.WriteLine(note);

int calls = 0;
bool CheckStock() { calls++; return true; }
bool a = false && CheckStock();
bool b = false & CheckStock();
Console.WriteLine($"{a} {b} calls={calls}");

record Customer(string Name);
```
@1-2 | customer = null | > guest
`customer?.Name` stops at the null and gives `null` instead of throwing. `??` then supplies the fallback.
@4-5 | note = "none"
`??=` assigns only if the variable is currently null.
@6 | | > none
@8-10 | calls = 0 ; a = false
`&&` **short-circuits**: the left side is already `false`, so the answer is `false` whatever the right side says, and `CheckStock` never runs.
@11 | calls = 1 ; b = false
`&` on booleans always evaluates **both** sides. Use it only when the right side must run for its side effects, which is rare and surprising.
@12 | | > False False calls=1
:::

Short-circuiting is why `if (order is not null && order.Total > 0)` is safe, and why an expensive check should come **after** a cheap one: `if (cheapRule && await ExpensiveServiceCheck())`.

**The `!` (null-forgiving) operator** is different from the others. `user!.Name` tells the compiler "trust me, it isn't null", which silences the nullable warning and **does nothing at run time**. If you're wrong, you still get a `NullReferenceException`, now with no warning pointing at it. Use it only where you know more than the compiler can, such as right after a `TryGetValue` that returned true; never to make warnings go away.

## Operator overloading and conversions {i}

:::plain
You can make `+` and `>` work on your own types. Do it only when everyone would guess what they mean, and make sure "equal" means the same thing everywhere.
:::

Kettle's `Money` type is a natural fit: adding two amounts in the same currency is obvious.

:::walk Operators on Money
```csharp
var a = new Money(5m, "GBP");
var b = new Money(2.5m, "GBP");
Console.WriteLine(a + b);
Console.WriteLine(a > b);
decimal amount = (decimal)a;
Console.WriteLine(amount);
try { _ = a + new Money(1m, "EUR"); }
catch (InvalidOperationException e) { Console.WriteLine(e.Message); }

readonly record struct Money(decimal Amount, string Currency)
{
    public static Money operator +(Money x, Money y) =>
        x.Currency == y.Currency
            ? new(x.Amount + y.Amount, x.Currency)
            : throw new InvalidOperationException($"can't add {x.Currency} to {y.Currency}");
    public static bool operator >(Money x, Money y) => SameCurrency(x, y) && x.Amount > y.Amount;
    public static bool operator <(Money x, Money y) => SameCurrency(x, y) && x.Amount < y.Amount;
    public static explicit operator decimal(Money m) => m.Amount;
    public override string ToString() => $"{Currency} {Amount:0.00}";
    private static bool SameCurrency(Money x, Money y) =>
        x.Currency == y.Currency ? true : throw new InvalidOperationException("different currencies");
}
```
@1-2 | a = GBP 5.00 ; b = GBP 2.50
Two amounts in the same currency.
@3 | | > GBP 7.50
`a + b` calls the static `operator +` method. The compiler rewrites operators into ordinary method calls.
@4 | | > True
Relational operators must be overloaded in pairs: define `>`, and you must define `<` too.
@5-6 | amount = 5 | > 5
A conversion to `decimal` loses the currency, so it's declared **explicit**: you have to write the cast, which makes the loss visible.
@7-8 | | > can't add GBP to EUR
Adding different currencies is a bug, so the operator refuses rather than inventing an exchange rate.
:::

The rules for overloading:

- **Only obvious meanings.** `+` on money or vectors, yes. `+` to add an item to an order, no: write `order.Add(item)`.
- **Equality must agree everywhere.** If you overload `==`, also overload `!=`, override `Equals` and `GetHashCode`, and implement `IEquatable<T>`, or dictionaries and `==` will disagree. Records generate all of this for you, which is one more reason to use them for values ([Types](ch:type-system#equality-the-same-means-three-things)).
- **Implicit conversions must never lose information or throw.** Use `implicit` for widening, such as `OrderId` to `Guid`. Use `explicit` for anything lossy or that can fail.
- **`checked` operators** (C# 11) let a type define separate overflow-checking versions of `+`, `-` and friends, used inside `checked(...)`.
- **User-defined compound assignment** (C# 14) lets a type implement `+=` directly, updating in place instead of creating a new value ([Modern C#](ch:modern-csharp#c-14-in-depth-net-10-november-2025)).

## What foreach, using and lock really are {a}

:::plain
Several C# statements are shortcuts. The compiler rewrites them into longer plain code, and their rules make sense once you see that code.
:::

**`foreach`** works on anything with a suitable `GetEnumerator()` method, not only on `IEnumerable<T>`. The compiler rewrites it roughly as:

```csharp norun
using (var e = orders.GetEnumerator())     // disposed at the end, even after a break or an exception
{
    while (e.MoveNext())
    {
        var order = e.Current;             // a NEW variable each iteration (since C# 5), which is why closures capture each item correctly
        Process(order);
    }
}
```

This is "duck typing": the compiler looks for the method by name and shape. It's why `foreach` over a `List<T>` uses `List<T>.Enumerator`, a **struct**, without allocating, and why `foreach` over a `Span<T>` works even though spans don't implement any interface. Over arrays, the compiler goes further and emits a plain indexed `for` loop.

**`using`** becomes `try { … } finally { x?.Dispose(); }`, so disposal happens however the block is left ([Exceptions & disposal](ch:exceptions-disposal)). `await using` calls `DisposeAsync` instead.

**`lock (gate)`** becomes `Monitor.Enter(gate)` and `try { … } finally { Monitor.Exit(gate); }`, or, on a `System.Threading.Lock`, the faster `EnterScope` API ([Threading](ch:threading-concurrency)). Because the lock is tied to the thread that took it, there can be no `await` inside.

## Tuples vs anonymous types {i}

:::plain
A tuple bundles a few values together, for example to return two things from a method. An anonymous type is a throwaway object made on the spot, usually inside a LINQ query. Both are for small, local jobs, not for data that travels.
:::

:::walk Two ways to bundle values
```csharp
var (count, total) = Summarise([6.50m, 4.00m, 2.50m]);
Console.WriteLine($"{count} items, £{total}");

var named = (Sku: "TEA-01", Qty: 2);
var unnamed = ("TEA-01", 2);
Console.WriteLine(named == unnamed);
Console.WriteLine(named.GetType().Name);

var first = new { Sku = "TEA-01", Qty = 2 };
var second = new { Sku = "TEA-01", Qty = 2 };
Console.WriteLine(first.Equals(second));
Console.WriteLine(first == second);

static (int Count, decimal Total) Summarise(decimal[] prices) => (prices.Length, prices.Sum());
```
@1 | count = 3 ; total = 13.00
A method returns two values as a **tuple**, and **deconstruction** unpacks them into two variables.
@2 | | > 3 items, £13.00
@4-5 | named = (Sku: TEA-01, Qty: 2) ; unnamed = (TEA-01, 2)
The same values, with and without element names.
@6 | | > True
Tuples compare element by element, and the **names don't matter**: they're compile-time labels only.
@7 | | > ValueTuple`2
At run time a tuple is a `ValueTuple<string, int>`: a mutable struct whose fields are really `Item1` and `Item2`. That's why serialising one to JSON gives `Item1` and `Item2` instead of your names.
@9-10 | first = { Sku = TEA-01, Qty = 2 } ; second = { Sku = TEA-01, Qty = 2 }
Two **anonymous types** with the same property names and types in the same order: the compiler generates one hidden class for both.
@11 | | > True
Anonymous types override `Equals` to compare property values.
@12 | | > False
But they're classes, and `==` isn't overloaded, so it compares references: two separate objects.
:::

| | Tuple `(int Count, decimal Total)` | Anonymous type `new { Count, Total }` |
|---|---|---|
| Kind | value type (`ValueTuple`), mutable fields | reference type, read-only properties |
| Names at run time | gone: `Item1`, `Item2` | real property names (so it serialises properly) |
| Equality | `==` and `Equals` both compare values | `Equals` compares values, `==` compares references |
| Can be a method's return type | yes | no (only as `object` or `var` inside the method) |
| Typical use | returning two or three values from a private method; deconstruction | shaping data inside a LINQ query or for a one-off JSON response |

For anything that crosses a public API, a service boundary or a file, use a **record** with real names instead of either.

## Interview questions {i}

:::qa What's the difference between && and &?
`&&` is the conditional AND: it evaluates the right operand only when the left is true, so it can guard a null check or skip an expensive call. `&` on booleans always evaluates both operands, and on integers it's a bitwise AND. The same applies to `||` and `|`.
:::

:::qa What do ?., ??, ??= and ! do?
`?.` accesses a member only when the left side isn't null, otherwise giving null. `??` returns the left side unless it's null, otherwise the right side. `??=` assigns the right side only when the variable is null. `!` is the null-forgiving operator: it suppresses the compiler's nullable warning and has no run-time effect at all, so it hides bugs if misused.
:::

:::qa What are the rules for overloading operators?
Operators are public static methods on the type. Some must come in pairs (`==`/`!=`, `<`/`>`, `<=`/`>=`), and overloading `==` should go with overriding `Equals` and `GetHashCode` and implementing `IEquatable<T>`, so all forms of equality agree. Use operators only where their meaning is obvious, make lossy conversions explicit, and make implicit conversions safe.
:::

:::qa How does foreach work under the hood?
The compiler calls `GetEnumerator()`, loops on `MoveNext()` reading `Current`, and disposes the enumerator in a `finally`. It works with any type that has those members, not only `IEnumerable<T>`, which is why struct enumerators such as `List<T>.Enumerator` avoid allocation and why spans work. Arrays compile to an indexed loop, and the loop variable is a fresh variable per iteration.
:::

:::qa Tuples vs anonymous types?
Tuples are mutable `ValueTuple` structs whose element names exist only at compile time, compare by value with `==`, and can be returned from methods. Anonymous types are compiler-generated immutable classes with real property names, value-based `Equals` but reference-based `==`, and can't be used as a declared return type. Use tuples for small multi-value returns, anonymous types inside queries, and records for anything that crosses a boundary.
:::

## Next {b}

Kettle's small print is in order. Back to the story: orders turn up with a quantity of −3, marked shipped before they were paid. [Episode 2 · Classes →](ch:oop)

## Further reading

- [C# operators and expressions](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/)
- [Operator overloading](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/operator-overloading)
- [Tuple types](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/value-tuples)
- [Anonymous types](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/types/anonymous-types)
