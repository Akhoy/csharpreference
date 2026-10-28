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
