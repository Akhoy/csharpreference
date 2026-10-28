---
id: type-system
title: "Types: Copied or Shared? (Value vs Reference)"
summary: "Episode 1. A saved basket changes by itself, and the cause is the most important idea in C#: some types are copied when you assign them, others are shared. Covers stack vs heap, structs, boxing, strings, decimal, nullable values, enums, equality and ref/out/in."
layer: language
where: C# language › Types › Value vs reference
fits: This is the foundation of layer 1. Every later chapter assumes you know whether assignment copies or shares. It also reaches down into layer 2, because the choice decides how much work the garbage collector ([Memory & GC](ch:memory-gc)) has to do.
levels: b,i,a
prereqs: csharp-story
next: oop, generics, memory-gc
---

## The 30-second version

- C# has two families of types. A **value type** (`int`, `decimal`, `DateTime`, any `struct` or `enum`) is **copied** when you assign it. A **reference type** (any `class`, `string`, arrays) is **shared**. Assignment copies only an arrow to one object.
- Reference-type objects live on the **heap**, a big shared area the garbage collector cleans. Value types live **wherever their container lives**: inside a method's stack frame, or inside an object on the heap.
- **Boxing** happens when a value type is treated as `object`. It gets copied into a new heap object. It's an allocation you never asked for.
- "Equal" means three things in C#. Records give you value equality for free. If you override `Equals`, you must override `GetHashCode` too.
- Every argument is passed **by value**, which means as a copy. For a class, the copy is a copy of the arrow. Use `ref` to pass the variable itself.

## Previously, and the bug {b}

Kettle's first feature is simple: a shopper can **save their basket for later** and keep shopping. You write it the obvious way.

```csharp
var basket = new Basket();
basket.Add("Earl Grey");

var savedForLater = basket;        // keep a copy... or so you think
savedForLater.Add("Sencha");       // only the saved one should change

Console.WriteLine($"Basket: {basket.Count} items");        // 2  ← ?!
Console.WriteLine($"Saved:  {savedForLater.Count} items"); // 2

class Basket
{
    private readonly List<string> _items = new();
    public void Add(string item) => _items.Add(item);
    public int Count => _items.Count;
}
```

Run it. The live basket has **two** items, though you only ever added Sencha to the saved one. Nothing is wrong with `Add`. The problem is the line `savedForLater = basket`. It didn't copy the basket at all.

## The lightbulb: copied or shared {b}

Every type in C# falls into one of two families. The difference is **what `=` copies**.

A **value type** variable holds the data itself. Assigning it copies the data, like a photocopy. A **reference type** variable doesn't hold the object. It holds the object's address, and assigning it copies only the address. That address has a name: a **reference**. The objects it points to live in a shared area of memory called the **heap**.

`Basket` is a `class`, and every class is a reference type. So `savedForLater = basket` made a second arrow to the **same** basket. There was only ever one basket, with two names.

Step through it. The top half uses a `struct`, the bottom half a `class`, and the code is identical:

:::scene visuals/scenes/ts-copy-vs-share.svg | Same four lines, opposite results
1. Both create a basket with `Items = 2`. The struct's data sits **inside** variable `a`. The class's data sits in an object on the heap, and `a` holds an **arrow** to it.
2. `var b = a;` The struct is photocopied, so `b` is a whole new basket. For the class only the **arrow** is copied, and both arrows point at one object.
3. `b.Items = 5;` The struct changes only `b`'s copy. The class follows `b`'s arrow and changes the one shared object.
4. Read `a.Items`. The struct prints **2**, because `a` was never touched. The class prints **5**, because `a` and `b` were always the same basket. That's the Kettle bug.
:::

```csharp
var s1 = new BasketS { Items = 2 };
var s2 = s1;        // copies the data
s2.Items = 5;
Console.WriteLine(s1.Items);   // 2

var c1 = new BasketC { Items = 2 };
var c2 = c1;        // copies the reference
c2.Items = 5;
Console.WriteLine(c1.Items);   // 5

struct BasketS { public int Items; }
class  BasketC { public int Items; }
```

:::analogy Photocopy vs shared link
A value type is a **photocopy**: scribble on yours and mine is untouched. A reference type is a **link to a shared Google Doc**: we each have our own copy of the *link*, but we're both editing the same document.
:::

Which family is each type in?

| Value types (copied) | Reference types (shared) |
|---|---|
| `int`, `long`, `double`, `decimal`, `bool`, `char` | any `class` |
| `DateTime`, `Guid`, `TimeSpan` | `string` |
| any `struct`, any `enum`, tuples `(int, string)` | arrays (`int[]`), even arrays of ints |
| `record struct` | `record` (a record class), delegates, interfaces |
| Default value: all zeros (`0`, `false`) | Default value: `null` |

**The fix for Kettle** is to make a real copy on purpose:

```csharp
var basket = new Basket();
basket.Add("Earl Grey");

var savedForLater = basket.Copy();   // a second, independent basket
savedForLater.Add("Sencha");

Console.WriteLine($"Basket: {basket.Count} items");        // 1 ✓
Console.WriteLine($"Saved:  {savedForLater.Count} items"); // 2

class Basket
{
    private readonly List<string> _items = new();
    public void Add(string item) => _items.Add(item);
    public int Count => _items.Count;
    public Basket Copy()
    {
        var copy = new Basket();
        copy._items.AddRange(_items);   // copy the contents, not the arrow
        return copy;
    }
}
```

:::qa What is the difference between a value type and a reference type?
A value-type variable contains its data, so assignment copies the data. A reference-type variable contains a reference to a heap object, so assignment copies the reference and both variables see the same object. Value types can't be null (without `Nullable<T>`) and can't be inherited from. Reference types are garbage-collected and support inheritance.
:::

## Where the data lives: stack and heap {i}

You'll often hear "value types live on the stack, reference types live on the heap". It's half right, and interviewers like to check whether you know which half.

First, the two places. The **stack** is a small block of memory each thread gets (about 1 MB by default on Windows). Every method call pushes a **frame** onto it for that call's local variables, and returning pops the frame off. That makes it fast and automatic, with no cleanup needed. The **heap** is one big shared area for the whole app. Objects there stay until nothing points to them, and then the **garbage collector** (GC) frees them.

:::scene visuals/scenes/ts-stack-heap.svg | One method call, start to finish
1. `PlaceOrder()` is called, so a new **frame** is pushed on the stack. Its local `int qty = 3` sits right inside the frame.
2. `var order = new Order()` creates the object on the **heap**. The frame only holds the arrow.
3. Look inside the object. `Quantity` is an `int`, a value type, and it lives **on the heap**, inside the `Order`. A value type lives wherever its container lives.
4. The method is still running, so the frame and the arrow both exist.
5. `PlaceOrder()` returns and the frame is popped. `qty` and the arrow vanish instantly. The object stays until the GC notices nothing points to it.
:::

So here's the precise rule:

- **Reference-type objects always live on the heap.**
- **Value types live wherever their container lives.** A local `int` lives in the stack frame. An `int` field of a class lives inside that object on the heap. The `int`s in an `int[]` live inside the array, on the heap.

```csharp norun
class Order
{
    public int Quantity;      // inside the Order object → on the heap
}

void M()
{
    int local = 5;            // in M's stack frame
    var order = new Order();  // arrow in the frame, object on the heap
    int[] nums = { 1, 2, 3 }; // array object on the heap, ints inside it
}
```

Two exceptions are worth knowing now. A local variable **captured by a lambda**, or used inside an **`async` method**, gets moved into a hidden heap object so it can outlive the frame. You'll see why in [Delegates](ch:delegates-events#closures-a-lambda-packs-a-backpack) and [async](ch:async-await).

:::why Why a backend developer cares
Every heap object is work for the GC later. A busy endpoint that creates thousands of tiny objects per request makes the GC run more often, and every run adds latency. Small, short-lived data stored as structs never touches the GC. But a *big* struct is slow to copy around. Pick by size and lifetime.
:::

:::qa Do value types always live on the stack?
No. Reference-type objects always live on the heap, but value types live wherever their container lives. A local is in the stack frame, unless it's captured by a lambda or used in an async method or iterator. A field lives inside its class object on the heap. An array element lives inline inside the array on the heap. The real defining difference is copy semantics, not location.
:::

## When should Kettle use a struct? {i}

Kettle needs a `Money` type, an amount plus a currency. Should it be a struct? Microsoft's design guidelines say to **avoid structs unless all four** of these are true:

1. It represents **a single value** (money, a coordinate, an ID).
2. It's **small**, under about 16 bytes.
3. It's **immutable**: it never changes after creation.
4. It won't be **boxed** often (see the next section).

`Money` passes, so make it a `readonly record struct`:

```csharp
var price = new Money(12.50m, "GBP");
var total = price + new Money(3.00m, "GBP");
Console.WriteLine(total);                        // Money { Amount = 15.50, Currency = GBP }
Console.WriteLine(total == new Money(15.50m, "GBP"));  // True: compared by value

public readonly record struct Money(decimal Amount, string Currency)
{
    public static Money operator +(Money a, Money b) =>
        a.Currency == b.Currency ? new(a.Amount + b.Amount, a.Currency)
                                 : throw new InvalidOperationException("Currency mismatch");
}
```

Two keywords are doing work there:

- **`readonly`** promises nothing in it can ever change. The compiler enforces this, and it can skip making safety copies when you pass the struct around.
- **`record`** generates value equality (two `Money`s with the same fields are `==`), a readable `ToString()`, and `with` for making a changed copy: `price with { Amount = 10m }`.

A related trick is the **strongly typed ID**. Wrap a `Guid` in a tiny struct like `OrderId`, and passing an `OrderId` where a `CustomerId` is expected becomes a compile error instead of a production bug.

:::gotcha Mutable structs bite
`list[0].X = 5` on a `List<SomeStruct>` is a **compile error**. The list's indexer is a method that returns a *copy* of the struct, so changing it would change a temporary copy that's thrown away at once. On a plain array the same line works, because an array element is a real variable. Same syntax, different behaviour. That's why the rule is: **keep structs immutable**.
:::

:::qa When would you use a struct instead of a class?
For a small (about 16 bytes or less), immutable value that represents a single thing and isn't boxed often, like Money, coordinates or strongly typed IDs. Declare it `readonly struct` or `readonly record struct`. Use a class for anything with identity, behaviour, inheritance or a larger size.
:::

## Boxing: a value type in a cardboard box {i}

Sometimes a value type has to be treated as an `object`, for example when it's passed to an old API that takes `object`. But `object` is a reference type, and a reference has to point at something on the heap. So the runtime makes something.

That step has a name: **boxing**. The runtime allocates a small heap object (the "box"), copies the value into it, and hands back a reference. **Unboxing** is the reverse: check the type, then copy the value back out.

:::scene visuals/scenes/ts-boxing.svg | What `object o = n` really does
1. `int n = 42;` A plain value in a local. No heap involved.
2. `object o = n;` The runtime **allocates a box on the heap** and copies 42 into it. `o` points at the box.
3. `n = 7;` The box still says 42. It holds a *copy* made at boxing time, not a link back to `n`.
4. `int m = (int)o;` **Unboxing** checks the box really holds an `int`, then copies 42 out into `m`.
:::

The danger is that boxing often happens in code that doesn't look like it:

```csharp
using System.Collections;

var list = new ArrayList();    // old, non-generic: stores object
list.Add(1);                   // boxes
IComparable c = 5;             // boxes: an interface is a reference type
string s = string.Format("{0}", 42);   // boxes 42 into an object[]

Console.WriteLine($"{list[0]} {c} {s}");
```

None of those lines look expensive, but each one is a hidden heap allocation. In a loop over a million orders, that's a million objects for the GC to clean up.

**The fix is generics.** `List<int>` stores `int`s directly, with no boxes, because .NET creates a dedicated version of `List<T>` just for `int`. [Generics](ch:generics) explains how.

:::qa What is boxing and how do you avoid it?
Boxing converts a value type to `object` or an interface. It allocates a heap object and copies the value into it. Unboxing copies it back out after a type check. Avoid it with generics (`List<int>` instead of `ArrayList`), generic constraints instead of interface-typed parameters, `IEquatable<T>`, and string interpolation instead of `string.Format` with value arguments.
:::

## string: a reference type that acts like a value {b}

`string` is a class, so it's a reference type. But it was built to *feel* like a value:

- **It's immutable.** `+`, `Replace` and `ToUpper` never change a string. They return a new one.
- **`==` compares the text**, not the reference.
- **Identical literals are shared** ("interned"): two `"hello"`s in your code are one object.

Immutability has a cost. Building a string with `+=` in a loop creates a new, longer string every time. That's about n²/2 characters copied in total. Use `StringBuilder` (one growing buffer) or `string.Join`:

```csharp
using System.Text;

string[] teas = ["Earl Grey", "Sencha", "Rooibos"];

var sb = new StringBuilder();
foreach (var t in teas) sb.Append(t).Append("; ");
Console.WriteLine(sb.ToString());

Console.WriteLine(string.Join(", ", teas));   // simplest when you have a collection

// Comparing IDs, keys and codes: use ordinal (raw characters, no culture rules)
Console.WriteLine(string.Equals("SKU-1", "sku-1", StringComparison.OrdinalIgnoreCase)); // True
```

:::gotcha Culture-sensitive comparisons
`"i".ToUpper()` gives `"İ"` (dotted capital I) under Turkish culture settings. Case-insensitive lookups that rely on `ToUpper` or `ToLower` break there. For keys, codes and file paths, always use `StringComparison.Ordinal` or `OrdinalIgnoreCase`.
:::

:::qa Why is string immutable, and what are the consequences?
Immutability makes strings thread-safe and safe to use as dictionary keys, and it allows identical literals to be shared (interning). The consequence is that every "change" allocates a new string, so build strings in loops with `StringBuilder`, `string.Join` or `string.Concat`.
:::

## Money must be decimal, and casts can lie {b}

Kettle's first invoice says a £0.10 tea plus a £0.20 biscuit costs £0.30000000000000004. That's `double` at work.

`double` stores numbers in **binary**, and 0.1 can't be written exactly in binary, just as ⅓ can't be written exactly in decimal (0.333…). `decimal` stores numbers in **base 10**, so 0.1 is exact. **Money is always `decimal`.**

```csharp
Console.WriteLine(0.1 + 0.2);      // 0.30000000000000004  (double)
Console.WriteLine(0.1m + 0.2m);    // 0.3                  (decimal, note the m)

int big = 300;
byte b = (byte)big;                 // 44: doesn't fit in 0..255, so it silently wraps
Console.WriteLine(b);
try { byte c = checked((byte)big); }
catch (OverflowException) { Console.WriteLine("checked: overflow caught"); }

object o = "not an order";
if (o is string text) Console.WriteLine($"pattern match gave a typed variable: {text}");
var maybeUri = o as Uri;                // as: null when it isn't that type
Console.WriteLine(maybeUri is null);    // True
```

The same idea in a few rules:

- **Widening is safe and implicit** (`int` → `long`). Nothing can be lost.
- **Narrowing needs a cast and can silently wrap** (`(byte)300` is 44). Plain arithmetic wraps too: `int.MaxValue + 1` is a large negative number. Wrap risky maths in `checked` to get an exception instead.
- To test a type: `is` (check and get a typed variable) is the best choice. `as` returns `null` on failure. A cast `(Order)o` throws on failure.

:::qa Why use decimal instead of double for money?
`decimal` is base 10 and represents values like 0.1 exactly, with 28–29 significant digits. `double` is binary floating point, so many decimal fractions can't be represented exactly and rounding errors build up.
:::

## "Not set yet": nullable value types {b}

An order has a `ShippedAt` date, but only once it ships. A `DateTime` can't be `null`, because a value type always holds *some* value. Using `DateTime.MinValue` to mean "not yet" is a lie that leaks into reports.

Add `?`: **`DateTime?`** is a nullable value type, short for `Nullable<DateTime>`. It's just a small struct holding a flag (`HasValue`) plus the value.

```csharp
DateTime? shippedAt = null;
Console.WriteLine(shippedAt.HasValue);               // False
Console.WriteLine(shippedAt?.ToString("d") ?? "not shipped yet");

int? discount = null;
int effective = discount ?? 0;                       // ?? = "use this if null"
Console.WriteLine(effective);
```

Don't confuse it with `string?`. Strings can already be null, and `string?` is a compile-time *warning* system covered in [Modern C#](ch:modern-csharp#nullable-reference-types-the-compiler-tracks-maybe-null).

## Enums: named numbers with a sharp edge {b}

An `enum` gives names to integers: `OrderStatus.Paid` is really just `2`.

```csharp
var s = OrderStatus.Paid;
Console.WriteLine($"{s} = {(int)s}");               // Paid = 2

var bogus = (OrderStatus)42;                        // compiles and runs!
Console.WriteLine($"{bogus}, defined? {Enum.IsDefined(bogus)}");  // 42, defined? False

var p = Permissions.Read | Permissions.Write;       // [Flags]: combine bits
Console.WriteLine($"{p}, can write: {p.HasFlag(Permissions.Write)}");

enum OrderStatus { Draft = 0, Placed = 1, Paid = 2, Shipped = 3, Cancelled = 9 }

[Flags] enum Permissions { None = 0, Read = 1, Write = 2, Delete = 4 }
```

:::gotcha Enums aren't checked
`(OrderStatus)42` is perfectly legal, so a bad value from JSON or the database slips straight in. Check outside input with `Enum.IsDefined` or a `switch` with a `default` arm. If you store enums as numbers, give every member an **explicit** number, or reordering the declaration silently changes the meaning of stored data. In public APIs, prefer sending enums as strings.
:::

## Equality: "the same" means three things {i}

Two `Money` values of £5 are the same money. Two `Customer` objects that happen to share a name are probably *not* the same customer. C# lets you ask both questions, and each kind of type has a different default:

| | class | struct | record |
|---|---|---|---|
| `==` | same object? (unless overloaded, like `string`) | not available unless you define it | same values? |
| `Equals` | same object? | same values? (slow: uses reflection) | same values? (fast, generated) |
| `ReferenceEquals` | same object? | always false | same object? |

If you override `Equals` yourself, you **must** also override `GetHashCode` so that equal objects give equal hash codes. `Dictionary` and `HashSet` look items up by hash code first. If two "equal" objects have different hash codes, the lookup quietly fails.

```csharp
var a = new Sku("tea-01");
var b = new Sku("TEA-01");
Console.WriteLine(a == b);                          // True: same values

var set = new HashSet<Sku> { a };
Console.WriteLine(set.Contains(b));                 // True: hash codes agree

// A record writes Equals, GetHashCode, == and != for you
public sealed record Sku
{
    public string Code { get; }
    public Sku(string code) => Code = code.ToUpperInvariant();
}
```

:::gotcha A key that changes is lost forever
If a field that feeds `GetHashCode` changes *after* the object goes into a `HashSet` or becomes a `Dictionary` key, you'll never find it again. The set filed it under the old hash code. You get no exception, just missing data. **Keys must be immutable.**
:::

:::qa If you override Equals, what else must you do?
Override `GetHashCode` consistently, so equal objects give equal hash codes. Ideally also implement `IEquatable<T>`, and overload `==` and `!=` so they agree. Or use a record, which generates all of this.
:::

## Passing to methods: you always pass a copy {i}

Here's the rule that untangles every parameter question: **C# passes every argument by value, which means as a copy.** For a class, what gets copied is the *reference*. So the method gets its own arrow to *your* object.

:::scene visuals/scenes/ts-passing.svg | What does a method get?
1. The caller's variable `basket` points at a basket on the heap with two teas in it.
2. Call `Empty(basket)`. The method's parameter `b` is a **copy of the arrow**. It points at the same basket.
3. `b.Clear();` follows the arrow and empties the shared basket. The caller **sees** this, because it's the same object.
4. `b = new Basket();` moves only the method's own arrow. The caller's `basket` still points at the original. Reassigning a parameter never reaches the caller.
5. Unless you write **`ref`**. Then there's no copy: `b` *is* the caller's variable, and reassigning it moves the caller's arrow too.
:::

```csharp
var c = new Customer { Name = "Ada" };
Rename(c);      Console.WriteLine(c.Name);   // "Renamed": same object
Replace(c);     Console.WriteLine(c.Name);   // still "Renamed": only the copy moved
ReplaceRef(ref c); Console.WriteLine(c.Name); // "Brand new": ref moved the caller's variable

static void Rename(Customer x)          => x.Name = "Renamed";
static void Replace(Customer x)         => x = new Customer { Name = "Lost" };
static void ReplaceRef(ref Customer x)  => x = new Customer { Name = "Brand new" };

class Customer { public string Name = ""; }
```

The modifiers:

| Modifier | Meaning | Typical use |
|---|---|---|
| *(none)* | A copy of the value, or a copy of the reference | Almost always |
| `ref` | The variable itself: read and write | Swapping, mutating a big struct |
| `out` | The method **must** set it, and the caller needn't | `int.TryParse(s, out var n)` |
| `in` | A read-only reference, so a big struct isn't copied | Performance with big readonly structs |

:::qa Are reference types passed by reference in C#?
No. Everything is passed by value by default. For a reference type the value passed is the reference, so the method can change the object, but reassigning the parameter doesn't affect the caller. Use `ref` to pass the variable itself.
:::

:::qa ref vs out vs in?
`ref`: the caller passes an initialised variable, and the method can read and write it. `out`: the method must assign it, and the caller needn't initialise it (the `TryParse` pattern). `in`: a read-only reference, used to avoid copying large structs.
:::

## var, object and dynamic {b}

Three ways to avoid writing a type name. They're not the same thing:

| | What it means | Checked when |
|---|---|---|
| `var` | "Compiler, you work out the type." `var x = 5;` compiles to exactly `int x = 5;` | Compile time: still fully typed |
| `object` | The base of every type. You need casts to do anything useful. | Compile time |
| `dynamic` | "Don't check anything until it runs." Errors become runtime exceptions. | Runtime |

Use `var` freely. Almost never use `dynamic` in backend code.

:::qa What is the difference between var and dynamic?
`var` is compile-time type inference: the variable is still statically typed. `dynamic` defers all member lookups to runtime, so mistakes show up as runtime exceptions and you lose IntelliSense and speed.
:::

## Memory layout and size {a}

- Every heap object carries a hidden **16-byte header** on 64-bit (a sync-block index plus a pointer to its type's method table). So even an empty object costs about **24 bytes**. This is a CLR implementation detail, documented in *Pro .NET Memory Management* and *CLR via C#*.
- Sizes: `int` 4 bytes, `long`/`double`/`DateTime` 8, `decimal`/`Guid` 16, a reference 8 (on 64-bit).
- The runtime may reorder a class's fields to pack them tightly. Structs keep **declaration order** by default, which matters for native interop (`[StructLayout]`).
- Measure rather than guess: `Unsafe.SizeOf<T>()`, ObjectLayoutInspector, and BenchmarkDotNet's `MemoryDiagnoser`.

## Next episode {b}

Kettle's types now copy and share the way you intend. Then an order shows up in the database with **a quantity of −3**, and another is marked *Shipped* though it was never paid. Every field is public, so any code anywhere can set anything. Time to make objects **guard their own rules**: [Episode 2 · Classes →](ch:oop)

## Further reading

- [Value types (C# reference)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/value-types). Note that it describes copy semantics and deliberately avoids saying "stack".
- [Choosing between class and struct](https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/choosing-between-class-and-struct), the four-condition rule.
- [Boxing and unboxing](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/types/boxing-and-unboxing)
- Books: *C# in Depth* (Jon Skeet), *CLR via C#* (Jeffrey Richter), *Pro .NET Memory Management* (Konrad Kokosa).

## Verify this chapter

Every claim above as one program. Press **Run**. Each line should print `OK`.

```csharp
// struct assignment copies; class assignment shares
var s1 = new PointS { X = 1 }; var s2 = s1; s2.X = 99;
Check(s1.X == 1, "struct assignment copies the data");
var c1 = new PointC { X = 1 }; var c2 = c1; c2.X = 99;
Check(c1.X == 99, "class assignment copies only the reference");

// a box is a frozen copy
PointS p = new() { X = 1 }; object boxed = p; p.X = 2;
Check(((PointS)boxed).X == 1, "a boxed value is a copy taken at boxing time");

// boxing a null int? gives a real null
int? none = null; object? boxedNull = none;
Check(boxedNull is null, "boxing a null int? produces null");

// enums aren't validated
Check(!Enum.IsDefined((Status)42), "(Status)42 compiles but isn't a defined member");

// decimal is exact for money, double isn't
Check(0.1m + 0.2m == 0.3m && 0.1 + 0.2 != 0.3, "decimal is exact, double isn't");

// records compare by value
Check(new Money(5m, "GBP") == new Money(5m, "GBP"), "records compare by value");

// parameters are copies; ref passes the variable
var cust = new PointC { X = 1 };
Mutate(cust); Check(cust.X == 7, "a method can change the object through its copy of the reference");
Reassign(cust); Check(cust.X == 7, "reassigning the parameter doesn't touch the caller");
ReassignRef(ref cust); Check(cust.X == 42, "ref lets the method reassign the caller's variable");

static void Mutate(PointC c) => c.X = 7;
static void Reassign(PointC c) => c = new PointC { X = 0 };
static void ReassignRef(ref PointC c) => c = new PointC { X = 42 };
static void Check(bool ok, string claim) =>
    Console.WriteLine(ok ? $"OK: {claim}" : throw new Exception($"FAIL: {claim}"));

struct PointS { public int X; }
class PointC { public int X; }
enum Status { Draft, Paid }
readonly record struct Money(decimal Amount, string Currency);
```
