---
id: projects-story
title: "Part XIV as One Story: Kettle Wholesale, Done Right"
summary: "Read this first. Kettle starts a second product, Kettle Wholesale, from an empty repository, and this time the team does it right from day one. Part XIV is the practice of building real software: the foundations to set up before the first feature, delivering a large project in small safe steps, running it in production, the staff engineer's job of technical direction, and a capstone that follows Wholesale from idea to production. Each chapter is an episode."
layer: arch
where: Building real projects › Start of Part XIV
fits: "The doorway into Part XIV, Building Real Projects. Every earlier part taught a technology; this part teaches how to put them together into a project that ships and keeps working."
levels: b
prereqs: oauth-oidc-identity
next: project-foundations
---

## The 30-second version

- Part XIV is about **building projects**, not learning technologies: the habits, decisions and practices that make the difference between a codebase that ages well and one nobody wants to touch.
- 5 episodes. Each starts with **Previously at Kettle** and ends with **Next episode**.
- It's written for the level of a staff engineer: you'll set things up, lead delivery, own production and set direction. That's what staff interviews probe.

## Where Kettle is now {b}

Kettle has been built, scaled, operated and secured, but it got there the hard way: years of warnings nobody reads, a six-month branch that broke payments, incidents nobody learned from. Now cafés and offices want to buy in bulk, and the founders approve a new product, **Kettle Wholesale**, with a new team. This time, you're the staff engineer setting it up, and it's going to be done right from the first commit.

## The road through Part XIV {b}

| # | Episode | What goes wrong (or must not) | What you learn |
|---|---|---|---|
| 1 | [Starting a project right](ch:project-foundations) | The old codebase drifted into hundreds of warnings and two-day setups. | Layout, Directory.Build.props, central packages, analyzers and enforced style, the walking skeleton, CI, decision records |
| 2 | [Delivering large projects](ch:delivering-work) | The last big feature lived on a branch for six months and broke payments. | Vertical slices, de-risking, trunk-based development, feature flags, branch by abstraction, review, testing strategy, tech debt |
| 3 | [Seeing it through](ch:production-ownership) | The first invoice run failed silently at 2 a.m. | Readiness reviews, SLOs and error budgets, alerts, runbooks, on-call, incidents, postmortems, versioning, DORA |
| 4 | [Working as a staff engineer](ch:staff-engineer) | One person can't review everything for three teams. | Design docs, decisions, strategy, migrations, influence, growing people, staff interviews |
| 5 | [Capstone: zero to production](ch:capstone-wholesale) | Knowing each piece isn't knowing what to do on Monday. | The whole project, phase by phase, linked to every chapter |

## How to read each episode {b}

Every chapter in this part follows the same beats:

1. **Previously at Kettle.** Where Wholesale is, in two or three sentences.
2. **The problem.** What the team has to get right next.
3. **The chapter itself.** Plain-words summaries first, then the practices with real files and examples, then in-depth sections and interview questions.
4. **Next episode.** What comes next in the project.

:::tip The files are real
The build settings, `.editorconfig`, CI workflow, feature-flag code and test projects in this part were built and run with the .NET SDK while writing it, including deliberately breaking each quality gate to prove it fails the build. The gotchas you'll read about came from that.
:::

## Where this part ends {b}

By the end of Part XIV, Wholesale is live, measured and well run, and you've seen every technique in the book used together on one project. Part XV turns that into interview performance.

[Start: Episode 1 · Starting a project right →](ch:project-foundations)
