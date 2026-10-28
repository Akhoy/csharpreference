---
id: building-apis
title: Building APIs: Minimal APIs, Controllers, Binding, Validation and Filters
summary: Writing the endpoints themselves. Minimal APIs and controllers compared, returning results (Results, TypedResults, ActionResult), parameter binding sources, validation (built-in, data annotations, FluentValidation), MVC filters and endpoint filters, JSON serialization with System.Text.Json, and organising endpoints.
layer: framework
where: ASP.NET Core › Request pipeline › Endpoints (your code)
fits: This is the **end of the pipeline**, where layer 3 hands over to *your* code. Routing ([Routing](ch:routing)) picked the endpoint, and this chapter is everything that happens inside it. From here, well-structured code calls into the application and domain layers of layer 4 ([App architectures](ch:app-architectures)) rather than doing everything in the handler.
levels: b,i,a
prereqs: routing, dependency-injection, modern-csharp
next: errors-logging, api-design, app-architectures
---

## TL;DR

- Minimal APIs and controllers are two **syntaxes** over identical machinery — same routing, DI and middleware. Pick based on team conventions and features needed, not raw capability.
- Parameter binding infers where a value comes from (route, query, body, DI) based on its type and name; attributes override that inference when you need to be explicit.
- Prefer `TypedResults` over `Results`: the handler's return type then documents every possible response, for free, accurate OpenAPI docs and easy unit tests.
- Validate shape at the edge (400 for bad input); keep business rules ("can't cancel a shipped order") in the domain layer, not in a validator.
- **Filters** run inside endpoint execution and see the bound, typed arguments — middleware never does, because it runs before model binding happens.
- Never bind a request body directly to an EF Core entity ("over-posting") and never return one either — always go through a DTO you control.

## Two syntaxes, the same machinery underneath {b}

Everything in the previous two chapters — the pipeline, the routing match — ends at exactly the same place: your code, deciding what to actually do with a request. ASP.NET Core gives you two different *syntaxes* for writing that code, and it's worth being clear up front that they are genuinely just syntax: both run on the same routing, the same DI container, the same authentication and the same middleware pipeline.

**Minimal APIs** (since .NET 6) map routes directly to functions:

```csharp
app.MapGet("/products/{id:int}", async (int id, ShopDb db, CancellationToken ct) =>
    await db.Products.FindAsync([id], ct) is { } p ? Results.Ok(p) : Results.NotFound());
```

**Controllers** (MVC) are classes with action methods and attributes:

```csharp
[ApiController]
[Route("products")]
public class ProductsController(ShopDb db) : ControllerBase
{
    [HttpGet("{id:int}")]
    public async Task<ActionResult<Product>> Get(int id, CancellationToken ct) =>
        await db.Products.FindAsync([id], ct) is { } p ? p : NotFound();
}
```

The difference between them isn't capability — it's how much ceremony you accept in exchange for which features:

| | Minimal APIs | Controllers |
|---|---|---|
| Shape | Lambdas or static methods; fluent configuration | Classes deriving `ControllerBase`; attributes |
| Ceremony | Low | Higher (classes, attributes, base class) |
| Cross-cutting per endpoint | Endpoint filters, route group metadata | Action/resource/result/exception filters |
| Automatic validation | Built in since .NET 10 (`AddValidation()`); else filters/FluentValidation | Automatic with `[ApiController]` (data annotations) |
| Model binding | Inferred; `[AsParameters]`; custom `BindAsync`/`TryParse` | Model binders, value providers; very extensible |
| Content negotiation (XML…) | JSON only out of the box | Formatters (JSON, XML, custom) |
| Performance | Slightly faster, lower memory | Slightly heavier |
| Native AOT | Supported (with request delegate generator) | Not supported |
| Microsoft's guidance | **Recommended for new APIs** | Fully supported; huge existing codebases |

:::interview How to answer "minimal APIs or controllers?"
"Both are first-class. For new services I default to minimal APIs organised into feature-based route groups, which pairs well with vertical slices and supports AOT. In an existing controller-based codebase I'd stay consistent. I'd pick controllers if the team relies on MVC filters, conventions, content negotiation or views."
:::

## Minimal APIs in depth {b}

### Handler shapes

A minimal-API handler can be as small as a one-liner or a reference to a plain static method — the framework infers a response from whatever you return:

```csharp
app.MapGet("/", () => "Hello");                                    // returns string → text/plain 200
app.MapGet("/now", () => new { Utc = DateTime.UtcNow });           // returns object → JSON 200
app.MapGet("/r", () => Results.Redirect("/"));                     // returns IResult → full control
app.MapPost("/orders", OrderHandlers.Create);                       // method group: testable static method
app.MapMethods("/ping", ["GET", "HEAD"], () => "pong");
```

### Organising endpoints so Program.cs stays readable

The lambda style above is great for a demo and genuinely bad for a real app with eighty endpoints crammed into one file. The fix is the same one [Routing](ch:routing#route-groups-shared-prefix-shared-rules-written-once) already introduced: group endpoints by feature, behind an extension method, so `Program.cs` reads as a table of contents rather than a wall of lambdas:

```csharp
public static class OrderEndpoints
{
    public static IEndpointRouteBuilder MapOrderEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/orders").WithTags("Orders").RequireAuthorization();

        g.MapGet("/", List).WithName("ListOrders");
        g.MapGet("/{id:int}", GetById).WithName("GetOrder");
        g.MapPost("/", Create).AddEndpointFilter<ValidationFilter<CreateOrderRequest>>();
        g.MapPost("/{id:int}/cancel", Cancel);
        return app;
    }

    static async Task<Ok<PagedResult<OrderSummary>>> List([AsParameters] OrderQuery q, IOrderQueries queries, CancellationToken ct)
        => TypedResults.Ok(await queries.ListAsync(q, ct));

    static async Task<Results<Ok<OrderDto>, NotFound>> GetById(int id, IOrderQueries queries, CancellationToken ct)
        => await queries.GetAsync(id, ct) is { } dto ? TypedResults.Ok(dto) : TypedResults.NotFound();

    static async Task<Results<Created<OrderDto>, ValidationProblem>> Create(CreateOrderRequest req, IOrderService svc, CancellationToken ct)
    {
        var dto = await svc.CreateAsync(req, ct);
        return TypedResults.Created($"/api/orders/{dto.Id}", dto);
    }

    static async Task<Results<NoContent, NotFound, Conflict<ProblemDetails>>> Cancel(int id, IOrderService svc, CancellationToken ct)
        => await svc.CancelAsync(id, ct) switch
        {
            CancelResult.Ok => TypedResults.NoContent(),
            CancelResult.NotFound => TypedResults.NotFound(),
            _ => TypedResults.Conflict(new ProblemDetails { Title = "Order can no longer be cancelled" })
        };
}

app.MapOrderEndpoints();
```

Some teams reach for libraries such as **Carter** or **FastEndpoints** to push this organisation further, into module- or REPR-style (Request-Endpoint-Response) folders — worth knowing the names exist, even if the pattern above covers most needs on its own.

## Returning results: what each return type actually produces {b}

| Return | Status | Notes |
|---|---|---|
| `string` | 200 text/plain | |
| Any object `T` | 200 application/json | Serialized with System.Text.Json |
| `IResult` via `Results.*` | Any | `Results.Ok(x)`, `NotFound()`, `Created(url, x)`, `NoContent()`, `BadRequest()`, `Problem()`, `ValidationProblem()`, `File()`, `Stream()`, `Redirect()`, `StatusCode(n)` |
| `TypedResults.*` | Any | Same, but **strongly typed** (`Ok<T>`, `NotFound`…), so OpenAPI can infer response types and unit tests can assert on them |
| `Results<T1, T2, …>` | Union | Declares every possible result type of a handler |
| Controllers: `IActionResult` / `ActionResult<T>` | Any | `Ok()`, `NotFound()`, `CreatedAtAction()`, `NoContent()`, `Problem()`, `ValidationProblem()` |

The reason to prefer **`TypedResults`** over plain `Results` isn't style — it's that the handler's *return type* becomes a literal, checked-by-the-compiler contract. Look back at `GetById` above: its signature, `Task<Results<Ok<OrderDto>, NotFound>>`, states in the type system itself that this endpoint produces exactly one of two shapes, nothing else. OpenAPI documentation generation reads that type and produces accurate response docs with zero extra annotation, and unit tests get a concrete type to assert against instead of inspecting an opaque `IResult`:

```csharp
// Unit testing a handler is trivial because it's just a static method returning typed results
var result = await OrderEndpoints.GetById(42, fakeQueries, CancellationToken.None);
var ok = Assert.IsType<Ok<OrderDto>>(result.Result);
Assert.Equal(42, ok.Value!.Id);
```

## Parameter binding: how request data becomes a C# argument {b}

Binding is the step that turns pieces of the raw HTTP request into the actual values your handler's parameters receive. The framework infers *where* to look for each parameter based on its type and name, and you can always override the inference with an explicit attribute:

| Source | Minimal API (inferred / explicit) | Controller attribute |
|---|---|---|
| Route `{id}` | Name matches a route parameter / `[FromRoute]` | `[FromRoute]` |
| Query string `?page=2` | Simple types not in the route / `[FromQuery]` | `[FromQuery]` |
| Headers | `[FromHeader(Name = "X-Tenant")]` | `[FromHeader]` |
| JSON body | Complex types (one per request) / `[FromBody]` | `[FromBody]` (inferred with `[ApiController]`) |
| Form fields / files | `[FromForm]`, `IFormFile`, `IFormFileCollection` | `[FromForm]` |
| DI services | Registered types / `[FromServices]` | `[FromServices]` |
| Keyed services | `[FromKeyedServices("key")]` | same |
| Special types | `HttpContext`, `HttpRequest`, `HttpResponse`, `ClaimsPrincipal`, `CancellationToken`, `Stream`, `PipeReader` | via `HttpContext` / parameters |
| Group many | `[AsParameters] MyQuery q` | complex type with `[FromQuery]` |

```csharp
public record OrderQuery(
    [FromQuery] int Page = 1,
    [FromQuery] int PageSize = 20,
    [FromQuery] OrderStatus? Status = null,
    [FromHeader(Name = "X-Tenant")] string? Tenant = null);

app.MapGet("/orders", ([AsParameters] OrderQuery q, IOrderQueries svc) => svc.ListAsync(q));

app.MapPost("/upload", async (IFormFile file, IBlobStore blobs, CancellationToken ct) =>
{
    await using var s = file.OpenReadStream();
    return Results.Ok(await blobs.UploadAsync(file.FileName, s, ct));
}).DisableAntiforgery();   // form endpoints require antiforgery tokens by default
```

**Custom binding:** give a type a static `TryParse(string, out T)` method (for route or query values) or a static `BindAsync(HttpContext)` method (for anything that needs the full context), and minimal APIs picks it up automatically, with no registration step. Implementing `IParsable<T>` works the same way.

:::gotcha Over-posting: the bug that looks like a feature until it doesn't
Here's the trap, concretely: bind the request body directly to your **EF Core entity**, and a client can set *any* writable property on it in the JSON they send — including `IsAdmin`, `Price`, or `CustomerId`, fields they were never supposed to touch. Nothing in the binding step knows "this field is for internal use only"; it binds whatever matches. The fix is to always bind to a dedicated **request DTO** that only has the fields a client is actually allowed to send, and map that DTO onto the domain explicitly, by hand, where you control exactly what gets copied.
:::

## Validation: catching bad input before it reaches business logic {i}

The goal here is simple to state: validate input **at the edge**, before anything downstream has to deal with it, and when it fails, respond with a **400** carrying `ValidationProblemDetails` — an RFC 9457 JSON body listing which fields were wrong and why.

### Option 1: Data annotations

```csharp
public sealed record CreateProductRequest(
    [property: Required, StringLength(100, MinimumLength = 2)] string Name,
    [property: Range(0.01, 1_000_000)] decimal Price,
    [property: Required, RegularExpression(@"^[A-Z]{2}-\d{4}$")] string Sku);
```

- **Controllers with `[ApiController]`** validate automatically and return 400 before your action runs at all (`ModelState.IsValid` is checked on your behalf).
- **Minimal APIs (.NET 10)**: `builder.Services.AddValidation();` enables built-in data-annotation validation for parameters and returns `ValidationProblem` automatically. On earlier versions, you need a filter to get the same effect.

### Option 2: FluentValidation, for rules annotations can't express

Data annotations are fine for simple per-field rules. But they genuinely can't express "this order needs at least one line" or "look up this SKU in the catalog and confirm it exists" — rules that need to see the whole object, or need a dependency like a database lookup. FluentValidation is the common answer:

```csharp
public sealed class CreateOrderValidator : AbstractValidator<CreateOrderRequest>
{
    public CreateOrderValidator(IProductCatalog catalog)
    {
        RuleFor(x => x.CustomerId).GreaterThan(0);
        RuleFor(x => x.Lines).NotEmpty().WithMessage("An order needs at least one line");
        RuleForEach(x => x.Lines).ChildRules(line =>
        {
            line.RuleFor(l => l.Qty).InclusiveBetween(1, 100);
            line.RuleFor(l => l.Sku).MustAsync((sku, ct) => catalog.ExistsAsync(sku, ct)).WithMessage("Unknown SKU '{PropertyValue}'");
        });
    }
}

builder.Services.AddValidatorsFromAssemblyContaining<CreateOrderValidator>();
// Apply with the ValidationFilter<T> endpoint filter (see Filters below), or call validator.ValidateAsync in the handler.
```

### Input validation vs business rules — a distinction worth holding onto

| Kind | Example | Where | Response |
|---|---|---|---|
| **Input/shape** | Required, length, range, format | Edge (validators) | 400 ValidationProblem |
| **Business rule** | "Can't cancel a shipped order", "insufficient stock" | Domain/application layer | 409 Conflict / 422 / domain error |

Both matter, and the line between them is where they *live*, not just what status code they return. "Can't cancel a shipped order" isn't a shape problem — the request might be perfectly well-formed — it's a rule about the current state of the business. Trying to express that inside a validator means the validator now needs database access and knowledge of domain state, which is exactly the kind of coupling that makes validators hard to test and slow to run. Keep it in the domain or application layer instead, where it belongs.

## Filters: seeing the handler's actual typed arguments {i}

Here's the capability middleware fundamentally can't give you — and the reason filters exist as a separate mechanism. Filters run **inside** endpoint execution, wrapped directly around your handler, after model binding has already happened. So they can see the bound, typed arguments and the handler's result. Middleware, sitting outside all of this, only ever sees raw HTTP.

### Endpoint filters (minimal APIs)

```csharp
public sealed class ValidationFilter<T>(IValidator<T> validator) : IEndpointFilter where T : class
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext ctx, EndpointFilterDelegate next)
    {
        var arg = ctx.Arguments.OfType<T>().FirstOrDefault();
        if (arg is null) return TypedResults.BadRequest();
        var result = await validator.ValidateAsync(arg, ctx.HttpContext.RequestAborted);
        return result.IsValid ? await next(ctx) : TypedResults.ValidationProblem(result.ToDictionary());
    }
}

// inline filter
g.MapPost("/", Create).AddEndpointFilter(async (ctx, next) =>
{
    var sw = Stopwatch.StartNew();
    var result = await next(ctx);
    ctx.HttpContext.Response.Headers["X-Handler-Ms"] = sw.ElapsedMilliseconds.ToString();
    return result;
});
```

A filter attached to a **group** applies to every endpoint inside it, and — just like middleware — filters run in registration order on the way in, outer to inner.

### MVC filter pipeline (controllers)

Controllers have a richer, more finely staged version of the same idea, with five distinct filter types, each running at a specific point:

```text
Request ─▶ [Authorization filters] ─▶ [Resource filters (before)] ─▶ model binding & validation
        ─▶ [Action filters (before)] ─▶ ACTION ─▶ [Action filters (after)]
        ─▶ [Exception filters] (only if the action/filters threw)
        ─▶ [Result filters (before)] ─▶ result executes (serialization) ─▶ [Result filters (after)]
        ─▶ [Resource filters (after)] ─▶ Response
```

| Filter | Interface | Typical use |
|---|---|---|
| Authorization | `IAuthorizationFilter` / `IAsyncAuthorizationFilter` | Custom auth checks (prefer policies) |
| Resource | `IResourceFilter` | Short-circuit before binding (caching, feature gates) |
| Action | `IActionFilter` / `IAsyncActionFilter` | Validation, logging arguments, transactions |
| Exception | `IExceptionFilter` | Translate exceptions from actions (prefer `IExceptionHandler` globally) |
| Result | `IResultFilter` | Modify or wrap results, add headers |

```csharp
public sealed class TransactionFilter(ShopDb db) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext ctx, ActionExecutionDelegate next)
    {
        await using var tx = await db.Database.BeginTransactionAsync();
        var executed = await next();
        if (executed.Exception is null) await tx.CommitAsync();
    }
}

builder.Services.AddControllers(o => o.Filters.Add<TransactionFilter>());   // global
[ServiceFilter<TransactionFilter>] public IActionResult Post(...) { }        // per action (resolved from DI)
```

Filters can be attached at three scopes — global, controller, and action — and on the way in they run global → controller → action, exactly reversed on the way out, the same inward-then-reversed-outward shape the middleware pipeline diagram showed in the previous chapter. `Order` lets you adjust the sequence within a scope when you need to.

## JSON with System.Text.Json: the defaults and how to bend them {i}

ASP.NET Core serializes with **System.Text.Json** by default, chosen specifically for being fast, low-allocation, and UTF-8 based rather than working through an intermediate string encoding. Its web-specific defaults: **camelCase** property names, case-insensitive reading on the way in, and numbers accepted even when they arrive as JSON strings.

```csharp
builder.Services.ConfigureHttpJsonOptions(o =>          // minimal APIs
{
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter());     // enums as "Paid" not 2
    o.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
});
builder.Services.AddControllers().AddJsonOptions(o => { /* same for controllers */ });

public sealed record OrderDto(
    int Id,
    [property: JsonPropertyName("total_amount")] decimal Total,
    [property: JsonIgnore] string InternalNote,
    OrderStatus Status);
```

| Need | Use |
|---|---|
| Rename a property | `[JsonPropertyName]` or a naming policy (`JsonNamingPolicy.SnakeCaseLower`) |
| Skip a property | `[JsonIgnore]` |
| Polymorphism (derived types) | `[JsonPolymorphic]` + `[JsonDerivedType(typeof(Card), "card")]` |
| Custom format | A `JsonConverter<T>` |
| Read unknown JSON | `JsonDocument` / `JsonNode` (DOM) |
| Max performance / AOT | Source generation: `[JsonSerializable(typeof(OrderDto))] partial class AppJsonContext : JsonSerializerContext` |
| Newtonsoft features | `AddNewtonsoftJson()` (legacy compatibility; slower) |

:::gotcha Serializing EF Core entities directly is a trap, not a shortcut
Return an EF Core entity with its navigation properties intact — `Order.Customer.Orders…` — and you'll either hit a reference-cycle error (the serializer walking `Order → Customer → Orders → Order → …` forever) or ship a response payload many times larger than anyone asked for. The fix isn't `ReferenceHandler.IgnoreCycles` — that papers over the symptom while still shipping too much data and still coupling your wire format to your database schema. Return **DTOs**, built with an explicit `Select` projection, every time.
:::

## Content negotiation, formats and streaming {a}

- Controllers honour the `Accept` header through output formatters (`AddXmlSerializerFormatters()`); minimal APIs always return JSON unless you explicitly return a different `IResult`.
- Return files with `Results.File(bytes, "application/pdf", "invoice.pdf")` or `Results.Stream(stream, …)`; use `PhysicalFile` for files on disk, which adds HTTP range support for free.
- Stream large datasets with `IAsyncEnumerable<T>`: the JSON array gets written to the response as items arrive, rather than buffering the entire result set in memory first.
- **Server-Sent Events** (`TypedResults.ServerSentEvents`, .NET 10) for one-way streaming updates to a browser.

## Putting it together: a handler that stays genuinely thin {i}

Pull the threads of this chapter together into one realistic endpoint, and notice what it deliberately does *not* do:

```csharp
// Endpoint (presentation): HTTP concerns only
static async Task<Results<Created<OrderDto>, ValidationProblem, Conflict<ProblemDetails>>> PlaceOrder(
    PlaceOrderRequest req, IValidator<PlaceOrderRequest> validator, IPlaceOrderHandler handler, ClaimsPrincipal user, CancellationToken ct)
{
    var v = await validator.ValidateAsync(req, ct);
    if (!v.IsValid) return TypedResults.ValidationProblem(v.ToDictionary());

    var result = await handler.HandleAsync(new PlaceOrder(user.GetCustomerId(), req.Lines), ct);   // application layer

    return result.IsSuccess
        ? TypedResults.Created($"/api/orders/{result.Value.Id}", result.Value)
        : TypedResults.Conflict(new ProblemDetails { Title = result.Error.Message, Type = result.Error.Code });
}
```

There's no business logic here at all — no stock checks, no pricing rules, nothing about what makes an order valid to place. The handler's job is strictly **bind → validate → delegate → map the result to HTTP**, and everything about what actually happens to an order lives one layer down, in application and domain code that has never heard of `HttpContext` and can be tested without spinning up a web server at all. See [App architectures](ch:app-architectures) and [CQRS & Result](ch:cqrs-mediator-result) for exactly how that layer is shaped.

:::qa Minimal APIs vs controllers: what are the differences and when would you pick each?
Both use the same routing, DI and middleware. Minimal APIs map routes to functions with fluent configuration, have less ceremony, are a bit faster and support Native AOT, and they're Microsoft's default recommendation for new APIs. Controllers are classes with attributes and have a richer filter pipeline, model binding and content negotiation. Pick based on team and codebase conventions and the features you need.
:::

:::qa What does the [ApiController] attribute do?
It enables API conventions: automatic 400 ValidationProblemDetails responses when model state is invalid, binding-source inference ([FromBody] for complex types, [FromRoute]/[FromQuery] for simple ones), a requirement for attribute routing, and ProblemDetails bodies for error status codes.
:::

:::qa What's the difference between Results and TypedResults?
Both create IResult responses. TypedResults returns concrete types (Ok&lt;T&gt;, NotFound, Created&lt;T&gt;), so a handler's return type (often Results&lt;…&gt;) documents every possible response, OpenAPI metadata is inferred automatically, and unit tests can assert on types without executing the result.
:::

:::qa How does parameter binding work in minimal APIs?
By inference. Route parameters bind by name; simple types otherwise come from the query string; complex types from the JSON body (only one body per request); registered services from DI; special types (HttpContext, CancellationToken, ClaimsPrincipal) are injected. Attributes ([FromQuery], [FromHeader], [FromBody], [FromServices], [AsParameters]) make it explicit, and TryParse/BindAsync allow custom binding.
:::

:::qa How do you validate requests in ASP.NET Core?
With data annotations on DTOs (automatic in controllers with [ApiController]; built in for minimal APIs since .NET 10 via AddValidation), or with FluentValidation applied through an endpoint/action filter or called in the handler. Return 400 ValidationProblemDetails. Keep business rules in the domain/application layer.
:::

:::qa What is over-posting and how do you prevent it?
When clients send extra fields that bind onto properties they shouldn't control (e.g. IsAdmin, Price) because the request is bound directly to an entity. Prevent it by binding to dedicated request DTOs and mapping explicitly.
:::

:::qa Explain the MVC filter pipeline order.
Authorization filters, then resource filters, then model binding, then action filters around the action, then exception filters (if something threw), then result filters around result execution, then resource filters' after-code. Within a type, global then controller then action filters, reversed on the way out.
:::

:::qa What are endpoint filters?
Minimal API equivalents of action filters: IEndpointFilter implementations attached to endpoints or route groups that run around the handler with access to the bound arguments (EndpointFilterInvocationContext.Arguments) and the returned result. Used for validation, logging and argument checks.
:::

:::qa Why return DTOs instead of EF Core entities from an API?
It decouples the API contract from the database schema, prevents over-posting and leaking internal fields, avoids serialization cycles via navigation properties, and lets you project only the needed columns, which is faster.
:::

:::qa How do you customise JSON serialization?
ConfigureHttpJsonOptions (minimal APIs) or AddJsonOptions (controllers) to set naming policies, converters (JsonStringEnumConverter), ignore conditions and so on; attributes like [JsonPropertyName], [JsonIgnore] and [JsonPolymorphic]; custom JsonConverter&lt;T&gt;; and source-generated JsonSerializerContext for speed and AOT.
:::

## Further reading

- [Minimal APIs overview](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/overview)
- [Choose between controller-based APIs and minimal APIs](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/apis)
- [Parameter binding in minimal APIs](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/parameter-binding)
- [Filters in ASP.NET Core (MVC)](https://learn.microsoft.com/en-us/aspnet/core/mvc/controllers/filters)
- [System.Text.Json overview](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/overview)

## Verify this chapter

Run with `dotnet run` in a console project (`dotnet new web`, then `dotnet add package Microsoft.AspNetCore.TestHost`). It checks response content types, `TypedResults` status codes, parameter binding, an endpoint filter short-circuiting on the typed argument, and the over-posting problem itself.

```csharp
using System.Net.Http.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.TestHost;

void Check(bool condition, string claim)
{
    if (!condition) throw new Exception($"FAIL: {claim}");
    Console.WriteLine($"OK: {claim}");
}

// 1. Returning a plain string gives 200 text/plain; returning an object gives 200 application/json.
var builder1 = WebApplication.CreateBuilder();
builder1.WebHost.UseTestServer();
var app1 = builder1.Build();
app1.MapGet("/text", () => "Hello");
app1.MapGet("/json", () => new { Utc = "now" });
await app1.StartAsync();
var client1 = app1.GetTestClient();
var textResponse = await client1.GetAsync("/text");
var jsonResponse = await client1.GetAsync("/json");
await app1.StopAsync();
Check(textResponse.Content.Headers.ContentType!.MediaType == "text/plain", "Returning a plain string produces a text/plain response");
Check(jsonResponse.Content.Headers.ContentType!.MediaType == "application/json", "Returning any other object produces an application/json response");

// 2. TypedResults.Ok<T> / NotFound produce the HTTP status codes the chapter claims.
var builder2 = WebApplication.CreateBuilder();
builder2.WebHost.UseTestServer();
var app2 = builder2.Build();
app2.MapGet("/items/{id:int}", GetItem);
Results<Ok<int>, NotFound> GetItem(int id) => id == 1 ? TypedResults.Ok(id) : TypedResults.NotFound();
await app2.StartAsync();
var client2 = app2.GetTestClient();
var found = await client2.GetAsync("/items/1");
var notFound = await client2.GetAsync("/items/2");
await app2.StopAsync();
Check(found.StatusCode == System.Net.HttpStatusCode.OK, "TypedResults.Ok produces a 200");
Check(notFound.StatusCode == System.Net.HttpStatusCode.NotFound, "TypedResults.NotFound produces a 404");

// 3. Parameter binding: route value binds by name, query string binds a simple type not in the route.
var builder3 = WebApplication.CreateBuilder();
builder3.WebHost.UseTestServer();
var app3 = builder3.Build();
app3.MapGet("/orders/{id:int}", (int id, int page) => $"{id}:{page}");
await app3.StartAsync();
var bound = await app3.GetTestClient().GetStringAsync("/orders/7?page=3");
await app3.StopAsync();
Check(bound == "7:3", "A route value binds by name and a query-string value binds a simple type not present in the route, in the same handler");

// 4. An endpoint filter sees the bound, typed argument and can short-circuit BEFORE the handler runs.
var handlerRan = false;
var builder4 = WebApplication.CreateBuilder();
builder4.WebHost.UseTestServer();
var app4 = builder4.Build();
app4.MapPost("/products", (CreateProductRequest req) => { handlerRan = true; return Results.Ok(); })
    .AddEndpointFilter(async (ctx, next) =>
    {
        var arg = ctx.Arguments.OfType<CreateProductRequest>().FirstOrDefault();
        if (arg is { Price: <= 0 }) return Results.BadRequest("Price must be positive");   // sees the TYPED argument
        return await next(ctx);
    });
await app4.StartAsync();
var client4 = app4.GetTestClient();
var rejected = await client4.PostAsJsonAsync("/products", new CreateProductRequest("Mouse", -5m));
var rejectedHandlerRan = handlerRan;
handlerRan = false;
var accepted = await client4.PostAsJsonAsync("/products", new CreateProductRequest("Mouse", 20m));
await app4.StopAsync();
Check(rejected.StatusCode == System.Net.HttpStatusCode.BadRequest && !rejectedHandlerRan,
    "An endpoint filter can inspect the bound, typed argument and short-circuit before the handler runs");
Check(accepted.StatusCode == System.Net.HttpStatusCode.OK && handlerRan,
    "When the filter lets the request through, the handler runs normally");

// 5. Over-posting: binding a request body directly to an entity-shaped type sets ANY writable property
//    the client sent, including ones a client should never control (e.g. IsAdmin) — a DTO avoids this
//    simply by not HAVING that property at all.
var entityJson = """{ "Name": "bob", "IsAdmin": true }""";
var entityBound = System.Text.Json.JsonSerializer.Deserialize<UserEntity>(entityJson)!;
Check(entityBound.IsAdmin, "Binding JSON directly to an entity-shaped type lets the client set fields it should never control (over-posting)");

var dtoJson = """{ "Name": "bob", "IsAdmin": true }""";   // client tries the same trick against a DTO
var dtoBound = System.Text.Json.JsonSerializer.Deserialize<CreateUserRequest>(dtoJson)!;
Check(dtoBound.Name == "bob", "A request DTO that only declares the allowed fields silently ignores extra fields like IsAdmin");

Console.WriteLine("All building-apis claims verified.");

record CreateProductRequest(string Name, decimal Price);
record CreateUserRequest(string Name);
class UserEntity { public string Name { get; set; } = ""; public bool IsAdmin { get; set; } }
```

Not attempted here: controller-specific behaviour (`[ApiController]`'s automatic 400s, MVC's five filter types, content negotiation via `Accept`) needs a full MVC host rather than minimal APIs' `TestServer` setup — see the official docs above for those, the minimal-API equivalents above cover the same underlying mechanism.
