---
id: ms-communication
title: "Communication Between Services: Calls, Messages and the Front Door"
summary: "Kettle's new services must talk across an unreliable network. Covers choosing synchronous or asynchronous communication per interaction, REST vs gRPC between services, latency budgets and deadline propagation, the API gateway and backend-for-frontend with YARP, service discovery, contracts and backward-compatible versioning, and consumer-driven contract tests."
layer: comms
where: Microservices › Communication between services
fits: "Uses the HTTP client and resilience tools from [HttpClient](ch:http-client) and [Resilience](ch:resilience), the broker patterns from [Messaging](ch:messaging-events), and the API rules from [API design](ch:api-design). The data side of the same problem is [Data across services](ch:ms-data)."
levels: i,a
prereqs: ms-boundaries, http-client, resilience
next: ms-data
---

## The 30-second version

- **Default to asynchronous messages** between services, and use synchronous calls only when the caller truly needs an answer right now.
- For synchronous calls between your own services, **gRPC** is faster and stricter; **REST/JSON** is simpler and easier to debug. Both are fine.
- Every synchronous hop adds latency and multiplies failure. Give each request a **deadline** and pass it down the chain.
- Put one **gateway** in front of the services. Clients see one address, and cross-cutting concerns such as TLS, auth checks and rate limits happen once.
- Contracts are the boundary. Change them only in **backward-compatible** ways, and let consumers' tests prove you haven't broken them.

## Words you'll meet

| Word | In plain words |
|---|---|
| **synchronous call** | The caller waits for the answer before carrying on. |
| **asynchronous message** | The sender hands a message to a broker and carries on; the receiver handles it later. |
| **gRPC** | A framework for calling methods on another service, with binary messages over HTTP/2, defined by `.proto` files. |
| **deadline** | The time by which the whole request must finish, passed along to every downstream call. |
| **API gateway** | One entry point that routes requests to the right service. |
| **BFF** | Backend for frontend: a gateway shaped for one kind of client. |
| **service discovery** | How a service finds the current address of another. |
| **contract** | The API or message shape that two services have agreed on. |

## Previously at Kettle {b}

Kettle has four services: Catalogue, Ordering, Payments and Fulfilment. Inside the monolith, they called each other as ordinary method calls, which took nanoseconds and never failed. Across the network, every call takes milliseconds, can time out, and can reach a service that's halfway through a deployment.

**The problem:** the services must cooperate without becoming a chain of fragile, waiting calls.

**This episode:** choosing between calls and messages, REST and gRPC, deadlines, the gateway, discovery, and keeping contracts compatible.

## Start from zero: a method call vs a network call {b}

:::plain
A method call inside one program always arrives and returns quickly. A call to another service can be slow, can fail, or can succeed without you hearing back. Design for all three.
:::

| | Method call in one process | Call to another service |
|---|---|---|
| Time | nanoseconds | milliseconds, sometimes seconds |
| Can it fail? | only with an exception you can see | yes: timeouts, refused connections, the other side restarting |
| Did it happen? | yes, if it returned | **unknown** after a timeout: maybe it ran, maybe it didn't |
| Data | shared objects | copied and serialised, so both sides need the same contract |

That third row is the one that changes designs. After a timeout, the caller can't tell whether Payments charged the card. That's why calls that change things need **idempotency keys** ([API design](ch:api-design)), so a retry can't charge twice.

## Synchronous or asynchronous? {i}

Ask one question for each interaction: **does the caller need the answer before it can respond to its own caller?**

| Interaction at Kettle | Needs the answer now? | Style |
|---|---|---|
| Storefront shows product details | yes: the page can't render without them | synchronous query to Catalogue (or a local read model) |
| Checkout reserves stock | it depends: Kettle can accept the order and confirm stock seconds later | asynchronous command, with the order shown as "confirming" |
| Order placed → send email, update analytics | no | asynchronous event (`OrderPlaced`) |
| Charge the card at checkout | the customer is waiting, but the payment provider may be slow | synchronous with a short timeout, then fall back to "we'll confirm by email" through a queue |

A useful rule: **queries are often synchronous, commands and notifications are often asynchronous.** Every synchronous call adds the callee's availability to your own. Every asynchronous message lets you keep working while the receiver is down, at the price of eventual consistency.

**The availability arithmetic.** If checkout synchronously needs four services, each up 99.9% of the time, checkout is up about 99.6% of the time: roughly three hours of extra downtime a year. Messages break that multiplication, because a service that's briefly down just processes its queue when it returns.

## REST or gRPC between services? {i}

| | REST with JSON | gRPC |
|---|---|---|
| Contract | OpenAPI document, often written after the code | a `.proto` file, the source of truth, from which client and server code is generated |
| Payload | JSON text: readable, larger, slower to parse | Protocol Buffers binary: compact and fast |
| Transport | HTTP/1.1 or HTTP/2 | HTTP/2 only |
| Streaming | awkward | built in: server, client and two-way streaming |
| Browsers | native | needs gRPC-Web or a gateway |
| Debugging | curl, a browser, any tool | needs gRPC-aware tools |

A minimal gRPC contract and its .NET use:

```text
// stock.proto
syntax = "proto3";
service Stock {
  rpc Reserve (ReserveRequest) returns (ReserveReply);
}
message ReserveRequest { string sku = 1; int32 quantity = 2; string order_id = 3; }
message ReserveReply   { bool reserved = 1; int32 remaining = 2; }
```

```csharp norun
// Client side: a typed client generated from stock.proto, registered like an HttpClient
builder.Services.AddGrpcClient<Stock.StockClient>(o => o.Address = new Uri("https://fulfilment"))
                .AddStandardResilienceHandler();

var reply = await stock.ReserveAsync(
    new ReserveRequest { Sku = "TEA-01", Quantity = 2, OrderId = orderId },
    deadline: DateTime.UtcNow.AddMilliseconds(800),          // give up after 800 ms
    cancellationToken: ct);
```

The field numbers (`= 1`, `= 2`) are the real identity of each field on the wire. That's what makes gRPC contracts easy to evolve: add new fields with new numbers, and never reuse or renumber old ones.

Kettle uses gRPC between Ordering and Fulfilment, where calls are frequent and both sides are .NET. Public APIs stay REST, because every client and tool understands them.

## Latency budgets and deadlines {a}

:::plain
Decide how long the customer is allowed to wait in total, then give each step part of that time. Pass the remaining time down, so nobody keeps working on a request that's already been abandoned.
:::

Checkout has a budget of 2 seconds. It calls Ordering, which calls Fulfilment and Payments. If each service has its own independent 5-second timeout, a slow Payments call can keep Fulfilment working for 5 seconds after the customer's browser gave up at 2. That wasted work is exactly what piles up during an incident.

The fix is to **propagate the deadline**: each hop passes on how much time is left, minus its own overhead.

- With gRPC, deadlines are part of the protocol. A deadline set by the caller travels with the call, and ASP.NET Core gRPC services see it as `context.Deadline` and in `context.CancellationToken`.
- With HTTP, pass a `CancellationToken` everywhere and set per-hop timeouts that fit inside the caller's budget ([Resilience](ch:resilience#timeouts)). Some teams also pass the remaining time in a header.

Retries need the same discipline. Retry at **one** layer only, or three layers of three retries become 27 attempts against a service that's already struggling ([Resilience](ch:resilience#retry-done-properly)).

## The gateway: one front door {i}

:::plain
Clients shouldn't need to know that Kettle is now four services. One gateway receives every request and forwards it to the right place, and it's also where shared checks happen once.
:::

An **API gateway** sits between clients and services. It:

- **routes** requests by path or host (`/catalogue/*` → Catalogue, `/orders/*` → Ordering);
- **terminates TLS** and handles cross-cutting concerns once: rejecting requests without a valid token, rate limiting, CORS, request size limits;
- **hides the internal layout**, so services can be split or merged without breaking clients;
- can **aggregate** several service calls into one response for a client, though too much logic here turns the gateway into a new monolith.

In .NET, **YARP** (Yet Another Reverse Proxy) is a library for building a gateway as an ordinary ASP.NET Core app, configured in code or `appsettings.json`:

```json
"ReverseProxy": {
  "Routes": {
    "catalogue": { "ClusterId": "catalogue", "Match": { "Path": "/catalogue/{**rest}" } },
    "orders":    { "ClusterId": "ordering",  "Match": { "Path": "/orders/{**rest}" }, "AuthorizationPolicy": "customer" }
  },
  "Clusters": {
    "catalogue": { "Destinations": { "a": { "Address": "https://catalogue/" } } },
    "ordering":  { "Destinations": { "a": { "Address": "https://ordering/" } } }
  }
}
```

```csharp norun
builder.Services.AddReverseProxy().LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));
var app = builder.Build();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();
app.MapReverseProxy();
```

Because it's ASP.NET Core, all the middleware you know works in front of the proxy. Managed alternatives on Azure are **API Management** (policies, developer portal, subscriptions and quotas) and **Application Gateway** or **Front Door** for routing at the edge.

**Backend for frontend (BFF).** Different clients want different shapes: the mobile app wants small payloads, the Blazor storefront wants page-shaped data, partners want a stable public API. A BFF is a gateway owned by the team that owns that client, shaped for it. It's also where the browser's sign-in cookie is exchanged for tokens ([OAuth & OIDC](ch:oauth-oidc-identity#spas-and-the-bff-pattern)).

## Service discovery {a}

A service needs another's address, and in a cloud environment instances come and go constantly.

- **On Kubernetes and Container Apps**, discovery is built in: each service gets a stable DNS name (`http://fulfilment`, `fulfilment.kettle.svc.cluster.local`), and the platform load-balances across healthy instances ([Kubernetes](ch:kubernetes)).
- **In .NET**, `Microsoft.Extensions.ServiceDiscovery` lets you write logical names like `https+http://fulfilment` in HttpClient and gRPC registrations, resolved from configuration or the platform. .NET Aspire uses it to wire services together locally and in deployment ([Observability & Aspire](ch:observability-aspire#net-aspire)).
- Dedicated registries such as Consul exist for environments without a platform that does it.

Keep addresses out of code and in configuration, so the same build runs everywhere.

## Contracts and versioning {a}

:::plain
Once another team depends on your API or message, its shape is a promise. Add things freely; never remove or rename things others use without a transition period.
:::

The contract between two services is their API or message schema. Independent deployment only works if each side can be released without the other, so every change must be **backward compatible** while old and new versions are both running.

| Safe change | Breaking change |
|---|---|
| add an optional field | remove or rename a field |
| add a new endpoint or message type | change a field's type or meaning |
| accept a new optional parameter | make an optional field required |
| add a new enum value **if** readers tolerate unknown values | change the URL or the message's routing |

For a breaking change, run **both** versions side by side: publish `OrderPlacedV2` alongside `OrderPlaced`, or serve `/v2/orders` alongside `/v1`, move consumers across, then retire the old one. Readers should be **tolerant**: ignore fields they don't know, and don't fail on a new enum value.

**Consumer-driven contract tests** catch breaking changes before deployment. Each consumer writes down what it actually uses from a provider, as a contract file. The provider's build checks every consumer's contract. Pact is the common tool. It replaces most slow end-to-end tests between services, and it tells the provider team exactly which consumer a change would break ([Integration testing](ch:integration-testing)).

## Interview questions {i}

:::qa When do you use synchronous calls vs asynchronous messaging between services?
Use synchronous calls when the caller genuinely needs the answer to respond, typically queries, and keep them few and short with deadlines. Use asynchronous messages for commands that can complete later and for notifications, because they decouple availability: a down service catches up from its queue instead of failing its callers. Each synchronous dependency multiplies availability down and adds latency.
:::

:::qa REST or gRPC between internal services?
gRPC gives a strict, generated contract from `.proto` files, compact binary payloads over HTTP/2, streaming and built-in deadlines, which suits frequent internal calls. REST with JSON is simpler, universally supported and easier to debug, which suits public APIs and browsers. Many systems use gRPC internally and REST at the edge.
:::

:::qa What does an API gateway do, and what's a BFF?
A gateway is a single entry point that routes requests to services, terminates TLS, and applies cross-cutting policies such as authentication checks, rate limits and CORS once, while hiding the internal service layout from clients. A backend for frontend is a gateway tailored to one client type and owned by that client's team, shaping responses for it and often holding its tokens. In .NET, YARP builds gateways as ASP.NET Core apps.
:::

:::qa How do you evolve a service contract without breaking consumers?
Make only backward-compatible changes, such as adding optional fields, endpoints or message types, and have readers ignore unknown fields. For breaking changes, run old and new versions side by side, migrate consumers, then retire the old version. Consumer-driven contract tests let the provider verify every consumer's expectations in its own build.
:::

:::qa Why propagate deadlines through a chain of calls?
So downstream services stop working on requests the original caller has already abandoned. With independent long timeouts, slow dependencies keep doing wasted work after the client gave up, which amplifies overload during incidents. gRPC carries deadlines natively; with HTTP, pass cancellation tokens and set per-hop timeouts within the remaining budget.
:::

## Next episode {b}

Kettle's services can talk. But each now has its own database, and the "my orders" page needs data from three of them, while checkout must stay correct even though no single transaction spans the services. [Episode 3 · Data across services →](ch:ms-data)

## Further reading

- [gRPC on .NET](https://learn.microsoft.com/en-us/aspnet/core/grpc/)
- [YARP documentation](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/yarp/yarp-overview)
- [Service discovery in .NET](https://learn.microsoft.com/en-us/dotnet/core/extensions/service-discovery)
- [API gateway pattern](https://learn.microsoft.com/en-us/azure/architecture/microservices/design/gateway)
- [Pact: consumer-driven contract testing](https://docs.pact.io/)
