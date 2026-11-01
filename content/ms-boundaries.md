---
id: ms-boundaries
title: "Service Boundaries: Where to Cut, and Where Not To"
summary: "Kettle decides to split its modular monolith into services, and the first question is where to cut. Covers what a good boundary is (high cohesion inside, loose coupling across), the kinds of coupling that matter, finding boundaries from business capabilities, bounded contexts and event storming, sizing services, the anti-patterns that create a distributed monolith (entity services, shared databases, chatty chains), Conway's law and team ownership, and extracting services from a monolith step by step with the strangler fig and branch by abstraction."
layer: arch
where: Microservices › Finding service boundaries
fits: "Builds directly on [DDD](ch:ddd)'s bounded contexts and the decision chapter [Microservices](ch:microservices). Boundaries decide everything after them: which calls cross the network ([Communication](ch:ms-communication)), who owns which data ([Data](ch:ms-data)), and which team deploys what ([Running microservices](ch:ms-operations))."
levels: i,a
prereqs: microservices, ddd, messaging-events
next: ms-communication
---

## The 30-second version

- A good service boundary puts things that **change together** inside one service, and things that change for different reasons in different services.
- Cut along **business capabilities** and **bounded contexts** (ordering, payments, catalogue, fulfilment), never along technical layers or database tables.
- The test of a boundary: can this service be **changed, deployed and scaled on its own**, and keep working briefly when its neighbours are down?
- The classic failure is a **distributed monolith**: services that must be deployed together, share a database, or call each other in long synchronous chains.
- **Teams shape systems** (Conway's law). One team should own each service end to end.
- Don't rewrite. **Extract** services from a modular monolith one at a time, with the strangler fig.

## Words you'll meet

| Word | In plain words |
|---|---|
| **cohesion** | How strongly the things inside one module belong together. High is good. |
| **coupling** | How much one module depends on another's details or availability. Low is good. |
| **business capability** | Something the business does, like "take payments" or "ship parcels", regardless of how it's built. |
| **bounded context** | An area where every word has one meaning ([DDD](ch:ddd)). |
| **event storming** | A workshop where people map a business process as a timeline of events on sticky notes. |
| **distributed monolith** | Many services that can only be changed and deployed together: the costs of both styles, the benefits of neither. |
| **Conway's law** | Systems end up shaped like the communication structure of the organisation that builds them. |
| **strangler fig** | Replacing a legacy system gradually, by routing one piece at a time to new code. |

## Previously at Kettle {b}

Kettle is a well-structured modular monolith ([Architecture](ch:app-architectures)), and its services already talk through a broker for the slow parts ([Messaging](ch:messaging-events)). But it's grown: three teams, forty developers, Black Friday traffic that's twenty times normal for the catalogue and only three times normal for payments, and a release train where one team's bug blocks everyone's features. The [Microservices](ch:microservices) chapter weighed the decision, and the answer is yes, for a few parts.

**The problem:** a bad split is worse than no split. Where do you cut?

**This episode:** what makes a good boundary, how to find one, the anti-patterns that create a distributed monolith, and how to extract services safely.

## Start from zero: what a boundary is for {b}

:::plain
You draw a boundary so that each side can change without asking the other. A boundary is good if most changes stay on one side of it.
:::

Think about the changes Kettle made last quarter:

- New payment provider: touched payment code only.
- New loyalty points: touched ordering, payments, the storefront and email.
- Free shipping over £40: touched pricing and the basket.
- Faster product search: touched the catalogue only.

A good boundary is one that most of these changes **don't cross**. "New payment provider" fits inside a Payments service. "Loyalty points" crosses four areas: either loyalty is its own capability that the others consult, or those four areas aren't really separate.

That's the whole idea in one sentence: **put what changes together inside one boundary.** Developers call that **high cohesion**. The other half, **loose coupling**, means the parts on either side of a boundary know as little as possible about each other.

## The kinds of coupling {i}

"Loose coupling" is vague until you name the kinds. A split can reduce one and increase another.

| Coupling | Meaning | Example at Kettle | How services reduce it, or don't |
|---|---|---|---|
| **Deployment** | A and B must be released together | ordering and payments released as one app | separate services deploy alone, **if** their contracts stay compatible |
| **Domain** | A must know B's business rules | ordering computes payment fees itself | clear ownership: Payments owns fees |
| **Temporal** | A only works while B is up and answering | checkout calls stock synchronously | asynchronous messaging; services **increase** this if every call is synchronous |
| **Data** | A reads or writes B's data structures | the reporting job queries the orders table | database per service and published contracts |
| **Schema / contract** | a change to B's messages or API breaks A | renaming a JSON field | versioned contracts, tolerant readers |

A microservices split is worth it only if it reduces deployment, domain and data coupling **more** than it adds temporal coupling, which the network inevitably introduces.

## Finding boundaries {i}

:::plain
Start from what the business does, not from your database tables. The words people use, and where those words change meaning, show you where to cut.
:::

**1. Start from business capabilities.** List what Kettle *does*, independent of the code: manage the catalogue, price products, take orders, take payments, fulfil and ship, manage customers, run promotions. Capabilities are stable. The business will always take payments, even if the provider changes.

**2. Refine with bounded contexts.** Within those capabilities, look for where the language changes ([DDD](ch:ddd#strategic-ddd-ubiquitous-language-and-bounded-contexts)). To the catalogue team, a *product* has photos and tasting notes. To the warehouse, it has a weight, a shelf location and a box size. To pricing, it has a cost and a margin. Three meanings of one word means three contexts, each with its own model, which is a strong hint for a service boundary.

**3. Run an event-storming workshop.** Put business people and developers in a room with a long wall. Everyone writes the **events** that happen (`OrderPlaced`, `PaymentCaptured`, `ParcelShipped`) on orange notes and arranges them on a timeline. Then add the **commands** that cause them and the **people** and **systems** involved. Clusters of events that one group of people cares about, with few arrows to other clusters, are candidate services. The places where the conversation gets heated ("wait, *who* decides the delivery date?") are where the boundaries are unclear.

**4. Check each candidate:**

| Question | Good sign |
|---|---|
| Can one team own it end to end? | yes, a team of 5 to 9 people can understand and run it |
| Does it own its data? | its data is used mainly by itself; others get published facts |
| Can it work for a while without its neighbours? | it can accept work and catch up later |
| Does it change for its own reasons? | most of last quarter's changes to it touched nothing else |
| Does it scale differently? | catalogue reads vs payment writes: different load profiles |

Kettle's first cut: **Catalogue** (high read traffic, changes often), **Ordering** (the core), **Payments** (compliance boundary, a separate team), **Fulfilment** (warehouse, its own operational hours). Customers, promotions and pricing stay inside the monolith for now. Splitting is cheap to postpone and expensive to undo.

## How big should a service be? {i}

There's no correct number of lines. The useful limits come from people and from change:

- **Big enough** that ordinary features don't need changes in several services. If adding a field to an order means coordinated releases of three services, they're too small.
- **Small enough** that one team can own it, understand it and rewrite it in a few weeks if needed.
- **Aligned with a bounded context**, or a part of one. A service larger than a context mixes meanings; a service smaller than an aggregate splits rules that must change in one transaction.

Most organisations that succeed with microservices have services that look surprisingly large, organised around business capabilities, rather than hundreds of tiny ones.

## The anti-patterns: how splits go wrong {i}

:::plain
Most failed microservice projects split by data tables or technical layers, so every feature still needs every service. You get all the network problems and none of the independence.
:::

| Anti-pattern | What it looks like | Why it hurts |
|---|---|---|
| **Entity services** | `CustomerService`, `ProductService`, `OrderService`, each a CRUD wrapper around one table | every business operation calls several of them, so all logic ends up in whichever service orchestrates, and they all change together |
| **Shared database** | several services reading and writing the same tables | any schema change breaks unknown readers; no service owns the rules; deployment coupling is back |
| **Chatty synchronous chains** | checkout calls ordering, which calls pricing, which calls promotions, which calls customers | latency adds up, and availability multiplies down: five services at 99.9% give a chain at about 99.5% |
| **Technical-layer services** | a "data access service", a "validation service", a "notification logic service" | every feature crosses every layer, which is now every service |
| **Shared libraries with business logic** | a `Kettle.Common` NuGet package holding domain rules used by every service | changing a rule means upgrading and redeploying everything at once |
| **Splitting too early** | services before the domain is understood | boundaries end up in the wrong place, and moving a boundary between services is far harder than inside one codebase |

Shared libraries are fine for **technical** plumbing, such as logging setup, OpenTelemetry configuration or a resilience policy. Shared libraries for **business** rules recreate the monolith's coupling, through the package manager.

## Conway's law: teams shape the system {a}

In 1967 Melvin Conway observed that organisations design systems that mirror their communication structure. If three teams work on a system, it tends to end up as three parts, wherever the boundaries "should" be. Two consequences matter in practice:

1. **Boundaries that cut across teams decay.** If Payments is owned half by the ordering team and half by the finance team, its internals will develop a seam along that line, and the service will drift towards being two.
2. **You can use the law on purpose** (sometimes called the inverse Conway manoeuvre): design the team structure you want the architecture to have. Kettle forms a Payments team **before** extracting the Payments service, so the boundary has an owner from day one.

The book *Team Topologies* names useful team types: **stream-aligned** teams own a business capability end to end; **platform** teams provide self-service infrastructure (pipelines, observability, the Kubernetes platform) so stream-aligned teams don't each rebuild it. Microservices without a platform team usually means every team reinvents deployment, logging and resilience, badly.

## Extracting a service from the monolith {a}

:::plain
Don't stop and rewrite. Pull one capability out at a time, while the old system keeps running, and route traffic to the new service step by step.
:::

Kettle extracts **Payments** first: it has a clear boundary, a separate team, and its own compliance requirements. The steps:

1. **Make the boundary real inside the monolith first.** Payments code lives in its own module, other modules call it only through an interface (`IPaymentGateway`), and it has its own tables, which no other module reads. Until this is true, extraction just moves the tangle onto the network. If you can't make the boundary clean inside one codebase, it won't be clean across a network either.
2. **Branch by abstraction.** Add a second implementation of `IPaymentGateway` that calls the new Payments service over HTTP or messaging. A feature flag chooses which implementation runs, so the switch is instant and reversible.
3. **Move the data.** The new service gets its own database. Copy existing payment data across, and for a transition period keep both in sync, for example by having the monolith publish payment events or by using change data capture. Then make the new service the **only** writer.
4. **Route traffic gradually.** Turn the flag on for staff accounts, then 5% of customers, then everyone, watching errors and latency at each step ([CI/CD](ch:cicd-iac#deployment-strategies)).
5. **Delete the old code.** Until the old path is gone, you're maintaining two implementations. This step is the one most often skipped.

At the edge, the same idea is called the **strangler fig**: put a gateway or reverse proxy (such as YARP) in front of the monolith, and move one route at a time to the new service (`/payments/*` → Payments, everything else → monolith) until the monolith has been "strangled" ([Communication](ch:ms-communication#the-gateway-one-front-door)).

:::gotcha Don't extract the core first
It's tempting to start with the most important, most tangled part, such as Ordering. Start with something **valuable but peripheral**, with a clean boundary, so the team learns deployment, observability and data migration on something that won't take the business down if it goes wrong.
:::

## Interview questions {i}

:::qa How do you decide service boundaries?
Start from business capabilities and bounded contexts, not tables or technical layers, using techniques such as event storming to see where language and ownership change. Check each candidate: one team can own it, it owns its data, most changes stay inside it, it can tolerate neighbours being down, and it has its own scaling profile. Prefer larger, capability-aligned services, and start inside a modular monolith, where moving a boundary is cheap.
:::

:::qa What is a distributed monolith and how do you avoid it?
A system split into services that still have to be changed and deployed together, typically because of shared databases, entity-per-service designs, shared business-logic libraries or long synchronous call chains. It has the network's costs without independent deployment. Avoid it with capability-aligned boundaries, a database per service, asynchronous integration through events, versioned contracts, and by proving boundaries inside a modular monolith before extracting them.
:::

:::qa What is Conway's law and why does it matter for microservices?
Systems mirror the communication structure of the organisation that builds them. Service boundaries that cut across teams decay, so each service needs a single owning team, and team structure should be designed alongside the architecture. A platform team providing self-service infrastructure stops every stream-aligned team from rebuilding deployment and observability.
:::

:::qa How would you migrate a monolith to microservices?
Incrementally. Modularise the monolith first, so each candidate has a clean interface and its own tables. Then extract one valuable but peripheral capability at a time: branch by abstraction behind a feature flag, move and sync its data, make the new service the only writer, route traffic gradually, and delete the old path. At the edge, a gateway implements the strangler fig by moving routes one at a time.
:::

:::qa Why is a service per entity (CustomerService, OrderService) usually a bad split?
Business operations span entities, so every use case calls several entity services, the orchestration logic ends up spread around or in one bloated service, and the services change and deploy together. Split along business capabilities instead, so each service owns a whole use case: its rules and its data together.
:::

## Next episode {b}

Kettle has drawn its first boundaries: Catalogue, Ordering, Payments and Fulfilment. Now those services have to talk to each other across a network that is slow and sometimes down. [Episode 2 · Communication →](ch:ms-communication)

## Further reading

- [Microservices architecture guidance](https://learn.microsoft.com/en-us/azure/architecture/microservices/) (Azure Architecture Center)
- [Identify microservice boundaries](https://learn.microsoft.com/en-us/azure/architecture/microservices/model/microservice-boundaries)
- [.NET Microservices: Architecture for Containerized .NET Applications](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/) (free e-book)
- [Strangler fig pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig)
