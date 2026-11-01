---
id: cloud-story
title: "Part IX as One Story: Kettle Moves to the Cloud"
summary: "Read this first. Kettle's single server can't survive the holiday rush, and a hardware failure would take the business down. Part IX moves Kettle to Azure: packaged in containers, running on managed services, with no passwords in config, deployed by a pipeline, and kept alive by an orchestrator. Each chapter is an episode: something breaks at Kettle, and the chapter is the fix."
layer: infra
where: Cloud and DevOps › Start of Part IX
fits: "The doorway into Part IX, Cloud & DevOps. It shows the whole road before you walk it, so each chapter arrives as the answer to a problem you've already met."
levels: b
prereqs: observability-aspire
next: cloud-azure-overview
---

## The 30-second version

- Part IX moves Kettle to Azure: packaged in containers, running on managed services, with no passwords in config, deployed by a pipeline, and kept alive by an orchestrator.
- 7 episodes. Each starts with **Previously at Kettle** and the problem that just appeared, and ends with **Next episode**: the new problem the fix creates.
- Learn the problem first, and the technique stops being trivia.

## Where Kettle is now {b}

Kettle's single server can't survive the holiday rush, and a hardware failure would take the business down. Part IX moves Kettle to Azure: packaged in containers, running on managed services, with no passwords in config, deployed by a pipeline, and kept alive by an orchestrator.

## The road through Part IX {b}

| # | Episode | What breaks at Kettle | What you learn |
|---|---|---|---|
| 1 | [Renting the data centre](ch:cloud-azure-overview) | Kettle's single server in a cupboard can't handle the holiday rush. | Service models, regions and zones, scaling out, twelve-factor apps and the Azure map |
| 2 | [Ship the whole box](ch:docker) | "It works on my machine." Production has a different runtime and libraries. | Images and layers, multi-stage Dockerfiles, and .NET in containers |
| 3 | [Where Kettle runs](ch:azure-compute) | VMs, Kubernetes, App Service, Functions… which one? | App Service, Functions, Container Apps, AKS and VMs, and how to choose |
| 4 | [Managed data and messaging](ch:azure-data-messaging) | Kettle needs a database, file storage, a cache and a message broker, without running any of them. | Azure SQL, Cosmos DB, Blob Storage, Redis, and Service Bus vs Event Grid vs Event Hubs |
| 5 | [No secrets at all](ch:azure-identity-secrets) | The database password was committed to Git. | Managed identities, RBAC, Key Vault and workload identity federation |
| 6 | [Push to production](ch:cicd-iac) | Releases are a monthly, manual, all-hands evening. | CI/CD pipelines, deployment strategies, database migrations in pipelines and infrastructure as code |
| 7 | [Desired state](ch:kubernetes) | At 3 a.m. a server dies, and someone has to restart Kettle by hand. | Desired state, pods and services, probes, resources and autoscaling |

## How to read each episode {b}

Every chapter in this part follows the same beats:

1. **Previously at Kettle.** Where the shop is, in two or three sentences.
2. **The problem.** The thing that just broke, or got slow, or got dangerous.
3. **The chapter itself.** Plain-words summaries first, then the mechanics, then in-depth sections and interview questions for when you need them.
4. **Next episode.** The new problem the fix uncovered, which is where the next chapter starts.

:::tip Watch it first
The [Kettle Storybook](story.html) has a short animated scene for every episode in this part. Watching the scene before reading the chapter takes two minutes and gives you the picture the text then fills in.
:::

## Where this part ends {b}

By the end of Part IX, Kettle runs on infrastructure it doesn't have to babysit, and releases are a push to Git. Then the next Black Friday arrives, and the bottlenecks are inside Kettle's own process. That's Part X.

[Start: Episode 1 · Renting the data centre →](ch:cloud-azure-overview)
