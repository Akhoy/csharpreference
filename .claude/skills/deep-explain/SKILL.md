---
name: deep-explain
description: Write or rewrite a deep, mechanism-first explanation of one technical topic — the way async/await was rewritten into async-await.md / async-internals.md / async-concurrency.md / async-valuetask.md / async-pitfalls.md in this book. Use when asked to go "in depth" on a topic, to explain not just how but why, to add real why-deep-dives, to split an overloaded chapter into focused pieces, or to make an explanation "crystal clear" rather than surface-level. Triggers on requests like "explain X in depth", "add why deep-dives for X", "this chapter is too dense, split it", "make me actually understand X".
---

# Deep Explain

Picture the reader a few weeks from now. Someone asks them a sharp follow-up question about this topic — in an interview, in a production incident, or just in their own head at 2am while debugging. Your job is to leave them able to work out the answer from first principles, not to recite something they half-remember reading.

Writing that sounds right but doesn't give someone that ability is the main failure mode here, even when every sentence is technically true.

This skill is the method behind one real rewrite in this repo: one overloaded chapter, `content/async-await.md`, became five focused ones (`async-await.md`, `async-concurrency.md`, `async-internals.md`, `async-valuetask.md`, `async-pitfalls.md`). Read `content/async-internals.md` once before using this skill on something new. It's the reference for how deep, how plain, and how the why-deep-dives should read.

## Before you write anything

1. **Name the one mechanism this piece is about.** Not "async/await" — "what the compiler generates for an async method." If you can't say it in one phrase, it's really several topics. Split it first (see "When to split" below) instead of writing one piece that tries to cover all of them.
2. **Pick one running example** from the book's own world (here: orders, checkout, payments, a catalogue) and reuse it in every section. Swapping examples from section to section makes a piece read like a list of facts instead of one idea seen from several sides.
3. **Decide what the reader already knows.** Say it up front (front-matter `prereqs`, or a short "what you need first" note), and never explain it again — link to where it's covered instead.

## The shape of the piece

Not every section below is needed for every topic, but the order matters: say why it matters before you explain the mechanism, explain the mechanism before you list what goes wrong, and save the why-deep-dives for last, once the reader has something to probe.

1. **Core model.** Three to five plain sentences — the shape, before the detail. Bold the terms that matter.
2. **Why this matters.** A real scenario where not knowing this costs something: an incident, a wrong number, a crash. Tell it as a plain fact in the present tense, not as a story with a twist ending. This is what earns the reader's attention before you spend it.
3. **The mechanism, one layer of reality at a time.** Start with the simplest true version — one case, no edge conditions. Then add one more piece of reality per step:
   - the simple case, then the real generated code or artifact behind it (not a description of it — the actual thing)
   - one instance, then what changes with two or three (one `await`, then a real multi-await `MoveNext` with its `switch`/`goto`/`try`-`catch`)
   - the happy path, then the path nobody designs for first (exceptions, cancellation, the cold path)

   Each layer should tell the reader something they couldn't have guessed from the one before. If a layer just restates the last one in different words, cut it.
4. **Named pitfalls**, each with the mechanism behind the failure, not just "don't do this." A pitfall without a mechanism is a rule to memorize. A pitfall with one is a rule the reader can rebuild under pressure, even if they forgot the rule itself.
5. **Interviewer "why" deep-dives.** The core of this skill — see below.
6. **Summary.** One paragraph, built from the specific facts you just established, not a generic recap. Then one sentence pointing to what comes next.

## Why-deep-dives: ask why from every angle

This is its own, late section: `## Interviewer "why" deep-dives`, with each question as a quoted `### "..."` heading. Everything above it already answered *what happens* and *how*. This section proves *why it had to work this way*, from angles a straight-through explanation doesn't naturally reach. For every deep-dive you write, know which angle it's asking from:

- **Origin.** Why does this exist at all? What was expensive or broken without it? (Not "what does it do" — that's already covered.)
- **The road not taken.** Why this design and not the obvious simpler one? What would the simpler version cost? ("Why a struct, not a class?" The obvious choice is a class. The answer is what a class would cost on the common path.)
- **Where the guarantee stops.** Exactly where does this mechanism's promise end, and what's just past that line? ("Does the thread that starts it come back?" draws the line between what's guaranteed and what just usually happens.)
- **What it touches.** What happens when this meets another mechanism already covered in the book — locking, garbage collection, cancellation? Production incidents usually live right here.
- **Breaking the rule.** Take something you stated as a rule earlier and ask *why* breaking it fails the specific way it fails, not just that it fails. ("Why does `async void` crash the process, exactly — not just 'don't do it'.")
- **The wrong mental model.** Say the plausible-but-wrong idea out loud, then show the one fact that breaks it. People remember a correction far better when you named the wrong idea first.

Write at least two angles per piece, three or more for advanced material. Every answer has to do real work: name the actual type, method, or field responsible, not a restated gut feeling. If an answer would sound just as true with the names swapped for a different mechanism, it's too generic. Go back to the real implementation — the reflection output, the generated code, the actual exception type — and answer from there. That's what makes `async-internals.md`'s "why struct, not class" answer land: it's anchored to what a `class` would actually cost on every single call, not just "structs are cheaper."

A good deep-dive question is one an expert would nod at *before* hearing the answer. It should sound like something a senior engineer actually got asked, not a trivia prompt invented to fill a slot.

## When to split instead of writing one giant piece

If you're listing more than three or four sub-mechanisms that could each stand alone (the original `async-await.md` had twelve), split into a parent chapter with children — the same shape as `async-await` → `async-concurrency` / `async-internals` / `async-valuetask` / `async-pitfalls`:

- The parent keeps the foundational material everything else leans on, and stays the page other chapters link to.
- Each child owns one sub-mechanism and gets its own why-deep-dives section, its own summary, and its own link to the next child. Don't pool all the deep-dives at the end of the parent.
- In `tools/outline.json`, write it as `{"id": "parent-id", "children": ["child-1", "child-2", ...]}` inside the part's `chapters` array. This numbers the children `N.1`, `N.2`... and indents them under the parent in the sidebar automatically. Don't flatten them back to top-level numbers — the indent is what tells the reader they belong together.
- Before and after the split, grep `content/` for `ch:<old-id>#<anchor>`. Any link into a section that moved needs its chapter id updated. Run the build (`node tools/build.mjs`, from `tools/`) — it reports any you missed as `PROBLEMS`.

## Write it plainly

Technical and in-depth doesn't have to mean dense or hard to read. Say the real thing in the plainest words that still say it exactly.

- Write short, direct sentences. State the mechanism; don't narrate that you're about to explain it ("Let's now look at..." is filler — just look at it).
- Give every section a plain, serious title. "The lightbulb: free the thread while you wait" becomes "How Await Frees the Thread." A title should hold up in a table of contents a senior engineer would take seriously, and a reader should know what the section is about before reading a word of it.
- Ground every claim in something checkable: real generated code, a real type name, a real tool (`dotnet-counters`, a specific exception type). Use an analogy once, as an on-ramp if the idea is genuinely hard to picture — never as the explanation itself, and never stacked on another analogy.
- Say the thing plainly. Skip hedges, skip "it's worth noting," skip borrowed authority ("experts agree," "studies show") you can't actually point to.
- Before you finish, invoke the **humanizer** skill on the piece (project skill, `.claude/skills/humanizer/`). It catches exactly the things dense technical writing tends to collect: contrasts used as a rhetorical device instead of a real point, forced groups of three, dashes used as a default connector, repeated sentence openings, a short list of overused words, bold text used to decorate instead of to mark something that matters, and any line that talks about the document instead of the topic. Technical writing takes its neutral-voice branch: keep the facts, drop the dressing, do not add opinion or color that wasn't there. Reference writing like this book is exactly the register it protects, not a special case to skip.
- Reuse this book's own callout types (`:::why`, `:::gotcha`, `:::qa`, `:::walk`, `:::scene` — listed in the header comment of `tools/build.mjs`) instead of inventing new formatting. A `:::qa` feeds the book's question bank. The `## Interviewer "why" deep-dives` section is deliberately plain Markdown headings instead, so it reads as one connected train of thought, not another stack of flashcards.

## Before you call it done

- Read only the why-deep-dives section, as if you'd skipped everything above it. Could you say, from that section alone, *why* each mechanism exists — not just what it does? If an answer would fit some other topic just as well, rewrite it so it's anchored to this one's real implementation detail.
- Rebuild (`node tools/build.mjs`, from `tools/`) and check for zero `PROBLEMS`. A broken cross-reference is the most common thing a split or a rewrite breaks without you noticing.
- Read the whole piece once, start to finish, as the reader rather than the writer. Does each section earn the next one? If two sections could swap places and nothing would be lost, something is out of order or just repeating itself.
