---
id: staff-engineer
title: "Working as a Staff Engineer"
summary: "What changes when your job is the technical direction of several teams rather than your own code. Covers what staff engineers actually do, writing design docs that get decisions made, making and recording decisions under uncertainty, technical strategy, leading large migrations to the finish, influencing without authority, communicating with executives, raising the level of the people around you, choosing what to work on, and how staff-level interviews test all of this."
layer: arch
where: Building real projects › Staff engineering
fits: "The people and decision side of the practices in [delivering work](ch:delivering-work) and [production ownership](ch:production-ownership). Pairs with [System design](ch:system-design) for the interview."
levels: b,i,a
prereqs: production-ownership
next: capstone-wholesale
---

## The 30-second version

- A staff engineer's output is **better decisions and stronger teams**, not mainly their own code. Your scope is several teams, and your work happens through other people.
- **Write things down.** Design docs make decisions reviewable, durable and scalable beyond the meetings you can attend.
- **Match the effort to the reversibility** of a decision. Decide reversible things fast; take care over the ones that are expensive to undo.
- **Strategy** is a diagnosis of the real problem, a guiding approach, and a few coherent actions. It's written, short, and says no to things.
- **Finish migrations.** Starting them is easy and impressive; the last 20% is where staff engineers earn their title.
- **Lead without authority**: earn trust with good judgement, talk to people before the meeting, and explain trade-offs in the listener's terms.

## Previously at Kettle {b}

Wholesale runs well ([last episode](ch:production-ownership)). Kettle now has three product teams, the original storefront's platform is ageing, and the CTO asks you to take responsibility for the technical direction across all of them.

**The problem:** the skills that made you the strongest engineer on one team (deep knowledge, fast, correct code) don't scale to fifteen engineers and three roadmaps. You can't review every pull request or attend every meeting.

**This episode:** how staff engineers create leverage: documents, decisions, strategy, migrations, influence and growing other people.

## Start from zero: what a staff engineer does {b}

:::plain
A senior engineer makes their team's work excellent. A staff engineer makes sure several teams are working on the right technical things, in compatible ways, and helps them do it well. Most of that work is thinking, writing, reviewing and talking, with some code.
:::

Common shapes of the role (most people do a mix):

| Shape | Focus | Typical week |
|---|---|---|
| **Tech lead** | the technical direction and delivery of one large team or area | design reviews, unblocking, planning with the manager, some coding on critical paths |
| **Architect** | coherence across teams in a domain | design docs, cross-team reviews, standards, long-term direction |
| **Solver** | the hardest problems, wherever they are | deep dives into a performance crisis, a failing migration, a risky design |
| **Right hand** | extending a senior leader's reach | running cross-team initiatives, turning strategy into plans |

What stays constant: you're accountable for **outcomes beyond your own tasks**, you work **through influence** rather than authority, and your judgement is trusted on **ambiguous problems** without a clear owner.

## Design docs that get decisions made {i}

:::plain
A design doc explains a problem, the options for solving it, and the recommended one, with its trade-offs, so people can review the thinking before the expensive work starts.
:::

A template that works for most changes:

```text
# Wholesale credit holds: design

Author, reviewers, status (draft / in review / accepted), date

## Problem and context        Why now? Who's affected? What happens if we do nothing?
## Goals                      What must be true when this is done. Measurable where possible.
## Non-goals                  What we're deliberately not solving. Prevents scope creep in review.
## Proposal                   The design: components, data, APIs, flows. Diagrams.
## Alternatives considered    Each real option, with why it wasn't chosen. Including "do nothing".
## Trade-offs and risks       What gets worse, what could go wrong, and how we'd know.
## Rollout and migration      Flags, phases, backward compatibility, rollback.
## Operability                SLOs, alerts, runbooks, capacity, cost.
## Security and data          Threats, personal data, access.
## Open questions             What reviewers should weigh in on.
```

How to make them effective:

- **Problem first.** Half of all design disagreements are really disagreements about the problem. Get agreement on the problem and goals before anyone argues about Kafka.
- **Non-goals are a gift** to reviewers: they say "yes, we know, and we're not doing that on purpose".
- **Show the alternatives honestly**, including the one you didn't pick and its strongest argument. A doc with one option is a decision looking for approval, and reviewers can tell.
- **Write for skimming**: a summary at the top with the recommendation, then the detail. Many readers only read the top.
- **Scale the doc to the decision.** A page for a contained change; ten pages for a cross-team platform change. Nobody should write a design doc to add an endpoint.
- **Close the loop**: record the decision and the reasons, link it from the code, and turn the lasting decisions into decision records ([Foundations](ch:project-foundations#decision-records)).

## Making decisions under uncertainty {i}

**One-way and two-way doors.** Most decisions are reversible (a library inside a module, an internal API, a team process); make them quickly, with the people closest to the work, and change them if wrong. A few are expensive to reverse (data models, public contracts, the identity provider, the cloud, a language); those deserve a design doc, wider review and time. Treating every decision as a one-way door makes an organisation slow; treating one-way doors as two-way creates years of regret.

**Make trade-offs explicit.** "Use a message broker" isn't a decision; "accept eventual consistency and an extra system to operate, in exchange for decoupled deploys and absorbing load spikes" is. Put the costs in the doc, because someone will pay them.

**Know who decides.** For each significant decision, be clear who is consulted, who decides, and who is informed. Ambiguity about who decides creates more conflict than disagreement about what to decide.

**Disagree and commit.** Once a decision is made through a fair process, support it fully, including when you argued against it. Revisit it only when new information arrives, not when the same arguments are repeated louder.

**Decide with incomplete information.** Waiting for certainty is itself a decision, usually a bad one. State your assumptions, pick the option that's best given them, and define the signal that would make you change course.

## Technical strategy {a}

:::plain
A technical strategy says what the most important technical problem is, the general approach to solving it, and the few concrete things the teams will do. Its value is in what it says not to do.
:::

A useful structure (from Richard Rumelt's work on strategy):

1. **Diagnosis**: what's actually going on? "Storefront releases take three weeks because all three teams change one deployable with shared tables, and every release needs a full manual regression."
2. **Guiding policy**: the overall approach. "Move to independently deployable modules with owned data, inside the existing monolith first; extract services only where a team needs independent scaling."
3. **Coherent actions**: a few concrete steps that reinforce each other. "Q1: module boundaries and ownership, automated regression of the top journeys. Q2: per-module schemas, contract tests. Q3: extract pricing, the one module with a real scaling need."

Good strategy is **specific** (a reader could disagree with it), **short** (a few pages), **grounded in the business** (it names the outcome it serves), and **says no** ("we will not rewrite the storefront"; "we will not adopt Kubernetes this year"). A list of good intentions ("improve quality, modernise the stack, adopt best practices") is not a strategy.

## Leading migrations to the finish {a}

Large migrations (a framework upgrade across 40 services, moving from one database or message broker to another, retiring a legacy system) are where staff engineers have the most impact, because nobody else owns the whole thing.

- **Make the case in business terms**, with a cost of not migrating: security support ending, slowed delivery, operating cost.
- **De-risk with a pilot**: migrate one representative, difficult service end to end before planning the rest.
- **Make the migration easy for the teams**: a guide, tooling, code mods or analyzers that do the mechanical work, a paved path that's easier than staying. Migrations fail when every team has to work out the same thing alone.
- **Make progress visible**: a burndown of what's migrated and what's left, shared weekly.
- **Do the long tail yourself, or with a small dedicated group.** The last services are the odd ones that every team avoids. Leaving them means paying for two systems forever.
- **Finish properly**: turn off the old system, delete its code, infrastructure and docs, and celebrate. A migration that's 95% done delivers almost none of the simplification it promised.

## Influence without authority {i}

- **Trust is the currency.** It comes from being right often, admitting when you're wrong, following through, and helping others succeed. It's slow to build and quick to lose.
- **Talk to people before the meeting.** If the first time a key stakeholder hears your proposal is in a big review, expect resistance. One-to-one conversations surface objections early and make the meeting a confirmation.
- **Understand what each group cares about**: product (outcomes, dates), engineering managers (team capacity, people), security (risk), finance (cost), other teams (their own roadmap). Frame the same proposal in each one's terms.
- **Make it easy to say yes**: a clear ask, a small first step, and evidence from a pilot.
- **Give credit generously.** Ideas spread faster when others feel ownership of them.

**Communicating with executives:** lead with the conclusion and the decision you need ("We need two engineers for six weeks to remove a risk of a multi-day outage at peak"), then the reasons, then the detail for those who want it. Translate technical risk into likelihood and business impact. Bring options with trade-offs, not just problems.

## Raising the level of the team {i}

- **Mentoring and sponsorship**: mentoring is advice; sponsorship is putting someone's name forward for a stretch project, and giving them the credit. Both multiply your impact.
- **Review as teaching**: explain *why* in review comments, and link to principles. Occasionally pair on a review with a less experienced reviewer.
- **Delegate the interesting work**, including some you'd enjoy and could do faster. Your job is building people who can do it.
- **Encode standards in tools, not reminders**: analyzers, templates, a well-maintained service template, CI checks ([Foundations](ch:project-foundations)). A rule in a tool scales; a rule in your head doesn't.
- **Build paved roads**: the supported, documented, easiest way to build a service, deploy it, observe it. Teams can leave the road when they need to, knowing they then own the consequences.

## Choosing what to work on {a}

- **Work on what matters most to the business that nobody else is doing**: the cross-team problem without an owner, the risk everyone sees and nobody fixes.
- **Glue work is real work**: unblocking teams, onboarding, writing the doc everyone needs, fixing the flaky pipeline. Make it visible and recognised, and make sure it isn't always the same people doing it unrecognised.
- **Say no, or "not now"**, with reasons. A staff engineer spread across fifteen initiatives moves none of them.
- **Stay technical.** Keep some time for hands-on work on critical paths: prototypes, the hardest bugs, reviews of key designs. It keeps your judgement grounded and your credibility real.
- **Write down your priorities** for the quarter and review them with your manager. It prevents drifting into whatever is loudest.

## How staff interviews test this {i}

Staff-level interviews usually combine **system design** ([System design](ch:system-design)), **deep technical knowledge** (the rest of this book), and **behavioural questions about scope and influence**. For the last kind, prepare five or six real stories, each told in about three minutes:

| Theme | A story about... |
|---|---|
| Technical leadership | a significant design you led: the problem, options, trade-offs, outcome |
| Influence | changing a decision or direction you didn't own |
| Conflict | a technical disagreement and how it was resolved |
| Failure | something that went wrong because of you, and what changed afterwards |
| Ambiguity | a vague, cross-team problem you turned into a plan |
| Growing others | someone you helped grow, or a team practice you changed |

Use a structure such as **situation, task, action, result**, and spend most of the time on **your actions and your reasoning**: what you considered, why you chose what you did, and what you'd do differently. Quantify results where you can (lead time halved, incidents down, migration done in two quarters instead of four). Interviewers listen for scope (one team or many?), judgement (did you weigh trade-offs?) and ownership (did you see it through?).

## Interview questions {i}

:::qa How do you drive a technical decision across several teams who disagree?
Get agreement on the problem and goals first, write a design doc that presents the real options and trade-offs fairly, talk to key stakeholders individually before the review to surface objections, be clear about who decides, and decide within a reasonable time. Once decided, ask everyone to commit and revisit only with new information. Record the decision and the reasoning.
:::

:::qa Tell me how you'd lead a migration affecting many services.
Make the business case with the cost of not migrating, pilot it end to end on a hard representative service, then make it easy for teams with guides, tooling and automated code changes. Track progress publicly, handle the long tail with a dedicated group, and finish by decommissioning the old system completely, because partial migrations double the cost.
:::

:::qa What's the difference between a senior and a staff engineer?
Scope and leverage. A senior engineer delivers excellent work and leads within a team. A staff engineer is accountable for technical outcomes across several teams, works mainly through influence, documents and other people, handles ambiguous problems without a clear owner, and is judged on the results of the organisation's technical decisions rather than their own output.
:::

:::qa How do you decide how much rigour a decision needs?
By how expensive it is to reverse and how widely it affects others. Reversible, local decisions should be made quickly by the people closest to them. Decisions that are expensive to undo, such as data models, public contracts, platforms and identity, deserve a design doc, wider review and explicit trade-offs. Over-processing reversible decisions slows everyone down.
:::

## Next episode {b}

That's the whole toolkit: foundations, delivery, operations and leadership. The last episode puts it all together, following Kettle Wholesale from an idea to a running, well-run product, week by week, with a link to every chapter in the book that each step relies on. [Episode 5 · Capstone: from zero to production →](ch:capstone-wholesale)

## Further reading

- Will Larson, *Staff Engineer: Leadership Beyond the Management Track*
- Tanya Reilly, *The Staff Engineer's Path*
- Richard Rumelt, *Good Strategy / Bad Strategy*
- [Design docs at Google](https://www.industrialempathy.com/posts/design-docs-at-google/)
- Tanya Reilly, ["Being Glue"](https://www.noidea.dog/glue)
