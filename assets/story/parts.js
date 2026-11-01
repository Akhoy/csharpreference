// Story data. Actor rows: [kind, id, x, y, label, opts]. Kinds: box, pill, dot, db, user, code, zone, txt,
// and arr (['arr', id, fromId, toId, label, opts]). Opts: c (colour role: acc ok bad warn why mute), sub, w, h,
// o (0 = hidden at start), s (scale), hl (highlighted code line), dash/bend/both/nohead for arrows.
// Beat keys: say (caption), pro (staff-level beat), show/hide/acc/ok/bad/warn/why/mute/plain (id lists),
// go ([[tokenId, waypoint, ...]] where a waypoint is an actor id or [x, y]), pulse (id list),
// or an actor id with partial state ({ x, y, o, c, t, sub, s, hl }).
window.STORY = {
  parts: [
    { id: 'p0', num: '0', title: 'Orientation' },
    { id: 'p1', num: 'I', title: 'The .NET platform' },
    { id: 'p2', num: 'II', title: 'The C# language' },
    { id: 'p3', num: 'III', title: 'ASP.NET Core' },
    { id: 'pui', num: 'IV', title: 'Web UI: MVC, Razor Pages and Blazor' },
    { id: 'p4', num: 'V', title: 'Data access' },
    { id: 'p5', num: 'VI', title: 'Architecture and design' },
    { id: 'p6', num: 'VII', title: 'Testing' },
    { id: 'p7', num: 'VIII', title: 'Distributed systems' },
    { id: 'pms', num: 'IX', title: 'Microservices' },
    { id: 'phost', num: 'X', title: 'Hosting in production' },
    { id: 'p8', num: 'XI', title: 'Cloud and DevOps' },
    { id: 'p9', num: 'XII', title: 'Performance and internals' },
    { id: 'p10', num: 'XIII', title: 'Security' },
    { id: 'pproj', num: 'XIV', title: 'Building real projects' },
    { id: 'p11', num: 'XV', title: 'Interview preparation' }
  ],
  scenes: [],
  scene(s) { this.scenes.push(s); },
  // Explanations, kept apart from the animation data: base = from-zero primer, beats = one per beat.
  ex: {},
  explain(id, e) { this.ex[id] = e; }
};
