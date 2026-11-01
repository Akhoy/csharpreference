---
id: data-story
title: "Part V as One Story: Kettle Remembers"
summary: "Read this first. Kettle's API works, but every deploy wipes the orders, because they live in a list in memory. Part V gives Kettle a memory that survives restarts, stays correct when two people change the same thing, and stays fast as the tables grow into millions of rows. Each chapter is an episode: something breaks at Kettle, and the chapter is the fix."
layer: data
where: Data access › Start of Part V
fits: "The doorway into Part V, Data Access. It shows the whole road before you walk it, so each chapter arrives as the answer to a problem you've already met."
levels: b
prereqs: blazor-advanced
next: relational-fundamentals
---

## The 30-second version

- Part V gives Kettle a memory that survives restarts, stays correct when two people change the same thing, and stays fast as the tables grow into millions of rows.
- 6 episodes. Each starts with **Previously at Kettle** and the problem that just appeared, and ends with **Next episode**: the new problem the fix creates.
- Learn the problem first, and the technique stops being trivia.

## Where Kettle is now {b}

Kettle's API works, but every deploy wipes the orders, because they live in a list in memory. Part V gives Kettle a memory that survives restarts, stays correct when two people change the same thing, and stays fast as the tables grow into millions of rows.

## The road through Part V {b}

| # | Episode | What breaks at Kettle | What you learn |
|---|---|---|---|
| 1 | [Tables, indexes, transactions](ch:relational-fundamentals) | Kettle's orders need to survive crashes, and finding them must stay fast. | Tables and keys, normalisation, indexes, transactions and isolation levels |
| 2 | [Talking SQL directly](ch:ado-dapper) | One report needs hand-tuned SQL, and it must be safe from injection. | ADO.NET underneath everything, Dapper, parameters and connection pooling |
| 3 | [Objects in, rows out](ch:efcore-fundamentals) | Hand-written SQL for every insert and update is slow to write and easy to get wrong. | DbContext, change tracking, SaveChanges and migrations |
| 4 | [The N+1 trap](ch:efcore-querying) | The order list page sends 101 SQL queries. | How LINQ becomes SQL, the N+1 problem, projections, AsNoTracking and split queries |
| 5 | [Two people, one order](ch:efcore-advanced) | Two staff members edit the same order. The second save silently wins. | Optimistic concurrency, transactions, global filters, bulk updates and interceptors |
| 6 | [Not everything is a table](ch:nosql-redis) | Shopping carts change constantly and are read by one key. A relational table is overkill. | Document stores and partition keys, Redis, and the CAP trade-off |

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

By the end of Part V, Kettle's data is durable, correct under concurrency and fast to query, with a cache in front of the hot reads. But the code that does all this has grown into a few enormous classes. Part VI is about shaping it.

[Start: Episode 1 · Tables, indexes, transactions →](ch:relational-fundamentals)
