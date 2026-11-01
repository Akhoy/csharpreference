---
id: ms-story
title: "Part IX as One Story: Kettle Splits for Real"
summary: "Read this first. Kettle has decided to split its modular monolith into services. Part IX follows that split: where to cut, how the services talk, how they share data without shared transactions, and how to build, secure, test and debug many services at once. Each chapter is an episode: something new goes wrong once Kettle is several services, and the chapter is the fix."
layer: arch
where: Microservices › Start of Part IX
fits: "The doorway into Part IX, Microservices. It builds on the decision in [Microservices](ch:microservices) and on Part VIII's messaging, resilience and observability."
levels: b
prereqs: observability-aspire
next: ms-boundaries
---

## The 30-second version

- Part IX turns Kettle's modular monolith into a few independently deployable services, without creating a distributed monolith.
- 4 episodes. Each starts with **Previously at Kettle** and ends with **Next episode**.
- The [Microservices](ch:microservices) chapter in Part VI asked *whether* to split. This part is about doing it *well*.

## Where Kettle is now {b}

Kettle's monolith has clean modules, and its slow work already runs through a broker. But three teams share one release train, and Black Friday stresses the catalogue twenty times more than payments. The team has decided to extract a few services. Part IX is that journey, from drawing the first boundary to running a dozen services calmly.

## The road through Part IX {b}

| # | Episode | What goes wrong at Kettle | What you learn |
|---|---|---|---|
| 1 | [Service boundaries](ch:ms-boundaries) | A bad split would be worse than no split. Where do you cut? | Cohesion and coupling, finding boundaries, anti-patterns, Conway's law, extracting services safely |
| 2 | [Communication](ch:ms-communication) | Method calls became network calls that are slow and sometimes fail. | Sync vs async, REST vs gRPC, deadlines, gateways with YARP, discovery, contracts |
| 3 | [Data across services](ch:ms-data) | No join and no transaction can span the services any more. | Data ownership, composition and read models, consistency choices, sagas, reporting |
| 4 | [Running microservices](ch:ms-operations) | Everything done once for the monolith must now be done for every service. | Pipelines, observability, service-to-service security, testing, the platform, Dapr, Aspire, eShop |

## How to read each episode {b}

Every chapter in this part follows the same beats:

1. **Previously at Kettle.** Where the shop is, in two or three sentences.
2. **The problem.** What the split just made harder.
3. **The chapter itself.** Plain-words summaries first, then the mechanics, then in-depth sections and interview questions.
4. **Next episode.** The new problem that leads into the next chapter.

## Where this part ends {b}

By the end of Part IX, Kettle runs as a handful of services that deploy independently, talk through contracts that evolve safely, own their data, and can be traced and secured end to end. They still run on one server in a cupboard, though. That's Part X.

[Start: Episode 1 · Service boundaries →](ch:ms-boundaries)
