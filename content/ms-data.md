---
id: ms-data
title: "Data Across Services: Ownership, Queries and Consistency"
summary: "Each Kettle service now owns its own database, so no transaction spans them and no query can join them. Covers why each service owns its data, why distributed transactions are avoided, how to show data from several services (API composition and read models built from events), keeping copies of other services' data, consistency guarantees users actually need, sagas in practice, reporting across services, and designing the user experience around eventual consistency."
layer: data
where: Microservices › Data across services
fits: "The data side of [Communication](ch:ms-communication). Relies on the outbox, idempotent consumers and sagas from [Messaging](ch:messaging-events), CQRS read models from [CQRS](ch:cqrs-mediator-result), and consistency models from [NoSQL & Redis](ch:nosql-redis)."
levels: i,a
prereqs: ms-communication, messaging-events, cqrs-mediator-result
next: ms-operations
---

## The 30-second version

- **Each service owns its data.** Other services get it through the owner's API or its published events, never by reading its tables.
- There's **no transaction across services**. Two-phase commit is avoided because it couples availability and doesn't fit brokers and cloud databases.
- To show data from several services, either **compose** it at request time (simple, but every service must be up) or keep a **read model** built from events (fast and resilient, but slightly behind).
- Business processes that span services are **sagas**: local transactions plus compensations ([Messaging](ch:messaging-events#sagas-and-process-managers)).
- Decide **which data must be strongly consistent** (money, stock reservations) and let the rest be eventually consistent, then design the screens so users understand it.

## Words you'll meet

| Word | In plain words |
|---|---|
| **database per service** | Each service has its own database that only it reads and writes. |
| **two-phase commit (2PC)** | A protocol where several databases agree to commit one transaction together. |
| **API composition** | Calling several services and combining their answers into one response. |
| **read model / materialised view** | A copy of data, shaped for one screen, kept up to date from events. |
| **eventual consistency** | Copies of data may disagree for a short time, but settle to the same answer. |
| **change data capture (CDC)** | Reading a database's change log to turn row changes into events. |
| **compensation** | A business action that undoes an earlier step, like a refund for a charge. |

## Previously at Kettle {b}

Kettle's four services talk over gRPC, HTTP and the broker. Each now has its own database: Ordering's orders, Payments' charges, Fulfilment's stock and shipments, Catalogue's products. Inside the monolith, the "My orders" page joined five tables in one query, and checkout ran in one transaction.

**The problem:** the join and the transaction both cross service boundaries now.

**This episode:** who owns which data, how to read across services, and how to keep a multi-service process correct without one transaction.

## Start from zero: why not just share the database? {b}

:::plain
If two services read and write the same tables, neither can change those tables without breaking the other, and they're back to being one application.
:::

It's tempting to split the code and leave one shared database. It looks cheaper. But think about what the database schema becomes: a contract that every service depends on, which nobody owns.

- Ordering wants to split the `Address` column into two. Fulfilment's code reads it too, and breaks.
- Payments adds a rule that a charge can't be deleted. A Fulfilment job deletes old rows directly in SQL, bypassing the rule.
- A heavy report from Catalogue locks tables that checkout needs.

So the rule is **one owner per piece of data**. The owner's database is private. Other services get the data the way any outsider does: through the owner's API, or from events the owner publishes. This is what lets each service change its schema, its storage technology, and its deployment schedule on its own.

"Database per service" doesn't have to mean one database **server** per service. Separate schemas or databases on a shared server are fine, as long as each service can only access its own.

## Why no distributed transactions? {i}

In theory, **two-phase commit** can make writes to several databases atomic. A coordinator asks every database "can you commit?" and, if all say yes, tells them all to commit. In practice, microservice systems avoid it:

- **It couples availability.** While a transaction is in doubt, locks are held in every database, so one slow or unreachable participant blocks the others.
- **It couples deployments and technology.** Every participant must support the same protocol. Most message brokers, many cloud databases and every HTTP API don't.
- **It hides a distributed problem behind a local-looking API**, which fails in surprising ways under load.

Instead, each service commits its **own** transaction, and the services coordinate through messages. The tools for that are already in this book: the **transactional outbox** so that "save and publish" can't half-happen, **idempotent consumers** so redelivered messages are harmless, and **sagas** for multi-step processes with compensations ([Messaging](ch:messaging-events)).

## Reading across services {i}

:::plain
Either ask each service at the moment you need the data and stitch the answers together, or keep your own copy of what you need, updated by events, and read that.
:::

The "My orders" page needs: orders (Ordering), payment status (Payments), shipment tracking (Fulfilment) and product names and images (Catalogue).

**Option 1: API composition.** A BFF or the Ordering service calls each service and combines the answers:

```csharp norun
var orders    = await ordering.GetOrdersAsync(customerId, ct);
var ids       = orders.Select(o => o.Id).ToArray();
var payments  = await paymentsApi.GetStatusesAsync(ids, ct);    // one batched call, not one per order
var shipments = await fulfilment.GetShipmentsAsync(ids, ct);
var products  = await catalogue.GetSummariesAsync(orders.SelectMany(o => o.Skus).Distinct(), ct);
return Combine(orders, payments, shipments, products);
```

- Simple, and always shows current data.
- But the page needs **every** service to be up and fast, and its latency is the slowest call. Run independent calls in parallel (`Task.WhenAll`), **batch** them (never one call per order), and decide what to show when one fails, such as hiding tracking rather than failing the page.

**Option 2: a read model built from events.** A service, often the BFF or a dedicated query service, listens to `OrderPlaced`, `PaymentCaptured`, `ParcelShipped` and `ProductRenamed`, and keeps a table shaped exactly like the page:

| OrderId | CustomerId | Placed | Total | PaymentStatus | Tracking | Lines (JSON with names and images) |
|---|---|---|---|---|---|---|

- Reads are a single fast query, and keep working when Payments or Fulfilment is down.
- The data is **slightly behind**: a payment captured a second ago may still show as pending. Events must be handled idempotently and can arrive out of order, so store each source's version and ignore stale updates.
- The read model can be rebuilt from scratch by replaying events, or by re-reading each owner's API, which makes changing its shape safe.

Most systems use both: composition where data must be live and calls are few, read models for busy screens and for searching.

## Keeping copies of other services' data {a}

Services often need a little of each other's data to do their own job. Fulfilment needs product weights. Ordering needs current prices to validate a basket. Asking the owner on every operation recreates temporal coupling, so services keep **local copies** of what they need:

- The owner publishes events when data changes (`ProductWeightChanged`, `PriceChanged`), carrying the new values (**event-carried state transfer**).
- The consumer stores **only the fields it needs**, in its own shape, updated by those events.
- The copy is a **cache with an owner**: never edit it locally, and know how to rebuild it.

Be explicit about **which value counts** when copies disagree. For prices, Kettle's rule is that the price shown when the customer added an item is honoured for 30 minutes. Ordering records the price it used with each order line, instead of trusting whatever Catalogue says later. Recording the values a decision was based on is a good default in any distributed design.

## Which data needs strong consistency? {a}

:::plain
Some numbers must never be wrong, even for a second, like money taken. Most can be a few seconds behind without anyone noticing. Decide which is which, and spend effort only on the first kind.
:::

| Data at Kettle | Consistency needed | How |
|---|---|---|
| A payment captured exactly once | **strong**, inside Payments | one local transaction, unique constraint on order ID, idempotency key to the provider |
| Not selling stock that doesn't exist | **strong for the reservation** | Fulfilment's atomic conditional update reserves stock in its own transaction |
| Order status shown to the customer | eventual (seconds) | read model from events |
| Product name on an old order | eventual, and frozen at order time | copied onto the order line |
| Sales dashboard | eventual (minutes) | analytics pipeline |

The pattern: put each **invariant** ("never oversell", "never charge twice") **inside one service**, where a local transaction can protect it. If an invariant would need two services' data in one transaction, that's a sign the boundary is in the wrong place ([Boundaries](ch:ms-boundaries)).

## Sagas in practice {a}

Checkout spans three services, so it's a **saga**: a sequence of local transactions, each triggered by the previous step's event, with a compensating action for each step that might need undoing ([Messaging](ch:messaging-events#sagas-and-process-managers)).

1. **Ordering**: create the order as `Pending`, publish `OrderSubmitted` (through the outbox).
2. **Fulfilment**: reserve stock. Publish `StockReserved`, or `StockUnavailable`.
3. **Payments**: charge the card. Publish `PaymentCaptured`, or `PaymentFailed`.
4. **Ordering**: mark the order `Confirmed`. On failure, compensate: release the stock (Fulfilment), and mark the order `Cancelled`.

Questions every saga design must answer:

- **Orchestrated or choreographed?** Kettle uses an **orchestrator** in Ordering, a state machine persisted in its database, because the checkout flow is central and the team wants one place to see where each order is. Choreography, where each service reacts to the others' events, suits short flows with few steps.
- **What if a step never answers?** Every state has a **timeout** that triggers compensation or an alert, so orders can't sit in `Pending` forever.
- **Which steps can't be undone?** A sent email can't be unsent. Put irreversible steps **last**, after the steps that might fail.
- **What do users see in between?** "Order received, confirming payment…", rather than pretending the order is complete.

Libraries such as MassTransit (state machine sagas), NServiceBus and Wolverine handle the persistence, timeouts and message correlation. Durable workflow engines (Durable Functions, Temporal, Dapr Workflow) model the same thing as code that waits ([Azure compute](ch:azure-compute)).

## Reporting across services {a}

Finance wants revenue by product by region, which joins data from every service. Don't let a reporting tool connect to the services' databases: that's the shared database again, through the back door.

Instead, feed an **analytics store** from the services' events, or from **change data capture** on their databases (Debezium, or the database's own CDC feature), into a data warehouse or lake (Fabric, Synapse, BigQuery, Snowflake). Reports then run there, minutes behind, without touching production databases or depending on internal schemas. If you use CDC, treat the captured tables as a published contract: the service team owns them and changes them carefully, or publishes a dedicated, stable view for analytics.

## Designing screens for eventual consistency {i}

Users don't mind data that's a moment behind. They mind data that seems **wrong**. A few techniques:

- **Show the state honestly.** "Payment processing" is better than a spinner, and much better than "Confirmed" followed later by "Cancelled".
- **Read your own writes.** After a customer changes their address, show the value they just saved, from the response, rather than re-reading a read model that hasn't caught up.
- **Push the update when it lands.** SignalR or Blazor Server can update the order page when `PaymentCaptured` arrives, instead of making the user refresh.
- **Make actions idempotent**, so a user who clicks again because the screen looked stale doesn't do something twice.

## Interview questions {i}

:::qa Why should each microservice own its database?
Because a shared schema becomes an unowned contract: any change can break unknown readers, business rules can be bypassed by direct writes, and the services can no longer change or deploy independently. Each service's data should be private, exposed only through its API and published events. It can still share a database server, as long as access is separated.
:::

:::qa How do you handle a business transaction that spans several services?
With a saga: a sequence of local transactions, each publishing an event that triggers the next, with compensating actions to undo completed steps when a later one fails. Use the outbox so each step's save and publish are atomic, idempotent consumers for redelivery, timeouts so the saga can't hang, and put irreversible steps last. Keep invariants that need strong consistency inside a single service.
:::

:::qa Why avoid two-phase commit in microservices?
It holds locks across participants while the outcome is in doubt, so one slow or failed participant blocks the others and availability is coupled. It requires every participant to support the protocol, which most brokers, cloud databases and HTTP APIs don't, and it couples deployments. Local transactions with the outbox and sagas achieve consistency without those costs.
:::

:::qa How do you build a page that needs data from several services?
Either compose at request time, calling the services in parallel and in batches, which gives fresh data but depends on all of them being available, or maintain a read model updated from their events, which is fast and resilient but slightly stale. Handle partial failures explicitly, and make event handling idempotent and tolerant of out-of-order delivery.
:::

:::qa How do you produce reports across many services?
Not by querying their databases directly. Stream their events, or change data capture from their databases, into an analytics store such as a warehouse or lake, and report from there. The captured data then needs to be treated as a published, owned contract.
:::

## Next episode {b}

Kettle's services own their data and stay consistent. Now there are four services to build, deploy, secure, test and debug, and a dozen more on the roadmap. [Episode 4 · Running microservices →](ch:ms-operations)

## Further reading

- [Data considerations for microservices](https://learn.microsoft.com/en-us/azure/architecture/microservices/design/data-considerations)
- [Saga pattern](https://learn.microsoft.com/en-us/azure/architecture/reference-architectures/saga/saga)
- [Materialized view pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/materialized-view)
- [Transactional outbox pattern](https://learn.microsoft.com/en-us/azure/architecture/databases/guide/transactional-outbox-cosmos)
