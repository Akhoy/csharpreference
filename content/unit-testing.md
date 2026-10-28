---
id: unit-testing
title: Unit Testing and Test Doubles
summary: Fast, focused tests of behaviour. What a unit is, xUnit (facts, theories, fixtures, lifecycle), NUnit and MSTest compared, Arrange-Act-Assert and naming, assertion libraries, test doubles (dummy, stub, fake, spy, mock), NSubstitute and Moq, testing time, async and exceptions, test data builders, TDD, and what makes tests valuable or brittle.
layer: cross
where: Cross-cutting › Testing › Unit tests
fits: Testing is a layer-8 concern that touches every layer. Unit tests are most valuable for the **domain and application layers** ([DDD](ch:ddd), [CQRS](ch:cqrs-mediator-result)), and they're easy precisely because of DI and Dependency Inversion ([Design principles](ch:design-principles)). Infrastructure and the HTTP pipeline are better covered by [integration tests](ch:integration-testing).
levels: b,i,a
prereqs: oop, dependency-injection, async-await
next: integration-testing
---

## TL;DR

- A unit test checks **one behaviour**, fast and deterministically. "One unit" is debated: classical style treats a unit as a *behaviour* (several real classes allowed); mockist style treats it as *one class* (everything else mocked). Classical is the current mainstream advice.
- Good tests are **FIRST**: Fast, Isolated, Repeatable, Self-validating, Timely.
- A **test double** is a precise word for "fake dependency": dummy (unused filler), stub (feeds input), fake (working lightweight version), spy (records calls), mock (asserts calls happened). Over-mocking makes tests break on every refactor even when behaviour didn't change.
- Inject sources of non-determinism (`TimeProvider`, not `DateTime.Now`) so tests are repeatable.
- Coverage percentage is a diagnostic, not a goal — a test can run every line and still assert nothing meaningful.

## What a unit test is, and the question that divides testers {b}

A **unit test** verifies **one unit of behaviour** in isolation, quickly and deterministically. That sounds simple until you ask the obvious follow-up: what, exactly, is "one unit"? There are two genuinely different schools of thought here, and they lead to noticeably different-looking tests:

| | Classical (Detroit/Chicago) | Mockist (London) |
|---|---|---|
| A unit is… | A **behaviour**, possibly spanning several collaborating classes | **One class** |
| Collaborators | Use real ones; replace only **shared or out-of-process** dependencies (DB, network, clock) | Mock **every** collaborator |
| Strength | Tests survive refactoring | Precise failure location; drives interface design |
| Risk | Larger tests | Brittle tests coupled to implementation |

Modern guidance (e.g. Vladimir Khorikov's *Unit Testing Principles, Practices, and Patterns*) leans **classical**: test observable behaviour, and mock only at the boundaries of your system. The reasoning becomes clear once you picture refactoring a class's internals without changing what it *does* — a classical test, written against behaviour, survives unchanged; a mockist test, written against every internal collaborator, breaks even though nothing externally visible changed.

**Good unit tests are FIRST**: **F**ast (milliseconds), **I**solated (no order dependence, no shared state), **R**epeatable (same result every run: no real time, randomness or network), **S**elf-validating (pass/fail, no manual inspection), **T**imely (written with the code).

## xUnit essentials {b}

**xUnit** is the most common test framework in modern .NET (the ASP.NET Core and .NET runtime teams use it). **xUnit v3** is the current major version.

```bash
dotnet new xunit -n Shop.Domain.Tests
dotnet add Shop.Domain.Tests reference src/Shop.Domain
dotnet test                                   # discovers and runs all tests
dotnet test --filter "FullyQualifiedName~Orders&Category=Unit"
```

```csharp
public class MoneyTests
{
    [Fact]
    public void Add_SameCurrency_SumsAmounts()
    {
        // Arrange
        var a = new Money(10.50m, "EUR");
        var b = new Money(4.50m, "EUR");

        // Act
        var sum = a.Add(b);

        // Assert
        Assert.Equal(new Money(15m, "EUR"), sum);
    }

    [Fact]
    public void Add_DifferentCurrency_Throws()
    {
        var eur = new Money(1, "EUR");
        var usd = new Money(1, "USD");

        var ex = Assert.Throws<DomainException>(() => eur.Add(usd));
        Assert.Equal("money.mismatch", ex.Code);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(-0.01)]
    public void Ctor_NegativeAmount_Throws(decimal amount) =>
        Assert.Throws<DomainException>(() => new Money(amount, "EUR"));

    [Theory]
    [MemberData(nameof(RoundingCases))]
    public void Ctor_RoundsToTwoDecimals_BankersRounding(decimal input, decimal expected) =>
        Assert.Equal(expected, new Money(input, "EUR").Amount);

    public static TheoryData<decimal, decimal> RoundingCases => new() { { 1.005m, 1.00m }, { 1.015m, 1.02m }, { 2.345m, 2.34m } };
}
```

| Feature | How |
|---|---|
| A test | `[Fact]` |
| Parameterised test | `[Theory]` + `[InlineData]` / `[MemberData]` / `[ClassData]` / `TheoryData<…>` |
| Setup / teardown | **Constructor** / `IDisposable.Dispose` (or `IAsyncLifetime` for async) |
| A new class instance per test | Yes: xUnit creates a fresh instance for **every** test, so there's no shared state by accident |
| Share expensive setup across a class | `IClassFixture<TFixture>` |
| Share across classes | `[Collection("db")]` + `ICollectionFixture<TFixture>` |
| Skip | `[Fact(Skip = "reason")]` |
| Categorise | `[Trait("Category", "Unit")]` |
| Output | Inject `ITestOutputHelper` |
| Parallelism | Test **collections** (by default, each class) run in parallel; tests within a class run sequentially |

The "new instance per test" row deserves a second look, because it's a deliberate design choice, not an incidental detail: it means a bug where one test's leftover state silently affects the next test **cannot happen** by construction in xUnit, since there is no "next test" sharing the same instance to leave state in.

### xUnit vs NUnit vs MSTest

| | xUnit | NUnit | MSTest (v3) |
|---|---|---|---|
| Test attribute | `[Fact]`, `[Theory]` | `[Test]`, `[TestCase]` | `[TestMethod]`, `[DataRow]` |
| Setup | Constructor / `IAsyncLifetime` | `[SetUp]`, `[OneTimeSetUp]` | `[TestInitialize]`, `[ClassInitialize]` |
| Instance per test | Always | One per fixture by default | One per test |
| Notes | Minimal and opinionated | Rich assertions and attributes | Microsoft's; modernised with MSTest.Sdk and Microsoft.Testing.Platform |

All three are fine; consistency within a codebase matters most.

## Naming and structure {b}

A test name should say **what behaviour** is expected **under which condition**, readable as a specification rather than as an implementation detail:

```text
MethodUnderTest_Scenario_ExpectedResult      Cancel_WhenOrderShipped_ReturnsAlreadyShippedError
Should_ExpectedBehaviour_When_Condition      Should_ApplyVipDiscount_When_CustomerIsVip
Plain English (Khorikov)                     Shipped_order_cannot_be_cancelled
```

Rules: **one behaviour per test** (multiple asserts are fine if they verify one outcome), **no logic in tests** (no `if`, no loops computing expected values: the test should be obviously correct by inspection, never itself a thing that could have a bug), and **Arrange-Act-Assert** with a single Act.

## Assertions {b}

```csharp
// Built-in xUnit
Assert.Equal(expected, actual);
Assert.True(order.IsPaid);
Assert.Contains(order.Lines, l => l.Sku == "KB-01");
Assert.Single(events);
Assert.IsType<OrderPlaced>(events[0]);
await Assert.ThrowsAsync<NotFoundException>(() => sut.GetAsync(999, ct));
Assert.Equivalent(new { Status = "Paid", Total = 89.70m }, dto);   // structural comparison

// Shouldly (fluent, readable failures)
order.Status.ShouldBe(OrderStatus.Placed);
order.Lines.ShouldHaveSingleItem().Quantity.ShouldBe(2);
Should.Throw<DomainException>(() => order.Cancel("x")).Code.ShouldBe("order.already_shipped");
```

Popular libraries: **Shouldly** (MIT), **FluentAssertions** (commercial licence since v8 in 2025; v7 remains Apache-licensed), **AwesomeAssertions** (an MIT community fork of FluentAssertions). For snapshot testing (approve the whole output once, then detect changes), use **Verify**.

## Test doubles: a precise vocabulary for "fake dependency" {i}

A **test double** stands in for a real dependency, and Gerard Meszaros gave the vocabulary that lets testers talk precisely about *which kind* of double a given test needs, rather than lumping everything under "mock":

| Double | Purpose | Example |
|---|---|---|
| **Dummy** | Fills a parameter; never used | `NullLogger<T>.Instance` |
| **Stub** | Returns canned answers to **provide inputs** | A repository stub returning a fixed order |
| **Fake** | A working, simplified implementation | In-memory repository, `FakeTimeProvider`, fake email sender collecting messages |
| **Spy** | Records how it was called, asserted later | A fake notifier with a `SentMessages` list |
| **Mock** | Pre-programmed with **expectations** about calls, **verified** | "`ChargeAsync` must be called once with 89.70 EUR" |

The key distinction cutting across this whole table: **stubs** support **state verification** (assert on the result or the system's state after the fact), while **mocks** support **behaviour verification** (assert that a specific interaction happened, regardless of the resulting state). **Verify interactions only for outgoing side effects at the system boundary** (an email was sent, a message was published, a payment was charged), never for internal calls or queries — the next gotcha explains exactly why that restraint matters.

### NSubstitute and Moq

```csharp
// NSubstitute: concise, popular
var payments = Substitute.For<IPaymentGateway>();
payments.ChargeAsync(Arg.Any<Money>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
        .Returns(PaymentResult.Declined("insufficient_funds"));
var orders = Substitute.For<IOrderRepository>();
var uow = Substitute.For<IUnitOfWork>();

var sut = new PlaceOrderHandler(orders, new FixedPricing(), payments, uow);
var result = await sut.Handle(SampleCommand(), CancellationToken.None);

result.IsFailure.ShouldBeTrue();
result.Error.Code.ShouldBe("order.payment_declined");
orders.DidNotReceive().Add(Arg.Any<Order>());                    // outgoing side effect NOT performed
await uow.DidNotReceive().SaveChangesAsync(Arg.Any<CancellationToken>());

// Moq: the long-standing alternative
var mock = new Mock<IPaymentGateway>();
mock.Setup(p => p.ChargeAsync(It.IsAny<Money>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
    .ReturnsAsync(PaymentResult.Success("ch_1"));
mock.Verify(p => p.ChargeAsync(It.Is<Money>(m => m.Amount == 89.70m), "tok", It.IsAny<CancellationToken>()), Times.Once);
```

Notice the NSubstitute test's two `DidNotReceive()` assertions are verifying exactly the outcome the "outgoing side effect" rule allows: when payment is declined, the order should never actually be saved. That's a genuine behavioural guarantee worth locking in with a mock — quite different from mocking, say, a method that only reads data.

Other options: **FakeItEasy**, or **hand-written fakes**, which are often clearer for repositories and clocks.

:::gotcha Over-mocking makes tests brittle
If every collaborator is mocked and every call verified, **any refactoring breaks tests** even when behaviour is unchanged, and the tests mostly restate the implementation. Signs: tests that mock 6 interfaces, `Verify` calls for queries, tests that fail when you rename a private method's collaborator. Prefer real in-process objects, fakes for I/O, and asserting outcomes.
:::

:::gotcha What not to mock
Don't mock types you don't own with complex behaviour (`HttpClient`, `DbContext`, `IQueryable`): the mock won't behave like the real thing. Wrap them behind your own interface and test the wrapper with integration tests, or use a stub `HttpMessageHandler` or a real database container.
:::

## Testing time, randomness and async {i}

Code that calls `DateTime.UtcNow`, `Guid.NewGuid()` or `Random` directly is non-deterministic — the exact same test can pass today and fail tomorrow purely because the clock moved. The fix is the same dependency-injection discipline the rest of this book applies everywhere else: inject the source of non-determinism instead of calling it directly.

```csharp
// Production: register TimeProvider.System; code takes TimeProvider (.NET 8)
public sealed class SubscriptionService(TimeProvider clock)
{
    public bool IsExpired(Subscription s) => s.EndsAt < clock.GetUtcNow();
}

// Test: Microsoft.Extensions.TimeProvider.Testing
var clock = new FakeTimeProvider(new DateTimeOffset(2026, 10, 27, 12, 0, 0, TimeSpan.Zero));
var sut = new SubscriptionService(clock);
sut.IsExpired(new Subscription { EndsAt = clock.GetUtcNow().AddDays(1) }).ShouldBeFalse();
clock.Advance(TimeSpan.FromDays(2));                         // move time forward deterministically; also fires timers
sut.IsExpired(new Subscription { EndsAt = new DateTimeOffset(2026, 10, 28, 12, 0, 0, TimeSpan.Zero) }).ShouldBeTrue();
```

- **Async tests**: make the test `async Task` and `await` the call; never `.Result`. Use `Assert.ThrowsAsync`.
- **Timers, delays, `PeriodicTimer`**: pass `TimeProvider` so `FakeTimeProvider.Advance` drives them without real waiting.
- **Logging**: `FakeLogger<T>` (Microsoft.Extensions.Diagnostics.Testing) captures log records to assert on.

## Test data builders and fixtures {i}

Tests drown in setup code without builders — constructing a valid `Order` by hand, every single time, for a test that only cares about one specific edge case, is exactly the kind of repetitive ceremony that makes a test suite unpleasant to maintain. The **Test Data Builder** pattern (or "Object Mother") — the same Builder from [Design patterns](ch:design-patterns#builder) — gives valid defaults and lets each test override only what actually matters to it:

```csharp
public sealed class OrderBuilder
{
    private CustomerId _customer = CustomerId.New();
    private readonly List<(ProductId, string, Money, int)> _lines = [(ProductId.New(), "Keyboard", new Money(49.90m, "EUR"), 1)];
    private bool _placed;

    public OrderBuilder ForCustomer(CustomerId id) { _customer = id; return this; }
    public OrderBuilder WithLine(string name, decimal price, int qty = 1) { _lines.Add((ProductId.New(), name, new Money(price, "EUR"), qty)); return this; }
    public OrderBuilder Placed() { _placed = true; return this; }

    public Order Build()
    {
        var o = Order.Draft(_customer);
        foreach (var (p, n, m, q) in _lines) o.AddLine(p, n, m, q);
        if (_placed) o.Place(TestData.Address, TimeProvider.System);
        return o;
    }
}

[Fact]
public void Placed_order_cannot_receive_new_lines()
{
    var order = new OrderBuilder().Placed().Build();
    var result = order.AddLine(ProductId.New(), "Mouse", new Money(20, "EUR"), 1);
    result.Error.ShouldBe(OrderErrors.NotEditable);
}
```

Notice how little the test itself has to say: `new OrderBuilder().Placed().Build()` conveys exactly the one fact this particular test cares about — that the order is already placed — while the builder's defaults quietly handle everything else (customer, lines) that the test doesn't need to think about at all.

**AutoFixture** and **Bogus** generate anonymous or realistic data when values don't matter to the test.

## What to unit test (and what not to) {i}

| High value | Low value |
|---|---|
| **Domain logic**: invariants, calculations, state transitions | Trivial getters/setters, auto-properties |
| Application handlers' decision logic (with fakes at the edges) | Code that only delegates (pass-through) |
| Algorithms, parsers, mappers with logic | Framework behaviour (EF Core, ASP.NET Core) |
| Edge cases: empty, null, boundaries, error paths | Private methods directly (test via public behaviour) |
| Bug reproductions (regression tests) | UI layout |

**Coverage** is a *diagnostic*, not a goal. 100% line coverage with weak assertions proves little — a test can execute every line of a method and still assert nothing meaningful about what those lines actually produced. **Mutation testing** (Stryker.NET mutates your code, e.g. flipping `>` to `>=`, and checks whether tests fail) measures whether tests actually detect bugs, which is a fundamentally different and more honest question than "did this line run."

## TDD {a}

**Test-Driven Development**: **Red** (write a failing test for the next small behaviour) → **Green** (the simplest code that passes) → **Refactor** (improve the design with the tests as a safety net). Repeat in minutes-long cycles.

Benefits: tests exist by construction, the design is driven by usage (testable APIs, small units), and it keeps you focused on one small increment at a time. Criticisms: it can feel slow while a design is exploratory, and it's harder with heavy framework code where the "simplest thing that passes" isn't obvious. Many teams practise it selectively for domain logic and bug fixes ("write the failing test that reproduces the bug first," which doubles as both a diagnosis and a regression guard). **BDD** (Given-When-Then, SpecFlow/Reqnroll) extends the idea to executable specifications written with business stakeholders.

:::qa What makes a good unit test?
Fast, isolated, repeatable (no real time, network or DB), self-validating, and focused on one observable behaviour through the public API. It has a clear Arrange-Act-Assert structure, a descriptive name, no logic of its own, and it survives refactoring because it asserts outcomes rather than implementation details.
:::

:::qa Explain the difference between a mock, a stub and a fake.
A stub returns canned data to feed the code under test (state verification). A mock records interactions and is verified to have been called in a particular way (behaviour verification). A fake is a working lightweight implementation, such as an in-memory repository or FakeTimeProvider.
:::

:::qa When should you verify interactions with mocks?
Only for outgoing side effects that cross the system boundary and are part of the observable behaviour: an email sent, a message published, a payment charged. Don't verify queries or internal collaborator calls; that couples tests to implementation.
:::

:::qa xUnit Fact vs Theory?
Fact is a single parameterless test. Theory is a parameterised test that runs once per data row supplied by InlineData, MemberData, ClassData or TheoryData.
:::

:::qa How do you share setup across tests in xUnit?
The constructor (and Dispose/IAsyncLifetime) for per-test setup, since xUnit creates a new instance per test; IClassFixture&lt;T&gt; to share an expensive object across a class's tests; collection fixtures ([Collection] plus ICollectionFixture) to share across classes, e.g. a database container.
:::

:::qa How do you test code that depends on the current time?
Inject TimeProvider (.NET 8) or a clock abstraction instead of calling DateTime.Now. In tests, use FakeTimeProvider to set and advance time deterministically, which also drives timers and delays.
:::

:::qa Is 100% code coverage a good goal?
No. Coverage shows which lines executed, not whether behaviour was verified, and chasing it produces low-value tests. Focus on meaningful coverage of business logic and edge cases, and use mutation testing to assess test effectiveness.
:::

:::qa What is TDD?
Test-Driven Development: write a failing test for a small piece of behaviour (red), write the minimum code to pass (green), then refactor safely, in short cycles. It yields tests by construction and testable, usage-driven designs.
:::

## Further reading

- [Unit testing best practices for .NET](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-best-practices)
- [xUnit.net documentation](https://xunit.net/)
- Vladimir Khorikov, *Unit Testing Principles, Practices, and Patterns*: the best modern book on the topic.
- Roy Osherove, *The Art of Unit Testing* (3rd ed.).
- [NSubstitute docs](https://nsubstitute.github.io/) · [Stryker.NET](https://stryker-mutator.io/docs/stryker-net/introduction/)

## Verify this chapter

No test framework or mocking library is needed for these checks — they use plain BCL types (`TimeProvider` is built into .NET 8+) and hand-written stand-ins for a stub and a spy, so the stub-vs-mock distinction and the rounding claim can be verified directly. Save as `Program.cs` in a new console project (`dotnet new console`) and run with `dotnet run`.

```csharp
// Verifies claims from this chapter: decimal rounding uses banker's rounding (matches the
// chapter's RoundingCases table), the stub-vs-mock distinction (state verification vs behaviour
// verification), and that injecting a TimeProvider makes time-dependent code deterministic in tests.
using System;

int fails = 0;
void Ok(string s) => Console.WriteLine($"OK: {s}");
void Check(bool cond, string s)
{
    if (cond) Ok(s);
    else { Console.WriteLine($"FAIL: {s}"); fails++; }
}

// --- "RoundsToTwoDecimals_BankersRounding" from the chapter's TheoryData ---
Check(Math.Round(1.005m, 2) == 1.00m, "decimal Math.Round uses banker's rounding: 1.005 rounds to 1.00 (down to the even digit)");
Check(Math.Round(1.015m, 2) == 1.02m, "decimal Math.Round uses banker's rounding: 1.015 rounds to 1.02 (up to the even digit)");
Check(Math.Round(2.345m, 2) == 2.34m, "decimal Math.Round uses banker's rounding: 2.345 rounds to 2.34 (down to the even digit)");

// --- Stub: feeds a canned answer; you assert on the RESULT, not on whether it was called a certain way ---
var stubGateway = new StubPaymentGateway(declineReason: "insufficient_funds");
var handler = new PlaceOrderHandler(stubGateway);
var result = handler.Handle(100m);
Check(result == "declined: insufficient_funds", "Stub: a canned answer drives the handler's result (state verification)");

// --- Spy: records how it was called, so you can assert the INTERACTION happened ---
var spyGateway = new SpyPaymentGateway();
new PlaceOrderHandler(spyGateway).Handle(50m);
Check(spyGateway.ChargeCalls.Count == 1 && spyGateway.ChargeCalls[0] == 50m, "Spy: records the call it received, so a test can assert the interaction happened (behaviour verification)");

// --- Injecting TimeProvider instead of calling DateTime.UtcNow makes a test deterministic ---
var clock = new SettableTimeProvider(new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero));
var sub = new Subscription(clock, endsAt: clock.GetUtcNow().AddDays(1));
Check(!sub.IsExpired(), "TimeProvider: subscription is not expired right after creation");
clock.Advance(TimeSpan.FromDays(2));
Check(sub.IsExpired(), "TimeProvider: advancing the fake clock deterministically makes the same subscription expire, with no real waiting");

Console.WriteLine(fails == 0 ? "\nAll checks passed." : $"\n{fails} check(s) failed.");
if (fails > 0) Environment.Exit(1);

interface IPaymentGateway { string Charge(decimal amount); }

sealed class StubPaymentGateway(string declineReason) : IPaymentGateway
{
    public string Charge(decimal amount) => $"declined: {declineReason}";
}

sealed class SpyPaymentGateway : IPaymentGateway
{
    public List<decimal> ChargeCalls { get; } = new();
    public string Charge(decimal amount) { ChargeCalls.Add(amount); return "charged"; }
}

sealed class PlaceOrderHandler(IPaymentGateway gateway)
{
    public string Handle(decimal amount) => gateway.Charge(amount);
}

sealed class SettableTimeProvider(DateTimeOffset start) : TimeProvider
{
    private DateTimeOffset _now = start;
    public override DateTimeOffset GetUtcNow() => _now;
    public void Advance(TimeSpan by) => _now += by;
}

sealed class Subscription(TimeProvider clock, DateTimeOffset endsAt)
{
    public bool IsExpired() => endsAt < clock.GetUtcNow();
}
```
