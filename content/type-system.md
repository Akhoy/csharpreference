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

## Words you'll meet

| Word | In plain words |
|---|---|
| **value type** | A type whose variable holds the data itself. `=` makes a copy. |
| **reference type** | A type whose variable holds an *address* of an object. `=` copies the address, not the object. |
| **reference** | That address: an arrow pointing at an object. |
| **stack** | A scratch pad for the method that's running. Cleared automatically when the method returns. |
| **heap** | Long-term memory shared by the whole app. Objects stay until nothing points at them. |
| **garbage collector (GC)** | The part of .NET that finds heap objects nobody points at any more, and frees them. |
| **boxing** | Wrapping a value (like an `int`) in a new heap object so it can be treated as `object`. |
| **immutable** | Can't be changed after it's created. "Changing" it really makes a new one. |
| **hash code** | A number worked out from an object's contents. Collections use it like a shelf number. |

## Previously, and the bug {b}

Kettle's first feature is simple: a shopper can **save their basket for later** and keep shopping. The idea is to keep a snapshot of the basket, so the shopper can carry on changing the live one. You write it the obvious way, and it passes a quick test. Then the support emails start: "I added a tea to my saved list and it appeared in my basket too."

Step through the code and watch the two variables on the right:

:::walk The bug: "save for later" changes the live basket
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
@1 | basket = → basket #1 [ ]
`new Basket()` builds one basket object on the heap. The variable `basket` doesn't hold the basket. It holds an **arrow** (an address) pointing at it. Call that object *basket #1*.
@2 | basket = → basket #1 [Earl Grey]
Follow the arrow and add Earl Grey to basket #1.
@4 | basket = → basket #1 [Earl Grey] ; savedForLater = → basket #1 (the same one!)
The key line. `Basket` is a class, so `=` copies **the arrow, not the basket**. Now two variables point at one object. No second basket was made.
@5 | basket = → basket #1 [Earl Grey, Sencha] ; savedForLater = → basket #1 (the same one!)
Follow `savedForLater`'s arrow and add Sencha. It lands in basket #1, the only basket there is. Look at `basket`: it changed too.
@7 | | > Basket: 2 items
Print the live basket. Two items, though we "only" added Sencha to the saved one.
@8 | | > Saved:  2 items
And the saved one has two items as well. Of course it does: it's the same basket.
@10-15 | -
Why did `=` share instead of copy? Because of this one word: **`class`**. Every class is a *reference type*, and that's what the next section is about.
:::

Nothing is wrong with `Add`. The problem is line 4, `savedForLater = basket`. It looks like "make a copy", but it didn't copy the basket at all. To see why, you need the single most important idea in C#.

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

:::why Why would anyone design a language like this?
Because sharing is usually what you *want*. Kettle's basket is shown in three places at once: the page, the little counter in the header, and the checkout. They must all show **the same** basket, and adding a tea in one place must update all three. If `=` copied the whole basket, every screen would hold its own stale copy. Copying would also be slow for big objects: an order with 200 lines would be duplicated every time you passed it to a method.

So C# gives you both, and the type decides. Small values that *are* their data, like a price, a date or a count, are copied, because copying 16 bytes costs nothing and nobody expects 5 to change behind their back. Objects with an identity, like a basket, a customer or an order, are shared, because there should be one of each. The bug happens when you *think* you have a copy but you have a share.
:::

**The fix for Kettle** is to make a real copy on purpose. Watch the second basket appear this time:

:::walk The fix: copy the contents on purpose
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
@1-2 | basket = → basket #1 [Earl Grey]
Same start: one basket, holding Earl Grey.
@4 | basket = → basket #1 [Earl Grey]
This time call `Copy()`. Jump into it to see what it does.
@17 | basket = → basket #1 [Earl Grey] ; copy = → basket #2 [ ]
`new Basket()` builds a **second** basket object, basket #2, with its own empty list.
@18 | basket = → basket #1 [Earl Grey] ; copy = → basket #2 [Earl Grey]
Copy the *items*, not the arrow. Earl Grey is now in both baskets, but they're separate objects.
@19 | basket = → basket #1 [Earl Grey] ; savedForLater = → basket #2 [Earl Grey]
Return the arrow to basket #2. `savedForLater` points at the new basket, and `basket` still points at the original.
@5 | basket = → basket #1 [Earl Grey] ; savedForLater = → basket #2 [Earl Grey, Sencha]
Add Sencha through `savedForLater`. Only basket #2 changes.
@7-8 | | > Basket: 1 items | > Saved:  2 items
The live basket still has one item. The bug is fixed, because there really are two baskets now.
:::

:::qa What is the difference between a value type and a reference type?
A value-type variable contains its data, so assignment copies the data. A reference-type variable contains a reference to a heap object, so assignment copies the reference and both variables see the same object. Value types can't be null (without `Nullable<T>`) and can't be inherited from. Reference types are garbage-collected and support inheritance.
:::

## Where the data lives: stack and heap {i}

:::plain
A running program keeps data in two places. The **stack** is a scratch pad for the method that's running right now, and it's wiped automatically when that method ends. The **heap** is long-term storage shared by the whole app, where things stay until nothing uses them.
:::

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

:::walk Where each piece of data actually lives
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
@1-4 | -
`Order` is a class, so every `Order` object lives on the heap. Its `Quantity` field is an `int`, a value type, and it lives **inside** the object.
@6-7 | stack (M's frame) = { }
Calling `M()` pushes a new frame onto the stack for its local variables.
@8 | stack (M's frame) = { local = 5 }
`local` is a value type in a method, so the 5 sits right in the frame.
@9 | stack (M's frame) = { local = 5, order = → } ; heap = Order { Quantity = 0 }
`new Order()` puts the object on the heap. The frame holds only the arrow. And `Quantity`, an `int`, is on the heap too, because its container is.
@10 | stack (M's frame) = { local = 5, order = →, nums = → } ; heap = Order { Quantity = 0 }, Int32[] { 1, 2, 3 }
An array is an object, so it's on the heap, and its three `int`s are stored **inside** it, side by side.
@11 | stack = M's frame is gone ; heap = Order { … }, Int32[] { … } (nothing points at them)
`M` returns and its frame vanishes instantly, `local` included. The two heap objects stay until the GC notices nothing points at them, and then frees them.
:::

Two exceptions are worth knowing now. A local variable **captured by a lambda**, or used inside an **`async` method**, gets moved into a hidden heap object so it can outlive the frame. You'll see why in [Delegates](ch:delegates-events#closures-a-lambda-packs-a-backpack) and [async](ch:async-await).

:::why Why a backend developer cares
Every heap object is work for the GC later. A busy endpoint that creates thousands of tiny objects per request makes the GC run more often, and every run adds latency. Small, short-lived data stored as structs never touches the GC. But a *big* struct is slow to copy around. Pick by size and lifetime.
:::

:::qa Do value types always live on the stack?
No. Reference-type objects always live on the heap, but value types live wherever their container lives. A local is in the stack frame, unless it's captured by a lambda or used in an async method or iterator. A field lives inside its class object on the heap. An array element lives inline inside the array on the heap. The real defining difference is copy semantics, not location.
:::

## When should Kettle use a struct? {i}

:::plain
A struct is copied every time you pass it around. So it only makes sense for small things that act like a single value and never change, the way a number does.
:::

Kettle needs a `Money` type, an amount plus a currency. Should it be a struct? Microsoft's design guidelines say to **avoid structs unless all four** of these are true:

1. It represents **a single value** (money, a coordinate, an ID).
2. It's **small**, under about 16 bytes.
3. It's **immutable**: it never changes after creation.
4. It won't be **boxed** often (see the next section).

:::scene visuals/scenes/ts-struct-check.svg | Should it be a struct? Money vs Order
1. **One value?** Money is a single amount, like a number. An order is a bundle of lines, a status and a customer.
2. **Small?** Money is a little over 16 bytes. An order has many fields and lists. Copying it around would be slow.
3. **Never changes?** £12.50 stays £12.50, and "changing" it makes a new amount. An order gets paid, shipped and cancelled.
4. **Rarely boxed?** Money is mostly used as itself. (Boxing is the next section.)
5. Verdict: Money is a `readonly record struct`. Order is a `class`. When you're unsure, a class is the safe default.
:::

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
- **`record`** writes three things for you. Value equality: two `Money`s with the same fields are `==`. A readable `ToString()`. And `with`, for making a changed copy: `price with { Amount = 10m }`.

### Strongly typed IDs: the bug a struct can make impossible

Here's a real Kettle bug from launch week. A customer asked for a refund, and the refund vanished. No crash and no error, just money that never came back. The cause was one line where two arguments were the wrong way round.

Every ID in the system was a `Guid`. To the compiler, an order's ID and a customer's ID are both "a Guid", so it can't tell when you swap them. Step through it:

:::walk The bug: two Guids, swapped, and nobody notices
```csharp
var orderId    = Guid.NewGuid();
var customerId = Guid.NewGuid();
var orders = new Dictionary<Guid, decimal>();
orders[orderId] = 12.50m;
Refund(customerId, orderId);   // oops: swapped

void Refund(Guid order, Guid customer)
{
    if (orders.TryGetValue(order, out var amount))
        Console.WriteLine($"Refunded £{amount}");
    else
        Console.WriteLine("No such order. Refund lost.");
}
```
@1 | orderId = `7f3a…` (a Guid)
Make the order's ID. A `Guid` is a 16-byte random number, so in practice it's unique.
@2 | orderId = `7f3a…` (a Guid) ; customerId = `c91e…` (a Guid)
Make the customer's ID. It's **the same type**: also a `Guid`. Remember that, because it's the whole bug.
@3-4 | orderId = `7f3a…` (a Guid) ; customerId = `c91e…` (a Guid) ; orders = { `7f3a…` → £12.50 }
Store the order, keyed by its ID.
@5
Call `Refund` with the arguments **swapped**. The method wants `(Guid, Guid)`, and we gave it `(Guid, Guid)`. The compiler is satisfied. It compiles cleanly.
@7 | order = `c91e…` ← really the customer! ; customer = `7f3a…` ← really the order!
Inside `Refund`, the parameter called `order` holds the customer's ID. The names say one thing, the values say another, and nothing checks.
@9
Look up `c91e…` in the orders. There is no order with that ID, because it's a customer ID.
@12 | order = `c91e…` ← really the customer! ; customer = `7f3a…` ← really the order! | > No such order. Refund lost.
The refund silently fails. In production this was a support ticket, an angry customer and an hour of debugging to find **one swapped pair**.
:::

The fix is to give each kind of ID **its own type**. Wrap the `Guid` in a tiny struct, one per meaning. Now an `OrderId` and a `CustomerId` are as different to the compiler as an `int` and a `string`:

:::walk The fix: one tiny struct per kind of ID
```csharp
var orderId    = new OrderId(Guid.NewGuid());
var customerId = new CustomerId(Guid.NewGuid());

// Refund(customerId, orderId);  // won't compile
Refund(orderId, customerId);

void Refund(OrderId order, CustomerId customer) =>
    Console.WriteLine($"Refunding order {order.Value}");

readonly record struct OrderId(Guid Value);
readonly record struct CustomerId(Guid Value);
```
@10-11 | -
First, the two new types. Each is one line: a `readonly record struct` holding a single `Guid`. Different names make them **different types**, even though they hold the same thing inside.
@1 | orderId = OrderId(`7f3a…`)
Wrap the order's Guid in an `OrderId`.
@2 | orderId = OrderId(`7f3a…`) ; customerId = CustomerId(`c91e…`)
Wrap the customer's Guid in a `CustomerId`. Same 16 bytes inside, but now the *type* records what the value means.
@4 | ! CS1503: Argument 1: cannot convert from 'CustomerId' to 'OrderId'
Make last week's mistake again. (It's commented out here so the rest of the program can run.) It's now a **compile error**, and the build stops. The bug is caught on your machine, in red, before any customer can meet it.
@5
The right way round compiles, because each argument has exactly the type the method asks for.
@7-8 | order = OrderId(`7f3a…`) ; customer = CustomerId(`c91e…`) | > Refunding order 7f3a…
`Refund` runs with the right values.
:::

Why a **struct** and not a class? Look at the checklist above. An ID is one value. It's 16 bytes, the same as the `Guid` it wraps. It never changes. So it's a perfect struct: the safety costs nothing at run time. There's no heap allocation and no extra memory, just a check the compiler does for free. A class would work too, but every ID would then be a separate heap object for the garbage collector to track.

### Why structs should never change

Kettle's first struct wasn't `Money`. It was a `Point` for drawing the shop's seating map, and it had settable fields. It caused a bug that looked like the computer ignoring an assignment.

The key fact is from the start of this episode: **reading a struct gives you a copy**. That's harmless when the struct can't change. When it *can* change, you can easily change a copy and think you changed the original.

:::walk Same line, two containers, two different results
```csharp
var arr  = new Point[]     { new Point(1, 1) };
var list = new List<Point> { new Point(1, 1) };

arr[0].X = 5;       // works
// list[0].X = 5;   // CS1612
var p = list[0];    // a copy
p.X = 5;            // copy only
Console.WriteLine($"{arr[0].X} {p.X} {list[0].X}");
list[0] = p;        // put it back
Console.WriteLine(list[0].X);

struct Point
{
    public int X, Y;
    public Point(int x, int y) { X = x; Y = y; }
}
```
@1-2 | arr[0] = (1, 1) ; list[0] = (1, 1)
Make one `Point` in an array and one in a `List`. Both start at (1, 1).
@4 | arr[0] = (5, 1) ; list[0] = (1, 1)
`arr[0].X = 5` works. An array element is **a real slot in memory**, so `arr[0]` names the struct itself, and you change it in place.
@5 | ! CS1612: Cannot modify the return value of 'List<Point>.this[int]' because it is not a variable
The same line on a list is refused (it's commented out so the rest can run). Why? `list[0]` looks like an array access, but it's really a **method call**: the list's indexer, `get_Item(0)`. A method returns its result as a **copy**. Setting `X` on a copy that's thrown away straight after would do nothing, so the compiler stops you.
@6 | arr[0] = (5, 1) ; list[0] = (1, 1) ; p = (1, 1) (a copy)
Here's what that indexer really does, written out by hand: `p` gets a **copy** of the list's point.
@7 | arr[0] = (5, 1) ; list[0] = (1, 1) ; p = (5, 1) (a copy)
Change the copy. `p.X` is now 5, but the point inside the list is untouched. The compiler can't save you here, because this code is legal.
@8 | > 5 5 1
Print `arr[0].X`, `p.X` and `list[0].X`. The proof: the array changed, the copy changed, and **the list did not**. This is the bug that looks like an ignored assignment.
@9 | arr[0] = (5, 1) ; list[0] = (5, 1) ; p = (5, 1)
The fix for a mutable struct: copy out, change, **copy the whole thing back in**.
@10 | > 5
Now the list has it. That works, but you have to remember it every time.
:::

The lasting fix is to make the trap impossible. Declare the struct `readonly`, so nothing *can* change in place. Then the only way to "change" a point is to make a new one, and you can't forget to store it:

```csharp
var list = new List<Point> { new Point(1, 1) };
list[0] = list[0] with { X = 5 };   // make a changed copy, store it
Console.WriteLine(list[0]);          // Point { X = 5, Y = 1 }

readonly record struct Point(int X, int Y);
```

That's the reason behind the rule **keep structs immutable**. A mutable struct behaves differently depending on where it's stored (an array, a list, a field, a `foreach` variable). An immutable one behaves the same everywhere, just like an `int`.

:::qa When would you use a struct instead of a class?
For a small (about 16 bytes or less), immutable value that represents a single thing and isn't boxed often, like Money, coordinates or strongly typed IDs. Declare it `readonly struct` or `readonly record struct`. Use a class for anything with identity, behaviour, inheritance or a larger size.
:::

## Boxing: a value type in a cardboard box {i}

:::plain
Some code only accepts objects. When you hand it a plain number, C# quietly wraps the number in a new object on the heap, like putting it in a cardboard box. That wrapping costs an allocation every single time.
:::

Sometimes a value type has to be treated as an `object`, for example when it's passed to an old API that takes `object`. But `object` is a reference type, and a reference has to point at something on the heap. So the runtime makes something.

That step has a name: **boxing**. The runtime allocates a small heap object (the "box"), copies the value into it, and hands back a reference. **Unboxing** is the reverse: check the type, then copy the value back out.

:::scene visuals/scenes/ts-boxing.svg | What `object o = n` really does
1. `int n = 42;` A plain value in a local. No heap involved.
2. `object o = n;` The runtime **allocates a box on the heap** and copies 42 into it. `o` points at the box.
3. `n = 7;` The box still says 42. It holds a *copy* made at boxing time, not a link back to `n`.
4. `int m = (int)o;` **Unboxing** checks the box really holds an `int`, then copies 42 out into `m`.
:::

Why should Kettle care? The nightly sales report once ran on an old `ArrayList`, a list from before generics that stores everything as `object`. Every quantity added to it was boxed. The report was slow and the server's memory graph looked like a saw. Here's that effect, measured. `GC.GetAllocatedBytesForCurrentThread()` tells you how many bytes this thread has allocated on the heap so far, so the difference "after minus before" is what a piece of code cost:

:::walk Measure it: 1,000 numbers, boxed and not boxed
```csharp
using System.Collections;

var boxed = new ArrayList(1000);    // stores object
var plain = new List<int>(1000);    // stores int

long before = GC.GetAllocatedBytesForCurrentThread();
for (int i = 0; i < 1000; i++) boxed.Add(i);
long boxedBytes = GC.GetAllocatedBytesForCurrentThread() - before;

before = GC.GetAllocatedBytesForCurrentThread();
for (int i = 0; i < 1000; i++) plain.Add(i);
long plainBytes = GC.GetAllocatedBytesForCurrentThread() - before;

Console.WriteLine($"ArrayList: {boxedBytes:N0} bytes");
Console.WriteLine($"List<int>: {plainBytes:N0} bytes");
```
@3-4 | boxed = ArrayList, room for 1,000 ; plain = List<int>, room for 1,000
Make two lists, each with room for 1,000 items up front, so growing the list doesn't muddy the numbers. `ArrayList` stores `object`. `List<int>` stores `int`.
@6 | before = (bytes allocated so far)
Read the allocation counter before we start.
@7 | boxed = ArrayList [0, 1, 2 … 999] (1,000 boxes) ; before = (bytes allocated so far)
Add 1,000 ints to the `ArrayList`. Its slots hold `object`, a reference type, so every `int` must be **boxed**: a new heap object per number.
@8 | boxedBytes = 16,672
The counter went up by about 16 bytes per number. That's 1,000 boxes nobody asked for.
@10-11 | boxedBytes = 16,672 ; plain = List<int> [0, 1, 2 … 999]
Same again with `List<int>`. Its slots are real `int` slots, so each number is copied straight in.
@12 | boxedBytes = 16,672 ; plainBytes = 0
**Zero bytes.** Not one allocation, because nothing needed a box.
@14-15 | | > ArrayList: 16,672 bytes | > List<int>: 0 bytes
The numbers you see are from the 32-bit .NET runtime in your browser, where a box is 16 bytes. On a 64-bit server each box is 24 bytes, so the gap is even bigger. Scale that to a million orders and it's 24 MB of garbage per report.
:::

Boxing also hides in code that doesn't mention `object` at all:

```csharp
using System.Collections;

var list = new ArrayList();    // old, non-generic: stores object
list.Add(1);                   // boxes
IComparable c = 5;             // boxes: an interface is a reference type
string s = string.Format("{0}", 42);   // boxes 42 into an object[]

Console.WriteLine($"{list[0]} {c} {s}");
```

None of those lines look expensive, but each one is a hidden heap allocation.

**The fix is generics.** `List<int>` stores `int`s directly, with no boxes, because .NET creates a dedicated version of `List<T>` just for `int`. [Generics](ch:generics) explains how.

:::qa What is boxing and how do you avoid it?
Boxing converts a value type to `object` or an interface. It allocates a heap object and copies the value into it. Unboxing copies it back out after a type check. Avoid it with generics (`List<int>` instead of `ArrayList`), generic constraints instead of interface-typed parameters, `IEquatable<T>`, and string interpolation instead of `string.Format` with value arguments.
:::

## string: a reference type that acts like a value {b}

`string` is a class, so it's a reference type. But it was built to *feel* like a value:

- **It's immutable.** `+`, `Replace` and `ToUpper` never change a string. They return a new one.
- **`==` compares the text**, not the reference.
- **Identical literals are shared** ("interned"): two `"hello"`s in your code are one object.

Immutability has a cost when you build a string piece by piece. Each `+=` can't add to the old string, so it makes a new one and copies everything so far into it:

:::scene visuals/scenes/ts-strings.svg | Why `+=` in a loop gets slow
1. Strings can't change. So `s += "Sencha "` makes a brand-new string on the heap.
2. Adding `"Assam "` makes another new string and copies **all** of `"Sencha "` into it. The old string is now garbage.
3. Every round copies everything built so far, again. The copying grows much faster than the list.
4. For 1,000 teas that's about **3 million characters copied** and 999 dead strings for the GC. Double the teas and the copying quadruples. This growth is called **O(n²)** (n squared).
5. **`StringBuilder`** keeps one buffer with spare room. Each `Append` copies only the new piece, and `ToString()` makes the final string once.
:::

Kettle met this when it built the CSV export of the whole tea catalogue with `+=`. With 20 teas it was instant. With 5,000 it took seconds. Measure the difference between `+=` and `StringBuilder` yourself:

:::walk Measure it: 1,000 appends, two ways
```csharp
using System.Text;

string s = "";
long before = GC.GetAllocatedBytesForCurrentThread();
for (int i = 0; i < 1000; i++) s += "x";
Console.WriteLine($"+= allocated {GC.GetAllocatedBytesForCurrentThread() - before:N0} bytes");

before = GC.GetAllocatedBytesForCurrentThread();
var sb = new StringBuilder();
for (int i = 0; i < 1000; i++) sb.Append("x");
string result = sb.ToString();
Console.WriteLine($"StringBuilder allocated {GC.GetAllocatedBytesForCurrentThread() - before:N0} bytes");
Console.WriteLine(s == result);
```
@3-4 | s = "" ; before = (bytes so far)
Start with an empty string and read the allocation counter.
@5 | s = "xxx…x" (the 1,000th new string)
Each `+=` can't grow `s`, because strings never change. It allocates a **new** string one character longer and copies every character so far into it. Round 1 copies 1 character, round 2 copies 2, and so on up to 1,000.
@6 | | > += allocated 1,018,792 bytes
About **a megabyte** to build a 1,000-character string. That's half a million characters copied, and 999 dead strings for the GC.
@9 | sb = StringBuilder (one buffer with spare room)
A `StringBuilder` keeps an internal buffer with spare room, and grows it in big jumps only when it fills.
@10 | sb = StringBuilder "xxx…x"
Each `Append` copies only the one new character into the buffer.
@11 | sb = StringBuilder "xxx…x" ; result = "xxx…x"
`ToString()` makes the final string once.
@12 | | > StringBuilder allocated 4,400 bytes
**About 230 times less.** The difference grows with the length: double the characters and `+=` does four times the work, while `StringBuilder` only doubles.
@13 | | > True
Same text either way.
:::

For a small, fixed number of pieces, `+` and `$"..."` are fine. The compiler turns them into a single concatenation. The trap is only `+=` **in a loop**. When you have a collection, `string.Join` is simplest:

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

:::scene visuals/scenes/ts-decimal.svg | Where the stray 0.00000000000000004 comes from
1. In everyday base 10, ⅓ is 0.3333… forever. On paper you have to stop somewhere, so you write a slightly wrong number.
2. Computers count in base 2. In base 2, **0.1 never ends either**. `double` keeps 52 binary digits and drops the rest, so it really stores 0.1000000000000000055…
3. Add two slightly-wrong numbers and the errors show: 0.30000000000000004.
4. `decimal` stores base-10 digits, so 0.1m is exactly "1 × 10⁻¹" with nothing dropped. That's why money is always `decimal`.
:::

Here's the invoice bug, and three more ways a number can quietly be wrong:

:::walk Four numbers that look right and aren't
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
@1 | | > 0.30000000000000004
`0.1` and `0.2` are `double`s. Neither can be stored exactly in binary, so each is slightly off, and adding them shows the error. This was Kettle's invoice.
@2 | | > 0.3
The `m` suffix makes them `decimal`. They're stored in base 10, so 0.1m is exact and the sum is exactly 0.3.
@4 | big = 300
An `int` holding 300.
@5 | big = 300 ; b = 44
Squeeze it into a `byte`, which holds only 0 to 255. The cast keeps the lowest 8 bits and throws the rest away. 300 − 256 = **44**. No error, no warning.
@6 | | > 44
That's a quantity of 300 that became 44 without anyone noticing.
@7-8 | | > checked: overflow caught
Wrap the same cast in `checked` and C# throws an `OverflowException` instead of wrapping. Use it wherever overflow would be a bug.
@10 | o = → "not an order" (a string, typed as object)
A variable typed `object` can hold anything. Here it holds a string.
@11 | o = → "not an order" ; text = "not an order" | > pattern match gave a typed variable: not an order
`is string text` asks "is it a string?" and, if so, gives you a new variable `text` already typed as `string`. That's the safe way to test a type.
@12 | o = → "not an order" ; text = "not an order" ; maybeUri = null
`as Uri` means "give me it as a `Uri`, or `null` if it isn't one". It isn't, so you get `null`. No exception.
@13 | | > True
Confirmed. A plain cast, `(Uri)o`, would have thrown `InvalidCastException` here.
:::

The same idea in a few rules:

- **Widening is safe and implicit** (`int` → `long`). Nothing can be lost.
- **Narrowing needs a cast and can silently wrap** (`(byte)300` is 44). Plain arithmetic wraps too: `int.MaxValue + 1` is a large negative number. Wrap risky maths in `checked` to get an exception instead.
- To test a type: `is` (check and get a typed variable) is the best choice. `as` returns `null` on failure. A cast `(Order)o` throws on failure.

:::qa Why use decimal instead of double for money?
`decimal` is base 10 and represents values like 0.1 exactly, with 28–29 significant digits. `double` is binary floating point, so many decimal fractions can't be represented exactly and rounding errors build up.
:::

## "Not set yet": nullable value types {b}

An order has a `ShippedAt` date, but only once it ships. A `DateTime` can't be `null`, because a value type always holds *some* value. Kettle's first version used `DateTime.MinValue` to mean "not shipped yet". A month later the delivery report said the average order took **2,024 years** to ship, because it averaged in every "0001-01-01".

Add `?`: **`DateTime?`** is a nullable value type, short for `Nullable<DateTime>`. It's just a small struct holding a flag (`HasValue`) plus the value.

:::walk "Not shipped yet" without lying
```csharp
DateTime? shippedAt = null;
Console.WriteLine(shippedAt.HasValue);               // False
Console.WriteLine(shippedAt?.ToString("d") ?? "not shipped yet");

int? discount = null;
int effective = discount ?? 0;                       // ?? = "use this if null"
Console.WriteLine(effective);
```
@1 | shippedAt = null (HasValue = false)
`DateTime?` is a tiny struct: a `bool` flag plus a `DateTime`. Assigning `null` just sets the flag to false. Nothing is on the heap.
@2 | | > False
`HasValue` reads the flag.
@3 | | > not shipped yet
`?.` means "only call `ToString` if there's a value", so it produces `null` here. Then `??` means "if the left side is null, use the right side instead".
@5 | discount = null
The same works for any value type, here an `int?`.
@6 | discount = null ; effective = 0
`discount ?? 0` gives 0, because `discount` has no value. Now the code says exactly what it means: no discount counts as zero.
@7 | | > 0
And reports can now *skip* unshipped orders instead of averaging in the year 1.
:::

Don't confuse it with `string?`. Strings can already be null, and `string?` is a compile-time *warning* system covered in [Modern C#](ch:modern-csharp#nullable-reference-types-the-compiler-tracks-maybe-null).

## Enums: named numbers with a sharp edge {b}

An `enum` gives names to integers: `OrderStatus.Paid` is really just `2`. That's useful, because a database column or a JSON field can store the small number. It's also dangerous, as Kettle found when a partner's app sent `"status": 42` and an order was saved in a state that doesn't exist.

:::walk Names for numbers, and a number with no name
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
@10 | -
The enum. Each name is given an explicit number. `Cancelled = 9` shows the numbers don't have to be consecutive.
@1 | s = Paid (stored as 2)
`s` holds `OrderStatus.Paid`. In memory it's just the `int` 2.
@2 | | > Paid = 2
Printing an enum gives its name. Casting to `int` gives the number underneath.
@4 | s = Paid (stored as 2) ; bogus = 42 (no name!)
Cast 42 to `OrderStatus`. There's no member with that number, but **it compiles and runs**. An enum is only a label on an `int`, and C# doesn't check the value. This is exactly what the partner's `"status": 42` did.
@5 | | > 42, defined? False
`Enum.IsDefined` is the check you have to add yourself, at the edge where outside data comes in.
@12 | -
`[Flags]` is a different use: each member is a separate bit (1, 2, 4), so members can be combined.
@7 | p = Read, Write (bits 1 + 2 = 3)
`|` combines the bits: Read (1) and Write (2) make 3.
@8 | | > Read, Write, can write: True
`HasFlag` tests one bit.
:::

:::gotcha Enums aren't checked
`(OrderStatus)42` is perfectly legal, so a bad value from JSON or the database slips straight in. Check outside input with `Enum.IsDefined` or a `switch` with a `default` arm. If you store enums as numbers, give every member an **explicit** number, or reordering the declaration silently changes the meaning of stored data. In public APIs, prefer sending enums as strings.
:::

## Equality: "the same" means three things {i}

:::plain
"Are these equal?" can mean "is this the very same object?" or "do these hold the same values?". Classes answer the first question by default, records answer the second, and hash-based collections need you to be consistent about which one you mean.
:::

Two `Money` values of £5 are the same money. Two `Customer` objects that happen to share a name are probably *not* the same customer. C# lets you ask both questions, and each kind of type has a different default:

| | class | struct | record |
|---|---|---|---|
| `==` | same object? (unless overloaded, like `string`) | not available unless you define it | same values? |
| `Equals` | same object? | same values? (slow: uses reflection) | same values? (fast, generated) |
| `ReferenceEquals` | same object? | always false | same object? |

`HashSet` and `Dictionary` don't compare your item with every item they hold. That would be slow. They first compute its **hash code**, a number worked out from its contents, and use it like a shelf number to pick one small **bucket**. Only then do they call `Equals` on the few items in that bucket:

:::scene visuals/scenes/ts-equality.svg | How a HashSet finds things, and how it loses them
1. `set.Add(a)`: the set asks `a.GetHashCode()`, gets 7, and files `a` in **bucket 7**.
2. `set.Contains(b)`, where `b` is a *different object* with the same value. Same value, so same hash code, 7. The set looks **only** in bucket 7, and `Equals(a, b)` confirms the match. Found.
3. Now imagine a class that overrides `Equals` but **not** `GetHashCode`. Its hash code comes from the object's identity, so `a` and `b` land in different buckets. The set looks in the wrong bucket and says "not found", even though `Equals` would have said yes.
4. Or change `a`'s code *after* adding it. `a` is still filed in bucket 7, but its hash code now points to bucket 3. Every lookup checks bucket 3. `a` is lost, with no error.
5. The two rules: **equal objects must give equal hash codes**, so override `Equals` and `GetHashCode` together. And **never change a key** while it's inside a set or dictionary. A record follows the first rule for you.
:::

:::walk Two different objects, one value
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
@8-13 | -
`Sku` is a **record**. It's still a class (shared, on the heap), but the compiler writes value-based `Equals`, `GetHashCode` and `==` for it. The constructor upper-cases the code, so `tea-01` and `TEA-01` mean the same product.
@1 | a = → Sku #1 { Code = TEA-01 }
One object.
@2 | a = → Sku #1 { Code = TEA-01 } ; b = → Sku #2 { Code = TEA-01 }
A **second** object. Two separate allocations, two different arrows.
@3 | | > True
For a plain class `==` would ask "same object?" and say False. The record compares the **values** instead, and they match.
@5 | set = { Sku #1 } (filed under hash of "TEA-01")
Put `a` in a `HashSet`. The set calls `a.GetHashCode()` and files it in that bucket. The record's hash code is computed from `Code`.
@6 | | > True
Look up `b`. Its hash code is computed from the same `Code`, so it's the **same number**, and the set checks the right bucket. Then `Equals` confirms. Found, even though `b` was never added.
:::

Now the bug Kettle actually shipped. Before records, someone wrote a `Tea` class and overrode `Equals` so two teas with the same code count as equal. They didn't override `GetHashCode`. Every test of `Equals` passed. Then the "already in your basket?" check stopped working:

:::walk The lost item: Equals without GetHashCode
```csharp
var a = new Tea("tea-01");
var b = new Tea("tea-01");
Console.WriteLine(a.Equals(b));

var basket = new HashSet<Tea> { a };
Console.WriteLine(basket.Contains(b));

class Tea
{
    public string Code { get; }
    public Tea(string code) => Code = code;
    public override bool Equals(object? o) => o is Tea t && t.Code == Code;
    // GetHashCode not overridden: it still comes from the object's identity
}
```
@12 | -
`Equals` is overridden: two teas are equal if their codes match.
@13
But `GetHashCode` is not. The default hash code is based on **which object** it is, not on its contents. Two different objects almost always get two different numbers.
@1-2 | a = → tea #1 { tea-01 } ; b = → tea #2 { tea-01 }
Two separate objects with the same code.
@3 | | > True
`Equals` says they're equal. So far so good, and this is where the tests stopped.
@5 | a = → tea #1 { tea-01 } ; b = → tea #2 { tea-01 } ; basket = { tea #1 } in the bucket for a's hash code
Add `a` to a `HashSet`. The set asks for `a`'s hash code and files it in that bucket.
@6 | | > False
Look up `b`. The set asks for `b`'s hash code: a **different number**, because `b` is a different object. So it searches a different bucket, finds nothing there, and never even calls `Equals`. "Not in your basket", and the shopper gets a duplicate line.
:::

The fix is to override `GetHashCode` from the same fields as `Equals`, for example `public override int GetHashCode() => Code.GetHashCode();`. Or make `Tea` a `record`, which writes both correctly for you. The compiler even warns you (CS0659) when you override one without the other.

:::qa If you override Equals, what else must you do?
Override `GetHashCode` consistently, so equal objects give equal hash codes. Ideally also implement `IEquatable<T>`, and overload `==` and `!=` so they agree. Or use a record, which generates all of this.
:::

## Passing to methods: you always pass a copy {i}

:::plain
A method never gets your variable itself, only a copy of what's in it. For a class, what's in it is an arrow to an object. So the method can change *the object*, but it can't make *your variable* point somewhere else, unless you say `ref`.
:::

Here's the rule that untangles every parameter question: **C# passes every argument by value, which means as a copy.** For a class, what gets copied is the *reference*. So the method gets its own arrow to *your* object.

:::scene visuals/scenes/ts-passing.svg | What does a method get?
1. The caller's variable `basket` points at a basket on the heap with two teas in it.
2. Call `Empty(basket)`. The method's parameter `b` is a **copy of the arrow**. It points at the same basket.
3. `b.Clear();` follows the arrow and empties the shared basket. The caller **sees** this, because it's the same object.
4. `b = new Basket();` moves only the method's own arrow. The caller's `basket` still points at the original. Reassigning a parameter never reaches the caller.
5. Unless you write **`ref`**. Then there's no copy: `b` *is* the caller's variable, and reassigning it moves the caller's arrow too.
:::

:::walk What a method can and can't change
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
@1 | c = → customer #1 { Name = Ada }
One customer object, and the caller's variable `c` points at it.
@2 | c = → customer #1 { Name = Renamed } | > Renamed
`Rename(c)` gets a copy of the arrow, follows it, and changes the name. Same object, so the caller sees "Renamed".
@3 | c = → customer #1 { Name = Renamed } | > Renamed
`Replace(c)` points **its own copy** of the arrow at a new customer called "Lost". The caller's `c` never moved, so it still says "Renamed". The "Lost" customer becomes garbage when the method returns.
@4 | c = → customer #3 { Name = Brand new } | > Brand new
With `ref`, the method gets the caller's **variable itself**, not a copy. Reassigning it moves the caller's arrow.
@6-8
The three methods. They differ by one word, and the word is `ref`.
:::

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

:::walk var is still typed, object has to be unwrapped
```csharp
var a = 5;                      // the compiler writes: int a = 5;
object b = 5;                   // an int, boxed, and seen only as "some object"
Console.WriteLine($"{a.GetType().Name}, {b.GetType().Name}");
Console.WriteLine(a + 1);
// Console.WriteLine(b + 1);    // compile error: object has no + operator
Console.WriteLine((int)b + 1);  // cast it back first
```
@1 | a = 5 (type: int)
`var` doesn't mean "any type". The compiler looks at the right-hand side, sees an `int`, and makes `a` an `int`, exactly as if you'd written it.
@2 | a = 5 (int) ; b = → box holding 5 (type: object)
`object` really is "any type". The `int` is boxed, and the variable only promises "this is some object".
@3 | | > Int32, Int32
At runtime both values are `Int32`. The difference is what the **compiler** knows about each variable.
@4 | | > 6
The compiler knows `a` is an `int`, so `+` works.
@5 | ! CS0019: Operator '+' cannot be applied to operands of type 'object' and 'int'
For `b` it only knows "object", and objects can't be added. (Commented out so the rest runs.)
@6 | | > 6
Cast it back to `int` (unboxing) and it works. `dynamic` would skip this check entirely and look up `+` at runtime, so a typo becomes a crash for a customer instead of an error for you.
:::

:::qa What is the difference between var and dynamic?
`var` is compile-time type inference: the variable is still statically typed. `dynamic` defers all member lookups to runtime, so mistakes show up as runtime exceptions and you lose IntelliSense and speed.
:::

## Memory layout and size {a}

:::plain
Every object on the heap carries a small hidden label before its data, so tiny objects are surprisingly expensive. Structs stored in an array don't need that label.
:::

:::scene visuals/scenes/ts-object-layout.svg | What one Order really costs
1. The variable `order` holds only an **address**: 8 bytes on a 64-bit machine.
2. On the heap, every object starts with a **16-byte header**, before any of your fields. 8 bytes are used by the runtime for locks and hashing. The other 8 point at the object's type ("I'm an `Order`").
3. Then your fields: `Quantity` (4 bytes, plus 4 bytes of padding so the next field lines up) and `Total` (a 16-byte `decimal`). That's **40 bytes**, and 16 of them are overhead.
4. Even an empty object costs about 24 bytes. A million tiny objects means about 24 MB of headers alone. An **array of structs** has one header for the whole array, then pure data side by side.
:::

Measure it. Here are a thousand orders stored as objects, and a thousand stored as structs:

:::walk Measure it: 1,000 orders as classes vs structs
```csharp
long before = GC.GetAllocatedBytesForCurrentThread();
var classes = new OrderC[1000];
for (int i = 0; i < 1000; i++) classes[i] = new OrderC();
long classBytes = GC.GetAllocatedBytesForCurrentThread() - before;

before = GC.GetAllocatedBytesForCurrentThread();
var structs = new OrderS[1000];
long structBytes = GC.GetAllocatedBytesForCurrentThread() - before;

Console.WriteLine($"1,000 class orders:  {classBytes:N0} bytes");
Console.WriteLine($"1,000 struct orders: {structBytes:N0} bytes");

class OrderC { public int Quantity; public decimal Total; }
struct OrderS { public int Quantity; public decimal Total; }
```
@13-14 | -
The same two fields, once as a class and once as a struct.
@2 | classes = array of 1,000 arrows, all null
An array of a class type holds **arrows**. Right now they all point nowhere.
@3 | classes = array of 1,000 arrows → 1,000 separate objects
Fill it: 1,000 `new OrderC()`, each a separate heap object with its own header.
@4 | classBytes = 36,720
About 36 bytes per order: each object (header plus fields) and its arrow in the array.
@7 | classBytes = 36,720 ; structs = array of 1,000 orders, stored side by side
An array of a struct type holds **the data itself**, one order after another, with one header for the whole array. There's nothing to fill in, because each slot is already an order (with zeros).
@8 | classBytes = 36,720 ; structBytes = 24,016
About 24 bytes per order. That's just the fields: no header per order and no arrow per order.
@10-11 | | > 1,000 class orders:  36,720 bytes | > 1,000 struct orders: 24,016 bytes
A third less memory, and one object for the GC instead of 1,001. These figures are from the 32-bit runtime in your browser. On a 64-bit server the class version costs about 48 bytes per order, so the struct version is half the size.
:::

- These numbers are CLR implementation details, documented in *Pro .NET Memory Management* and *CLR via C#*, not promises in the C# language.
- Common sizes: `int` 4 bytes, `long`/`double`/`DateTime` 8, `decimal`/`Guid` 16, a reference 8 (on 64-bit).
- The runtime may reorder a class's fields to pack them tightly. Structs keep **declaration order** by default, which matters when you pass them to native code (`[StructLayout]`).
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
