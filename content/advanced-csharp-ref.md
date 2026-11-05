---
id: advanced-csharp-ref
title: "Change It Where It Lives: ref Locals, ref Returns and in"
summary: "02:30: repricing two million structs with an ordinary loop only changes copies, because reading a struct out of a collection copies it. ref locals and returns point at the actual slot instead. Third of eight chapters on advanced C#."
layer: language
where: C# language › Advanced & low-level features › Memory
fits: Resolves the struct-copying behaviour from [Types: Copied or Shared?](ch:type-system#the-lightbulb-copied-or-shared). Builds on [spans](ch:advanced-csharp-span) and [pooling](ch:advanced-csharp-pool): the same CollectionsMarshal family that exposes a List's internal array here is what AsSpan uses there.
levels: a
prereqs: advanced-csharp-pool
next: advanced-csharp-interop
---

:::plain
Reading a struct out of an array gives you a copy, so changing it changes the copy. A `ref` variable points at the struct's actual slot instead, so a change lands in the array itself.
:::

## Start from zero: "a reference" and "a ref" are different things

C# uses the word *reference* for two unrelated ideas, and mixing them up causes most of the confusion in this act.

1. **A reference to an object.** A variable of a class type, such as `Order o`, holds the address of an object on the heap. Copying the variable copies the address, so both copies point at the same object ([Episode 1](ch:type-system#the-lightbulb-copied-or-shared)).
2. **A `ref` to a variable.** `ref int n` doesn't point at an object. It points at a **storage location**: a local variable, a field, or one slot of an array. Writing to `n` writes into that location.

The test that shows the difference is a method that replaces its parameter:

```csharp norun
void Replace(Order o)     { o = new Order(); }   // changes the method's own copy of the address; the caller sees nothing
void Replace(ref Order o) { o = new Order(); }   // changes the caller's VARIABLE: it now points at the new order
```

Passing an `Order` without `ref` already lets the method change the order's *contents*, because both addresses point at the same object. What `ref` adds is the power to change **which object** the caller's variable points at, or, for structs, to change the caller's struct in place instead of a copy ([Passing to methods](ch:type-system#passing-to-methods-you-always-pass-a-copy)).

The import finished. Now every price goes up 5%. Kettle keeps stock levels as a **struct**, `StockLevel` (it's small and there are two million of them, so a struct is the right call per [Episode 1](ch:type-system#when-should-kettle-use-a-struct)). The obvious code doesn't even compile:

```csharp norun
foreach (var s in stock) s.Price *= 1.05m;   // ✗ CS1654: s is a read-only COPY of each element
stock[0].Price *= 1.05m;                      // ✗ CS1612 on a List<T>: the indexer returns a COPY
```

You met this in Episode 1: a struct is **copied** whenever it's read out of a collection, so changing "it" changes a temporary copy. The workaround people reach for is "read, change, write back", which copies every struct out **and** back in.

**The lightbulb:** you want a variable that doesn't hold a copy of the struct but **points at the slot where the struct lives**. That's a **`ref` local**: `ref var s = ref stock[0];`. Writing `s.Price` writes straight into the array. The same idea appears in two more places. A **`ref` return** is a method handing back a slot, not a copy. An **`in` parameter** passes a read-only reference instead of copying a big struct.

:::scene visuals/scenes/adv-ref.svg | A copy, or the slot itself?
1. `var s = stock[0]` gives you a **copy**. Changing the price changes the copy, and the array still says £10.00. That's why the compiler refuses `foreach (var s …) s.Price = …`.
2. `ref var s = ref stock[0]` gives you an arrow **into slot 0**. There's no copy: `s` *is* the slot, so writing `s.Price` changes the array.
3. `foreach (ref var s in span)` walks every slot with a ref and updates each one in place. That's 2 million structs and zero copies.
4. `in` passes a **read-only reference** to a method, so a big struct isn't copied on every call. (Mark the struct `readonly`, or the compiler may copy it anyway to protect it.)
5. Why this is safe: the compiler **proves** a ref can never outlive what it points at. Returning a ref to a local variable is a compile error. This is called **ref safety**, and the `scoped` keyword lets you tighten it further.
:::

:::walk Change it where it lives
```csharp
using System.Runtime.InteropServices;

var stock = new List<StockLevel> { new("TEA-01", 10.00m), new("TEA-02", 20.00m), new("TEA-03", 6.00m) };

foreach (ref var s in CollectionsMarshal.AsSpan(stock))   // a ref to each slot of the List's own array
    s.Price *= 1.05m;                                       // written in place: no copies
Console.WriteLine(string.Join(", ", stock.Select(s => $"{s.Sku} £{s.Price:0.00}")));

StockLevel[] shelf = [new("TEA-09", 4.00m), new("TEA-10", 0m)];
ref StockLevel tea10 = ref Find(shelf, "TEA-10");          // a ref RETURN: the slot, not a copy
tea10.Price = 7.50m;
Console.WriteLine($"{shelf[1].Sku} now £{shelf[1].Price}, valid: {IsValid(in shelf[1])}");

static ref StockLevel Find(StockLevel[] items, string sku)
{
    for (int i = 0; i < items.Length; i++)
        if (items[i].Sku == sku) return ref items[i];
    throw new KeyNotFoundException(sku);
}

static bool IsValid(in StockLevel s) => s.Price > 0;      // in: a read-only reference, no copy

struct StockLevel(string sku, decimal price)
{
    public string Sku = sku;
    public decimal Price = price;
}
```
@3 | stock = List [TEA-01 £10.00, TEA-02 £20.00, TEA-03 £6.00]
Three `StockLevel` structs in a `List`. Because they're structs, they sit **inside** the list's internal array, one after another.
@5 | s = ref → slot 0 of the list's array
`CollectionsMarshal.AsSpan` gives a span over the list's own array, and `ref var s` makes `s` an arrow **to the slot**, not a copy of the struct.
@6 | stock = List [TEA-01 £10.50, TEA-02 £20.00, TEA-03 £6.00]
`s.Price *= 1.05m` writes straight into slot 0.
@5-6 | stock = List [TEA-01 £10.50, TEA-02 £21.00, TEA-03 £6.30]
The loop does the same for every slot. No struct was copied out or back in.
@7 | | > TEA-01 £10.50, TEA-02 £21.00, TEA-03 £6.30
@9 | shelf = [TEA-09 £4.00, TEA-10 £0]
An array with a mistake in it: TEA-10 has no price.
@16-17 | i = 1
`Find` searches the array and returns `ref items[i]`: not the struct, but **the slot it lives in**.
@10 | tea10 = ref → shelf[1]
So `tea10` is an alias for `shelf[1]`.
@11 | shelf = [TEA-09 £4.00, TEA-10 £7.50]
Setting the price through the alias changes the array.
@21 | s = read-only ref → shelf[1]
`in` passes a **read-only** reference: the method can look but not change, and the struct isn't copied.
@12 | | > TEA-10 now £7.50, valid: True
:::

:::gotcha `CollectionsMarshal.AsSpan` and resizing
`CollectionsMarshal.AsSpan(list)` gives you the `List`'s own internal array. Don't add or remove items while you hold it. A resize swaps in a new array ([Episode 5](ch:collections#inside-list-why-add-is-amortised-o-1)) and your span keeps pointing at the old one.
:::

The rest of this family is mostly for library authors: `ref readonly` returns, `scoped`, and `Unsafe`, `MemoryMarshal` and `CollectionsMarshal` for expert control over memory.

## The ref family, in full {a}

Every place `ref` can appear, and what it means there:

| Form | Meaning | Typical use |
|---|---|---|
| `ref` parameter | The method reads **and writes** the caller's variable. The caller must have assigned it first. | Swapping, updating a big struct in place |
| `out` parameter | The method **must** assign it before returning. The caller needn't assign it first. | `TryParse(text, out var value)` |
| `in` parameter | A **read-only** reference. The caller may omit `in`, and may even pass a value like `5`, for which the compiler quietly makes a temporary. | Passing large structs without copying |
| `ref readonly` parameter (C# 12) | Like `in`, but the caller is expected to pass a **variable**, and gets a warning for a temporary value. | APIs that keep the reference, where a temporary would be a bug |
| `ref` local | An alias for a storage location. Since C# 7.3 you can point it somewhere else: `r = ref other;` | Updating array slots or struct fields in place |
| `ref` return | The method returns an alias to a location, not a copy. | Lookups that let the caller update in place |
| `ref readonly` local or return | An alias you can read through but not write through | Exposing big structs without copying them or letting callers change them |
| `ref` field (C# 11) | A field holding a `ref`. Only allowed inside a `ref struct`. | `Span<T>` itself |
| `scoped` | This `ref` or span can't escape the current method. | Letting callers pass stack memory |

**Two practical tools from `CollectionsMarshal`:**

- `CollectionsMarshal.AsSpan(list)`, used above, gives a span over a `List<T>`'s own array.
- `CollectionsMarshal.GetValueRefOrAddDefault(dictionary, key, out bool existed)` gives a `ref` to a dictionary entry's value, adding a default entry if the key is missing. Counting with it needs **one** hash lookup instead of two:

```csharp
using System.Runtime.InteropServices;

var counts = new Dictionary<string, int>();
foreach (var sku in new[] { "TEA-01", "TEA-02", "TEA-01", "TEA-01" })
{
    ref int n = ref CollectionsMarshal.GetValueRefOrAddDefault(counts, sku, out _);
    n++;                                    // writes straight into the dictionary's entry
}
Console.WriteLine(string.Join(", ", counts.Select(kv => $"{kv.Key}={kv.Value}")));   // TEA-01=3, TEA-02=1
```

The usual `counts[sku] = counts.GetValueOrDefault(sku) + 1` hashes the key twice: once to read, once to write. In a hot loop over millions of rows, that's half the work saved. As with `AsSpan`, don't add or remove entries while you hold the `ref`.

## Defensive copies, proved {a}

The Q&A below describes **defensive copies**. Here's one you can watch happen. A `readonly` field holds an ordinary (mutable) struct, and a method changes it:

:::walk The change that vanishes
```csharp
var holder = new Holder();
holder.Bump();
holder.Bump();
Console.WriteLine($"readonly field after 2 bumps: {holder.Peek()}");

var local = new Counter();
local.Increment();
local.Increment();
Console.WriteLine($"plain local after 2 bumps: {local.Value}");

class Holder
{
    private readonly Counter _counter;          // a readonly field holding a MUTABLE struct
    public void Bump() => _counter.Increment(); // compiles, but runs on a hidden copy
    public int Peek() => _counter.Value;
}

struct Counter
{
    public int Value;
    public void Increment() => Value++;
}
```
@1 | holder = Holder { _counter = Counter { Value = 0 } }
`_counter` is `readonly`: the class promises it never changes after construction.
@2 | holder = Holder { _counter.Value = 0 } ; hidden copy = Counter { Value = 1 }
`Increment` might change the struct, and the compiler can't see inside it to check. To keep the `readonly` promise, it copies `_counter` to a temporary and calls `Increment` **on the copy**. The copy goes to 1 and is thrown away.
@3 | holder = Holder { _counter.Value = 0 }
Same again. The field never changes.
@4 | | > readonly field after 2 bumps: 0
Two calls, no effect, and no warning from the compiler.
@6-8 | local = Counter { Value = 2 }
A plain local isn't `readonly`, so `Increment` runs on the real struct.
@9 | | > plain local after 2 bumps: 2
:::

The same hidden copy happens when you call a struct method through an `in` parameter or a `ref readonly` local. Here it changed the **result**. In the `in` case it only costs **speed**: you passed by reference to avoid a copy, and the compiler made one anyway.

The fix is to tell the compiler which methods don't change the struct:

- **`readonly struct`**: every field is readonly, and every method is checked not to change them. The compiler never needs a defensive copy.
- **`readonly` on individual members**, such as `public readonly decimal Total() => …`, for a struct that must stay mutable elsewhere.

With either fix, the compiler can call the method straight on the original. Any method that does try to change a field becomes a compile error, so the `Counter` above would refuse to compile instead of silently losing increments.

**How big is too big for a struct?** Copying a struct copies every byte. The long-standing guideline is to keep structs under about **16 bytes**, two or so fields. Larger structs can still be the right choice (for millions of elements in an array, as here), but then pass them with `in` or `ref readonly`, and make them `readonly struct` so those references don't trigger defensive copies.

:::qa What is a defensive copy, and how do `in` and `readonly struct` relate to it?
Some struct values are promised never to change: one passed as an `in` parameter, or one stored in a `readonly` field. Now you call a method on it, say `price.Round()`. Inside that method, `this` refers to the struct, and an ordinary struct method is allowed to assign to its own fields. The compiler can't see inside the method to know whether it does. So, to keep its promise, it calls the method **on a temporary copy** instead of on the original. That's a defensive copy. Nothing breaks, but you pay for copying the whole struct on every call, which silently undoes the point of `in` ("pass by reference so we *don't* copy"). Declaring the type `readonly struct`, or marking individual methods `readonly`, tells the compiler those methods can't write to fields. The compiler checks that, so it can safely call them directly on the original, with no copy.
:::

:::qa Follow-up: if a class is already passed "by reference", what does the ref keyword add?
A class variable holds a reference, and passing it copies that reference, so the method can change the object's contents but not which object the caller's variable points at. With `ref`, the method receives the caller's variable itself, so it can make that variable point at a different object, or, for a struct, change the caller's struct in place rather than a copy.
:::

:::qa Follow-up: in vs ref readonly parameters?
Both pass a read-only reference. With `in`, the caller may leave the keyword off and may pass a value like `5`, for which the compiler creates a hidden temporary. `ref readonly` (C# 12) expects a real variable and warns when given a temporary, which matters for APIs that keep or compare the reference. Either way, use a `readonly struct` so calls through the reference don't trigger defensive copies.
:::

## Verify this chapter

```csharp
using System.Runtime.InteropServices;

var stock = new List<Level> { new() { Price = 10m } };
var copy = stock[0]; copy.Price = 99m;
Check(stock[0].Price == 10m, "reading a struct out of a list gives a copy");
foreach (ref var l in CollectionsMarshal.AsSpan(stock)) l.Price = 11m;
Check(stock[0].Price == 11m, "a ref over the list's storage updates in place");

var holder = new Holder(); holder.Bump();
Check(holder.Peek() == 0, "calling a mutating method on a readonly struct field changes a defensive copy");
var counts = new Dictionary<string, int>();
foreach (var k in new[] { "a", "b", "a" }) CollectionsMarshal.GetValueRefOrAddDefault(counts, k, out _)++;
Check(counts["a"] == 2 && counts["b"] == 1, "GetValueRefOrAddDefault updates the entry in place");

static void Check(bool ok, string claim) =>
    Console.WriteLine(ok ? $"OK: {claim}" : throw new Exception($"FAIL: {claim}"));

struct Level { public decimal Price; }
class Holder { private readonly Counter _c; public void Bump() => _c.Increment(); public int Peek() => _c.Value; }
struct Counter { public int Value; public void Increment() => Value++; }
```
