---
id: delegates-events
title: "Delegates: Passing Behaviour Around (Lambdas, Closures, Events)"
summary: "Episode 4. The discount rule changes every week, and every change means editing checkout. Delegates let you hand checkout the rule itself, a method stored in a variable. Covers Func and Action, lambdas, closures and what the compiler generates for them, multicast delegates, events, how ASP.NET Core is built from delegates, and expression trees."
layer: language
where: C# language › Functions as values
fits: Layer 1, and the hidden key to layer 3. A middleware is a `Func<RequestDelegate, RequestDelegate>`, a minimal API endpoint is a delegate, LINQ operators take delegates, and configuration callbacks (`options => …`) are lambdas. Once delegates click, `Program.cs` stops looking like magic.
levels: b,i,a
prereqs: oop, generics
next: linq, middleware, async-await
---

## The 30-second version

- A **delegate** is a variable that holds a **method**. You can pass it to other code, store it, and call it later.
- You rarely declare your own delegate types. `Func<…, TResult>` returns a value, `Action<…>` returns nothing, and `Predicate<T>` returns a `bool`.
- A **lambda** (`x => x * 2`) is a method written inline, right where you need it.
- A lambda can use local variables from around it, even after that method has returned. That's a **closure**: the compiler moves the variables into a hidden heap object.
- An **event** is a delegate with a safety lock. Outsiders can only subscribe (`+=`) and unsubscribe (`-=`), and only the owner can raise it.
- ASP.NET Core is built out of delegates: middleware, endpoints and configuration callbacks are all methods passed as values.

## Words you'll meet

| Word | In plain words |
|---|---|
| **delegate** | A variable that holds a method instead of a number or text. |
| **`Func` / `Action`** | Ready-made delegate types. `Func` returns something, `Action` returns nothing. |
| **lambda** | A small method written inline: `s => s * 0.9m` means "given `s`, return `s * 0.9`". |
| **method group** | A method's name with no brackets, like `Console.WriteLine`, used as a value. |
| **capture** | When a lambda uses a local variable from the method around it. |
| **closure** | A lambda plus the variables it captured, kept alive together. |
| **multicast** | One delegate holding a list of methods, all called in order. |
| **event** | A delegate others can subscribe to (`+=`) but only its owner can trigger. |
| **expression tree** | A lambda stored as a description (data) instead of as runnable code. |

## Previously, and the problem {b}

In [Episode 3](ch:generics), generics let you write `Cache<T>` once. Now the shop owner keeps changing the discount:

```csharp norun
decimal Total(decimal subtotal)
{
    if (DateTime.Today.Month == 12) return subtotal * 0.8m;        // Christmas
    if (subtotal >= 50) return subtotal * 0.9m;                    // 10% over £50
    if (DateTime.Today.DayOfWeek == DayOfWeek.Tuesday) ...         // added last week
    return subtotal;
}
```

Every new promotion means editing `Total`, testing checkout again and redeploying. The Tuesday rule went live on a Wednesday because the deploy queue was full, and the shop owner had promised it in a newsletter. Worse, checkout is the most important code in the shop, and it's being edited every week for marketing reasons.

Checkout shouldn't need to know about promotions at all. It should just say "apply *whatever the current rule is*".

So the question is: can you pass a *rule*, a piece of behaviour, into a method the same way you pass a number?

## The lightbulb: a variable that holds a method {b}

Yes. C# lets a variable hold a **method**. You can pass that variable to `Total`, and `Total` calls it without knowing which method it is.

That kind of variable has a name: a **delegate**. Its *type* describes the shape of method it can hold. `Func<decimal, decimal>` means "a method that takes a `decimal` and returns a `decimal`". Any method with that shape fits. A method written inline, right where you pass it, is called a **lambda**: `s => s * 0.9m` reads as "given `s`, return `s * 0.9`".

:::scene visuals/scenes/del-slot.svg | A slot for behaviour
1. `Total` takes a parameter called `rule` of type `Func<decimal, decimal>`. Think of it as a **slot** with a specific shape: decimal in, decimal out. Checkout just calls `rule(subtotal)`.
2. Plug in `TenPercentOver50`. Checkout calls it, and £50 becomes £45.
3. Next week, swap in `ChristmasSpecial`. **Checkout's code didn't change.** Only the value you passed did.
4. A **lambda** writes a rule inline, right at the call: `s => s >= 30 ? s - 5 : s`.
5. A method with the wrong shape, like `string SayHello(int)`, doesn't fit the slot. The compiler rejects it, so delegates are fully type-checked.
:::

:::walk Pass the rule in, like any other value
```csharp
var subtotal = 50m;

Console.WriteLine(Total(subtotal, TenPercentOver50));            // 45.0: pass a named method
Console.WriteLine(Total(subtotal, ChristmasSpecial));            // 40.0: swap the rule
Console.WriteLine(Total(subtotal, s => s >= 30 ? s - 5 : s));    // 45: a lambda, written inline

Func<decimal, decimal> current = TenPercentOver50;               // a delegate stored in a variable
Console.WriteLine(current(80m));                                 // call it like a method: 72.0

static decimal Total(decimal subtotal, Func<decimal, decimal> rule) => rule(subtotal);

static decimal TenPercentOver50(decimal s) => s >= 50 ? s * 0.9m : s;
static decimal ChristmasSpecial(decimal s) => s * 0.8m;
```
@10 | -
`Total` takes a `rule` parameter of type `Func<decimal, decimal>`: "any method that takes a decimal and returns a decimal". All it does is call it.
@12-13 | -
Two rules, written as ordinary static methods. Both have the right shape: decimal in, decimal out.
@1 | subtotal = 50
A £50 basket.
@3 | subtotal = 50 ; rule = TenPercentOver50
Pass the **method itself** (no brackets, so it isn't called here). Inside `Total`, `rule` now refers to `TenPercentOver50`.
@12 | s = 50 | > 45.0
`rule(subtotal)` calls it. 50 qualifies, so 10% comes off.
@4 | subtotal = 50 ; rule = ChristmasSpecial | > 40.0
Same `Total`, different rule. Checkout's code didn't change, only the value passed in.
@5 | subtotal = 50 ; rule = s => s >= 30 ? s - 5 : s | > 45
A **lambda** writes the rule inline. `s =>` means "given `s`, return…". It compiles into a hidden method with the same shape.
@7 | current = TenPercentOver50
A delegate is a value, so you can store it in a variable, or a field, or a dictionary of promotions loaded at startup.
@8 | current = TenPercentOver50 | > 72.0
And call it like a method.
:::

Now the current promotion can be loaded from config or a database and handed to checkout, and checkout never changes again.

:::analogy A power drill and its bits
`Total` is the drill. It knows how to spin, but not what hole you need. The delegate is the bit you snap in. The chuck (the delegate *type*) only accepts bits of the right shape.
:::

:::qa What is a delegate?
A type-safe reference to a method: a type that describes a method signature, whose values are methods. Delegates let you pass behaviour as data, for example as callbacks, strategies, LINQ predicates, event handlers and middleware.
:::

## Func, Action and Predicate: delegates already made for you {b}

You *can* declare your own delegate type (`delegate decimal DiscountRule(decimal subtotal);`), but you almost never need to. .NET includes ready-made generic ones:

| Type | Shape | Example |
|---|---|---|
| `Func<TResult>` | no inputs → returns a value | `Func<DateTime> now = () => DateTime.UtcNow;` |
| `Func<T1, …, TResult>` | inputs → returns a value. **The last type is the return type.** | `Func<decimal, decimal> rule` |
| `Action<T1, …>` | inputs → returns nothing | `Action<string> log = Console.WriteLine;` |
| `Predicate<T>` | one input → `bool` | `Predicate<int> isEven = n => n % 2 == 0;` |

:::walk The ready-made delegate types
```csharp
Func<int, int, int> add = (a, b) => a + b;        // two ints in, int out
Action<string> log = Console.WriteLine;            // a "method group": just the method's name
Predicate<int> isEven = n => n % 2 == 0;

log($"2 + 3 = {add(2, 3)}");
log($"4 even? {isEven(4)}");

var prices = new List<int> { 5, 12, 8, 30 };
log(string.Join(", ", prices.Where(p => p > 10)));   // LINQ's Where takes a Func<int, bool>
```
@1 | add = (a, b) => a + b
`Func<int, int, int>`: two ints in, and the **last** type is what comes out.
@2 | add = (a, b) => a + b ; log = Console.WriteLine
`Action<string>`: a string in, nothing out. `Console.WriteLine` without brackets is the method itself (a "method group"), so no lambda is needed.
@3 | add = (a, b) => a + b ; log = Console.WriteLine ; isEven = n => n % 2 == 0
`Predicate<int>`: an int in, a `bool` out.
@5 | | > 2 + 3 = 5
Call `add`, then pass the text to `log`.
@6 | | > 4 even? True
@8 | prices = [5, 12, 8, 30]
A list of prices.
@9 | | > 12, 30
LINQ's `Where` takes a `Func<int, bool>`. `p => p > 10` is that delegate, and `Where` calls it once per price. You've been using delegates every time you wrote LINQ.
:::

`Console.WriteLine` on its own, without parentheses, is a **method group**: the method itself rather than a call to it. If you find yourself writing `x => int.Parse(x)`, you can just write `int.Parse`.

:::qa Func vs Action vs Predicate?
`Func<…, TResult>` returns a value, and its last type argument is the return type. `Action<…>` returns void. `Predicate<T>` takes one argument and returns `bool`. `Func<T, bool>` is used for the same job in LINQ.
:::

## Closures: a lambda packs a backpack {i}

:::plain
A lambda can keep using the local variables around it, even after the method that created them has finished. To make that work, C# moves those variables off the stack into a small hidden object that the lambda carries with it.
:::

Here's something that looks impossible. This lambda keeps using `count` **after** `MakeCounter` has returned, even though `count` was a local variable that should have vanished with the stack frame:

:::walk A local variable that outlives its method
```csharp
var next = MakeCounter();
next(); next();
Console.WriteLine(next());     // 3: count survived!

static Func<int> MakeCounter()
{
    int count = 0;              // a local variable...
    return () => ++count;       // ...used by a lambda that outlives the method
}
```
@1
Call `MakeCounter`.
@7 | count = 0 (moved into a hidden heap object)
`count` looks like an ordinary local. But the compiler saw that a lambda uses it, so it put `count` in a small hidden object on the heap instead of on the stack. That object is the "backpack".
@8 | count = 0 (in the backpack)
Return a lambda. The delegate holds a reference to the backpack.
@1 | next = → the lambda + its backpack { count = 0 }
`MakeCounter` has returned and its stack frame is gone. But `count` wasn't in the frame. It's in the backpack, and `next` is holding the backpack.
@2 | next = → the lambda + its backpack { count = 2 }
Call it twice. Each call does `++count` on the backpack's copy.
@3 | next = → the lambda + its backpack { count = 3 } | > 3
The third call returns 3. The local survived, because it was never really a local.
:::

A lambda that uses a variable from the surrounding method is said to **capture** it. The lambda plus the variables it captured is called a **closure**. To make it work, the compiler quietly moves `count` off the stack into a small **hidden class on the heap**. Think of it as a backpack the lambda carries.

:::scene visuals/scenes/del-closure.svg | Where does `count` go?
1. `MakeCounter()` runs. Normally `count = 0` would live in its stack frame and die when the method returns.
2. But a lambda uses `count`. So the compiler **moves `count` into a hidden heap object**, the backpack, and the lambda's delegate holds on to that backpack.
3. `MakeCounter` returns and its frame is popped. `Main`'s `next` points at the delegate, which still holds the backpack, so `count` is alive.
4. Each call to `next()` changes `count` inside the backpack: 1, 2, 3.
:::

:::deep Roughly what the compiler writes for you
```csharp norun
sealed class DisplayClass { public int count; public int Lambda() => ++count; }

static Func<int> MakeCounter()
{
    var backpack = new DisplayClass();   // heap allocation
    backpack.count = 0;
    return backpack.Lambda;              // a delegate to a method on that object
}
```
Three consequences follow. Capturing **allocates** (the backpack plus the delegate). Captured variables are **shared, not copied**, so every lambda that captures `count` sees the same field. And the backpack lives as long as the delegate does. A lambda that captures nothing allocates nothing: the compiler caches it.
:::

### Static lambdas: a promise not to capture

You can put `static` in front of a lambda: `static x => x * 2`. To see what that means, start with the `static` you already know. A **static method** has no `this`: it doesn't belong to any object, so it can only use its own parameters, its own locals and other static members. It can't reach into an instance's fields.

A **static lambda** gets the same restriction, applied to the code around it. It may use its parameters, its own locals, constants and static members, but it may **not** use any local variable, parameter or `this` from the method that contains it. In other words, it can't **capture**, so it never needs a backpack.

Why would you want that? Because capturing is easy to do by accident and costs you in two ways:

- **Allocations.** A capturing lambda needs a backpack object, and usually a new delegate, **every time** the surrounding code runs. In a method called a million times a second, that's a million small objects for the GC.
- **Hidden lifetimes.** If a lambda accidentally uses `this` (say, by reading a field), the backpack holds a reference to the whole object. Store that lambda in a long-lived cache or event, and the object can never be garbage collected.

Here are both kinds, measured:

:::walk What capturing costs, and what `static` guarantees
```csharp
int discount = 5;
Func<int, int> captures = p => p - discount;
Func<int, int> pure = static p => p * 2;
Console.WriteLine($"{captures(20)} {pure(20)}");
Console.WriteLine($"captures lives on: {captures.Target!.GetType().Name}");
Console.WriteLine($"pure lives on:     {pure.Target!.GetType().Name}");

long before = GC.GetAllocatedBytesForCurrentThread();
for (int i = 0; i < 1000; i++) MakeCapturing(i);
Console.WriteLine($"1,000 capturing lambdas: {GC.GetAllocatedBytesForCurrentThread() - before:N0} bytes");
before = GC.GetAllocatedBytesForCurrentThread();
for (int i = 0; i < 1000; i++) MakeStatic();
Console.WriteLine($"1,000 static lambdas:    {GC.GetAllocatedBytesForCurrentThread() - before:N0} bytes");

static Func<int, int> MakeCapturing(int d) => p => p - d;
static Func<int, int> MakeStatic() => static p => p * 2;
```
@1-2 | discount = 5 ; captures = p => p - discount (captures discount)
`captures` uses the local `discount`, so the compiler moves `discount` into a backpack object and the lambda points at it.
@3 | discount = 5 ; captures = (captures discount) ; pure = static p => p * 2 (captures nothing)
`pure` only uses its own parameter. The `static` keyword makes that a **rule**: if someone later edits it to use `discount`, the build fails with error CS8820, "A static anonymous function cannot contain a reference to 'discount'".
@4 | | > 15 40
Both work as ordinary lambdas.
@5 | | > captures lives on: <>c__DisplayClass0_0
`Target` is the object the delegate's method runs on. For `captures`, that's the compiler-generated backpack class, holding `discount`.
@6 | | > pure lives on:     <>c
For `pure`, it's `<>c`: one shared, compiler-generated object that holds every non-capturing lambda in the class. There's no per-call state.
@8-10 | | > 1,000 capturing lambdas: 81,032 bytes
`MakeCapturing(i)` captures its parameter `d`, so each call allocates a new backpack and a new delegate. That's about 80 bytes per call.
@11-13 | | > 1,000 static lambdas:    64 bytes
`MakeStatic()` captures nothing. The compiler creates the delegate **once**, caches it in a static field, and hands back the same one every time. Effectively zero allocations.
@16 | -
One honest detail: the caching comes from **not capturing**, not from the keyword. A lambda without `static` that happens to capture nothing is cached too. What `static` adds is a guarantee: the compiler will reject any future edit that would quietly start capturing, and allocating, again.
:::

Use `static` on lambdas in hot paths and in long-lived registrations (caches, events, `ConcurrentDictionary.GetOrAdd` factories). There, an accidental capture is either a steady stream of allocations or a memory leak.

### The loop trap

Because closures capture the *variable* itself, not a snapshot of its value, this classic bug happens:

:::scene visuals/scenes/del-looptrap.svg | Three lambdas, one variable
1. A `for` loop has **one** variable `i` for the whole loop. The first lambda captures that variable: the variable itself, not the number 0.
2. The second and third lambdas capture the **very same** variable. That's three arrows into one backpack.
3. The lambdas only run after the loop has finished, and by then `i` is 3. So all three print 3: `333`.
4. Fix: `var copy = i;` inside the loop body declares a **new** variable on every pass, so each lambda gets its own backpack and you get `012`. A `foreach` loop does this for you automatically.
:::

:::walk Three lambdas, one variable
```csharp
var actions = new List<Action>();
for (int i = 0; i < 3; i++)
    actions.Add(() => Console.Write(i));      // all three share ONE i
actions.ForEach(a => a());                    // 333
Console.WriteLine();

actions.Clear();
for (int i = 0; i < 3; i++)
{
    var copy = i;                             // a fresh variable each time round
    actions.Add(() => Console.Write(copy));
}
actions.ForEach(a => a());                    // 012
```
@2 | i = 0 (one variable for the whole loop)
A `for` loop has **one** `i` for the whole loop, not one per pass.
@3 | i = 0 ; actions = [λ → i]
The lambda captures **the variable `i`**, not the number 0.
@2-3 | i = 3 ; actions = [λ → i, λ → i, λ → i]
All three lambdas capture the same variable. The loop ends when `i` reaches 3.
@4-5 | i = 3 | > 333
Now run them. Each one reads `i` *now*, and it's 3 now.
@8-10 | copy = 0 (a new variable each pass)
The fix. `var copy = i;` is inside the loop body, so each pass declares a **brand-new** `copy`.
@11-12 | actions = [λ → copy₀ = 0, λ → copy₁ = 1, λ → copy₂ = 2]
Each lambda captures its own `copy`, with its own value.
@13 | | > 012
Now each prints its own number. (`foreach` makes a fresh variable each pass for you, which is why this trap is mostly a `for` problem.)
:::

:::gotcha Capturing something that gets disposed
Suppose a lambda captures a per-request object, such as a `DbContext` or an `HttpContext`. If the lambda outlives the request (in a background task, say, or a cached delegate), it ends up holding a **disposed** object. You get `ObjectDisposedException`, or a memory leak. Pass the *data* you need into background work, not the request's objects.
:::

:::qa What is a closure and what does it cost?
A lambda that captures variables from its enclosing scope. The compiler moves the captured variables into a heap-allocated class (often called a display class), so they outlive the method. The costs are an allocation for that object plus one for the delegate, and the captured variables stay alive as long as the delegate does. Lambdas that capture nothing are cached and allocation-free.
:::

:::qa Why does a for-loop capturing the loop variable print the same number?
Closures capture variables, not values. A `for` loop declares a single variable shared by every iteration, so all the lambdas see its final value. `foreach` creates a fresh variable on every iteration (since C# 5). With `for`, copy the variable into a local inside the loop body.
:::

## Multicast delegates: one call, several methods {i}

:::plain
A delegate can hold a whole list of methods instead of just one. Calling it calls every method on the list, in the order they were added.
:::

A delegate can hold a **list** of methods. `+=` adds one, `-=` removes one, and calling the delegate calls them all, in order:

:::walk One delegate, a list of methods
```csharp
Action<string> notify = msg => Console.WriteLine($"email: {msg}");
notify += msg => Console.WriteLine($"sms:   {msg}");
notify("Your tea has shipped");

Func<int> answer = () => 1;
answer += () => 2;
Console.WriteLine(answer());   // 2: only the LAST return value survives
```
@1 | notify = [email]
A delegate holding one method.
@2 | notify = [email, sms]
`+=` builds a **new** delegate whose list has both methods, and stores it back in `notify`.
@3 | | > email: Your tea has shipped | > sms:   Your tea has shipped
One call runs the whole list, in the order they were added.
@5-6 | answer = [() => 1, () => 2]
A list of methods that each **return** a value.
@7 | | > 2
Both run, but a call can only return one value, so you get the **last** one. The 1 is thrown away. That's why events return `void`.
:::

![A multicast delegate's invocation list running in add order; only the last subscriber's return value survives](visuals/multicast-invocation-list.svg)

Two sharp edges. With a return value, you only get the **last** method's result. And if one method throws, the rest **never run**.

### Delegates never change: `+=` makes a new one

There's a third property, and it matters as soon as two threads are involved. A delegate object is **immutable**: once it exists, its list of methods can never change. So what does `notify += sms` do? It builds a **brand-new** delegate whose list is "the old list plus `sms`", then points the variable at the new one. The old delegate object is untouched. Anyone who was still holding it still has the old, complete list.

:::walk `+=` doesn't change the delegate, it replaces it
```csharp
Action notify = () => Console.WriteLine("  email");
Action snapshot = notify;
notify += () => Console.WriteLine("  sms");
Console.WriteLine($"same object? {ReferenceEquals(notify, snapshot)}");
Console.WriteLine("calling the snapshot:");
snapshot();
Console.WriteLine("calling the variable:");
notify();
```
@1 | notify = → delegate #1 [email]
A delegate object holding one method.
@2 | notify = → delegate #1 [email] ; snapshot = → delegate #1 [email]
Copy the **reference** into a second variable. Both point at the same object.
@3 | notify = → delegate #2 [email, sms] ; snapshot = → delegate #1 [email]
`+=` doesn't add `sms` to delegate #1. It creates **delegate #2** with both methods, and points `notify` at it. Delegate #1 still exists, unchanged, and `snapshot` still points at it.
@4 | | > same object? False
Proof: after `+=`, the variable holds a different object.
@5-6 | | > calling the snapshot: | >   email
The snapshot still calls only `email`. Nothing that happened to `notify` could reach into the object `snapshot` holds.
@7-8 | | > calling the variable: | >   email | >   sms
The variable now calls both.
:::

Now the threading problem this solves. Raising an event the old way looked like this:

```csharp norun
if (PriceChanged != null)        // 1. check the field
    PriceChanged(this, args);    // 2. read the field AGAIN and call it
```

The field is read **twice**. Between line 1 and line 2, another thread can run `PriceChanged -= OnPrice`, and if that was the last subscriber the field becomes `null`. Line 2 then reads `null` and throws `NullReferenceException`. That's a classic race: correct on one thread, intermittently broken on two.

`PriceChanged?.Invoke(this, args)` reads the field **once**, into a hidden temporary, then null-checks and calls *the temporary*. It's the `snapshot` from the walk above. Other threads can do all the `+=` and `-=` they like: each one swaps the field to a new delegate, but your temporary keeps pointing at the object it read, and that object can never change. So the call can't see half a change or a sudden `null`.

Two consequences to know:

- A handler that unsubscribes a microsecond before you raise the event **can still be called once**, because your snapshot was taken just before it left. Handlers must cope with that, for example by checking whether their own object has been disposed.
- The `+=` and `-=` themselves are also safe across threads for **field-like events** (`public event EventHandler? X;`). The compiler generates `add` and `remove` methods that build the new delegate and swap it in with `Interlocked.CompareExchange`, retrying if another thread swapped first, so no subscription is lost.

## Events: a delegate with a safety lock {i}

:::plain
An event lets one piece of code announce "this happened" without knowing who's listening. Listeners add themselves to its list, and only the owner can make the announcement.
:::

When an order is placed, three things should happen: send an email, reduce stock, record analytics. Checkout shouldn't call all three directly, or every new feature would mean editing checkout again. It should just *announce* "an order was placed", and whoever cares can listen.

That's an **event**. Underneath it's a multicast delegate field, with a lock on it: **outsiders can only `+=` and `-=`**. Only the class that owns the event can raise it or replace the whole list. This is the Observer pattern, built into the language.

:::scene visuals/scenes/del-events.svg | Publish once, notify everyone
1. `Checkout` declares `event OrderPlaced`. Its subscriber list is empty. It doesn't know or care who will listen.
2. `EmailSender` subscribes with `OrderPlaced += …`.
3. `StockKeeper` and `Analytics` subscribe too. None of them knows about the others.
4. An order is placed. `Checkout` raises the event once, and each subscriber is called in order.
5. The safety lock: outside code **can't raise** the event and **can't wipe** the list with `=`. A plain delegate field would allow both.
:::

:::walk Announce once, let anyone listen
```csharp
var checkout = new Checkout();
checkout.OrderPlaced += (_, e) => Console.WriteLine($"email: order {e.OrderId} confirmed");
checkout.OrderPlaced += (_, e) => Console.WriteLine($"stock: reserve items for {e.OrderId}");
checkout.OrderPlaced += (_, e) => Console.WriteLine($"stats: +£{e.Total}");

checkout.Complete(orderId: 42, total: 18.50m);

// checkout.OrderPlaced = null;            // ✗ compile error outside Checkout
// checkout.OrderPlaced?.Invoke(...);      // ✗ only Checkout can raise it

class OrderPlacedEventArgs(int orderId, decimal total) : EventArgs
{
    public int OrderId { get; } = orderId;
    public decimal Total { get; } = total;
}

class Checkout
{
    public event EventHandler<OrderPlacedEventArgs>? OrderPlaced;

    public void Complete(int orderId, decimal total)
    {
        // ...save the order...
        OrderPlaced?.Invoke(this, new OrderPlacedEventArgs(orderId, total));   // raise it
    }
}
```
@19 | -
`event` declares the subscriber list. From outside `Checkout`, the only things you can do with it are `+=` and `-=`.
@1 | checkout.OrderPlaced = (no subscribers)
`Checkout` knows nothing about email, stock or analytics.
@2-4 | checkout.OrderPlaced = [email, stock, stats]
Three listeners subscribe. In a real app, each would be in a different class, and none knows about the others.
@6 | orderId = 42 ; total = 18.50
Complete an order.
@24 | orderId = 42 ; total = 18.50 | > email: order 42 confirmed | > stock: reserve items for 42 | > stats: +£18.50
Checkout **raises** the event once. `?.` means "only if anyone subscribed". Each subscriber is called in turn, with the order's details.
@8-9
The safety lock. Outside `Checkout`, `= null` (wiping everyone's subscriptions) and `Invoke` (faking an order) are both compile errors. With a plain public delegate field, both would compile.
:::

| | Plain delegate field | `event` |
|---|---|---|
| Outsiders can `+=` / `-=` | Yes | Yes |
| Outsiders can `=` (replace everything) | Yes | **No** |
| Outsiders can raise it | Yes | **No** |

### The classic leak

Subscribing has a side effect people forget. When you `+=`, the publisher stores a reference to *you*. The garbage collector only frees objects that nothing points at, so as long as the publisher is alive, every subscriber it holds is kept alive too:

:::scene visuals/scenes/del-leak.svg | How an event keeps dead pages alive
1. A long-lived `PriceFeed` (a singleton, alive as long as the app) has a `PriceChanged` event. A page subscribes: `feed.PriceChanged += OnPrice`. The feed now holds a reference to the page.
2. Every page that opens subscribes too, and none of them ever unsubscribes.
3. The user closes the pages, but the GC **can't free them**: the feed still points at every one. Memory creeps up for as long as the app runs. That's a leak.
4. The fix: unsubscribe when the subscriber's life ends, usually in `Dispose`. Then nothing points at the page, and the GC can free it.
:::

You can watch this leak happen. A `WeakReference` lets you ask "is this object still alive?" without keeping it alive yourself. `GC.Collect()` forces a garbage collection, so anything unreachable is freed on the spot:

:::walk Watch an event keep a closed page alive
```csharp
var feed = new PriceFeed();
var leaked = OpenAndClosePage(feed, unsubscribe: false);
var freed  = OpenAndClosePage(feed, unsubscribe: true);

GC.Collect();
Console.WriteLine($"page that forgot to unsubscribe still alive? {leaked.IsAlive}");
Console.WriteLine($"page that unsubscribed still alive? {freed.IsAlive}");
GC.KeepAlive(feed);

static WeakReference OpenAndClosePage(PriceFeed feed, bool unsubscribe)
{
    var page = new Page(feed);
    if (unsubscribe) page.Dispose();
    return new WeakReference(page);
}

class PriceFeed { public event Action<decimal>? PriceChanged; }

class Page : IDisposable
{
    private readonly PriceFeed _feed;
    public Page(PriceFeed feed) { _feed = feed; _feed.PriceChanged += OnPrice; }
    private void OnPrice(decimal p) { }
    public void Dispose() => _feed.PriceChanged -= OnPrice;
}
```
@1 | feed = → PriceFeed (subscribers: none)
A long-lived price feed. In a real app it would be a singleton, alive for as long as the app runs.
@2 | feed = → PriceFeed (subscribers: none)
Open the first page. Jump in.
@12 | page = → page #1
Create the page.
@22 | page = → page #1 ; feed = → PriceFeed (subscribers: page #1)
The page's constructor subscribes. `+= OnPrice` stores a delegate in the feed, and that delegate holds a reference **to the page**, so it can call `OnPrice` on it.
@13-14 | feed = → PriceFeed (subscribers: page #1) ; leaked = weak link to page #1
This page "closes" without unsubscribing. The method returns, and the local `page` variable is gone. The only things still pointing at the page are the feed's subscriber list and a weak link, which doesn't count.
@3 | feed = → PriceFeed (subscribers: page #1) ; leaked = weak link to page #1
Open a second page, but this one cleans up properly.
@13 | feed = → PriceFeed (subscribers: page #1) ; leaked = weak link to page #1
`Dispose()` is called before the page closes.
@24 | feed = → PriceFeed (subscribers: page #1) ; leaked = weak link to page #1 ; freed = weak link to page #2
`-= OnPrice` takes page #2 out of the feed's list. Now nothing points at page #2.
@5 | feed = → PriceFeed (subscribers: page #1) ; leaked = weak link to page #1 ; freed = weak link to page #2 (freed)
Force a garbage collection. The GC frees every object that nothing points at. Page #2 goes. Page #1 is still in the feed's list, so the GC **must** keep it.
@6 | | > page that forgot to unsubscribe still alive? True
The closed page that forgot to unsubscribe is still in memory. On a server this happens on every page view, and the memory graph climbs until the app is restarted.
@7 | | > page that unsubscribed still alive? False
The page that unsubscribed was freed. One line, `-=` in `Dispose`, is the whole fix.
@8
(This line keeps `feed` alive until the end, as a real singleton would be. Without it the runtime could free the feed too, and the demo would prove nothing.)
:::

C# events are **in-process and synchronous**: the publisher calls each subscriber directly and waits. The word "event" also appears later in this book for different things: **domain events** ([DDD](ch:ddd)) and **integration events** sent through a message broker ([Messaging](ch:messaging-events)). It's the same idea ("something happened"), but the machinery is different.

:::qa What is the difference between a delegate and an event?
An event wraps a delegate field so that outside code can only subscribe and unsubscribe. Only the declaring class can invoke it or replace the subscriber list. A public delegate field would let anyone invoke it or overwrite all its subscribers with `=`.
:::

:::qa How can events cause memory leaks?
The publisher's delegate holds strong references to its subscribers. A long-lived publisher (a singleton or a static event) keeps short-lived subscribers alive unless they unsubscribe. Unsubscribe in `Dispose`, or use weak events.
:::

## The payoff: ASP.NET Core is built from delegates {i}

:::plain
Almost everything you write in an ASP.NET Core `Program.cs` is a method handed to the framework to call later. A web request is passed from one of those methods to the next, like a parcel through a chain of people.
:::

Look at a typical `Program.cs` again. Every lambda in it is exactly what this chapter is about, a method handed to someone else to call later:

```csharp norun
builder.Services.AddDbContext<ShopDb>(options => options.UseSqlServer(cs));   // Action<DbContextOptionsBuilder>
builder.Services.AddScoped<IClock>(sp => new SystemClock());                   // Func<IServiceProvider, IClock>: a factory
app.Use(async (context, next) => { /* before */ await next(context); });      // middleware
app.MapGet("/orders/{id}", (int id, IOrderService s) => s.Get(id));           // an endpoint is just a delegate
```

The core type of the whole web pipeline is a delegate:

```csharp norun
public delegate Task RequestDelegate(HttpContext context);   // "a method that handles a request"
```

A **middleware** is a delegate that receives the *next* `RequestDelegate` and wraps it with its own code before and after. Stack several and you get layers, like an onion:

:::scene visuals/scenes/del-pipeline.svg | A request travelling through the middleware pipeline
1. Each `app.Use(...)` adds a delegate that **wraps the next one**. Logging wraps Auth, which wraps Errors, which wraps your endpoint.
2. The request (R) enters the outer layer. Logging notes the start time, then calls `next(ctx)`.
3. `next` is simply the following delegate. Auth checks the user, then calls *its* `next`.
4. Errors wraps the rest in a `try/catch`, then calls the endpoint, which is one more delegate.
5. The response travels back out through the same layers in reverse, so Logging can write "done in 12 ms". It's the same wrapping trick as `Retry(Logging(Email))` in [Episode 2](ch:oop#inheritance-and-when-it-goes-wrong).
:::

Here's the whole idea in a few lines you can run. A "request" is just a string here, and each middleware is a method that takes the next step and returns a new delegate that wraps it:

:::walk A tiny middleware pipeline made of delegates
```csharp
Func<string, string> endpoint = req => $"tea list for {req}";
Func<string, string> pipeline = Logging(Auth(endpoint));
Console.WriteLine(pipeline("/teas"));

static Func<string, string> Logging(Func<string, string> next) => req =>
{
    Console.WriteLine($"log: start {req}");
    var res = next(req);
    Console.WriteLine($"log: done {req}");
    return res;
};

static Func<string, string> Auth(Func<string, string> next) => req =>
{
    Console.WriteLine("auth: user ok");
    return next(req);
};
```
@1 | endpoint = the endpoint delegate
The endpoint is a delegate: a request goes in, a response comes out.
@2 | endpoint = the endpoint delegate ; pipeline = Logging → Auth → endpoint
Build the pipeline inside out. `Auth(endpoint)` returns a new delegate that remembers `endpoint` as its `next` (a closure). `Logging(...)` wraps that one. Nothing has run yet: you've only built a chain.
@3 | req = "/teas"
Send one request into the outermost delegate.
@7 | req = "/teas" | > log: start /teas
Logging does its "before" work…
@8 | req = "/teas"
…then calls `next`, which is the Auth delegate.
@15 | req = "/teas" | > auth: user ok
Auth checks the user (a real one could stop here and return 401 without calling `next`)…
@16 | req = "/teas"
…then calls *its* `next`: the endpoint.
@1 | req = "/teas" ; res = "tea list for /teas"
The endpoint makes the response, and it travels back **outwards**.
@9-10 | res = "tea list for /teas" | > log: done /teas
Back in Logging, after `next` returned, it does its "after" work. This is where a real logger measures how long the request took.
@3 | | > tea list for /teas
The response reaches the caller. ASP.NET Core's pipeline is this pattern, with `HttpContext` instead of a string.
:::

[Middleware](ch:middleware) covers the real pipeline in full.

:::qa How does ASP.NET Core use delegates?
`RequestDelegate` is the core type of the pipeline. Each middleware wraps the next `RequestDelegate`. Endpoints are delegates, configuration uses `Action<TOptions>` lambdas, and DI factories are `Func<IServiceProvider, T>`.
:::

## The same lambda, compiled two ways: expression trees {a}

:::plain
The same lambda can become either runnable code or a *description* of that code. The description can be read by another program, which is how EF Core turns your C# into SQL.
:::

One last twist. A lambda doesn't *always* become runnable code. The type you assign it to decides what it becomes:

:::scene visuals/scenes/del-two-ways.svg | One lambda, two very different results
1. You write one lambda: `total => total > 100`. What the compiler produces depends on the variable's type.
2. Assign it to a **`Func<decimal, bool>`** and you get ordinary compiled code (IL). You can run it, but no program can look inside it and see "greater than 100".
3. Assign it to an **`Expression<Func<decimal, bool>>`** and you get a **tree of objects** describing the code. At the top is a `GreaterThan` node, with the parameter on one side and the constant 100 on the other.
4. EF Core asks for the second kind. It walks the tree and writes SQL from it: `WHERE Total > @p0`.
:::

:::walk Same lambda, code vs data
```csharp
using System.Linq.Expressions;

Func<decimal, bool> asCode = total => total > 100;               // compiled to IL: you can run it
Expression<Func<decimal, bool>> asData = total => total > 100;   // a tree of objects DESCRIBING it

Console.WriteLine(asCode(150m));                  // True
Console.WriteLine(asData.Body);                   // (total > 100)
Console.WriteLine(asData.Body.NodeType);          // GreaterThan
```
@3 | asCode = compiled code (a delegate)
Assigned to a `Func`, the lambda is compiled into a hidden method, ready to run. Nothing can look inside it.
@4 | asCode = compiled code (a delegate) ; asData = tree: GreaterThan(total, 100)
**The same characters**, assigned to an `Expression<Func<...>>`. Now the compiler builds a tree of objects that *describes* the lambda instead of compiling it.
@6 | | > True
Run the code version.
@7 | | > (total > 100)
Read the data version. It can print itself, because it's a description.
@8 | | > GreaterThan
And a program can walk it node by node. EF Core does exactly this and writes `WHERE Total > 100`.
:::

`asData` isn't code. It's an **expression tree**: an object graph that says "a greater-than comparison of `total` and `100`". Something else can read that graph and translate it, and that's exactly how EF Core turns your C# `Where` into SQL. [LINQ](ch:linq#expression-trees-how-c-becomes-sql) shows the translation step by step.

:::qa What is the difference between Func<T,bool> and Expression<Func<T,bool>>?
`Func<T,bool>` is compiled code you can execute. `Expression<Func<T,bool>>` is a data structure describing the lambda, which a provider like EF Core can inspect and translate, for example into SQL. `IEnumerable.Where` takes the first and `IQueryable.Where` takes the second.
:::

## Next episode {b}

Kettle can now swap promotions without touching checkout, and it tells email, stock and analytics about every order. Business is booming, and that's the next problem. With 200,000 orders in memory, finding one order by its ID takes noticeably long, because the code checks every order in the `List` one by one. The data is fine. The container is wrong: [Episode 5 · Collections →](ch:collections)

## Further reading

- [Delegates and lambdas](https://learn.microsoft.com/en-us/dotnet/standard/delegates-lambdas)
- [Lambda expressions: capture of outer variables](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/lambda-expressions#capture-of-outer-variables-and-variable-scope-in-lambda-expressions)
- [Events (C# programming guide)](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/events/)
- [Expression trees](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/expression-trees/)

## Verify this chapter

```csharp
using System.Linq.Expressions;

// a delegate holds a method; swapping it swaps behaviour
Func<decimal, decimal> rule = s => s * 0.9m;
Check(rule(100m) == 90m, "a delegate can be called like a method");
rule = s => s - 5m;
Check(rule(100m) == 95m, "assigning a different method changes the behaviour");

// closures keep captured locals alive
var next = MakeCounter(); next(); next();
Check(next() == 3, "a captured local survives after its method returns");

// for-loop capture shares one variable
var fs = new List<Func<int>>();
for (int i = 0; i < 3; i++) fs.Add(() => i);
Check(fs.All(f => f() == 3), "for-loop lambdas share one i");
var gs = new List<Func<int>>();
foreach (var n in new[] { 0, 1, 2 }) gs.Add(() => n);
Check(gs.Select(g => g()).SequenceEqual(new[] { 0, 1, 2 }), "foreach gives each iteration a fresh variable");

// multicast: all run, last return value wins
var log = new List<string>();
Func<int> m = () => { log.Add("a"); return 1; };
m += () => { log.Add("b"); return 2; };
Check(m() == 2 && log.Count == 2, "multicast runs every method; the last return value wins");

// expression trees are data
Expression<Func<int, bool>> tree = x => x > 5;
Check(tree.Body.NodeType == ExpressionType.GreaterThan, "Expression<Func<>> is an inspectable tree");
Check(tree.Compile()(6), "an expression tree can be compiled back into a delegate");

static Func<int> MakeCounter() { int c = 0; return () => ++c; }
static void Check(bool ok, string claim) =>
    Console.WriteLine(ok ? $"OK: {claim}" : throw new Exception($"FAIL: {claim}"));
```
