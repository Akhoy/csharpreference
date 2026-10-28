---
id: oop
title: Object-Oriented Programming in C#
summary: Classes and their members, constructors and initialisation order, the four pillars, inheritance and polymorphism (virtual/override/new), abstract classes vs interfaces, access modifiers, static, sealed, partial, and composition over inheritance.
layer: language
where: C# language › Types › Classes, interfaces & OOP
fits: Still layer 1. Everything in layers 3 and 4 is expressed with these tools. DI ([Dependency injection](ch:dependency-injection)) works because you code against interfaces. SOLID ([Design principles](ch:design-principles)) and design patterns ([Design patterns](ch:design-patterns)) are rules and recipes built on top of this chapter.
levels: b,i,a
prereqs: type-system
next: generics, design-principles, dependency-injection
---

## TL;DR

- A class bundles **state** (fields/properties) and **behaviour** (methods); most of OOP is about controlling how much of that state the outside world can see or change.
- Construction order is **derived field inits → base field inits → base constructor body → derived constructor body** — the opposite of what intuition suggests, and the reason calling a `virtual` method from a constructor is dangerous.
- `override` is runtime (**virtual dispatch**, decided by the object's real type); `new` is compile-time (decided by the variable's *declared* type) — they look alike and behave completely differently.
- Interface vs abstract class is a design decision, not just vocabulary: interfaces for swappable "can-do" contracts, abstract classes for related types that share real code/state.
- Prefer **composition** (small, swappable collaborators) over deep inheritance chains, which get brittle fast (the fragile base class problem, the "one class per combination" explosion).

:::analogy Pico Mart
Picture a small online shop, **Pico Mart**. Its backend needs customers, accounts, payments, orders — the usual cast. Every section below is a real problem Pico Mart's code ran into, in the order it ran into them. By the end you'll have watched one small codebase grow from "a class with some fields" into something that actually resembles a real OOP design, instead of four definitions recited for an interview.
:::

## A class is two things bundled together {b}

Pico Mart's first customer record was just a bag of public fields — name, email, a list of addresses — and that already breaks within a day, because nothing stops other code from putting garbage into it. A **class** is a blueprint for objects, and every single thing you can put inside one falls into exactly two buckets: **state** (data the object carries around — its fields) and **behaviour** (what it can do — its methods). Everything else in this chapter is really about controlling how those two buckets interact with each other and with the outside world.

```csharp
namespace Shop.Domain;

public sealed class Customer                     // type declaration
{
    private readonly List<Address> _addresses = [];   // field: private state
    public const int MaxAddresses = 5;                 // compile-time constant
    private static int _created;                       // static field: shared by all instances

    public Customer(string email, string name)          // constructor
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(email);
        Email = email;
        Name = name;
        _created++;
    }

    public Guid Id { get; } = Guid.NewGuid();          // get-only auto-property (set in ctor/initialiser)
    public string Email { get; private set; }          // public read, private write
    public string Name { get; set; }                   // read/write auto-property
    public bool IsVip => TotalSpent > 10_000m;         // computed (expression-bodied) property
    public decimal TotalSpent { get; private set; }
    public IReadOnlyList<Address> Addresses => _addresses;   // expose read-only view

    public void AddAddress(Address a)                  // method: behaviour that protects invariants
    {
        if (_addresses.Count >= MaxAddresses) throw new InvalidOperationException("Too many addresses");
        _addresses.Add(a);
    }

    public event EventHandler? BecameVip;              // event
    public override string ToString() => $"{Name} <{Email}>";
}
```

| Member | Purpose |
|---|---|
| **Field** | Raw storage. Keep private. |
| **Property** | Controlled access with `get`/`set`/`init` accessors. The public face of state. |
| **Method** | Behaviour. |
| **Constructor** | Initialises a new instance; establishes invariants. |
| **Static members** | Belong to the type, not an instance. |
| **Constant / readonly** | `const` is compile-time and baked into callers; `readonly` is set once at runtime (in the constructor). |
| **Indexer** | `this[int i]` lets instances be used like arrays. |
| **Event** | Notification to subscribers. See [Delegates & events](ch:delegates-events). |
| **Operator** | Overloads like `+`, `==`, implicit/explicit conversions. |
| **Nested type** | A type declared inside another. |
| **Finalizer** | `~Customer()`: last-chance cleanup by the GC. Rarely needed. |

:::gotcha const vs static readonly look similar but behave completely differently across assemblies
A `public const` isn't really a variable at all by the time your code ships — the compiler **copies its literal value directly into every assembly that uses it**, at compile time. That has a sharp consequence: if you change a `const` inside a library and ship a new version, every *already-compiled* caller keeps using the *old* value, baked in, until they themselves are recompiled against the new library. `static readonly` doesn't have this problem — it's read fresh from the library at runtime, every time — which is exactly why it's the safer choice for anything that might ever change between versions. Reserve `const` for values that are genuinely, permanently constant: `Math.PI`, a fixed protocol value, that sort of thing.
:::

## Properties: the public face a field doesn't get {b}

```csharp
public string Name { get; set; }                       // auto-property
public string Sku { get; init; }                       // settable only during object initialisation
public required string Email { get; init; }            // caller MUST set it (C# 11)
public decimal Price { get; private set; }             // encapsulated setter

private int _qty;
public int Quantity                                    // full property with validation
{
    get => _qty;
    set => _qty = value >= 0 ? value : throw new ArgumentOutOfRangeException(nameof(value));
}

public string Slug { get; set => field = value.Trim().ToLowerInvariant(); }  // C# 14 'field' keyword
```

A bare field is just memory — anyone with access to it can set it to anything, including nonsense. A property wraps that memory behind `get`/`set` accessors that are really just methods in disguise, which means you can put real logic in them, as `Quantity` does above: reject a negative value the instant someone tries to set it, instead of discovering the bad data three layers downstream. `init` narrows that further — settable only while an object is being constructed via an object initialiser, then locked — and `required` (C# 11) goes one step beyond that, making the compiler refuse to compile any code that constructs the type without setting that property at all.

```csharp
var p = new Product { Sku = "KB-01", Email = "x@y.z", Name = "Keyboard" };
```

Worth knowing precisely: an object initialiser like this one runs its property assignments **after** the constructor has already finished, not during it — so if your constructor logic depends on a property that's only ever set this way, it'll see the property's default value, not whatever gets assigned a moment later.

## The order things actually happen in, when you call `new` {i}

Pico Mart's bug tracker once had a ticket titled "logger is null in the base constructor, but only sometimes" — which turned into exactly this question: when `OrderService` extends `Base`, which code runs first?

```csharp
public class Base
{
    protected readonly ILogger Log;
    public Base(ILogger log) { Log = log; Console.WriteLine("Base ctor"); }
}

public class OrderService : Base
{
    private readonly IOrderRepository _repo;
    private readonly int _retries = 3;                     // field initialiser

    public OrderService(IOrderRepository repo, ILogger log) : base(log)   // calls Base first
    {
        _repo = repo;
        Console.WriteLine("Derived ctor");
    }

    public OrderService(IOrderRepository repo) : this(repo, NullLogger.Instance) { }  // chain
}
```

When you call `new OrderService(...)`, it's tempting to assume everything in `OrderService` runs before anything in `Base` — it's the type you actually asked for, after all. The real order is the opposite, and it matters enough to walk through exactly:

1. **Derived field initialisers** run first (`_retries = 3`) — before any constructor body at all.
2. **Base field initialisers** run next.
3. The **base constructor's body** runs.
4. Only *after* the base is fully constructed does the **derived constructor's body** run.

![Four numbered steps lighting up in order: derived field initialisers, then base field initialisers, then the base constructor body, then finally the derived constructor body](visuals/construction-order.svg)

The reasoning behind that order is simple once you see it: a derived class's constructor body is allowed to assume the base class is already fully, safely built — calling `base`'s methods, reading `base`'s fields — and that assumption would be false if the order ran the other way. (Static constructors are a separate thing entirely: they run exactly once per type, automatically, before that type is first used, and the runtime guarantees this happens in a thread-safe way even under concurrent access.)

:::gotcha Calling a virtual method from a constructor is a trap, and now you know exactly why
The base constructor's body runs *before* the derived constructor's body — you just watched that happen in the trace above. So if the base constructor calls a `virtual` method that the derived class overrides, that override runs **during step 3**, while the object is still, by definition, only half-built: every field the derived constructor was going to set in step 4 hasn't been set yet. The override executes against an object in a state it was never designed to handle.
:::

### Primary constructors: the modern shorthand

```csharp
public class OrderService(IOrderRepository repo, ILogger<OrderService> log)
{
    public Task<Order?> GetAsync(int id) { log.LogInformation("Get {Id}", id); return repo.FindAsync(id); }
}
```

A primary constructor's parameters (`repo`, `log` above) are in scope for the *entire* class body, not just inside a constructor method — which is why `GetAsync` can reach `repo` and `log` directly, with no explicit field ever declared. The catch worth knowing: these parameters are **not** automatically `readonly` fields. They're ordinary, reassignable parameters that happen to stay in scope — so if you genuinely need the immutability guarantee a `readonly` field would give you, assign one explicitly: `private readonly IOrderRepository _repo = repo;`. In practice, primary constructors have become the standard, idiomatic style for DI-injected services specifically because most services never need to reassign their dependencies anyway.

## The four pillars, with a reason each one earns its place {b}

These four words get recited so often in interviews that they risk becoming empty vocabulary. Here's each one tied back to an actual problem Pico Mart's code ran into — and, unlike a lot of OOP explainers, each one below gets its **own small program you can actually run**, not just a paragraph pointing at someone else's code.

### Encapsulation: the object protects its own rules

The problem: a `Customer` with a public `List<Address>` lets *any* calling code add a 51st address, silently breaking the "max 5 addresses" rule that exists for a reason you presumably had. Run this and watch it happen:

```csharp
// Run with: dotnet run (plain console app, no packages)

// --- Version 1: no encapsulation. The rule exists only as a comment. ---
public class LeakyCustomer
{
    public List<string> Addresses = new();   // public field: anyone can touch it, no questions asked
}

var leaky = new LeakyCustomer();
for (int i = 1; i <= 7; i++) leaky.Addresses.Add($"Address #{i}");
Console.WriteLine($"LeakyCustomer ended up with {leaky.Addresses.Count} addresses — the \"max 5\" rule was never real code, just a wish.");

// --- Version 2: encapsulated. The field is hidden; a method is the only door in. ---
public class Customer
{
    private readonly List<string> _addresses = new();           // private: invisible outside this class
    public const int MaxAddresses = 5;
    public IReadOnlyList<string> Addresses => _addresses;        // read-only VIEW: callers can look, not modify

    public void AddAddress(string address)                       // the only way in — and it enforces the rule
    {
        if (_addresses.Count >= MaxAddresses)
            throw new InvalidOperationException($"Customers can't have more than {MaxAddresses} addresses.");
        _addresses.Add(address);
    }
}

var safe = new Customer();
try
{
    for (int i = 1; i <= 7; i++) safe.AddAddress($"Address #{i}");
}
catch (InvalidOperationException ex)
{
    Console.WriteLine($"Customer stopped at {safe.Addresses.Count} addresses: \"{ex.Message}\"");
}
// safe.Addresses.Add("sneaky");   // doesn't even compile: IReadOnlyList<T> has no Add method
```

Running it prints `7` for the leaky version and `5` (with the exception message) for the encapsulated one. Nothing about the *data* changed between the two versions — only who's allowed to touch it, and through which door. That's the entire idea: **hide the state, expose only behaviour that keeps it valid.**

### Inheritance: sharing one real "is-a" relationship

The problem: `SavingsAccount` and `CheckingAccount` genuinely share a lot of behaviour — they're both, fundamentally, accounts, with a balance and deposit/withdraw rules. Writing that twice would mean fixing every bug twice, forever. **Inheritance** lets `SavingsAccount` extend **one** base class and inherit its non-private members, modelling a genuine "is-a" relationship: a `SavingsAccount` *is an* `Account`, not merely similar to one.

```csharp
public class Account
{
    public string Owner { get; }
    public decimal Balance { get; protected set; }      // protected: derived classes can change it, outsiders can't

    public Account(string owner, decimal openingBalance)
    {
        Owner = owner;
        Balance = openingBalance;
    }

    public virtual void Withdraw(decimal amount)          // shared rule, but subclasses may specialise it
    {
        if (amount > Balance) throw new InvalidOperationException("Insufficient funds.");
        Balance -= amount;
    }
}

public class SavingsAccount : Account
{
    public decimal InterestRate { get; }
    public SavingsAccount(string owner, decimal openingBalance, decimal rate) : base(owner, openingBalance)
        => InterestRate = rate;

    public void ApplyMonthlyInterest() => Balance += Balance * InterestRate;   // behaviour only savings accounts have
}

public class CheckingAccount : Account
{
    private const decimal OverdraftLimit = 100m;
    public CheckingAccount(string owner, decimal openingBalance) : base(owner, openingBalance) { }

    public override void Withdraw(decimal amount)        // specialises the shared rule instead of duplicating it
    {
        if (amount > Balance + OverdraftLimit) throw new InvalidOperationException("Insufficient funds, even with overdraft.");
        Balance -= amount;
    }
}

var savings = new SavingsAccount("Alice", 1000m, 0.02m);
savings.ApplyMonthlyInterest();
Console.WriteLine($"Savings balance after interest: {savings.Balance}");     // 1020

var checking = new CheckingAccount("Bob", 50m);
checking.Withdraw(120m);                                                     // allowed: overdraft covers it
Console.WriteLine($"Checking balance after overdraft withdrawal: {checking.Balance}");  // -70

Console.WriteLine($"Is a SavingsAccount really an Account? {savings is Account}");       // True — a real "is-a" check
```

`ApplyMonthlyInterest` only exists on `SavingsAccount` — `CheckingAccount` has no idea it's there, and doesn't need to. What both share — `Owner`, `Balance`, the basic shape of `Withdraw` — lives exactly once, in `Account`. That's inheritance earning its keep: one real relationship, modelled once, instead of two accounts that happen to look similar by coincidence.

### Polymorphism: one call, many bodies

The problem: Pico Mart needs to notify a customer when an order ships — sometimes by email, sometimes by SMS, and next quarter probably by push notification too. Writing `if (type == "email") ... else if (type == "sms") ...` everywhere that notification happens would mean touching every one of those call sites again each time a new channel is added. **Polymorphism** ("many forms") is the fix: write the call **once**, against a shared type, and let the **runtime type** of the actual object decide which body runs.

```csharp
public interface INotifier
{
    void Notify(string customerName, string message);
}

public class EmailNotifier : INotifier
{
    public void Notify(string customerName, string message) => Console.WriteLine($"[Email to {customerName}] {message}");
}

public class SmsNotifier : INotifier
{
    public void Notify(string customerName, string message) => Console.WriteLine($"[SMS to {customerName}] {message}");
}

// This method knows nothing about Email or Sms specifically — just the interface.
void ShipOrder(string customerName, INotifier notifier)
{
    notifier.Notify(customerName, "Your order has shipped!");
}

List<INotifier> channels = [new EmailNotifier(), new SmsNotifier()];
foreach (var channel in channels)
    ShipOrder("Priya", channel);   // same call, same line of code — two different bodies run
```

`ShipOrder`'s own code — `notifier.Notify(...)` — never changes, no matter how many notifier types exist, including ones that don't exist yet. Each time through the loop, the **compile-time type** of `notifier` is the same (`INotifier`), but the **runtime type** is different (`EmailNotifier`, then `SmsNotifier`), and that runtime type is what actually decides which `Notify` body executes. The ["virtual, override and new"](#virtual-override-and-new-three-keywords-that-look-similar-an) section below shows exactly how the runtime performs that lookup.

### Abstraction: depending on *what*, not *how*

The problem: `OrderService` needs to charge a payment, but it shouldn't need to know, or care, whether that charge goes through Stripe, a bank API, or a fake used only in tests — knowing that detail would couple order logic to one specific vendor for no reason, and would make testing `OrderService` require a real payment gateway. **Abstraction** is exposing *what* something does while hiding *how* — interfaces and abstract classes are the two tools C# gives you for drawing that line deliberately.

```csharp
public interface IPaymentGateway
{
    Task<bool> ChargeAsync(decimal amount);     // the WHAT: "charge this much" — no mention of HOW
}

// Production implementation: the HOW is hidden inside here, and nowhere else.
public class StripeGateway : IPaymentGateway
{
    public Task<bool> ChargeAsync(decimal amount)
    {
        Console.WriteLine($"[Stripe] calling a real payment API to charge {amount:C}...");
        return Task.FromResult(true);
    }
}

// Test double: a completely different HOW, behind the exact same WHAT.
public class FakeGateway : IPaymentGateway
{
    public List<decimal> Charges { get; } = new();
    public Task<bool> ChargeAsync(decimal amount) { Charges.Add(amount); return Task.FromResult(true); }
}

public class OrderService(IPaymentGateway gateway)     // depends only on the interface
{
    public async Task<bool> PlaceOrderAsync(decimal total)
    {
        Console.WriteLine($"Placing order for {total:C}...");
        return await gateway.ChargeAsync(total);
    }
}

var prod = new OrderService(new StripeGateway());
await prod.PlaceOrderAsync(49.99m);

var fake = new FakeGateway();
var test = new OrderService(fake);                    // same OrderService code, zero changes
await test.PlaceOrderAsync(49.99m);
Console.WriteLine($"Fake gateway recorded {fake.Charges.Count} charge(s) — no real API was ever called.");
```

`OrderService` is written once and never edited to support either case — it depends entirely on the shape described by `IPaymentGateway`, not on which class actually implements it. That's the line abstraction draws: the **interface is the promise**, the **implementation is the secret**, and `OrderService` only ever gets to see the promise.

```csharp
public abstract class PaymentMethod
{
    public abstract Task<PaymentResult> ChargeAsync(Money amount);          // must override
    public virtual string Describe() => GetType().Name;                      // may override
    public void LogAttempt(ILogger log) => log.LogInformation("Charging via {M}", Describe()); // fixed
}

public sealed class CardPayment(string last4) : PaymentMethod
{
    public override Task<PaymentResult> ChargeAsync(Money amount) => /* call card gateway */ Task.FromResult(PaymentResult.Ok);
    public override string Describe() => $"Card ****{last4}";
}

PaymentMethod pm = new CardPayment("4242");
await pm.ChargeAsync(new Money(10, "EUR"));   // runs CardPayment.ChargeAsync: runtime type wins
```

That same `PaymentMethod` abstract class is worth one more look, because it shows three different relationships to overriding, sitting side by side: `ChargeAsync` is `abstract` — no body at all, every derived class **must** supply its own. `Describe` is `virtual` — it has a default body, and derived classes **may** override it if they want something more specific. `LogAttempt` is neither — plain, fixed behaviour that every `PaymentMethod` shares identically, with no variation point at all. Three keywords, three different amounts of flexibility deliberately granted to subclasses.

## virtual, override and new: three keywords that look similar and aren't {i}

| Keyword | On | Meaning |
|---|---|---|
| `virtual` | Base method/property | Derived classes *may* override |
| `abstract` | Method in abstract class | No body; derived classes *must* override |
| `override` | Derived member | Replaces the base implementation; **dynamic dispatch** |
| `sealed override` | Derived member | Overrides and stops further overriding |
| `new` | Derived member | **Hides** the base member; no polymorphism |
| `sealed` | Class | Can't be inherited |
| `base.Method()` | Inside override | Call the base implementation |

The last two rows of this table — `override` and `new` — are genuinely easy to confuse, because both let a derived class provide its own version of a method with the same name. They do fundamentally different things underneath, and the only way to really see the difference is to watch what each one actually looks up at the moment of a call:

```csharp
class A { public virtual string Who() => "A"; public string Plain() => "A"; }
class B : A { public override string Who() => "B"; public new string Plain() => "B"; }

A x = new B();
x.Who();    // "B": override, decided by runtime type
x.Plain();  // "A": new/hiding, decided by COMPILE-TIME type of x
((B)x).Plain(); // "B"
```

![Virtual dispatch looks up the real object's method table at runtime; hiding is decided at compile time from the variable's declared type](visuals/virtual-dispatch.svg)

Here's precisely what the diagram is showing, and it's worth internalising because it's the mechanical reason behind every "override vs new" interview answer: every object that has any `virtual` members carries, alongside its actual fields, a pointer to a **method table** — a lookup structure with one slot per virtual method, and that slot holds whichever override is correct *for this object's real, runtime type*. When you call `x.Who()`, the runtime doesn't look at what *type the variable `x` was declared as* — it follows the actual `B` object's own method table, finds the `Who` slot, sees it's been overridden to point at `B.Who()`, and jumps there. The compile-time type of `x` (`A`) never enters into it at all. That's what "dynamic dispatch" means, literally: the dispatch decision happens dynamically, at the call, based on the real object.

`Plain()` tells the opposite story, because it was never `virtual` in the first place — there's no method-table slot for it at all. `new` doesn't override anything; it just declares a *completely separate*, unrelated method on `B` that happens to share a name with one on `A`. Which one actually gets called is decided the moment the code compiles, purely from the **declared type of the variable** — `x.Plain()` compiles straight into "call `A.Plain()`", full stop, because `x` was declared as `A`, and that decision is baked into the compiled code before the program ever runs. Change the variable's declared type to `B` (as the final line does, with an explicit cast) and the exact same object now resolves to `B.Plain()` instead — nothing about the object changed, only which door you called through.

:::deep Why this indirection costs something, and why sealed can help
A virtual call genuinely does more work than a direct one: read the object's method-table pointer, read the right slot from that table, *then* jump — one extra hop compared to jumping straight to a known address. That extra hop also blocks a common optimisation: the JIT can't inline a virtual call the way it inlines a direct one, because it doesn't know, in general, which concrete method will actually run until the object shows up at runtime — unless it can **devirtualise** the call. [How code runs](ch:how-code-runs#dynamic-pgo-the-jit-actually-learns-from-your-programs-real-) covers exactly how Dynamic PGO does this by guessing from observed behaviour; `sealed`, covered later in this chapter, does it unconditionally, because a sealed class guarantees there's only ever one possible method-table slot value to begin with. That's the real, mechanical reason "mark it sealed for a small performance win" is genuine advice and not folklore.
:::

## Interfaces: a contract with no implementation of its own {b}

An **interface** is a contract: a set of members a type promises to provide, with no say in *how*. Unlike base classes, a single class can implement **as many interfaces as it needs**.

```csharp
public interface IOrderRepository
{
    Task<Order?> FindAsync(int id, CancellationToken ct = default);
    void Add(Order order);
}

public interface IUnitOfWork { Task<int> SaveChangesAsync(CancellationToken ct = default); }

public sealed class EfOrderRepository(ShopDb db) : IOrderRepository, IUnitOfWork
{
    public Task<Order?> FindAsync(int id, CancellationToken ct = default) => db.Orders.FindAsync([id], ct).AsTask();
    public void Add(Order order) => db.Orders.Add(order);
    public Task<int> SaveChangesAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);
}
```

### Three newer interface capabilities worth knowing

- **Default interface methods** (C# 8): an interface member can carry an actual body. This exists for one specific, narrow purpose — **evolving a published interface without breaking everyone who already implements it** — not as a general substitute for sharing implementation the way a base class does.
- **Static abstract members** (C# 11): interfaces can now require *static* members too, not just instance ones, which is specifically what makes **generic math** possible — `T Sum<T>(T[] xs) where T : INumber<T>` can call static operators like `+` on a type it only knows through a generic constraint.
- **Explicit implementation**: `void IDisposable.Dispose() { }` is written so it's only callable *through* the interface reference, not through the class directly. This resolves name clashes between two interfaces that happen to declare the same member name, or deliberately hides a member from a class's "normal" public surface.

## Abstract class vs interface: a decision, not just a vocabulary question {i}

| | Abstract class | Interface |
|---|---|---|
| Multiple per type | No (one base class) | Yes |
| Fields / state | Yes | No instance fields |
| Constructors | Yes | No |
| Access modifiers on members | Any | Public by default (others allowed since C# 8) |
| Implementation | Full | Default methods only (limited) |
| Relationship | "is-a" family with shared code | "can-do" capability |
| Versioning | Adding a non-abstract member is safe | Adding a member breaks implementers (unless default) |
| Value types | Can't inherit | Structs can implement |

Turn that table into a rule of thumb: reach for an **interface** to define a contract that genuinely unrelated types can fulfil — and especially at architectural seams you'll want to mock or swap later, like repositories, gateways, clocks. Reach for an **abstract class** when several closely related types share *real, written* implementation or state — a template method pattern, or a base `Entity` class that every domain entity inherits `Id` and domain-event handling from. The honest signal for which one you need: does the shared thing between these types include actual code and data, or only a promise about what methods exist?

## Access modifiers: drawing the boundary around what's yours to change {b}

| Modifier | Accessible from |
|---|---|
| `public` | Anywhere |
| `private` | The containing type only (**default for members**) |
| `protected` | Containing type and derived types |
| `internal` | Same assembly (**default for top-level types**) |
| `protected internal` | Same assembly **or** derived types |
| `private protected` | Derived types **in the same assembly** |
| `file` (C# 11) | The same source file (types only) |

`internal` specifically deserves more attention than it usually gets. It's the main tool C# gives you for keeping implementation details completely out of your library's public API surface — a type that's `internal` can be changed freely, any time, with zero risk of breaking anyone who merely *consumes* your library, because they could never have referenced it in the first place. `[InternalsVisibleTo("Tests")]` punches one deliberate, narrow hole in that wall, letting a specific test assembly reach in to verify internals directly without making them part of the real public contract.

## static, sealed, partial: three modifiers, three different jobs {b}

- **`static` class**: can't be instantiated and can't be inherited — it's just a named bag of static members, useful for stateless helpers and extension methods. Be deliberate about avoiding static **mutable** state specifically: because a static field is shared across every single request and every thread in the whole process, mutable static state becomes a hidden channel through which unrelated requests — and unrelated tests — can silently interfere with each other.
- **`sealed` class**: can't be inherited, full stop. The advice to seal by default unless you've actually designed a class for inheritance isn't just a style preference — it documents real intent (this class's internals were never written with overriding in mind, so don't rely on them), and, as the earlier "Why this indirection costs something" box showed, it gives the JIT a concrete reason to devirtualise calls into it.
- **`partial` class/method**: lets one logical type be physically split across several files. This exists specifically for tooling and source generators: a hand-written `partial class AppJsonContext` can sit in one file while a source generator emits the rest into another, and `[LoggerMessage] partial void` is exactly this pattern in miniature. C# 13 extended the same idea to **partial properties**.

## Composition over inheritance: why "is-a" chains get brittle {i}

Here's the problem inheritance creates once a hierarchy grows past a couple of levels: every derived class depends, often invisibly, on details of its base class's internals — a pattern with its own name, the **fragile base class problem**, where changing something deep in a base class can silently break derived classes nobody thought were affected. Push a hierarchy far enough and you also run into a combinatorial wall:

```csharp
// Inheritance explosion
class Notifier { }
class EmailNotifier : Notifier { }
class LoggingEmailNotifier : EmailNotifier { }
class RetryingLoggingEmailNotifier : LoggingEmailNotifier { }   // every combination needs a class
```

Want retrying-but-not-logging? Logging-but-not-retrying? Each new *combination* of behaviours demands its own class in this scheme, and the number of classes grows explosively with the number of independent behaviours you're trying to mix and match. **Composition** — assembling behaviour from small, separately swappable collaborators instead of baking every combination into the inheritance tree — sidesteps the explosion entirely:

```csharp
// Composition: wrap behaviours (Decorator pattern), assemble with DI
public interface INotifier { Task SendAsync(Message m); }
public class EmailNotifier : INotifier { /* ... */ }
public class LoggingNotifier(INotifier inner, ILogger<LoggingNotifier> log) : INotifier
{
    public async Task SendAsync(Message m) { log.LogInformation("Sending {Id}", m.Id); await inner.SendAsync(m); }
}
```

Now "retrying and logging" is just two small wrappers composed together at the point you actually need that combination, with no new class required for it specifically — and "just logging" or "just retrying" are each available too, from the same two building blocks, mixed differently. Use inheritance where you genuinely have a stable, shallow "is-a" hierarchy — a couple of levels, not many. Reach for composition plus interfaces wherever behaviour needs to vary independently. This exact idea — wrapping one implementation inside another that shares its interface — is also precisely what the [Decorator pattern](ch:design-patterns) formalises, and what the [Strategy pattern](ch:design-patterns) does for swapping an entire algorithm rather than layering behaviour around one.

## Every type's hidden base class: System.Object {i}

Every single type in C#, whether you declared it or the BCL did, ultimately derives from `System.Object`, which is where a handful of members you've probably used without a second thought actually come from:

| Member | Notes |
|---|---|
| `Equals(object)` / `GetHashCode()` | Override together (see [Type system](ch:type-system#equality-three-different-questions-similar-syntax)) |
| `ToString()` | Override for debugging and logging |
| `GetType()` | Runtime type (reflection entry point) |
| `MemberwiseClone()` | Protected shallow copy |
| `Finalize()` | Exposed as the `~ClassName()` finalizer syntax |

An object becomes eligible for garbage collection the moment nothing can reach it any more — [Memory & GC](ch:memory-gc) covers exactly how that reachability is determined. For anything that needs cleanup *before* the GC eventually gets around to it, though, the right tool is deterministic disposal via `IDisposable`, never a finalizer — see [Exceptions & disposal](ch:exceptions-disposal) for the full reasoning behind that rule.

:::qa Explain the four pillars of OOP with C# examples.
Encapsulation: private state behind methods that keep it valid (`AddAddress` enforcing a max). Inheritance: `CardPayment : PaymentMethod` reusing base behaviour. Polymorphism: calling `ChargeAsync` on a `PaymentMethod` variable runs the derived override chosen at runtime. Abstraction: callers depend on `IPaymentGateway` without knowing which provider sits behind it.
:::

:::qa Abstract class vs interface: when would you use each?
An interface defines a contract that unrelated types can implement, and a type can implement many. Use interfaces for seams you want to swap or mock. An abstract class is a single base for closely related types that share state or implementation (constructors, fields, protected helpers, template methods).
:::

:::qa What is the difference between override and new?
`override` participates in virtual dispatch: the runtime type's implementation runs no matter what the variable's static type is. `new` hides the base member: which one runs depends on the compile-time type of the reference. Hiding is almost always a mistake.
:::

:::qa What is the order of initialisation when creating a derived class?
Derived field initialisers, then base field initialisers, then the base constructor body, then the derived constructor body. Static constructors run once before first use of each type.
:::

:::qa Why shouldn't you call a virtual method from a constructor?
Because the base constructor runs before the derived constructor. A virtual call would execute the derived override before the derived class's constructor has initialised its state.
:::

:::qa const vs readonly vs static readonly?
`const` is a compile-time constant baked into calling assemblies (only primitives and strings). `readonly` instance fields are assigned once, in the declaration or constructor. `static readonly` is assigned once per type at runtime and is not copied into callers, so it's safe for values that may change between versions.
:::

:::qa What are default interface methods and when should you use them?
Interface members with a body (C# 8). They let library authors add members to published interfaces without breaking existing implementations. They are not intended to replace abstract base classes for sharing implementation.
:::

:::qa Why prefer composition over inheritance?
Inheritance couples subclasses to base-class internals and fixes behaviour at compile time, leading to fragile, deep hierarchies and class explosions. Composition assembles behaviour from small interchangeable parts (decorators, strategies) at runtime, typically via DI, and is easier to test and change.
:::

:::qa What does sealed do, and why seal classes by default?
It prevents inheritance. Sealing documents that the class wasn't designed for extension, prevents fragile-base problems, and allows the JIT to devirtualise calls and speed up type checks.
:::

:::qa What's the difference between internal and private?
private limits access to the containing type. internal limits access to the containing assembly. internal is the tool for hiding implementation types from consumers of a library or from other layers.
:::

## Further reading

- [Object-oriented programming (C#)](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/tutorials/oop)
- [Constructors (C#)](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/constructors) — the exact, Microsoft-documented six-step order used above: fields zeroed, most-derived field initialisers, base field initialisers, base constructors (Object outward), this type's constructor, then object initialisers.
- [Interfaces](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/types/interfaces)
- [Static virtual interface members](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/tutorials/static-virtual-interface-members) — the generic-math feature behind `static abstract` interface members.
- [Framework Design Guidelines](https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/) (also a book by Cwalina & Abrams)

## Verify this chapter

The `const`-baked-into-callers behaviour needs two separately compiled assemblies to show properly, so trust [Further reading](#further-reading) for that one. Everything else — construction order, the virtual-call-from-constructor trap, `override` vs `new`, explicit interface implementation, and all four pillars from Pico Mart's own code above — is directly observable in one process. Run with `dotnet run` (plain console app, .NET 8/9, no extra packages).

```csharp
// Claim: derived field inits, then base field inits, then base ctor body, then derived ctor body.
Shared.Log.Clear();
_ = new DerivedX();
var expected = new[] { "derived field", "base field", "base ctor body", "derived ctor body" };
if (!Shared.Log.SequenceEqual(expected))
    throw new Exception($"FAIL: expected {string.Join(" -> ", expected)}, got {string.Join(" -> ", Shared.Log)}");
Console.WriteLine("OK: construction order is " + string.Join(" -> ", Shared.Log));

// Claim: calling a virtual method from a base constructor runs the derived override
// while the derived class's own fields are still unset (the "trap").
var trap = new TrapDerived();
if (trap.SeenDuringBaseCtor != 0)
    throw new Exception("FAIL: expected the derived field to still read 0 (unset) during the base ctor's virtual call");
Console.WriteLine($"OK: the virtual call made during the base ctor saw SeenDuringBaseCtor == {trap.SeenDuringBaseCtor} (not yet initialised) — the trap is real");

// Claim: override dispatches on the object's runtime type; new/hiding resolves on the variable's declared type.
A x = new B();
if (x.Who() != "B") throw new Exception("FAIL: override should dispatch to B.Who() based on the real object");
if (x.Plain() != "A") throw new Exception("FAIL: new/hiding should resolve to A.Plain() based on x's declared type");
if (((B)x).Plain() != "B") throw new Exception("FAIL: casting to B should reach B's own hidden Plain()");
Console.WriteLine("OK: override (Who) dispatches by runtime type; new (Plain) resolves by declared type");

// Claim: explicit interface implementation is only reachable through the interface reference, not the class type.
IDisposable asInterface = new Disposer();
asInterface.Dispose(); // only compiles through the interface reference
Console.WriteLine("OK: Dispose() is callable through the IDisposable reference (explicit implementation hides it on Disposer itself)");

// Claim (Encapsulation): a public field lets the "max 5 addresses" rule be silently bypassed;
// a private field plus a validating method enforces it for real.
var leaky = new LeakyCustomer();
for (int i = 1; i <= 7; i++) leaky.Addresses.Add($"Address #{i}");
if (leaky.Addresses.Count != 7) throw new Exception("FAIL: expected the leaky customer to accept all 7 addresses");

var safe = new CustomerX();
int accepted = 0;
try { for (int i = 1; i <= 7; i++) { safe.AddAddress($"Address #{i}"); accepted++; } }
catch (InvalidOperationException) { /* expected once the limit is hit */ }
if (safe.Addresses.Count != 5 || accepted != 5)
    throw new Exception($"FAIL: expected the encapsulated customer to stop at 5, got {safe.Addresses.Count}");
Console.WriteLine($"OK: encapsulation — LeakyCustomer accepted {leaky.Addresses.Count} addresses, CustomerX enforced the limit at {safe.Addresses.Count}");

// Claim (Inheritance): SavingsAccount and CheckingAccount share Account's state/behaviour,
// specialise Withdraw independently, and a SavingsAccount really "is an" Account.
var savings = new SavingsAccountX("Alice", 1000m, 0.02m);
savings.ApplyMonthlyInterest();
if (savings.Balance != 1020m) throw new Exception($"FAIL: expected interest to bring balance to 1020, got {savings.Balance}");
var checking = new CheckingAccountX("Bob", 50m);
checking.Withdraw(120m);
if (checking.Balance != -70m) throw new Exception($"FAIL: expected overdraft withdrawal to leave balance at -70, got {checking.Balance}");
if (savings is not AccountX) throw new Exception("FAIL: expected SavingsAccountX to really be an AccountX");
Console.WriteLine($"OK: inheritance — savings balance after interest = {savings.Balance}, checking balance after overdraft = {checking.Balance}, is-a holds");

// Claim (Polymorphism): the same ShipOrder call runs a different Notify body depending on the object's runtime type.
var log = new List<string>();
void ShipOrder(string customerName, INotifierX notifier) => notifier.Notify(customerName, log);
List<INotifierX> channels = new() { new EmailNotifierX(), new SmsNotifierX() };
foreach (var channel in channels) ShipOrder("Priya", channel);
if (!log.SequenceEqual(new[] { "Email", "Sms" }))
    throw new Exception($"FAIL: expected [Email, Sms], got [{string.Join(", ", log)}]");
Console.WriteLine("OK: polymorphism — one ShipOrder call ran Email then Sms bodies, decided by each object's runtime type");

// Claim (Abstraction): OrderService depends only on IPaymentGatewayX; swapping the implementation
// requires zero changes to OrderService's own code.
var fakeGateway = new FakeGatewayX();
var orderService = new OrderServiceX(fakeGateway);
bool charged = await orderService.PlaceOrderAsync(49.99m);
if (!charged || fakeGateway.Charges.Count != 1 || fakeGateway.Charges[0] != 49.99m)
    throw new Exception("FAIL: expected the fake gateway to record exactly one 49.99 charge");
Console.WriteLine($"OK: abstraction — OrderServiceX charged through FakeGatewayX with zero changes to OrderServiceX itself; recorded charges = [{string.Join(", ", fakeGateway.Charges)}]");

static class Shared
{
    public static List<string> Log = new();
}
class BaseX
{
    private int _bf = Mark("base field");
    public BaseX() { Shared.Log.Add("base ctor body"); }
    static int Mark(string s) { Shared.Log.Add(s); return 0; }
}
class DerivedX : BaseX
{
    private int _df = Mark2("derived field");
    public DerivedX() : base() { Shared.Log.Add("derived ctor body"); }
    static int Mark2(string s) { Shared.Log.Add(s); return 0; }
}

class TrapBase
{
    public TrapBase() => CallVirtual();
    protected virtual void CallVirtual() { }
}
class TrapDerived : TrapBase
{
    public int SeenDuringBaseCtor = -1;
    private int _ready = 0;
    protected override void CallVirtual() => SeenDuringBaseCtor = _ready; // _ready isn't assigned yet at this point
}

class A { public virtual string Who() => "A"; public string Plain() => "A"; }
class B : A { public override string Who() => "B"; public new string Plain() => "B"; }

class Disposer : IDisposable
{
    void IDisposable.Dispose() => Console.WriteLine("  (disposed via explicit implementation)");
}

// --- Encapsulation ---
class LeakyCustomer
{
    public List<string> Addresses = new();
}
class CustomerX
{
    private readonly List<string> _addresses = new();
    public const int MaxAddresses = 5;
    public IReadOnlyList<string> Addresses => _addresses;
    public void AddAddress(string address)
    {
        if (_addresses.Count >= MaxAddresses)
            throw new InvalidOperationException($"Customers can't have more than {MaxAddresses} addresses.");
        _addresses.Add(address);
    }
}

// --- Inheritance ---
class AccountX
{
    public string Owner { get; }
    public decimal Balance { get; protected set; }
    public AccountX(string owner, decimal openingBalance) { Owner = owner; Balance = openingBalance; }
    public virtual void Withdraw(decimal amount)
    {
        if (amount > Balance) throw new InvalidOperationException("Insufficient funds.");
        Balance -= amount;
    }
}
class SavingsAccountX : AccountX
{
    public decimal InterestRate { get; }
    public SavingsAccountX(string owner, decimal openingBalance, decimal rate) : base(owner, openingBalance) => InterestRate = rate;
    public void ApplyMonthlyInterest() => Balance += Balance * InterestRate;
}
class CheckingAccountX : AccountX
{
    private const decimal OverdraftLimit = 100m;
    public CheckingAccountX(string owner, decimal openingBalance) : base(owner, openingBalance) { }
    public override void Withdraw(decimal amount)
    {
        if (amount > Balance + OverdraftLimit) throw new InvalidOperationException("Insufficient funds, even with overdraft.");
        Balance -= amount;
    }
}

// --- Polymorphism ---
interface INotifierX { void Notify(string customerName, List<string> log); }
class EmailNotifierX : INotifierX { public void Notify(string customerName, List<string> log) => log.Add("Email"); }
class SmsNotifierX : INotifierX { public void Notify(string customerName, List<string> log) => log.Add("Sms"); }

// --- Abstraction ---
interface IPaymentGatewayX { Task<bool> ChargeAsync(decimal amount); }
class FakeGatewayX : IPaymentGatewayX
{
    public List<decimal> Charges { get; } = new();
    public Task<bool> ChargeAsync(decimal amount) { Charges.Add(amount); return Task.FromResult(true); }
}
class OrderServiceX(IPaymentGatewayX gateway)
{
    public async Task<bool> PlaceOrderAsync(decimal total) => await gateway.ChargeAsync(total);
}
```
