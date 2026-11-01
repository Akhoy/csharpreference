---
id: ms-operations
title: "Running Microservices: Build, Deploy, Secure, Test and Debug"
summary: "Four services are four times the pipelines, configuration, dashboards and ways to fail. Covers repository layout, independent pipelines and versioning, observability across services, service-to-service security, a testing strategy that avoids slow end-to-end suites, the platform team and paved road, sidecars, service meshes and Dapr, .NET Aspire for local development and deployment, and a walkthrough of the eShop reference architecture."
layer: infra
where: Microservices › Running microservices
fits: "Pulls together [Observability](ch:observability-aspire), [Resilience](ch:resilience), [CI/CD](ch:cicd-iac), [Kubernetes](ch:kubernetes), [Identity & secrets](ch:azure-identity-secrets) and [Integration testing](ch:integration-testing), as they apply to many services at once."
levels: i,a
prereqs: ms-data, observability-aspire
next: cloud-story
---

## The 30-second version

- Each service needs its **own pipeline** and must be deployable alone. If releases have to be coordinated, the boundaries or the contracts are wrong.
- **Observability is not optional**: one trace ID across every service, structured logs with that ID, and per-service dashboards for rate, errors and duration.
- **Services authenticate to each other**, too: workload identities and tokens, or mutual TLS from a mesh. Don't trust the network.
- **Test with contracts**, not with a big end-to-end environment: unit and component tests per service, consumer-driven contract tests between them, and a handful of end-to-end journeys.
- Give teams a **paved road**: templates, shared pipelines and defaults from a platform team. **.NET Aspire** gives the local and deployment wiring; **Dapr** and **service meshes** move cross-cutting plumbing out of your code.

## Words you'll meet

| Word | In plain words |
|---|---|
| **monorepo / polyrepo** | All services in one repository, or one repository per service. |
| **paved road** | The supported, easy way to build a service, with templates and defaults. |
| **sidecar** | A helper process running next to each service instance, handling plumbing such as networking or secrets. |
| **service mesh** | A layer of sidecars or proxies that secures, routes and observes all traffic between services. |
| **mTLS** | Mutual TLS: both sides of a connection prove their identity with certificates. |
| **zero trust** | Don't trust a request because of where it came from; authenticate every call. |
| **Dapr** | A runtime that offers building blocks (pub/sub, state, service calls, workflows) through a sidecar. |

## Previously at Kettle {b}

Kettle's services have clean boundaries, talk sensibly and own their data. Then the operational reality arrives. Four services means four pipelines, four sets of configuration and four dashboards. A bug report says "checkout failed", and nobody knows which service to look at. The integration test environment takes a day to set up and is broken half the time. And the roadmap has twelve more services on it.

**The problem:** everything that was done once for the monolith now has to be done for every service, consistently.

**This episode:** repositories and pipelines, observability, security between services, testing, the platform, sidecars, Dapr and Aspire.

## Repositories, pipelines and versions {i}

**Monorepo or polyrepo?** Both work.

| | Monorepo (one repo) | Polyrepo (repo per service) |
|---|---|---|
| Cross-service change | one pull request | coordinated PRs in several repos |
| Shared code and tooling | easy to share | published as packages, versioned |
| Builds | need path filters, so each service builds only when its folder changes | naturally separate |
| Ownership | needs code-owner rules per folder | the repo is the boundary |

Whichever you choose, the non-negotiable is **independent deployability**: each service has its own pipeline that builds, tests and deploys only that service, triggered only by changes to it ([CI/CD](ch:cicd-iac)).

**Versioning.** Services are deployed continuously, so tag images with the commit SHA. **Contracts** need real versions: the public API version, message types (`OrderPlacedV2`), and any shared contract packages, which should contain **only** message and DTO types, never business logic ([Boundaries](ch:ms-boundaries#the-anti-patterns-how-splits-go-wrong)).

**Deploying in the right order.** Because every change is backward compatible ([Communication](ch:ms-communication#contracts-and-versioning)), any service can be deployed at any time. When a change needs both sides, release the **provider** first, accepting old and new; then the **consumers**; then remove the old path.

## Observability across services {i}

:::plain
One customer request now touches four services. To debug it, every log line and every timing from all four must share one ID, so you can pull the whole story back together.
:::

The [Observability](ch:observability-aspire) chapter applies with one big emphasis: **context propagation**. OpenTelemetry passes the trace ID through HTTP and gRPC headers automatically, and messaging libraries put it in message headers, so a trace follows a request from the gateway through Ordering, across the broker, into Payments, and back. With that in place:

- "Checkout failed for order 1042" becomes: find the trace, see that the Payments span errored with a timeout, open the Payments logs for that trace ID.
- Every service should log in the same **structured** format, with service name and version as resource attributes, and ship logs, metrics and traces to one backend.
- Each service gets the same **baseline dashboard**: request rate, error rate and latency percentiles per endpoint and per message type, plus queue depth and dead-letter count for its consumers.
- Alert on **user-facing symptoms**, such as checkout success rate and latency, not on every service's CPU.

The [Aspire dashboard](ch:observability-aspire#net-aspire) shows all of this locally from the first day.

## Security between services {a}

:::plain
Inside your network is not the same as trusted. Each service should prove who it is when calling another, and each service should check that the caller is allowed to do what it asks.
:::

**Zero trust** means a call isn't trusted because it comes from inside the cluster. If an attacker gets into one service, nothing else should open for them automatically.

- **Every service has an identity.** On Azure, a managed identity or workload identity ([Identity & secrets](ch:azure-identity-secrets)). Calls carry a token obtained with the **client credentials** flow, so Payments can check that the caller is Ordering and that Ordering holds the `payments.charge` role ([OAuth & OIDC](ch:oauth-oidc-identity#client-credentials-flow)).
- **Pass the user's identity when it matters.** If Payments must check that the *customer* owns the order, Ordering passes the user's context, through token exchange (On-Behalf-Of) or a signed internal claim. Don't let a service act for any user just because the caller says so.
- **Encrypt traffic between services.** A service mesh can provide mutual TLS automatically, so every connection is encrypted and both ends are authenticated by certificate.
- **Least privilege per service**: Payments' identity can read its own database and its own Key Vault secrets, and nothing else.

## Testing a system of services {i}

:::plain
Test each service thoroughly on its own, check the promises between services with contract tests, and keep the full end-to-end tests to a handful of journeys.
:::

| Layer | Tests | Speed and reliability |
|---|---|---|
| Inside one service | unit tests for domain rules; integration tests with `WebApplicationFactory` and a real database in a container ([Integration testing](ch:integration-testing)) | fast, reliable, run on every commit |
| A whole service, alone | **component tests**: the real service with its real database, and fakes (WireMock, an in-memory broker harness) for every other service | fast enough for every PR |
| Between services | **consumer-driven contract tests**: each consumer's expectations checked in the provider's build ([Communication](ch:ms-communication#contracts-and-versioning)) | fast, and say exactly what broke and for whom |
| The whole system | **end-to-end tests** of a few critical journeys (sign in, checkout) against a deployed environment | slow and flaky: keep them few |

The anti-pattern is a shared integration environment where every service must be deployed at matching versions before anything can be tested. It recreates the coordinated release train that microservices were meant to remove. Contract tests replace most of it.

## The platform and the paved road {a}

Every service needs the same plumbing: a Dockerfile, a pipeline, OpenTelemetry, health checks, resilience defaults, structured logging, secrets, and dashboards. If each team builds its own, you get twelve slightly different, slightly broken versions.

A **platform team** provides a **paved road**: the easy path that's also the right one.

- A **service template** (`dotnet new kettle-service`) with the Dockerfile, pipeline, health checks, OpenTelemetry and a `ServiceDefaults` project already wired.
- **Shared pipeline templates**, so a fix to the pipeline reaches every service.
- **Self-service infrastructure**: a new service gets its database, identity, queue and dashboard from a pull request, through infrastructure as code ([CI/CD & IaC](ch:cicd-iac#infrastructure-as-code)).

Teams can leave the road when they have a reason, but staying on it should be the obvious choice.

## Sidecars, service meshes and Dapr {a}

Some plumbing can move **out of your code** entirely, into a separate process that runs next to every instance: a **sidecar**.

**A service mesh** (Istio, Linkerd; Istio is available as an AKS add-on) puts a proxy next to every service and routes all traffic through it. Without code changes, you get mutual TLS between services, retries and timeouts, traffic splitting for canary releases, and metrics for every call. The cost is operational: another complex system to run and upgrade, extra latency per hop, and two places where retries can be configured, which must not both be on ([Resilience](ch:resilience#retry-done-properly)).

**Dapr** (Distributed Application Runtime) is a sidecar offering **building blocks** behind simple HTTP or gRPC APIs: service invocation with retries and mTLS, publish/subscribe over any supported broker, state stores, secrets, bindings to external systems, and durable workflows.

```csharp norun
// Publish through Dapr: the broker (Service Bus, RabbitMQ, Kafka…) is chosen in Dapr's configuration, not in code
await dapr.PublishEventAsync("pubsub", "order-placed", new OrderPlaced(orderId, total));
```

Dapr's promise is portability and less plumbing code. Its cost is another runtime in every deployment and a lowest-common-denominator API over each building block. Azure Container Apps can run Dapr for you.

**Mesh, Dapr or libraries?** Libraries in your code (OpenTelemetry, Polly, MassTransit) are the simplest when every service is .NET. A mesh pays off for many services in several languages, or where mTLS everywhere is required. Dapr suits teams that want broker and state-store portability. Pick one approach per concern.

## .NET Aspire for many services {i}

**Aspire** describes the whole system in C#, in an **AppHost** project ([Observability & Aspire](ch:observability-aspire#net-aspire)):

```csharp norun
var builder = DistributedApplication.CreateBuilder(args);

var sql     = builder.AddSqlServer("sql");
var bus     = builder.AddRabbitMQ("bus");
var ordersDb   = sql.AddDatabase("orders");
var paymentsDb = sql.AddDatabase("payments");

var payments = builder.AddProject<Projects.Kettle_Payments>("payments").WithReference(paymentsDb).WithReference(bus);
var ordering = builder.AddProject<Projects.Kettle_Ordering>("ordering")
                      .WithReference(ordersDb).WithReference(bus).WithReference(payments);   // service discovery: "https+http://payments"
builder.AddProject<Projects.Kettle_Gateway>("gateway").WithReference(ordering).WithExternalHttpEndpoints();

builder.Build().Run();
```

One `dotnet run` starts every service, database and broker locally, wires their connection strings and addresses, and opens the dashboard with traces across all of them. The **ServiceDefaults** project gives every service the same OpenTelemetry, health checks, service discovery and resilience setup: a paved road in code. The same model can generate deployment assets, for example for Azure Container Apps with `azd`.

## A reference to learn from: eShop {a}

Microsoft's **eShop** sample (`github.com/dotnet/eShop`) is a working microservices store built on current .NET and Aspire. It's worth reading alongside this part:

- Separate services for catalogue, basket, ordering and identity, each with its own data store.
- Integration events over a broker, with an outbox for reliability.
- Ordering built with DDD and CQRS, in a layered structure.
- gRPC between some services, HTTP APIs at the edge, and a web app front end.
- An Aspire AppHost that runs everything locally.

Compare its boundaries and patterns with Kettle's, and with your own projects. Reading a real codebase answers many "how would that actually look?" questions.

## Interview questions {i}

:::qa How do you keep microservices independently deployable?
Give each service its own pipeline, triggered only by its own changes, and make every contract change backward compatible so services can be released in any order: provider first, then consumers, then remove old paths. Keep shared packages to contract types only, never business logic. If releases need coordinating, the boundaries or contracts are wrong.
:::

:::qa How do you debug a failure that spans several services?
With distributed tracing: OpenTelemetry propagates a trace ID across HTTP, gRPC and message headers, so one trace shows every service's span and timing for the request, and structured logs carry the same ID. From the trace you find the failing span, then that service's logs for the trace. Consistent dashboards and symptom-based alerts per service complete it.
:::

:::qa How do services authenticate to each other?
Each service has its own identity, such as a managed or workload identity, and obtains tokens with the client credentials flow; the callee validates the token and checks the caller's roles. Where a user's permissions matter, their identity is passed on with token exchange rather than trusted from the caller. A service mesh can add mutual TLS to encrypt and authenticate every connection. The principle is zero trust: no call is trusted because of where it comes from.
:::

:::qa How do you test a microservices system without a giant integration environment?
Test each service thoroughly on its own with unit and component tests, using real databases in containers and fakes for other services. Verify the contracts between services with consumer-driven contract tests run in the provider's build. Keep a small number of end-to-end tests for critical journeys. This avoids a shared environment that forces coordinated versions.
:::

:::qa Service mesh vs Dapr vs libraries?
Libraries such as OpenTelemetry, Polly and MassTransit live in your code and are simplest when services share one language. A service mesh adds a proxy per service for mTLS, retries, traffic splitting and telemetry without code changes, at an operational and latency cost. Dapr offers portable building blocks (pub/sub, state, service invocation, workflows) through a sidecar API. Choose one owner per concern, so retries aren't configured in two places.
:::

## Next episode {b}

Kettle is now a set of independently deployable services, observable end to end and secure between themselves. But they all still run on one server in a cupboard, with no reverse proxy, no real certificate and deploys done by hand. Launch is in a month. [Part X · Hosting in Production →](ch:hosting-story)

## Further reading

- [.NET Aspire overview](https://learn.microsoft.com/en-us/dotnet/aspire/get-started/aspire-overview)
- [Dapr documentation](https://docs.dapr.io/)
- [eShop reference application](https://github.com/dotnet/eShop)
- [Microservices: design, build, operate](https://learn.microsoft.com/en-us/azure/architecture/microservices/)
