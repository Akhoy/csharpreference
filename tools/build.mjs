// Builds assets/book.js from content/*.md + tools/outline.json.
// Run from anywhere:  node tools/build.mjs
//
// Chapter format
//   ---                         front matter (key: value per line)
//   title / summary / layer / where / fits / prereqs / next / levels
//   ---
//   ## Heading {b|i|a}          level tag shows a Beginner/Intermediate/Advanced chip + nav dot
//   :::why|tip|gotcha|note|deep|fits|qa [title]   ...   :::     callout blocks (qa = interview Q&A)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outline = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/outline.json'), 'utf8'));
const CONTENT = path.join(ROOT, 'content');

// ---------- syntax highlighting (build time) ----------
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CS_KW = new Set(('abstract as async await base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach get goto if implicit in init int interface internal is lock long namespace new null object operator out override params private protected public readonly record ref required return sbyte sealed set short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile when where while with yield value file global and or not nameof field extension notnull unmanaged scoped dynamic nint nuint').split(' '));
const SQL_KW = new Set('select from where join inner left right outer full cross on group by order insert into values update set delete create table index primary key foreign references begin commit rollback transaction as and or not null is in exists having top with distinct count sum avg min max union all case when then else end clustered nonclustered include alter add constraint unique default identity declare exec procedure returns go offset fetch next rows only asc desc like between isolation level read committed uncommitted serializable snapshot repeatable nolock updlock rowlock output merge using matched'.split(' '));

function highlight(src, lang) {
  let re;
  const l = (lang || '').toLowerCase();
  if (['cs', 'csharp', 'c#'].includes(l)) re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(\$?@?"""[\s\S]*?"""|\$?@?"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)')|(\[(?:[A-Z]\w*)(?:\([^\]\n]*\))?(?:, ?[A-Z]\w*(?:\([^\]\n]*\))?)*\])|(\b\d[\d_]*(?:\.\d+)?[fFdDmMlLuU]?\b)|(\b[A-Za-z_]\w*\b)/g;
  else if (l === 'sql') re = /(--[^\n]*)|('(?:[^'\n])*')|(@\w+)|(\b\d+\b)|(\b[A-Za-z_]\w*\b)/g;
  else if (['text', 'txt', 'plain', ''].includes(l)) return esc(src);
  else re = /(#[^\n]*|\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'[^'\n]*')|(\$\{\{[^}]*\}\}|--[\w-]+)|(\b\d+(?:\.\d+)*\b)|(\b[A-Za-z_][\w.-]*(?=\s*[:=]))/g;
  const isCs = ['cs', 'csharp', 'c#'].includes(l);
  let out = '', last = 0, m;
  while ((m = re.exec(src))) {
    out += esc(src.slice(last, m.index));
    const [tok, com, str, attr, num, word] = m;
    if (com) out += `<span class="tk-com">${esc(tok)}</span>`;
    else if (str) out += `<span class="tk-str">${esc(tok)}</span>`;
    else if (attr) out += `<span class="tk-attr">${esc(tok)}</span>`;
    else if (num) out += `<span class="tk-num">${esc(tok)}</span>`;
    else if (word) {
      if (isCs && CS_KW.has(word)) out += `<span class="tk-kw">${tok}</span>`;
      else if (isCs && /^[A-Z]/.test(word)) out += `<span class="tk-ty">${tok}</span>`;
      else if (l === 'sql' && SQL_KW.has(word.toLowerCase())) out += `<span class="tk-kw">${tok}</span>`;
      else if (!isCs && l !== 'sql') out += `<span class="tk-ty">${tok}</span>`;
      else out += tok;
    }
    last = re.lastIndex;
  }
  return out + esc(src.slice(last));
}
const LANG_NAME = { cs: 'C#', csharp: 'C#', sql: 'SQL', bash: 'Shell', sh: 'Shell', yaml: 'YAML', yml: 'YAML', json: 'JSON', xml: 'XML', docker: 'Dockerfile', dockerfile: 'Dockerfile', bicep: 'Bicep', text: 'Diagram', http: 'HTTP', proto: 'Protobuf', hcl: 'Terraform', powershell: 'PowerShell', js: 'JavaScript', ts: 'TypeScript' };

// ---------- helpers ----------
const slugify = s => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[`'"’]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const stripHtml = s => s.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const LEVELS = { b: 'Beginner', i: 'Intermediate', a: 'Advanced' };
const BLOCK_TITLES = { why: 'Why this exists', tip: 'Tip', gotcha: 'Trap', note: 'Note', deep: 'Under the hood', fits: 'Where this fits', analogy: 'Mental model', interview: 'Interview angle' };

function parseFront(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return [{}, raw];
  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return [meta, raw.slice(m[0].length)];
}

function buildChapter(id, meta, body, ctx) {
  const toc = [];
  const used = new Set();
  const qa = [];
  let currentSection = null;
  const marked = new Marked({ gfm: true });

  marked.use({
    renderer: {
      heading(text, level, raw) {
        let lvl = null;
        const lm = raw.match(/\s*\{([bia])\}\s*$/);
        if (lm) { lvl = lm[1]; text = text.replace(/\s*\{[bia]\}\s*$/, ''); raw = raw.replace(/\s*\{[bia]\}\s*$/, ''); }
        let slug = slugify(raw) || 'section';
        let s = slug, n = 2; while (used.has(s)) s = `${slug}-${n++}`; used.add(s);
        if (level === 2 || level === 3) toc.push({ id: s, text: stripHtml(text), depth: level, lvl });
        if (level === 2) currentSection = { id: s, text: stripHtml(text) };
        const chip = lvl ? ` <span class="lvl lvl-${lvl}" title="${LEVELS[lvl]}">${LEVELS[lvl]}</span>` : '';
        return `<h${level} id="${s}"><a class="anchor" href="#/${id}/${s}" aria-label="Link to this section">#</a>${text}${chip}</h${level}>\n`;
      },
      code(src, info) {
        const lang = (info || '').trim().split(/\s+/)[0] || 'text';
        const label = LANG_NAME[lang.toLowerCase()] || lang;
        // `csharp norun`: highlighted as C#, but no Run button (async/threading/unsafe code the
        // single-threaded browser runner can't execute, or a fragment that isn't a whole program).
        const runnable = ['cs', 'csharp', 'c#'].includes(lang.toLowerCase()) && !/\bnorun\b/.test(info || '');
        const clean = src.replace(/\s+$/, '');
        const runBtn = runnable
          ? `<button class="run" type="button">Run <span class="run-arrow">▶</span></button>`
          : '';
        const runOutput = runnable ? `<div class="run-output" hidden></div>` : '';
        const dataSrc = runnable ? ` data-src="${Buffer.from(clean, 'utf8').toString('base64')}"` : '';
        return `<figure class="code"><figcaption><span>${esc(label)}</span><span class="fig-btns">${runBtn}<button class="copy" type="button">Copy</button></span></figcaption><pre${dataSrc}><code>${highlight(clean, lang)}</code></pre>${runOutput}</figure>\n`;
      },
      table(header, body) {
        return `<div class="tbl"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>\n`;
      },
      link(href, title, text) {
        const ext = /^https?:/.test(href);
        if (href.startsWith('#')) return `<a class="xref" href="#/${id}/${href.slice(1)}">${text}</a>`;
        if (href.startsWith('ch:')) { const [c, s] = href.slice(3).split('#'); return `<a class="xref" href="#/${c}${s ? '/' + s : ''}">${text}</a>`; }
        return `<a href="${href}"${ext ? ' target="_blank" rel="noopener"' : ''}${title ? ` title="${esc(title)}"` : ''}>${text}</a>`;
      }
    }
  });

  // Pull ::: blocks out (respecting code fences), render their inner markdown separately.
  const lines = body.split('\n');
  const outLines = [];
  const blocks = [];
  let inFence = false, block = null;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence && !block && /^:::(\w+)(.*)$/.test(line)) {
      const [, type, title] = line.match(/^:::(\w+)\s*(.*)$/);
      block = { type, title: title.trim(), lines: [] };
      continue;
    }
    if (!inFence && block && line.trim() === ':::') {
      blocks.push(block);
      outLines.push('', `<!--BLOCK${blocks.length - 1}-->`, '');
      block = null;
      continue;
    }
    (block ? block.lines : outLines).push(line);
  }
  if (block) throw new Error(`${id}: unclosed ::: block "${block.type}"`);

  // Render main body first so section tracking happens in document order,
  // then render blocks with an inner renderer that shares slug/toc state.
  const renderInner = md => {
    const tmp = new Marked({ gfm: true });
    tmp.use({ renderer: { code: (s, i) => marked.parse('```' + (i || '') + '\n' + s + '\n```'), table: (h, b) => `<div class="tbl"><table><thead>${h}</thead><tbody>${b}</tbody></table></div>\n`,
      link: (href, title, text) => href.startsWith('#') ? `<a class="xref" href="#/${id}/${href.slice(1)}">${text}</a>` : href.startsWith('ch:') ? `<a class="xref" href="#/${href.slice(3).split('#')[0]}${href.includes('#') ? '/' + href.split('#')[1] : ''}">${text}</a>` : `<a href="${href}" target="_blank" rel="noopener">${text}</a>` } });
    return tmp.parse(md);
  };

  // Section of each block = last h2 seen before its placeholder. Track by splitting on placeholders.
  let html = '';
  const segments = outLines.join('\n').split(/<!--BLOCK(\d+)-->/);
  // segments: [md, idx, md, idx, md...]  render md pieces with shared marked instance
  for (let k = 0; k < segments.length; k++) {
    if (k % 2 === 0) { html += marked.parse(segments[k]); continue; }
    const b = blocks[+segments[k]];
    const content = renderInner(b.lines.join('\n'));
    if (b.type === 'scene') {
      html += renderScene(b);
    } else if (b.type === 'qa') {
      qa.push({ q: b.title, a: content, chapter: id, section: currentSection });
      html += `<details class="qa"><summary><span class="qa-mark">Q</span><span>${renderInlineTitle(b.title)}</span></summary><div class="qa-body">${content}</div></details>\n`;
    } else {
      const title = b.title || BLOCK_TITLES[b.type] || b.type;
      html += `<aside class="callout c-${b.type}"><div class="callout-title">${renderInlineTitle(title)}</div>${content}</aside>\n`;
    }
  }

  // search records per h2 section
  const search = [];
  const parts = html.split(/(?=<h2 id=")/);
  for (const p of parts) {
    const hm = p.match(/^<h2 id="([^"]+)">(?:<a[^>]*>#<\/a>)?([\s\S]*?)<\/h2>/);
    const text = stripHtml(p).slice(0, 4000);
    search.push({ c: id, s: hm ? hm[1] : '', h: hm ? stripHtml(hm[2]).replace(/\b(Beginner|Intermediate|Advanced)$/, '').trim() : meta.title, t: text });
  }

  const words = stripHtml(html).split(' ').length;
  return {
    id, title: meta.title, summary: meta.summary || '', layer: meta.layer || '', where: meta.where || '',
    fits: meta.fits ? renderInner(meta.fits) : '', prereqs: (meta.prereqs || '').split(',').map(s => s.trim()).filter(Boolean),
    next: (meta.next || '').split(',').map(s => s.trim()).filter(Boolean),
    levels: (meta.levels || 'b,i,a').split(',').map(s => s.trim()),
    html, toc, words, minutes: Math.max(1, Math.round(words / 220)), qa, search
  };

  function renderInlineTitle(t) { return new Marked().parseInline(t); }

  // :::scene visuals/scenes/x.svg | Title
  // 1. narration for step 1
  // 2. narration for step 2
  // :::
  // The SVG is inlined (so it follows the book's theme and can be stepped through). Inside it,
  // data-s="2" shows an element from step 2 on, data-s="2-3" only on steps 2–3,
  // data-hl="3" highlights it on step 3, data-mv="3:120,0" slides it by (120,0) from step 3.
  function renderScene(b) {
    const [file, title = ''] = b.title.split('|').map(s => s.trim());
    const svgPath = path.join(ROOT, file);
    if (!fs.existsSync(svgPath)) throw new Error(`${id}: scene file not found: ${file}`);
    const svg = fs.readFileSync(svgPath, 'utf8').replace(/<\?xml[^>]*>\s*/, '').trim();
    const steps = [];
    for (const line of b.lines) {
      const m = line.match(/^\s*\d+\.\s+(.*)$/);
      if (m) steps.push(m[1]);
      else if (line.trim() && steps.length) steps[steps.length - 1] += ' ' + line.trim();
    }
    if (!steps.length) throw new Error(`${id}: scene ${file} has no numbered steps`);
    const says = steps.map((s, i) => `<li data-step="${i + 1}"${i ? ' hidden' : ''}>${renderInlineTitle(s)}</li>`).join('');
    const dots = steps.map((_, i) => `<button type="button" class="scene-dot${i ? '' : ' on'}" data-sc="${i + 1}" aria-label="Step ${i + 1}"></button>`).join('');
    return `<figure class="scene" data-steps="${steps.length}" data-at="1">
<div class="scene-head"><span class="scene-title">${renderInlineTitle(title)}</span><span class="scene-count">Step 1 of ${steps.length}</span></div>
<div class="scene-art">${svg}</div>
<ol class="scene-says">${says}</ol>
<div class="scene-ctrl"><button type="button" class="scene-btn" data-sc="prev" disabled>◀ Back</button><span class="scene-dots">${dots}</span><button type="button" class="scene-btn" data-sc="play" aria-label="Play all steps">▶ Play</button><button type="button" class="scene-btn primary" data-sc="next">Next ▶</button></div>
</figure>\n`;
  }
}

// ---------- build ----------
const files = fs.existsSync(CONTENT) ? fs.readdirSync(CONTENT).filter(f => f.endsWith('.md')) : [];
const byId = {};
for (const f of files) {
  const raw = fs.readFileSync(path.join(CONTENT, f), 'utf8').replace(/\r\n/g, '\n');
  const [meta, body] = parseFront(raw);
  const id = meta.id || f.replace(/\.md$/, '');
  byId[id] = { meta, body, file: f };
}

const chapters = {};
const qa = [];
const search = [];
const parts = [];
const missing = [];
outline.parts.forEach((p, pi) => {
  const list = [];
  p.chapters.forEach((cid, ci) => {
    const src = byId[cid];
    if (!src) { missing.push(cid); return; }
    const ch = buildChapter(cid, src.meta, src.body);
    ch.num = pi === 0 ? `${ci}` : `${pi}.${ci + 1}`;
    ch.part = p.id;
    chapters[cid] = ch;
    qa.push(...ch.qa.map(q => ({ ...q, num: ch.num })));
    search.push(...ch.search);
    delete ch.qa; delete ch.search;
    list.push(cid);
  });
  parts.push({ id: p.id, num: p.num, title: p.title, chapters: list });
});

// validate cross references
const problems = [];
for (const ch of Object.values(chapters)) {
  for (const r of [...ch.prereqs, ...ch.next]) if (!chapters[r] && !outline.parts.some(p => p.chapters.includes(r))) problems.push(`${ch.id}: unknown ref ${r}`);
  for (const m of ch.html.matchAll(/href="#\/([\w-]+)(?:\/([\w-]+))?"/g)) {
    const [, c, s] = m;
    if (!chapters[c]) { if (!outline.parts.some(p => p.chapters.includes(c))) problems.push(`${ch.id}: link to unknown chapter ${c}`); continue; }
    if (s && !chapters[c].toc.some(t => t.id === s)) problems.push(`${ch.id}: link to unknown section ${c}/${s}`);
  }
  if (!outline.layers.some(l => l.id === ch.layer)) problems.push(`${ch.id}: unknown layer ${ch.layer}`);
}

const book = { layers: outline.layers, parts, chapters, qa, search, built: new Date().toISOString() };
fs.writeFileSync(path.join(ROOT, 'assets/book.js'), 'window.BOOK = ' + JSON.stringify(book) + ';\n');

const totalWords = Object.values(chapters).reduce((n, c) => n + c.words, 0);
console.log(`chapters: ${Object.keys(chapters).length}  words: ${totalWords}  questions: ${qa.length}`);
if (missing.length) console.log(`not written yet (${missing.length}): ${missing.join(', ')}`);
if (problems.length) { console.log('PROBLEMS:\n  ' + problems.join('\n  ')); }
