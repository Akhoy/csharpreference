---
id: capstone-wholesale
title: "Capstone: Kettle Wholesale from Zero to Production"
summary: "The whole book as one project. Follows Kettle Wholesale from a one-page brief to a well-run production service in seven phases: discovery, foundations, walking skeleton, core slices, hardening, launch, and operating and evolving. Each phase gives the goals, the decisions and their trade-offs, the code and infrastructure built, the exit criteria, and links to every chapter it relies on. Ends with the failure modes each phase prevents and a self-test."
layer: arch
where: Building real projects › Capstone
fits: "Ties together every part of the book. Use it as a checklist for a real project, and as a source of concrete stories for system design and behavioural interviews."
levels: b,i,a
prereqs: staff-engineer
next: interview-story
---

## The 30-second version

- Seven phases: **discover** the problem, lay the **foundations**, deploy a **walking skeleton**, build the **core** in vertical slices, **harden** for production, **launch** gradually, then **operate and evolve**.
- Each phase ends with **exit criteria** you can check, so "done" isn't a feeling.
- The architecture starts as a **modular monolith** on a managed platform, with the boundaries and triggers to evolve written down.
- Every decision links to the chapter that explains it. If one step feels unfamiliar, that's the chapter to reread.

## Previously at Kettle {b}

You've seen each technique on its own: C# and .NET, ASP.NET Core, data, architecture, testing, distributed systems, hosting, the cloud, performance, security, and the practices of delivery and ownership. In a real project they all happen at once, under a deadline, with trade-offs between them.

**The problem:** knowing each piece isn't the same as knowing what to do on Monday morning of a new project.

**This episode:** Kettle Wholesale from a one-page brief to a well-run product, phase by phase.

## The brief {b}

> Trade customers (cafés, offices, restaurants) buy tea in bulk. They need: an account with a credit limit, quotes with volume pricing, orders against their credit, scheduled deliveries, monthly invoices, and a finance report. Target: a pilot with 20 customers at the trade show in four months, then 500 customers within a year. Team: five developers, a product manager, part of a designer, and a staff engineer.

Rough numbers to design for (always derive them, even roughly, before choosing technology):

- **Users**: 500 accounts × a few users each = a few thousand users. **Traffic**: low, at most tens of requests per second, with a spike on invoice day.
- **Data**: thousands of orders a month; a few GB after several years. Comfortably one relational database.
- **Consistency**: orders against credit limits must be **strongly consistent** (no overspending). Reports can lag by minutes.
- **Availability**: business hours matter most; an hour's outage is a bad day, not a disaster. Target 99.9%.

These numbers rule out a lot of complexity before any argument starts: no sharding, no microservices for scale, no event-sourced everything.

## Phase 0 · Discovery (week 0–1) {i}

**Goal:** agree on the problem, the first users, the success measure and the biggest risks.

- Talk to five real trade customers and the finance team. Write down their actual workflow.
- Write a one-page **design doc** for the overall approach, and list the riskiest unknowns: the finance system's API, delivery scheduling rules, credit approval ([Staff engineer](ch:staff-engineer#design-docs-that-get-decisions-made)).
- Start **spikes** on the two riskiest unknowns ([Delivering work](ch:delivering-work#estimating-and-de-risking)).
- Agree what's **out** of the pilot: multi-currency, a mobile app, custom contracts.

**Exit:** a written brief, success measures (pilot customers placing repeat orders), a risk list with owners, and the scope cut line.

## Phase 1 · Foundations (week 1–2) {i}

**Goal:** a repository and pipeline where good practice is the default.

| Decision | Choice | Why (and the chapter) |
|---|---|---|
| Architecture | **modular monolith**: Accounts, Pricing, Ordering, Invoicing modules, each owning its tables | one deployable for five people; boundaries ready to split later ([Architectures](ch:app-architectures), [Microservices](ch:microservices)) |
| Runtime | .NET LTS, ASP.NET Core minimal APIs | long support; small, fast endpoints ([What .NET is](ch:what-is-dotnet), [Building APIs](ch:building-apis)) |
| Data | PostgreSQL with EF Core; one schema per module | strong consistency for credit; one database to run ([EF Core](ch:efcore-fundamentals), [Relational](ch:relational-fundamentals)) |
| UI | Blazor Web App for the customer portal | one language, server rendering with interactivity where needed ([Blazor render modes](ch:blazor-render-modes)) |
| Identity | an OIDC provider (Entra External ID or similar), not home-made passwords | security and MFA for free ([OAuth & OIDC](ch:oauth-oidc-identity)) |
| Hosting | Azure Container Apps + managed Postgres + Front Door | no servers or cluster to run; scales; same images run anywhere ([Where to host](ch:prod-config#choosing-where-to-host), [Azure compute](ch:azure-compute)) |
| Messaging | none yet; in-process events plus an outbox table | add a broker when a second consumer appears ([Messaging](ch:messaging-events)) |

Set up the repository, `Directory.Build.props`, central packages, analyzers, warnings as errors, CI with branch protection, and decision records for the choices above ([Foundations](ch:project-foundations)).

**Exit:** a clean build in CI, every quality gate seen failing once, ADRs merged.

## Phase 2 · Walking skeleton (week 2–3) {i}

**Goal:** the thinnest end-to-end slice, deployed by the pipeline to a real environment.

- One endpoint (`GET /api/quotes/{sku}`), one page in the portal, sign-in through the identity provider, one table, health checks.
- Pipeline: build → test → container image → deploy to staging → smoke test → deploy to production behind a flag ([CI/CD](ch:cicd-iac), [Docker](ch:docker)).
- Infrastructure as code for every Azure resource; managed identity to the database and Key Vault, no passwords ([Identity & secrets](ch:azure-identity-secrets)).
- OpenTelemetry from day one: logs, traces and metrics in the observability backend ([Observability](ch:observability-aspire)).
- Front Door in front, origin locked to it, forwarded headers configured ([Request journey](ch:request-journey), [Other proxies](ch:other-proxies#managed-front-doors-in-the-cloud)).

**Exit:** a commit to `main` reaches production in under 30 minutes without manual steps; a request's trace is visible end to end; a rollback has been done once.

## Phase 3 · Core slices (week 3–12) {i}

**Goal:** the pilot's features, one vertical slice at a time, merged daily behind flags.

The order follows risk and dependency: accounts → quotes → orders against credit → scheduled deliveries → invoices → finance report. Highlights of what each slice needs:

- **Accounts and credit limits.** Rich domain model with invariants enforced in the aggregate; authorization by customer, so users only see their own account ([DDD](ch:ddd), [Auth](ch:auth#resource-based-authorization-when-the-rule-depends-on-which-)).
- **Quotes.** Pricing rules as pure, heavily unit-tested functions; quotes cached briefly with HybridCache ([Unit testing](ch:unit-testing), [Caching](ch:caching-ratelimit-cors)).
- **Orders against credit.** The one place where concurrency really matters: two orders arriving together must not overspend. Optimistic concurrency on the account row (a concurrency token), retried on conflict; idempotency keys on `POST /orders` so a retried request doesn't order twice ([EF Core in production](ch:efcore-advanced), [API design](ch:api-design#idempotency-keys-for-post-making-the-one-unsafe-by-default-m)).
- **Deliveries.** A background service schedules them; work handed off through the outbox, so an order and its "schedule delivery" message are saved in one transaction ([Background work](ch:background-work), [Messaging](ch:messaging-events)).
- **Invoices.** A monthly batch job, idempotent and resumable, alerting if it hasn't finished by 06:00 ([Resilience](ch:resilience), [Production ownership](ch:production-ownership#alerts-people-trust)).
- **Finance report.** A read model built from order events, queried with Dapper for speed; eventual consistency of a few minutes is acceptable here ([ADO.NET & Dapper](ch:ado-dapper), [CQRS](ch:cqrs-mediator-result)).
- **Calls to the finance system.** A typed `HttpClient` with timeouts, retries with jitter and a circuit breaker; failures queued and retried rather than failing the user's order ([HTTP clients](ch:http-client), [Resilience](ch:resilience)).

Every slice meets the [definition of done](ch:delivering-work#a-definition-of-done). Demo every two weeks to pilot customers. Track throughput; cut scope at week 8 if the trend says the date is at risk.

**Exit:** pilot scope complete in production behind flags; integration tests against real Postgres in containers; contract tests with the finance integration.

## Phase 4 · Hardening (week 12–15) {a}

**Goal:** confidence that it survives real users, real load and real failures.

- **Load test** at 10× the expected peak, including invoice day; fix the first bottleneck found (it's usually a missing index or an N+1 query) ([Performance engineering](ch:performance-engineering), [EF Core querying](ch:efcore-querying)).
- **Failure tests**: kill an instance mid-request, make the finance API slow, restart the database. Check that the app degrades the way the design says it will.
- **Security review**: threat model the credit and ordering flows; check authorization on every endpoint; dependency and container scanning; rate limits on public endpoints ([Web security](ch:web-security), [Security story](ch:security-story)).
- **Production configuration**: limits, timeouts, health checks, graceful shutdown, logging levels, Data Protection keys ([Production configuration](ch:prod-config)).
- **Operations**: SLOs for quotes, orders and invoices; burn-rate alerts; runbooks for each alert; on-call rota; restore the database backup to a scratch server and time it ([Production ownership](ch:production-ownership)).
- **Readiness review** with someone from outside the team ([Readiness review](ch:production-ownership#the-production-readiness-review)).

**Exit:** the go-live checklist complete; load and failure tests passed with the results recorded; the team has run one game day.

## Phase 5 · Launch (week 16) {i}

**Goal:** release to real customers gradually, with a fast way back.

- **Turn flags on for internal users**, then five friendly pilot customers, then all twenty, watching SLOs at each step.
- **Have the rollback ready** before each step: the flag switch, the previous image, the database compatible with both.
- **Staff the launch**: the team watches dashboards during the trade show; support knows how to escalate.
- **Communicate**: release notes for customers; what's known not to work yet.

**Exit:** all pilot customers live; SLOs met for two weeks; no open SEV1 or SEV2 issues.

## Phase 6 · Operate and evolve (month 5 onwards) {a}

**Goal:** keep it healthy while growing to 500 customers and three teams.

- **Run the loop**: on-call, incidents, blameless postmortems, actions done; monthly alert review; error budget policy ([Production ownership](ch:production-ownership)).
- **Measure delivery** with the DORA metrics, and remove whatever slows the team down most ([Measuring delivery](ch:production-ownership#measuring-delivery-the-dora-metrics)).
- **Pay down debt** where features are being built, with a steady budget ([Technical debt](ch:delivering-work#technical-debt)).
- **Evolve the architecture only when its triggers fire.** For example: Pricing gets its own team and needs to release independently → extract it as a service behind the existing interface, using the strangler pattern, with a broker introduced for the events it publishes ([Service boundaries](ch:ms-boundaries), [Communication](ch:ms-communication), [Data across services](ch:ms-data)).
- **Keep the platform current**: upgrade .NET each LTS release, dependencies weekly via Renovate or Dependabot, base images rebuilt regularly.

## The architecture at month six {a}

```text
                 Front Door (WAF, TLS, edge)
                          │
                 Azure Container Apps environment
        ┌──────────────────────────────────────────────┐
        │  wholesale-web (Blazor portal)               │
        │  wholesale-api (modular monolith)            │  ← 2–6 replicas, autoscaled
        │    ├─ Accounts   ├─ Pricing                  │
        │    ├─ Ordering   └─ Invoicing                │
        │  wholesale-worker (deliveries, invoices,     │  ← outbox relay, scheduled jobs
        │                    finance sync)             │
        └──────────────────────────────────────────────┘
             │               │                │
   PostgreSQL Flexible   Redis (HybridCache   Key Vault        OpenTelemetry → monitoring
   (schema per module,   L2, rate limits)     (via managed     (traces, metrics, logs,
    PITR backups)                              identity)        SLO alerts)
             │
   finance system API (typed HttpClient, resilience pipeline, queued retries)
```

And the decisions that define it, each with an ADR: modular monolith with schema-per-module; PostgreSQL; managed identity everywhere; outbox for reliable side effects; optimistic concurrency and idempotency keys for orders; Container Apps over Kubernetes until a platform team exists; the explicit triggers for extracting a service.

## How projects like this fail, and the phase that prevents it {i}

| Failure | Prevented by |
|---|---|
| Built the wrong thing | Phase 0: real customers, written brief, demos every two weeks |
| A late integration surprise | Phase 2: walking skeleton through every layer and the real pipeline |
| "Almost done" for months | Phase 3: vertical slices, throughput tracking, early scope cuts |
| Overspent credit, double orders | Phase 3: concurrency tokens and idempotency keys, tested |
| Falls over on invoice day | Phase 4: load test at 10× including the batch |
| Outage with nobody knowing what to do | Phase 4: SLOs, alerts, runbooks, game days |
| Breach through a forgotten endpoint | Phase 4: authorization tests on every endpoint, threat model |
| Big-bang launch goes wrong | Phase 5: gradual rollout behind flags, rollback ready |
| Slowly becomes the old codebase | Phase 1 gates, Phase 6 debt budget and DORA metrics |

## Self-test {b}

If you can answer these with confidence and say which chapter backs each answer, you can run a project like this:

1. Why a modular monolith here, and what would make you extract the first service?
2. How exactly do you stop two simultaneous orders overspending a credit limit? What does the client see on a conflict?
3. How does a "schedule delivery" message get sent if the app crashes right after saving the order?
4. What are Wholesale's SLOs, and what pages someone at 3 a.m.?
5. A deploy at 14:00 raises the order error rate to 3%. What happens next, minute by minute?
6. How do Data Protection keys, forwarded headers and graceful shutdown need configuring on Container Apps?
7. How would you change the pricing rules on a live system without risking wrong invoices?
8. What's in the first two weeks' foundations, and which one would you fight hardest to keep?

## Interview questions {i}

:::qa Walk me through how you'd take a new product from idea to production.
Start with discovery: real users, a written brief, success measures and the riskiest unknowns, with spikes on those first. Lay foundations that make quality the default and deploy a walking skeleton through the real pipeline early. Build in vertical slices merged daily behind flags, demoing regularly and cutting scope when throughput says so. Harden with load, failure and security testing plus SLOs, alerts and runbooks. Launch gradually with a rollback ready, then operate with postmortems, metrics and a debt budget, evolving the architecture when explicit triggers fire.
:::

:::qa How do you choose an architecture for a new system with a small team?
Derive rough load, data size, consistency and availability needs, then choose the simplest architecture that meets them, usually a modular monolith on a managed platform, with module boundaries that own their data. Record the decisions and the triggers for evolving them, such as independent scaling or team ownership, so services are extracted when there's a real need rather than up front.
:::

## Next episode {b}

That's Kettle, from its first line of C# to a well-run product. The last part turns all of it into interview performance: system design, explaining trade-offs, and a study plan. [Part XV · Telling Kettle's story →](ch:interview-story)

## Further reading

- *Accelerate* (Forsgren, Humble, Kim)
- *Software Engineering at Google* (Winters, Manshreck, Wright)
- [Azure Architecture Center: reference architectures](https://learn.microsoft.com/en-us/azure/architecture/)
- [.NET Architecture e-books](https://dotnet.microsoft.com/learn/dotnet/architecture-guides)
