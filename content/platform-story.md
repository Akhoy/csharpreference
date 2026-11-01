---
id: platform-story
title: "Part I as One Story: Before Kettle's First Line"
summary: "Read this first. Two developers want to start an online tea shop called Kettle. Before they write a line of code, they need a platform that runs a web API, background jobs and a few tools, on their laptops and on Linux servers, and they need to understand what happens between pressing Run and the first order being saved. Part I is that groundwork. Each chapter is an episode: something breaks at Kettle, and the chapter is the fix."
layer: runtime
where: The .NET platform › Start of Part I
fits: "The doorway into Part I, The .NET Platform. It shows the whole road before you walk it, so each chapter arrives as the answer to a problem you've already met."
levels: b
prereqs: breadth-first
next: what-is-dotnet
---

## The 30-second version

- Part I is that groundwork.
- 4 episodes. Each starts with **Previously at Kettle** and the problem that just appeared, and ends with **Next episode**: the new problem the fix creates.
- Learn the problem first, and the technique stops being trivia.

## Where Kettle is now {b}

Two developers want to start an online tea shop called Kettle. Before they write a line of code, they need a platform that runs a web API, background jobs and a few tools, on their laptops and on Linux servers, and they need to understand what happens between pressing Run and the first order being saved. Part I is that groundwork.

## The road through Part I {b}

| # | Episode | What breaks at Kettle | What you learn |
|---|---|---|---|
| 1 | [One platform for every app](ch:what-is-dotnet) | Kettle needs a web API, a background worker and a command-line tool. | What .NET is, the runtime vs the SDK, .NET vs .NET Framework, and the release cycle |
| 2 | [Your first .NET app](ch:first-app) | Nobody on the team has created, debugged or published a .NET project. | Creating projects, Program.cs, namespaces, the C# you'll see early, dotnet watch, debugging, solutions, packages, tests, publishing |
| 3 | [From C# to machine code](ch:how-code-runs) | The CPU cannot read C#. Something has to translate it. | Compilation to IL, assemblies and metadata, the JIT and its tiers, and Native AOT |
| 4 | [Projects and packages](ch:projects-sdk-nuget) | Kettle needs other people's libraries, and a repeatable build. | Projects and solutions, the SDK and MSBuild, NuGet packages, and keeping versions consistent |

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

By the end of Part I, Kettle has a platform, a solution layout and a build that turns C# into running machine code. Now it needs actual code, and its first bug is waiting.

[Start: Episode 1 · One platform for every app →](ch:what-is-dotnet)
