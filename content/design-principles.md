---
id: design-principles
title: Design Principles: SOLID and Beyond
summary: The reasoning behind good object-oriented design. Each SOLID principle with a violation, a fix and a .NET example; coupling and cohesion; DRY, KISS, YAGNI; composition over inheritance; the Law of Demeter; tell-don't-ask; separation of concerns; and when to bend the rules.
layer: arch
where: Application architecture › Principles (class & module level)
fits: This is the first chapter of layer 4. It's built entirely from layer-1 tools ([OOP](ch:oop), interfaces, generics) and explains *why* layer-3 frameworks are designed as they are: DI exists to satisfy Dependency Inversion, and middleware satisfies Open/Closed. Every pattern in [Design patterns](ch:design-patterns) and every architecture in [App architectures](ch:app-architectures) applies these principles at a larger scale.
levels: b,i,a
prereqs: oop, dependency-injection
next: design-patterns, app-architectures
---

## TL;DR

- Every principle here exists for one reason: make change cheap by touching as few places as possible.
- **SOLID**: one reason to change per class (S); add behavior via new code, not edits (O); a subtype must honor its base type's promises (L); split fat interfaces into small, role-specific ones (I); depend on abstractions the business side owns, not on concrete infrastructure (D).
- Aim for **high cohesion** (related things live together) and **low coupling** (modules don't depend on each other's internals).
- DRY is about duplicated *knowledge*, not duplicated-looking text — don't merge two things that just happen to look alike today.
- These are heuristics, not laws: an interface with one implementation that never changes is often over-engineering, not good design.

## The problem every principle in this chapter is trying to solve {b}

Code is read and changed far more often than it's written fresh. Every principle in this chapter — SOLID and the others that follow it — exists for exactly one practical reason: to **reduce the cost of change**. When a requirement changes, the ideal is that as few places as possible need to change, and that changing them doesn't break something unrelated you weren't even thinking about. SOLID (named by Robert C. Martin, "Uncle Bob") packages five such principles specifically for classes and modules:

| Letter | Principle | One-liner |
|---|---|---|
| **S** | Single Responsibility | A module should have one reason to change |
| **O** | Open/Closed | Open for extension, closed for modification |
| **L** | Liskov Substitution | Subtypes must be usable wherever their base type is expected |
| **I** | Interface Segregation | Clients shouldn't depend on methods they don't use |
| **D** | Dependency Inversion | Depend on abstractions; high-level policy shouldn't depend on low-level detail |

## S: Single Responsibility Principle {b}

> A class should have **one reason to change**, meaning it is responsible to **one actor** (one stakeholder or source of requirements).

```csharp
// ✘ Three reasons to change: pricing rules (sales), persistence (DBA/infra), notification wording (marketing)
public class OrderService
{
    public void PlaceOrder(Order o)
    {
        o.Total = o.Lines.Sum(l => l.Price * l.Qty) * (o.Customer.IsVip ? 0.9m : 1m);  // pricing
        using var conn = new SqlConnection("…");                                       // persistence
        conn.Execute("INSERT INTO Orders …", o);
        var smtp = new SmtpClient("smtp.shop.com");                                     // notification
        smtp.Send("shop@shop.com", o.Customer.Email, "Thanks!", $"Your total is {o.Total}");
    }
}

// ✔ Each concern in its own type; OrderService orchestrates
public sealed class PlaceOrderHandler(IPricingService pricing, IOrderRepository orders, INotifier notifier)
{
    public async Task HandleAsync(Order o, CancellationToken ct)
    {
        o.ApplyTotal(pricing.Calculate(o));
        await orders.AddAsync(o, ct);
        await notifier.OrderPlacedAsync(o, ct);
    }
}
```

The reason the first version is a real problem, not just an aesthetic one: when marketing wants to change the email wording, or the DBA wants to change how orders are persisted, or sales wants a new discount rule, each of those three unrelated people ends up editing the exact same method — a near-guarantee of merge conflicts and of one team's change accidentally breaking another's logic they never touched directly.

**Symptoms of violation:** a class name with "And"/"Manager"/"Helper"/"Utils", 2,000-line services, unrelated tests in the same test class, merge conflicts on the same file from different teams, constructor injection of 10+ dependencies.

:::gotcha SRP isn't "one method per class"
It's about **cohesion around a reason to change**. Splitting a cohesive class into dozens of one-method classes creates a different problem: scattered logic and ceremony.
:::

## O: Open/Closed Principle {i}

> Software entities should be **open for extension** but **closed for modification**. Add behaviour by adding new code, not by editing working, tested code.

```csharp
// ✘ Every new carrier means editing this method (and risking existing carriers)
public decimal ShippingCost(Parcel p, string carrier) => carrier switch
{
    "dhl" => 5 + p.WeightKg * 1.2m,
    "ups" => 7 + p.WeightKg,
    _ => throw new NotSupportedException()
};

// ✔ New carrier = new class + one DI registration. ShippingCalculator never changes.
public interface IShippingRate { string Carrier { get; } decimal Calculate(Parcel p); }
public sealed class DhlRate : IShippingRate { public string Carrier => "dhl"; public decimal Calculate(Parcel p) => 5 + p.WeightKg * 1.2m; }
public sealed class UpsRate : IShippingRate { public string Carrier => "ups"; public decimal Calculate(Parcel p) => 7 + p.WeightKg; }

public sealed class ShippingCalculator(IEnumerable<IShippingRate> rates)
{
    private readonly Dictionary<string, IShippingRate> _byCarrier = rates.ToDictionary(r => r.Carrier);
    public decimal Quote(string carrier, Parcel p) => _byCarrier[carrier].Calculate(p);
}
```

The payoff is specific: adding FedEx support in the first version means editing a method that DHL and UPS *already* depend on, risking a typo that breaks pricing for carriers nobody meant to touch. In the second version, adding FedEx is purely additive — a new class, one registration line — and `ShippingCalculator` itself never changes again, no matter how many carriers get added. **Where .NET does this:** middleware (extend the pipeline without modifying it, exactly as [Middleware](ch:middleware#now-heres-the-aha-a-middleware-is-just-a-function-wrapping-a) showed), DI registrations, MVC/endpoint filters, EF Core interceptors, `DelegatingHandler`s, configuration providers, logging providers, and authorization handlers. Tools: polymorphism, strategy, decorator, plugin points.

## L: Liskov Substitution Principle {i}

> If S is a subtype of T, objects of type T may be replaced with objects of type S **without breaking the program's correctness**.

Subtypes must honour the base type's **contract**: no stronger preconditions, no weaker postconditions, no new exceptions callers don't expect, and invariants preserved.

```csharp
// The classic: Square "is a" Rectangle mathematically, but not behaviourally
public class Rectangle { public virtual int Width { get; set; } public virtual int Height { get; set; } public int Area => Width * Height; }
public class Square : Rectangle
{
    public override int Width  { set { base.Width = value; base.Height = value; } }
    public override int Height { set { base.Width = value; base.Height = value; } }
}

void Resize(Rectangle r) { r.Width = 5; r.Height = 4; Debug.Assert(r.Area == 20); }   // fails for Square: Area = 16
```

Trace through why `Resize` fails: it was written against `Rectangle`'s contract, where setting `Width` and `Height` independently should give an area equal to their product. `Square` can't honour that without breaking its own invariant — setting one side always forces the other to match — so *something* has to give, and it's always the caller's assumption. This is exactly why [OOP](ch:oop#virtual-override-and-new) stressed that "is-a" in a type hierarchy has to mean "behaves like," not just "is mathematically a special case of."

Backend-flavoured violations:

```csharp
public class ReadOnlyOrderRepository : IOrderRepository
{
    public void Add(Order o) => throw new NotSupportedException();      // ✘ callers of IOrderRepository will blow up
}
// ✔ Fix with Interface Segregation: IOrderReader and IOrderWriter

// .NET's own famous violation: arrays implement IList<T>, but Add throws NotSupportedException on T[]
// (and ReadOnlyCollection<T> implements ICollection<T>.Add by throwing).
```

**Test for LSP:** could every test written for the base type pass for the subtype?

## I: Interface Segregation Principle {i}

> Clients should not be forced to depend on methods they don't use. Prefer several small, role-specific interfaces over one large one.

```csharp
// ✘ Fat interface: the reporting job depends on write methods it never calls; the mock needs 12 methods
public interface IUserService
{
    Task<User?> GetAsync(Guid id); Task<IReadOnlyList<User>> SearchAsync(string q);
    Task CreateAsync(User u); Task UpdateAsync(User u); Task DeleteAsync(Guid id);
    Task ResetPasswordAsync(Guid id); Task SendWelcomeEmailAsync(Guid id); Task<byte[]> ExportCsvAsync();
}

// ✔ Role interfaces; one class may still implement several
public interface IUserReader { Task<User?> GetAsync(Guid id); Task<IReadOnlyList<User>> SearchAsync(string q); }
public interface IUserWriter { Task CreateAsync(User u); Task UpdateAsync(User u); Task DeleteAsync(Guid id); }
public interface IUserExporter { Task<byte[]> ExportCsvAsync(); }
```

Notice exactly what this fixes in the `ReadOnlyOrderRepository` example from the LSP section above: splitting into `IOrderReader` and `IOrderWriter` means the read-only implementation simply never implements `IOrderWriter` at all, so there's no `Add` method left to throw from in the first place — the problem disappears rather than getting patched. **In .NET:** `IEnumerable<T>` / `IReadOnlyCollection<T>` / `IList<T>`; `IOptions<T>` giving each class only its own settings section; CQRS splitting read and write interfaces; the `IDisposable`/`IAsyncDisposable` split.

## D: Dependency Inversion Principle {b}

> 1. High-level modules should not depend on low-level modules. **Both should depend on abstractions.**
> 2. Abstractions should not depend on details. Details should depend on abstractions.

The single most important question DIP asks is **who owns the interface**. The *high-level* (business) side defines what it needs, phrased in its own terms, and the *low-level* (infrastructure) side implements that definition. The result is that the source-code dependency arrow points in the **opposite** direction from the flow of control at runtime:

```text
Without DIP:   OrderService ───uses & depends on───▶ SqlOrderRepository ──▶ SQL Server
                (business)                            (infrastructure)

With DIP:      OrderService ──depends on──▶ IOrderRepository ◀──implements── SqlOrderRepository
                └──────────── Domain/Application project ───────────┘          └── Infrastructure project
               Flow of control still goes Service → SQL at runtime, but the compile-time dependency points INWARD.
```

Look closely at what actually flipped: `OrderService` still ends up calling SQL Server at runtime, exactly as before — the *behaviour* hasn't changed. What changed is that `OrderService`'s source code no longer mentions `SqlOrderRepository` at all; it only mentions `IOrderRepository`, an interface the business side itself defines. That's the whole trick, and it's why swapping SQL Server for a different store later only ever touches the infrastructure project.

```csharp
// Domain/Application layer owns the abstraction, phrased in business terms
public interface IOrderRepository { Task<Order?> GetAsync(OrderId id, CancellationToken ct); void Add(Order o); }
public interface IPaymentGateway { Task<PaymentResult> ChargeAsync(Money amount, PaymentMethod method, CancellationToken ct); }

// Infrastructure implements it (EF Core, Stripe SDK…)
public sealed class StripePaymentGateway(StripeClient stripe) : IPaymentGateway { /* … */ }

// Composition root wires them together
builder.Services.AddScoped<IPaymentGateway, StripePaymentGateway>();
```

DIP is the principle; **DI** is the mechanism that makes it practical to wire up at runtime, as [Dependency injection](ch:dependency-injection) covered in full; Clean/Onion/Hexagonal architecture is simply DIP applied at the scale of an entire solution rather than one class. See [App architectures](ch:app-architectures).

## Coupling and cohesion: the two metrics SOLID is really about {i}

Pull back from the five individual letters, and all of SOLID is really in service of two measurable properties:

- **Cohesion** (want **high**): how strongly the elements *inside* a module belong together. A `Money` type with arithmetic and formatting is cohesive; a `Utils` class with email validation, date parsing and PDF generation is not.
- **Coupling** (want **low**): how much one module depends on the *internals* of another. Low coupling means you can change one without changing the other.

| Kind of coupling (worst → best) | Example |
|---|---|
| Content | Reaching into another class's private state via reflection |
| Common / global | Shared static mutable state, a shared database table written by two services |
| Control | Passing flags that tell the callee what to do (`Save(order, sendEmail: true, skipValidation: false)`) |
| Stamp | Passing a whole object when one field is needed |
| Data | Passing just the needed values |
| Message | Communicating via events or messages only |

**Connascence** is a finer-grained vocabulary for the same idea: two components are connascent if changing one requires changing the other (of name, type, meaning, position, algorithm, timing…). Prefer weaker forms, and keep strong forms within one module — never spread across a boundary where a later change has to be coordinated across teams.

## DRY, KISS and YAGNI {b}

| Principle | Meaning | Caveat |
|---|---|---|
| **DRY**: Don't Repeat Yourself | Every piece of **knowledge** has one authoritative representation | About knowledge, not text. Two identical-looking snippets that change for different reasons are **not** duplication. Merging them creates coupling. "Prefer duplication over the wrong abstraction" (Sandi Metz) |
| **KISS**: Keep It Simple | The simplest solution that works | Simple ≠ easy. Simple means few moving parts and clear intent |
| **YAGNI**: You Aren't Gonna Need It | Don't build for hypothetical future requirements | Not an excuse to ignore known requirements or basic extensibility points |

DRY's caveat is worth dwelling on, because it's where people most often over-apply the principle: two pieces of code can look textually identical today and still represent two entirely different pieces of *knowledge* — a shipping cost formula and a tax calculation might both happen to compute `base * rate` right now, purely by coincidence, and merging them into one shared helper creates a dependency between two business rules that have nothing to do with each other and will inevitably diverge later. The **Rule of Three** is the practical discipline that keeps this in check: tolerate duplication the first two times something looks similar; only abstract on the third occurrence, once the actual shared pattern — not just a visual coincidence — is genuinely clear.

## Other principles worth naming {i}

- **Composition over inheritance**: assemble behaviour from collaborators (decorators, strategies) instead of deep class hierarchies. See [OOP](ch:oop#inheritance-and-when-it-goes-wrong).
- **Law of Demeter** (principle of least knowledge): talk to friends, not strangers. `order.Customer.Address.City.Name` couples you to four classes' structure; prefer `order.ShippingCity()`, or pass what's needed.
- **Tell, Don't Ask**: instead of asking an object for data and making decisions for it, tell it what to do. `account.Withdraw(50)`, which enforces its own rule, beats `if (account.Balance >= 50) account.Balance -= 50;`. This is the root of rich domain models ([DDD](ch:ddd)).
- **Separation of Concerns**: HTTP, business rules, persistence and presentation in different places.
- **Principle of Least Astonishment**: APIs should behave as their names suggest. `GetUser` shouldn't create a user.
- **Fail fast**: validate early (constructor guards, `ValidateOnStart`), throw clear errors close to the cause.
- **Command-Query Separation (CQS)**: a method either **changes state** (command, returns nothing) or **returns data** (query, no side effects), not both. CQRS scales this up to the architecture level.
- **Hollywood principle** ("don't call us, we'll call you"): the framework calls your code. That is Inversion of Control.
- **Package principles** (for assemblies/projects): stable dependencies (depend in the direction of stability), acyclic dependencies (no cycles between projects; the compiler enforces this for project references).

## When to bend the rules {a}

Principles are heuristics for managing change, not laws. Over-applying them is its own anti-pattern, and recognising it matters just as much as recognising the violations above:

| Over-application | Symptom |
|---|---|
| Interface for every class ("header interfaces") | `IOrderService` with exactly one implementation that never changes and is never mocked |
| Abstracting stable things | Wrapping `DateTime` is good (testability); wrapping `string.Join` is silly |
| SRP taken to the extreme | 40 classes to handle one simple feature, logic impossible to follow |
| Premature OCP | Plugin systems for variations that never happen |
| DRY across bounded contexts | One shared `Customer` class used by billing, shipping and marketing, coupling three teams |

The pragmatic test behind every row above is the same one: **does this abstraction pay for itself** in testability, a real variation point, or isolating something genuinely volatile (I/O, third parties, time)? If the answer is no, keep it concrete and refactor later — refactoring is cheap precisely when you have tests to lean on, which is the whole reason this book treats testing as load-bearing rather than optional.

:::qa Explain SOLID with an example of each.
SRP: split an OrderService that prices, persists and emails into separate collaborators. OCP: add shipping carriers as new IShippingRate implementations instead of editing a switch. LSP: a ReadOnlyRepository throwing on Add breaks callers of IRepository, so it violates LSP. ISP: split a fat IUserService into IUserReader and IUserWriter. DIP: OrderService depends on an IOrderRepository defined in the domain and implemented by an EF Core class in infrastructure.
:::

:::qa What does the Single Responsibility Principle really mean?
A module should have one reason to change, meaning it serves one actor or source of requirements. It's about cohesion around a responsibility, not about having only one method.
:::

:::qa What is a Liskov Substitution violation you've seen in .NET?
Arrays implement IList&lt;T&gt; but throw NotSupportedException on Add; ReadOnlyCollection implements ICollection.Add by throwing; Square deriving from Rectangle; a repository implementation that throws for some interface methods. Each breaks code written against the base contract.
:::

:::qa How does the Dependency Inversion Principle differ from Dependency Injection?
DIP is a design principle: high-level modules and low-level details both depend on abstractions owned by the high-level side, so compile-time dependencies point inward. DI is a technique for supplying concrete implementations to a class from outside, typically via a container. DI makes DIP practical, but you can use DI without following DIP.
:::

:::qa What are coupling and cohesion?
Cohesion is how closely related the responsibilities inside a module are (aim high). Coupling is how much modules depend on each other's details (aim low). Good design increases cohesion within modules and reduces coupling between them, so changes stay local.
:::

:::qa Is duplication always bad (DRY)?
No. DRY is about duplicated knowledge, not similar-looking code. If two pieces change for different reasons (different bounded contexts or actors), merging them couples them. Prefer duplication over the wrong abstraction; abstract once the pattern is clear (Rule of Three).
:::

:::qa What is the Law of Demeter?
A method should only talk to its immediate collaborators (itself, its parameters, objects it creates, its fields), not reach through chains like a.B.C.D(). It reduces coupling to other objects' internal structure.
:::

:::qa When would you not create an interface for a class?
When there's a single stable implementation that isn't an I/O or volatile boundary and doesn't need to be faked in tests (simple domain services, value objects, mappers). Interfaces pay off at seams: persistence, external services, time, randomness, and real variation points.
:::

## Further reading

- Robert C. Martin, *Clean Architecture* (part III, design principles) and *Agile Software Development: Principles, Patterns, and Practices*.
- Mark Seemann, *Dependency Injection Principles, Practices, and Patterns*.
- Sandi Metz, "The Wrong Abstraction" (blog post).
- [Architectural principles (Microsoft .NET architecture guide)](https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/architectural-principles)

## Verify this chapter

Run with `dotnet run` (plain console app, .NET 8/9, no packages). SOLID itself is a design heuristic, not a runtime behavior, so this doesn't "prove SOLID is true" — it demonstrates the two concrete, checkable claims the chapter makes: an LSP violation actually breaking a caller's assumption, and an OCP-shaped design actually not requiring the existing class to change when a new case is added.

```csharp
// --- LSP: Square violates the Rectangle contract that Resize relies on ---
var rect = new Rectangle();
Resize(rect);
if (rect.Area != 20) throw new Exception("FAIL: Rectangle should honor independent Width/Height");
Console.WriteLine("OK: Resize gives Rectangle the expected area (20)");

var square = new Square();
Resize(square);
if (square.Area == 20) throw new Exception("FAIL: expected the LSP violation to reproduce, but Square.Area was 20");
Console.WriteLine($"OK: Square breaks the same caller's assumption (Area = {square.Area}, not 20) — this is the LSP violation");

// --- OCP: adding a new "carrier" never requires editing ShippingCalculator's source ---
var calculator = new ShippingCalculator(new IShippingRate[] { new DhlRate(), new UpsRate(), new FedExRate() });
var fedexQuote = calculator.Quote("fedex", 2.0);
if (fedexQuote <= 0) throw new Exception("FAIL: FedEx quote should be a positive amount");
Console.WriteLine($"OK: new carrier (FedEx, quote={fedexQuote}) added with zero edits to ShippingCalculator's code");

// Not runtime-verifiable here — see Further reading: Clean Architecture (Martin), Dependency Injection (Seemann)
// (DIP/ISP, coupling & cohesion, and "when to bend the rules" are design judgments, not facts a program can assert)

static void Resize(Rectangle r) { r.Width = 5; r.Height = 4; }

class Rectangle { public virtual int Width { get; set; } public virtual int Height { get; set; } public int Area => Width * Height; }
class Square : Rectangle
{
    public override int Width  { set { base.Width = value; base.Height = value; } }
    public override int Height { set { base.Width = value; base.Height = value; } }
}

interface IShippingRate { string Carrier { get; } decimal Calculate(double weightKg); }
class DhlRate : IShippingRate { public string Carrier => "dhl"; public decimal Calculate(double w) => 5 + (decimal)w * 1.2m; }
class UpsRate : IShippingRate { public string Carrier => "ups"; public decimal Calculate(double w) => 7 + (decimal)w; }
class FedExRate : IShippingRate { public string Carrier => "fedex"; public decimal Calculate(double w) => 6 + (decimal)w * 1.1m; } // added later, nothing else touched

sealed class ShippingCalculator
{
    private readonly Dictionary<string, IShippingRate> _byCarrier;
    public ShippingCalculator(IEnumerable<IShippingRate> rates) => _byCarrier = rates.ToDictionary(r => r.Carrier);
    public decimal Quote(string carrier, double weightKg) => _byCarrier[carrier].Calculate(weightKg);
}
```
