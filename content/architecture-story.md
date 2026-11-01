---
id: architecture-story
title: "Part VI as One Story: Kettle Grows a Codebase"
summary: "Read this first. Kettle's team has grown from two developers to twelve, in three teams. The code that two people understood is now a tangle that twelve people trip over. Part VI is about the shapes code can take so that change stays cheap: principles, patterns, architectures, and finally the question of whether to split into services. Each chapter is an episode: something breaks at Kettle, and the chapter is the fix."
layer: arch
where: Architecture and design › Start of Part VI
fits: "The doorway into Part VI, Architecture & Design. It shows the whole road before you walk it, so each chapter arrives as the answer to a problem you've already met."
levels: b
prereqs: nosql-redis
next: design-principles
---

## The 30-second version

- Part VI is about the shapes code can take so that change stays cheap: principles, patterns, architectures, and finally the question of whether to split into services.
- 6 episodes. Each starts with **Previously at Kettle** and the problem that just appeared, and ends with **Next episode**: the new problem the fix creates.
- Learn the problem first, and the technique stops being trivia.

## Where Kettle is now {b}

Kettle's team has grown from two developers to twelve, in three teams. The code that two people understood is now a tangle that twelve people trip over. Part VI is about the shapes code can take so that change stays cheap: principles, patterns, architectures, and finally the question of whether to split into services.

## The road through Part VI {b}

| # | Episode | What breaks at Kettle | What you learn |
|---|---|---|---|
| 1 | [Code that bends](ch:design-principles) | Adding Apple Pay means editing a 900-line class that also sends emails. | SOLID as a means to low coupling and high cohesion, and when to bend it |
| 2 | [Named solutions](ch:design-patterns) | The same design problems keep coming back in slightly different shapes. | The patterns that matter in .NET, and when not to use each |
| 3 | [Organising the codebase](ch:app-architectures) | Kettle's project is a tangle: controllers call SQL, and SQL formats emails. | Layered, Clean Architecture, vertical slices and the modular monolith |
| 4 | [Commands, queries, results](ch:cqrs-mediator-result) | Read screens need different shapes from write rules, and errors are thrown everywhere. | CQRS, the mediator pattern, pipeline behaviours and the Result pattern |
| 5 | [Speak the business language](ch:ddd) | "Product" means one thing to the catalogue team and another to the warehouse. | Bounded contexts, aggregates, value objects and domain events |
| 6 | [One app or many?](ch:microservices) | Three teams keep blocking each other's releases. | When microservices help, what they cost, and how to split safely |

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

By the end of Part VI, Kettle's code has boundaries that match its business, and the team knows when splitting into services would help and when it would hurt. But every change still feels risky. Part VII fixes that.

[Start: Episode 1 · Code that bends →](ch:design-principles)
