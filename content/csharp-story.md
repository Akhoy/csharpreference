---
id: csharp-story
title: Part II as One Story: Building Kettle
summary: Read this first. Part II follows one small app, an online tea shop called Kettle, from its first bug to its first performance fix. Each chapter is an episode. Something breaks or gets painful, and one C# feature is the fix.
layer: language
where: C# language › Start of Part II
fits: This is the doorway into layer 1, the language. Part I showed how C# becomes IL and then machine code. Part II is about the code you actually write, and why C# gives you each tool.
levels: b
prereqs: how-code-runs
next: type-system
---

## The 30-second version

- You've just joined a two-person team building **Kettle**, an online tea shop. The backend is C#.
- Over ten episodes the shop grows: more orders, more payment options, more reports, more traffic. Each step causes a problem.
- Each problem is the reason one C# feature exists. Learn the problem first and the feature makes sense. Learn the feature alone and it reads like trivia.
- Every chapter in Part II is one episode. Read them in order. Each one opens with what went wrong and ends with the problem that starts the next one.

## Why a story? {b}

Most C# references hand you features in alphabetical-ish order: structs, then classes, then interfaces, then delegates. You learn *what* each one is, but not *why you'd want it*. So nothing sticks.

Part II works the other way round. You'll hit the problem first. You'll feel why the obvious approach hurts. Then the feature arrives, and the reaction should be "oh, *that's* what it's for".

:::analogy How to read each episode
Every chapter follows the same five beats:

1. **Previously.** One line on where the shop is.
2. **The problem.** Something breaks, or gets slow, or gets repetitive.
3. **The lightbulb.** The one idea that explains it, given a name.
4. **The tools.** Short sections, each with a picture and a tiny program you can run in the page.
5. **Next episode.** The new problem the fix just created.
:::

## The road through Part II {b}

Click **Next** (or **Play**) to walk the whole road. Each stop is one chapter.

:::scene visuals/scenes/p2-road.svg | Ten episodes, one shop
1. **Types.** You copy a customer's basket to "save it for later". Then you edit the copy and the *original* changes too. Why? Because C# has two kinds of types: one is copied when you assign it, the other is *shared*. This is the idea everything else is built on.
2. **Classes.** An order turns up with a quantity of −3 and a status of "Shipped" before it was paid. Anyone could set any field. Classes let an object **guard its own rules**, and interfaces let one checkout handle cards, PayPal and gift cards.
3. **Generics.** You've written `OrderCache`, `CustomerCache` and `ProductCache`. They're the same 40 lines with a different type name. Generics let you write it **once** as `Cache<T>`, and the compiler fills in the type.
4. **Delegates.** The owner changes the discount rule every week, and each change means editing checkout code. Delegates let you **pass behaviour around like a value**, so the rule becomes something you plug in.
5. **Collections.** Kettle gets popular. Finding one order in a list of 200,000 is slow. The right collection (a `Dictionary` instead of a `List`) turns "check every item" into "jump straight to it".
6. **LINQ.** The owner wants reports: top customers, revenue per month, unpaid orders. Hand-written loops pile up. LINQ lets you **describe the result** and let the library do the looping.
7. **Exceptions.** The payment provider fails halfway through checkout and a database connection is left open. Exceptions **stop the work cleanly**, and `using` makes sure resources get closed even when things fail.
8. **Async.** Black Friday. The site freezes, but the CPU is at 5%. Every thread is stuck waiting for the payment API. `async`/`await` lets a thread **serve someone else while it waits**.
9. **Modern C#.** A 3 a.m. `NullReferenceException`, plus 300 lines of boilerplate for simple data classes. Modern C# makes the compiler **catch nulls before they ship** and gives you records, patterns and shorthand.
10. **Advanced.** The nightly import of 2 million rows creates millions of throwaway strings and the garbage collector can't keep up. `Span<T>`, pooling and source generators let you **read data without copying it**.
:::

## The cast {b}

These types show up in almost every episode. You'll build most of them yourself.

| Type | What it is in Kettle | First appears in |
|---|---|---|
| `Basket` | What a shopper is about to buy | [Types](ch:type-system) |
| `Money` | An amount plus a currency, like `£12.50` | [Types](ch:type-system) |
| `Order`, `OrderLine` | A placed order and its lines | [Classes](ch:oop) |
| `IPaymentMethod` | Card, PayPal, gift card: anything that can pay | [Classes](ch:oop) |
| `Cache<T>`, `Result<T>` | Reusable containers for any type | [Generics](ch:generics) |
| `OrderPlaced` event | "Something happened" for email, stock and analytics to react to | [Delegates](ch:delegates-events) |

## What you need before starting {b}

Only Part I's big idea: your C# is compiled to **IL**, and the **JIT** turns IL into machine code while the app runs. If that sentence makes sense, you're ready. If not, read [How your code runs](ch:how-code-runs) first.

:::tip Run the examples
Most code blocks in Part II have a **Run ▶** button. It compiles and runs the program inside your browser, with no setup. The first run takes a few seconds while .NET loads. A few examples (async, threads) can't run in the browser, so they have no button. Copy those into a console app (`dotnet new console`) instead.
:::

**Start the story: [Episode 1 · The basket that changed by itself →](ch:type-system)**
