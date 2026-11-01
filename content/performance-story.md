---
id: performance-story
title: "Part X as One Story: Kettle Under Load"
summary: "Read this first. Kettle survives normal days easily. Under real load, the problems are subtler: memory that climbs all day, counters that lose updates, and a slow page that nobody can explain. Part X goes inside the runtime: the garbage collector, threads, and the method for finding what's really slow. Each chapter is an episode: something breaks at Kettle, and the chapter is the fix."
layer: runtime
where: Performance and internals › Start of Part X
fits: "The doorway into Part X, Performance & Internals. It shows the whole road before you walk it, so each chapter arrives as the answer to a problem you've already met."
levels: b
prereqs: kubernetes
next: memory-gc
---

## The 30-second version

- Part X goes inside the runtime: the garbage collector, threads, and the method for finding what's really slow.
- 3 episodes. Each starts with **Previously at Kettle** and the problem that just appeared, and ends with **Next episode**: the new problem the fix creates.
- Learn the problem first, and the technique stops being trivia.

## Where Kettle is now {b}

Kettle survives normal days easily. Under real load, the problems are subtler: memory that climbs all day, counters that lose updates, and a slow page that nobody can explain. Part X goes inside the runtime: the garbage collector, threads, and the method for finding what's really slow.

## The road through Part X {b}

| # | Episode | What breaks at Kettle | What you learn |
|---|---|---|---|
| 1 | [Who cleans up?](ch:memory-gc) | Kettle's memory climbs all day and never comes back down. | The stack and the heap, generations, the large object heap, finalizers and finding leaks |
| 2 | [Two threads, one counter](ch:threading-concurrency) | 1,000 orders were placed. The counter says 994. | Race conditions, Interlocked, locks, deadlocks, concurrent collections and Channels |
| 3 | [Measure, don't guess](ch:performance-engineering) | Someone rewrote a loop with Span. The page is still slow. | Measuring before optimising, percentiles, profilers and load tests |

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

By the end of Part X, Kettle is fast for reasons the team can measure and explain. Then an email arrives from a security researcher. That's Part XI.

[Start: Episode 1 · Who cleans up? →](ch:memory-gc)
