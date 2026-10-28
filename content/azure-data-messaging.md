---
id: azure-data-messaging
title: Azure Data, Storage and Messaging Services
summary: The managed building blocks behind most .NET backends. Azure SQL Database (tiers, serverless, HA, geo-replication, security), Azure Database for PostgreSQL, Cosmos DB, Storage accounts (Blob tiers, SAS, Queues, Tables, Files), Azure Managed Redis, Service Bus vs Event Grid vs Event Hubs, and using Azure SDK clients correctly from .NET.
layer: data
where: Data & state › Managed cloud data services (Azure)
fits: These are the cloud-hosted versions of layer-5 stores ([Relational fundamentals](ch:relational-fundamentals), [NoSQL & Redis](ch:nosql-redis)) and layer-6 brokers ([Messaging & events](ch:messaging-events)), provisioned as layer-7 infrastructure ([Cloud & Azure overview](ch:cloud-azure-overview)) and accessed with managed identity ([Identity & secrets](ch:azure-identity-secrets)).
levels: b,i,a
prereqs: cloud-azure-overview, relational-fundamentals, messaging-events
next: azure-identity-secrets, cicd-iac
---

## TL;DR

- Every service here is the **managed, Azure-hosted** version of something already covered from first principles earlier: SQL, NoSQL, Redis, message brokers.
- **Azure SQL Database** gives you SQL Server as a managed service, with built-in HA, point-in-time restore, and passwordless auth via managed identity.
- **Blob Storage** has four access tiers (Hot → Cool → Cold → Archive) trading storage cost against access cost; lifecycle policies can move blobs between them automatically as they age.
- Pick **Service Bus** for reliable business commands/events, **Event Grid** for lightweight "something happened" push notifications, and **Event Hubs** for a high-volume event firehose — they solve different problems, not competing versions of the same one.
- Treat every Azure SDK client (`BlobServiceClient`, `ServiceBusClient`, …) like `HttpClient`: create it once, register it as a singleton, and let it manage its own connections and retries.

## The map {b}

Every concept in this chapter is something earlier chapters already explained from first principles — relational databases, NoSQL, Redis, message brokers. What follows is specifically the **managed, Azure-hosted** version of each one, and what's different about operating it there.

| Need | Service | One-line description |
|---|---|---|
| Relational (SQL Server engine) | **Azure SQL Database** | Fully managed SQL Server database (PaaS); SQL Managed Instance for near-100% compatibility |
| Relational (open source) | **Azure Database for PostgreSQL – Flexible Server** | Managed PostgreSQL (also MySQL Flexible Server) |
| Document / NoSQL, global | **Azure Cosmos DB** | Multi-model, globally distributed, single-digit-ms, multiple consistency levels |
| Files and objects | **Blob Storage** (in a Storage account) | Massively scalable object storage with access tiers |
| Simple queues | **Storage Queues** | Cheap, basic queue (64 KB messages) |
| Key/attribute tables | **Table Storage** (or Cosmos DB Table API) | Cheap NoSQL key/attribute store |
| SMB/NFS file shares | **Azure Files** | Lift-and-shift shared drives |
| Cache | **Azure Managed Redis** (successor of Azure Cache for Redis) | Managed Redis for caching, sessions, pub/sub |
| Enterprise messaging | **Service Bus** | Queues + topics with sessions, DLQ, transactions |
| Event routing | **Event Grid** | Push-based pub/sub for discrete events, reactive integration |
| Event streaming | **Event Hubs** | High-throughput, Kafka-compatible event ingestion and streaming |
| Search | **Azure AI Search** | Full-text, vector and hybrid search over your data |
| Analytics | Fabric / Synapse, Data Explorer | Big data and telemetry analytics |

## Azure SQL Database {i}

### Deployment and purchasing models

| Option | Notes |
|---|---|
| **Single database** | One isolated database, its own resources. The most common choice |
| **Elastic pool** | Many databases share a pool of resources: SaaS **database-per-tenant** with varying load |
| **SQL Managed Instance** | Near-complete SQL Server compatibility (SQL Agent, cross-database queries, CLR) for lift-and-shift |
| **SQL Server on Azure VMs** | IaaS: full control, you manage it |

| Purchasing model | Tiers |
|---|---|
| **vCore** (recommended) | **General Purpose** (remote storage, balanced), **Business Critical** (local SSD, built-in readable replica, lowest latency), **Hyperscale** (up to 128 TB, fast scaling, multiple read replicas, fast backups/restores) |
| DTU (legacy, bundled) | Basic, Standard, Premium |
| **Serverless** (General Purpose / Hyperscale) | Auto-scales compute within a range and can **auto-pause** when idle: great for dev/test and intermittent workloads (first query after a pause has a delay) |

### Availability, DR and backups

- Built-in **high availability** (99.99% SLA); **zone redundancy** for General Purpose, Business Critical and Hyperscale.
- **Automated backups** with **point-in-time restore** (7–35 days) plus long-term retention (up to 10 years).
- **Active geo-replication** (readable secondaries in other regions) and **failover groups** (automatic geo-failover behind a stable listener endpoint, so connection strings don't change).
- **Read scale-out**: route read-only queries with `ApplicationIntent=ReadOnly` to a replica.

### Security

- **Microsoft Entra authentication**, including **managed identity**: `Authentication=Active Directory Default` (or `Active Directory Managed Identity`) in the connection string, no password. Create contained users from Entra identities and grant roles (`db_datareader`, `db_datawriter`, or custom least-privilege roles).
- **Firewall rules** / **private endpoints** with public access disabled.
- **TDE** (encryption at rest, on by default), TLS in transit, **Always Encrypted** (client-side column encryption), **dynamic data masking**, **row-level security**, **auditing**, **Microsoft Defender for SQL** (threat detection, vulnerability assessment), and the **ledger** feature (tamper evidence).

```text
Server=tcp:sql-shop-prod.database.windows.net,1433;Database=shop;Authentication=Active Directory Default;Encrypt=True;
```

```sql
-- in the database: grant the app's managed identity least privilege
CREATE USER [app-shop-api-prod] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [app-shop-api-prod];
ALTER ROLE db_datawriter ADD MEMBER [app-shop-api-prod];
```

**Transient faults** (failovers, reconfigurations, throttling) are a normal part of the PaaS service: always enable retries (`EnableRetryOnFailure` in EF Core; see [Resilience](ch:resilience)) — exactly the transient-vs-permanent fault distinction that chapter's whole opening section is built around. Defaults that differ from on-premises: **RCSI is on**, **Query Store** is on, and automatic tuning can create and drop indexes.

## Azure Database for PostgreSQL {i}

**Flexible Server**: managed PostgreSQL with zone-redundant HA, read replicas, PgBouncer built in (connection pooling), extensions (**pgvector**, PostGIS, pg_cron), Entra authentication, private networking, and burstable/general-purpose/memory-optimised tiers, plus stop/start for dev. With Npgsql + EF Core, it's a first-class option for .NET, often cheaper than SQL Server licensing.

## Azure Cosmos DB {i}

Covered conceptually in [NoSQL & Redis](ch:nosql-redis#partitioning-the-one-modelling-decision-you-cant-easily-undo). The Azure-specific essentials:

| Concept | Notes |
|---|---|
| **APIs** | NoSQL (native, recommended for new apps), MongoDB (vCore or RU), Cassandra, Gremlin (graph), Table, and PostgreSQL (distributed via Citus) |
| **Account → database → container → items** | The container is the unit of scale with a **partition key** |
| **Throughput** | **Request Units** (RU/s): provisioned (manual/**autoscale**) or **serverless**; at database or container level |
| **Consistency** | Strong, Bounded staleness, **Session** (default), Consistent prefix, Eventual |
| **Global distribution** | Add regions with a click; multi-region writes; automatic failover; 99.999% SLA for multi-region |
| **Change feed** | Ordered stream of changes per partition, consumed by Functions triggers or the change feed processor: materialised views, events, search sync |
| **Indexing** | Automatic indexing of all properties by default (tune policies to cut RU cost); composite, spatial and **vector** indexes |
| **TTL** | Automatic document expiry |
| **Transactions** | Within one logical partition (transactional batch, stored procedures) |

Use the **singleton `CosmosClient`**, prefer **point reads** (id + partition key) over queries, log `RequestCharge` to understand costs, and handle **429 (rate limited)**, which the SDK retries automatically within limits.

## Storage accounts: Blob, Queue, Table, Files {i}

A **Storage account** is a namespace providing several services, with redundancy options: **LRS** (3 copies, one datacentre), **ZRS** (across zones), **GRS/RA-GRS** (geo-replicated to the paired region, optionally readable), **GZRS/RA-GZRS**.

### Blob Storage

Objects ("blobs") in **containers**: images, documents, exports, backups, logs, static website assets, data lake files (with hierarchical namespace: ADLS Gen2).

| Access tier | For | Notes |
|---|---|---|
| **Hot** | Frequently accessed | Highest storage cost, lowest access cost |
| **Cool** | Infrequent (≥ 30 days) | Cheaper storage, higher access cost |
| **Cold** | Rare (≥ 90 days) | Cheaper still |
| **Archive** | Long-term retention (≥ 180 days) | Offline; **rehydration takes hours** |

**Lifecycle management policies** move or delete blobs automatically by age. **Soft delete**, **versioning** and **immutable storage** (WORM, legal hold) protect against accidental and malicious deletion.

```csharp
builder.Services.AddAzureClients(c =>
{
    c.AddBlobServiceClient(new Uri("https://stshopprod.blob.core.windows.net"));
    c.UseCredential(new DefaultAzureCredential());       // managed identity in Azure; developer login locally
});

public sealed class InvoiceStorage(BlobServiceClient blobs)
{
    private readonly BlobContainerClient _container = blobs.GetBlobContainerClient("invoices");

    public async Task<Uri> SaveAsync(Guid orderId, Stream pdf, CancellationToken ct)
    {
        var blob = _container.GetBlobClient($"{DateTime.UtcNow:yyyy/MM}/{orderId}.pdf");
        await blob.UploadAsync(pdf, new BlobUploadOptions { HttpHeaders = new() { ContentType = "application/pdf" } }, ct);
        return blob.Uri;
    }

    // Give a browser time-limited direct access without proxying bytes through your API
    public async Task<Uri> GetDownloadLinkAsync(string blobName, CancellationToken ct)
    {
        var key = await blobs.GetUserDelegationKeyAsync(DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddMinutes(15), ct);  // Entra-backed
        var sas = new BlobSasBuilder(BlobSasPermissions.Read, DateTimeOffset.UtcNow.AddMinutes(15))
        { BlobContainerName = _container.Name, BlobName = blobName };
        return new BlobUriBuilder(_container.GetBlobClient(blobName).Uri) { Sas = sas.ToSasQueryParameters(key.Value, blobs.AccountName) }.ToUri();
    }
}
```

**SAS (Shared Access Signature)** tokens grant time-limited, permission-scoped access. Prefer **user delegation SAS** (signed with Entra credentials) over account-key SAS, and prefer **disabling shared key access** entirely in favour of Entra RBAC (`Storage Blob Data Contributor`). The **valet key** pattern means clients upload and download directly to Blob using SAS URLs, so large files don't flow through your API — exactly the **claim-check** pattern [Messaging & events](ch:messaging-events#message-design-and-versioning) recommended for large message payloads, here applied to large HTTP payloads instead.

### Queues, Tables, Files

- **Storage Queues**: simple, cheap, huge scale, 64 KB messages, at-least-once, 7-day default TTL. No topics, sessions or DLQ (poison queues are handled by Functions). Use for simple work queues; use Service Bus for business messaging.
- **Table Storage**: schemaless key/attribute rows by PartitionKey + RowKey. Cheap for simple lookups and logs (Cosmos DB Table API for global distribution).
- **Azure Files**: SMB/NFS shares, e.g. legacy apps expecting a network drive, or shared config.

**Azurite** is the local emulator for Blob, Queue and Table (Docker image or VS Code extension).

## Azure Managed Redis {i}

Managed Redis (built on Redis Enterprise) succeeds Azure Cache for Redis (the classic Basic/Standard/Premium tiers are on a retirement path). Use it for `IDistributedCache`/`HybridCache` L2, sessions, rate limiting, SignalR backplane and output cache storage. Connect with **Entra ID authentication** (managed identity) via `Microsoft.Azure.StackExchangeRedis`, use private endpoints, pick tiers by memory and throughput, enable zone redundancy for production, and set eviction policies and TTLs ([NoSQL & Redis](ch:nosql-redis#redis-an-in-memory-data-structure-server-not-just-a-cache)).

## Service Bus vs Event Grid vs Event Hubs {i}

The classic Azure interview question. They solve **different problems** — picking between them is really picking between the Command/Event/Query distinction from [Messaging & events](ch:messaging-events#commands-events-and-queries-three-different-conversations) and a question of volume:

| | **Service Bus** | **Event Grid** | **Event Hubs** |
|---|---|---|---|
| Purpose | **Enterprise messaging**: reliable delivery of business **commands and events** | **Event routing**: react to **discrete events** ("something happened") | **Event streaming / ingestion**: millions of events per second |
| Model | Queues, topics + subscriptions (with filters) | Topics → event subscriptions **push** to handlers (Functions, webhooks, queues, Event Hubs) | Partitioned log; consumer groups **pull** and track offsets |
| Message | Up to 256 KB (Standard) / 100 MB (Premium); rich properties | Event envelope (CloudEvents/Event Grid schema), up to 1 MB | Events up to 1 MB; batches |
| Ordering | FIFO with **sessions** | Not guaranteed | Per partition |
| Delivery | At-least-once; **peek-lock**, complete/abandon, **DLQ**, scheduled messages, deferral, **duplicate detection**, transactions | At-least-once push with retries (up to 24 h) and dead-lettering to Blob | Retention 1–90 days (or longer in Premium/Dedicated); **replay** from any offset; Capture to Blob/ADLS |
| Throughput | Thousands–tens of thousands msg/s (Premium scales with messaging units) | Very high fan-out | **Very high** (throughput/processing units, Kafka endpoint) |
| Typical use | Order processing, payments, workflows, competing consumers, sagas | Blob created → resize image; resource changed → audit; custom domain events to many subscribers | Telemetry, clickstreams, IoT, logs, event-sourcing pipelines, stream analytics |

```text
Quick rule:
  "Process this business message reliably, exactly one handler, maybe in order"  → Service Bus
  "Something happened; notify whoever cares, push-style, lightweight"            → Event Grid
  "Ingest a firehose of events/telemetry and let consumers read/replay streams"  → Event Hubs
```

They're often combined: Event Grid routes a `BlobCreated` event to a Service Bus queue that a worker processes; Event Hubs ingests telemetry that Stream Analytics aggregates.

**Service Bus tiers:** Basic (queues only), Standard (topics, shared capacity), **Premium** (dedicated messaging units, VNet/private endpoints, larger messages, geo-replication: the choice for production at scale). The **Service Bus emulator** container runs it locally for development and tests.

## Using Azure SDK clients well from .NET {a}

The modern **Azure SDK** (`Azure.*` packages: `Azure.Storage.Blobs`, `Azure.Messaging.ServiceBus`, `Azure.Security.KeyVault.Secrets`, `Microsoft.Azure.Cosmos`…) shares conventions:

- **Clients are thread-safe and should be singletons.** Create once and reuse (they hold connections) — exactly the `HttpClient` lesson from [Calling other services](ch:http-client#the-two-classic-bugs-and-why-theyre-opposite-mistakes), applying identically to every Azure SDK client. Register via **`Microsoft.Extensions.Azure`** (`AddAzureClients`).
- **Authentication with `Azure.Identity`**: `DefaultAzureCredential` locally and in Azure, or more specific credentials in production (`ManagedIdentityCredential`, `WorkloadIdentityCredential`).
- **Built-in retries** with exponential backoff (`ClientOptions.Retry`); don't double-wrap with aggressive Polly retries — exactly the retry-storm risk [Resilience](ch:resilience#retry-done-properly) warned about, here specifically meaning don't retry at two layers for the same SDK call.
- **Logging and tracing** integrate with `ILogger` and OpenTelemetry (`Azure.*` ActivitySources).
- **Async APIs and `CancellationToken`** everywhere; paging via `AsyncPageable<T>` (`await foreach`).
- **Aspire integrations** (`builder.AddAzureBlobClient("blobs")`, `AddAzureServiceBusClient`, `AddAzureCosmosClient`) set all of this up with health checks.

```csharp
builder.Services.AddAzureClients(c =>
{
    c.AddServiceBusClientWithNamespace("sb-shop-prod.servicebus.windows.net");
    c.AddSecretClient(new Uri("https://kv-shop-prod.vault.azure.net/"));
    c.AddBlobServiceClient(new Uri("https://stshopprod.blob.core.windows.net"));
    c.UseCredential(new DefaultAzureCredential());
    c.ConfigureDefaults(o => o.Retry.MaxRetries = 5);
});
```

:::qa Service Bus vs Event Grid vs Event Hubs?
Service Bus is an enterprise message broker for reliable processing of commands and business events: queues and topics, peek-lock, DLQ, sessions for ordering, transactions, duplicate detection. Event Grid is a push-based event router for reacting to discrete events (resource or custom events) with fan-out to handlers. Event Hubs is a partitioned event-streaming platform for high-volume ingestion, with retention, replay and Kafka compatibility.
:::

:::qa How do you connect an app to Azure SQL without a password?
Enable a managed identity on the app, create a contained database user FROM EXTERNAL PROVIDER for that identity and grant least-privilege roles, then use a connection string with Authentication=Active Directory Default (or Managed Identity) via Microsoft.Data.SqlClient. No secrets to store or rotate.
:::

:::qa What are Blob Storage access tiers?
Hot (frequent access), Cool (infrequent, ≥30 days), Cold (rare, ≥90 days) and Archive (offline, ≥180 days, rehydration takes hours), each trading storage cost against access cost. Lifecycle management policies move blobs between tiers automatically.
:::

:::qa What is a SAS token and what's the most secure kind?
A Shared Access Signature appended to a storage URL granting time-limited, permission-scoped access to specific resources. A user delegation SAS, signed with Entra ID credentials rather than the account key, is the most secure; combine it with short expiry and least permissions, or avoid SAS by using RBAC with managed identity.
:::

:::qa How does Azure SQL provide high availability and disaster recovery?
Built-in HA replicas within the region (optionally zone-redundant), automated backups with point-in-time restore and long-term retention, and active geo-replication or failover groups for cross-region DR with a stable listener endpoint. Apps must retry transient errors during failovers.
:::

:::qa Why should Azure SDK clients be singletons?
They're thread-safe and manage connections, authentication tokens and retry state. Creating them per request wastes resources and can exhaust connections, similar to the HttpClient anti-pattern.
:::

## Further reading

- [Azure SQL Database documentation](https://learn.microsoft.com/en-us/azure/azure-sql/database/)
- [Azure Blob Storage introduction](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blobs-introduction)
- [Compare Azure messaging services](https://learn.microsoft.com/en-us/azure/service-bus-messaging/compare-messaging-services)
- [Azure SDK for .NET](https://learn.microsoft.com/en-us/dotnet/azure/sdk/azure-sdk-for-dotnet)
- [Choose a data store (Azure Architecture Center)](https://learn.microsoft.com/en-us/azure/architecture/guide/technology-choices/data-store-overview)

## Verify this chapter

Run with `dotnet run` (plain console app, .NET 8/9, top-level statements, BCL only). Most of this chapter describes facts about managed Azure services rather than local algorithms, so this checks the decision logic those facts imply instead of the services themselves.

```csharp
// Claim: the chapter's blob access-tier guidance (Hot / Cool ≥30d / Cold ≥90d / Archive ≥180d) is a
// consistent decision rule once you plug in "days since last access."
string RecommendedTier(int daysSinceLastAccess) => daysSinceLastAccess switch
{
    < 30 => "Hot",
    < 90 => "Cool",
    < 180 => "Cold",
    _ => "Archive"
};
var cases = new (int Days, string Expected)[] { (0, "Hot"), (29, "Hot"), (30, "Cool"), (89, "Cool"), (90, "Cold"), (179, "Cold"), (180, "Archive"), (400, "Archive") };
foreach (var (days, expected) in cases)
{
    var actual = RecommendedTier(days);
    if (actual != expected) throw new Exception($"FAIL: {days} days since access should recommend {expected}, got {actual}");
}
Console.WriteLine("OK: the Hot/Cool/Cold/Archive thresholds (30/90/180 days) form a consistent, non-overlapping rule");

// Claim: a time-limited SAS-style token grants access only within its validity window.
bool IsAccessAllowed(DateTimeOffset issuedAt, DateTimeOffset expiresAt, DateTimeOffset attemptAt) =>
    attemptAt >= issuedAt && attemptAt < expiresAt;

var issued = DateTimeOffset.UtcNow;
var expires = issued.AddMinutes(15);
if (!IsAccessAllowed(issued, expires, issued.AddMinutes(5))) throw new Exception("FAIL: access within the window should be allowed");
if (IsAccessAllowed(issued, expires, issued.AddMinutes(20))) throw new Exception("FAIL: access after expiry should be denied");
Console.WriteLine("OK: a time-limited token (the idea behind a SAS URL) only grants access inside its validity window");

// Claim: exponential backoff retry delays increase each attempt, up to the configured retry count.
TimeSpan[] ExponentialDelays(int maxRetries, TimeSpan baseDelay) =>
    Enumerable.Range(1, maxRetries).Select(attempt => baseDelay * Math.Pow(2, attempt - 1)).ToArray();

var delays = ExponentialDelays(maxRetries: 5, baseDelay: TimeSpan.FromMilliseconds(200));
if (delays.Length != 5) throw new Exception($"FAIL: expected 5 retry delays, got {delays.Length}");
for (int i = 1; i < delays.Length; i++)
    if (delays[i] <= delays[i - 1]) throw new Exception($"FAIL: delay #{i + 1} should be longer than delay #{i} (exponential backoff)");
Console.WriteLine($"OK: exponential backoff produces {delays.Length} strictly increasing delays ({string.Join(", ", delays.Select(d => d.TotalMilliseconds + "ms"))})");

// Not runtime-verifiable here — these are facts about managed Azure services, not local computation:
//  - specific SLA percentages (99.99%, 99.999%), message size limits, retention windows, throughput numbers
//  - Service Bus vs Event Grid vs Event Hubs feature comparisons
//  - that Azure SDK clients are thread-safe and should be registered as singletons
// See Further reading: https://learn.microsoft.com/en-us/azure/service-bus-messaging/compare-messaging-services
```
