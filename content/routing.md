---
id: routing
title: Routing and Endpoints
summary: How a URL is matched to code. Endpoint routing and why it replaced the old model, route templates, parameters and constraints, route groups, attribute and conventional routing, endpoint metadata, ambiguity and precedence, and link generation.
layer: framework
where: ASP.NET Core › Request pipeline › Routing & endpoints
fits: Routing is a pair of middleware ([Middleware](ch:middleware)) inside the pipeline: one **selects** the endpoint and another, at the end, **executes** it. Everything between them can read the chosen endpoint's metadata. The endpoints themselves are what [Building APIs](ch:building-apis) is about.
levels: b,i,a
prereqs: middleware
next: building-apis, auth
---

## TL;DR

- Routing's job: turn an HTTP method + path into one **endpoint** — code, metadata, and the values extracted from the URL.
- It's split into two middleware: one that **picks** the endpoint, one that **runs** it. Everything in between (CORS, auth, rate limiting) can read that endpoint's metadata first.
- Route templates (`{id:int}`) extract and constrain values. A failed constraint means "no route matches" (404), not "bad input" (400).
- Route groups let many endpoints share a prefix and a set of rules (auth, tags, rate limits) instead of repeating them on every endpoint.
- When two routes could both match, the more specific one wins; a genuine tie throws `AmbiguousMatchException` at runtime.
- Build links from a route's **name** (`LinkGenerator`), not a hand-built string, so they survive the template changing later.

## The question routing exists to answer {b}

A request arrives as nothing more than an HTTP method and a URL path — `GET /api/orders/42`. Somewhere, that has to turn into an actual decision: *which piece of your code runs, and what are its inputs?* That translation is routing's entire job: map the incoming request to an **endpoint** — a runnable unit of code (a `RequestDelegate`, underneath) bundled together with **metadata** describing it.

```text
GET /api/orders/42      ──▶  endpoint "GET /api/orders/{id:int}"
                              handler:  OrderEndpoints.GetById
                              metadata: [Authorize("CanRead")], [Tags("Orders")], RateLimiting("per-user"),
                                        Produces<OrderDto>(200), Produces(404) …
                              route values: { id = 42 }
```

Notice that the result isn't just "call this method" — it's a whole bundle: the handler, a pile of metadata describing authorization and rate-limiting policies and documentation tags, and the actual route values (`id = 42`) extracted from the URL. That metadata turns out to matter more than it looks, as the next section explains.

## Why routing had to be split into two separate middleware {i}

Since ASP.NET Core 3.0, routing isn't one step — it's deliberately **two** middleware, with a gap in between that the rest of the pipeline uses:

1. **`UseRouting`** (the `EndpointRoutingMiddleware`) **matches** the request against every registered endpoint and stores the winner on `HttpContext` — retrievable as `context.GetEndpoint()` — along with its route values.
2. **The endpoint middleware**, added automatically at the very end of the pipeline, actually **executes** the endpoint that was selected.

```text
UseRouting ─▶ UseCors ─▶ UseAuthentication ─▶ UseAuthorization ─▶ UseRateLimiter ─▶ UseOutputCache ─▶ [endpoint executes]
   │              │                                  │                  │                  │
   └── picks ─────┴─── each reads the endpoint's metadata: CORS policy, [Authorize] policy, limiter policy, cache policy
```

Here's why that gap matters. Everything sitting *between* "select" and "execute" — CORS, authentication, authorization, rate limiting, output caching — can now read the chosen endpoint's metadata before deciding what to do, without needing to know anything about how the endpoint was matched. Before this split existed, in ASP.NET Core 2.x, MVC did its own routing right at the end of the pipeline. That meant authorization and CORS had no way to know in advance which action was even going to run — they'd have needed to duplicate the routing logic themselves just to ask that question. Endpoint routing fixes this once, centrally: **one routing system** serves controllers, minimal APIs, Razor Pages, SignalR hubs, gRPC services and health checks alike, and every one of them exposes the same metadata to the same pipeline.

With `WebApplication`, you don't actually have to call `UseRouting` yourself — it's inserted automatically near the start of the pipeline. You'd call it explicitly only when you need some other middleware, like static files or forwarded headers, to run genuinely *before* routing happens, or when you want precise control over exactly where in the pipeline matching occurs.

## Route templates: the syntax that extracts values from a URL {b}

```csharp
app.MapGet("/products", GetAll);                               // literal
app.MapGet("/products/{id}", GetById);                         // parameter
app.MapGet("/products/{id:int}", GetById);                     // with constraint
app.MapGet("/products/{slug}/reviews/{page:int=1}", Reviews);  // default value
app.MapGet("/search/{term?}", Search);                         // optional parameter
app.MapGet("/files/{**path}", GetFile);                        // catch-all (slashes kept in value)
app.MapGet("/v{version:apiVersion}/orders", …);                // custom constraint (API versioning)
```

Each `{name}` segment becomes a route value, and that value binds to a handler argument **by matching name** — `{id}` in the template flows straight into an `int id` parameter on the handler, with no extra wiring needed.

### Route constraints: narrowing what a segment is allowed to match

| Constraint | Matches | Example |
|---|---|---|
| `int`, `long`, `decimal`, `double`, `float`, `bool` | Parses as that type | `{id:int}` |
| `guid` | A GUID | `{id:guid}` |
| `datetime` | A date | `{from:datetime}` |
| `alpha` | Letters only | `{slug:alpha}` |
| `minlength(n)`, `maxlength(n)`, `length(a,b)` | String length | `{code:length(3)}` |
| `min(n)`, `max(n)`, `range(a,b)` | Numeric range | `{page:int:min(1)}` |
| `regex(...)` | Regular expression | `{sku:regex(^[A-Z]{{2}}-\\d{{4}}$)}` |
| `required` | Non-empty | `{name:required}` |
| Custom | `IRouteConstraint` / `IParameterPolicy` | `{tenant:tenant}` |

:::gotcha Constraints decide whether a route matches, not whether input is valid
Here's the subtlety worth getting right: a failed constraint doesn't mean "bad request", it means "this route doesn't match at all" — so the result is a **404**, not a 400. Request `/products/abc` against a template of `{id:int}`, and you get `404 Not Found`, which can genuinely confuse an API client expecting `400 Bad Request` for malformed input. The right way to think about constraints is as a way to **disambiguate between competing routes** — `/products/{id:int}` from `/products/{slug}` — not as a validation layer. Validate real input properly inside the endpoint itself, and return 400 there.
:::

## Route groups: shared prefix, shared rules, written once {b}

A route group lets many related endpoints share both a URL **prefix** and a set of **metadata**, which is what keeps a large minimal-API surface from turning into repetitive boilerplate:

```csharp
var api = app.MapGroup("/api")
    .RequireAuthorization()                    // every endpoint below requires an authenticated user
    .AddEndpointFilter<RequestLoggingFilter>();

var orders = api.MapGroup("/orders")
    .WithTags("Orders")                        // OpenAPI grouping
    .RequireRateLimiting("per-user");

orders.MapGet("/", ListOrders);                // GET    /api/orders
orders.MapGet("/{id:int}", GetOrder)           // GET    /api/orders/42
      .WithName("GetOrder");                   //        named, for link generation
orders.MapPost("/", CreateOrder);              // POST   /api/orders
orders.MapDelete("/{id:int}", DeleteOrder)
      .RequireAuthorization("Admin");          //        extra policy on top of the group's

api.MapGroup("/public").AllowAnonymous().MapGet("/status", () => "ok");   // opt out
```

Notice the `DeleteOrder` endpoint: it doesn't just inherit the group's `RequireAuthorization()`, it **adds** a stricter `"Admin"` policy on top. Metadata stacks rather than replaces — which is exactly why the last line's `AllowAnonymous()` reads as an explicit opt-out rather than a silent contradiction.

## Routing for controllers: attributes instead of fluent calls {b}

Controllers reach the same destination through a different syntax — **attribute routing**, which is required for any API controller marked `[ApiController]`:

```csharp
[ApiController]
[Route("api/[controller]")]                      // [controller] token → "orders"
public class OrdersController : ControllerBase
{
    [HttpGet]                                    // GET  api/orders
    public IActionResult List([FromQuery] int page = 1) => Ok();

    [HttpGet("{id:int}", Name = "GetOrder")]     // GET  api/orders/42
    public IActionResult Get(int id) => Ok();

    [HttpPost]                                   // POST api/orders
    public IActionResult Create(CreateOrder cmd) => CreatedAtRoute("GetOrder", new { id = 1 }, null);

    [HttpPut("{id:int}/status")]                 // PUT  api/orders/42/status
    public IActionResult SetStatus(int id, StatusDto dto) => NoContent();

    [HttpGet("~/api/customers/{customerId}/orders")]   // ~ overrides the controller prefix
    public IActionResult ForCustomer(int customerId) => Ok();
}

app.MapControllers();   // registers all attribute-routed controller endpoints
```

A different, older style — **conventional routing** — is still common for MVC web apps that render views rather than serving an API, because it defines the URL pattern **once**, centrally, instead of repeating an attribute on every action:

```csharp
app.MapControllerRoute(name: "default", pattern: "{controller=Home}/{action=Index}/{id?}");
```

## Endpoint metadata: the vocabulary every cross-cutting concern reads from {i}

Metadata is simply a list of arbitrary objects attached to an endpoint — and the table below is really a map of "who reads what," tying straight back to the pipeline diagram earlier in this chapter. Attributes on controllers and fluent calls on minimal APIs are just two different syntaxes for attaching the exact same underlying metadata:

| Fluent (minimal API) | Attribute (controllers) | Read by |
|---|---|---|
| `.RequireAuthorization("Policy")` | `[Authorize(Policy = "Policy")]` | Authorization middleware |
| `.AllowAnonymous()` | `[AllowAnonymous]` | Authorization middleware |
| `.RequireCors("web")` | `[EnableCors("web")]` | CORS middleware |
| `.RequireRateLimiting("p")` | `[EnableRateLimiting("p")]` | Rate limiter |
| `.CacheOutput("p")` | `[OutputCache(PolicyName = "p")]` | Output cache |
| `.WithName("X")` | `Name = "X"` | Link generator |
| `.WithTags`, `.WithSummary`, `.Produces<T>()` | `[Tags]`, `[ProducesResponseType]` | OpenAPI |
| `.WithMetadata(obj)` | Any custom attribute | Your middleware |
| `.WithRequestTimeout("p")` | `[RequestTimeout]` | Request timeouts |
| `.ShortCircuit()` | — | Skips remaining middleware |

## When more than one route could match: precedence and ambiguity {a}

Real route tables inevitably end up with templates that *could* both match the same URL — `/products/featured` and `/products/{id}` both look plausible for a request to `/products/featured`. Routing resolves this with a precedence order, most specific wins:

1. Literal segments beat parameter segments: `/products/featured` beats `/products/{id}`.
2. Parameters with constraints beat unconstrained ones: `{id:int}` beats `{slug}`.
3. Complex segments beat simple parameters; catch-alls have the lowest precedence.
4. HTTP method constraints filter candidates (`GET` vs `POST` on the same path).

If, after all four rules, two endpoints are still equally specific, routing has genuinely no way to pick a winner, and you get an `AmbiguousMatchException` at runtime — "The request matched multiple endpoints." The fix is always to make one of them more specific: add a constraint, change a literal, or set an explicit `Order` on controllers.

Worth knowing if you're wondering whether this adds overhead as a route table grows: matching is done by a **DFA-based matcher** ([documented in the ASP.NET Core source](https://github.com/dotnet/aspnetcore/tree/main/src/Http/Routing/src/Matching)), built once at startup from every registered template. Because it's a precompiled state machine rather than a linear scan down a list, matching cost barely grows with how many routes you've registered.

## Link generation: building URLs that survive a route changing {a}

Build URLs from route **names** and values, not by concatenating strings, so that a route's template can change later without silently breaking every link that pointed at it:

```csharp
orders.MapPost("/", async (CreateOrder cmd, IOrderService svc, LinkGenerator links, HttpContext ctx) =>
{
    var id = await svc.CreateAsync(cmd);
    var url = links.GetUriByName(ctx, "GetOrder", new { id });   // https://host/api/orders/42
    return Results.Created(url, new { id });
});

// Shortcuts
return TypedResults.CreatedAtRoute(dto, "GetOrder", new { id = dto.Id });   // minimal API
return CreatedAtAction(nameof(Get), new { id }, dto);                         // controller
```

`LinkGenerator` is registered as a singleton, so you can inject it anywhere you need a URL — not just inside an endpoint handler, but genuinely useful for HATEOAS-style response links or for building URLs into outgoing emails.

## Reading route values back out of the request {i}

```csharp
app.MapGet("/tenants/{tenant}/orders/{id:int}", (string tenant, int id, HttpContext ctx) =>
{
    var raw = ctx.Request.RouteValues["tenant"];          // also available as a dictionary
    var endpoint = ctx.GetEndpoint();                     // the matched endpoint
    return Results.Ok(new { tenant, id, endpoint?.DisplayName });
});
```

Two small, commonly wanted tweaks live in `RouteOptions`: lowercase URLs and trailing-slash behaviour. `builder.Services.Configure<RouteOptions>(o => { o.LowercaseUrls = true; o.AppendTrailingSlash = false; });`

:::qa What is endpoint routing?
The routing system since ASP.NET Core 3.0, shared by MVC, minimal APIs, Razor Pages, SignalR, gRPC and health checks. UseRouting matches the request to an endpoint early and stores it on HttpContext; the endpoint is executed at the end of the pipeline; middleware in between (CORS, auth, rate limiting, caching) can read the selected endpoint's metadata.
:::

:::qa What's the difference between attribute routing and conventional routing?
Attribute routing puts templates on controllers and actions ([Route], [HttpGet("{id}")]) and is required for API controllers. Conventional routing defines URL patterns centrally ("{controller}/{action}/{id?}") and maps them to controllers by naming convention; it's typical for MVC sites with views.
:::

:::qa What happens when a route constraint fails?
The route doesn't match, so routing tries other endpoints and, if none match, returns 404. Constraints are for disambiguation, not input validation, which should return 400.
:::

:::qa What are route groups?
MapGroup creates a prefix and lets you apply shared metadata (authorization, filters, tags, rate limiting, CORS) to all endpoints within it, which keeps minimal API definitions organised and DRY.
:::

:::qa How does ASP.NET Core resolve two routes that match the same URL?
By route precedence: literals over parameters, constrained over unconstrained, catch-alls last, then HTTP method. If two candidates remain equally specific, it throws AmbiguousMatchException.
:::

:::qa How do you generate URLs to other endpoints?
Name the endpoint (WithName or Name = …) and use LinkGenerator.GetUriByName/GetPathByName, or helpers like CreatedAtRoute and CreatedAtAction. Avoid hard-coded string URLs.
:::

## Further reading

- [Routing in ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/routing)
- [Route handlers in minimal APIs](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/route-handlers)
- [Attribute routing for controllers](https://learn.microsoft.com/en-us/aspnet/core/mvc/controllers/routing)

## Verify this chapter

Run with `dotnet run` in a console project (`dotnet new web`, then `dotnet add package Microsoft.AspNetCore.TestHost`). It checks the 404-vs-400 behaviour of constraints, precedence between literal/parameter/constrained routes, the ambiguous-match failure, and link generation.

```csharp
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

void Check(bool condition, string claim)
{
    if (!condition) throw new Exception($"FAIL: {claim}");
    Console.WriteLine($"OK: {claim}");
}

// 1. A failed route constraint means "no route matches" -> 404, not 400.
var builder1 = WebApplication.CreateBuilder();
builder1.WebHost.UseTestServer();
var app1 = builder1.Build();
app1.MapGet("/products/{id:int}", (int id) => $"product {id}");
await app1.StartAsync();
var response1 = await app1.GetTestClient().GetAsync("/products/abc");   // "abc" fails the :int constraint
await app1.StopAsync();
Check(response1.StatusCode == System.Net.HttpStatusCode.NotFound,
    "A route segment that fails its constraint (e.g. {id:int} given 'abc') returns 404, not 400");

// 2. Precedence: a literal segment beats a parameter segment for the same URL.
var builder2 = WebApplication.CreateBuilder();
builder2.WebHost.UseTestServer();
var app2 = builder2.Build();
app2.MapGet("/products/featured", () => "featured-literal");
app2.MapGet("/products/{id}", (string id) => $"param-{id}");
await app2.StartAsync();
var featured = await app2.GetTestClient().GetStringAsync("/products/featured");
await app2.StopAsync();
Check(featured == "featured-literal", "A literal route segment ('/products/featured') beats a parameter segment ('/products/{id}') for the same URL");

// 3. Precedence: a constrained parameter beats an unconstrained one.
var builder3 = WebApplication.CreateBuilder();
builder3.WebHost.UseTestServer();
var app3 = builder3.Build();
app3.MapGet("/items/{id:int}", (int id) => "constrained");
app3.MapGet("/items/{slug}", (string slug) => "unconstrained");
await app3.StartAsync();
var numeric = await app3.GetTestClient().GetStringAsync("/items/42");
var text = await app3.GetTestClient().GetStringAsync("/items/abc");
await app3.StopAsync();
Check(numeric == "constrained", "A constrained parameter ({id:int}) wins over an unconstrained one ({slug}) when the value matches the constraint");
Check(text == "unconstrained", "When the value fails the constraint, the unconstrained route catches it instead");

// 4. Two equally-specific routes for the same request throw AmbiguousMatchException.
var builder4 = WebApplication.CreateBuilder();
builder4.WebHost.UseTestServer();
var app4 = builder4.Build();
app4.MapGet("/ambiguous/{a}", () => "first");
app4.MapGet("/ambiguous/{b}", () => "second");
await app4.StartAsync();
var ambiguousResponse = await app4.GetTestClient().GetAsync("/ambiguous/x");
var ambiguousBody = await ambiguousResponse.Content.ReadAsStringAsync();
await app4.StopAsync();
Check(ambiguousResponse.StatusCode == System.Net.HttpStatusCode.InternalServerError && ambiguousBody.Contains("AmbiguousMatchException"),
    "Two equally-specific routes for the same request throw AmbiguousMatchException (surfaced here as a 500)");

// 5. LinkGenerator builds a URL from a route NAME and values, matching the actual registered template.
var builder5 = WebApplication.CreateBuilder();
builder5.WebHost.UseTestServer();
var app5 = builder5.Build();
app5.MapGet("/api/orders/{id:int}", (int id) => "order").WithName("GetOrder");
await app5.StartAsync();
var links = app5.Services.GetRequiredService<LinkGenerator>();
var path = links.GetPathByName("GetOrder", new { id = 42 });
await app5.StopAsync();
Check(path == "/api/orders/42", "LinkGenerator.GetPathByName builds the URL from the route's name and values, matching its template");

Console.WriteLine("All routing claims verified.");
```

Not attempted here: the exact internal shape of the DFA matcher (how many states it builds, how it's cheaper than a linear scan) isn't something you can assert on from outside it — see the source link above if you want to read the matcher itself.
