---
id: dependency-injection
title: Dependency Injection in Depth
summary: The single most-asked ASP.NET Core topic. What DI is and why, the container, registering services, the three lifetimes and scopes, captive dependencies, factories, multiple implementations, keyed services, open generics, decorators, disposal, and the anti-patterns.
layer: framework
where: ASP.NET Core › Hosting › Dependency injection container
fits: DI is the **wiring of layer 3**. It's provided by `Microsoft.Extensions.DependencyInjection` and used by every other chapter: middleware, endpoints, EF Core's DbContext, HttpClient, options, hosted services. It's also how architectural layering ([App architectures](ch:app-architectures)) becomes real at runtime, because the composition root in Program.cs connects the interfaces in your inner layers to implementations in outer layers.
levels: b,i,a
prereqs: oop, generics, aspnet-hosting
next: configuration-options, middleware, design-principles
---

## TL;DR

- DI means a class declares what it needs in its constructor instead of creating those things itself — a **container** builds and wires everything for you.
- Three lifetimes: **Transient** (new every time), **Scoped** (one per request), **Singleton** (one for the app's entire life). Pick based on whether the service holds per-request state or needs to be safely shared forever.
- A **captive dependency** — a singleton accidentally holding onto a scoped service, like a `DbContext` — is the single most common DI bug. `ValidateScopes` catches it at startup instead of in production.
- Outside a request (background jobs, startup code) there's no scope automatically; create one yourself with `IServiceScopeFactory`.
- `Program.cs` is the **composition root** — the one place that should know about concrete types. Everywhere else should depend only on interfaces.

## Start with the version that goes wrong {b}

```csharp
// Without DI: OrderService creates its own dependencies
public class OrderService
{
    private readonly SqlOrderRepository _repo = new SqlOrderRepository("Server=prod;...");
    private readonly SmtpEmailSender _email = new SmtpEmailSender("smtp.company.com");

    public void Place(Order o) { _repo.Save(o); _email.Send(o.CustomerEmail, "Thanks!"); }
}
```

This looks completely normal, and plenty of real code looks exactly like it. So let's actually interrogate it, line by line, instead of just accepting "DI is good practice" on faith.

- **It's welded to specific technologies.** `OrderService` doesn't just use a database and an email provider — it *creates* a SQL-specific repository and an SMTP-specific sender itself. Switching to Postgres or SendGrid later means editing `OrderService` directly, even though neither of those is really `OrderService`'s job.
- **You cannot test this class in isolation.** Write a unit test for `Place`, and you will hit a real database and send a real email — every single time, in every single test run. There's no way around it, because the dependencies are hard-coded inside the method.
- **A connection string is sitting inside a business class.** That configuration detail has nothing to do with "placing an order" conceptually, yet here it is, buried in the one place you'd least want to go looking for it.
- **Nobody owns the lifetime of these objects.** Who disposes the SQL connection? Is it safe to share `_repo` across two requests running at once? Nothing here answers that — it's just left as an open question for whoever reads this later.

Four real, concrete problems, all stemming from one root cause: `OrderService` is responsible for *deciding* what talks to SQL and SMTP, on top of its actual job of placing an order. Now look at the fix:

```csharp
// With DI: dependencies are given to the class ("injected")
public class OrderService(IOrderRepository repo, IEmailSender email)
{
    public async Task PlaceAsync(Order o, CancellationToken ct)
    {
        await repo.SaveAsync(o, ct);
        await email.SendAsync(o.CustomerEmail, "Thanks!", ct);
    }
}
```

Notice what actually changed: `OrderService` no longer creates *anything*. It just declares, through its constructor, what it needs — an `IOrderRepository`, an `IEmailSender` — and trusts that something else will hand it working instances. That "something else" is the **container**, and the technique of handing dependencies to a class from outside, instead of letting it construct them itself, is **dependency injection**. In a test, you simply hand `OrderService` fakes instead of real implementations, and all four problems above disappear at once — not because you fixed them individually, but because the thing causing all of them is gone.

:::fits Three terms that get used almost interchangeably, and shouldn't be
- **Dependency Inversion Principle (DIP)** — the "D" in SOLID — is the *design rule*: high-level code should depend on abstractions, not on concrete low-level classes.
- **Inversion of Control (IoC)** is the *general idea* behind that rule in practice: the framework calls your code and controls when objects get created, instead of your code doing it and calling the framework.
- **Dependency Injection (DI)** is the specific *technique* that implements IoC for dependencies: passing them in, usually through a constructor. The **DI container** (also called an IoC container) is the piece of software that automates doing this for an entire app.
:::

## What the container is actually doing {b}

Once `OrderService` declares what it needs instead of creating it, *something* has to supply those dependencies at runtime. That something is a three-step pipeline, and understanding the three steps as separate moments — not one blurred-together thing — is what makes the rest of this chapter click:

```text
IServiceCollection  ──Build()──▶  IServiceProvider  ──GetService<T>()──▶ instances
 (list of recipes:                (the container:                          (constructed with
  "for IX, use X,                  knows how to build                       all their
  with lifetime L")                each type & caches by lifetime)           dependencies)
```

```csharp
builder.Services.AddScoped<IOrderRepository, EfOrderRepository>();   // recipe
builder.Services.AddScoped<IEmailSender, SendGridEmailSender>();
builder.Services.AddScoped<OrderService>();                           // concrete type registered as itself

var app = builder.Build();                                            // container built

app.MapPost("/orders", (Order o, OrderService svc, CancellationToken ct) => svc.PlaceAsync(o, ct));
// ASP.NET Core resolves OrderService from the request scope. The container sees its constructor needs
// IOrderRepository and IEmailSender, resolves those (and THEIR dependencies, recursively), then constructs it.
```

Step one — **registration** — just builds up a list of recipes: "if anyone asks for `IOrderRepository`, give them an `EfOrderRepository`." Nothing is constructed yet; `builder.Services` is only a plan. Step two — `builder.Build()` — locks that plan in and turns it into a real `IServiceProvider`, the actual machine capable of constructing things. Step three happens every time something asks for an instance: the container looks at what `OrderService`'s constructor needs, resolves each of *those* dependencies first (recursing into theirs, if they have any), and only then constructs `OrderService` itself, fully wired up. You never call `new OrderService(...)` anywhere in your code — the container does, and it works out the whole dependency graph for you, automatically, every single time.

**Constructor injection**, what you've just seen, is the normal, overwhelmingly common case — the container picks whichever constructor has the most parameters it's able to satisfy. But it isn't the only place services get handed to your code:

| Where | How |
|---|---|
| Constructors | Normal case (including primary constructors) |
| Minimal API handler parameters | Services are inferred from DI (`[FromServices]` optional) |
| Controller action parameters | `[FromServices] IFoo foo` |
| Middleware `InvokeAsync` parameters | Resolved per request (use this for scoped services) |
| Razor views/components | `@inject IFoo Foo` |
| Manually | `app.Services.GetRequiredService<T>()`, `HttpContext.RequestServices` (avoid in business code) |

## Service lifetimes: the question the container has to answer every time {b}

Here's a question you might not have thought to ask yet: when two different parts of your code both ask for `IEmailSender`, does the container build a brand-new one each time, or hand back the same instance twice? The answer is: **it depends on how you registered it** — and that choice is called the service's **lifetime**.

| Lifetime | Register with | One instance per… | Disposed when | Typical services |
|---|---|---|---|---|
| **Transient** | `AddTransient` | **every resolution** | The scope that resolved it ends | Lightweight, stateless helpers, validators, mappers |
| **Scoped** | `AddScoped` | **scope**, which is one per **HTTP request** in ASP.NET Core | The scope (request) ends | `DbContext`, unit of work, repositories, request-specific services (current user, tenant) |
| **Singleton** | `AddSingleton` | **application** (root container) | App shutdown | Caches, configuration objects, `HttpClient` handlers, `IConnectionMultiplexer` (Redis), clocks, expensive-to-create thread-safe objects |

The clearest way to actually feel the difference is to watch one tiny service resolved under all three lifetimes:

```csharp
public class GuidService { public Guid Id { get; } = Guid.NewGuid(); }

// Within ONE request, resolving it in two places gives:
//   Transient → two different Ids
//   Scoped    → the same Id (within this request), different across requests
//   Singleton → the same Id for every request, forever
```

Read that comment slowly, because it's really showing you three completely different answers to the same question — "is this the same object as last time?" — and all three are correct, for their own lifetime. **Transient** never remembers anything; it's rebuilt fresh, every single time, no exceptions. **Scoped** remembers *within* one unit of work (a request) but forgets between them — resolve it twice in the same request and you get the identical instance, resolve it in the next request and it's a new one. **Singleton** never forgets, ever, for the life of the entire process.

:::analogy Lifetimes as a hotel
**Singleton** is the hotel building itself: one building, shared by every single guest, for as long as the hotel exists. **Scoped** is your room: it's yours for the length of your stay, and then it gets cleaned and handed to the next guest — a different room, in effect, even though the physical room might be reused. **Transient** is a towel: you get a fresh one every single time you ask, no matter how many times, in the same stay or different ones.
:::

### So which one do you actually pick?

In order, ask yourself these three questions, and stop at the first one that answers it:

1. **Does it hold per-request state, or does it depend on something that's scoped (like a `DbContext`)?** → Scoped.
2. **Is it stateless — or is whatever state it holds genuinely safe to share across every thread at once — and relatively expensive to build?** → Singleton. (And it genuinely **must** be thread-safe if you choose this; see [Threading](ch:threading-concurrency#race-conditions-when-it-depends-on-timing-becomes-a-bug) for exactly what that means and what breaks if it isn't.)
3. **Cheap, stateless, used briefly?** → Transient — though in practice, the difference between transient and scoped rarely matters for something this simple.

When none of that gives you a confident answer, **scoped** is the safe default for application services in a web app — it's the one lifetime that can never accidentally outlive the request it's working on.

## Scopes, made concrete {i}

You've been told "scoped means one instance per scope" several times now — but what, physically, *is* a scope? It's a **child container**: a smaller `IServiceProvider` nested inside the main one, with its own private cache of scoped instances, that gets thrown away (and everything disposable inside it disposed) as one unit when it ends.

**ASP.NET Core creates exactly one scope per HTTP request**, automatically, via middleware near the very start of the pipeline. It exposes that scope as `HttpContext.RequestServices`. Every service resolved anywhere during the request — your handler, any middleware after that point, anything they call into — pulls from that one scope. That's the entire mechanism behind "scoped = one per request": scoped services don't know anything special about HTTP requests. There's just one scope created per request, and scoped services are cached per scope.

Here's the detail that catches people out: **outside of a request, there is no scope, unless you explicitly create one.** A background service, startup code, a message consumer — none of these are running inside an HTTP request, so none of them have a scope handed to them automatically. If any of that code needs a scoped service, like `DbContext`, it has to ask for a fresh scope itself:

```csharp
public class NightlyCleanup(IServiceScopeFactory scopeFactory, ILogger<NightlyCleanup> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromHours(24));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await using var scope = scopeFactory.CreateAsyncScope();     // one scope per unit of work
            var db = scope.ServiceProvider.GetRequiredService<ShopDb>();  // fresh DbContext
            var removed = await db.Carts.Where(c => c.UpdatedAt < DateTime.UtcNow.AddDays(-30)).ExecuteDeleteAsync(stoppingToken);
            log.LogInformation("Removed {Count} stale carts", removed);
        }                                                                  // scope disposed → DbContext disposed
    }
}

// At startup (e.g. migrations/seeding in development)
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<ShopDb>();
    await db.Database.MigrateAsync();
}
```

Notice the pattern: `NightlyCleanup` itself is a long-lived singleton (hosted services always are), but every time it has actual work to do, it creates a *brand-new, short-lived* scope just for that one unit of work, uses it, and disposes it. That's the correct shape for mixing a long-lived component with scoped dependencies — and getting that shape wrong is exactly what the next section is about.

## The captive dependency: the single most common DI bug {i}

Here's a rule worth memorising exactly, because almost every tricky DI bug you'll ever debug traces back to breaking it: **a service must never depend on a service with a shorter lifetime than its own.**

```text
Singleton  ──depends on──▶  Scoped      ✘ captive dependency
Singleton  ──depends on──▶  Transient   ✘ (the transient is effectively a singleton)
Scoped     ──depends on──▶  Transient   ✔ (fine)
Scoped     ──depends on──▶  Singleton   ✔
Transient  ──depends on──▶  anything    ✔
```

Why does this matter so much for the singleton row specifically? A singleton is constructed exactly **once** — the first time anything asks for it. Whatever gets passed into its constructor at that moment is what it's stuck with for the rest of the process's life. If one of those constructor arguments is a scoped service, the singleton doesn't get "a fresh one per request" the way scoped is supposed to work. It gets whichever instance happened to exist at that one moment, and holds onto it permanently. That's a **captive dependency**: the scoped object is taken captive by something that will never let it go.

```csharp
builder.Services.AddSingleton<PriceCache>();     // lives forever
builder.Services.AddScoped<ShopDb>();            // should live one request

public class PriceCache(ShopDb db) { }           // ✘ the FIRST request's DbContext is captured forever
```

![A singleton captures the first request's scoped DbContext and keeps it long after that request ends](visuals/captive-dependency.svg)

Walk through exactly what the diagram shows, because each step explains one real symptom you'll see in production:

1. **Request 1 arrives.** Its scope creates `ShopDb #1`. The very first time `PriceCache` is resolved — which, being a singleton, only ever happens once — it receives `ShopDb #1` through its constructor and holds that reference from now on.
2. **Request 1 finishes.** Its scope ends, and `ShopDb #1` gets disposed, exactly as a scoped service should be. But `PriceCache` is a singleton — nobody tells it anything changed, and it's still holding that same reference.
3. **Request 2 arrives.** A brand-new scope creates `ShopDb #2`, fresh and ready. But `PriceCache` was never reconstructed — it's the same singleton instance from before — so it has no idea `ShopDb #2` even exists. It's still pointing at the disposed `ShopDb #1`.

That mismatch produces three distinct, nasty symptoms, worth being able to name all three. `DbContext` isn't thread-safe, so concurrent requests sharing that one captured instance risk **"a second operation was started on this context"** errors. Nobody ever disposes and recreates it the normal way, so its change-tracker just keeps growing, quietly feeding you **stale data**. And once request 1's `using` block actually disposes it, every later access throws **`ObjectDisposedException`**. Three different-looking bugs, one single root cause.

**How do you catch this before it ships?** In Development, `ValidateScopes = true` makes the container actively check for exactly this shape and throw a clear `InvalidOperationException: Cannot consume scoped service 'ShopDb' from singleton 'PriceCache'` the moment it would happen — turning a subtle runtime bug into a loud startup failure. It's usually worth enabling everywhere, not just in Development, for the small extra startup cost:

```csharp
builder.Host.UseDefaultServiceProvider(o => { o.ValidateScopes = true; o.ValidateOnBuild = true; });
```

**The fix**, once you've found one: either make the consumer scoped too (if that's actually appropriate for what it does), or — the usual answer for something that genuinely needs to be a singleton — inject `IServiceScopeFactory` (or `IDbContextFactory<T>`) instead of the scoped service directly, and create a fresh scope or context for each individual operation, exactly the way `NightlyCleanup` did in the previous section.

## A tour of the registration API {i}

Registering a simple interface-to-implementation mapping is the common case, but the container supports several other shapes worth knowing:

```csharp
// Interface → implementation
services.AddScoped<IOrderRepository, EfOrderRepository>();

// Concrete type
services.AddSingleton<SystemClock>();

// Existing instance (always singleton; the container won't dispose it)
services.AddSingleton<IClock>(new FixedClock(DateTimeOffset.Parse("2026-01-01")));

// Factory: full control over construction (needed for primitives, conditional logic, external SDKs)
services.AddSingleton<IBlobStore>(sp =>
{
    var opts = sp.GetRequiredService<IOptions<StorageOptions>>().Value;
    return new AzureBlobStore(new BlobServiceClient(new Uri(opts.Url), new DefaultAzureCredential()));
});

// One implementation, several interfaces, same instance
services.AddSingleton<InMemoryCache>();
services.AddSingleton<ICache>(sp => sp.GetRequiredService<InMemoryCache>());
services.AddSingleton<ICacheStats>(sp => sp.GetRequiredService<InMemoryCache>());

// Try* variants: register only if not already registered (library-friendly defaults)
services.TryAddSingleton<IClock, SystemClock>();
services.TryAddEnumerable(ServiceDescriptor.Scoped<IValidator<Order>, OrderValidator>());

// Replace / remove (common in tests)
services.Replace(ServiceDescriptor.Singleton<IEmailSender, FakeEmailSender>());
services.RemoveAll<IEmailSender>();

// Open generics
services.AddScoped(typeof(IRepository<>), typeof(EfRepository<>));
```

That last one is worth a second look if you haven't seen it before: registering `IRepository<>` (the *open* generic, with no type argument filled in) against `EfRepository<>` means the container can construct `IRepository<Order>`, `IRepository<Customer>`, or `IRepository<AnyType>` on demand, all from this single line — it closes the generic with whatever type was actually asked for.

### What happens when two implementations share an interface

```csharp
services.AddScoped<INotificationChannel, EmailChannel>();
services.AddScoped<INotificationChannel, SmsChannel>();
services.AddScoped<INotificationChannel, PushChannel>();

public class Notifier(IEnumerable<INotificationChannel> channels)   // all three, in registration order
{
    public Task NotifyAllAsync(Message m) => Task.WhenAll(channels.Select(c => c.SendAsync(m)));
}

public class Other(INotificationChannel channel) { }                // gets the LAST one registered (PushChannel)
```

This is a genuinely sharp edge worth knowing about in advance: asking for `INotificationChannel` directly gives you only the **last one registered** — `PushChannel` here — silently, with no error telling you the other two exist. Asking for `IEnumerable<INotificationChannel>` instead gives you **all three**, in registration order. If you ever find a bug where "only the push notification fires", this exact mismatch is worth checking first.

### Keyed services, for picking a specific one by name

```csharp
services.AddKeyedSingleton<IPaymentGateway, StripeGateway>("stripe");
services.AddKeyedSingleton<IPaymentGateway, AdyenGateway>("adyen");

public class Checkout([FromKeyedServices("stripe")] IPaymentGateway gateway) { }

app.MapPost("/pay/{provider}", (string provider, IServiceProvider sp) =>
    sp.GetRequiredKeyedService<IPaymentGateway>(provider).ChargeAsync(...));
```

Keyed services (.NET 8) solve exactly the ambiguity the previous example ran into, when ambiguity is actually what you want: multiple implementations of the same interface, each deliberately reachable by its own name, instead of only ever getting "the last one" or "all of them".

### Keeping Program.cs readable

```csharp
public static class InfrastructureRegistration
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration config)
    {
        services.AddDbContext<ShopDb>(o => o.UseSqlServer(config.GetConnectionString("Shop")));
        services.AddScoped<IOrderRepository, EfOrderRepository>();
        services.AddScoped<IUnitOfWork>(sp => sp.GetRequiredService<ShopDb>());
        services.AddSingleton(TimeProvider.System);
        return services;
    }
}

builder.Services.AddApplication().AddInfrastructure(builder.Configuration).AddPresentation();
```

An extension method per feature or architectural layer is the convention every library in the .NET ecosystem follows, and it pays off the same way here: `Program.cs` stays a short, readable table of contents instead of a 300-line wall of registrations. `Program.cs`, as the one place where the entire object graph finally gets wired together, has a name of its own: the **composition root**. It's meant to be the *only* place in your whole codebase that knows about every concrete type — everywhere else should only ever see interfaces.

## Decorators and assembly scanning {a}

Two capabilities the built-in container deliberately leaves out, on purpose, to stay small and simple:

```csharp
// Manual decorator: wrap the real implementation
services.AddScoped<SqlProductRepository>();
services.AddScoped<IProductRepository>(sp =>
    new CachedProductRepository(sp.GetRequiredService<SqlProductRepository>(), sp.GetRequiredService<HybridCache>()));

// With the Scrutor library
services.AddScoped<IProductRepository, SqlProductRepository>();
services.Decorate<IProductRepository, CachedProductRepository>();
services.Scan(s => s.FromAssemblyOf<Program>()
    .AddClasses(c => c.AssignableTo(typeof(ICommandHandler<>)))
    .AsImplementedInterfaces()
    .WithScopedLifetime());
```

You can still build a **decorator** — a class that wraps another implementation of the same interface, adding behaviour around it — by hand, with a plain factory registration, as the first block shows. The **Scrutor** library makes both decoration and convention-based assembly scanning ("register every class that implements `ICommandHandler<>`") much less verbose, if you find yourself doing either often. Third-party containers (Autofac, Lamar, DryIoc) go further still, offering modules, interception and child containers, and can replace or sit behind the built-in one — but most modern apps genuinely don't need that extra power.

## Who disposes what {i}

- The container disposes **`IDisposable`/`IAsyncDisposable` instances it created itself**, the moment their scope ends (and singletons at app shutdown).
- It does **not** dispose instances *you* registered directly with `AddSingleton(instance)` — you created that one, you own its lifetime.
- **Transient disposables resolved directly from the root provider** (not from a scope) are tracked until the whole app shuts down. Do that repeatedly and you've built yourself a slow, steady memory leak. Resolve from a scope instead.
- As a rule: never dispose a dependency that was injected into you. If the container gave it to you, the container owns cleaning it up.

## Patterns that look reasonable and aren't {i}

| Anti-pattern | Why it hurts | Instead |
|---|---|---|
| **Service Locator**: calling `IServiceProvider.GetService` inside business classes | Hides dependencies, fails at runtime instead of startup, hard to test | Constructor injection |
| **Constructor over-injection**: 10+ dependencies | The class has too many responsibilities (SRP violation) | Split the class; group into facades or handlers |
| **Captive dependency** | Shared non-thread-safe state, stale data | Match lifetimes; scope factory |
| **Static access** (`ServiceLocator.Current`, static `HttpContext`) | Global state, untestable | Inject |
| **`BuildServiceProvider()` in Program.cs** | Duplicate singletons | Factories, options, resolve after Build |
| **Injecting `IServiceProvider` "just in case"** | Same as service locator | Inject what you need; use factories for dynamic choice |
| **Interfaces for everything** | Ceremony with no benefit for stable internal classes | Interfaces at real seams (I/O, external systems, things you mock) |
| **`async` work in constructors** | Constructors can't be async; `.Result` blocks | Factory methods, `IHostedService` startup, lazy initialisation |

The first row deserves a closer look, because "just inject `IServiceProvider` and resolve what you need inside the method" can look, at first glance, almost identical to normal DI — it isn't. Constructor injection makes a class's real dependencies visible from the outside, right there in its signature, which is exactly what lets the container catch a missing registration at startup instead of three steps deep into a request at 2 a.m. Reaching into `IServiceProvider` by hand hides every one of those dependencies behind a string or a type lookup buried in a method body, where nothing — not the compiler, not `ValidateOnBuild` — can check it for you in advance.

## How the container pulls this off internally {a}

A short look under the hood, for the curious. On `Build()`, your `ServiceCollection` of registrations becomes a real `ServiceProvider`. For each registration it holds a **call-site**: a description of exactly how to construct that type. The first time a given type is actually resolved, the container analyses its full constructor dependency graph and compiles a resolution plan for it. That starts out using plain reflection, but for services resolved often, it switches to **compiled expression trees or IL emit** instead, which is substantially faster ([confirmed in the runtime's own `ServiceLookup` source](https://github.com/dotnet/runtime/tree/main/src/libraries/Microsoft.Extensions.DependencyInjection/src/ServiceLookup)) — so the expensive analysis happens once, and every later resolution of the same type is cheap. Singletons are cached once, in the root container; scoped instances are cached per-scope, in each scope's own dictionary; transients aren't cached at all, only tracked so they can be disposed correctly. **`ValidateOnBuild`**, mentioned earlier alongside `ValidateScopes`, walks every registration right at startup to confirm it can actually be constructed — catching a missing registration the moment the app starts, instead of the first time a request happens to need it. One more detail worth knowing: `ActivatorUtilities.CreateInstance<T>(sp, extraArgs)` can construct a type that *isn't even registered*, mixing resolved DI services with explicit arguments you pass in yourself. This is precisely how conventional middleware classes get constructed, since they aren't registered as services in the usual sense.

:::qa What is dependency injection and why use it?
A technique where a class receives its dependencies from outside (usually through its constructor) instead of creating them. It decouples code from concrete implementations, enables unit testing with fakes, centralises configuration and lifetime management in one composition root, and supports the Dependency Inversion Principle.
:::

:::qa Explain transient, scoped and singleton lifetimes.
Transient creates a new instance every time it's resolved. Scoped creates one instance per scope; in ASP.NET Core a scope is one HTTP request, so it's one per request. Singleton creates one instance for the app's lifetime, shared by all requests and threads, so it must be thread-safe.
:::

:::qa What lifetime does DbContext have and why?
Scoped, by default with AddDbContext. A DbContext isn't thread-safe and accumulates tracked entities, so it should be short-lived and used by one request (one unit of work) at a time.
:::

:::qa What is a captive dependency and how do you detect and fix it?
A longer-lived service holding a shorter-lived one, e.g. a singleton depending on a scoped DbContext. The scoped instance is kept forever and shared across threads. ASP.NET Core detects it with scope validation (on by default in Development), which throws at startup. Fix it by aligning lifetimes or by injecting IServiceScopeFactory or IDbContextFactory to create instances per operation.
:::

:::qa How do you use a scoped service from a BackgroundService?
BackgroundService is a singleton with no request scope, so inject IServiceScopeFactory, create a scope per unit of work (`using var scope = factory.CreateScope()`), and resolve the scoped service from scope.ServiceProvider. Dispose the scope when done.
:::

:::qa What happens if you register two implementations of the same interface?
Injecting the interface gives the last registered implementation. Injecting IEnumerable&lt;T&gt; gives all of them in registration order. Since .NET 8, keyed services let you register and resolve specific implementations by key.
:::

:::qa What's the difference between DI, IoC and the Dependency Inversion Principle?
DIP is the design principle: depend on abstractions, not concretions. IoC is the broader idea that a framework controls object creation and program flow. DI is a concrete technique for achieving IoC by passing dependencies in, typically automated by a DI container.
:::

:::qa Why is the Service Locator pattern considered an anti-pattern?
Dependencies are hidden inside method bodies instead of declared in the constructor, so you can't see what a class needs, missing registrations fail at runtime rather than at startup validation, and tests need a configured container. Constructor injection makes dependencies explicit.
:::

:::qa How would you implement the decorator pattern with the built-in container?
Register the inner implementation as its concrete type and register the interface with a factory that wraps it: `services.AddScoped<IRepo>(sp => new CachingRepo(sp.GetRequiredService<SqlRepo>(), ...))`. Or use Scrutor's `Decorate<TInterface, TDecorator>()`.
:::

:::qa Does the container dispose services? Which ones?
Yes, the ones it created that implement IDisposable/IAsyncDisposable: scoped and transient instances when their scope is disposed, singletons when the app shuts down. It doesn't dispose instances you passed in yourself via AddSingleton(instance).
:::

:::qa What are keyed services?
A .NET 8 feature to register multiple implementations of the same service type under different keys (AddKeyedScoped&lt;IFoo, Bar&gt;("bar")) and resolve a specific one with [FromKeyedServices("bar")] or GetRequiredKeyedService.
:::

:::qa What is the composition root?
The single place where the object graph is composed, meaning all interfaces are bound to implementations: Program.cs and the AddX extension methods it calls. Other code receives dependencies and never knows concrete types.
:::

## Further reading

- [Dependency injection in ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/dependency-injection)
- [Dependency injection guidelines](https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection-guidelines)
- Book: *Dependency Injection Principles, Practices, and Patterns* by Steven van Deursen and Mark Seemann, the definitive book on DI.

## Verify this chapter

Run with `dotnet run` in a plain console project (`dotnet new console`, then `dotnet add package Microsoft.Extensions.DependencyInjection`). It checks all three lifetimes, the captive-dependency detection, "last registered wins vs `IEnumerable<T>` gives all", open generics, and `TryAddSingleton`.

```csharp
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

void Check(bool condition, string claim)
{
    if (!condition) throw new Exception($"FAIL: {claim}");
    Console.WriteLine($"OK: {claim}");
}

// 1. Transient: a new instance every single resolution, even within the same scope.
var services1 = new ServiceCollection();
services1.AddTransient<GuidService>();
using var provider1 = services1.BuildServiceProvider();
using (var scope = provider1.CreateScope())
{
    var a = scope.ServiceProvider.GetRequiredService<GuidService>().Id;
    var b = scope.ServiceProvider.GetRequiredService<GuidService>().Id;
    Check(a != b, "Transient gives a different instance on every resolution, even within one scope");
}

// 2. Scoped: same instance within one scope; a different instance in a different scope.
var services2 = new ServiceCollection();
services2.AddScoped<GuidService>();
using var provider2 = services2.BuildServiceProvider();
using var scopeA = provider2.CreateScope();
using var scopeB = provider2.CreateScope();
var scopedInA1 = scopeA.ServiceProvider.GetRequiredService<GuidService>().Id;
var scopedInA2 = scopeA.ServiceProvider.GetRequiredService<GuidService>().Id;
var scopedInB = scopeB.ServiceProvider.GetRequiredService<GuidService>().Id;
Check(scopedInA1 == scopedInA2, "Scoped gives the same instance twice within one scope");
Check(scopedInA1 != scopedInB, "Scoped gives a different instance in a different scope");

// 3. Singleton: the same instance everywhere, across every scope, for the app's life.
var services3 = new ServiceCollection();
services3.AddSingleton<GuidService>();
using var provider3 = services3.BuildServiceProvider();
using var scopeC = provider3.CreateScope();
var singletonRoot = provider3.GetRequiredService<GuidService>().Id;
var singletonInScope = scopeC.ServiceProvider.GetRequiredService<GuidService>().Id;
Check(singletonRoot == singletonInScope, "Singleton gives the same instance everywhere, including inside a scope");

// 4. Captive dependency: a singleton depending on a scoped service is caught at resolution time when
//    ValidateScopes is on, instead of silently capturing the first scope's instance forever.
var services4 = new ServiceCollection();
services4.AddScoped<GuidService>();
services4.AddSingleton<CapturesScoped>();
bool threw = false;
try
{
    using var validated = services4.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true });
    validated.GetRequiredService<CapturesScoped>();
}
catch (InvalidOperationException)
{
    threw = true;
}
Check(threw, "ValidateScopes=true makes resolving a singleton that depends on a scoped service throw InvalidOperationException");

// 5. Injecting the interface directly gives the LAST registered implementation;
//    injecting IEnumerable<T> gives ALL of them, in registration order.
var services5 = new ServiceCollection();
services5.AddSingleton<IChannel, EmailChannel>();
services5.AddSingleton<IChannel, SmsChannel>();
services5.AddSingleton<IChannel, PushChannel>();
using var provider5 = services5.BuildServiceProvider();
var last = provider5.GetRequiredService<IChannel>();
var all = provider5.GetServices<IChannel>().ToList();
Check(last is PushChannel, "Resolving the interface directly gives the LAST registered implementation");
Check(all.Count == 3 && all[0] is EmailChannel && all[1] is SmsChannel && all[2] is PushChannel,
    "Resolving IEnumerable<T> gives every implementation, in registration order");

// 6. Open generics: registering IRepository<> against Repository<> lets the container construct
//    IRepository<T> for ANY T, closed on demand.
var services6 = new ServiceCollection();
services6.Add(new ServiceDescriptor(typeof(IRepository<>), typeof(Repository<>), ServiceLifetime.Transient));
using var provider6 = services6.BuildServiceProvider();
var orderRepo = provider6.GetRequiredService<IRepository<string>>();
var customerRepo = provider6.GetRequiredService<IRepository<int>>();
Check(orderRepo is Repository<string> && customerRepo is Repository<int>,
    "An open generic registration (IRepository<>) closes over whatever type argument is actually requested");

// 7. TryAddSingleton only registers if nothing is already registered for that service type.
var services7 = new ServiceCollection();
services7.AddSingleton<IClock, FixedClock>();
services7.TryAddSingleton<IClock, SystemClock>();   // should be a no-op: IClock is already registered
using var provider7 = services7.BuildServiceProvider();
Check(provider7.GetRequiredService<IClock>() is FixedClock,
    "TryAddSingleton does nothing if the service type is already registered");

Console.WriteLine("All dependency-injection claims verified.");

class GuidService { public Guid Id { get; } = Guid.NewGuid(); }
class CapturesScoped(GuidService g) { }
interface IChannel { }
class EmailChannel : IChannel { }
class SmsChannel : IChannel { }
class PushChannel : IChannel { }
interface IRepository<T> { }
class Repository<T> : IRepository<T> { }
interface IClock { }
class FixedClock : IClock { }
class SystemClock : IClock { }
```

Not attempted here: the actual compiled-expression-tree/IL-emit resolution path is an internal performance detail of the `ServiceLookup` namespace, not something you can assert on from outside — see the runtime source link above if you want to read it yourself.
