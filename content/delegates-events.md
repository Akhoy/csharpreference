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

Every new promotion means editing `Total`, testing checkout again and redeploying. Checkout shouldn't need to know about promotions at all. It should just say "apply *whatever the current rule is*".

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

```csharp
Func<int, int, int> add = (a, b) => a + b;        // two ints in, int out
Action<string> log = Console.WriteLine;            // a "method group": just the method's name
Predicate<int> isEven = n => n % 2 == 0;

log($"2 + 3 = {add(2, 3)}");
log($"4 even? {isEven(4)}");

var prices = new List<int> { 5, 12, 8, 30 };
log(string.Join(", ", prices.Where(p => p > 10)));   // LINQ's Where takes a Func<int, bool>
```

`Console.WriteLine` on its own, without parentheses, is a **method group**: the method itself rather than a call to it. If you find yourself writing `x => int.Parse(x)`, you can just write `int.Parse`.

:::qa Func vs Action vs Predicate?
`Func<…, TResult>` returns a value, and its last type argument is the return type. `Action<…>` returns void. `Predicate<T>` takes one argument and returns `bool`. `Func<T, bool>` is used for the same job in LINQ.
:::

## Closures: a lambda packs a backpack {i}

Here's something that looks impossible. This lambda keeps using `count` **after** `MakeCounter` has returned, even though `count` was a local variable that should have vanished with the stack frame:

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
Three consequences follow. Capturing **allocates** (the backpack plus the delegate). Captured variables are **shared, not copied**, so every lambda that captures `count` sees the same field. And the backpack lives as long as the delegate does. A lambda that captures nothing allocates nothing: the compiler caches it. Mark a lambda `static` (`static x => x * 2`) to get a compile error if it captures by accident.
:::

### The loop trap

Because closures share the *variable*, not a snapshot of its value, this classic bug happens:

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

A `for` loop has **one** `i` for the whole loop, so there's one backpack, and by the time the lambdas run it says 3. A `foreach` loop gets a fresh variable on every iteration (since C# 5), so it doesn't have this problem.

:::gotcha Capturing something that gets disposed
If a lambda captures a per-request object (a `DbContext`, an `HttpContext`) and outlives the request, for example in a background task or a cached delegate, it ends up holding a **disposed** object. You get `ObjectDisposedException`, or a memory leak. Pass the *data* you need into background work, not the request's objects.
:::

:::qa What is a closure and what does it cost?
A lambda that captures variables from its enclosing scope. The compiler moves the captured variables into a heap-allocated class (often called a display class), so they outlive the method. The costs are an allocation for that object plus one for the delegate, and the captured variables stay alive as long as the delegate does. Lambdas that capture nothing are cached and allocation-free.
:::

:::qa Why does a for-loop capturing the loop variable print the same number?
Closures capture variables, not values. A `for` loop declares a single variable shared by every iteration, so all the lambdas see its final value. `foreach` creates a fresh variable on every iteration (since C# 5). With `for`, copy the variable into a local inside the loop body.
:::

## Multicast delegates: one call, several methods {i}

A delegate can hold a **list** of methods. `+=` adds one, `-=` removes one, and calling the delegate calls them all, in order:

```csharp
Action<string> notify = msg => Console.WriteLine($"email: {msg}");
notify += msg => Console.WriteLine($"sms:   {msg}");
notify("Your tea has shipped");

Func<int> answer = () => 1;
answer += () => 2;
Console.WriteLine(answer());   // 2: only the LAST return value survives
```

![A multicast delegate's invocation list running in add order; only the last subscriber's return value survives](visuals/multicast-invocation-list.svg)

Two sharp edges. With a return value, you only get the **last** method's result. And if one method throws, the rest **never run**. Delegates are also **immutable**: `+=` builds a *new* delegate and reassigns the variable, which is why `handler?.Invoke(...)` is safe even while another thread is subscribing.

## Events: a delegate with a safety lock {i}

When an order is placed, three things should happen: send an email, reduce stock, record analytics. Checkout shouldn't call all three directly, or every new feature would mean editing checkout again. It should just *announce* "an order was placed", and whoever cares can listen.

That's an **event**. Underneath it's a multicast delegate field, with a lock on it: **outsiders can only `+=` and `-=`**. Only the class that owns the event can raise it or replace the whole list. This is the Observer pattern, built into the language.

:::scene visuals/scenes/del-events.svg | Publish once, notify everyone
1. `Checkout` declares `event OrderPlaced`. Its subscriber list is empty. It doesn't know or care who will listen.
2. `EmailSender` subscribes with `OrderPlaced += …`.
3. `StockKeeper` and `Analytics` subscribe too. None of them knows about the others.
4. An order is placed. `Checkout` raises the event once, and each subscriber is called in order.
5. The safety lock: outside code **can't raise** the event and **can't wipe** the list with `=`. A plain delegate field would allow both.
:::

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

| | Plain delegate field | `event` |
|---|---|---|
| Outsiders can `+=` / `-=` | Yes | Yes |
| Outsiders can `=` (replace everything) | Yes | **No** |
| Outsiders can raise it | Yes | **No** |

:::gotcha Events are a classic memory leak
The publisher holds a reference to every subscriber, because that's what `+=` stores. If a long-lived publisher (a singleton, a `static` event) collects subscribers from short-lived objects that never `-=`, those objects can never be garbage-collected. Unsubscribe in `Dispose`.
:::

C# events are **in-process and synchronous**: the publisher calls each subscriber directly and waits. The word "event" also appears later in this book for different things: **domain events** ([DDD](ch:ddd)) and **integration events** sent through a message broker ([Messaging](ch:messaging-events)). It's the same idea ("something happened"), but the machinery is different.

:::qa What is the difference between a delegate and an event?
An event wraps a delegate field so that outside code can only subscribe and unsubscribe. Only the declaring class can invoke it or replace the subscriber list. A public delegate field would let anyone invoke it or overwrite all its subscribers with `=`.
:::

:::qa How can events cause memory leaks?
The publisher's delegate holds strong references to its subscribers. A long-lived publisher (a singleton or a static event) keeps short-lived subscribers alive unless they unsubscribe. Unsubscribe in `Dispose`, or use weak events.
:::

## The payoff: ASP.NET Core is built from delegates {i}

Look at a typical `Program.cs` again. Every lambda in it is exactly what this chapter is about, a method handed to someone else to call later:

```csharp norun
builder.Services.AddDbContext<ShopDb>(options => options.UseSqlServer(cs));   // Action<DbContextOptionsBuilder>
builder.Services.AddScoped<IClock>(sp => new SystemClock());                   // Func<IServiceProvider, IClock>: a factory
app.Use(async (context, next) => { /* before */ await next(context); });      // middleware
app.MapGet("/orders/{id}", (int id, IOrderService s) => s.Get(id));           // an endpoint is just a delegate
```

The core type of the whole web pipeline is a delegate:

```csharp norun
public delegate Task RequestDelegate(HttpContext context);
```

A **middleware** is a method that takes the *next* `RequestDelegate` and returns a new one that wraps it. The pipeline is just those wrappers stacked together, much like `Retry(Logging(Email))` in [Episode 2](ch:oop#inheritance-and-when-it-goes-wrong). [Middleware](ch:middleware) covers it in full.

:::qa How does ASP.NET Core use delegates?
`RequestDelegate` is the core type of the pipeline. Each middleware wraps the next `RequestDelegate`. Endpoints are delegates, configuration uses `Action<TOptions>` lambdas, and DI factories are `Func<IServiceProvider, T>`.
:::

## The same lambda, compiled two ways: expression trees {a}

One last twist. A lambda doesn't *always* become runnable code. Its type decides what it becomes:

```csharp
using System.Linq.Expressions;

Func<decimal, bool> asCode = total => total > 100;               // compiled to IL: you can run it
Expression<Func<decimal, bool>> asData = total => total > 100;   // a tree of objects DESCRIBING it

Console.WriteLine(asCode(150m));                  // True
Console.WriteLine(asData.Body);                   // (total > 100)
Console.WriteLine(asData.Body.NodeType);          // GreaterThan
```

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
