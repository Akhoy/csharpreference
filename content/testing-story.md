---
id: testing-story
title: "Part VI as One Story: Kettle Stops Breaking"
summary: "Read this first. Kettle deploys several times a week now, and each release breaks something nobody noticed for days. Part VI builds the safety net: fast tests for the rules, and realistic tests for the wiring between the parts. Each chapter is an episode: something breaks at Kettle, and the chapter is the fix."
layer: cross
where: Testing › Start of Part VI
fits: "The doorway into Part VI, Testing. It shows the whole road before you walk it, so each chapter arrives as the answer to a problem you've already met."
levels: b
prereqs: microservices
next: unit-testing
---

## The 30-second version

- Part VI builds the safety net: fast tests for the rules, and realistic tests for the wiring between the parts.
- 2 episodes. Each starts with **Previously at Kettle** and the problem that just appeared, and ends with **Next episode**: the new problem the fix creates.
- Learn the problem first, and the technique stops being trivia.

## Where Kettle is now {b}

Kettle deploys several times a week now, and each release breaks something nobody noticed for days. Part VI builds the safety net: fast tests for the rules, and realistic tests for the wiring between the parts.

## The road through Part VI {b}

| # | Episode | What breaks at Kettle | What you learn |
|---|---|---|---|
| 1 | [Fast proof](ch:unit-testing) | A discount change quietly broke free shipping. Nobody noticed for a week. | Fast tests on behaviour, fakes at the edges, and test design |
| 2 | [Prove the parts fit](ch:integration-testing) | Every unit test passes, but the deployed API returns 401 for everyone. | WebApplicationFactory, Testcontainers, contract tests and tests in CI |

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

By the end of Part VI, Kettle's releases are boring, which is how releases should be. With that safety net in place, Kettle can start splitting into separate services. Part VII deals with what goes wrong once they have to talk to each other.

[Start: Episode 1 · Fast proof →](ch:unit-testing)
