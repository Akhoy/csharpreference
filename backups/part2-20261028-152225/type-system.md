---
id: type-system
title: The Type System: Value Types, Reference Types and Everything Between
summary: The most important idea in C#. How data is stored and copied, stack vs heap, structs vs classes vs records, boxing, nullable value types, enums, equality, and parameter passing with ref/out/in.
layer: language
where: C# language › Types › Value vs reference
fits: This is the foundation of layer 1, and it touches layer 2 directly: how the runtime lays out memory, and how much work the GC ([Memory & GC](ch:memory-gc)) does, depends on the choices made here. Every later chapter assumes you know what "copy semantics" means.
levels: b,i,a
prereqs: how-code-runs
next: oop, generics, memory-gc
---

## TL;DR

- Every type in C# answers one question: does assignment copy the **data** (value types: `struct`, `int`, `enum`, …) or copy a **reference** to shared data (reference types: `class`, `string`, arrays, …)?
- "Value types live on the stack" is a popular simplification, not the real rule: value types live wherever their *container* lives — which can be the heap (a struct field inside a class, or inside an array).
- **Boxing** wraps a value type in a heap object so it can pretend to be an `object`/interface; it's an easy-to-miss allocation (`ArrayList.Add`, `string.Format` with value args) and generics (`List<int>`) exist partly to avoid it.
- Three different things all look like "equality" in C# — `==`, `Equals`, `ReferenceEquals` — and classes/structs/records each default to different answers; overriding `Equals` obligates you to override `GetHashCode` too.
- Everything is passed **by value**, including references — so a method can mutate an object through a reference parameter but can't make the caller's variable point somewhere else unless you add `ref`.

## One question that predicts a huge amount of C# behaviour {b}

Here's a question worth asking about *any* type in C#: when you assign one variable to another, do you get an independent copy, or two names for the same thing? The answer splits every single type in the language into exactly two camps, and once you know which camp a type is in, you can predict how it behaves in dozens of situations you haven't even seen yet.

| | Value types | Reference types |
|---|---|---|
| **Examples** | `int`, `long`, `double`, `decimal`, `bool`, `char`, `DateTime`, `Guid`, `TimeSpan`, any `struct`, any `enum`, tuples `(int, string)`, `Span<T>` | `class`, `string`, `object`, arrays (`int[]`), delegates, `record` (class), interfaces, `dynamic` |
| **Variable holds** | The data itself | A reference (an address) to an object on the heap |
| **Assignment copies** | The whole value | Only the reference; both variables now point at the same object |
| **Default value** | All bits zero (`0`, `false`, `default(DateTime)`) | `null` |
| **Can be null?** | No, unless wrapped as `Nullable<T>` (`int?`) | Yes (but see [nullable reference types](ch:modern-csharp)) |
| **Inheritance** | Can't inherit or be inherited (can implement interfaces) | Single inheritance of classes |
| **Allocated** | Inline: in the containing object, array, or stack frame | Always on the managed heap; freed by the GC |

Let's actually watch the difference happen instead of just reading about it:

```csharp
struct PointS { public int X; }
class  PointC { public int X; }

var s1 = new PointS { X = 1 };
var s2 = s1;          // the 4 bytes are copied
s2.X = 99;
Console.WriteLine(s1.X); // 1   ← independent copy

var c1 = new PointC { X = 1 };
var c2 = c1;          // the reference is copied; one object, two variables
c2.X = 99;
Console.WriteLine(c1.X); // 99  ← same object
```

Both lines do `var x2 = x1; x2.X = 99;`. Both *look* identical. And yet `s1.X` stays `1` while `c1.X` becomes `99` — the exact same two lines of code, producing opposite outcomes, purely because `struct` and `class` disagree about what `=` actually copies. For `PointS`, `s2 = s1` copies the 4 bytes that make up `X`, so `s2` is a completely independent value from that point on. For `PointC`, `c2 = c1` copies only the *reference* — a pointer-sized address — so `c1` and `c2` end up pointing at the exact same object in memory, and changing one changes what you see through the other.

:::analogy Value vs reference
A value type is like **handing someone a photocopy** of a document: they can scribble all over it and your original stays untouched. A reference type is like **handing someone the address of a shared Google Doc**: you each hold your own copy of the *address*, but you're both looking at, and editing, the exact same document.
:::

## "Value types live on the stack" — a useful lie {i}

You will hear this sentence constantly: "value types live on the stack, reference types live on the heap." It's a reasonable first approximation, and it's **not actually true** — knowing the precise version, and *why* the simple version is wrong, is a genuinely good way to stand out in an interview.

First, what the stack and heap actually are, since the sentence above leans on both without defining them:

- **The stack** is memory set aside per-thread for method calls. Local variables and parameters live in **stack frames**, one per currently-running method call, and a frame is popped the instant its method returns. Allocating on the stack is just moving a pointer — there's no GC involved at all.
- **The managed heap** holds objects whose lifetime isn't tied to any one method call — because something might still need them long after the method that created them has returned. The GC tracks these and frees them once nothing references them any more.

Here's the precise rule, and it's genuinely simpler than the popular version once you see it stated correctly: **reference-type objects always live on the heap. Value types live wherever their container lives** — which might be the stack, but might just as easily be the heap.

```csharp
class Order
{
    public int Quantity;        // value type field: lives INSIDE the Order object, on the heap
    public DateTime CreatedAt;  // same
}

void M()
{
    int local = 5;              // local value type: in M's stack frame (or a CPU register)
    var order = new Order();    // the reference 'order' is on the stack; the Order object is on the heap
    int[] nums = { 1, 2, 3 };   // the array object (with its 3 ints inline) is on the heap
}
```

Look at `Order.Quantity` closely: it's an `int`, a value type — and yet it's sitting on the heap, because an `Order` *object* is a reference type, and `Quantity` lives wherever its containing `Order` lives. The value type didn't move to the heap on its own; it's just physically embedded inside something that did. That's the whole rule, applied consistently: a value type's location is never decided by the value type itself, only by whatever's holding it.

There are a couple of exceptions worth flagging now, even though they're explained properly in later chapters: locals **captured by a lambda** (a closure) and locals inside **`async` methods or iterators** stop being ordinary stack locals and become fields of a compiler-generated object on the heap instead. You'll see exactly why, and exactly what that generated object looks like, in [Delegates](ch:delegates-events) and [async/await](ch:async-await).

:::why Why this distinction actually matters in backend code
Every heap allocation adds work for the garbage collector — you saw the mechanics of that in [Memory & GC](ch:memory-gc). If a hot API endpoint allocates thousands of small temporary objects per request, you get frequent GCs and the latency spikes that come with them. Modelling small, short-lived data as structs (or processing it with `Span<T>`) sidesteps that, because a struct embedded in a stack frame never touches the GC at all. But the trade-off genuinely runs the other way too: copying a *big* struct around is slower than copying an 8-byte reference, because you're copying the whole thing every single time instead of just an address. There's no universally right answer here — pick whichever shape actually fits the size and lifetime of your data.
:::

## When a struct actually earns its keep {i}

Given that trade-off, when should you actually reach for `struct` instead of the default, `class`? Microsoft's design guidelines boil down to four conditions, and the honest answer is: use a struct only when **all four** are true.

1. It logically represents a single value (a point, money, a coordinate, an ID).
2. It is small: roughly **16 bytes or less**.
3. It is **immutable**.
4. It won't be boxed frequently (you'll meet boxing properly in the next section).

Fail even one of those, and a class is almost always the better choice.

```csharp
public readonly record struct Money(decimal Amount, string Currency)
{
    public static Money operator +(Money a, Money b) =>
        a.Currency == b.Currency ? new(a.Amount + b.Amount, a.Currency)
                                 : throw new InvalidOperationException("Currency mismatch");
}

public readonly struct OrderId(Guid value)   // strongly typed ID: can't mix up with CustomerId
{
    public Guid Value { get; } = value;
    public override string ToString() => Value.ToString();
}
```

Two keywords in those examples are doing real work. `readonly struct` isn't just documentation — it's a compiler-enforced guarantee of immutability, and that guarantee lets the compiler skip something called a **defensive copy**: normally, passing a struct to a method that only promises not to modify it (an `in` parameter, say) forces a safety copy just in case, but a `readonly struct` can't be modified even if it tried, so the compiler is free to skip that copy entirely. `record struct` (C# 10) layers value-based equality, a sensible `ToString`, and `with`-expression support on top, the same conveniences records give you for reference types.

`OrderId` above demonstrates a specific, popular pattern worth naming: a **strongly typed ID**. Wrapping a bare `Guid` or `int` in a tiny struct like this means `GetOrder(customerId)` — passing the wrong kind of ID to the wrong method — becomes a compile error instead of a runtime bug, because `OrderId` and `CustomerId` are genuinely different types even though they're both "just a Guid" underneath.

:::gotcha Mutable structs bite, and in a genuinely surprising way
```csharp
var points = new List<PointS> { new() { X = 1 } };
points[0].X = 5;   // compile error CS1612: the indexer returns a COPY, modifying it is pointless
```
Here's why that's a compile error rather than silently doing nothing: `List<T>`'s indexer is a *method* (`get_Item`), and calling it returns a **copy** of the struct stored inside the list — so `points[0].X = 5` would modify a temporary copy that's immediately thrown away, achieving nothing. The compiler refuses to compile code that can't possibly do what it looks like it does. With a plain array, though, `array[0].X = 5` *does* work and modifies in place, because an array element is a real, addressable variable, not something returned from a method call. Same-looking syntax, two different outcomes, depending on whether you're indexing an array or a `List<T>` — which is exactly the kind of inconsistency that makes "keep structs immutable" such a firmly held rule rather than just a style preference.
:::

## Boxing: what happens when a value type has to pretend to be an object {i}

Here's a scenario that comes up constantly: you have an `int`, but something — an older API, a non-generic collection, an interface — needs an `object`. An `int` is a value type; `object` is a reference type. How does a value with no heap presence at all get treated as something that's supposed to live on the heap?

**Boxing** is the answer: the runtime allocates a small object on the heap, copies the value type's bits into it, and hands you a reference to that box — now indistinguishable, from the outside, from any other heap object. **Unboxing** is the reverse: given a boxed reference, copy the value back out into an ordinary value-type variable.

```csharp
int n = 42;
object o = n;           // BOX: allocate an object on the heap, copy 42 into it
int m = (int)o;         // UNBOX: type check + copy back out
IComparable c = n;      // also boxes: interface reference to a value type
```

Notice that last line — assigning `n` to an `IComparable` variable boxes it too, for exactly the same reason: an interface reference is a reference-type concept, so a value type being treated as "any type implementing this interface" needs the same heap wrapper as being treated as a bare `object` does.

The dangerous part is that boxing often happens **without you writing anything that looks like a box**:

```csharp
// Hidden boxing
var list = new ArrayList();   // non-generic, stores object
list.Add(1);                  // boxes
string s = string.Format("{0}", 42);  // boxes the int (interpolated strings avoid this)
```

`ArrayList.Add` takes an `object` parameter — a holdover from before generics existed — so every `int` you add gets silently boxed on the way in. `string.Format("{0}", 42)` has the same issue: its `object[]` parameter list boxes `42` before the method body even runs. Neither line *looks* expensive, and that's exactly the trap: each one is a heap allocation, a copy, and — on the way back out — a type check, all paid for something that looks like a free, instant operation. Do this in a hot loop processing millions of items, and you've built a real, measurable performance bug out of code that compiles without a single warning.

The actual fix, worth remembering as a rule rather than a one-off trick: **generics avoid boxing structurally**. `List<int>` stores `int`s directly, inline, with no boxing at all — because the JIT generates a genuinely separate, specialised version of `List<T>` for `int` specifically, rather than forcing everything through a shared `object`-based implementation. You'll see exactly how and why that works in [Generics](ch:generics).

:::gotcha A boxed value is frozen at the moment it was boxed
```csharp
PointS p = new() { X = 1 };
object boxed = p;
p.X = 2;
Console.WriteLine(((PointS)boxed).X);  // 1: the box holds a copy taken at boxing time
```
This surprises people who expect `boxed` to somehow track `p`. It doesn't, because boxing is a **copy**, not a reference back to `p` — the exact same copy-semantics rule from the very start of this chapter, just applied one level deeper. Once `p` is boxed, the two are completely independent; changing one never touches the other.
:::

## Strings: a reference type dressed up to feel like a value {b}

`string` is, by the table at the top of this chapter, a reference type — but it behaves so differently from a typical reference type (`PointC`, say) that it's worth its own section. Three deliberate design choices explain why:

- It is **immutable**: every "modification" — `+`, `Replace`, `ToUpper`, anything — actually creates a brand-new string and leaves the original completely untouched.
- `==` compares **contents**, not references, because the `==` operator is specifically overloaded for `string` to do that. (Most reference types don't do this — `PointC == PointC` above would compare references, not field values, unless you overload it yourself.)
- Identical string **literals** are **interned**: the runtime recognises `"hello"` appearing twice in your source and has both refer to the exact same single object in memory, rather than allocating two copies of an identical string.

```csharp
string a = "hello";
string b = a;
b += " world";          // creates a NEW string; a is still "hello"

// Concatenation in a loop creates n intermediate strings: O(n²) copying
var s = "";
foreach (var w in words) s += w;            // bad for large n

var sb = new StringBuilder();
foreach (var w in words) sb.Append(w);      // one growing buffer
var result = sb.ToString();

var joined = string.Join(", ", words);      // best when you have a collection
```

That second block is worth understanding precisely, not just avoiding by rote: every single `s += w` inside the loop throws away the previous string entirely and allocates a brand-new, slightly longer one — because strings are immutable, there's no other way to "append" to one. Over `n` iterations, you're not doing `n` units of work, you're doing roughly `1 + 2 + 3 + ... + n` units of copying, which is `O(n²)`. `StringBuilder` exists specifically to avoid this: it maintains one resizable internal buffer and only produces a final immutable `string` once, when you call `ToString()`.

**Comparison** deserves its own rule, because getting it wrong is a genuine, recurring bug category: always be deliberate about which comparison rules you're invoking. For identifiers, keys, file paths and protocol values, use **ordinal** comparison — `string.Equals(a, b, StringComparison.OrdinalIgnoreCase)` — which compares raw character codes with no linguistic interpretation at all. Reserve culture-sensitive comparison (`CurrentCulture`) for text you're actually displaying to a user in their own language. The classic cautionary tale here is the "Turkish I problem": call `.ToUpper()` on `"i"` under Turkish culture settings and you get `"İ"`, not `"I"` — which has broken more than one case-insensitive lookup that assumed `ToUpper`/`ToLower` meant the same thing everywhere in the world.

## Nullable value types: giving a value type a "no value" state {b}

Value types, as the very first table in this chapter said, can't be `null` — an `int` always has *some* integer value, even if that value is just `0` by default. But plenty of real-world data genuinely has a "no value" state that isn't the same thing as zero: a discount that might not apply, a `ShippedAt` date for an order that hasn't shipped yet. `Nullable<T>`, almost always written as the shorthand `T?`, is how C# adds that missing state to a value type without turning it into a reference type.

```csharp
int? discount = null;
if (discount.HasValue) Console.WriteLine(discount.Value);
int effective = discount ?? 0;                 // null-coalescing
int alsoEffective = discount.GetValueOrDefault();

DateTime? shippedAt = order.ShippedAt;         // database NULL ↔ C# null
```

Here's the detail that makes `Nullable<T>` click: it isn't magic, it's just an ordinary struct, roughly `{ bool hasValue; T value; }` — a flag plus the underlying value, packaged together. That's why `int?` is still, underneath, a value type with all the copy semantics you'd expect, not some special case the runtime handles differently. One genuinely subtle consequence: boxing a *null* `int?` produces an actual `null` reference, not a box containing "no value" — while boxing a *non-null* `int?` boxes just the underlying `int`, discarding the wrapper entirely. The box, once created, has no memory that it ever came from a `Nullable<T>` at all.

Don't confuse this with **nullable reference types** (`string?`), which look almost identical in syntax but are a completely different mechanism — compile-time-only annotations that add nothing whatsoever at runtime. [Modern C#](ch:modern-csharp) covers the distinction in full.

## Enums: named integers with a sharp edge {b}

An `enum` is a named set of integer constants — a value type, backed by `int` unless you say otherwise.

```csharp
public enum OrderStatus { Draft = 0, Placed = 1, Paid = 2, Shipped = 3, Cancelled = 9 }

[Flags]
public enum Permissions { None = 0, Read = 1, Write = 2, Delete = 4, Admin = Read | Write | Delete }

var p = Permissions.Read | Permissions.Write;
bool canWrite = p.HasFlag(Permissions.Write);       // or (p & Permissions.Write) != 0
```

Notice `Permissions` assigns `1, 2, 4` — powers of two, not `1, 2, 3`. That's deliberate: each value occupies a distinct bit, so they can be combined with `|` (bitwise OR) without any of them colliding, and checked individually with `HasFlag` or a raw bitwise `&`. The `[Flags]` attribute signals this intent to tooling (and to `ToString()`, which then prints `"Read, Write"` instead of a meaningless number) — but doesn't change the underlying mechanics at all; it's purely a hint.

:::gotcha Enums are not validated — a value outside the named set compiles and runs just fine
`(OrderStatus)42` compiles, runs, and produces a perfectly valid-looking `OrderStatus` value that happens to correspond to no named member at all. This isn't a hypothetical edge case: values coming from JSON, from a database column, from a different version of your own code, can easily land outside the set you defined. Check with `Enum.IsDefined`, or a `switch` with a `default` arm that handles the unexpected case explicitly, anywhere an enum value arrives from outside your own code. One more easily-missed trap: if you ever persist enum values as their underlying numbers, give every member you store an **explicit** number. Without one, the compiler assigns them in declaration order starting from 0 — and simply reordering your `enum` declaration, with no other change at all, silently changes what every previously stored number now means.
:::

Given that fragility, prefer serialising enums as **strings** in public APIs (`JsonStringEnumConverter`), not as their numeric values — a new member added later doesn't break clients reading the string name, the way it could break clients hard-coded against specific numbers.

## Equality: three different questions, similar syntax {i}

"Are these two equal?" sounds like one question. In C#, depending on exactly how you ask it, it's actually at least three, and they don't always agree with each other:

| | Default for classes | Default for structs | Records |
|---|---|---|---|
| `==` | Reference equality (unless overloaded, e.g. `string`) | Not defined unless you overload it | Value equality |
| `Equals(object)` | Reference equality | Field-by-field value equality (via reflection, slow) | Value equality (generated, fast) |
| `ReferenceEquals` | Same object? | Always false (boxed copies) | Same object? |

The struct row for `Equals` is worth a second look: it works, but it's genuinely slow, because the default implementation uses **reflection** to compare every field one by one — exactly the kind of runtime cost [How code runs](ch:how-code-runs#what-build-time-actually-hands-you) warned reflection carries. If you're going to compare structs for equality often, overriding `Equals` yourself (or using `record struct`, which generates a fast version for you) is a real, measurable win, not just tidiness.

If you override `Equals` yourself, there's a rule you **must** follow or you'll get genuinely confusing bugs much later: you must override `GetHashCode` too, consistently — equal objects have to produce equal hash codes, or `Dictionary`/`HashSet` will silently fail to find items you know are in them. Implementing `IEquatable<T>` alongside both gives you a fast, non-boxing `Equals(T)` overload on top.

```csharp
public sealed class Sku : IEquatable<Sku>
{
    public string Code { get; }
    public Sku(string code) => Code = code.ToUpperInvariant();

    public bool Equals(Sku? other) => other is not null && Code == other.Code;
    public override bool Equals(object? obj) => Equals(obj as Sku);
    public override int GetHashCode() => Code.GetHashCode();
    public static bool operator ==(Sku? a, Sku? b) => Equals(a, b);
    public static bool operator !=(Sku? a, Sku? b) => !Equals(a, b);
}
// Or just: public sealed record Sku(string Code);  ← the compiler writes all of the above
```

That final comment is worth taking seriously as practical advice, not just trivia: every single member in that `Sku` class — `Equals`, `GetHashCode`, both operators — is exactly what the compiler generates automatically for a `record`. Unless you have a real reason to write a class by hand here, a one-line `record` gets you the same correctness with none of the five-method ceremony above it.

:::gotcha A mutable hash key is a silent, permanent bug
If an object's hash code depends on a field that changes *after* you've already added it to a `HashSet` or used it as a `Dictionary` key, you will never find it again through that collection — not an exception, not a warning, just a lookup that quietly fails forever, because the collection stored it under the hash code it had *then*, and is now searching under the hash code it has *now*. Keys must be immutable, full stop.
:::

## Passing parameters: what "by value" actually means for a reference {i}

**Everything in C# is passed by value, with no exceptions** — including reference types, which is the part that confuses people, because it genuinely sounds like it should mean the opposite. Here's the precise mechanics: for a reference type, the thing being passed "by value" is the *reference itself* — so the method you're calling gets its own copy of that reference, pointing at the same object, which means it **can** mutate the object through that reference, but it **cannot** make the caller's own variable point somewhere else.

```csharp
void Rename(Customer c)      { c.Name = "New"; }        // caller sees this (same object)
void Replace(Customer c)     { c = new Customer(); }     // caller does NOT see this
void ReplaceRef(ref Customer c) { c = new Customer(); }  // caller DOES see this
```

Those three methods look almost identical, and produce three genuinely different outcomes. `Rename` mutates the object the reference points at — both the caller and the method are looking at the same `Customer`, so the caller sees the change. `Replace` reassigns the *local copy* of the reference to point at a brand-new object entirely — but that local copy is the method's own, private variable; the caller's original reference never moves, and still points at the original `Customer`. `ReplaceRef` adds the one modifier that changes this: `ref` passes the caller's actual variable, not a copy of it, so reassigning `c` inside the method genuinely does reassign the caller's variable too.

| Modifier | Meaning | Caller must | Typical use |
|---|---|---|---|
| *(none)* | Copy of value / copy of reference | — | Default |
| `ref` | Pass the variable itself; method can read and write | Initialise first, write `ref` at call site | Swapping, large structs you mutate |
| `out` | Method **must** assign it; caller needn't initialise | Write `out` | `TryParse`, `TryGetValue` patterns |
| `in` | Read-only reference; avoids copying large structs | (optional `in`) | Performance with big readonly structs |
| `ref readonly` (C# 12) | Like `in`, but the call site must pass a reference | | API clarity |

`out` is the one you've almost certainly already used without necessarily naming it:

```csharp
if (int.TryParse(input, out var qty) && dict.TryGetValue(key, out var value)) { /* ... */ }
```

The contract `out` makes is the mirror image of a normal parameter: instead of the caller promising to provide a value, the *method* promises to assign one before it returns — which is exactly why `TryParse` and `TryGetValue` can return a clean `bool` for success/failure while still handing back the actual result through the same call, with no uninitialised-variable risk on the caller's side.

## Type conversions and checks {b}

```csharp
object o = GetSomething();

// Pattern matching (preferred)
if (o is Order order && order.Total > 100) { /* order is typed */ }

// as: returns null on failure (reference/nullable types only)
var maybe = o as Order;

// Cast: throws InvalidCastException on failure
var sure = (Order)o;

// Numeric conversions
int i = 300;
byte b = (byte)i;                // 44: silently wraps (unchecked)
byte c = checked((byte)i);       // throws OverflowException
long big = i;                    // implicit widening: always safe
decimal price = decimal.Parse("19.99", CultureInfo.InvariantCulture);
```

The first three options above aren't interchangeable — they're three different answers to "what should happen if this doesn't work?" Pattern matching (`is`) checks and gives you a safely typed variable in one step, failing gracefully into the `else` branch. `as` returns `null` on failure, which only makes sense for reference and nullable types (there's no "null" a plain cast could fall back to for a non-nullable value type). A plain cast `(Order)o` is the least forgiving: it throws `InvalidCastException` immediately if the object genuinely isn't an `Order`.

The numeric half of that block hides a real footgun: **implicit conversions** (`int` → `long`) are always safe, because the destination type can represent every possible value of the source — nothing is ever lost. **Explicit casts** carry no such guarantee, and `(byte)300` is the proof: 300 doesn't fit in a `byte`'s 0–255 range, so it silently wraps around to 44, with no warning, no exception, just a wrong number that looks like a right one. That silent wraparound is also the *default* behaviour for everyday integer arithmetic in C#, not just explicit casts — `int.MaxValue + 1` overflows back to a huge negative number without a peep, unless you opt into `<CheckForOverflowUnderflow>` project-wide or wrap specific risky arithmetic in a `checked` block.

One more rule worth having memorised, not just known: use **`decimal`** for money, never `double`. `decimal` is base-10 internally, so it represents a value like `0.1` *exactly*. `double` is binary floating point, and — this is the famous, often-demonstrated gotcha — `0.1 + 0.2 != 0.3` under binary floating point, because neither `0.1` nor `0.2` can be represented exactly in base 2 in the first place. For currency, that's not a rounding curiosity, it's a correctness bug waiting to happen.

## var, dynamic and object: three ways to avoid naming a type, for three different reasons {b}

| | What it is | Type checked |
|---|---|---|
| `var` | Compiler infers the static type from the right-hand side. **Still strongly typed.** | Compile time |
| `object` | The base of all types; you need casts to use it | Compile time (as `object`) |
| `dynamic` | Bypasses compile-time checks; resolved at runtime by the DLR | Runtime (errors become exceptions) |

It's worth being precise about `var`, because its name invites a misconception: `var` is **purely syntax**, resolved entirely at compile time, with zero runtime effect. `var x = 5;` doesn't produce some loosely typed variable — it compiles to exactly, literally, `int x = 5;`. The compiler already knows the right-hand side's type perfectly well; `var` just saves you typing it out a second time on the left.

`dynamic` is the genuine outlier in that table: it defers all member resolution — does this object even *have* a `.Foo()` method? — all the way to runtime, via the DLR (Dynamic Language Runtime). That trades away IntelliSense, compile-time error checking, and performance, all at once, in exchange for flexibility you'll rarely actually need in backend code. Reach for it almost never: COM interop and a handful of dynamic-JSON scenarios are about the only legitimate uses you'll run into.

## Memory layout and size {a}

- Every heap object carries a **header** before its own fields even begin — an 8-byte sync block index plus an 8-byte method table pointer on 64-bit — so even a completely empty object costs roughly **24 bytes**. That overhead is invisible in isolation, but allocate thousands of tiny objects per request and it adds up into real, measurable memory pressure.
- The runtime is free to reorder a class's fields in memory for better packing; structs, by contrast, default to **sequential layout** — the order you declared them in — which matters specifically for native interop, and can be controlled explicitly with `[StructLayout]`.
- `sizeof(int)` is 4 bytes, `long`/`double` are 8, `decimal` is 16, `Guid` is 16, `DateTime` is 8, and a reference is 8 bytes on a 64-bit process.
- `Unsafe.SizeOf<T>()` gives you the exact size of any type at runtime; **ObjectLayoutInspector** and BenchmarkDotNet's `MemoryDiagnoser` are the practical tools for actually measuring this in your own code rather than reasoning about it in the abstract.

:::qa What is the difference between a value type and a reference type?
A value type variable contains its data, and assignment copies the data. A reference type variable contains a reference to a heap object, and assignment copies the reference so both variables see the same object. Value types can't be null (without `Nullable<T>`) and can't be inherited; reference types are garbage-collected objects that support inheritance.
:::

:::qa Do value types always live on the stack?
No. Reference-type objects always live on the heap, but value types live wherever their container lives: locals on the stack (unless captured by a lambda or used in an async method or iterator), fields inside a class object on the heap, elements inline inside an array on the heap. The defining difference is copy semantics, not location.
:::

:::qa When would you use a struct instead of a class?
For a small (≈16 bytes or less), immutable value that logically represents a single value and isn't boxed often: Money, coordinates, strongly typed IDs. Make it a `readonly struct` or `readonly record struct`. Use classes for anything with identity, behaviour, inheritance or larger size.
:::

:::qa What is boxing and how do you avoid it?
Converting a value type to `object` or an interface, which allocates a heap object and copies the value; unboxing copies it back out with a type check. Avoid it with generics (`List<int>` instead of `ArrayList`), generic constraints instead of interface parameters, `IEquatable<T>`, and interpolated strings instead of `string.Format` with value arguments.
:::

:::qa Why is string immutable, and what are the consequences?
Immutability makes strings thread-safe, safe to use as dictionary keys, and allows interning. The consequence is that every modification allocates a new string, so build strings in loops with StringBuilder or string.Join/Concat.
:::

:::qa If you override Equals, what else must you do?
Override GetHashCode consistently (equal objects ⇒ equal hash codes), ideally implement `IEquatable<T>`, and overload `==`/`!=` so they agree. Or use a record, which generates all of this.
:::

:::qa Are reference types passed by reference in C#?
No. Everything is passed by value by default. For a reference type, the value passed is the reference, so the method can modify the object but reassigning the parameter doesn't affect the caller. Use `ref` to pass the variable itself.
:::

:::qa ref vs out vs in?
`ref`: the caller passes an initialised variable, and the method can read and write it. `out`: the method must assign it, and the caller needn't initialise it (TryParse pattern). `in`: a read-only reference, used to avoid copying large structs.
:::

:::qa Why use decimal instead of double for money?
`decimal` is a base-10 type that represents values like 0.1 exactly, with 28–29 significant digits. `double` is binary floating point, so many decimal fractions can't be represented exactly and rounding errors accumulate.
:::

:::qa What is the difference between var and dynamic?
`var` is compile-time type inference: the variable is still statically typed. `dynamic` defers all member resolution to runtime, so errors appear as runtime exceptions and you lose IntelliSense and performance.
:::

## Further reading

- [Value types (C# reference)](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/value-types)
- [Choosing between class and struct](https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/choosing-between-class-and-struct)
- [Boxing and unboxing](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/types/boxing-and-unboxing)
- Book: *C# in Depth* by Jon Skeet. Book: *CLR via C#* by Jeffrey Richter, chapter on type fundamentals.

## Verify this chapter

Exact memory layout (object header size, struct field packing) needs a profiler like ObjectLayoutInspector, not plain code — see [Further reading](#further-reading) for that. Everything else in this chapter is observable behaviour, so the program below asserts it directly. Run with `dotnet run` (plain console app, .NET 8/9, no extra packages).

```csharp
static void Rename(Customer c) => c.Name = "Renamed";
static void Replace(Customer c) => c = new Customer { Name = "Should not be visible" };
static void ReplaceRef(ref Customer c) => c = new Customer { Name = "Brand New" };

// Claim: assigning a struct copies the data; assigning a class copies only the reference.
var s1 = new PointS { X = 1 };
var s2 = s1;
s2.X = 99;
if (s1.X != 1) throw new Exception("FAIL: struct assignment should have copied, not shared, the data");
Console.WriteLine("OK: struct assignment copies the value (s1.X stayed 1)");

var c1 = new PointC { X = 1 };
var c2 = c1;
c2.X = 99;
if (c1.X != 99) throw new Exception("FAIL: class assignment should share the same object");
Console.WriteLine("OK: class assignment copies the reference, so both see the change (c1.X became 99)");

// Claim: a boxed value is frozen at the moment it was boxed — later changes to the original don't show through.
PointS p = new() { X = 1 };
object boxed = p;
p.X = 2;
if (((PointS)boxed).X != 1) throw new Exception("FAIL: the box should hold a copy taken at boxing time");
Console.WriteLine("OK: a boxed value type is an independent copy, frozen at boxing time");

// Claim: enums are not validated — a value outside the named set compiles and runs.
var bogus = (OrderStatus)42;
if (Enum.IsDefined(bogus)) throw new Exception("FAIL: 42 should not be a defined OrderStatus member");
Console.WriteLine($"OK: (OrderStatus)42 = {bogus} compiles and runs, but Enum.IsDefined correctly flags it as undefined");

// Claim: decimal represents 0.1 + 0.2 exactly as 0.3; double does not.
decimal d = 0.1m + 0.2m;
double f = 0.1 + 0.2;
if (d != 0.3m) throw new Exception("FAIL: decimal 0.1 + 0.2 should equal exactly 0.3");
if (f == 0.3) throw new Exception("FAIL: expected binary double 0.1 + 0.2 to NOT equal 0.3 exactly");
Console.WriteLine($"OK: decimal 0.1m+0.2m == 0.3m exactly; double 0.1+0.2 = {f:R} != 0.3 exactly (binary rounding)");

// Claim: everything is passed by value — `ref` is what lets a method reassign the caller's variable.
var customer = new Customer { Name = "Original" };
Rename(customer);
if (customer.Name != "Renamed") throw new Exception("FAIL: mutating through the reference should be visible to the caller");
Console.WriteLine("OK: Rename mutated the shared object — caller sees 'Renamed'");

Replace(customer);
if (customer.Name != "Renamed") throw new Exception("FAIL: reassigning the local copy of the reference must NOT affect the caller");
Console.WriteLine("OK: Replace reassigned only its own local copy — caller's variable is untouched");

ReplaceRef(ref customer);
if (customer.Name != "Brand New") throw new Exception("FAIL: ref should let the method reassign the caller's variable");
Console.WriteLine("OK: ReplaceRef (with `ref`) reassigned the caller's own variable");

// Claim: boxing a null Nullable<T> produces an actual null reference, not a box of "no value".
int? maybeNull = null;
object? boxedNullable = maybeNull;
if (boxedNullable is not null) throw new Exception("FAIL: boxing a null int? should produce a real null reference");
Console.WriteLine("OK: boxing a null int? produces an actual null reference");

struct PointS { public int X; }
class PointC { public int X; }
class Customer { public string Name = ""; }
enum OrderStatus { Draft = 0, Placed = 1, Paid = 2, Shipped = 3, Cancelled = 9 }
```
