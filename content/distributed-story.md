---
id: distributed-story
title: "Part VIII as One Story: Kettle Becomes Several Services"
summary: "Read this first. Kettle has split into a few services: ordering, payments, stock and email. Each one works alone. Together, they fail in new ways: a slow partner drags everything down, a message gets delivered twice, and nobody can tell which service made checkout slow. Part VIII is about systems that span more than one process. Each chapter is an episode: something breaks at Kettle, and the chapter is the fix."
layer: comms
where: Distributed systems › Start of Part VIII
fits: "The doorway into Part VIII, Distributed Systems. It shows the whole road before you walk it, so each chapter arrives as the answer to a problem you've already met."
levels: b
prereqs: integration-testing
next: messaging-events
---

## The 30-second version

- Part VIII is about systems that span more than one process.
- 3 episodes. Each starts with **Previously at Kettle** and the problem that just appeared, and ends with **Next episode**: the new problem the fix creates.
- Learn the problem first, and the technique stops being trivia.

## Where Kettle is now {b}

Kettle has split into a few services: ordering, payments, stock and email. Each one works alone. Together, they fail in new ways: a slow partner drags everything down, a message gets delivered twice, and nobody can tell which service made checkout slow. Part VIII is about systems that span more than one process.

## The road through Part VIII {b}

| # | Episode | What breaks at Kettle | What you learn |
|---|---|---|---|
| 1 | [Don't wait, publish](ch:messaging-events) | Checkout calls email, stock and analytics in turn. If one is down, checkout fails. | Brokers, commands vs events, at-least-once delivery, the outbox and sagas |
| 2 | [Expect failure](ch:resilience) | The payment provider blips for 2 seconds, and Kettle shows errors for 10 minutes. | Retries with backoff and jitter, circuit breakers, timeouts and health checks |
| 3 | [See inside](ch:observability-aspire) | "Checkout is slow." Which of the five services is it? | Logs, metrics and traces, OpenTelemetry, SLOs and .NET Aspire |

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

By the end of Part VIII, Kettle's services talk through a broker, survive each other's failures, and can be traced end to end. Next, the team splits the monolith for real. That's Part IX.

[Start: Episode 1 · Don't wait, publish →](ch:messaging-events)
