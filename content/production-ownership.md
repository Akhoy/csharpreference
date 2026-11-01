---
id: production-ownership
title: "Seeing It Through: Running What You Built"
summary: "What happens after launch, when the team owns the service in production. Covers a production readiness review, SLIs, SLOs and error budgets (with a runnable burn-rate calculation), alerts people trust, runbooks, sustainable on-call, running an incident, blameless postmortems, releases, versioning and deprecating APIs, documentation that stays current, DORA metrics, and ownership, handover and decommissioning."
layer: arch
where: Building real projects › Seeing it through
fits: "The operational half of delivery. Builds on [observability](ch:observability-aspire), [resilience](ch:resilience), [production configuration](ch:prod-config) and [API design](ch:api-design#versioning-deciding-what-counts-as-a-promise-you-cant-break)."
levels: b,i,a
prereqs: delivering-work
next: staff-engineer
---

## The 30-second version

- **You build it, you run it.** The team that writes the code is on the hook when it breaks, which is the strongest incentive to make it reliable.
- **Decide what "working" means in numbers**: SLIs (what you measure) and SLOs (the target). The gap between the target and perfection is your **error budget**.
- **Alert on symptoms users feel**, fast enough to act, rarely enough to trust. Every alert links to a **runbook**.
- **In an incident, mitigate first** (roll back, switch a flag off), investigate later. One person coordinates.
- **After an incident, learn without blame**: a postmortem with a timeline, causes and owned actions.
- **Version and deprecate deliberately**; keep docs next to the code; measure delivery with the four DORA metrics.

## Previously at Kettle {b}

Kettle Wholesale launched at the trade show and two hundred cafés signed up ([last episode](ch:delivering-work)). Then the first month-end invoice run timed out at 2 a.m., the on-call developer didn't know where the logs were, and a café chain's order was lost while three people debugged in parallel without telling each other.

**The problem:** shipping was the start, not the end. The team needs to know when Wholesale is unhealthy, what to do about it, and how to get better after each failure.

**This episode:** owning a service in production, from launch checklist to postmortem.

## Start from zero: what "owning" a service means {b}

:::plain
Owning a service means being responsible for it working, not just for writing it: knowing when it's broken, fixing it quickly, and making it less likely to break the same way again.
:::

Ownership has four parts, and each section of this chapter covers one:

1. **Know what good looks like**: a few numbers that say whether users are well served (SLOs).
2. **Know when it isn't**: alerts that fire for real problems and are acted on.
3. **Respond well**: runbooks, an on-call rota, and a calm way to run incidents.
4. **Improve**: postmortems whose actions actually get done, and metrics that show whether delivery is getting faster and safer.

## The production readiness review {i}

Before launch, and before each major new capability, walk through a short review with someone outside the team. It's a conversation, not a form, but the questions are the same each time:

| Area | Questions |
|---|---|
| **Purpose** | What does it do, who depends on it, and what happens to them when it's down? |
| **Architecture** | What does it depend on? What happens when each dependency is slow or down? |
| **Observability** | Can you see request rate, errors and latency per endpoint? Are logs searchable by order ID? Do traces cross service boundaries? |
| **SLOs and alerts** | What are the SLOs? What pages someone, and is there a runbook for each alert? |
| **Capacity** | What load was tested? What's the first thing to break, and at what load? |
| **Deploys** | Is deployment automated, with zero downtime and a rehearsed rollback? Are migrations backward compatible? |
| **Data** | Backups, restore tested, retention, personal data handling |
| **Security** | Authentication on every endpoint, secrets management, dependency scanning, threat model for sensitive flows |
| **People** | Who's on call? Do they have access, and have they practised? |

The app-level settings are in the [go-live checklist](ch:prod-config#the-go-live-checklist); this review asks whether the team can *run* the thing.

## SLIs, SLOs and error budgets {i}

:::plain
An SLI is a measurement of how users experience the service, like "the share of quote requests that succeed". An SLO is the target for it, like "99.9% over 30 days". The 0.1% you're allowed to fail is the error budget.
:::

**Choose SLIs from the user's point of view**, at the edge of the system:

| User journey | SLI | SLO (30 days) |
|---|---|---|
| Get a quote | share of `GET /api/quotes` that return 2xx or 4xx (not 5xx) | 99.9% |
| Get a quote quickly | share of quote requests served in under 300 ms | 99% |
| Place an order | share of orders accepted and persisted | 99.95% |
| Invoices | share of invoices generated by 06:00 on the 1st | 99% of months |

Why not 100%? Because every extra nine costs more (redundancy, slower releases, more people on call), users can't tell 99.99% from 100% through their own Wi-Fi, and a 100% target means you can never deploy anything risky. **The error budget turns reliability into a shared, numeric decision**: while there's budget left, ship features and take risks; when it's spent, slow down and work on reliability.

:::walk Error budget and burn rate, worked out
```csharp
const double Slo = 0.999;                                  // 99.9% of requests succeed
var window = TimeSpan.FromDays(30);
var budgetMinutes = (1 - Slo) * window.TotalMinutes;
Console.WriteLine($"Error budget: {budgetMinutes:0.0} minutes of total outage per 30 days");

int requests = 120_000, failed = 1_800;                     // the last hour
double errorRate = (double)failed / requests;
double burnRate = errorRate / (1 - Slo);
Console.WriteLine($"Error rate {errorRate * 100:0.0}%, burn rate {burnRate:0.0}x");

double budgetUsedThisHour = burnRate / window.TotalHours;
double daysUntilEmpty = window.TotalDays / burnRate;
Console.WriteLine($"This hour used {budgetUsedThisHour * 100:0.0}% of the monthly budget");
Console.WriteLine(burnRate >= 14.4
    ? $"PAGE: at this rate the budget is gone in {daysUntilEmpty:0.0} days"
    : "No page");
```
@1-3 | budgetMinutes = 43.2
99.9% over 30 days leaves 0.1% of the time, or of the requests, to fail: **43.2 minutes** of complete outage a month, or proportionally more time at a partial failure rate.
@4 | | > Error budget: 43.2 minutes of total outage per 30 days
That's the whole month's allowance for deploys gone wrong, dependency outages and bugs.
@6-8 | errorRate = 0.015 ; burnRate = 15
In the last hour, 1.5% of requests failed. **Burn rate** is how many times faster than "exactly on budget" you're spending: 1.5% ÷ 0.1% = 15×.
@9 | | > Error rate 1.5%, burn rate 15.0x
At 1× you'd use exactly the whole budget by the end of the month. At 15× you're in trouble.
@11-13 | budgetUsedThisHour = 0.0208 ; daysUntilEmpty = 2 | > This hour used 2.1% of the monthly budget
One bad hour at 15× spent 2% of the month's budget.
@14-16 | | > PAGE: at this rate the budget is gone in 2.0 days
A burn rate of **14.4** over one hour is the standard fast-burn paging threshold: it means 2% of the monthly budget gone in an hour. Slower burns (6× over six hours, or 1× over three days) open a ticket instead of waking someone.
:::

**Burn-rate alerts** beat "error rate above 1%" alerts because they're tied to what matters (the SLO), page quickly for severe problems, and ignore brief blips. Use two windows per alert, such as 1 hour *and* 5 minutes both above 14.4×, so the alert also stops quickly once the problem is fixed.

**An error budget policy** is agreed in advance with product: if the budget for the last 30 days is exhausted, the team prioritises reliability work over features until it recovers. Agreeing this before the bad month avoids arguing about it during it.

## Alerts people trust {i}

- **Page on symptoms, not causes.** "Quote errors are burning the budget fast" is worth waking someone for. "CPU at 85%" usually isn't: the service may be fine, and if it isn't, the symptom alert will fire.
- **Every page must be actionable and urgent.** If the right response is "look at it tomorrow", it's a ticket, not a page.
- **Every alert links to a runbook** and a dashboard. The alert text says what's wrong and what to look at first.
- **Review alerts monthly.** Delete or fix any that fired without needing action. A team that gets ten false pages a week starts ignoring the real one.
- **Watch the things nobody watches**: certificate expiry, backups that didn't run, a queue that stopped draining, a scheduled job that didn't run (alert on the *absence* of a success signal).

## Runbooks {b}

:::plain
A runbook is a short page that tells whoever is on call what an alert means and what to do about it, step by step, written before it's needed.
:::

```text
docs/runbooks/quote-errors-fast-burn.md

# Quote API: fast error-budget burn

## What it means
More than 1.4% of quote requests are failing (burn rate ≥ 14.4×). Customers can't get prices.

## First five minutes
1. Open the "Wholesale API" dashboard. Is it all endpoints or only quotes? All instances or one?
2. Was there a deploy in the last hour? (Deploys panel, or #wholesale-deploys)
   → If yes: roll back (`./deploy.sh <previous-sha>`, or "Redeploy previous" in the pipeline). Then investigate.
3. Is the database healthy? (Postgres panel: connections, CPU, slow queries)
4. Is the pricing feature flag change log showing a recent change?
   → If yes: switch the flag back in App Configuration.

## Known causes
- Connection pool exhaustion after a traffic spike → scale out to 4 instances (command below)
- Price list cache cold after a Redis restart → errors stop within 5 minutes; no action

## Escalate
After 15 minutes without mitigation, page the secondary on-call and open an incident (#incidents).
```

Good runbooks start with **mitigation** (rollback, flag off, scale out), name exact commands and dashboards, are tested in game days, and are updated after every incident where they were wrong or missing.

## Sustainable on-call {i}

- **Small, regular rotations** of people who know the system: a week at a time, a primary and a secondary, with a proper handover.
- **The people who write the code are on the rota.** It's the feedback loop that makes code more operable.
- **Make it humane**: pages outside working hours should be rare (track them); time off after a bad night; pay or time in lieu as the company's policy allows.
- **Prepare people**: shadow shifts before the first solo week, access tested in advance, and **game days** where you break something in staging on purpose and practise the runbook.
- **Measure the load**: pages per week, out-of-hours pages, time to acknowledge. If it's rising, reliability work is not optional.

## Running an incident {i}

:::plain
An incident is any unplanned problem that hurts users. The goal is to stop the harm first, then find the cause. One person coordinates, so everyone isn't doing the same thing or contradicting each other.
:::

**Roles** (one person can hold several in a small team):

- **Incident commander**: coordinates, decides, keeps the timeline. Doesn't debug.
- **Operations lead**: investigates and applies fixes.
- **Communications**: updates the status page, support and stakeholders on a regular schedule ("next update in 30 minutes").

**The sequence:**

1. **Declare it** early, in a dedicated channel. Declaring an incident that turns out to be minor costs little; three people debugging in parallel without coordinating costs a lot.
2. **Assess severity**: how many users, which functions, is data at risk.
3. **Mitigate first**: roll back the last deploy, switch the flag off, fail over, scale out, block the abusive client. Restoring service matters more than understanding the cause, which can wait.
4. **Communicate** to users and stakeholders on a fixed schedule, even when there's nothing new.
5. **Resolve and verify**: the SLIs are back to normal, not just "the error stopped in the logs".
6. **Keep a timeline** as you go: what was seen, decided and done, with times. It's the raw material for the postmortem.

Severity levels make the response proportionate. For example: **SEV1**, ordering is down or data is being lost (all hands, status page, hourly updates to leadership); **SEV2**, a major feature is degraded; **SEV3**, a minor issue with a workaround.

## Blameless postmortems {i}

:::plain
After an incident, the team writes down what happened and why, focusing on how the system allowed the mistake rather than who made it, and agrees on changes that make it less likely or less harmful next time.
:::

```text
# Postmortem: invoice run timed out, 2026-06-01

Impact: 212 invoices late by 7 hours; 3 customers contacted support. No data lost.
Duration: 02:00–09:10 (detected 06:30 by the customer-facing check; mitigated 08:45)

## Timeline
02:00 invoice job starts      02:40 job hits 40-minute timeout, retries, times out again
06:30 "invoices not generated by 06:00" alert fires     06:42 on-call acknowledges
...

## Contributing factors
- The invoice query does a sequential scan; volume tripled since launch and nobody tested at that volume.
- The job's timeout and retry were added without an alert on failure, so failure was silent for 4.5 hours.
- The runbook didn't cover re-running a single month's invoices.

## What went well
- The SLO alert caught it before customers' business day.

## Actions
| Action | Owner | Due |
|---|---|---|
| Add index on (account_id, period); load-test at 10× volume | Priya | 2026-06-08 |
| Alert immediately when the invoice job fails | Sam | 2026-06-05 |
| Runbook: re-run invoices for a period | Alex | 2026-06-05 |
```

- **Blameless** means assuming people acted reasonably with the information and tools they had, and asking why the system made the mistake easy. Blame makes people hide information, and then nothing is learned.
- **Look for contributing factors, plural.** Incidents almost never have one root cause; "5 whys" tends to stop at one convenient answer.
- **Actions must be specific, owned and dated**, and tracked to completion. A postmortem whose actions aren't done is a document, not a lesson.
- **Share them widely.** Other teams learn from your incident for free.

## Releases, versioning and deprecation {i}

- **For a continuously deployed service**, the version is the commit SHA, and release notes are the merged pull requests behind each released feature flag. Users care about features, not deploys.
- **For things others depend on** (a public API, a NuGet package, a client SDK), use **semantic versioning**: MAJOR for breaking changes, MINOR for new features, PATCH for fixes. Keep a changelog that people can read.
- **Breaking an API is a project, not a commit** ([API design](ch:api-design#versioning-deciding-what-counts-as-a-promise-you-cant-break)):
  1. Release the new version beside the old one.
  2. Mark the old one deprecated: in the docs and OpenAPI, and on responses with the `Deprecation` and `Sunset` headers (the date it will stop working).
  3. Measure who still calls it (log the client ID per request), and contact them directly.
  4. Remove it only after the sunset date and when usage is at or near zero.
- **Decommissioning** a whole service follows the same path, plus deleting its data according to retention rules, its infrastructure, its secrets and its alerts. Forgotten services with old dependencies are a common security hole.

## Documentation that stays current {i}

Keep a small set of documents, in the repository, updated in the same pull requests as the code:

| Document | Answers | Updated when |
|---|---|---|
| **README** | how do I build, test and run it? | setup changes |
| **Architecture overview** | what are the parts, what do they depend on, how does data flow? (a context and a container diagram) | the structure changes |
| **Decision records** | why is it like this? | a significant decision is made |
| **Runbooks** | an alert fired; what do I do? | after any incident that needed them |
| **API reference** | how do I call it? | generated from OpenAPI on each build |
| **Onboarding guide** | I'm new; where do I start? | someone new joins and finds a gap |

The best test of documentation is a new joiner: ask them to follow it on day one and fix every place they get stuck. Docs that live in a wiki away from the code drift out of date quietly.

## Measuring delivery: the DORA metrics {a}

Four measures, from long-running research into software delivery, that together show both **speed** and **stability**:

| Metric | Measures | Healthy teams |
|---|---|---|
| **Deployment frequency** | how often you deploy to production | on demand, many times a day |
| **Lead time for changes** | from commit to running in production | under a day |
| **Change failure rate** | share of deployments that cause a failure needing a fix | low, roughly 0–15% |
| **Time to restore service** | from failure to recovery | under an hour |

- **Speed and stability go together.** Teams that deploy small changes often have *fewer* failures and recover faster, because each change is small and the deploy path is practised.
- **Use them to improve, not to rank.** Make them targets for individuals and people will game them (splitting deploys, not reporting failures).
- **Get them from your tools**: the pipeline knows deploys and lead times; incidents and rollbacks give change failure rate and time to restore.

## Ownership, handover and the bus factor {a}

- **Every service has exactly one owning team**, written down in a service catalogue with its on-call rota, runbooks, dashboards and dependencies. "Everybody owns it" means nobody does.
- **Spread knowledge deliberately**: pairing, rotating who works on which area, everyone on the on-call rota, and written decisions. If one person leaving would leave nobody who understands the billing code, that's a risk to manage now.
- **Hand over properly** when a service changes owner: a walkthrough of architecture, runbooks and known issues, a shadowed on-call week, and the open risks and debt list.

## Interview questions {i}

:::qa What's the difference between an SLI, an SLO and an SLA?
An SLI is a measurement of user experience, such as the share of successful requests. An SLO is the internal target for it over a window, such as 99.9% over 30 days. An SLA is a contractual promise to customers with consequences if missed, usually set looser than the SLO so the team has warning before breaching it.
:::

:::qa How would you set up alerting for a new service?
Define SLOs for the key user journeys, then alert on error-budget burn rate with multiple windows: page for fast burns that threaten the budget within days, open tickets for slow burns. Page only on urgent, actionable symptoms, link every alert to a runbook and dashboard, alert on the absence of expected signals such as job completions, and review alert noise regularly.
:::

:::qa Walk me through how you'd handle a production incident.
Declare it early in a dedicated channel, assign an incident commander who coordinates and keeps a timeline, and assess severity. Mitigate first, by rolling back, switching off a flag, failing over or scaling, before root-causing. Communicate on a fixed schedule. Confirm recovery using SLIs. Afterwards, run a blameless postmortem with contributing factors and owned, dated actions.
:::

:::qa What makes a postmortem useful?
It's blameless, so people share what really happened; it has an accurate timeline; it identifies several contributing factors, including detection and response gaps, not just one root cause; it records what went well; and its actions are specific, owned, dated and tracked to completion. It's shared beyond the team.
:::

:::qa How do you measure whether a team's delivery is improving?
With the four DORA metrics: deployment frequency, lead time for changes, change failure rate and time to restore service. Together they capture speed and stability, which improve together with small, frequent changes. Use them as team trends for improvement, not individual targets.
:::

## Next episode {b}

Wholesale is stable, measured and well run. The team grows to three squads, the original Kettle needs a new platform, and the CTO asks you to lead the technical direction. That's a different job from writing the best code on the team. [Episode 4 · Working as a staff engineer →](ch:staff-engineer)

## Further reading

- Google: [*Site Reliability Engineering*](https://sre.google/sre-book/table-of-contents/) and [*The Site Reliability Workbook*](https://sre.google/workbook/table-of-contents/), especially "Alerting on SLOs"
- [DORA research program](https://dora.dev/)
- [Atlassian incident management handbook](https://www.atlassian.com/incident-management/handbook)
- [RFC 8594: the Sunset HTTP header](https://www.rfc-editor.org/rfc/rfc8594)
- [The C4 model for architecture diagrams](https://c4model.com/)
