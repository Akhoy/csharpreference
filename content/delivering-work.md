---
id: delivering-work
title: "Delivering Large Projects: Slices, Flags and Safe Change"
summary: "How a team ships a big project in small, safe steps. Covers vertical slices and how to cut them, estimating in ranges and de-risking the scariest part first, trunk-based development with feature flags (including the percentage-rollout trap, verified against the real library), branch by abstraction, parallel runs and the strangler fig for changing code that's already live, a definition of done, code review that works, a testing strategy that scales, managing technical debt, and keeping a project visibly on track."
layer: arch
where: Building real projects › Delivering
fits: "Builds on the [foundations](ch:project-foundations). Uses [testing](ch:unit-testing), [CI/CD deployment strategies](ch:cicd-iac#deployment-strategies), [configuration](ch:configuration-options) and [architecture](ch:app-architectures) as everyday tools of delivery."
levels: b,i,a
prereqs: project-foundations
next: production-ownership
---

## The 30-second version

- **Big projects fail at the end**, when separately built pieces meet for the first time. Avoid "the end": integrate and deploy continuously from day one.
- **Slice vertically**: each piece of work goes from UI or API to database and is usable (or at least demoable) on its own.
- **Do the riskiest part first.** The thing you understand least is where the schedule is hiding.
- **Merge to `main` daily**, with unfinished features hidden behind **feature flags**. Deploying and releasing become separate decisions.
- **Change live code in parallel**: build the new path beside the old one, compare them, switch over gradually, then delete the old one.
- **Make "done" mean done**: tested, reviewed, observable, documented, deployed.
- **Pay down technical debt continuously**, in small amounts, tied to the work it slows down.

## Previously at Kettle {b}

Kettle Wholesale's walking skeleton is in production ([last episode](ch:project-foundations)). The backlog has forty items: customer accounts, credit limits, quotes, scheduled deliveries, invoices, a finance report. Five developers, a fixed trade-show launch date in four months.

**The problem:** the original Kettle shipped its big "checkout rewrite" after six months on a branch; the merge took three weeks and the launch broke payments. Nobody wants that again.

**This episode:** how to break the work down, merge it every day, change live code safely, and know at any moment whether you'll make the date.

## Start from zero: why big projects go wrong {b}

:::plain
Projects rarely fail because the code is hard. They fail because problems are discovered late: pieces that don't fit together, work that was bigger than it looked, and a date that was never realistic. Every technique in this chapter moves discovery earlier.
:::

| What goes wrong | Why | What fixes it |
|---|---|---|
| Integration hell at the end | pieces built separately for months | merge daily, deploy continuously |
| "90% done" for weeks | progress measured in tasks, not working software | vertical slices that are demoable |
| A late surprise kills the date | the hardest part was left until last | tackle the riskiest part first |
| Everything is released at once | deploy and release were the same event | feature flags |
| The rewrite never finishes | the old system must keep running meanwhile | parallel change, strangler fig |
| Quality drops near the deadline | "done" quietly lost its meaning | a written definition of done |

## Vertical slices {b}

:::plain
Instead of building the whole database layer, then the whole API, then the whole UI, build one small feature through every layer at a time. Each slice works on its own and can be shown to someone.
:::

```text
 horizontal (avoid)                         vertical (do this)
 ┌──────────────────────────────┐           ┌─────┬─────┬─────┬─────┐
 │ UI for everything            │ month 3   │     │     │     │     │
 ├──────────────────────────────┤           │ get │ ask │ add │ re- │
 │ API for everything           │ month 2   │  a  │ for │ to  │ peat│
 ├──────────────────────────────┤           │quote│bulk │cart │order│
 │ database for everything      │ month 1   │     │price│     │     │
 └──────────────────────────────┘           └─────┴─────┴─────┴─────┘
  nothing works until month 3                week 1: something works; each week: more
```

How to cut a feature into slices:

- **Happy path first**: "a known customer gets a quote for one product" before discounts, credit checks and errors.
- **By workflow step**: request a quote → accept it → schedule delivery → invoice. Each step is a slice.
- **By business rule**: list price first, then bulk discount, then per-customer pricing.
- **By data variation**: one currency, then several; UK addresses, then EU.
- **Fake the edges at first**: a slice can use a hard-coded price list or a manual email step, replaced by a real integration in a later slice.

A good slice is **small** (days, not weeks), **demoable** (someone outside the team can see it work), and **independently valuable** or at least independently **testable in production** behind a flag.

## Estimating and de-risking {i}

**Estimate in ranges, and say what the range depends on.** "Credit accounts: 2–4 weeks; the top of the range if the finance system's API doesn't support holds." A single number hides the uncertainty that the person asking actually needs to know about.

**Do the riskiest work first.** List what you don't know: the payment provider's sandbox, the finance system's API, performance of the pricing rules on 10,000 SKUs, whether customers will accept the new flow. Each unknown gets a **spike**: a short, time-boxed experiment (one to three days) that answers one question and is thrown away. Spikes in week one move surprises to where there's time to react.

**Track throughput, not effort.** Count slices finished per week, and project the remaining backlog from that. After three or four weeks the trend is far more accurate than any up-front estimate, and it shows early whether the date is realistic.

**When the date and the scope don't fit, cut scope, not quality.** Ask "what's the smallest version a trade customer would use at the show?" Cutting tests or reviews to hit a date borrows time from the weeks after launch, at a high interest rate.

## Trunk-based development and feature flags {i}

:::plain
Everyone merges small changes into the main branch every day. Code for features that aren't ready is deployed but switched off with a feature flag, so it can't affect users until you turn it on.
:::

**Deploying** (putting code on servers) and **releasing** (letting users use it) become separate decisions. Code ships continuously; features are switched on when they're ready, for whom you choose, and switched off in seconds if something goes wrong, with no redeploy.

With `Microsoft.FeatureManagement.AspNetCore`, flags live in configuration:

```json
{
  "FeatureManagement": {
    "CreditAccounts": false,
    "TieredPricing": {
      "EnabledFor": [
        { "Name": "Microsoft.Percentage", "Parameters": { "Value": 10 } }
      ]
    }
  }
}
```

```csharp norun
builder.Services.AddFeatureManagement();

app.MapPost("/api/accounts/{id}/credit", async (string id, IFeatureManager features) =>
{
    if (!await features.IsEnabledAsync("CreditAccounts"))
    {
        return Results.NotFound();          // the feature doesn't exist yet, as far as callers know
    }

    return Results.Ok(new { id, limit = 5_000m });
});

app.MapGet("/api/quotes/{sku}", async (string sku, int kg, IFeatureManager features) =>
{
    var quote = await features.IsEnabledAsync("TieredPricing")
        ? QuoteCalculator.For(sku, kg, listPricePerKg: 19.50m)
        : QuoteCalculator.For(sku, kg, listPricePerKg: 20.00m);
    return Results.Ok(quote);
});
```

This code was run against the real package: with `CreditAccounts` off, the endpoint returns 404; with `TieredPricing` at 10%, 4 of 40 requests got the new price.

:::gotcha A percentage flag is a coin toss on every call
`Microsoft.Percentage` decides **each time it's evaluated**. The same customer can get the new price on one request and the old price on the next, and a quote can disagree with the invoice. For anything user-facing, use the **targeting** filter (`Microsoft.Targeting`), which assigns each user or group consistently ("10% of users, always the same 10%", plus named users and groups such as `beta-cafes`), and provide the current user through an `ITargetingContextAccessor`. Pure percentage is fine for things like sampling a debug log.
:::

**Kinds of flags**, which deserve different handling:

| Kind | Example | Lifetime |
|---|---|---|
| **Release** | hide credit accounts until launch | weeks; remove after full rollout |
| **Ops / kill switch** | turn off the recommendations call if it's slow | permanent, documented in runbooks |
| **Experiment** | which checkout layout converts better | the length of the experiment |
| **Permission** | premium reports for some customers | permanent; really authorization, so treat it as such |

**Flag hygiene**, or the codebase fills up with dead branches:

- Every release flag gets an **owner and a removal date** when it's created. Removing it is part of the feature's definition of done.
- **Test both paths** while the flag exists. CI runs the suite with the flag on and off, or tests set it explicitly.
- **Default to off** and fail closed: if the flag service is unreachable, the unfinished feature stays hidden.
- **Keep flag checks at the edges** (endpoint or composition root), not scattered through the domain. One `if` that chooses an implementation beats twenty `if`s inside it.
- For dynamic changes without redeploys, keep flags in a central store (Azure App Configuration, LaunchDarkly, or a database) rather than `appsettings.json`.

## Changing code that's already live {a}

:::plain
To replace something users depend on, don't edit it in place. Build the new version next to the old one, check they agree, move traffic over gradually, and only then delete the old one.
:::

**Branch by abstraction.** Put an interface in front of the thing you're replacing; make all callers use the interface; add the new implementation behind it; switch with a flag; delete the old implementation. Every step is a small, mergeable, deployable change, so the "big change" never lives on a branch.

**Parallel run (shadowing).** Before switching, run the new implementation on real inputs alongside the old one, use the old one's answer, and record where they differ:

:::walk Running new pricing in the shadow of the old
```csharp
var orders = new[] { (Kg: 10, List: 20.00m), (Kg: 60, List: 20.00m), (Kg: 200, List: 18.00m) };

IPricing live = new LegacyPricing();
IPricing candidate = new TieredPricing();
var mismatches = 0;

foreach (var o in orders)
{
    var charged = live.PricePerKg(o.Kg, o.List);       // customers still get the old answer
    var shadow = candidate.PricePerKg(o.Kg, o.List);   // the new code runs on the same input
    if (charged != shadow)
    {
        mismatches++;
        Console.WriteLine($"{o.Kg} kg: legacy {charged}, tiered {shadow}");
    }
}
Console.WriteLine($"{mismatches} of {orders.Length} differ");

interface IPricing { decimal PricePerKg(int kg, decimal list); }

class LegacyPricing : IPricing
{
    public decimal PricePerKg(int kg, decimal list) => kg >= 50 ? list * 0.90m : list;
}

class TieredPricing : IPricing
{
    public decimal PricePerKg(int kg, decimal list) => kg switch
    {
        >= 100 => list * 0.85m,
        >= 50 => list * 0.90m,
        _ => list,
    };
}
```
@19 | -
**The abstraction.** Both implementations sit behind one interface, so callers don't know or care which one they get. This is the first, safe, behaviour-preserving commit.
@21-24 | -
The old rule: 10% off from 50 kg.
@26-34 | -
The new rule adds a 15% tier from 100 kg. It's merged and deployed, but not yet used for real prices.
@3-5 | live = → LegacyPricing ; candidate = → TieredPricing ; mismatches = 0
Production still uses the legacy pricing. The candidate runs alongside it.
@9-10 | charged = 20.00 ; shadow = 20.00
10 kg: both give list price. They agree, so nothing is logged.
@9-10 | charged = 18.0000 ; shadow = 18.0000
60 kg: both apply 10% off. Still in agreement.
@9-15 | charged = 16.2000 ; shadow = 15.3000 ; mismatches = 1 | > 200 kg: legacy 16.2000, tiered 15.3000
200 kg: they differ. In production this goes to a log or metric, not the console. Here the difference is **intended** (the new tier), but the same comparison catches the unintended ones: a rounding change, a missed rule, a currency bug.
@17 | | > 1 of 3 differ
Once the only differences are the intended ones, for long enough on real traffic, flip the flag to use the candidate, watch the metrics, and finally delete `LegacyPricing`.
:::

**Shadowing rules:** the shadow path must have **no side effects** (no emails, no charges, no writes the real path depends on); it must not slow down or break the real path (run it after the response, with its own timeout and its errors swallowed and logged); and comparisons need a tolerance or normalisation where exact equality is too strict.

**The strangler fig** applies the same idea to whole systems: put a routing layer (often a reverse proxy or YARP gateway) in front of the old system, move one route or feature at a time to the new system, and keep going until the old one handles nothing and can be switched off ([Service boundaries](ch:ms-boundaries)).

**Parallel change for data** is the expand/contract migration: add the new column or table, write to both, backfill, switch reads, stop writing the old, then remove it ([Linux deployment](ch:linux-deploy#database-changes-during-a-deploy)).

## A definition of done {b}

Write it down once, as a team, and check every slice against it:

- [ ] Meets the acceptance criteria, demonstrated to the person who asked for it
- [ ] Automated tests at the right levels; CI green
- [ ] Reviewed and merged to `main`; feature flag in place if not yet released
- [ ] **Observable**: logs, metrics or traces that would show if it breaks in production
- [ ] Errors handled and returned as ProblemDetails; inputs validated
- [ ] Security considered: authorization on every new endpoint, no secrets in code
- [ ] Database migrations backward compatible
- [ ] Docs updated: API description, README or runbook if operations change
- [ ] Deployed to production (released or behind a flag)

"Done" without "deployed" and "observable" is how a team ends up with a backlog of finished work that fails in its first week live.

## Code review that works {i}

Code review exists to catch problems early and to spread knowledge, in that order. It fails when reviews are slow, nit-heavy, or rubber stamps.

**For reviewers**, look at things in order of cost to fix later:

1. **Design**: is this the right change, in the right place? Does it fit the architecture and decision records?
2. **Correctness**: edge cases, concurrency, error handling, security (authorization, input validation, injection).
3. **Tests**: do they test behaviour, and would they fail if the code broke?
4. **Operability**: can we tell when this breaks in production? Is the migration safe?
5. **Readability**: names, structure. Formatting should be the tools' job, never a comment.

**Label comments**: `blocking:`, `suggestion:`, `nit:`, `question:`. The author knows what must change before merging. Praise good work too; review is also how standards spread.

**For authors**: keep pull requests small; describe what, why, how it was tested and how to roll back; review your own diff first; answer every comment, even with "done".

**Turnaround is a team commitment**: first response within a working day, ideally a few hours. Slow reviews are the main reason people make big pull requests, which then get worse reviews.

## A testing strategy that scales {i}

| Level | Tests what | Speed | Kettle Wholesale examples |
|---|---|---|---|
| **Unit** | domain rules, calculations, state changes | milliseconds | quote pricing, credit limit checks |
| **Integration** | one service with its real database, HTTP pipeline | seconds | endpoints via `WebApplicationFactory` and Testcontainers |
| **Contract** | the agreement between services or with clients | seconds | consumer-driven contracts with the storefront |
| **End-to-end** | a few critical journeys through the deployed system | minutes | "trade customer orders and gets an invoice" |

- **Most tests where the logic is.** Business rules get thorough unit tests; integration tests prove the wiring (routing, serialization, database mapping, auth) with fewer cases ([Unit testing](ch:unit-testing), [Integration testing](ch:integration-testing)).
- **A few end-to-end tests** for the journeys that make money. They're slow and brittle, so keep them to the essentials.
- **Flaky tests are bugs.** Quarantine one the day it flakes, fix it within days, or delete it. A suite people re-run until it's green teaches them to ignore failures.
- **Test behaviour, not implementation.** Tests that break on every refactor make people afraid to refactor.

## Technical debt {i}

:::plain
Technical debt is the extra cost of changing code because of shortcuts or designs that no longer fit. Like money debt, some is useful, but the interest compounds if you never pay it back.
:::

- **Not all debt is a mistake.** A shortcut taken knowingly to hit the trade show, written down with the plan to fix it, is a reasonable loan. Debt nobody knows about, from unclear code or outdated designs, is the dangerous kind.
- **Make it visible**: a short list (in the tracker or a `docs/tech-debt.md`) of each item with its **cost**: "every new product type needs changes in six places; adds ~2 days to each pricing feature".
- **Pay it where you're working.** Refactor the code you're about to change, as a separate commit or pull request first ("make the change easy, then make the easy change"). Debt in code nobody touches costs little; leave it.
- **Budget for it**: a steady share of each iteration (often 15–20%) rather than a "cleanup sprint" that never gets approved.
- **Argue for it in business terms.** "This slows every pricing feature by two days, and we have eight planned" persuades people; "the code is ugly" doesn't.

## Keeping it on track, visibly {i}

- **Demo working software every week or two** to the people who asked for it. It catches misunderstandings while they're cheap and shows progress no status report can.
- **Report status honestly and early**: what's done, what's next, what's at risk and what you need. Bad news delivered early is a planning input; delivered late, it's a crisis.
- **Keep a short risk list** with an owner and a next step for each. Review it weekly; retire risks with spikes.
- **Write down scope decisions**, especially what's *not* in the launch. It prevents the same debate every week and protects the date.
- **Protect focus**: fewer things in progress at once finish sooner. Five developers on five unrelated features finish nothing for weeks; pairing on the riskiest slice finishes it.

## Interview questions {i}

:::qa How would you deliver a large feature without a long-lived branch?
Break it into vertical slices and merge each to main daily, keeping unfinished parts behind a feature flag so deploying and releasing are separate. Use branch by abstraction to replace existing behaviour: introduce an interface, add the new implementation behind it, switch over with a flag, then delete the old code. Each step is small, reviewed and deployable.
:::

:::qa What are the risks of feature flags, and how do you manage them?
Flags multiply code paths, so untested combinations and dead code accumulate. Manage them by giving release flags an owner and removal date, testing both states, defaulting to off, keeping checks at the edges, and using consistent per-user targeting rather than random percentages for user-facing rollouts. Kill switches are permanent and documented in runbooks.
:::

:::qa How would you replace a critical component, such as pricing, that's live?
Put an abstraction in front of it, build the replacement behind it, and run it in shadow mode on real traffic, logging differences while still serving the old results. Fix unexpected differences, then roll out gradually with a flag while watching metrics, keeping a fast switch back, and finally remove the old implementation. For data, use expand/contract migrations.
:::

:::qa How do you handle technical debt as a staff engineer?
Make it visible with its cost in delivery terms, pay it down where the team is actively working rather than in separate cleanup projects, reserve a steady share of capacity, and argue for larger items with the business impact, such as how much each future feature will cost without the fix. Deliberate, documented shortcuts are acceptable loans; unknown debt is the danger.
:::

:::qa The project is behind. What do you do?
Find out early by tracking throughput against the remaining scope. Then make the trade-off explicit to stakeholders: cut or defer scope (the usual answer), move the date, or, rarely, add people to well-separated work. Don't cut quality or testing, which only moves the cost to after launch. Re-plan around the riskiest remaining work.
:::

## Next episode {b}

Wholesale launches at the trade show, on time, and the first cafés start ordering. Now it has to stay up: alerts at night, a slow query on invoice day, an incident, a release process, and new people joining who need to understand it. [Episode 3 · Seeing it through: running what you built →](ch:production-ownership)

## Further reading

- [Feature management in .NET](https://learn.microsoft.com/en-us/azure/azure-app-configuration/feature-management-dotnet-reference)
- Martin Fowler: [Branch by abstraction](https://martinfowler.com/bliki/BranchByAbstraction.html), [Strangler fig application](https://martinfowler.com/bliki/StranglerFigApplication.html), [Feature toggles](https://martinfowler.com/articles/feature-toggles.html)
- [Trunk-based development](https://trunkbaseddevelopment.com/)
- [Google's engineering practices: code review](https://google.github.io/eng-practices/review/)
- *Accelerate* (Forsgren, Humble, Kim) on the practices behind fast, stable delivery
