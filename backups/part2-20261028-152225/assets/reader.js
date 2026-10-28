(() => {
  const B = window.BOOK;
  const $ = (s, el = document) => el.querySelector(s);
  const main = $('#main'), nav = $('#nav'), toc = $('#toc');
  const CH = B.chapters;
  const ORDER = B.parts.flatMap(p => p.chapters);
  const partOf = id => B.parts.find(p => p.chapters.includes(id));
  const layerById = Object.fromEntries(B.layers.map(l => [l.id, l]));
  const LV = { b: 'Beginner', i: 'Intermediate', a: 'Advanced' };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- per-browser state ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* unavailable */ } }
  };
  const done = new Set(store.get('book-done', []));
  const closedParts = new Set(store.get('book-closed', []));
  const theme = store.get('book-theme', null);
  if (theme) document.documentElement.dataset.theme = theme;

  // ---------- nav ----------
  let current = null;
  function renderNav() {
    const total = ORDER.length, n = ORDER.filter(id => done.has(id)).length;
    let h = `<div class="nav-progress">${n} of ${total} chapters read<div class="bar"><i style="width:${total ? n / total * 100 : 0}%"></i></div></div>`;
    for (const p of B.parts) {
      if (!p.chapters.length) continue;
      const isCurrentPart = current && p.chapters.includes(current);
      const closed = closedParts.has(p.id) && !isCurrentPart;
      h += `<div class="part ${closed ? 'closed' : ''}"><button class="part-head" data-part="${p.id}" aria-expanded="${!closed}"><span class="pn">${p.num === '0' ? '' : 'PT ' + p.num}</span><span class="pt">${esc(p.title)}</span><span class="chev">▼</span></button><ul class="chs">`;
      for (const id of p.chapters) {
        const c = CH[id];
        const on = id === current;
        h += `<li class="ch ${on ? 'on' : ''}"><a href="#/${id}"><span class="cn">${c.num}</span><span>${esc(c.title)}</span>${done.has(id) ? '<span class="done">✓</span>' : ''}</a>`;
        if (on) h += `<ul class="secs">${c.toc.filter(t => t.depth === 2).map(t => `<li><a href="#/${id}/${t.id}" data-sec="${t.id}"><i class="dot ${t.lvl || ''}"></i>${esc(t.text)}</a></li>`).join('')}</ul>`;
        h += `</li>`;
      }
      h += `</ul></div>`;
    }
    nav.innerHTML = h;
    const on = $('.ch.on', nav);
    if (on) on.scrollIntoView({ block: 'nearest' });
  }
  nav.addEventListener('click', e => {
    const ph = e.target.closest('[data-part]');
    if (ph) {
      const id = ph.dataset.part, el = ph.parentElement;
      el.classList.toggle('closed');
      el.classList.contains('closed') ? closedParts.add(id) : closedParts.delete(id);
      ph.setAttribute('aria-expanded', !el.classList.contains('closed'));
      store.set('book-closed', [...closedParts]);
      return;
    }
    if (e.target.closest('a')) document.body.classList.remove('nav-open');
  });

  // ---------- chapter ----------
  function chapterView(id) {
    const c = CH[id];
    const p = partOf(id);
    const idx = ORDER.indexOf(id);
    const prev = CH[ORDER[idx - 1]], next = CH[ORDER[idx + 1]];
    const link = r => CH[r] ? `<a href="#/${r}">${CH[r].num} · ${esc(CH[r].title)}</a>` : '';
    const crumb = (c.where || '').split('›').map(s => s.trim()).filter(Boolean);
    const qCount = B.qa.filter(q => q.chapter === id).length;
    return `<article class="page">
      <header class="ch-head">
        <div class="eyebrow">${p.num === '0' ? 'Orientation' : `Part ${p.num} · ${esc(p.title)}`} — Chapter ${c.num}</div>
        <h1>${esc(c.title)}</h1>
        <p class="summary">${esc(c.summary)}</p>
        <div class="meta-row"><span class="lvls">${c.levels.map(l => `<span class="lvl lvl-${l}">${LV[l]}</span>`).join('')}</span>
          <span>${c.minutes} min read</span><span>${c.toc.filter(t => t.depth === 2).length} sections</span>${qCount ? `<a href="#/questions" data-qb="${id}">${qCount} interview questions</a>` : ''}</div>
      </header>
      <section class="locator" aria-label="Where this chapter fits">
        <div class="stack"><div class="lbl">The .NET stack</div>${B.layers.map(l => `<a href="#/" class="${l.id === c.layer ? 'here' : ''}" title="${esc(l.note)}"><b>${esc(l.name)}</b><small>${esc(l.note)}</small></a>`).join('')}</div>
        <div class="loc-body">
          <div class="eyebrow">Where this fits</div>
          <div class="crumb">${crumb.map(s => `<span>${esc(s)}</span>`).join('<i>›</i>')}</div>
          <div class="fits">${c.fits}</div>
          <div class="loc-links">
            <div><h5>Read first</h5>${c.prereqs.map(link).join('') || '<span class="none">Nothing. Start here.</span>'}</div>
            <div><h5>Leads to</h5>${c.next.map(link).join('') || '<span class="none">—</span>'}</div>
          </div>
        </div>
      </section>
      <div class="prose">${c.html}</div>
      <footer class="ch-foot">
        <button class="done-btn ${done.has(id) ? 'is-done' : ''}" data-done="${id}">${done.has(id) ? '✓ Chapter read' : 'Mark chapter as read'}</button>
        <nav class="pager">${prev ? `<a href="#/${prev.id}"><small>← Previous · ${prev.num}</small><b>${esc(prev.title)}</b></a>` : ''}${next ? `<a class="nx" href="#/${next.id}"><small>Next · ${next.num} →</small><b>${esc(next.title)}</b></a>` : ''}</nav>
      </footer>
    </article>`;
  }

  function renderToc(id) {
    const c = CH[id];
    toc.innerHTML = c && c.toc.length ? `<h4>On this page</h4><ol>${c.toc.map(t => `<li><a class="d${t.depth}" href="#/${id}/${t.id}" data-sec="${t.id}">${esc(t.text)}</a></li>`).join('')}</ol>` : '';
  }

  // scrollspy
  let spy;
  function startSpy() {
    if (spy) spy.disconnect();
    const heads = [...main.querySelectorAll('.prose h2, .prose h3')];
    if (!heads.length) return;
    const visible = new Map();
    spy = new IntersectionObserver(entries => {
      for (const e of entries) visible.set(e.target.id, e.isIntersecting);
      // active = last heading above the fold line
      let active = heads[0].id;
      const line = window.innerHeight * 0.25;
      for (const h of heads) { if (h.getBoundingClientRect().top < line) active = h.id; else break; }
      let h2 = active;
      const el = document.getElementById(active);
      if (el && el.tagName === 'H3') { let k = heads.indexOf(el); while (k >= 0 && heads[k].tagName !== 'H2') k--; if (k >= 0) h2 = heads[k].id; }
      toc.querySelectorAll('a').forEach(a => a.classList.toggle('active', a.dataset.sec === active));
      nav.querySelectorAll('.secs a').forEach(a => a.classList.toggle('active', a.dataset.sec === h2));
    }, { rootMargin: '0px 0px -70% 0px', threshold: [0, 1] });
    heads.forEach(h => spy.observe(h));
  }

  // ---------- home ----------
  function homeView() {
    const chs = ORDER.map(id => CH[id]);
    const words = chs.reduce((n, c) => n + c.words, 0);
    const first = CH['big-picture'] ? 'big-picture' : ORDER[0];
    const resume = ORDER.find(id => !done.has(id));
    return `<div class="page home" style="max-width:1000px">
      <div class="eyebrow">A study guide for .NET backend developers</div>
      <h1>Everything in .NET, and where it belongs.</h1>
      <p class="lede">This book is organised the way the platform is built: language at the bottom, runtime above it, frameworks on top, then architecture, data, communication, infrastructure, and the concerns that cut across all of them. Every chapter starts by showing you which layer you are in. Every section is tagged Beginner, Intermediate or Advanced, and every chapter ends with the questions interviewers ask about it.</p>
      <div class="stats"><span><b>${chs.length}</b> chapters</span><span><b>${chs.reduce((n, c) => n + c.toc.filter(t => t.depth === 2).length, 0)}</b> sections</span><span><b>${B.qa.length}</b> interview questions</span><span><b>${Math.round(words / 1000)}k</b> words</span></div>
      <div class="start">${first ? `<a class="btn primary" href="#/${first}">Start with the big picture</a>` : ''}${resume && resume !== first ? `<a class="btn" href="#/${resume}">Continue: ${CH[resume].num} ${esc(CH[resume].title)}</a>` : ''}<a class="btn" href="#/questions">Open the question bank</a></div>

      <h2>The map</h2>
      <p class="sub">Each row is one layer of a .NET backend system. Each chip is a chapter that lives in that layer. When something feels disconnected, find it here first.</p>
      <div class="big-stack">${B.layers.map(l => {
        const list = chs.filter(c => c.layer === l.id);
        return `<div class="layer-row"><div class="layer-name"><b>${esc(l.name)}</b><small>${esc(l.note)}</small></div><div class="layer-chs">${list.length ? list.map(c => `<a class="${done.has(c.id) ? 'done' : ''}" href="#/${c.id}"><span>${c.num}</span>${esc(c.title)}</a>`).join('') : '<span class="soon">No chapters yet</span>'}</div></div>`;
      }).join('')}</div>

      <h2>Contents</h2>
      <p class="sub">Read in order the first time. Breadth before depth: skim the Advanced sections on a first pass and come back to them.</p>
      <div class="legend"><span><i class="dot b"></i>Beginner</span><span><i class="dot i"></i>Intermediate</span><span><i class="dot a"></i>Advanced</span></div>
      <div class="contents" style="margin-top:20px">${B.parts.filter(p => p.chapters.length).map(p => `<section><h3><span>${p.num === '0' ? '—' : 'Part ' + p.num}</span>${esc(p.title)}</h3><ol>${p.chapters.map(id => `<li><a class="${done.has(id) ? 'done' : ''}" href="#/${id}"><span>${CH[id].num}</span>${esc(CH[id].title)}</a></li>`).join('')}</ol></section>`).join('')}</div>
    </div>`;
  }

  // ---------- question bank ----------
  const qb = { part: 'all', chapter: null, text: '', mode: 'list', order: [], i: 0, open: false };
  function qbPool() {
    const t = qb.text.toLowerCase();
    return B.qa.filter(q => (qb.part === 'all' || partOf(q.chapter).id === qb.part) && (!qb.chapter || q.chapter === qb.chapter)
      && (!t || (q.q + ' ' + q.a).toLowerCase().includes(t)));
  }
  function qbView() {
    const pool = qbPool();
    const controls = `<div class="qb-controls">
      <select id="qbPart" aria-label="Part"><option value="all">All parts</option>${B.parts.filter(p => p.chapters.length).map(p => `<option value="${p.id}" ${qb.part === p.id ? 'selected' : ''}>${p.num === '0' ? '' : 'Part ' + p.num + ' · '}${esc(p.title)}</option>`).join('')}</select>
      <input id="qbText" type="search" placeholder="Filter questions…" value="${esc(qb.text)}" aria-label="Filter questions">
      <div class="seg" role="group" aria-label="Mode"><button data-mode="list" class="${qb.mode === 'list' ? 'on' : ''}">List</button><button data-mode="drill" class="${qb.mode === 'drill' ? 'on' : ''}">Drill</button></div>
      <span class="count">${pool.length} question${pool.length === 1 ? '' : 's'}</span></div>
      ${qb.chapter ? `<p class="hint">Showing only chapter ${CH[qb.chapter].num} · ${esc(CH[qb.chapter].title)}. <a href="#/questions" data-qb-clear>Show all</a></p>` : ''}`;
    let body = '';
    if (qb.mode === 'list') {
      for (const id of ORDER) {
        const qs = pool.filter(q => q.chapter === id);
        if (!qs.length) continue;
        body += `<div class="qb-group"><h3><a href="#/${id}">${CH[id].num} · ${esc(CH[id].title)}</a></h3>${qs.map(q => `<details class="qa"><summary><span class="qa-mark">Q</span><span>${q.q}</span></summary><div class="qa-body prose">${q.a}${q.section ? `<p><a href="#/${q.chapter}/${q.section.id}">Read the section: ${esc(q.section.text)} →</a></p>` : ''}</div></details>`).join('')}</div>`;
      }
      if (!pool.length) body = '<p>No questions match. Clear the filter or pick another part.</p>';
    } else {
      if (qb.order.length !== pool.length) { qb.order = shuffle(pool.map((_, i) => i)); qb.i = 0; qb.open = false; }
      const q = pool[qb.order[qb.i]];
      body = q ? `<div class="flash"><div class="from">${CH[q.chapter].num} · <a href="#/${q.chapter}${q.section ? '/' + q.section.id : ''}">${esc(CH[q.chapter].title)}${q.section ? ' › ' + esc(q.section.text) : ''}</a> · ${qb.i + 1} / ${pool.length}</div>
        <div class="fq">${q.q}</div>${qb.open ? `<div class="fa prose">${q.a}</div>` : ''}
        <div class="acts">${qb.open ? '' : '<button class="btn primary" data-drill="reveal">Reveal answer</button>'}<button class="btn" data-drill="prev" ${qb.i ? '' : 'disabled'}>← Previous</button><button class="btn ${qb.open ? 'primary' : ''}" data-drill="next" ${qb.i < pool.length - 1 ? '' : 'disabled'}>Next →</button><button class="btn" data-drill="shuffle">Shuffle</button></div></div>
        <p class="hint">Answer out loud before revealing. <kbd>Space</kbd> reveal · <kbd>→</kbd> next · <kbd>←</kbd> previous</p>` : '<p>No questions match.</p>';
    }
    return `<div class="page" style="max-width:860px"><div class="eyebrow">Interview preparation</div>
      <h1 style="font-size:clamp(30px,4vw,42px);font-weight:800;letter-spacing:-.02em;margin:12px 0 10px">Question bank</h1>
      <p style="color:var(--ink-2);margin:0;font-size:17px">Every interview question from every chapter, in one place. Each answer links back to the section that explains it in depth.</p>
      ${controls}${body}</div>`;
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function drill(a) {
    const n = qbPool().length;
    if (a === 'reveal') qb.open = true;
    if (a === 'next' && qb.i < n - 1) { qb.i++; qb.open = false; }
    if (a === 'prev' && qb.i > 0) { qb.i--; qb.open = false; }
    if (a === 'shuffle') { qb.order = []; }
    render(false);
  }

  // ---------- router ----------
  function parse() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    return { a: parts[0] || '', b: parts[1] || '' };
  }
  function render(scroll = true) {
    const { a, b } = parse();
    let route = 'chapter';
    if (!a) { current = null; main.innerHTML = homeView(); toc.innerHTML = ''; route = 'home'; }
    else if (a === 'questions') { current = null; main.innerHTML = qbView(); toc.innerHTML = ''; route = 'questions'; }
    else if (CH[a]) {
      const changed = current !== a || !main.querySelector('.ch-head');
      current = a;
      if (changed) { main.innerHTML = chapterView(a); renderToc(a); startSpy(); }
      document.title = `${CH[a].num} ${CH[a].title} · The .NET Backend Book`;
      if (b) { const el = document.getElementById(b); if (el) { el.scrollIntoView(); scroll = false; } }
      else if (changed && scroll) window.scrollTo(0, 0);
      scroll = false;
    } else { current = null; main.innerHTML = `<div class="page"><h1>Chapter not found</h1><p><a href="#/">Back to the map</a></p></div>`; }
    if (route !== 'chapter') document.title = 'The .NET Backend Book';
    document.querySelectorAll('.top-links a').forEach(x => x.classList.toggle('on', x.dataset.route === route));
    renderNav();
    if (scroll) window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', () => render());

  // ---------- events ----------
  main.addEventListener('click', e => {
    const cp = e.target.closest('.copy');
    if (cp) {
      const pre = cp.closest('figure').querySelector('pre');
      const ok = () => { cp.textContent = 'Copied'; setTimeout(() => (cp.textContent = 'Copy'), 1400); };
      const fallback = () => { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); cp.textContent = 'Press ⌘C'; };
      navigator.clipboard ? navigator.clipboard.writeText(pre.innerText).then(ok, fallback) : fallback();
      return;
    }
    const d = e.target.closest('[data-done]');
    if (d) { const id = d.dataset.done; done.has(id) ? done.delete(id) : done.add(id); store.set('book-done', [...done]); d.classList.toggle('is-done', done.has(id)); d.textContent = done.has(id) ? '✓ Chapter read' : 'Mark chapter as read'; renderNav(); return; }
    const qbl = e.target.closest('[data-qb]');
    if (qbl) { qb.chapter = qbl.dataset.qb; qb.part = 'all'; qb.text = ''; qb.mode = 'list'; }
    if (e.target.closest('[data-qb-clear]')) { qb.chapter = null; e.preventDefault(); render(false); return; }
    const m = e.target.closest('[data-mode]');
    if (m) { qb.mode = m.dataset.mode; qb.order = []; render(false); return; }
    const dr = e.target.closest('[data-drill]');
    if (dr) drill(dr.dataset.drill);
    const a = e.target.closest('a[href^="#/"]');
    if (a && a.getAttribute('href') === location.hash) { const { b } = parse(); const el = b && document.getElementById(b); if (el) el.scrollIntoView(); }
  });
  main.addEventListener('change', e => { if (e.target.id === 'qbPart') { qb.part = e.target.value; qb.chapter = null; qb.order = []; render(false); } });
  let qbTimer;
  main.addEventListener('input', e => {
    if (e.target.id !== 'qbText') return;
    clearTimeout(qbTimer);
    qbTimer = setTimeout(() => { qb.text = e.target.value; qb.order = []; render(false); const el = $('#qbText'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 200);
  });

  // ---------- search ----------
  const q = $('#q'), results = $('#results');
  let sel = 0, hits = [];
  function doSearch() {
    const terms = q.value.trim().toLowerCase().split(/\s+/).filter(w => w.length > 1);
    if (!terms.length) { results.hidden = true; return; }
    hits = [];
    for (const r of B.search) {
      if (!CH[r.c]) continue;
      const h = r.h.toLowerCase(), t = r.t.toLowerCase(), title = CH[r.c].title.toLowerCase();
      if (!terms.every(w => t.includes(w) || h.includes(w))) continue;
      let score = 0;
      for (const w of terms) { if (h.includes(w)) score += 10; if (title.includes(w)) score += 4; score += Math.min(5, t.split(w).length - 1); }
      hits.push({ r, score });
    }
    hits.sort((a, b) => b.score - a.score);
    hits = hits.slice(0, 14);
    sel = 0;
    const mark = s => { let out = esc(s); for (const w of terms) out = out.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => `<mark>${m}</mark>`); return out; };
    const snip = t => { const lt = t.toLowerCase(); const i = Math.max(0, lt.indexOf(terms[0]) - 60); return (i ? '…' : '') + t.slice(i, i + 170) + '…'; };
    results.innerHTML = hits.length ? hits.map((x, i) => `<a href="#/${x.r.c}${x.r.s ? '/' + x.r.s : ''}" class="${i === 0 ? 'sel' : ''}"><span class="r-where">${CH[x.r.c].num} · ${esc(CH[x.r.c].title)}</span><span class="r-head">${mark(x.r.h)}</span><span class="r-snip">${mark(snip(x.r.t))}</span></a>`).join('')
      : `<div class="r-empty">Nothing found for “${esc(q.value)}”. Try one keyword, like “lifetime”, “outbox” or “middleware”.</div>`;
    results.hidden = false;
  }
  let st;
  q.addEventListener('input', () => { clearTimeout(st); st = setTimeout(doSearch, 90); });
  q.addEventListener('focus', () => { if (q.value.trim()) doSearch(); });
  q.addEventListener('keydown', e => {
    const links = [...results.querySelectorAll('a')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!links.length) return; sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length; links.forEach((l, i) => l.classList.toggle('sel', i === sel)); links[sel].scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'Enter' && links[sel]) { location.hash = links[sel].getAttribute('href'); results.hidden = true; q.blur(); }
    if (e.key === 'Escape') { results.hidden = true; q.blur(); }
  });
  results.addEventListener('click', e => { if (e.target.closest('a')) { results.hidden = true; } });
  document.addEventListener('click', e => { if (!e.target.closest('.search')) results.hidden = true; });

  document.addEventListener('keydown', e => {
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    if (e.key === '/' && !typing) { e.preventDefault(); q.focus(); return; }
    if (typing || !location.hash.startsWith('#/questions') || qb.mode !== 'drill') return;
    if (e.key === ' ') { e.preventDefault(); drill('reveal'); }
    if (e.key === 'ArrowRight') drill('next');
    if (e.key === 'ArrowLeft') drill('prev');
  });

  $('#themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const nx = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = nx; store.set('book-theme', nx);
  });
  $('#navBtn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('#scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));

  render();
})();
