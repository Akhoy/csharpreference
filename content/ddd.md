---
id: ddd
title: Domain-Driven Design
summary: Modelling complex business domains. Strategic DDD (domains, subdomains, bounded contexts, ubiquitous language, context maps) and tactical DDD (entities, value objects, aggregates and their rules, domain events, domain services, repositories, factories), rich vs anemic models, implementing aggregates with EF Core, and when DDD is overkill.
layer: arch
where: Application architecture › Domain modelling
fits: DDD fills the **centre** of the [Clean/Hexagonal architecture](ch:app-architectures). Value objects are records or readonly structs ([Modern C#](ch:modern-csharp#records)), aggregates are persisted with EF Core ([EF Core fundamentals](ch:efcore-fundamentals)), and domain events feed the outbox ([EF Core advanced](ch:efcore-advanced#domain-events-and-the-outbox-on-savechanges)). Strategically, bounded contexts are the natural boundaries for modules and microservices ([Microservices](ch:microservices)).
levels: i,a
prereqs: oop, design-principles, app-architectures
next: microservices, messaging-events
---

## TL;DR

- DDD puts a **domain model** — the business's own concepts and rules — at the centre of the code, built together with domain experts, in their language.
- **Strategic DDD** splits a big system into **bounded contexts**, each with its own consistent model and vocabulary (the same word can mean different things in different contexts on purpose).
- **Tactical DDD** gives you the building blocks inside one context: **entities** (identity matters), **value objects** (only the values matter), and **aggregates** (a cluster with one root that's the only door in, protecting the rules that must always be true).
- One transaction touches one aggregate; aggregates talk to each other later, through **domain events**, not by reaching into each other directly.
- A **rich** model (behaviour and data together, like `order.Cancel(...)`) stops rules being bypassed; an **anemic** model (plain data + a separate service with the rules) doesn't.
- Skip the tactical patterns for simple CRUD — they're worth their cost only in a domain that's genuinely complex and core to the business.

## The problem DDD exists to solve {i}

**Domain-Driven Design** (Eric Evans, 2003) starts from a specific, honest observation about hard software: in genuinely complex business domains — insurance, logistics, banking, healthcare, e-commerce at scale — the hardest problem usually isn't a technical one at all. It's **understanding and correctly encoding the business itself**. When the rules governing that business get scattered across controllers, services and raw SQL, they inevitably get duplicated, start quietly contradicting each other, and eventually become something nobody can change with confidence anymore.

DDD's answer is to put the **domain model** — a precise model of the business's concepts and rules — at the heart of the software, and to build that model **collaboratively with domain experts**, in their own language rather than a technical one. It has two distinct halves, operating at two different scales:

| Strategic DDD (the big picture) | Tactical DDD (the building blocks) |
|---|---|
| How to **split** a large system into parts with clear boundaries and relationships | How to **model** inside one part: entities, value objects, aggregates, events |
| Bounded contexts, ubiquitous language, subdomains, context maps | Patterns implemented in C# |
| Shapes teams, modules and microservice boundaries | Shapes classes and persistence |

:::why Why DDD exists
In complex domains — insurance, logistics, banking, healthcare, e-commerce at scale — the hardest problem isn't technology. It's **understanding and encoding the business correctly**. When rules are scattered across controllers, services and SQL, they get duplicated, start to contradict each other, and eventually become impossible to change safely. DDD's answer is to concentrate the rules in one explicit model that mirrors how the business actually talks and thinks.
:::

## Strategic DDD: ubiquitous language and bounded contexts {i}

### Ubiquitous language

A shared, precise vocabulary used by developers and domain experts **in conversation, documentation and code**. If the business says "a policy is *bound*", the code has `policy.Bind()`, not `policy.SetStatus(3)`. When the language changes, the code changes — the vocabulary isn't documentation sitting next to the code, it *is* the code.

### Bounded contexts: the same word, deliberately meaning different things

A **bounded context** is an explicit boundary within which a model and its language are consistent. Here's the idea that trips people up on first encounter: **the same word means different things in different contexts, and that's not a bug to fix — it's the correct state of affairs**:

```text
"Product" in…
  Catalog context:    name, description, images, categories, SEO slug
  Pricing context:    list price, discounts, price lists, currency rules
  Inventory context:  SKU, warehouse locations, stock on hand, reorder level
  Shipping context:   weight, dimensions, hazardous-goods flag
  Ordering context:   a line item snapshot: sku, name and price AT ORDER TIME
```

Trying to build **one** `Product` class that covers all five contexts ends badly: it turns into a giant model everyone fights over, because a change Pricing needs can break something Shipping depends on — even though the two have nothing to do with each other. The fix: let each context keep its own small model, and connect them with explicit contracts (IDs, APIs, events) instead of one shared class.

### Subdomains: where to actually invest

| Type | Meaning | Strategy |
|---|---|---|
| **Core** | What gives the business its competitive edge (pricing engine, recommendation logic) | Invest most here; rich DDD model; best people |
| **Supporting** | Necessary and specific, but not differentiating (internal back-office workflows) | Simpler models, maybe CRUD |
| **Generic** | Solved problems (identity, payments, email, accounting) | **Buy or use SaaS** (Entra ID, Stripe, SendGrid) |

The practical upshot of this table, easy to forget under deadline pressure: the full weight of DDD's tactical patterns — covered in the rest of this chapter — belongs in the **core** row. Spending that same effort modelling a generic subdomain like "send an email" is effort the business gets zero competitive value from.

### Context maps

How bounded contexts relate: **Shared Kernel** (a small shared model), **Customer/Supplier** (upstream serves downstream's needs), **Conformist** (downstream adopts upstream's model as-is), **Anti-Corruption Layer** (downstream **translates** upstream's model into its own, protecting it from legacy or third-party models; implemented with adapters), **Open Host Service / Published Language** (a well-documented public API or event schema), **Separate Ways**.

**Event Storming** (Alberto Brandolini) is the popular workshop technique for discovering domain events, commands, aggregates and context boundaries with sticky notes on a wall.

## Entities: identity that outlives any particular state {i}

An **entity** has an **identity that persists over time** and through changes. Two entities are the same if their IDs are equal, even if every other field differs — this is the single defining trait that separates an entity from the value objects covered next.

```csharp
public abstract class Entity<TId> where TId : notnull
{
    public TId Id { get; protected init; } = default!;
    public override bool Equals(object? obj) => obj is Entity<TId> other && GetType() == other.GetType() && Id.Equals(other.Id);
    public override int GetHashCode() => Id.GetHashCode();
}

public readonly record struct CustomerId(Guid Value) { public static CustomerId New() => new(Guid.CreateVersion7()); }   // strongly typed ID
```

## Value objects: defined entirely by what they contain {i}

A **value object** is the mirror image of an entity: it's defined **entirely by its values**, has **no identity** of its own, and is **immutable**. Two value objects holding the same values are completely interchangeable — there's no sense in which one is "the same instance" as another, because that question doesn't apply. Examples: `Money`, `Address`, `EmailAddress`, `DateRange`, `Quantity`, `Percentage`, `GeoCoordinate`.

```csharp
public sealed record Money
{
    public decimal Amount { get; }
    public string Currency { get; }

    public Money(decimal amount, string currency)
    {
        if (amount < 0) throw new DomainException("money.negative", "Amount can't be negative");
        if (currency is not { Length: 3 }) throw new DomainException("money.currency", "Use ISO 4217 codes");
        Amount = decimal.Round(amount, 2, MidpointRounding.ToEven);
        Currency = currency.ToUpperInvariant();
    }

    public static Money Zero(string currency) => new(0, currency);
    public Money Add(Money other) => Currency == other.Currency ? new(Amount + other.Amount, Currency) : throw new DomainException("money.mismatch", "Currency mismatch");
    public Money Multiply(int qty) => new(Amount * qty, Currency);
    public override string ToString() => $"{Amount:0.00} {Currency}";
}

public sealed record EmailAddress
{
    public string Value { get; }
    private EmailAddress(string v) => Value = v;
    public static Result<EmailAddress> Create(string input) =>
        MailAddress.TryCreate(input?.Trim(), out var m) ? new EmailAddress(m.Address.ToLowerInvariant()) : Errors.InvalidEmail;
}
```

(`Result<T>` above is a small wrapper that stands for "success with a value, or a named failure" without throwing an exception for an expected failure like "bad email format" — the full pattern is in [CQRS & Result](ch:cqrs-mediator-result).)

**Why bother:** notice what `Money`'s constructor does that a plain `decimal` parameter never could — it fixes **primitive obsession** (`decimal price, string currency` passed separately everywhere, with nothing stopping them being passed in the wrong order, or a `string email` that was never actually validated as an email). Validation happens **once, at creation**, so once you're holding an `EmailAddress` instance, it is *guaranteed* valid — there's no later point in the code where you need to re-check it. Behaviour lives with the data (`Money.Add` enforces the currency-mismatch rule right where the data lives); method signatures become self-documenting (`Charge(Money amount)` tells you far more than `Charge(decimal amount, string currency)` ever could). Records give value equality for free, which is exactly the comparison semantics a value object needs.

## Aggregates: the most important tactical pattern, and the hardest to get right {a}

An **aggregate** is a cluster of entities and value objects treated as **one unit for data changes**, with one entity as the **aggregate root**. The aggregate is a **consistency boundary**: its **invariants** (business rules that must always be true) are enforced inside it, in a single transaction — nothing outside the aggregate is ever allowed to put it into an invalid state.

```text
Order (aggregate root)                    rules enforced here:
 ├── OrderLine (entity, inside)            • an order has ≥ 1 line before it's placed
 ├── OrderLine                             • quantities 1–100; max 50 lines
 ├── ShippingAddress (value object)        • total = sum of lines; can't go negative
 └── Status                                • can't add lines after it's placed; can't cancel after shipping
CustomerId, ProductId → references to OTHER aggregates by ID only
```

**The rules of aggregate design (Vaughn Vernon):**

1. **Protect invariants inside the boundary.** All changes go **through the root**: no public setters, no external code adding to `Lines` directly.
2. **Design small aggregates.** Big aggregates mean big loads, lock contention and concurrency conflicts. Most aggregates are one root entity plus a few value objects or child entities.
3. **Reference other aggregates by identity only** (`CustomerId`, not a `Customer` navigation), which keeps boundaries and transactions small.
4. **One transaction modifies one aggregate.** Changes to other aggregates happen **eventually**, via domain events.
5. Load and save the **whole aggregate** through its **repository**.

Rule 3 fights your relational instincts the most. In a plain EF Core model you'd naturally add a navigation property from `Order` straight to a full `Customer` entity. DDD says don't: if code can follow that navigation and change the customer while it's inside an order-handling transaction, the clean boundary rule 4 relies on is gone. Keep the reference as a plain ID instead.

```csharp
public sealed class Order : AggregateRoot<OrderId>
{
    private readonly List<OrderLine> _lines = [];
    public CustomerId CustomerId { get; private set; }
    public OrderStatus Status { get; private set; } = OrderStatus.Draft;
    public Address? ShippingAddress { get; private set; }
    public IReadOnlyList<OrderLine> Lines => _lines.AsReadOnly();
    public Money Total => _lines.Aggregate(Money.Zero("EUR"), (sum, l) => sum.Add(l.Subtotal));

    private Order() { }                                              // for EF Core
    public static Order Draft(CustomerId customer) => new() { Id = OrderId.New(), CustomerId = customer };

    public Result AddLine(ProductId product, string name, Money unitPrice, int quantity)
    {
        if (Status != OrderStatus.Draft) return OrderErrors.NotEditable;
        if (quantity is < 1 or > 100) return OrderErrors.InvalidQuantity;
        if (_lines.Count >= 50) return OrderErrors.TooManyLines;

        var existing = _lines.SingleOrDefault(l => l.ProductId == product);
        if (existing is not null) existing.Increase(quantity);
        else _lines.Add(new OrderLine(product, name, unitPrice, quantity));
        return Result.Success();
    }

    public Result Place(Address shipTo, TimeProvider clock)
    {
        if (Status != OrderStatus.Draft) return OrderErrors.AlreadyPlaced;
        if (_lines.Count == 0) return OrderErrors.Empty;
        ShippingAddress = shipTo;
        Status = OrderStatus.Placed;
        Raise(new OrderPlaced(Id, CustomerId, Total, clock.GetUtcNow()));   // domain event
        return Result.Success();
    }

    public Result Cancel(string reason)
    {
        if (Status is OrderStatus.Shipped or OrderStatus.Delivered) return OrderErrors.AlreadyShipped;
        Status = OrderStatus.Cancelled;
        Raise(new OrderCancelled(Id, reason));
        return Result.Success();
    }
}
```

Notice that `AddLine`, `Place` and `Cancel` are the **only** way to change this aggregate's state — there's no public `set` anywhere, and every single rule from the diagram above (max 50 lines, can't cancel after shipping) is enforced right inside the method that would otherwise violate it. This is exactly the "rich domain model" and Tell-Don't-Ask discipline [Design principles](ch:design-principles#other-principles-worth-naming) named, now applied at full scale.

:::gotcha The "one aggregate per transaction" rule in practice
"Place order" wants to reserve stock (Inventory aggregate) and award loyalty points (Customer aggregate). Don't load and modify all three in one transaction. Save the `Order`, raise `OrderPlaced`, and let handlers update Inventory and Loyalty, either in-process after commit or via messages, **eventually**. If the business truly needs one atomic rule spanning them, that's a sign your aggregate boundaries are wrong.
:::

## Domain events: a record of something that already happened {a}

A **domain event** records **something meaningful that happened in the domain**, named in the past tense, in the ubiquitous language: `OrderPlaced`, `PaymentReceived`, `StockDepleted` — exactly the naming discipline [Design patterns](ch:design-patterns#command) drew the line on, distinguishing an event (already happened, can't be rejected) from a command (a request, might be refused).

```csharp
public interface IDomainEvent { DateTimeOffset OccurredAt { get; } }
public sealed record OrderPlaced(OrderId OrderId, CustomerId CustomerId, Money Total, DateTimeOffset OccurredAt) : IDomainEvent;

public abstract class AggregateRoot<TId> : Entity<TId> where TId : notnull
{
    private readonly List<IDomainEvent> _events = [];
    public IReadOnlyList<IDomainEvent> DomainEvents => _events;
    protected void Raise(IDomainEvent e) => _events.Add(e);
    public void ClearDomainEvents() => _events.Clear();
}
```

Having raised the event, there's still the question of *when* it actually gets dispatched to whoever needs to react — and that choice carries real consequences:

| When | How | Trade-off |
|---|---|---|
| **Before commit**, same transaction | Interceptor dispatches in-process handlers before `SaveChanges` completes | Atomic, but couples the handlers into the transaction |
| **After commit**, in-process | Dispatch after `SaveChanges` succeeds | Simple; if the process crashes in between, the event is lost |
| **Outbox** (recommended for cross-boundary effects) | Persist events in an Outbox table in the same transaction; a worker publishes them | Reliable, at-least-once; handlers must be idempotent |

The outbox row is the one worth defaulting to for anything that genuinely matters, and it's exactly the mechanism [EF Core advanced](ch:efcore-advanced#domain-events-and-the-outbox-on-savechanges) implemented end-to-end: by writing the event into the *same* transaction as the aggregate's own save, there's no window where the order exists but the event describing it was lost, or vice versa.

**Domain events** (within a bounded context, in-process) vs **integration events** (published to other contexts or services via a broker, with a stable public schema). Often a domain event handler **translates** a domain event into an integration event. See [Messaging & events](ch:messaging-events).

## Domain services, application services, factories and repositories {a}

| Building block | Responsibility | Example |
|---|---|---|
| **Domain service** | Domain logic that doesn't naturally belong to one entity or value object; stateless; in domain terms | `PricingService.CalculateDiscount(order, customerTier)`, `TransferService.Transfer(accountA, accountB, money)` |
| **Application service / use case handler** | Orchestrates: loads aggregates, calls domain methods, saves, publishes. **No business rules** | `PlaceOrderHandler` |
| **Factory** | Encapsulates complex creation, ensuring a valid initial state | `Order.Draft(customer)`, `OrderFactory.FromCart(cart)` |
| **Repository** | Collection-like access to **aggregate roots only**; interface in the domain, implementation in infrastructure | `IOrderRepository.GetAsync(OrderId)`, `Add(Order)` |
| **Specification** | A reusable business predicate | `new OverdueInvoiceSpec(today)` |

The distinction worth holding onto between the first two rows: a *domain* service still speaks the business's language and can contain real rules (`TransferService` deciding how a transfer actually works), while an *application* service is pure orchestration — it calls other things in the right order and contains no judgment calls of its own. `PlaceOrderHandler` from earlier chapters is a textbook application service precisely because every actual decision inside it (can this order be placed? is this quantity valid?) was delegated to the aggregate itself.

## Rich vs anemic domain models {i}

```csharp
// ✘ Anemic: a bag of data; rules live in services and get duplicated and bypassed
public class Order { public int Id { get; set; } public string Status { get; set; } = ""; public List<OrderLine> Lines { get; set; } = []; }
public class OrderService
{
    public void Cancel(Order o)
    {
        if (o.Status == "Shipped") throw new Exception("…");    // and the same check in three other places…
        o.Status = "Cancelled";                                  // …while anyone can set Status = "Cancelled" anywhere
    }
}

// ✔ Rich: behaviour and data together; invalid states unrepresentable
order.Cancel("customer request");                               // the only way to cancel; rules inside
```

Look at the anemic version again: because `Status` has a public setter, nothing stops other code from writing `order.Status = "Cancelled"` directly, skipping the shipped-order check entirely. The rule lives in `OrderService.Cancel`, but only helps if every caller remembers to call it — and in a large codebase, eventually one won't. This is why Martin Fowler called the anemic model an **anti-pattern**: it costs you extra types and indirection but doesn't actually deliver the one thing a domain model is for — invariants that can't be bypassed. Tell, Don't Ask ([Design principles](ch:design-principles#other-principles-worth-naming)) is the idea behind the fix.

## Persisting aggregates with EF Core {a}

EF Core can map rich models without polluting them — none of the mapping configuration below needs to leak back into the `Order` class itself:

```csharp
public sealed class OrderConfiguration : IEntityTypeConfiguration<Order>
{
    public void Configure(EntityTypeBuilder<Order> b)
    {
        b.HasKey(o => o.Id);
        b.Property(o => o.Id).HasConversion(id => id.Value, v => new OrderId(v));           // strongly typed id
        b.Property(o => o.CustomerId).HasConversion(id => id.Value, v => new CustomerId(v)); // reference by id, no navigation
        b.Property(o => o.Status).HasConversion<string>().HasMaxLength(20);
        b.OwnsOne(o => o.ShippingAddress);                                                   // value object → columns
        b.OwnsMany(o => o.Lines, l =>                                                        // child entities inside the aggregate
        {
            l.WithOwner().HasForeignKey("OrderId");
            l.Property<int>("Id");
            l.ComplexProperty(x => x.UnitPrice);
        });
        b.Navigation(o => o.Lines).UsePropertyAccessMode(PropertyAccessMode.Field);         // use the private _lines field
        b.Ignore(o => o.DomainEvents);
        b.Ignore(o => o.Total);                                                              // computed
        b.Property<byte[]>("RowVersion").IsRowVersion();                                      // concurrency for the whole aggregate
    }
}
```

Notice that `CustomerId` is mapped as a plain property with a value converter, not a navigation — the Fluent API configuration directly enforces rule 3 from the aggregate design section above, at the persistence layer rather than just by convention. Private setters, private parameterless constructors, backing fields, owned and complex types, and value converters together let the domain stay genuinely clean. Some teams instead keep **separate persistence models** and map between them: the purest approach, with more code to maintain in exchange for zero coupling at all between the domain and EF Core's own requirements.

## When DDD is overkill {i}

Tactical DDD has real costs: more types, more mapping, a learning curve, and eventual consistency between aggregates. Use it for **core, complex domains with rich rules that change often** — exactly the "Core" row from the subdomain table earlier in this chapter. For CRUD-style supporting subdomains (reference data admin, simple forms), a straightforward model with EF Core and validation is better, and reaching for the full tactical toolkit there would be ceremony without payoff. **Strategic DDD** (bounded contexts, ubiquitous language) is valuable almost everywhere, even when you skip the tactical patterns entirely — the value of a shared, precise vocabulary doesn't depend on how rich the underlying model needs to be.

:::qa What is an aggregate and what rules govern it?
A cluster of domain objects treated as one unit for changes, with a single aggregate root through which all modifications pass, so invariants are enforced within the boundary. Rules: keep aggregates small, reference other aggregates by ID only, modify one aggregate per transaction, use domain events and eventual consistency for cross-aggregate effects, and load and save whole aggregates via repositories.
:::

:::qa Entity vs value object?
An entity has a persistent identity: two orders with identical data are still different orders, and its attributes can change. A value object has no identity, is defined by its values, is immutable and is compared by value (Money, Address, EmailAddress). Records are a natural fit for value objects.
:::

:::qa What is a bounded context?
An explicit boundary within which a particular domain model and its ubiquitous language are consistent. The same term (Product, Customer) can have different models in different contexts, which integrate through defined contracts or translations (anti-corruption layers). Bounded contexts are natural module or microservice boundaries.
:::

:::qa What is the ubiquitous language?
A shared, rigorous vocabulary developed with domain experts and used consistently in conversations, documentation and code (class and method names), scoped to a bounded context. It reduces translation errors between business and code.
:::

:::qa What is an anemic domain model and why is it a problem?
Entities that only hold data (public getters and setters) while all business logic lives in service classes. Rules get duplicated and bypassed, invariants aren't protected, and the model doesn't express the domain. Rich models put behaviour and data together and make invalid states impossible.
:::

:::qa Domain events vs integration events?
Domain events are raised by aggregates within a bounded context and handled in-process, often as part of or right after the transaction. Integration events cross service or context boundaries via a message broker, have stable versioned schemas, and are published reliably (outbox), typically translated from domain events.
:::

:::qa Domain service vs application service?
A domain service contains domain logic that doesn't fit a single entity or value object and is expressed in domain terms (pricing, transfers). An application service or use-case handler orchestrates: it loads aggregates via repositories, invokes domain behaviour, persists, and publishes events, but contains no business rules itself.
:::

:::qa What is an anti-corruption layer?
A translation layer (adapters and mappers) between your bounded context and an external or legacy system's model, so foreign concepts and quirks don't leak into your domain model.
:::

:::qa When would you not use DDD?
For simple CRUD or supporting subdomains with little business logic, small short-lived apps, or when domain experts aren't available. Strategic ideas (bounded contexts, shared language) are still useful, but tactical patterns would add ceremony without benefit.
:::

## Further reading

- Eric Evans, *Domain-Driven Design: Tackling Complexity in the Heart of Software* (the "blue book").
- Vaughn Vernon, *Implementing Domain-Driven Design* (the "red book") and *Domain-Driven Design Distilled* (short intro).
- Vlad Khononov, *Learning Domain-Driven Design* (modern, very approachable).
- [Design a DDD-oriented microservice (Microsoft eShop guide)](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/ddd-oriented-microservice)
- Vaughn Vernon, "Effective Aggregate Design" (free three-part essay).

## Verify this chapter

Run with `dotnet run` (plain console app, .NET 8/9, top-level statements, BCL only). The real chapter's types are trimmed down here to just what each check needs.

```csharp
// Claim 1: an entity's identity, not its other fields, decides equality.
var a = new Customer(CustomerId.New(), "Alice");
var b = new Customer(a.Id, "Alice (renamed)"); // same id, different name
var c = new Customer(CustomerId.New(), "Alice"); // different id, same name
if (!a.Equals(b)) throw new Exception("FAIL: entities with the same id should be equal even if other fields differ");
if (a.Equals(c)) throw new Exception("FAIL: entities with different ids should not be equal, even with identical other fields");
Console.WriteLine("OK: entity equality is based on identity (Id), not on the rest of the fields");

// Claim 2: a value object (here, a record) is equal purely by its values, with no identity.
var m1 = new Money(10.00m, "EUR");
var m2 = new Money(10.00m, "EUR");
var m3 = new Money(10.01m, "EUR");
if (!m1.Equals(m2)) throw new Exception("FAIL: two value objects with the same values should be equal");
if (m1.Equals(m3)) throw new Exception("FAIL: value objects with different values should not be equal");
if (ReferenceEquals(m1, m2)) throw new Exception("FAIL: this check should hold for distinct instances, not the same object");
Console.WriteLine("OK: value objects compare by value, not by reference");

// Claim 3: Money's constructor protects its own invariant (no negative amounts, 3-letter currency).
try { _ = new Money(-1, "EUR"); throw new Exception("FAIL: negative amount should have been rejected"); }
catch (ArgumentException) { Console.WriteLine("OK: a value object validates itself at construction (negative Money amount rejected)"); }

// Claim 4: an aggregate only changes through its root's methods, which enforce its invariants.
var order = Order.Draft(CustomerId.New());
var addResult = order.AddLine(ProductId.New(), "Widget", new Money(5, "EUR"), quantity: 0);
if (addResult) throw new Exception("FAIL: quantity 0 should be rejected by AddLine's own invariant");
Console.WriteLine("OK: AddLine enforces its own quantity invariant (can't add a line with quantity 0)");

if (!order.AddLine(ProductId.New(), "Widget", new Money(5, "EUR"), quantity: 2))
    throw new Exception("FAIL: a valid line should be accepted");
if (!order.Place()) throw new Exception("FAIL: an order with at least one line should be placeable");
if (order.Place()) throw new Exception("FAIL: placing an already-placed order should be rejected — Status is no longer Draft");
Console.WriteLine("OK: the aggregate root's own rules — not outside code — decide what's allowed (can't re-place an order already placed)");

// Claim 5: placing an order raises a domain event recording that it happened.
if (order.DomainEvents.Count != 1 || order.DomainEvents[0] is not OrderPlaced)
    throw new Exception("FAIL: Place() should have raised exactly one OrderPlaced domain event");
Console.WriteLine("OK: a state-changing aggregate method raises a domain event recording what happened");

// --- Minimal stand-ins for the chapter's types, trimmed to what's being checked above ---

readonly record struct CustomerId(Guid Value)
{
    public static CustomerId New() => new(Guid.NewGuid());
}

readonly record struct ProductId(Guid Value)
{
    public static ProductId New() => new(Guid.NewGuid());
}

abstract class Entity<TId> where TId : notnull
{
    public TId Id { get; protected init; } = default!;
    public override bool Equals(object? obj) => obj is Entity<TId> other && GetType() == other.GetType() && Id.Equals(other.Id);
    public override int GetHashCode() => Id.GetHashCode();
}

sealed class Customer : Entity<CustomerId>
{
    public string Name { get; }
    public Customer(CustomerId id, string name) { Id = id; Name = name; }
}

sealed record Money
{
    public decimal Amount { get; }
    public string Currency { get; }

    public Money(decimal amount, string currency)
    {
        if (amount < 0) throw new ArgumentException("Amount can't be negative");
        if (currency is not { Length: 3 }) throw new ArgumentException("Use ISO 4217 codes");
        Amount = decimal.Round(amount, 2, MidpointRounding.ToEven);
        Currency = currency.ToUpperInvariant();
    }

    public static Money Zero(string currency) => new(0, currency);
    public Money Add(Money other) => Currency == other.Currency ? new(Amount + other.Amount, Currency) : throw new InvalidOperationException("Currency mismatch");
}

interface IDomainEvent { }
sealed record OrderPlaced(Guid OrderId) : IDomainEvent;

enum OrderStatus { Draft, Placed, Shipped, Cancelled }

sealed class Order : Entity<Guid>
{
    private readonly List<(ProductId Product, Money Price, int Qty)> _lines = [];
    private readonly List<IDomainEvent> _events = [];
    public OrderStatus Status { get; private set; } = OrderStatus.Draft;
    public IReadOnlyList<IDomainEvent> DomainEvents => _events;

    public static Order Draft(CustomerId customer) => new() { Id = Guid.NewGuid() };

    public bool AddLine(ProductId product, string name, Money price, int quantity)
    {
        if (Status != OrderStatus.Draft) return false;
        if (quantity is < 1 or > 100) return false;
        _lines.Add((product, price, quantity));
        return true;
    }

    public bool Place()
    {
        if (Status != OrderStatus.Draft || _lines.Count == 0) return false;
        Status = OrderStatus.Placed;
        _events.Add(new OrderPlaced(Id));
        return true;
    }

    public bool Cancel()
    {
        if (Status is OrderStatus.Shipped) return false;
        Status = OrderStatus.Cancelled;
        return true;
    }
}
```
