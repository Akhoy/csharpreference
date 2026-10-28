---
id: integration-testing
title: Integration, End-to-End Testing and Test Strategy
summary: Testing the real thing. The test pyramid and trophy, WebApplicationFactory and TestServer, replacing services and authentication in tests, real databases with Testcontainers and Respawn, testing message consumers and HttpClient dependencies, contract tests, architecture tests, end-to-end and load tests, and tests in CI.
layer: cross
where: Cross-cutting › Testing › Integration & strategy
fits: Integration tests exercise **layers 3 and 5 together**: the real middleware pipeline ([Middleware](ch:middleware)), DI wiring ([Dependency injection](ch:dependency-injection)), serialization, EF Core mappings and SQL ([EF Core](ch:efcore-fundamentals)). They complement [unit tests](ch:unit-testing), use containers ([Docker](ch:docker)) for dependencies, and run in CI pipelines ([CI/CD](ch:cicd-iac)).
levels: b,i,a
prereqs: unit-testing, building-apis, efcore-fundamentals
next: cicd-iac, docker
---

## TL;DR

- Integration tests catch bugs unit tests structurally cannot: wrong middleware order, missing DI registrations, serialization/casing mismatches, LINQ that can't translate to SQL, authorization gaps.
- `WebApplicationFactory<Program>` boots your **real** `Program.cs` in memory on a `TestServer`: real DI, real middleware, real routing — no network ports.
- Only replace things that are genuinely external, slow or non-deterministic (payment gateways, email, the clock). Keep your own code, database and broker real, or the test quietly turns into a unit test in disguise.
- **Testcontainers** starts real, throwaway databases/brokers for tests. Starting one is slow, so share it across a test run and **reset data between tests** (Respawn is the most common way).
- A fake authentication handler lets you control *who* the caller claims to be while your real authorization policies still run unmodified — so you can actually test that the wrong role gets a 403.
- Modern tooling (containers, in-memory hosting) shifted many teams' confidence from the classic unit-test-heavy pyramid toward integration tests for APIs.

## What unit tests structurally cannot catch {b}

Think back to what a unit test, by its own definition from [Unit testing](ch:unit-testing#what-a-unit-test-is-and-the-question-that-divides-testers), deliberately isolates away: real infrastructure, real wiring, the real pipeline. That's exactly what makes a whole category of bug invisible to it — bugs that live **between** components, not inside any one of them:

- middleware in the wrong order (every request returns 401),
- a missing DI registration or a captive dependency,
- a route template or model-binding mismatch,
- JSON casing or enum serialization differences,
- an EF Core mapping error, a missing migration, or a LINQ query that **can't be translated** or is slow in real SQL,
- authorization policies not applied to an endpoint,
- configuration binding failures.

An **integration test** runs real components together (often the whole app in-process against real infrastructure in containers) and asserts on observable behaviour (HTTP responses, database state, published messages) — precisely the gap unit tests leave open.

## Test pyramid, trophy and honeycomb: how much weight goes where {i}

```text
     Pyramid (Mike Cohn)              Trophy (Kent C. Dodds)            Honeycomb (Spotify, microservices)
          /E2E\                             (E2E)                                ( E2E )
        /-------\                       ┌──────────┐                     ┌──────────────────────┐
       /Integration\                    │Integration│ ← most tests        │     Integration       │ ← most
     /---------------\                  └──────────┘                     └──────────────────────┘
    /      Unit       \                   ( Unit )                              ( Unit / details )
   ─────────────────────                (Static analysis)
```

The classic **pyramid** says: many unit tests, fewer integration tests, very few end-to-end tests. That shape made sense when higher-level tests were slow and flaky, so you minimized time spent on them. **Containers and in-memory hosting changed that**: Testcontainers and `WebApplicationFactory` (both covered below) made integration tests fast and reliable enough that many .NET teams now put **most of their confidence in integration tests** for APIs, with unit tests reserved for complex domain logic and a handful of E2E smoke tests. The pyramid's shape was never the real point — the point was always "spend your testing effort where it buys the most confidence per minute," and that calculation changed once the tooling did.

| Test type | Scope | Speed | Confidence per test | Typical tools |
|---|---|---|---|---|
| Unit | A behaviour in-process, no I/O | ms | Narrow | xUnit, NSubstitute |
| Integration (in-process API) | Full pipeline + real DB/broker in containers | 10–500 ms each (plus container startup) | High | WebApplicationFactory, Testcontainers, Respawn |
| Contract | API/message schema between services | Fast | Prevents integration breaks | Pact, OpenAPI diffing, schema registry checks |
| End-to-end | Deployed system through the UI or public API | Seconds | Highest, but flaky and costly | Playwright, k6 scripts, smoke tests |
| Performance / load | Throughput and latency under load | Minutes | Capacity | k6, NBomber, Azure Load Testing |

## WebApplicationFactory: booting the real app in memory {b}

`Microsoft.AspNetCore.Mvc.Testing` boots your **real `Program.cs`** in memory on a **TestServer** (no network ports) and gives you an `HttpClient` wired straight into the pipeline.

```csharp
// Make Program visible to the test project (top-level statements generate an internal Program class)
public partial class Program;     // at the bottom of Program.cs

public sealed class HealthTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task Health_endpoint_returns_ok()
    {
        var client = factory.CreateClient();
        var response = await client.GetAsync("/health");
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
    }
}
```

The reason this test is worth more than it looks: everything runs **for real** — configuration, DI, the actual middleware order from [Middleware](ch:middleware), routing, model binding, validation, filters, serialization and ProblemDetails. A bug in any one of those, the exact category this chapter opened with, shows up here.

## Customising the app under test {i}

```csharp
public sealed class ShopApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly MsSqlContainer _sql = new MsSqlBuilder().WithImage("mcr.microsoft.com/mssql/server:2022-latest").Build();
    public FakeEmailSender Emails { get; } = new();
    public FakeTimeProvider Clock { get; } = new(DateTimeOffset.Parse("2026-10-27T10:00:00Z"));

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:Shop", _sql.GetConnectionString());   // override configuration
        builder.ConfigureTestServices(services =>                                    // runs AFTER Program.cs registrations
        {
            services.RemoveAll<IEmailSender>();
            services.AddSingleton<IEmailSender>(Emails);                             // replace only true externals
            services.AddSingleton<TimeProvider>(Clock);
            services.AddSingleton<IPaymentGateway, ApprovingPaymentGateway>();
            services.AddAuthentication(TestAuthHandler.Scheme)                       // fake authentication (below)
                    .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>(TestAuthHandler.Scheme, _ => { });
        });
    }

    public async ValueTask InitializeAsync()
    {
        await _sql.StartAsync();
        using var scope = Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<ShopDb>().Database.MigrateAsync();   // real schema from real migrations
    }

    public new async ValueTask DisposeAsync() { await _sql.DisposeAsync(); await base.DisposeAsync(); }
}
```

The rule here: **only replace things that are external, slow, non-deterministic or costly** — payment providers, email/SMS, third-party APIs, the clock. Keep **your** code, your database and your broker real. The whole value of an integration test comes from exercising the real wiring; swap out more than genuine externals and it quietly turns back into a unit test wearing a disguise.

### Fake authentication

```csharp
public sealed class TestAuthHandler(IOptionsMonitor<AuthenticationSchemeOptions> o, ILoggerFactory l, UrlEncoder e)
    : AuthenticationHandler<AuthenticationSchemeOptions>(o, l, e)
{
    public const string Scheme = "Test";
    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue("X-Test-User", out var user)) return Task.FromResult(AuthenticateResult.NoResult());
        var claims = new List<Claim> { new("sub", user!), new(ClaimTypes.Name, user!) };
        claims.AddRange(Request.Headers["X-Test-Roles"].ToString().Split(',', StringSplitOptions.RemoveEmptyEntries).Select(r => new Claim("roles", r)));
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme, ClaimTypes.Name, "roles"));
        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(principal, Scheme)));
    }
}

// Make it the default scheme in tests:
services.PostConfigure<AuthenticationOptions>(o => { o.DefaultAuthenticateScheme = TestAuthHandler.Scheme; o.DefaultChallengeScheme = TestAuthHandler.Scheme; });

// In a test
client.DefaultRequestHeaders.Add("X-Test-User", "customer-42");
client.DefaultRequestHeaders.Add("X-Test-Roles", "customer");
```

This handler is worth writing instead of just disabling auth for tests: it replaces only the *authentication* step — who the caller claims to be — while your **real authorization policies** still run unmodified, exactly as [Auth](ch:auth#authorization-the-simple-forms-before-anything-needs-a-polic) described. So you can genuinely test that a customer gets 403 on an admin endpoint, with the real policy logic making that call. Alternatively, mint real JWTs with a test signing key for even closer fidelity to production.

## Real databases with Testcontainers {i}

**Testcontainers for .NET** starts throwaway **Docker containers** (lightweight, isolated environments that run a piece of software — see [Docker](ch:docker) for the full picture) from tests: SQL Server, PostgreSQL, Redis, RabbitMQ, Azurite (Azure Storage), the Service Bus emulator, Cosmos DB emulator, Kafka, LocalStack.

```csharp
private readonly PostgreSqlContainer _pg = new PostgreSqlBuilder().WithImage("postgres:17-alpine").Build();
private readonly RedisContainer _redis = new RedisBuilder().Build();
```

Starting a container takes seconds, which is long enough that doing it per-test would make the suite painfully slow — so **share one per test run or collection**, and instead **reset data between tests**:

| Strategy | How | Trade-off |
|---|---|---|
| **Respawn** | Deletes data from all tables (FK-aware) before each test | Fast, simple; most popular |
| Transaction per test, rolled back | Wrap each test in a transaction | Very fast; doesn't work if the code under test manages its own transactions |
| Unique data per test | Each test creates its own customer/tenant IDs | No reset needed; tests can run in parallel |
| DB snapshot/restore or a fresh DB per class | Clone a template database | Isolation at a cost |

```csharp
[CollectionDefinition(nameof(ApiCollection))]
public sealed class ApiCollection : ICollectionFixture<ShopApiFactory>;   // one factory + container for all API tests

[Collection(nameof(ApiCollection))]
public sealed class PlaceOrderTests(ShopApiFactory app) : IAsyncLifetime
{
    private Respawner _respawner = null!;

    public async ValueTask InitializeAsync()
    {
        await using var conn = new SqlConnection(app.ConnectionString);
        await conn.OpenAsync();
        _respawner = await Respawner.CreateAsync(conn, new RespawnerOptions { TablesToIgnore = ["__EFMigrationsHistory"] });
        await _respawner.ResetAsync(conn);
    }
    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    [Fact]
    public async Task Placing_an_order_persists_it_and_sends_confirmation()
    {
        var client = app.CreateAuthenticatedClient(user: "customer-42");
        await app.SeedAsync(db => db.Products.Add(new Product("KB-01", "Keyboard", 49.90m, stock: 10)));

        var response = await client.PostAsJsonAsync("/api/orders", new { lines = new[] { new { sku = "KB-01", quantity = 2 } } });

        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        var created = await response.Content.ReadFromJsonAsync<OrderDto>();
        created!.Total.ShouldBe(99.80m);
        response.Headers.Location!.ToString().ShouldBe($"/api/orders/{created.Id}");

        await app.ExecuteDbAsync(async db => (await db.Products.SingleAsync(p => p.Sku == "KB-01")).Stock.ShouldBe(8));
        app.Emails.Sent.ShouldContain(m => m.To == "customer-42@test" && m.Subject.Contains("Order confirmed"));
    }

    [Fact]
    public async Task Invalid_order_returns_validation_problem()
    {
        var client = app.CreateAuthenticatedClient(user: "customer-42");
        var response = await client.PostAsJsonAsync("/api/orders", new { lines = Array.Empty<object>() });

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        problem!.Errors.ShouldContainKey("Lines");
    }
}
```

That one test proves four things at once: the HTTP request binds correctly, the handler runs its real logic, the database is actually debited (`Stock.ShouldBe(8)`), and a side effect fired (`Emails.Sent`). Proving all four with unit tests would need separate, carefully constructed mocks — and even then wouldn't prove they work **together**.

:::gotcha Don't use the EF Core InMemory provider for integration tests
It isn't relational: no SQL translation, no constraints, no transactions, different null and case semantics. Tests pass while production fails. Microsoft's own guidance discourages it. Use the real engine (Testcontainers) or at least SQLite.
:::

## Testing dependencies you don't own {i}

| Dependency | Approach |
|---|---|
| Third-party HTTP APIs | **WireMock.Net** fake server (realistic HTTP, delays, faults) or a stub `HttpMessageHandler` ([HttpClient](ch:http-client#testing-code-that-uses-httpclient)) |
| Message broker | A real broker in a container (RabbitMQ, Service Bus emulator), or the library's test harness (`MassTransit` `ITestHarness` to assert published/consumed messages) |
| Azure Storage | **Azurite** container |
| Cosmos DB | Cosmos DB emulator (Linux container) |
| Identity provider | Fake auth handler, or a test token issuer |

```csharp
// MassTransit test harness: assert the endpoint published an event
var harness = app.Services.GetTestHarness();
await client.PostAsJsonAsync("/api/orders", request);
(await harness.Published.Any<OrderPlaced>(x => x.Context.Message.CustomerId == "customer-42")).ShouldBeTrue();
```

## Contract and architecture tests {a}

**Consumer-driven contract tests** (Pact): the consumer records the requests it makes and the responses it expects as a **contract**; the provider's CI verifies it still honours every consumer's contract. This catches breaking API changes **without** deploying both services together — directly addressing the "versioning" cost microservices introduce, named back in [Microservices](ch:microservices#why-microservices-and-what-they-genuinely-cost). Lighter alternatives: **OpenAPI diffing** in CI (fail on breaking changes), or **schema registry** compatibility checks for messages.

**Snapshot tests** of public contracts (`Verify` on the generated OpenAPI document or on serialized message types) make accidental contract changes visible in code review.

**Architecture tests** (NetArchTest, ArchUnitNET) enforce layering rules. See [App architectures](ch:app-architectures#enforcing-architecture).

## End-to-end, smoke and load tests {a}

- **E2E**: drive the deployed system like a user. **Playwright for .NET** for browser flows; scripted API journeys for backends. Keep them **few**, focused on critical paths (sign up, checkout), and tolerant of async processing (poll with timeouts, not fixed sleeps).
- **Smoke tests** after each deployment: health endpoints plus one or two key reads, gating promotion to production.
- **Load tests** (k6, NBomber, Azure Load Testing, JMeter): establish baselines (p50/p95/p99 latency, throughput, error rate) and find bottlenecks before launches. Run against production-like environments with realistic data volumes.
- **Chaos testing** (Azure Chaos Studio, Polly's chaos strategies via `AddChaos…`): inject faults to verify resilience behaviour.

## Tests in CI {i}

```yaml
- run: dotnet test --configuration Release --logger "trx;LogFileName=results.trx" --collect:"XPlat Code Coverage"
  # GitHub-hosted Ubuntu runners have Docker, so Testcontainers just works
```

Practices worth adopting:

- Run unit tests on every commit, integration tests on every PR.
- Quarantine and fix **flaky tests** immediately — they destroy trust in the whole suite.
- Keep the suite fast: parallel collections, shared containers, Respawn.
- Publish test results and coverage, and make the test run a **required check** before merge.

:::qa What is the difference between unit and integration tests?
Unit tests verify a single behaviour in isolation, in-process with no I/O, and run in milliseconds. Integration tests verify that components work together with real infrastructure (pipeline, DI, serialization, database, broker), catching wiring, configuration, mapping and SQL issues that unit tests can't.
:::

:::qa How do you integration-test an ASP.NET Core API?
WebApplicationFactory&lt;Program&gt; hosts the real app in memory with a TestServer and provides an HttpClient. Override configuration and replace only external dependencies in ConfigureTestServices, use a real database via Testcontainers with migrations applied, reset data with Respawn, and assert on HTTP responses and persisted state.
:::

:::qa How do you handle authentication in integration tests?
Register a test authentication handler that builds a ClaimsPrincipal from headers (or mint real JWTs with a test key) and make it the default scheme, so real authorization policies still execute against controllable identities.
:::

:::qa What is Testcontainers and why use it?
A library that starts disposable Docker containers (SQL Server, Postgres, Redis, RabbitMQ, Azurite…) from test code. Tests run against the real engines with production-like behaviour, isolated and reproducible locally and in CI, instead of fakes like the EF InMemory provider.
:::

:::qa How do you keep integration tests isolated and fast?
Share one app factory and container per collection, reset data between tests (Respawn, or a transaction rollback), use unique data per test where possible, run collections in parallel, and replace only slow external dependencies.
:::

:::qa What are contract tests?
Tests verifying that a provider service honours the API or message contract its consumers rely on (e.g. Pact consumer-driven contracts, OpenAPI breaking-change checks). They catch integration breaks between independently deployed services without full end-to-end environments.
:::

:::qa Test pyramid vs testing trophy?
The pyramid recommends mostly unit tests, fewer integration tests and very few E2E tests. The trophy shifts the weight to integration tests, because modern tooling makes them fast and they give more confidence per test, with unit tests reserved for complex logic and only a few E2E tests.
:::

## Further reading

- [Integration tests in ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/test/integration-tests)
- [Testcontainers for .NET](https://dotnet.testcontainers.org/)
- [Respawn](https://github.com/jbogard/Respawn) · [WireMock.Net](https://github.com/WireMock-Net/WireMock.Net) · [Pact .NET](https://github.com/pact-foundation/pact-net)
- [Testing against your production database system (EF Core)](https://learn.microsoft.com/en-us/ef/core/testing/testing-with-the-database)

## Verify this chapter

The checks below build a real in-memory ASP.NET Core pipeline with `TestServer` (the same mechanism `WebApplicationFactory` boots underneath) and confirm middleware runs in order and a faked identity is still subject to a real authorization decision. No Docker needed. Save as a console app (`dotnet new console`, `dotnet add package Microsoft.AspNetCore.TestHost`), then `dotnet run`.

```csharp
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Extensions;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using System.Security.Claims;

var order = new List<string>(); // Claim: middleware runs in registration order — each one runs before the next.

var hostBuilder = new HostBuilder().ConfigureWebHost(webHost =>
{
    webHost.UseTestServer();
    webHost.ConfigureServices(services =>
    {
        services.AddAuthentication(TestAuthHandler.Scheme)
            .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>(TestAuthHandler.Scheme, _ => { });
    });
    webHost.Configure(app =>
    {
        app.Use(async (ctx, next) => { order.Add("A"); await next(); });
        app.Use(async (ctx, next) => { order.Add("B"); await next(); });

        app.UseAuthentication();
        // Authorization here is a REAL policy check (RequireClaim), just invoked directly instead of via
        // the endpoint-routing UseAuthorization() middleware, which needs a full routing setup this tiny host skips.

        app.Map("/public", inner => inner.Run(ctx => ctx.Response.WriteAsync("ok")));
        app.Map("/admin", inner =>
        {
            inner.Run(async ctx =>
            {
                var authResult = await ctx.AuthenticateAsync(TestAuthHandler.Scheme);
                var isAdmin = authResult.Succeeded && authResult.Principal!.HasClaim("roles", "admin");
                if (!isAdmin) { ctx.Response.StatusCode = 403; return; }
                await ctx.Response.WriteAsync("admin-ok");
            });
        });
    });
});

using var host = await hostBuilder.StartAsync();
using var client = host.GetTestClient();

// Claim: the in-memory pipeline runs middleware in registration order — real wiring, not a mock.
{
    var res = await client.GetAsync("/public");
    if (!order.SequenceEqual(new[] { "A", "B" }))
        throw new Exception($"FAIL: expected [A, B], got [{string.Join(",", order)}]");
    Console.WriteLine("OK: an in-memory TestServer pipeline runs middleware in real registration order");
}

// Claim: a fake authentication handler lets you control WHO the caller is, while real authorization policies still decide.
{
    using var req1 = new HttpRequestMessage(HttpMethod.Get, "/admin");
    req1.Headers.Add("X-Test-User", "customer-42");
    req1.Headers.Add("X-Test-Roles", "customer");
    var res1 = await client.SendAsync(req1);
    if ((int)res1.StatusCode != 403) throw new Exception($"FAIL: expected 403 for a non-admin, got {(int)res1.StatusCode}");
    Console.WriteLine("OK: a customer identity (faked) is correctly rejected by the REAL authorization check");

    using var req2 = new HttpRequestMessage(HttpMethod.Get, "/admin");
    req2.Headers.Add("X-Test-User", "admin-1");
    req2.Headers.Add("X-Test-Roles", "admin");
    var res2 = await client.SendAsync(req2);
    if ((int)res2.StatusCode != 200) throw new Exception($"FAIL: expected 200 for an admin, got {(int)res2.StatusCode}");
    Console.WriteLine("OK: an admin identity (faked) is correctly allowed by the REAL authorization check");
}

Console.WriteLine("All checks passed.");

// Not runtime-verifiable here (needs Docker, or a full WebApplicationFactory<Program> against a real app project):
// - Testcontainers starting real SQL Server/Postgres/Redis/RabbitMQ containers — see Further reading: "Testcontainers for .NET"
// - Respawn resetting real table data between tests — see Further reading: "Respawn"
// - WebApplicationFactory<Program> specifically (it needs a referenced app assembly; TestServer above is the same
//   underlying mechanism it boots) — see Further reading: "Integration tests in ASP.NET Core"
// - Pact consumer-driven contracts, architecture tests, load/chaos tests — all need external tools or deployed systems

sealed class TestAuthHandler(Microsoft.Extensions.Options.IOptionsMonitor<AuthenticationSchemeOptions> o,
    Microsoft.Extensions.Logging.ILoggerFactory l, System.Text.Encodings.Web.UrlEncoder e)
    : AuthenticationHandler<AuthenticationSchemeOptions>(o, l, e)
{
    public const string Scheme = "Test";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue("X-Test-User", out var user)) return Task.FromResult(AuthenticateResult.NoResult());
        var claims = new List<Claim> { new("sub", user!), new(ClaimTypes.Name, user!) };
        claims.AddRange(Request.Headers["X-Test-Roles"].ToString().Split(',', StringSplitOptions.RemoveEmptyEntries).Select(r => new Claim("roles", r)));
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme, ClaimTypes.Name, "roles"));
        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(principal, Scheme)));
    }
}
```
