---
id: ui-story
title: "Part IV as One Story: Kettle Gets a Face"
summary: "Read this first. Kettle's API serves the mobile app, but staff fix orders with hand-written SQL and the storefront feels clunky. Part IV builds Kettle's user interfaces in C#: a server-rendered admin site with Razor Pages and MVC, then an interactive storefront with Blazor, choosing where each page runs and taking it to production. Each chapter is an episode: something is missing at Kettle, and the chapter supplies it."
layer: framework
where: Web UI › Start of Part IV
fits: "The doorway into Part IV, Web UI. Everything here runs on the ASP.NET Core you learned in Part III: the same host, DI, middleware, routing and auth."
levels: b
prereqs: app-models
next: razor-mvc
---

## The 30-second version

- Part IV builds Kettle's user interfaces in C#, from simple server-rendered pages to an interactive storefront.
- 4 episodes. Each starts with **Previously at Kettle** and ends with **Next episode**.
- Server-rendered HTML first, because it's the simplest thing that works. Then Blazor, where interactivity is worth its cost.

## Where Kettle is now {b}

Kettle's API is solid, and the mobile app uses it happily. But Kettle's staff still fix orders by running SQL by hand, and the website's basket reloads the whole page every time a quantity changes. The team writes C#, not JavaScript. Part IV gives Kettle a face, in C#, choosing the simplest tool that does each job.

## The road through Part IV {b}

| # | Episode | What's missing at Kettle | What you learn |
|---|---|---|---|
| 1 | [MVC and Razor Pages](ch:razor-mvc) | Staff need an admin site: a dozen forms and tables. | Server rendering, Razor, MVC and Razor Pages, forms, validation, antiforgery, filters |
| 2 | [Blazor components](ch:blazor-components) | The basket should update instantly, without a JavaScript front end. | Components, parameters and events, binding, the lifecycle, re-rendering, forms, state |
| 3 | [Render modes](ch:blazor-render-modes) | Product pages need speed and SEO, the basket needs instant updates, the warehouse needs to cope with bad Wi-Fi. | Static SSR and streaming, Interactive Server, WebAssembly, Auto, prerendering, scaling |
| 4 | [Blazor in production](ch:blazor-advanced) | A JavaScript payment widget, sign-in, a 4,000-row order history, errors and tests. | JS interop, authorization, performance, error boundaries, testing |

## How to read each episode {b}

Every chapter in this part follows the same beats:

1. **Previously at Kettle.** Where the shop is, in two or three sentences.
2. **The problem.** What's missing or what hurts.
3. **The chapter itself.** Plain-words summaries first, then the mechanics, then in-depth sections and interview questions.
4. **Next episode.** The new need that leads into the next chapter.

## Where this part ends {b}

By the end of Part IV, Kettle has three faces: a JSON API for the mobile app, a Razor Pages admin site, and a Blazor storefront that's static where it can be and interactive where it needs to be. All three still keep their data in memory, so every deploy wipes the orders. That's Part V.

[Start: Episode 1 · MVC and Razor Pages →](ch:razor-mvc)
