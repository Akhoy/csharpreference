# The .NET Backend Book

A structured, book-style study guide to .NET backend development, from C# fundamentals to cloud architecture, organised as one map of eight layers.

## Open it

Double-click `index.html`. No server or build is needed to read it. Fonts load from Google Fonts; offline it falls back to system fonts.

- **Map** (home): every chapter placed in its layer of the .NET stack.
- **Left nav**: Part → Chapter → sections. The current section is highlighted as you scroll.
- **Each chapter** opens with "Where this fits" (its layer, a breadcrumb, what to read first, and what it leads to).
- **Section chips**: Beginner / Intermediate / Advanced.
- **Question bank**: every interview question from every chapter, in list or drill mode.
- **Search**: press `/`.

Reading progress, dark mode and collapsed parts are saved in your browser.

## Edit or add content

Chapters are Markdown files in `content/`. The order and parts are defined in `tools/outline.json`.

```bash
cd tools && npm install     # once (installs the markdown renderer)
node tools/build.mjs        # regenerates assets/book.js; reports broken cross-links
```

Chapter conventions (see `tools/build.mjs` for details):

- Front matter: `title`, `summary`, `layer` (one of the 8 layer ids), `where` (a breadcrumb using `›`), `fits`, `prereqs`, `next`, `levels`.
- `## Heading {b|i|a}` tags a section as Beginner / Intermediate / Advanced.
- `:::why`, `:::tip`, `:::gotcha`, `:::deep`, `:::analogy`, `:::interview`, `:::note` … `:::` create callout boxes.
- `:::qa Question text` … `:::` adds an interview question (collected into the question bank).
- `[text](ch:chapter-id#section-slug)` links to another chapter or section; the build validates them.
- Every ` ```csharp ` block gets a **Run ▶** button (compiled and run in the browser, .NET 8 / C# 12, single-threaded, no top-level `await`). Write ` ```csharp norun ` for fragments, async/threading code, or anything else the browser runner can't execute.
- `:::scene visuals/scenes/name.svg | Title` followed by a numbered list (one item per step) and `:::` makes a step-through diagram with Back / Next / Play. The SVG is inlined so it follows the book's theme: style it with the `t-*`, `b-*` and `ln-*` classes in `assets/book.css`, and mark parts with `data-s="2"` (visible from step 2), `data-s="2-3"` (steps 2–3 only), `data-hl="3"` (highlighted on step 3) or `data-mv="3:120,0"` (slides by 120,0 on step 3).
- `:::walk Title` makes a code walkthrough: the program on top with the current line highlighted, the variables and printed output below, and Back / Next / Play. Put one ` ```csharp ` fence inside (add `norun` if it can't run in the browser), then one header per step followed by its narration:

  ```text
  @3-4 | price = £12.50 ; total = 0 | > text the step prints | ! compile error on this line
  What this step does, in a sentence or two (markdown).
  ```

  `@3-4` is the line (or range, or comma list) to highlight. Variables are `name = value` pairs separated by ` ; `; leave the field empty to keep the previous step's variables, or write `-` to clear them. Each `> …` adds an output line (`>+ …` continues the last line), and output accumulates from step to step. `! …` shows an error badge on the line. The build checks that every step has narration and points at real lines, and `node tools/build.mjs` inlines it all. For runnable walks, keep the `> …` lines identical to what the program really prints, so the walkthrough and the Run button agree.
