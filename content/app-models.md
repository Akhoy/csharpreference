---
id: app-models
title: The Other App Models: gRPC, SignalR, MVC, Razor Pages and Blazor
summary: ASP.NET Core is more than JSON APIs. What each app model is for and where it fits: gRPC for fast service-to-service RPC, SignalR for real-time push, MVC and Razor Pages for server-rendered HTML, Blazor for C# UIs, and how they all share the same host and pipeline.
layer: framework
where: ASP.NET Core › App models beyond REST
fits: All of these are **endpoint types** in the same layer-3 framework. They run on the same host ([Hosting](ch:aspnet-hosting)), DI, middleware ([Middleware](ch:middleware)) and routing ([Routing](ch:routing)) as your minimal APIs. gRPC and SignalR are also service-communication choices in layer 6, alongside REST ([API design](ch:api-design)) and messaging ([Messaging](ch:messaging-events)).
levels: b,i,a
prereqs: aspnet-hosting, routing
next: relational-fundamentals, messaging-events
---

## TL;DR

- ASP.NET Core isn't just JSON APIs: the same host/DI/middleware/routing plumbing also serves gRPC, SignalR, server-rendered HTML (MVC/Razor Pages), and Blazor — you can mix several in one app.
- **gRPC**: contract-first (`.proto`), binary, HTTP/2, built-in streaming. Best for internal service-to-service calls, not browsers.
- **SignalR**: lets the server push to clients first, instead of waiting for a request. Scaling past one server needs a backplane (Redis) or Azure SignalR Service.
- **MVC/Razor Pages**: server-rendered HTML with real `<form>` posts; relies on cookie auth + antiforgery tokens instead of bearer tokens.
- **Blazor**: UI written in C#, with a choice of where it runs — static HTML, on the server (via SignalR), in the browser (WebAssembly), or both.
- GraphQL, OData, raw WebSockets and Server-Sent Events cover narrower niches on top of the same host.

## One framework, many endpoint types {b}

Everything in the last several chapters — the host, DI, the middleware pipeline, routing — was described as the foundation *under* your API endpoints. It's worth being explicit about something that follows directly from that: minimal APIs and controllers are not the only thing that foundation supports. The exact same `WebApplication` can simultaneously serve JSON APIs, a high-performance internal RPC protocol, a live push channel to browsers, and fully server-rendered HTML pages — because all of them are just different **endpoint types** sitting on the same shared plumbing.

```text
                    ┌──────── same WebApplication: host, DI, config, logging, middleware ────────┐
Endpoint type  ───▶ │ Minimal APIs │ Controllers │ gRPC services │ SignalR hubs │ Razor Pages │ Blazor │ Health checks │
Speaks         ───▶ │ JSON/HTTP    │ JSON/HTTP   │ Protobuf/HTTP2│ WebSockets…  │ HTML        │ HTML+WS│ JSON          │
Typical client ───▶ │ SPA, mobile  │ SPA, mobile │ other services│ browsers,apps│ browsers    │browsers│ load balancer │
```

You can genuinely mix these in one app: a REST API for the mobile client, a gRPC endpoint for internal service calls, a SignalR hub for live updates, and health checks, all registered in the same `Program.cs`. The question this chapter answers, model by model, is which one actually fits a given job:

| Need | Choose |
|---|---|
| Public/partner API, SPAs, mobile apps | REST/JSON (minimal APIs or controllers) |
| Fast, strongly typed **internal** service-to-service calls, streaming | **gRPC** |
| Server **pushes** to clients in real time (chat, notifications, live dashboards) | **SignalR** |
| Server-rendered website with forms | **Razor Pages** or **MVC** with views |
| Rich interactive web UI written in C# instead of JavaScript | **Blazor** |
| Flexible client-driven queries over a graph of data | GraphQL (Hot Chocolate library) |

## gRPC: when the client is another service, not a browser {i}

**gRPC** is a high-performance RPC framework from Google. Its design rests on one assumption: both ends of the call are code you (or a cooperating team) control. Nobody needs to read the wire format by eye, and no browser needs to understand it directly. Because of that assumption, gRPC can afford to be **contract-first** — you define the service in **Protocol Buffers** (`.proto`), and both client and server code are generated from that contract. It also uses a **binary** wire format instead of text JSON (smaller, faster to parse), runs over **HTTP/2**, and treats streaming as a built-in feature instead of a workaround.

```proto
// Protos/inventory.proto
syntax = "proto3";
option csharp_namespace = "Shop.Inventory.Grpc";

service Inventory {
  rpc GetStock (StockRequest) returns (StockReply);                       // unary
  rpc WatchStock (StockRequest) returns (stream StockReply);              // server streaming
}
message StockRequest { string sku = 1; }
message StockReply   { string sku = 1; int32 quantity = 2; }
```

```xml
<ItemGroup>
  <Protobuf Include="Protos\inventory.proto" GrpcServices="Server" />   <!-- "Client" in the consumer project -->
</ItemGroup>
```

```csharp
// Server
public sealed class InventoryService(IStockRepository stock) : Inventory.InventoryBase   // base class generated from .proto
{
    public override async Task<StockReply> GetStock(StockRequest req, ServerCallContext ctx) =>
        new() { Sku = req.Sku, Quantity = await stock.GetAsync(req.Sku, ctx.CancellationToken) };
}
builder.Services.AddGrpc();
app.MapGrpcService<InventoryService>();

// Client (another service)
builder.Services.AddGrpcClient<Inventory.InventoryClient>(o => o.Address = new Uri("https://inventory"))
    .AddStandardResilienceHandler();
var reply = await inventoryClient.GetStockAsync(new StockRequest { Sku = "KB-01" }, cancellationToken: ct);
```

| | REST/JSON | gRPC |
|---|---|---|
| Contract | OpenAPI (often generated after the fact) | `.proto`, contract-first, strict |
| Payload | Text JSON (bigger, human-readable) | Binary Protobuf (smaller, faster to parse) |
| Transport | HTTP/1.1 or 2 | HTTP/2 (required), HTTP/3 |
| Streaming | Limited (SSE, chunked) | Client, server and bidirectional streaming |
| Browser support | Native | Needs **gRPC-Web** or **JSON transcoding** |
| Tooling/debugging | curl, browser, Postman | Postman/grpcurl, less ubiquitous |
| Best for | Public APIs, browsers | Internal microservice calls, low latency, polyglot systems |

Look at the "Browser support" row — it explains most of the real-world adoption pattern. Browsers can't speak the raw HTTP/2 trailers gRPC needs, so gRPC stays mostly internal (service-to-service), while REST stays the public-facing contract. One rule matters once a gRPC service is live: in `.proto`, the field **numbers** are the real contract, not the names. Never reuse or renumber a field number — always add new fields with new numbers. That's what lets an old client and a new client talk to the same service as it evolves. (If you ever need both REST and gRPC on the same service, **gRPC JSON transcoding** exposes one as the other.)

## SignalR: when the server needs to speak first {i}

Every pattern so far in this book has the client going first — it sends a request, and a response comes back. **SignalR** is for the opposite case: the server learns something changed (an order shipped, a chat message arrived) before any client asked about it, and needs to **push** that update immediately, instead of making clients poll for it.

- Transports, negotiated automatically: **WebSockets** → Server-Sent Events → long polling — SignalR picks the best one the client and network actually support, falling back gracefully.
- **Hubs**: server classes whose methods clients can call, and which can in turn call methods defined on the clients.
- Addressing: all clients, a specific connection, a **user** (meaning all of that user's connections, since they might have several tabs open), or **groups**.
- Clients: JavaScript/TypeScript, .NET, Java, Swift.

```csharp
public interface IOrderClient { Task StatusChanged(int orderId, string status); }      // strongly typed client methods

[Authorize]
public sealed class OrderHub : Hub<IOrderClient>
{
    public Task Follow(int orderId) => Groups.AddToGroupAsync(Context.ConnectionId, $"order:{orderId}");
    public override Task OnConnectedAsync() { /* Context.UserIdentifier is the user's id */ return base.OnConnectedAsync(); }
}

builder.Services.AddSignalR();
app.MapHub<OrderHub>("/hubs/orders");

// Push from anywhere (an endpoint, a message consumer, a background service)
public sealed class ShippingNotifier(IHubContext<OrderHub, IOrderClient> hub)
{
    public Task OrderShippedAsync(int orderId) => hub.Clients.Group($"order:{orderId}").StatusChanged(orderId, "Shipped");
}
```

```js
const conn = new signalR.HubConnectionBuilder().withUrl("/hubs/orders", { accessTokenFactory: () => token }).withAutomaticReconnect().build();
conn.on("StatusChanged", (id, status) => render(id, status));
await conn.start();
await conn.invoke("Follow", 42);
```

Notice that `ShippingNotifier` is **not** a hub — it's just an ordinary service with `IHubContext<OrderHub, IOrderClient>` injected into it. It can push a message from anywhere the real event happens: an endpoint, a message consumer, a background service. "Something shipped" doesn't have to originate inside a hub method at all.

**Scaling to more than one server** creates a real problem: say your code sends a message on server A, but the client's persistent WebSocket connection happens to be held open by server B. Each server only knows about its *own* connections — server A has no way to reach that client directly. Two fixes exist: a **backplane** (Redis, via `AddStackExchangeRedis()`) that relays messages between all server instances, or **Azure SignalR Service**, which holds every client connection centrally for you — usually the simpler choice once you're on Azure. If you self-host behind a load balancer instead, you also need **sticky sessions** for WebSockets (or you skip the negotiation step entirely), otherwise a reconnect can land on a different server than the one that originally set up the connection — and that server won't recognize it.

## Server-rendered HTML: MVC and Razor Pages {b}

Step away from APIs and real-time push entirely: sometimes the actual deliverable is a web page rendered as HTML, with forms a browser posts back to directly, no separate frontend framework involved. **Razor** is the templating syntax underneath both options here — C# mixed directly into HTML markup (`@Model.Name`, `@foreach`).

| | MVC (Model-View-Controller) | Razor Pages |
|---|---|---|
| Organisation | Controllers with actions return views; views in `Views/{Controller}/` | One page = `.cshtml` file + a `PageModel` class |
| Routing | Conventional `{controller}/{action}/{id?}` or attributes | File-system based: `Pages/Orders/Edit.cshtml` → `/Orders/Edit` |
| Good for | Large sites with shared controllers; teams used to MVC | Page-focused apps: forms, admin tools, CRUD |
| Shared | Tag helpers, layouts, partials, view components, model binding, validation, antiforgery | same |

```csharp
// Razor Page: Pages/Products/Edit.cshtml.cs
public sealed class EditModel(ShopDb db) : PageModel
{
    [BindProperty] public ProductForm Input { get; set; } = new();

    public async Task<IActionResult> OnGetAsync(int id)
    {
        var p = await db.Products.FindAsync(id);
        if (p is null) return NotFound();
        Input = new ProductForm { Id = p.Id, Name = p.Name, Price = p.Price };
        return Page();
    }

    public async Task<IActionResult> OnPostAsync()
    {
        if (!ModelState.IsValid) return Page();          // redisplay with validation messages
        // ... save ...
        return RedirectToPage("Index");                  // Post-Redirect-Get pattern
    }
}
```

Notice `OnPostAsync` redirects on success rather than returning a view directly — the Post-Redirect-Get pattern, which exists specifically so that refreshing the page after a successful save doesn't resubmit the form a second time. Because this model relies on the browser submitting real HTML forms rather than an API client attaching a bearer token, server-rendered apps use **cookie auth** by default and need **antiforgery** tokens on every form — added automatically by the form tag helpers. This defends against **CSRF** (cross-site request forgery: a malicious site tricking your browser into submitting a form to a real site where you're already logged in, using your cookies without your consent) — exactly the risk [Auth](ch:auth#cookies-vs-bearer-tokens-the-tradeoff-behind-how-do-i-stay-l) flags as cookies' particular weak point.

## Blazor: C# instead of JavaScript, with a choice of where it actually runs {i}

**Blazor** builds interactive web UIs from **Razor components** written entirely in C# — no JavaScript framework needed. The one question that matters for understanding Blazor is: *where does that C# actually run — on the server, or in the browser?* Since .NET 8, you don't have to pick one answer for the whole app. A single unified model ("Blazor Web App") lets you choose a **render mode** per component:

| Render mode | Where the code runs | Trade-offs |
|---|---|---|
| **Static SSR** | Server renders HTML once; no interactivity (forms still work) | Fastest, SEO-friendly |
| **Interactive Server** | Server; UI events and diffs sent over a **SignalR** connection | Small download, full .NET on the server; needs a persistent connection; latency on every interaction; server memory per user |
| **Interactive WebAssembly** | In the browser, on a .NET runtime compiled to **WebAssembly** | Works offline and scales like a SPA; larger initial download; calls APIs over HTTP |
| **Interactive Auto** | Server first, switches to WebAssembly once downloaded | Best of both, more complexity |

Look at the "Interactive Server" row again: this is just SignalR (described above), used to ship every button click and keystroke to the server and stream the resulting UI change back. It isn't a separate real-time technology. That's also why Blazor Server inherits SignalR's scale-out problem the moment you run more than one server instance — it needs the same fix: a backplane or Azure SignalR Service.

```razor
@page "/orders"
@rendermode InteractiveServer
@inject IOrderQueries Orders

<h1>Orders</h1>
@if (_orders is null) { <p>Loading…</p> }
else
{
    <ul>@foreach (var o in _orders) { <li>@o.Id: @o.Total.ToString("C")</li> }</ul>
}
<button @onclick="Refresh">Refresh</button>

@code {
    private IReadOnlyList<OrderSummary>? _orders;
    protected override async Task OnInitializedAsync() => await Refresh();
    private async Task Refresh() => _orders = await Orders.RecentAsync();
}
```

For a backend-focused interview, the useful depth here is knowing what Blazor is, how the render modes trade off against each other, and specifically that Blazor Server relies on SignalR rather than being its own independent real-time mechanism. **.NET MAUI Blazor Hybrid** reuses the same components inside native desktop and mobile apps, for teams wanting one UI codebase across web and native.

## GraphQL and others, briefly {a}

- **GraphQL** (via **Hot Chocolate**): clients send queries describing exactly the fields they need across related data, served from a single endpoint. Great for complex front ends aggregating many sources; harder to cache over HTTP, needs query cost limits and has an N+1 risk (solved with DataLoaders).
- **OData**: queryable REST conventions (`$filter`, `$select`, `$expand`) over `IQueryable`; common in enterprise and Microsoft ecosystems.
- **WebSockets directly** (`app.UseWebSockets()`) for custom protocols.
- **Server-Sent Events** (`TypedResults.ServerSentEvents` in .NET 10): simple one-way server-to-browser streams over plain HTTP.
- **Health checks** (`MapHealthChecks`) are endpoints too. See [Observability](ch:observability-aspire).

:::qa When would you choose gRPC over REST?
For internal service-to-service communication where performance (binary Protobuf, HTTP/2 multiplexing), strict contract-first schemas with generated clients, and streaming matter. REST/JSON remains better for public APIs and browsers (gRPC needs gRPC-Web or JSON transcoding there).
:::

:::qa How do you evolve a gRPC contract without breaking clients?
Add new fields with new field numbers, never change or reuse existing field numbers or types, mark removed fields as reserved, and treat all fields as optional. Protobuf ignores unknown fields, so old and new clients interoperate.
:::

:::qa What is SignalR and how does it work?
A library for real-time bidirectional communication. Clients connect to a hub, and the transport is negotiated (WebSockets, then Server-Sent Events, then long polling). Server code calls client methods on all clients, users, groups or connections via the hub or IHubContext, and clients call hub methods.
:::

:::qa How do you scale SignalR across multiple servers?
Use a backplane such as Redis so messages published on one server reach clients connected to others, or use Azure SignalR Service, which manages the client connections. Self-hosted WebSocket setups also need sticky sessions unless negotiation is skipped.
:::

:::qa Razor Pages vs MVC?
Both render HTML with Razor on the server and share tag helpers, model binding and validation. MVC separates controllers and views and uses action-based routing; Razor Pages is page-centric, pairing each .cshtml with a PageModel and using file-based routing, which is simpler for form-centred apps.
:::

:::qa What are Blazor's render modes?
Static server-side rendering (no interactivity), Interactive Server (logic on the server, UI updates over SignalR), Interactive WebAssembly (the .NET runtime in the browser) and Interactive Auto (server first, then WebAssembly). Chosen per component or per app since .NET 8.
:::

## Further reading

- [Overview for gRPC on .NET](https://learn.microsoft.com/en-us/aspnet/core/grpc/)
- [Overview of ASP.NET Core SignalR](https://learn.microsoft.com/en-us/aspnet/core/signalr/introduction)
- [Introduction to Razor Pages](https://learn.microsoft.com/en-us/aspnet/core/razor-pages/)
- [ASP.NET Core Blazor](https://learn.microsoft.com/en-us/aspnet/core/blazor/)
- [Hot Chocolate (GraphQL)](https://chillicream.com/docs/hotchocolate)

## Verify this chapter

Most claims here (gRPC's transport, SignalR's scale-out, Blazor's render modes) need a real network/hosting environment and aren't something a console program can check. What *can* be verified locally, with no extra packages, is the actual mechanism behind two of this chapter's claims: that binary framing beats JSON on size, and that Protobuf-style field **numbers**, not names, are the real contract. Run with `dotnet run` (plain console app, .NET 8/9).

```csharp
using System.Text;
using System.Text.Json;

// Claim: "binary wire format instead of text JSON" is smaller for the same data.
// This isn't a real Protobuf encoder, but a minimal tagged-binary encoding (type tag +
// length-prefixed value) is a fair stand-in: binary framing skips field names, quotes and punctuation.
var sku = "KB-01";
var quantity = 42;

var json = JsonSerializer.Serialize(new { sku, quantity });
var jsonBytes = Encoding.UTF8.GetByteCount(json);

using var ms = new MemoryStream();
using var bw = new BinaryWriter(ms);
bw.Write((byte)1); bw.Write(sku);          // field 1: sku
bw.Write((byte)2); bw.Write(quantity);     // field 2: quantity
var binaryBytes = (int)ms.Length;

if (binaryBytes >= jsonBytes)
    throw new Exception($"FAIL: expected binary ({binaryBytes}B) to be smaller than JSON ({jsonBytes}B)");
Console.WriteLine($"OK: binary framing ({binaryBytes}B) is smaller than JSON ({jsonBytes}B) for the same fields");

// Claim: in a Protobuf-style contract, field NUMBERS are the contract, not names or order.
// Model this with a tiny tag->value dictionary (mirrors how Protobuf decodes by field number).
static Dictionary<int, object> Encode(params (int tag, object value)[] fields) =>
    fields.ToDictionary(f => f.tag, f => f.value);

var oldWire = Encode((1, "KB-01"), (2, 42));                               // "old" server
var newWire = Encode((1, "KB-01"), (2, 42), (3, "warehouse-7"));           // "new" server adds field 3

string OldClientReads(Dictionary<int, object> wire) => $"{wire[1]}:{wire[2]}"; // old client only knows fields 1 and 2

if (OldClientReads(oldWire) != OldClientReads(newWire))
    throw new Exception("FAIL: old client reading by field number should be unaffected by a new field");
Console.WriteLine("OK: adding a new field number doesn't break a client that only reads the old field numbers");

// Now the failure mode the chapter warns against: REUSING a field number changes its meaning.
var corrupted = Encode((1, "KB-01"), (2, "NOT-A-QUANTITY-ANYMORE")); // field 2 reused for something else
if (corrupted[2] is not string)
    throw new Exception("FAIL: expected the reused field number to silently corrupt the old client's read");
Console.WriteLine("OK: reusing a field number (as the chapter warns against) silently corrupts old readers");

// Not runtime-verifiable here (needs a real network/hosting environment) — see Further reading:
// - gRPC transport, HTTP/2, streaming: https://learn.microsoft.com/en-us/aspnet/core/grpc/
// - SignalR transport negotiation and scale-out backplane behavior: https://learn.microsoft.com/en-us/aspnet/core/signalr/introduction
// - Razor Pages/MVC routing, Post-Redirect-Get: https://learn.microsoft.com/en-us/aspnet/core/razor-pages/
// - Blazor render modes: https://learn.microsoft.com/en-us/aspnet/core/blazor/

Console.WriteLine("All checkable claims verified.");
```
