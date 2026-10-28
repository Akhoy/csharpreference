---
id: messaging-events
title: Messaging and Event-Driven Architecture
summary: Asynchronous communication between services. Why messaging, commands vs events vs queries, queues and topics, brokers compared (Service Bus, RabbitMQ, Kafka/Event Hubs), delivery guarantees, the dual-write problem and the transactional outbox, idempotent consumers and the inbox, retries and dead-lettering, ordering, sagas (orchestration and choreography), MassTransit/NServiceBus/Wolverine, message design and versioning, and event sourcing.
layer: comms
where: Service communication › Asynchronous messaging & events
fits: The asynchronous half of layer 6, and the glue of distributed systems ([Microservices](ch:microservices)). Messages originate from domain events ([DDD](ch:ddd)) persisted via the EF Core outbox ([EF Core advanced](ch:efcore-advanced#domain-events-and-the-outbox-on-savechanges)), are consumed by hosted services ([Background work](ch:background-work)), run on cloud brokers ([Azure data & messaging](ch:azure-data-messaging)), and need resilience ([Resilience](ch:resilience)) and tracing ([Observability](ch:observability-aspire)).
levels: b,i,a
prereqs: background-work, microservices
next: resilience, observability-aspire, azure-data-messaging
---

## TL;DR

- A broker sits between services so the sender doesn't wait: it hands off a message and moves on, decoupled in time from whoever eventually reads it.
- **Commands** (do this, exactly one handler, can be rejected) go on **queues**; **events** (this happened, zero or more subscribers) go on **topics**.
- Brokers deliver **at-least-once**, never exactly-once — duplicates are a normal outcome of coordinating two systems over a network, not a bug. Every consumer must be **idempotent**.
- The **dual-write problem** (you can't atomically save to your DB and publish to a broker) is solved by the **transactional outbox**: write the message to a table in the same transaction as the business change, then let a separate worker publish it.
- Most brokers don't guarantee global order; design for disorder (sequence numbers, partition/session keys) instead of assuming it.
- A **saga** runs a multi-step business process as a chain of local transactions with compensating "undo" steps, either coordinated by services reacting to each other's events (**choreography**) or by a central state machine (**orchestration**).

## What putting a broker in the middle actually buys you {b}

With synchronous HTTP between services, the caller **waits**, and if the callee is down or slow, that failure propagates straight back to the caller — exactly the "chatty synchronous chains" problem [Microservices](ch:microservices#why-microservices-and-what-they-genuinely-cost) warned about. **Messaging** fixes this by putting a **broker** in between: the sender hands a message to the broker and moves on; receivers process it when they can, entirely decoupled from whether the sender is even still running.

```text
Synchronous:   Ordering ──HTTP──▶ Payments ──HTTP──▶ Email        (all must be up, latency adds up, failures cascade)

Asynchronous:  Ordering ──▶ [ broker: "OrderPlaced" ] ──▶ Payments
                                                     ├──▶ Email
                                                     └──▶ Analytics   (added later without touching Ordering)
```

| Benefit | Meaning |
|---|---|
| **Temporal decoupling** | Producer and consumer don't need to be up at the same time |
| **Load levelling** | A spike of 10,000 orders queues up; consumers process at their own pace |
| **Fault isolation** | Email being down doesn't stop checkout |
| **Extensibility** | New subscribers react to existing events without changing the publisher |
| **Scalability** | Add consumer instances (competing consumers) to increase throughput |

Notice the diagram's last line: Analytics was "added later without touching Ordering" — that's the Observer pattern from [Design patterns](ch:design-patterns#observer) operating at the scale of entire services, where the publisher never needs to know who's listening. Costs: **eventual consistency**, more infrastructure, harder debugging (needs tracing), duplicate and out-of-order delivery to handle, and message versioning — each of which gets its own section below.

## Commands, events and queries: three different conversations {b}

| | Command | Event | Query |
|---|---|---|---|
| Meaning | "Please do X" | "X happened" | "Tell me X" |
| Naming | Imperative: `ChargePayment`, `SendInvoice` | Past tense: `OrderPlaced`, `PaymentFailed` | `GetOrderStatus` |
| Receivers | **Exactly one** logical handler | **Zero or many** subscribers | One |
| Sender knows the receiver? | Yes (sends to a specific queue) | No (publishes to a topic) | Yes |
| Can be rejected? | Yes | No: it already happened | — |
| Typical channel | **Queue** | **Topic** (pub/sub) | Usually HTTP/gRPC, not messaging |

This is the exact same Command-vs-Event naming discipline from [Design patterns](ch:design-patterns#command), now mapped onto concrete infrastructure choices — a command's "exactly one handler" nature is precisely why it belongs on a queue, while an event's "zero or many subscribers" nature is precisely why it belongs on a topic.

**Event types:** *notification events* (thin: `OrderPlaced { OrderId }`, consumers call back for details) vs *event-carried state transfer* (fat: includes the data consumers need, so no callback). Fat events reduce coupling at runtime but increase schema coupling.

## Queues and topics {b}

```text
QUEUE (point-to-point, competing consumers)         TOPIC (publish/subscribe)
Producer ─▶ [ m3 m2 m1 ] ─▶ Consumer A (gets m1)     Publisher ─▶ (topic) ─┬─▶ [subscription: billing ] ─▶ Billing
                         └▶ Consumer B (gets m2)                          ├─▶ [subscription: email   ] ─▶ Email
each message goes to ONE consumer instance                                └─▶ [subscription: search  ] ─▶ Search
                                                    each subscription gets its OWN copy
```

A message is processed by **one** instance per queue or subscription, so scaling out consumers increases throughput without duplicate processing (in theory: see delivery guarantees, next).

## Brokers compared {i}

| | **Azure Service Bus** | **RabbitMQ** | **Kafka / Azure Event Hubs** | Azure Storage Queues |
|---|---|---|---|---|
| Model | Enterprise message broker: queues + topics/subscriptions | Broker with exchanges (direct, topic, fanout, headers) routing to queues | **Distributed append-only log** partitioned into topics | Simple queue |
| Consumption | Message removed when completed | Message removed when acked | Consumers track **offsets**; messages **retained** (days, or forever with compaction) and **replayable** | Removed when deleted |
| Ordering | FIFO per **session** | Per queue (single consumer) | Per **partition** | Best effort |
| Features | Sessions, dead-letter queues, scheduled messages, duplicate detection, transactions, filters, auto-forwarding | Flexible routing, plugins, quorum queues, streams | Huge throughput, replay, stream processing, consumer groups | Cheap, massive scale, basic |
| Hosting | Fully managed PaaS | Self-hosted, or CloudAMQP etc. | Confluent / self-hosted Kafka; **Event Hubs** (managed, Kafka-compatible) | Managed |
| Best for | Business commands and events, workflows | On-premises / multi-cloud, flexible routing | Event streaming, telemetry, analytics, event sourcing pipelines | Simple background jobs |

The "Consumption" row is the real distinguishing feature between Service Bus and Kafka, worth being precise about: Service Bus *removes* a message once it's handled, treating messages as work to be consumed and discarded; Kafka *retains* everything and lets consumers independently track their own position in the log, treating messages as a durable, replayable history. That difference is why Kafka fits event sourcing pipelines naturally and Service Bus doesn't — replay only makes sense if nothing was removed.

Also on Azure: **Event Grid**, a push-based **event router** for reactive programming (a blob was created, a resource changed, custom events to webhooks or functions). It's lightweight notification fan-out, not a work queue. See [Azure data & messaging](ch:azure-data-messaging).

## Delivery guarantees: why "exactly once" isn't really on the table {i}

| Guarantee | Meaning | Reality |
|---|---|---|
| At-most-once | Delivered 0 or 1 times (may be lost) | Fire-and-forget; acceptable for metrics |
| **At-least-once** | Delivered 1 or more times (**duplicates possible**) | **The default for virtually all brokers** |
| Exactly-once | Delivered precisely once | Not achievable end-to-end across systems in general; you get **effectively-once** via idempotency |

Duplicates aren't a quality-of-implementation problem — they're unavoidable. A consumer can crash right after finishing the work but **before acknowledging** it; the broker has no way to know the work actually finished, so it redelivers to someone else. A producer can time out waiting for an acknowledgment and retry a publish that, unknown to it, already succeeded. A processing lock can expire during unusually slow work, letting a second instance pick up the same message. None of these are broker bugs — they're the honest cost of coordinating two independent systems over a network that can always be slow or drop a packet.

**Therefore every consumer must be idempotent.** The rest of this chapter builds directly on that one conclusion.

## The dual-write problem and the transactional outbox {a}

```csharp
// ✘ Two separate writes: no transaction spans the database AND the broker
db.Orders.Add(order);
await db.SaveChangesAsync(ct);                       // 1. committed
await bus.Publish(new OrderPlaced(order.Id), ct);    // 2. process crashes here → order exists but the event is LOST
// Reverse the order and you get: event published, then SaveChanges fails → event for an order that doesn't exist
```

This is the **dual-write problem**. Swapping the order of the two writes doesn't fix it — it just swaps which failure you get instead. The database transaction and the broker publish are two separate systems with no shared commit between them, which is exactly the "no distributed transactions across services" limit [EF Core advanced](ch:efcore-advanced#transactions-when-savechangess-own-transaction-isnt-enough) named.

**Transactional outbox:** write the message to an **Outbox table in the same database transaction** as the business change. A separate **relay** publishes outbox rows to the broker and marks them sent.

```text
┌──────────── one DB transaction ────────────┐
│ INSERT INTO Orders …                         │
│ INSERT INTO OutboxMessages (Id, Type, Payload)│      Outbox relay (BackgroundService, or CDC)
└──────────────────────────────────────────────┘ ───▶ reads unsent rows ─▶ publishes ─▶ marks ProcessedAt
     either both commit or neither                   (retries on failure → at-least-once publishing)
```

Follow exactly how this closes the gap the naive code left open: the `Orders` insert and the `OutboxMessages` insert are now part of **one** atomic transaction, so there is no longer a window where the order exists but the event doesn't, or vice versa. The relay's own publish can still fail and retry — but that's fine, because it's now publishing from durable, already-committed data, and retrying a publish that already succeeded is just another instance of the at-least-once guarantee this chapter already accepted as the baseline.

```csharp
public sealed class OutboxRelay(IServiceScopeFactory scopes, IMessagePublisher publisher, ILogger<OutboxRelay> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(2));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await using var scope = scopes.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<ShopDb>();
            var batch = await db.OutboxMessages
                .FromSql($"SELECT TOP (50) * FROM OutboxMessages WITH (UPDLOCK, READPAST, ROWLOCK) WHERE ProcessedAt IS NULL ORDER BY OccurredAt")
                .ToListAsync(stoppingToken);                                       // READPAST lets several relays run without clashing
            foreach (var msg in batch)
            {
                try
                {
                    await publisher.PublishAsync(msg.Type, msg.Payload, messageId: msg.Id, stoppingToken);   // message id = outbox id (for dedup)
                    msg.ProcessedAt = DateTimeOffset.UtcNow;
                }
                catch (Exception ex) { msg.Attempts++; msg.LastError = ex.Message; log.LogWarning(ex, "Outbox publish failed for {Id}", msg.Id); }
            }
            await db.SaveChangesAsync(stoppingToken);
        }
    }
}
```

Variants: polling (above), **change data capture** (Debezium or SQL CDC streaming the outbox table), and library-provided outboxes (**MassTransit**, **NServiceBus**, **Wolverine**, **Brighter** all ship EF Core outboxes). Prefer a library's outbox over hand-rolling one in production — the `READPAST` locking detail above is exactly the kind of subtlety a mature library has already handled correctly.

## Idempotent consumers and the inbox {a}

Make processing the same message twice harmless — not by preventing duplicates (impossible, as established above) but by making a duplicate's second arrival a no-op:

| Technique | Example |
|---|---|
| **Naturally idempotent operations** | `SET status = 'Paid'` (not `balance = balance - 10`); upserts |
| **Inbox / processed-messages table** | Store the message ID **in the same transaction** as the handler's changes, with a unique key; skip if already present |
| **Business keys + unique constraints** | `Payments` has a unique `OrderId`, so a second insert fails and is treated as already handled |
| **Version checks** | Apply an update only if the entity is still at the expected version |
| **Broker duplicate detection** | Service Bus duplicate detection by `MessageId` within a time window (helps with producer retries, not consumer crashes) |

```csharp
public sealed class ChargeOnOrderPlaced(ShopDb db, IPaymentGateway payments) : IConsumer<OrderPlaced>
{
    public async Task Consume(ConsumeContext<OrderPlaced> ctx)
    {
        var messageId = ctx.MessageId!.Value;
        if (await db.InboxMessages.AnyAsync(m => m.Id == messageId)) return;          // already processed

        await using var tx = await db.Database.BeginTransactionAsync();
        var result = await payments.ChargeAsync(ctx.Message.OrderId, ctx.Message.Total, idempotencyKey: ctx.Message.OrderId.ToString());
        db.Payments.Add(new Payment(ctx.Message.OrderId, result.Reference));
        db.InboxMessages.Add(new InboxMessage(messageId, nameof(OrderPlaced), DateTimeOffset.UtcNow));   // unique PK
        await db.SaveChangesAsync();
        await tx.CommitAsync();
    }
}
```

Note the **idempotency key passed to `payments.ChargeAsync`** — the exact pattern from [API design](ch:api-design#idempotency-keys-for-post-making-the-one-unsafe-by-default-m) — because the inbox table alone only protects your own database. The payment provider is a *different* system with no visibility into your inbox, so if this consumer crashes after charging but before the inbox row commits, redelivery would charge the card a second time unless the idempotency key passed to the gateway itself prevents it. External side effects always need their own deduplication, because your database transaction can't roll back a card charge.

## Retries, poison messages and dead-lettering {i}

- **Immediate retries** for transient glitches (deadlocks, brief timeouts).
- **Delayed redelivery** with backoff (seconds → minutes) for longer outages of a dependency.
- **Dead-letter queue (DLQ)**: after N failed attempts, move the message aside so it doesn't block the queue or burn resources (a **poison message**). Alert on DLQ depth; inspect, fix, then **resubmit**.
- Distinguish **transient** errors (retry) from **permanent** ones (validation failure or unknown entity: dead-letter immediately, no point retrying).

```csharp
// MassTransit retry/redelivery configuration
cfg.ReceiveEndpoint("billing-order-placed", e =>
{
    e.UseMessageRetry(r => r.Exponential(5, TimeSpan.FromMilliseconds(200), TimeSpan.FromSeconds(10), TimeSpan.FromMilliseconds(200))
                            .Ignore<ValidationException>());
    e.UseDelayedRedelivery(r => r.Intervals(TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(30)));
    e.UseEntityFrameworkOutbox<ShopDb>(context);          // inbox/outbox for this endpoint
    e.ConfigureConsumer<ChargeOnOrderPlaced>(context);
});
```

## Ordering: a guarantee most brokers deliberately don't give you {a}

Most brokers **don't guarantee global order**, and with competing consumers and retries, messages can be processed out of order even when they arrived in order — two consumers picking up two messages at nearly the same instant have no way to coordinate which one finishes first.

Strategies:

- **Partition by key**: Service Bus **sessions** (`SessionId = orderId`) or Kafka **partition keys** guarantee FIFO **per key** with one consumer per session/partition at a time — ordering is given up globally in exchange for throughput, but preserved exactly where it usually matters: within one entity's own history.
- **Design for disorder**: include a **version or sequence number** or timestamp; ignore stale updates (`if (msg.Version <= entity.Version) return;`).
- **Make events commutative** where possible.
- Avoid needing order across different entities at all.

## Sagas and process managers {a}

A business process spanning services (place order → reserve stock → charge payment → ship) can't use one ACID transaction — exactly the "one transaction modifies one aggregate" rule from [DDD](ch:ddd#aggregates-the-most-important-tactical-pattern-and-the-harde), now playing out across service boundaries rather than aggregate boundaries. A **saga** is a sequence of **local transactions**, each publishing an event that triggers the next step. If a step fails, **compensating actions** undo the previous steps semantically (refund the payment, release the stock) — there's no rollback in the database sense, only a deliberate action that reverses the business effect.

| Style | How | Pros | Cons |
|---|---|---|---|
| **Choreography** | Each service listens for events and reacts, emitting its own events; no central coordinator | Loose coupling, simple for short flows | Flow is implicit and spread across services; hard to see, test and change; risk of cyclic dependencies |
| **Orchestration** | A **saga orchestrator** (state machine) sends commands to each service and reacts to replies | Explicit flow in one place; easier timeouts, monitoring and compensation | The orchestrator is a central component to build and run |

Notice the tradeoff is the same one choreography vs orchestration always presents in distributed design: choreography trades visibility for decoupling, orchestration trades a central dependency for the ability to actually *see* the whole process in one place — invaluable once something has gone wrong at 3 a.m. and you need to know exactly which step the order is stuck on.

```text
Orchestrated order saga (state machine):
  [Submitted] ──ReserveStock──▶ Inventory ──StockReserved──▶ [StockReserved] ──ChargePayment──▶ Payments
       │                                                              │
       │                                         PaymentFailed ◀──────┘
       ▼                                              │
  StockReservationFailed → [Rejected]          ReleaseStock (compensate) → [Cancelled]
                                                PaymentCharged → ShipOrder → [Completed]
  Timeout after 15 min in any state → compensate → [Cancelled]
```

```csharp
// MassTransit state machine saga (persisted with EF Core)
public sealed class OrderSaga : MassTransitStateMachine<OrderState>
{
    public State Reserving { get; private set; } = null!;
    public State Charging { get; private set; } = null!;
    public State Completed { get; private set; } = null!;
    public Event<OrderSubmitted> Submitted { get; private set; } = null!;
    public Event<StockReserved> Reserved { get; private set; } = null!;
    public Event<PaymentFailed> PaymentFailed { get; private set; } = null!;
    public Event<PaymentCharged> Charged { get; private set; } = null!;

    public OrderSaga()
    {
        InstanceState(x => x.CurrentState);
        Event(() => Submitted, x => x.CorrelateById(m => m.Message.OrderId));
        Event(() => Reserved,  x => x.CorrelateById(m => m.Message.OrderId));
        Event(() => PaymentFailed, x => x.CorrelateById(m => m.Message.OrderId));
        Event(() => Charged,   x => x.CorrelateById(m => m.Message.OrderId));

        Initially(When(Submitted).Then(c => c.Saga.Total = c.Message.Total)
            .Send(c => new ReserveStock(c.Saga.CorrelationId)).TransitionTo(Reserving));
        During(Reserving, When(Reserved).Send(c => new ChargePayment(c.Saga.CorrelationId, c.Saga.Total)).TransitionTo(Charging));
        During(Charging,
            When(Charged).Publish(c => new OrderConfirmed(c.Saga.CorrelationId)).TransitionTo(Completed),
            When(PaymentFailed).Send(c => new ReleaseStock(c.Saga.CorrelationId)).Finalize());
    }
}
```

Notice this is exactly the State pattern from [Design patterns](ch:design-patterns#state), now coordinating across service boundaries rather than within one class — `Reserving` and `Charging` are states, and each `Event(...)` transition is the same idea as `OrderState.Pay()` returning a new state, just driven by messages instead of method calls.

Alternatives for long-running orchestration: **Azure Durable Functions**, **Temporal**, **Dapr Workflows**, NServiceBus sagas.

## Messaging libraries for .NET {i}

Using the raw broker SDKs (`Azure.Messaging.ServiceBus`, `RabbitMQ.Client`, `Confluent.Kafka`) is fine for simple cases. Libraries add the hard parts: serialization, topology, retries, the outbox/inbox, sagas, scheduling, test harnesses and OpenTelemetry.

| Library | Notes |
|---|---|
| **MassTransit** | Most popular; supports RabbitMQ, Service Bus, Amazon SQS, Kafka; sagas; EF outbox. **v9+ is commercial**; v8 remains open source |
| **NServiceBus** (Particular) | Commercial, very mature, excellent tooling (ServicePulse/ServiceInsight) |
| **Wolverine** (JasperFx) | Mediator plus messaging, with a durable outbox/inbox integrated with Marten/EF Core; MIT |
| **Rebus**, **Brighter** | Open-source alternatives |
| **Dapr pub/sub** | A sidecar abstraction over many brokers |

```csharp
// Raw Service Bus SDK (minimal)
await using var client = new ServiceBusClient("shop.servicebus.windows.net", new DefaultAzureCredential());
await using var sender = client.CreateSender("orders");
await sender.SendMessageAsync(new ServiceBusMessage(BinaryData.FromObjectAsJson(new OrderPlaced(id, total)))
{
    MessageId = id.ToString(), Subject = nameof(OrderPlaced), SessionId = customerId, CorrelationId = Activity.Current?.TraceId.ToString()
});

var processor = client.CreateProcessor("orders", new ServiceBusProcessorOptions { MaxConcurrentCalls = 8, AutoCompleteMessages = false });
processor.ProcessMessageAsync += async args =>
{
    var evt = args.Message.Body.ToObjectFromJson<OrderPlaced>();
    await HandleAsync(evt, args.CancellationToken);
    await args.CompleteMessageAsync(args.Message);                 // ack only after successful processing
};
processor.ProcessErrorAsync += args => { logger.LogError(args.Exception, "Service Bus error"); return Task.CompletedTask; };
await processor.StartProcessingAsync();
```

Notice `AutoCompleteMessages = false` and the explicit `CompleteMessageAsync` call only *after* `HandleAsync` succeeds — exactly the deliberate acknowledge-after-processing discipline that makes the "crash before ack → redelivery" failure mode from the delivery-guarantees section above a safe, expected occurrence rather than a lost message.

## Message design and versioning {a}

- **Contracts are APIs**: version them carefully and publish them as a small shared contracts package or a schema (JSON Schema, Avro/Protobuf with a schema registry).
- Include **metadata**: `MessageId`, `CorrelationId`/trace context, `CausationId`, `OccurredAt`, type and version. CloudEvents is a standard envelope format.
- **Evolve compatibly**: add optional fields; never rename or remove fields that consumers use; for breaking changes, publish **v2 alongside v1** until consumers migrate.
- **Tolerant readers**: consumers ignore unknown fields and handle missing optional ones.
- Keep messages **small**; for big payloads use the **claim-check** pattern (store the blob, send its reference).
- Don't leak internal domain models: map **domain events** to stable **integration events**, the exact distinction [DDD](ch:ddd#domain-events-a-record-of-something-that-already-happened) drew between what an aggregate raises internally and what actually crosses a service boundary.

## Event sourcing {a}

Instead of storing current state, **store the full sequence of events** that led to it. Current state is a **left fold** over the events — a fancy way of saying: start from a blank state and apply each event to it, in order, one at a time, the same way a bank statement's running balance is just "start at 0, apply every transaction in order."

```text
Stream "account-42":  AccountOpened(€0) → Deposited(€100) → Withdrawn(€30) → Deposited(€50)   ⇒ balance €120
```

| Benefits | Costs |
|---|---|
| Complete audit trail and history ("what did we know on 1 March?") | Different mental model; harder queries (needs CQRS projections) |
| Rebuild read models or new projections from history | Event schema evolution (**upcasting**: converting an old event's saved shape into the current one when you read it back, since you can never change history itself) |
| Natural fit with event-driven integration | **Snapshots** needed for long streams (a saved current state at some point, so replay starts there instead of from event #1); eventual consistency of projections |
| Debugging by replay | Tooling and team experience required |

.NET options: **Marten** (event store on PostgreSQL), **EventStoreDB/KurrentDB**, or Cosmos DB with the change feed. Use event sourcing for domains where history *is* the value (finance, ledgers, compliance, workflows), not as a default — recall from [CQRS & Result](ch:cqrs-mediator-result#levels-of-cqrs-a-spectrum-not-a-binary-choice) that it's the highest-complexity rung on that ladder for a reason.

:::qa Why use messaging instead of direct HTTP calls between services?
It decouples services in time (both needn't be up), levels load spikes through queues, isolates failures (a down consumer doesn't break the producer), enables pub/sub fan-out to new consumers without changing producers, and scales via competing consumers. The trade-offs are eventual consistency and operational complexity.
:::

:::qa What's the difference between a queue and a topic?
A queue delivers each message to one consumer among competing consumers, which suits commands and work distribution. A topic delivers a copy to each subscription, which suits events consumed by multiple independent services.
:::

:::qa Commands vs events?
A command asks one specific handler to do something (imperative name, can be rejected, sent to a queue). An event announces that something happened (past tense, can't be rejected, published to any number of subscribers).
:::

:::qa What is the outbox pattern and what problem does it solve?
It solves the dual-write problem: you can't atomically commit to the database and publish to a broker. Writing the outgoing message to an outbox table in the same transaction as the business data, then having a relay publish it and mark it processed, guarantees the message is eventually published if and only if the transaction committed (at-least-once).
:::

:::qa How do you make a message consumer idempotent?
Use naturally idempotent operations (upserts, setting state), or record processed message IDs in an inbox table in the same transaction as the handler's changes (with a unique key) and skip duplicates. Use business-key unique constraints and version checks, and pass idempotency keys to external providers for side effects outside your database.
:::

:::qa What delivery guarantee do brokers usually provide?
At-least-once: messages may be delivered more than once (redelivery after a crash before ack, producer retries, lock expiry). Exactly-once end-to-end isn't generally achievable, so consumers must be idempotent to achieve effectively-once processing.
:::

:::qa What is a dead-letter queue?
A secondary queue where messages are moved after exceeding max delivery attempts or failing permanently (poison messages), so they don't block processing. Monitor it, investigate, fix the cause and resubmit.
:::

:::qa What is a saga? Orchestration vs choreography?
A saga coordinates a multi-service business transaction as a series of local transactions with compensating actions on failure. In choreography, services react to each other's events with no central controller (loosely coupled, but the flow is implicit). In orchestration, a state-machine orchestrator sends commands and tracks progress (an explicit, monitorable flow with a central component).
:::

:::qa How do you handle message ordering?
Most brokers don't guarantee global order, especially with competing consumers. Guarantee order per key with Service Bus sessions or Kafka partitions; otherwise design consumers to tolerate disorder using version numbers or timestamps to discard stale updates.
:::

:::qa Service Bus vs Kafka/Event Hubs?
Service Bus is a message broker for business messaging: messages are removed when completed, and it offers sessions, dead-lettering, transactions, scheduling and duplicate detection. Kafka/Event Hubs are distributed logs for high-throughput event streaming: messages are retained and replayable, consumers track offsets, and ordering is per partition.
:::

## Further reading

- [Transactional outbox pattern (Azure Architecture Center)](https://learn.microsoft.com/en-us/azure/architecture/databases/guide/transactional-outbox-cosmos)
- [Saga distributed transactions pattern](https://learn.microsoft.com/en-us/azure/architecture/reference-architectures/saga/saga)
- [Azure Service Bus documentation](https://learn.microsoft.com/en-us/azure/service-bus-messaging/)
- *Enterprise Integration Patterns* (Hohpe & Woolf): the classic messaging pattern language.
- [MassTransit documentation](https://masstransit.io/) · [Wolverine](https://wolverinefx.net/) · [Marten event sourcing](https://martendb.io/)

## Verify this chapter

Run with `dotnet run` (plain console app, .NET 8/9, top-level statements, BCL only). Real brokers, real outboxes and real crash scenarios aren't runtime-verifiable in a standalone script — the checks below model the underlying logic (dedup, partitioning, folding) that those mechanisms rely on.

```csharp
// Claim: an inbox table makes a duplicate delivery a no-op instead of double-applying the work.
var inbox = new HashSet<Guid>();
int paymentsCharged = 0;
void HandleOrderPlaced(Guid messageId)
{
    if (!inbox.Add(messageId)) return; // already processed: this redelivery is a safe no-op
    paymentsCharged++;
}
var sameMessageId = Guid.NewGuid();
HandleOrderPlaced(sameMessageId); // first delivery
HandleOrderPlaced(sameMessageId); // redelivery after a crash-before-ack
if (paymentsCharged != 1) throw new Exception($"FAIL: expected exactly 1 charge, got {paymentsCharged}");
Console.WriteLine("OK: an inbox of seen message IDs makes a redelivered message a no-op (idempotent consumer)");

// Claim: a queue's "competing consumers" split work so each message goes to exactly one consumer, none lost, none duplicated.
var messages = Enumerable.Range(1, 10).ToList();
var consumerAInbox = new List<int>();
var consumerBInbox = new List<int>();
for (int i = 0; i < messages.Count; i++)
    (i % 2 == 0 ? consumerAInbox : consumerBInbox).Add(messages[i]); // round-robin stands in for "whoever's free next"
var allProcessed = consumerAInbox.Concat(consumerBInbox).OrderBy(x => x).ToList();
if (!allProcessed.SequenceEqual(messages)) throw new Exception("FAIL: every message should be processed exactly once across both consumers");
if (consumerAInbox.Intersect(consumerBInbox).Any()) throw new Exception("FAIL: no message should go to both consumers");
Console.WriteLine("OK: competing consumers on a queue split the work with no message lost or duplicated");

// Claim: with a per-key partition/session, messages for the SAME key stay in order even if the
// overall arrival order across different keys is shuffled.
var arrivalOrder = new[]
{
    ("order-1", 1), ("order-2", 1), ("order-1", 2), ("order-2", 2), ("order-1", 3)
};
var perKeyOrder = arrivalOrder
    .GroupBy(m => m.Item1)
    .ToDictionary(g => g.Key, g => g.Select(m => m.Item2).ToList());
if (!perKeyOrder["order-1"].SequenceEqual([1, 2, 3])) throw new Exception("FAIL: order-1's own events should stay in sequence 1,2,3");
if (!perKeyOrder["order-2"].SequenceEqual([1, 2])) throw new Exception("FAIL: order-2's own events should stay in sequence 1,2");
Console.WriteLine("OK: partitioning by key preserves per-key order even though global order isn't guaranteed");

// Claim: event sourcing's "current state" is a left fold — start from a blank state, apply each event in order.
decimal Balance(IEnumerable<(string Kind, decimal Amount)> events) =>
    events.Aggregate(0m, (balance, e) => e.Kind switch
    {
        "Deposited" => balance + e.Amount,
        "Withdrawn" => balance - e.Amount,
        _ => balance
    });
var accountEvents = new[] { ("Opened", 0m), ("Deposited", 100m), ("Withdrawn", 30m), ("Deposited", 50m) };
var finalBalance = Balance(accountEvents);
if (finalBalance != 120m) throw new Exception($"FAIL: expected balance 120, got {finalBalance}");
Console.WriteLine($"OK: replaying events as a left fold (start at 0, apply each in order) gives the correct balance ({finalBalance})");
```
