// Storybook engine. Scenes are data (assets/story/s*.js): actors placed on a 640×360 stage, then beats that
// change actor state (position, colour, label, visibility) and move tokens along paths. State for beat k is
// the initial state plus every beat's changes up to k, so stepping backwards and jumping work the same way.
(() => {
  const S = window.STORY;
  const BOOK = window.KETTLE_BOOK || 'index.html';
  const NS = 'http://www.w3.org/2000/svg';
  const app = document.getElementById('app');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ROLES = ['', 'acc', 'ok', 'bad', 'warn', 'why', 'mute'];

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const md = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const svgEl = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const textW = (t, size) => String(t).length * size * 0.58;

  let seen = new Set();
  try { seen = new Set(JSON.parse(localStorage.getItem('kettle-story-seen') || '[]')); } catch { /* storage unavailable */ }
  const remember = id => { seen.add(id); try { localStorage.setItem('kettle-story-seen', JSON.stringify([...seen])); } catch { /* ignore */ } };

  const parts = S.parts;
  const scenes = S.scenes;
  scenes.forEach((s, i) => {
    s.i = i;
    const inPart = scenes.filter(x => x.part === s.part);
    s.num = parts.find(p => p.id === s.part).num + '.' + (inPart.indexOf(s) + 1);
  });
  const byId = Object.fromEntries(scenes.map(s => [s.id, s]));

  // ---------- model ----------
  function parse(scene) {
    if (scene.actors) return;
    scene.actors = scene.a.map(r => {
      const [k, id, x, y, t, o = {}] = r;
      if (k === 'arr') return { k, id, from: x, to: y, t: t || '', o };
      return { k, id, x, y, t: t ?? '', o };
    });
    scene.ix = Object.fromEntries(scene.actors.map(a => [a.id, a]));
    const init = {};
    for (const a of scene.actors) {
      init[a.id] = a.k === 'arr'
        ? { o: a.o.o ?? 1, c: a.o.c || '', t: a.t }
        : { x: a.x, y: a.y, o: a.o.o ?? 1, c: a.o.c || '', t: a.t, sub: a.o.sub || '', s: a.o.s ?? 1, hl: a.o.hl ?? -1 };
    }
    scene.states = [];
    let cur = init;
    for (const beat of scene.b) {
      cur = structuredClone(cur);
      for (const key in beat) {
        const v = beat[key];
        if (key === 'say' || key === 'pro' || key === 'pulse' || key === 'go') continue;
        if (key === 'show' || key === 'hide') { for (const id of v) need(scene, id, cur).o = key === 'show' ? 1 : 0; continue; }
        if (ROLES.includes(key) || key === 'plain') { for (const id of v) need(scene, id, cur).c = key === 'plain' ? '' : key; continue; }
        Object.assign(need(scene, key, cur), v);
      }
      for (const g of beat.go || []) {
        const st = need(scene, g[0], cur);
        const last = park(scene, cur, g[g.length - 1]);
        st.x = last[0]; st.y = last[1]; st.o = 1;
      }
      scene.states.push(cur);
    }
  }
  function need(scene, id, st) {
    if (!st[id]) throw new Error(`Scene ${scene.id}: unknown actor "${id}"`);
    return st[id];
  }
  function point(scene, st, p) {
    if (Array.isArray(p)) return p;
    if (typeof p === 'object') return [p.x, p.y];
    const a = need(scene, p, st);
    return [a.x, a.y];
  }
  // a token that ends on an actor parks on its top-right corner, so it doesn't cover the label
  function park(scene, st, p) {
    if (typeof p !== 'string') return point(scene, st, p);
    const a = scene.ix[p], s = need(scene, p, st);
    if (a.k === 'dot') return [s.x, s.y];
    const [w, h] = size(a, s);
    return [s.x + w / 2 - 6, s.y - h / 2 + 2];
  }
  function size(a, st) {
    const o = { ...a.o, ...(st && st.w ? { w: st.w } : {}) }, t = st ? st.t : a.t;
    switch (a.k) {
      case 'box': return [o.w || Math.max(118, textW(t, 14) + 30), o.h || ((st ? st.sub : o.sub) ? 58 : 46)];
      case 'pill': return [o.w || Math.max(46, textW(t, 13) + 26), 30];
      case 'dot': return [24, 24];
      case 'db': return [o.w || Math.max(96, textW(t, 14) + 24), 64];
      case 'user': return [46, 70];
      case 'code': { const ls = String(t).split('\n'); return [o.w || Math.max(...ls.map(l => l.length)) * 7.55 + 26, ls.length * 19 + 18]; }
      case 'zone': return [o.w || 200, o.h || 120];
      case 'txt': return [textW(t, o.size || 14), (o.size || 14) * 1.4];
      default: return [20, 20];
    }
  }

  // ---------- drawing ----------
  function drawShape(a, st, inner) {
    inner.replaceChildren();
    const [w, h] = size(a, st);
    const t = st.t, sub = st.sub;
    const label = (y, cls = 'lbl') => { const e = svgEl('text', { class: cls, x: 0, y }, inner); e.textContent = t; return e; };
    switch (a.k) {
      case 'box':
        svgEl('rect', { class: 'sh', x: -w / 2, y: -h / 2, width: w, height: h, rx: 11 }, inner);
        label(sub ? -8 : 1);
        if (sub) svgEl('text', { class: 'sub', x: 0, y: 13 }, inner).textContent = sub;
        break;
      case 'pill':
        svgEl('rect', { class: 'sh', x: -w / 2, y: -15, width: w, height: 30, rx: 15 }, inner);
        label(1);
        break;
      case 'dot':
        svgEl('circle', { class: 'sh', r: 12 }, inner);
        label(1);
        break;
      case 'db': {
        const top = -h / 2 + 9, rx = w / 2;
        svgEl('path', { class: 'sh', d: `M${-rx},${top} V${h / 2 - 9} A${rx},9 0 0 0 ${rx},${h / 2 - 9} V${top} A${rx},9 0 0 0 ${-rx},${top} Z` }, inner);
        svgEl('ellipse', { class: 'sh', cx: 0, cy: top, rx, ry: 9 }, inner);
        label(sub ? 4 : 9);
        if (sub) svgEl('text', { class: 'sub', x: 0, y: 21 }, inner).textContent = sub;
        break;
      }
      case 'user':
        svgEl('circle', { class: 'sh', cx: 0, cy: -22, r: 10 }, inner);
        svgEl('path', { class: 'sh', d: 'M-17,8 C-17,-6 17,-6 17,8 Z' }, inner);
        label(26);
        break;
      case 'code': {
        const ls = String(t).split('\n');
        svgEl('rect', { class: 'codebg', x: -w / 2, y: -h / 2, width: w, height: h, rx: 10 }, inner);
        const hl = [].concat(st.hl);
        ls.forEach((l, i) => {
          const y = -h / 2 + 9 + i * 19 + 9.5;
          svgEl('rect', { class: 'clh' + (hl.includes(i) ? ' on' : ''), x: -w / 2 + 4, y: y - 9.5, width: w - 8, height: 19, rx: 4 }, inner);
          svgEl('text', { class: 'cl', x: -w / 2 + 13, y: y + 1 }, inner).textContent = l;
        });
        break;
      }
      case 'zone':
        svgEl('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: 14 }, inner);
        svgEl('text', { class: 'zt', x: -w / 2 + 12, y: -h / 2 + 17 }, inner).textContent = t;
        break;
      case 'txt': {
        const cls = 'tx' + (a.o.mono ? ' mono' : '') + (a.o.big ? ' big' : '');
        const ls = String(t).split('\n');
        ls.forEach((l, i) => { svgEl('text', { class: cls, x: 0, y: (i - (ls.length - 1) / 2) * 18 }, inner).textContent = l; });
        break;
      }
    }
  }

  function arrowPath(scene, a, st) {
    const A = scene.ix[a.from], B = scene.ix[a.to];
    const sa = st[a.from], sb = st[a.to];
    const p1 = edge(sa.x, sa.y, size(A, sa), sb.x, sb.y);
    const p2 = edge(sb.x, sb.y, size(B, sb), sa.x, sa.y);
    const bend = a.o.bend || 0;
    if (!bend) return [`M${p1[0]},${p1[1]} L${p2[0]},${p2[1]}`, [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2]];
    const mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2, dx = p2[0] - p1[0], dy = p2[1] - p1[1], len = Math.hypot(dx, dy) || 1;
    const cx = mx - dy / len * bend, cy = my + dx / len * bend;
    return [`M${p1[0]},${p1[1]} Q${cx},${cy} ${p2[0]},${p2[1]}`, [(mx + cx) / 2, (my + cy) / 2]];
  }
  function edge(cx, cy, [w, h], tx, ty) {
    const dx = tx - cx, dy = ty - cy;
    if (!dx && !dy) return [cx, cy];
    const k = Math.min(dx ? (w / 2 + 5) / Math.abs(dx) : Infinity, dy ? (h / 2 + 5) / Math.abs(dy) : Infinity);
    return [cx + dx * k, cy + dy * k];
  }

  // ---------- scene view ----------
  let view = null; // { scene, beat, svg, nodes, timer, playing }

  function build(scene) {
    parse(scene);
    const svg = svgEl('svg', { viewBox: '0 0 640 360', role: 'img', 'aria-label': scene.title });
    const defs = svgEl('defs', {}, svg);
    for (const r of ROLES) {
      const m = svgEl('marker', { id: 'ah-' + r, viewBox: '0 0 10 10', refX: 8.5, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
      svgEl('path', { d: 'M0,0 L10,5 L0,10 z' }, m);
    }
    const zones = svgEl('g', {}, svg), arrows = svgEl('g', {}, svg), nodes = svgEl('g', {}, svg);
    const els = {};
    for (const a of scene.actors) {
      if (a.k === 'arr') {
        const g = svgEl('g', { class: 'arr' + (a.o.dash ? ' dash' : '') }, arrows);
        const p = svgEl('path', {}, g);
        if (!a.o.nohead) p.setAttribute('marker-end', 'url(#ah-)');
        if (a.o.both) p.setAttribute('marker-start', 'url(#ah-)');
        const tx = svgEl('text', {}, g);
        els[a.id] = { g, p, tx };
        continue;
      }
      const g = svgEl('g', { class: 'actor ' + a.k, 'data-id': a.id }, a.k === 'zone' ? zones : nodes);
      const sc = svgEl('g', {}, g), pu = svgEl('g', {}, sc);
      els[a.id] = { g, sc, pu, drawn: null };
    }
    return { svg, els };
  }

  function apply(scene, built, k, prevK) {
    const st = scene.states[k];
    const beat = scene.b[k];
    const animate = !reduce && prevK === k - 1;
    const moving = new Set(animate ? (beat.go || []).map(g => g[0]) : []);
    for (const a of scene.actors) {
      const s = st[a.id], e = built.els[a.id];
      if (a.k === 'arr') {
        const [d, mid] = arrowPath(scene, a, st);
        e.p.setAttribute('d', d);
        if (!a.o.nohead) e.p.setAttribute('marker-end', `url(#ah-${s.c})`);
        if (a.o.both) e.p.setAttribute('marker-start', `url(#ah-${s.c})`);
        e.tx.setAttribute('x', mid[0]); e.tx.setAttribute('y', mid[1] - 9);
        e.tx.textContent = s.t;
        e.g.dataset.c = s.c; e.g.style.opacity = s.o;
        continue;
      }
      const sig = JSON.stringify([s.t, s.sub, s.hl, s.w]);
      if (e.drawn !== sig) { drawShape(a, s, e.pu); e.drawn = sig; }
      e.g.dataset.c = s.c;
      if (moving.has(a.id)) e.g.style.transition = 'opacity .3s';
      e.g.style.transform = `translate(${s.x}px,${s.y}px)`;
      e.g.style.opacity = s.o;
      e.sc.style.transform = `scale(${s.s})`;
    }
    if (!animate) return;
    const prev = scene.states[k - 1];
    for (const g of beat.go || []) {
      const e = built.els[g[0]];
      const pts = [[prev[g[0]].x, prev[g[0]].y], ...g.slice(1, -1).map(p => point(scene, st, p)), [st[g[0]].x, st[g[0]].y]];
      const legs = pts.length - 1;
      const dur = Math.min(2600, Math.max(700, legs * 650));
      const anim = e.g.animate(pts.map(p => ({ transform: `translate(${p[0]}px,${p[1]}px)` })), { duration: dur, easing: 'ease-in-out', delay: 250 });
      anim.onfinish = anim.oncancel = () => { e.g.style.transition = ''; };
    }
    for (const id of beat.pulse || []) {
      built.els[id].pu.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.13)' }, { transform: 'scale(1)' }], { duration: 650, delay: 350, easing: 'ease-in-out' });
    }
  }

  function beatDuration(scene, k) {
    const b = scene.b[k];
    const legs = Math.max(0, ...(b.go || []).map(g => g.length - 1));
    return 2600 + b.say.length * 28 + legs * 450;
  }

  function showScene(id, beat = 0) {
    const scene = byId[id];
    stopPlay();
    remember(id);
    const built = build(scene);
    const prevScene = scenes[scene.i - 1], nextScene = scenes[scene.i + 1];
    const part = parts.find(p => p.id === scene.part);
    app.innerHTML = `
      <article class="scene">
        <div class="eyebrow"><b>${scene.num}</b><span>Part ${esc(part.num)} · ${esc(part.title)}</span></div>
        <h1>${esc(scene.title)}</h1>
        <p class="hook">${md(scene.hook)}</p>
        <figure class="stage" id="stage"></figure>
        <div class="cap" aria-live="polite"><span class="badge" id="badge" hidden>Staff-level</span><p id="say"></p></div>
        <div class="ctl">
          <button class="btn" id="back" type="button" aria-label="Previous step">←</button>
          <div class="dots" id="dots">${scene.b.map((b, i) => `<button type="button" class="${b.pro ? 'pro' : ''}" data-i="${i}" aria-label="Step ${i + 1}${b.pro ? ' (staff-level)' : ''}"></button>`).join('')}</div>
          <button class="btn" id="play" type="button">▶ Play</button>
          <button class="btn pri" id="fwd" type="button">Next →</button>
        </div>
        <p class="key" id="key" hidden>${md(scene.key)}</p>
        <nav class="pager">
          <button class="btn" id="prevS" type="button" ${prevScene ? '' : 'disabled'}>← ${prevScene ? esc(prevScene.title) : 'Start'}</button>
          <a class="btn mid" href="${BOOK}#/${scene.ch || scene.id}">Go deeper: full chapter</a>
          <button class="btn" id="nextS" type="button" ${nextScene ? '' : 'disabled'}>${nextScene ? esc(nextScene.title) : 'The end'} →</button>
        </nav>
        <p class="hint">Keys: ← → step · P play · M map. Swipe the picture on a phone.</p>
      </article>`;
    document.getElementById('stage').appendChild(built.svg);
    view = { scene, built, beat: -1, playing: false, timer: 0 };
    built.svg.querySelectorAll('.actor').forEach(g => { g.style.transition = 'none'; });
    go(Math.min(beat, scene.b.length - 1), true);
    requestAnimationFrame(() => requestAnimationFrame(() => built.svg.querySelectorAll('.actor').forEach(g => { g.style.transition = ''; })));
    document.getElementById('prog').textContent = `${scene.i + 1} / ${scenes.length}`;
    document.getElementById('back').onclick = () => { stopPlay(); step(-1); };
    document.getElementById('fwd').onclick = () => { stopPlay(); step(1); };
    document.getElementById('play').onclick = togglePlay;
    document.getElementById('dots').onclick = e => { const i = e.target.closest('button')?.dataset.i; if (i != null) { stopPlay(); go(+i); } };
    document.getElementById('prevS').onclick = () => prevScene && nav(prevScene.id);
    document.getElementById('nextS').onclick = () => nextScene && nav(nextScene.id);
    swipe(document.getElementById('stage'));
    window.scrollTo({ top: 0 });
  }

  function go(k, first) {
    const v = view, scene = v.scene;
    const prevK = first ? -2 : v.beat;
    v.beat = k;
    apply(scene, v.built, k, prevK);
    const b = scene.b[k];
    const say = document.getElementById('say');
    say.innerHTML = md(b.say);
    say.classList.remove('fade'); void say.offsetWidth; say.classList.add('fade');
    document.getElementById('badge').hidden = !b.pro;
    document.querySelectorAll('#dots button').forEach((d, i) => d.classList.toggle('on', i === k));
    document.getElementById('key').hidden = k !== scene.b.length - 1;
    document.getElementById('back').disabled = k === 0 && scene.i === 0;
    const last = k === scene.b.length - 1, nextScene = scenes[scene.i + 1];
    document.getElementById('fwd').textContent = last ? (nextScene ? 'Next scene →' : 'Back to map') : 'Next →';
  }

  function step(d) {
    const v = view, n = v.scene.b.length;
    const k = v.beat + d;
    if (k < 0) { const p = scenes[v.scene.i - 1]; if (p) nav(p.id, p.b.length - 1); return; }
    if (k >= n) { const nx = scenes[v.scene.i + 1]; nx ? nav(nx.id) : nav('map'); return; }
    go(k);
  }

  function togglePlay() { view.playing ? stopPlay() : startPlay(); }
  function startPlay() {
    view.playing = true;
    document.getElementById('play').textContent = '❚❚ Pause';
    const tick = () => {
      if (!view.playing) return;
      const last = view.beat === view.scene.b.length - 1;
      view.timer = setTimeout(() => {
        if (!view.playing) return;
        if (last) { const nx = scenes[view.scene.i + 1]; if (!nx) { stopPlay(); return; } nav(nx.id); startPlay(); return; }
        go(view.beat + 1); tick();
      }, beatDuration(view.scene, view.beat) + (last ? 1800 : 0));
    };
    tick();
  }
  function stopPlay() {
    if (!view) return;
    view.playing = false; clearTimeout(view.timer);
    const p = document.getElementById('play'); if (p) p.textContent = '▶ Play';
  }

  function swipe(el) {
    let x0 = null;
    el.addEventListener('pointerdown', e => { x0 = e.clientX; });
    el.addEventListener('pointerup', e => {
      if (x0 == null) return;
      const dx = e.clientX - x0; x0 = null;
      if (Math.abs(dx) > 40) { stopPlay(); step(dx < 0 ? 1 : -1); }
    });
  }

  // ---------- map view ----------
  function showMap() {
    stopPlay(); view = null;
    const done = scenes.filter(s => seen.has(s.id)).length;
    const first = scenes.find(s => !seen.has(s.id)) || scenes[0];
    app.innerHTML = `
      <section class="hero">
        <h1>One tea shop. The whole .NET backend.</h1>
        <p>Kettle starts as a few lines of C# and grows into a cloud system. Every time it grows, something breaks, and each break teaches one topic. ${scenes.length} short animated scenes, fundamentals first, a staff-level insight at the end of each.</p>
        <div class="go">
          <button class="btn pri" type="button" data-go="${first.id}">${done ? 'Continue: ' + esc(first.title) : 'Start the story'} →</button>
          ${done ? `<button class="btn" type="button" data-go="${scenes[0].id}">Start over</button>` : ''}
        </div>
      </section>
      ${parts.map(p => `
        <section class="part">
          <h2><b>Part ${esc(p.num)}</b>${esc(p.title)}</h2>
          <div class="tiles">${scenes.filter(s => s.part === p.id).map(s => `
            <button class="tile" type="button" data-go="${s.id}">
              <span class="n"><span>${s.num}</span>${seen.has(s.id) ? '<span class="seen">seen ✓</span>' : ''}</span>
              <span class="t">${esc(s.title)}</span>
              <span class="h">${md(s.hook)}</span>
            </button>`).join('')}</div>
        </section>`).join('')}`;
    app.onclick = e => { const id = e.target.closest('[data-go]')?.dataset.go; if (id) nav(id); };
    document.getElementById('prog').textContent = `${done} / ${scenes.length} seen`;
    window.scrollTo({ top: 0 });
  }

  // ---------- routing ----------
  let pendingBeat = 0;
  function nav(id, beat = 0) {
    pendingBeat = beat;
    if (location.hash === '#' + id) route(); else location.hash = id;
  }
  function route() {
    const id = decodeURIComponent(location.hash.slice(1));
    app.onclick = null;
    if (byId[id]) showScene(id, pendingBeat); else showMap();
    pendingBeat = 0;
  }
  window.addEventListener('hashchange', route);
  document.getElementById('home').onclick = () => nav('map');
  document.getElementById('mapBtn').onclick = () => nav('map');
  document.getElementById('bookBtn').href = BOOK;
  document.addEventListener('keydown', e => {
    if (e.target.closest('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'm' || e.key === 'M') nav('map');
    if (!view) return;
    if (e.key === 'ArrowRight') { stopPlay(); step(1); }
    else if (e.key === 'ArrowLeft') { stopPlay(); step(-1); }
    else if (e.key === 'p' || e.key === 'P') togglePlay();
  });
  // self-check: every scene's states compute (throws with the scene id on a typo)
  scenes.forEach(parse);
  route();
})();
