---
id: oop
title: "Classes: Objects That Guard Their Own Rules (OOP)"
summary: "Episode 2. An order turns up with a quantity of −3 and a status of Shipped before it was paid. The fix is the core of object-oriented C#: private state behind methods that check the rules. Then new payment types arrive, and interfaces and polymorphism let one checkout handle all of them. Covers members, properties, constructors, virtual/override/new, abstract classes vs interfaces, access modifiers, and composition over inheritance."
layer: language
where: C# language › Types › Classes, interfaces & OOP
fits: Still layer 1. Everything in layers 3 and 4 is built with these tools. Dependency injection ([Dependency injection](ch:dependency-injection)) works because you code against interfaces. SOLID ([Design principles](ch:design-principles)) and design patterns ([Design patterns](ch:design-patterns)) are rules and recipes built on this chapter.
levels: b,i,a
prereqs: type-system
next: generics, design-principles, dependency-injection
---

## The 30-second version

- A **class** bundles data (fields) with behaviour (methods). The big idea is to make the data **private** and let methods be the only way to change it. That's **encapsulation**, and it means an object can never get into an invalid state.
- **Properties** look like fields but are methods in disguise, so they can validate. `init` and `required` control how objects get built.
- **Polymorphism**: write `payment.Charge()` once, and the *runtime* type of the object decides which code runs. That's how one checkout handles cards, PayPal and gift cards.
- An **interface** is a contract ("can do X") and a class can have many. An **abstract class** is a half-built base with shared code, and a class can have only one.
- `override` replaces a method for everyone. `new` only hides it, depending on the variable's declared type, and is almost always a mistake.
- Prefer **composition** (small pieces wrapping each other) over deep inheritance trees.

## Words you'll meet

| Word | In plain words |
|---|---|
| **class** | A blueprint. It says what data an object holds and what it can do. |
| **object** (or **instance**) | One thing built from that blueprint, with `new`. |
| **field** | A variable that belongs to an object: its raw data. |
| **property** | Looks like a field from outside, but is really a pair of small methods (`get` and `set`). |
| **method** | Something the object can do. |
| **constructor** | The special method that runs when you write `new`, to set the object up. |
| **encapsulation** | Keeping data private so only the object's own methods can change it. |
| **invariant** | A rule that must always hold, like "quantity is at least 1". |
| **interface** | A list of methods a class promises to have, with no code of its own. |
| **inheritance** | One class building on another and reusing its code (`class GiftCard : PaymentMethod`). |
| **polymorphism** | One method call that runs different code depending on the object's real type. |

## Previously, and the bug {b}

In [Episode 1](ch:type-system) Kettle's baskets started copying properly. Now orders are being placed, and the database has two that should be impossible. One has a quantity of **−3**: the refund job saw a negative order and paid the "customer" £15. The other is marked *Shipped* but was never paid for, so a parcel of tea left the warehouse for free.

Here's how easy it was to create both:

:::walk The bug: anyone can write anything
```csharp
var order = new Order();
order.Quantity = -3;            // nothing stops this
order.Status = "Shipped";       // shipped... but never paid

Console.WriteLine($"{order.Quantity} × tea, status {order.Status}");

class Order
{
    public int Quantity;
    public string Status = "Placed";
}
```
@9-10 | -
The class is just two public fields. `public` means any code in the app can read **and write** them directly.
@1 | order = → Order { Quantity = 0, Status = Placed }
Create an order. The fields start at their defaults.
@2 | order = → Order { Quantity = -3, Status = Placed }
Write −3 straight into the field. There's no code between the caller and the memory, so nothing gets a chance to say no.
@3 | order = → Order { Quantity = -3, Status = Shipped }
Mark it shipped. It was never paid, and nothing asked.
@5 | | > -3 × tea, status Shipped
Two impossible facts, saved to the database as if they were fine.
:::

Every field is `public`, so any line of code anywhere in the app can write anything into it. The rules "quantity must be at least 1" and "you can't ship before payment" exist only in your head.

:::why Why not just check the values in the checkout page?
Because the checkout page isn't the only way in. Kettle already has four ways to touch an order: the website, the admin tool, the nightly CSV import and the refund job. Each was written by a different person on a different day. If the rule lives in the checkout page, the other three have to remember it too, and one of them won't. The only place *every* path has to go through is **the order itself**. So that's where the rule has to live.
:::

## The lightbulb: hide the data, expose the doors {b}

Make the fields **private**, so code outside the class can't touch them. Then add public **methods** as the only "doors" in, and have each door check the rules before it changes anything.

That idea has a name: **encapsulation**. The rules the object protects ("quantity ≥ 1", "paid before shipped") are called **invariants**. A well-encapsulated object can't be put into an invalid state, because there's no way to reach its data without going through a door that checks.

:::scene visuals/scenes/oop-guard.svg | An object that guards its own rules
1. **Before:** public fields. `order.Quantity = -3` goes straight in. Nothing checks it.
2. **After:** the fields are private, behind a wall. The same line is now a **compile error**. The only way in is through the public methods, the "doors".
3. `order.Ship()` on an unpaid order. The `Ship` door checks the rule first and **refuses** by throwing an exception. The state never changes.
4. `order.Pay()` goes through its door, which sets `Status = Paid`.
5. Now `order.Ship()` is allowed. Every change went through a door that checked the rules. That's encapsulation.
:::

:::walk The fix: private data, checked doors
```csharp
var order = new Order(quantity: 2);
try { order.Ship(); }
catch (InvalidOperationException ex) { Console.WriteLine($"Refused: {ex.Message}"); }

order.Pay();
order.Ship();
Console.WriteLine($"{order.Quantity} × tea, status {order.Status}");   // 2 × tea, status Shipped

// order.Quantity = -3;   // ← compile error: the setter is private

class Order
{
    public int Quantity { get; private set; }               // anyone can read; only Order can write
    public OrderStatus Status { get; private set; } = OrderStatus.Placed;

    public Order(int quantity)
    {
        if (quantity < 1) throw new ArgumentOutOfRangeException(nameof(quantity), "Order at least one.");
        Quantity = quantity;
    }

    public void Pay()
    {
        if (Status != OrderStatus.Placed) throw new InvalidOperationException($"Can't pay a {Status} order.");
        Status = OrderStatus.Paid;
    }

    public void Ship()
    {
        if (Status != OrderStatus.Paid) throw new InvalidOperationException("Can't ship an unpaid order.");
        Status = OrderStatus.Shipped;
    }
}

enum OrderStatus { Placed, Paid, Shipped }
```
@13-14 | -
The data is now behind **`private set`**. Anyone can *read* `Quantity` and `Status`, but only code inside `Order` can change them.
@1 | quantity = 2
Creating an order goes through the constructor. Jump in.
@18 | quantity = 2
The first door checks the first rule. 2 is fine. (`new Order(-3)` would throw right here, so a −3 order can't even exist.)
@19 | order = → Order { Quantity = 2, Status = Placed }
The order now exists, and it's valid from its first moment.
@2 | order = → Order { Quantity = 2, Status = Placed }
Try to ship it before paying.
@30 | order = → Order { Quantity = 2, Status = Placed }
The `Ship` door checks the rule: is the status `Paid`? It isn't, so it throws. Line 31 never runs, so the status never changes.
@3 | | > Refused: Can't ship an unpaid order.
The caller catches the refusal. The order is exactly as it was.
@5 | order = → Order { Quantity = 2, Status = Paid }
`Pay()` checks its own rule (only a `Placed` order can be paid) and moves the order to `Paid`.
@6 | order = → Order { Quantity = 2, Status = Shipped }
Now `Ship()` is allowed.
@7 | | > 2 × tea, status Shipped
Every change went through a door that checked the rules first.
@9
And the original bug is now impossible to write. `order.Quantity = -3` doesn't compile, because the setter is private. The admin tool, the import and the refund job all have to go through the same doors.
:::

:::analogy A bank teller
You don't walk behind the counter and change your own balance. You ask the teller (a method), and the teller checks the rules (enough funds? valid ID?) before touching the ledger (the private field).
:::

## What can go in a class {b}

| Member | What it's for |
|---|---|
| **Field** | Raw storage. Keep it `private`. |
| **Property** | The public face of the data, with `get`, `set` and `init` accessors that can check values. |
| **Method** | Behaviour: the doors. |
| **Constructor** | Builds a valid object from the start. |
| **`static` member** | Belongs to the type itself, not to any one object. |
| **`const` / `readonly`** | `const` is fixed at compile time. `readonly` is set once, in the constructor. |
| **Event** | Lets other code be notified. See [Delegates](ch:delegates-events). |
| **Indexer, operator** | `this[int i]` for `x[0]` syntax, and `+` or `==` overloads. |

:::gotcha `const` gets copied into other assemblies
A `public const` is pasted as a literal into every assembly that uses it, at compile time. Change it in your library, and callers keep the **old** value until they recompile. `static readonly` is read at runtime, so it doesn't have this problem. Use `const` only for things that never change, like `Math.PI`.
:::

:::qa const vs readonly vs static readonly?
`const` is a compile-time constant, baked into every caller's compiled code. Changing it requires recompiling the callers. `readonly` is an instance field set once, in the constructor. `static readonly` is set once per type at runtime, and callers read the current value. Prefer `static readonly` for public values that might change between versions.
:::

## Properties: fields with a guard built in {b}

A property *looks* like a field to the caller (`order.Quantity`), but it's really a pair of methods (`get` and `set`). So it can run code, like rejecting a bad value at the moment someone sets it:

:::scene visuals/scenes/oop-property.svg | A property is two methods in disguise
1. `tea.Stock = -1;` looks like writing straight into a field. The compiler actually turns it into a **method call**, `set_Stock(-1)`.
2. Reading it is a method call too: `tea.get_Stock()`.
3. Because the setter is a real method, it can **check the value** and refuse `-1` before it ever reaches the private field.
4. A plain field can't do that, because it's only a slot in memory. And callers can't tell a property from a field, so you can add rules later without changing their code.
:::

:::walk A property runs code when you set it
```csharp
var tea = new Product { Sku = "TEA-01", Name = "Sencha" };   // object initialiser
tea.Stock = 10;
try { tea.Stock = -1; } catch (ArgumentOutOfRangeException) { Console.WriteLine("negative stock refused"); }
Console.WriteLine($"{tea.Sku} {tea.Name}: {tea.Stock} in stock");
// tea.Sku = "X";   // ← compile error: init-only, so it's locked after creation

class Product
{
    public required string Sku { get; init; }    // must be set when created, then locked
    public string Name { get; set; } = "";       // plain read/write auto-property

    private int _stock;
    public int Stock                             // full property with a rule in its setter
    {
        get => _stock;
        set => _stock = value >= 0 ? value : throw new ArgumentOutOfRangeException(nameof(value));
    }
}
```
@1 | tea = → Product { Sku = TEA-01, Name = Sencha, Stock = 0 }
Create a product with an **object initialiser**: the constructor runs, then each property in the `{ }` is set. `Sku` is `required`, so leaving it out would be a compile error.
@2 | tea = → Product { Sku = TEA-01, Name = Sencha, Stock = 10 }
`tea.Stock = 10` looks like writing a field. It's really a call to the `set` accessor, with `value` = 10.
@16 | value = 10
The setter checks the value. 10 is not negative, so it's stored in the private field `_stock`.
@3 | value = -1
Now try −1. Again this calls the setter.
@16 | value = -1 | > negative stock refused
This time the check fails and it throws. `_stock` keeps its old value. A plain field could never do this, because writing to a field runs no code.
@4 | tea = → Product { Sku = TEA-01, Name = Sencha, Stock = 10 } | > TEA-01 Sencha: 10 in stock
Reading `tea.Stock` calls `get`, which returns `_stock`.
@5
`Sku` is `init`-only: it can be set while the object is created and never again. This line would be a compile error.
:::

- **`init`**: can be set only while the object is being created, then it's locked.
- **`required`** (C# 11): the compiler refuses any `new Product { … }` that doesn't set it.
- C# 14 adds a `field` keyword, so `set => field = value.Trim();` works without declaring `_stock` yourself.

:::gotcha Object initialisers run after the constructor
`new Product { Sku = "TEA-01" }` runs the constructor *first*, then sets `Sku`. If the constructor reads `Sku`, it sees the default value. Rules that need a value at construction time belong in constructor parameters.
:::

## What happens when you call `new` {i}

:::plain
When one class builds on another, C# finishes building the base part of the object before it runs the derived class's own constructor. That way the derived code can always rely on the base being ready.
:::

When a class has a base class, which code runs first? It's the opposite of what most people guess. Run this:

:::walk What really runs inside `new GiftCard()`
```csharp
new GiftCard();

class PaymentMethod
{
    private readonly string _b = Log("2. base field initialiser");
    public PaymentMethod() => Log("3. base constructor body");
    protected static string Log(string s) { Console.WriteLine(s); return s; }
}

class GiftCard : PaymentMethod
{
    private readonly string _d = Log("1. derived field initialiser");
    public GiftCard() => Log("4. derived constructor body");
}
```
@1
Make a `GiftCard`. It inherits from `PaymentMethod`, so the object has two parts to build: the base part and the gift-card part.
@13
The call goes to `GiftCard`'s constructor. But the compiler has quietly put two things in front of its body: first this class's field initialisers, then a call to the base constructor.
@12 | | > 1. derived field initialiser
So the **derived** field initialiser runs first, before any constructor body.
@6
Next, the hidden call to the base constructor, `PaymentMethod()`. It also starts with its own field initialisers.
@5 | | > 2. base field initialiser
The base field initialiser.
@6 | | > 3. base constructor body
Then the base constructor's body. The `PaymentMethod` part is now fully built.
@13 | | > 4. derived constructor body
Only now does `GiftCard`'s own body run, so it can safely use anything the base set up.
:::

:::scene visuals/scenes/oop-ctor-order.svg | The real order inside `new GiftCard()`
1. **Step 1:** `GiftCard`'s *field initialisers* run first, the `= …` parts of its field declarations. No constructor body has run yet.
2. **Step 2:** then the base class's field initialisers.
3. **Step 3:** then the base constructor's body. The `PaymentMethod` part of the object is now completely built.
4. **Step 4:** only now does `GiftCard`'s own constructor body run. It can safely use anything the base set up.
5. **The trap:** if the base constructor (step 3) calls a virtual method that `GiftCard` overrides, the override runs *before* step 4 has set `GiftCard`'s fields. It sees a half-built object. The next box shows exactly that.
:::

Why this order? The derived constructor's body is allowed to use the base class, so the base must be finished *before* that body runs. (A **static constructor** is different: it runs once per type, before the type is first used, and the runtime makes that thread-safe.)

### The trap: calling a virtual method from a constructor

Kettle's payment classes once logged "Created: …" from the base constructor, using a virtual `Describe()` so each subclass could describe itself. Every gift card was logged as "gift card (null!)". Here's why. The base constructor runs **before** the derived constructor sets its fields:

:::walk A half-built object
```csharp
new GiftCard("GC-1");

abstract class PaymentMethod
{
    protected PaymentMethod() => Console.WriteLine($"Created: {Describe()}");
    public abstract string Describe();
}

class GiftCard : PaymentMethod
{
    private readonly string _code;
    public GiftCard(string code) => _code = code;          // runs AFTER the base constructor
    public override string Describe() => $"gift card {_code ?? "(null!)"}";
}
```
@1
Create a gift card with code `GC-1`.
@12 | code = "GC-1" ; _code = null
Enter `GiftCard`'s constructor. `code` holds "GC-1", but the body (`_code = code`) hasn't run yet. The base constructor goes first.
@5 | _code = null
The base constructor calls `Describe()`. It's virtual, and the object's real type is `GiftCard`, so the **override** runs.
@13 | _code = null | > Created: gift card (null!)
`GiftCard.Describe()` reads `_code`, which nobody has set yet. It prints "(null!)". With a non-null-safe line like `_code.ToUpper()`, this would crash instead.
@12 | _code = "GC-1"
Back in `GiftCard`'s constructor, the body finally sets `_code`. Too late: the log line has already gone out.
:::

The rule: **never call a virtual method from a constructor.** Pass what the base needs as constructor parameters instead.

### Primary constructors: the modern shorthand

```csharp norun
public class OrderService(IOrderRepository repo, ILogger<OrderService> log)
{
    public Order? Get(int id) { log.LogInformation("Get {Id}", id); return repo.Find(id); }
}
```

The parameters `repo` and `log` are in scope for the whole class, so no field declarations are needed. This is now the standard style for services that get their dependencies injected. One catch: the parameters are **not** `readonly`. If you need that guarantee, assign a field: `private readonly IOrderRepository _repo = repo;`.

:::qa What is the order of initialisation when creating a derived class?
Derived field initialisers, then base field initialisers, then the base constructor body, then the derived constructor body. Static constructors run once, before the first use of each type.
:::

:::qa Why shouldn't you call a virtual method from a constructor?
The base constructor runs before the derived constructor. A virtual call from the base constructor runs the derived override before the derived class has set its fields, so it sees a half-built object.
:::

## New problem: three ways to pay {b}

Kettle now accepts cards, PayPal and gift cards. The obvious code is a growing `if`:

```csharp norun
if (method == "card") ChargeCard(total);
else if (method == "paypal") RedirectToPayPal(total);
else if (method == "giftcard") ReduceGiftCardBalance(total);
// ...and again in refunds, receipts, fraud checks... every time a new method arrives
```

Every new payment type means hunting down every `if` like this. Instead, describe *what* every payment method can do, and let each one decide *how*:

:::walk One line, three behaviours
```csharp
var total = 20m;
IPaymentMethod[] payments = [new CardPayment("4242"), new PayPalPayment("ada@example.com"), new GiftCard(50m)];

foreach (var p in payments)
    Console.WriteLine(p.Charge(total));      // ONE line, three different behaviours

interface IPaymentMethod
{
    string Charge(decimal amount);           // the WHAT, with no HOW
}

class CardPayment(string last4) : IPaymentMethod
{
    public string Charge(decimal amount) => $"Card ****{last4} charged £{amount}";
}

class PayPalPayment(string email) : IPaymentMethod
{
    public string Charge(decimal amount) => $"Redirecting {email} to PayPal for £{amount}";
}

class GiftCard(decimal balance) : IPaymentMethod
{
    public string Charge(decimal amount)
    {
        balance -= amount;
        return $"Gift card used, £{balance} left";
    }
}
```
@7-10 | -
The interface is a **contract**: anything that is an `IPaymentMethod` has a `Charge` method. It says nothing about how charging works.
@1-2 | total = 20 ; payments = [card, PayPal, gift card]
Three different objects, held in one array whose element type is just the contract.
@4 | p = → CardPayment ("4242")
First time round the loop, `p` points at a card.
@5 | p = → CardPayment ("4242")
`p.Charge(total)`. The compiler doesn't know which `Charge` this is. At runtime the call looks at the **object**: it's a `CardPayment`.
@14 | p = → CardPayment ("4242") | > Card ****4242 charged £20
So the card's `Charge` runs.
@4 | p = → PayPalPayment ("ada@example.com")
Second time round, `p` points at a PayPal payment.
@19 | p = → PayPalPayment ("ada@example.com") | > Redirecting ada@example.com to PayPal for £20
**The same line 5** now runs PayPal's code, because the object is different.
@4 | p = → GiftCard (balance 50)
Third time, a gift card.
@26 | p = → GiftCard (balance 30)
The gift card's own `Charge` takes 20 off its balance.
@27 | | > Gift card used, £30 left
Three behaviours from one line. When Kettle adds Apple Pay, it writes one new class, and the loop doesn't change.
:::

## The lightbulb: one call, many bodies {b}

`p.Charge(total)` is one line of code, yet it ran three different methods. The variable's type is just `IPaymentMethod`, so the *compiler* doesn't know which method will run. The decision is made **at runtime**, by looking at the actual object.

That has a name: **polymorphism** ("many shapes"). The mechanism behind it is **virtual dispatch**. Every object knows its real type, and every type has a hidden lookup table, its **method table**, which says "for `Charge`, run *this* code". The call follows the object to its table.

:::scene visuals/scenes/oop-dispatch.svg | How `p.Charge()` picks the right code
1. The checkout loop calls `p.Charge(total)`. The variable is typed `IPaymentMethod`, so the compiler only knows "p can Charge", not how.
2. First time round, `p` points at a `CardPayment` object. The runtime follows the object to **its type's method table** and runs the card code.
3. Second time, `p` points at a `PayPalPayment`. Same line of code, but a different object means a different table and different code.
4. Third time: `GiftCard`, its own table, its own `Charge`.
5. Next month you add `ApplePay`. You write one new class. **The checkout code doesn't change at all.** That's the payoff.
:::

This is also why interfaces matter so much later. `OrderService` can depend on `IPaymentMethod` and never know whether it's talking to a real card processor or a fake used in a test. That's exactly how [dependency injection](ch:dependency-injection) and [unit testing](ch:unit-testing) work.

:::note Real code is async
In production, `Charge` would be `Task<PaymentResult> ChargeAsync(Money amount, CancellationToken ct)`, because it calls a remote API. The examples here stay synchronous so they run in your browser. [Episode 8](ch:async-await) explains `async`.
:::

## The four pillars, in one table {b}

Interviewers love "the four pillars of OOP". You've now seen all of them in Kettle:

| Pillar | One-line meaning | In Kettle |
|---|---|---|
| **Encapsulation** | Hide the data, and expose methods that keep it valid | `Order` with private setters, `Pay()` and `Ship()` |
| **Abstraction** | Depend on *what* something does, not *how* | Checkout uses `IPaymentMethod`, not `CardPayment` |
| **Polymorphism** | One call, and the runtime type picks the body | `p.Charge(total)` runs card, PayPal or gift card code |
| **Inheritance** | Reuse a base class's code in an "is-a" relationship | `GiftCard : PaymentMethod` (next section) |

:::qa Explain the four pillars of OOP with C# examples.
Encapsulation: private state behind methods that keep it valid, like `Order.Ship()` refusing an unpaid order. Abstraction: callers depend on an interface like `IPaymentMethod` without knowing the implementation. Polymorphism: calling `Charge` through that interface runs the implementation chosen by the object's runtime type. Inheritance: `GiftCard : PaymentMethod` reuses shared base code.
:::

## Interfaces vs abstract classes {b}

Both describe "a kind of thing" that other classes fill in. They solve different problems:

- An **interface** is a pure **contract**: "anything that can `Charge`". It has no fields and (almost) no code. A class can implement **many** interfaces. Think of a power socket. Anything with the right plug fits.
- An **abstract class** is a **half-built base class** with real shared code and fields, where some methods are left for subclasses to fill in. A class can inherit **only one**.

:::scene visuals/scenes/oop-iface-abstract.svg | A contract, or a half-built base?
1. An **interface** is only a contract: method names and shapes, with no code and no data. It says *what*, never *how*.
2. Unrelated classes can each sign the same contract, and one class can sign **many**: `class GiftCard : IPaymentMethod, IRefundable`.
3. An **abstract class** is a half-built base. It has real shared code, fields and a constructor, plus some blanks (`abstract` methods) left for subclasses.
4. Subclasses inherit the shared code and fill in the blanks. But a class can extend **only one** base class.
5. In short: an interface means "can do", and an abstract class means "is a kind of, and shares code". If you're unsure, start with an interface.
:::

:::walk Shared code in the base, blanks filled by the subclass
```csharp
PaymentMethod pm = new CardPayment("4242");
pm.LogAttempt();                          // shared code, written once in the base
Console.WriteLine(pm.Charge(10m));        // the subclass's own version

abstract class PaymentMethod
{
    public abstract string Charge(decimal amount);          // abstract: MUST be overridden
    public virtual string Describe() => GetType().Name;     // virtual: MAY be overridden
    public void LogAttempt() => Console.WriteLine($"Charging via {Describe()}");   // fixed for all
}

sealed class CardPayment(string last4) : PaymentMethod
{
    public override string Charge(decimal amount) => $"Card ****{last4}: £{amount}";
    public override string Describe() => $"card ****{last4}";
}
```
@5-10 | -
The abstract base. `Charge` is `abstract` (a blank every subclass must fill). `Describe` is `virtual` (has a default, may be replaced). `LogAttempt` is ordinary code, written once for every payment type.
@1 | pm = → CardPayment ("4242")
The variable's type is the base class. The object is a card.
@2
Call `LogAttempt()`. Only the base has it, so the base's code runs.
@9
Inside, it calls `Describe()`. That's virtual, so the runtime asks the object what it really is.
@15 | | > Charging via card ****4242
`CardPayment` overrides `Describe`, so its version runs, even though the call came from base-class code. Shared code in the base, specific details from the subclass.
@3
Now `Charge`.
@14 | | > Card ****4242: £10
It's abstract in the base, so the only body there is the card's.
:::

| | Interface | Abstract class |
|---|---|---|
| How many per class | Many | One |
| Fields and constructors | No | Yes |
| Shared code | Only default methods (limited) | Yes, as much as you like |
| Relationship | "can do" | "is a kind of" |
| Structs can use it | Yes | No |

**Rule of thumb:** use an interface for seams you'll want to swap or fake (repositories, payment gateways, clocks). Use an abstract class when closely related types share **real code and data**.

Three newer interface features you'll see:

- **Default interface methods** (C# 8): an interface member can have a body. They exist so you can add a member to a published interface without breaking everyone who already implements it.
- **Static abstract members** (C# 11): an interface can require static members such as operators. That's what makes generic math possible (see [Generics](ch:generics)).
- **Explicit implementation**: `void IDisposable.Dispose()` can only be called through the interface. It's useful when two interfaces clash on a member name.

:::qa Abstract class vs interface: when would you use each?
An interface defines a contract that unrelated types can implement, and a type can implement many of them. Use one for seams you want to swap or mock. An abstract class is a single base for closely related types that share state or implementation, such as constructors, fields, protected helpers or template methods.
:::

:::qa What are default interface methods and when should you use them?
An interface member with a body (C# 8). Their intended use is evolving a published interface: you can add a member without breaking existing implementers. They aren't a general replacement for base classes, because interfaces still can't hold instance state.
:::

## virtual, override and new {i}

:::plain
`override` lets the *object* decide which version of a method runs, at runtime. `new` lets the *variable's declared type* decide, when the code is compiled. Only the first one gives you polymorphism.
:::

| Keyword | Means |
|---|---|
| `virtual` | Subclasses **may** replace this |
| `abstract` | No body, so subclasses **must** replace it |
| `override` | Replace it, for every caller (uses virtual dispatch) |
| `sealed` | On a class, nobody can inherit. On an override, nobody can override further |
| `new` | **Hide** the base member, without overriding it. The variable's declared type decides which runs |

`override` and `new` look alike but behave very differently:

:::walk override vs new: who decides?
```csharp
A x = new B();
Console.WriteLine(x.Who());         // "B": override, so the OBJECT's real type decides
Console.WriteLine(x.Plain());       // "A": new (hiding), so the VARIABLE's declared type decides
Console.WriteLine(((B)x).Plain());  // "B": same object, different declared type

class A { public virtual string Who() => "A"; public string Plain() => "A"; }
class B : A { public override string Who() => "B"; public new string Plain() => "B"; }
```
@6-7 | -
`A` has two methods. `Who` is `virtual` and `B` **overrides** it. `Plain` is not virtual, and `B` **hides** it with `new`.
@1 | x = → B object (declared type A)
One `B` object, held in a variable declared as `A`.
@2 | | > B
`Who` is virtual, so at runtime the call asks the object for its real type. It's a `B`, so `B.Who` runs.
@3 | | > A
`Plain` is not virtual, so the **compiler** chose which method to call when it compiled this line. It only knew the variable's type, `A`, so it picked `A.Plain`. The object is never asked.
@4 | | > B
Cast the same object to `B` and the compiler picks `B.Plain`. The object didn't change, only the variable type did. That's why `new` is confusing, and why it's almost always a mistake.
:::

:::scene visuals/scenes/oop-override-new.svg | Same object, three calls, different answers
1. One object whose real type is `B`, held in a variable whose declared type is `A`. Which method runs depends on *how* each method was declared.
2. `x.Who()`: `Who` is `virtual` and `B` overrides it. At runtime the call follows the arrow to the object, asks "what are you really?", and runs `B.Who`. The variable's type doesn't matter.
3. `x.Plain()`: `Plain` isn't virtual, and `B` only *hides* it with `new`. The **compiler** picked `A.Plain` when it compiled this line, from the variable's type. The object is never asked.
4. `((B)x).Plain()`: change only the variable's type (with a cast) and you get `B.Plain`. Nothing about the object changed. That's why hiding is confusing, and why it's almost always a mistake.
5. The rule: with **`override`**, the object decides at runtime and polymorphism works. With **`new`**, the declared type decides at compile time and polymorphism quietly doesn't.
:::

:::deep Why sealed makes calls faster
A virtual call means: read the object's method-table pointer, read the slot, then jump. It's one extra hop, and the JIT can't inline it because it doesn't know which method will run. If the class is `sealed`, there's only one possible implementation, so the JIT can call it directly and inline it. That's why "seal classes by default" is real performance advice. Dynamic PGO can also guess the common type at runtime ([How code runs](ch:how-code-runs#dynamic-pgo-the-jit-actually-learns-from-your-programs-real-)).
:::

:::qa What is the difference between override and new?
`override` takes part in virtual dispatch: the runtime type's implementation runs, whatever the variable's declared type. `new` hides the base member: which one runs depends on the compile-time type of the reference. Hiding is almost always a mistake.
:::

## Inheritance, and when it goes wrong {i}

:::plain
Inheritance is good for "an X *is* a kind of Y". It's bad for mixing optional features together, because every combination needs its own class. For that, build objects out of small pieces that wrap each other.
:::

Inheritance is great for **one shallow, real "is-a" relationship**. A `GiftCard` *is a* `PaymentMethod`. But use it to mix and match *features*, and the class count explodes:

:::scene visuals/scenes/oop-composition.svg | Why deep inheritance trees break down
1. Kettle sends notifications. A base `Notifier` with `EmailNotifier` and `SmsNotifier`. That's 2 classes, and it's fine.
2. The owner wants every message logged. With inheritance you need `LoggingEmailNotifier` and `LoggingSmsNotifier`. Now there are 4.
3. Then "retry on failure", with or without logging. That's 8 classes, and the next feature doubles it again to 16. Changing the base class can also break any of them. This is the **fragile base class** problem.
4. **Composition** instead: 4 small pieces. `Logging` and `Retry` each *wrap* any other notifier, whatever it is.
5. Snap them together at startup: `Retry(Logging(Email))`, `Logging(Sms)`, any combination you like. It's still 4 classes.
:::

Here are the pieces in code. The email sender fails the first time, the way a busy mail server does, so you can watch `Retry` earn its keep:

:::walk Wrappers inside wrappers
```csharp
INotifier email = new Retry(new Logging(new EmailNotifier()));
email.Send("Your tea has shipped!");

interface INotifier { void Send(string message); }

class EmailNotifier : INotifier          // fails the first time, like a busy mail server
{
    private int _calls;
    public void Send(string message)
    {
        if (++_calls == 1) throw new TimeoutException("mail server busy");
        Console.WriteLine($"  email: {message}");
    }
}

class Logging(INotifier inner) : INotifier          // wraps ANY notifier
{
    public void Send(string message) { Console.WriteLine(" [log] sending"); inner.Send(message); }
}

class Retry(INotifier inner) : INotifier            // wraps ANY notifier
{
    public void Send(string message)
    {
        for (var attempt = 1; ; attempt++)
        {
            try { Console.WriteLine($"[retry] attempt {attempt}"); inner.Send(message); return; }
            catch when (attempt < 3) { }
        }
    }
}
```
@1 | email = → Retry → Logging → EmailNotifier
Build from the inside out: an email sender, wrapped in logging, wrapped in retry. Each wrapper holds the next one in its `inner` parameter. To the caller it's all just an `INotifier`.
@2
Send one message. The caller doesn't know about the wrappers.
@25-27 | attempt = 1 | > [retry] attempt 1
The outermost layer, `Retry`, starts attempt 1 and passes the message inward.
@18 | attempt = 1 | >  [log] sending
`Logging` writes a log line and passes it inward again.
@11 | attempt = 1
The real email sender. The server is busy, so it throws `TimeoutException`.
@28 | attempt = 1
The exception climbs back out through `Logging` to `Retry`. `catch when (attempt < 3)` catches it, because 1 < 3. (The `when` filter means attempt 3's failure would *not* be caught, so it would reach the caller.)
@25-27 | attempt = 2 | > [retry] attempt 2
Round again: attempt 2.
@18 | attempt = 2 | >  [log] sending
Logging again.
@12 | attempt = 2 | >   email: Your tea has shipped!
This time the email goes. Then `return` ends the retry loop.
:::

This wrapping trick is the **Decorator pattern** ([Design patterns](ch:design-patterns)), and it's how ASP.NET Core assembles logging, retries and caching around your services.

:::qa Why prefer composition over inheritance?
Inheritance couples subclasses to the base class's internals (the fragile base class problem). It also needs a new class for every combination of features. Composition builds behaviour from small objects behind interfaces, so you can mix and swap them and test them alone. Keep inheritance for shallow, stable "is-a" relationships.
:::

## Access modifiers {b}

Who is allowed to see a member? Think of it as rings, from the tightest to the widest:

:::scene visuals/scenes/oop-access.svg | Four rings of visibility
1. **`private`**: only code inside this one class. This is the default for members, and the right starting point.
2. **`protected`**: the class *plus* its subclasses. One quirk: a subclass in a *different* project still gets in, so this ring pokes outside `internal`. The rarer `private protected` is the version that stays inside.
3. **`internal`**: any code in the same **assembly**, which is the same project (for example everything in `Kettle.Core.dll`). This is the default for types.
4. **`public`**: everyone, including other projects and anyone who uses your library.
5. Start in the smallest ring and widen only when you need to. Making something more visible later is easy. Making it less visible breaks whoever started using it.
:::

The full list, including two rarer combinations:

| Modifier | Visible to |
|---|---|
| `public` | Everyone |
| `private` | Only this type (**the default for members**) |
| `protected` | This type and its subclasses |
| `internal` | Code in the same assembly (**the default for top-level types**) |
| `protected internal` | The same assembly, **or** subclasses |
| `private protected` | Subclasses **in the same assembly** |
| `file` (C# 11) | Only this source file |

`internal` is underrated. An `internal` type isn't part of your library's public API, so you can change it freely without breaking anyone. `[InternalsVisibleTo("Kettle.Tests")]` lets your test project see it.

:::qa What's the difference between internal and private?
`private` means visible only inside the containing type. `internal` means visible to any code in the same assembly. Top-level types default to `internal`, and members default to `private`.
:::

## static, sealed and partial {b}

Start with the one that has bitten Kettle. A developer made the basket counter `static` "so it's quick to read". On their laptop, with one shopper, it worked. On the server, every shopper's page shares the same process:

:::walk A static field is shared by everyone
```csharp
var ada = new BasketCounter();
var ben = new BasketCounter();
ada.AddTea(); ada.AddTea();
ben.AddTea();
Console.WriteLine($"Ada's header says {ada.Count} teas");
Console.WriteLine($"Ben's header says {ben.Count} teas");

class BasketCounter
{
    private static int _teas;        // static: ONE value for the whole app
    public void AddTea() => _teas++;
    public int Count => _teas;
}
```
@10 | -
The mistake is one word. `static` means the field belongs to the **type**, not to any one object. There's exactly one `_teas` in the whole app, however many counters you create.
@1-2 | ada = → counter #1 ; ben = → counter #2 ; BasketCounter._teas = 0
Two separate counter objects, one for Ada's page and one for Ben's. But neither object holds a `_teas`. It lives with the type.
@3 | ada = → counter #1 ; ben = → counter #2 ; BasketCounter._teas = 2
Ada adds two teas. Both increments go to the one shared field.
@4 | ada = → counter #1 ; ben = → counter #2 ; BasketCounter._teas = 3
Ben adds one. Same field.
@5-6 | | > Ada's header says 3 teas | > Ben's header says 3 teas
Both see 3. On a web server with a thousand shoppers, every header shows the total for **everyone**. Remove `static` and each counter gets its own field.
:::

- **`static` class**: can't be created with `new` and can't be inherited. It's a bag of helpers and extension methods. Avoid **mutable** static fields. They're shared by every request and every thread, so they become a hidden channel between unrelated code (and unrelated tests).
- **`sealed` class**: can't be inherited. Seal by default unless you designed the class for inheritance. It documents intent and lets the JIT skip virtual dispatch.
- **`partial` class**: one class split across several files. It mostly exists so **source generators** can add code to your class in a separate file ([Advanced C#](ch:advanced-csharp)).

:::qa What does sealed do, and why seal classes by default?
`sealed` prevents inheritance. Sealing by default says the class wasn't designed for extension, which stops others depending on internals you may change. It also lets the JIT devirtualise and inline calls.
:::

## The base of everything: System.Object {i}

:::plain
Every class you write quietly inherits from one class at the root, `object`. That's where `ToString`, `Equals` and `GetType` come from.
:::

Every type ultimately inherits from `object`, which is where these come from:

| Member | Notes |
|---|---|
| `Equals` / `GetHashCode` | Override them together ([Episode 1](ch:type-system#equality-the-same-means-three-things)) |
| `ToString()` | Override it for readable logs and debugging |
| `GetType()` | The object's real runtime type, and the entry point to reflection |
| `MemberwiseClone()` | A protected, shallow copy |

Overriding `ToString` is the one you'll do most. It's what you see in logs, in the debugger and in string interpolation:

:::walk Every class gets ToString from object
```csharp
Console.WriteLine(new Plain(42));
Console.WriteLine(new Order(42, 2));

class Plain(int id) { }
class Order(int id, int quantity)
{
    public override string ToString() => $"Order #{id} ({quantity} × tea)";
}
```
@4 | -
`Plain` declares nothing, but it still has `ToString`, `Equals`, `GetHashCode` and `GetType`. It inherits them from `object`, even though it never says `: object`.
@1 | | > Plain
`Console.WriteLine` calls `ToString()`. The version from `object` only knows the type's name, so that's all you get. A log full of "Plain" is useless at 3 a.m.
@7
`Order` overrides `ToString`. It's `virtual` in `object`, so this replaces it for every caller.
@2 | | > Order #42 (2 × tea)
Now logs and the debugger show something a human can use.
:::

Objects are freed by the GC once nothing references them ([Memory & GC](ch:memory-gc)). Anything that must be closed *promptly*, like files and connections, uses `IDisposable` ([Episode 7](ch:exceptions-disposal)).

## Next episode {b}

Kettle's objects now guard their rules, and checkout handles any payment type. To keep pages fast you add caching: an `OrderCache`, then a `CustomerCache`, then a `ProductCache`. Look at the three files side by side and they're the **same 40 lines** with a different type name. Copy-paste means three places to fix every bug. There must be a way to write it once: [Episode 3 · Generics →](ch:generics)

## Further reading

- [Object-oriented programming (C#)](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/tutorials/oop)
- [Interfaces](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/types/interfaces) and [abstract and sealed classes](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/abstract-and-sealed-classes-and-class-members)
- [Framework design guidelines: designing for extensibility](https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/designing-for-extensibility)
- Book: *Head First Design Patterns* (Freeman & Robson), the friendliest route to composition and decorators.

## Verify this chapter

```csharp
// encapsulation: the object refuses invalid changes
var o = new Order();
Check(Throws(() => o.Ship()), "an unpaid order can't ship");
o.Pay(); o.Ship();
Check(o.Status == "Shipped", "after paying, shipping works");

// polymorphism: runtime type picks the body
IPay[] ps = [new Card(), new Gift()];
Check(ps[0].Pay() == "card" && ps[1].Pay() == "gift", "one call site, two bodies");

// override vs new
A x = new B();
Check(x.Who() == "B", "override: the runtime type decides");
Check(x.Plain() == "A", "new: the declared type decides");

// construction order
Trace.Steps.Clear(); new Derived();
Check(string.Join(",", Trace.Steps) == "derived-field,base-field,base-ctor,derived-ctor", "construction order");

static bool Throws(Action a) { try { a(); return false; } catch (InvalidOperationException) { return true; } }
static void Check(bool ok, string claim) =>
    Console.WriteLine(ok ? $"OK: {claim}" : throw new Exception($"FAIL: {claim}"));

class Order
{
    public string Status { get; private set; } = "Placed";
    public void Pay() => Status = Status == "Placed" ? "Paid" : throw new InvalidOperationException();
    public void Ship() => Status = Status == "Paid" ? "Shipped" : throw new InvalidOperationException();
}
interface IPay { string Pay(); }
class Card : IPay { public string Pay() => "card"; }
class Gift : IPay { public string Pay() => "gift"; }
class A { public virtual string Who() => "A"; public string Plain() => "A"; }
class B : A { public override string Who() => "B"; public new string Plain() => "B"; }
static class Trace { public static List<string> Steps = []; public static int Add(string s) { Steps.Add(s); return 0; } }
class Base { private int _b = Trace.Add("base-field"); public Base() => Trace.Add("base-ctor"); }
class Derived : Base { private int _d = Trace.Add("derived-field"); public Derived() => Trace.Add("derived-ctor"); }
```
