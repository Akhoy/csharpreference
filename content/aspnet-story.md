---
id: aspnet-story
title: "Part III as One Story: Kettle Goes Online"
summary: "Read this first. At the end of Part II, Kettle's C# was solid, but it ran as a program the team started by hand. Now the website and the new mobile app need answers in milliseconds, all day, from thousands of customers at once. Part III turns Kettle's code into a web API, one painful lesson at a time. Each chapter is an episode: something breaks at Kettle, and the chapter is the fix."
layer: framework
where: ASP.NET Core › Start of Part III
fits: "The doorway into Part III, ASP.NET Core. It shows the whole road before you walk it, so each chapter arrives as the answer to a problem you've already met."
levels: b
prereqs: advanced-csharp
next: aspnet-hosting
---

## The 30-second version

- Part III turns Kettle's code into a web API, one painful lesson at a time.
- 13 episodes. Each starts with **Previously at Kettle** and the problem that just appeared, and ends with **Next episode**: the new problem the fix creates.
- Learn the problem first, and the technique stops being trivia.

## Where Kettle is now {b}

At the end of Part II, Kettle's C# was solid, but it ran as a program the team started by hand. Now the website and the new mobile app need answers in milliseconds, all day, from thousands of customers at once. Part III turns Kettle's code into a web API, one painful lesson at a time.

## The road through Part III {b}

| # | Episode | What breaks at Kettle | What you learn |
|---|---|---|---|
| 1 | [Program.cs, start to finish](ch:aspnet-hosting) | Kettle needs to answer HTTP requests, start cleanly and stop without dropping orders. | The host, Kestrel and the two phases of Program.cs, and how a graceful shutdown drains requests |
| 2 | [Let the container build it](ch:dependency-injection) | Every class news up its own dependencies. Swapping the payment provider means editing ten files. | How a container builds object graphs for you, lifetimes, and the captive-dependency bug |
| 3 | [Settings in layers](ch:configuration-options) | The payment key differs on a laptop, in staging and in production. | Layered configuration, typed and validated options, and where secrets belong |
| 4 | [The request pipeline](ch:middleware) | Every request needs logging, auth and error handling, and copying it into each endpoint won't scale. | The request pipeline, how middleware wraps the rest, and why order matters |
| 5 | [Which code handles this URL?](ch:routing) | GET /orders/42 has to find exactly one handler. | Endpoint routing, route templates and constraints, and how auth reads endpoint metadata |
| 6 | [An endpoint, end to end](ch:building-apis) | POST /orders must accept JSON, reject bad input and say what it created. | Minimal APIs and controllers, binding, validation, typed results and OpenAPI |
| 7 | [When it breaks at 2 a.m.](ch:errors-logging) | A customer sees a stack trace, and the logs are unsearchable text. | One place for exceptions, ProblemDetails, and structured logging |
| 8 | [Who are you, and may you?](ch:auth) | Anyone can call DELETE /orders/42. | Authentication vs authorization, JWTs, policies and resource-based checks |
| 9 | [Calling other services](ch:http-client) | Under load, Kettle runs out of sockets calling the shipping API. | IHttpClientFactory, typed clients, timeouts and the resilience handler |
| 10 | [Cache, limit, allow](ch:caching-ratelimit-cors) | The tea catalogue is read 10,000 times a minute and changes once a day. | Caching layers and stampedes, rate limiting, and what CORS really does |
| 11 | [Work after the response](ch:background-work) | Sending the confirmation email makes checkout 3 seconds slower. | Hosted services, queues with Channels, and scheduled jobs that run once across replicas |
| 12 | [An API people can trust](ch:api-design) | A mobile client retries POST /orders after a timeout. The customer is charged twice. | HTTP semantics, idempotency keys, pagination, versioning and ETags |
| 13 | [Many front doors, one host](ch:app-models) | Kettle needs an admin site, live order tracking and fast internal calls. | MVC and Razor Pages, Blazor, SignalR, gRPC and worker services, all on one host |

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

By the end of Part III, Kettle is a real web API: it starts and stops cleanly, wires its services together, knows who's calling, survives slow partners and serves several kinds of client. It still keeps its orders in memory, though. That's Part V.

[Start: Episode 1 · Program.cs, start to finish →](ch:aspnet-hosting)
