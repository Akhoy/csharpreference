// Part II: the C# language, as Kettle's first ten problems.
(S => {
  const road = ['Types', 'Classes', 'Generics', 'Delegates', 'Collections', 'LINQ', 'Exceptions', 'Async', 'Modern C#', 'Advanced'];
  const rx = [75, 197, 320, 443, 565];
  S.scene({
    id: 'csharp-story', part: 'p2', title: 'Meet Kettle',
    hook: 'A two-person team, an online tea shop, and a C# backend that keeps outgrowing itself.',
    a: [
      ['txt', 'title', 320, 52, 'Kettle · online tea shop', { big: true }],
      ...road.map((t, i) => ['pill', 'r' + i, i < 5 ? rx[i] : rx[9 - i], i < 5 ? 150 : 255, t, { w: 112, c: 'mute' }]),
      ['arr', 'turn', 'r4', 'r5', '', { bend: -40, o: 0 }],
      ['dot', 'k', 75, 150, 'K', { o: 0 }]
    ],
    b: [
      { say: 'Kettle sells tea online. Each time it grows, something breaks.', show: ['k'] },
      { say: 'Each break is the reason one C# feature exists. Problem first, then the feature.', acc: ['r0', 'r1', 'r2', 'r3', 'r4'], go: [['k', 'r1', 'r2', 'r3', 'r4']] },
      { say: 'Ten episodes take Kettle from its first bug to its first performance fix.', show: ['turn'], acc: ['r5', 'r6', 'r7', 'r8', 'r9'], go: [['k', 'r5', 'r6', 'r7', 'r8', 'r9']] }
    ],
    key: 'Learn the problem first, and the feature makes sense.'
  });

  S.scene({
    id: 'type-system', part: 'p2', title: 'Copied or shared?',
    hook: 'You copy a basket to save it for later. Editing the copy changes the original.',
    a: [
      ['zone', 'stack', 125, 190, 'Stack: variables', { w: 210, h: 300 }],
      ['zone', 'heap', 455, 190, 'Heap: objects', { w: 330, h: 300 }],
      ['pill', 'va', 125, 95, 'a', { w: 120 }],
      ['pill', 'vb', 125, 145, 'b', { w: 120, o: 0 }],
      ['box', 'bk', 430, 110, 'Basket', { sub: '2 × Sencha', w: 150 }],
      ['arr', 'pa', 'va', 'bk', '', {}],
      ['arr', 'pb', 'vb', 'bk', '', { o: 0 }],
      ['pill', 'm1', 125, 235, 'price = £5', { w: 150, o: 0 }],
      ['pill', 'm2', 125, 290, 'copy = £5', { w: 150, o: 0 }],
      ['box', 'boxed', 430, 275, 'boxed Money', { sub: '£5', w: 150, o: 0, c: 'warn' }],
      ['arr', 'pbx', 'm1', 'boxed', 'box', { o: 0, dash: true, c: 'warn' }]
    ],
    b: [
      { say: '`Basket` is a **class**. The variable `a` holds a **reference**: an arrow to the object on the heap.' },
      { say: '`var b = a;` copies the arrow, not the basket. Now both point at the same one.', show: ['vb', 'pb'], acc: ['pa', 'pb'] },
      { say: 'So when `b` adds a tea, `a` sees it too. That was the bug.', bk: { sub: '3 × Sencha', c: 'bad' }, pulse: ['bk'] },
      { say: '`Money` is a **struct**. Assigning it copies the whole value: two independent copies.', show: ['m1', 'm2'], ok: ['m1', 'm2'], plain: ['bk'] },
      { pro: true, say: 'Store a struct as `object` and it is **boxed**: copied onto the heap. Boxing in hot loops creates garbage.', show: ['boxed', 'pbx'], pulse: ['boxed'] }
    ],
    key: 'Classes are shared by reference. Structs are copied by value.'
  });

  S.scene({
    id: 'oop', part: 'p2', title: 'Objects that guard themselves',
    hook: 'An order shows up with quantity −3, marked shipped before it was paid.',
    a: [
      ['box', 'ord', 165, 120, 'Order', { sub: 'Quantity = 3', w: 160 }],
      ['code', 'hack', 455, 120, 'order.Quantity = -3;\norder.Status = Shipped;'],
      ['pill', 'guard', 165, 210, 'private set + rules', { o: 0, c: 'ok' }],
      ['box', 'chk', 455, 230, 'Checkout', { sub: 'needs an IPayment', o: 0, w: 170 }],
      ['pill', 'card', 330, 320, 'Card', { o: 0 }],
      ['pill', 'pp', 455, 320, 'PayPal', { o: 0 }],
      ['pill', 'gift', 580, 320, 'Gift card', { o: 0 }],
      ['arr', 'x1', 'card', 'chk', '', { o: 0 }], ['arr', 'x2', 'pp', 'chk', '', { o: 0 }], ['arr', 'x3', 'gift', 'chk', '', { o: 0 }]
    ],
    b: [
      { say: 'With public fields, any code can set nonsense.', ord: { sub: 'Quantity = -3', c: 'bad' }, hack: { hl: [0, 1] }, pulse: ['ord'] },
      { say: '**Encapsulation**: the class keeps its data private and checks its own rules. That code no longer compiles.', ord: { sub: 'Quantity = 3', c: 'ok' }, show: ['guard'], hack: { hl: -1, t: '// error CS0272:\n// the setter is private' } },
      { say: 'An **interface** says what any payment can do. Checkout works with all of them.', show: ['chk', 'card', 'pp', 'gift', 'x1', 'x2', 'x3'] },
      { pro: true, say: 'Interface and `virtual` calls are picked at run time (**dynamic dispatch**). Prefer **composition** to deep inheritance trees.', acc: ['chk'], pulse: ['card', 'pp', 'gift'] }
    ],
    key: 'Objects guard their own rules. Interfaces let parts swap.'
  });

  S.scene({
    id: 'generics', part: 'p2', title: 'Write it once',
    hook: 'OrderCache, CustomerCache, ProductCache: the same 40 lines, three times.',
    a: [
      ['box', 'c1', 115, 90, 'OrderCache', { w: 160 }],
      ['box', 'c2', 115, 180, 'CustomerCache', { w: 160 }],
      ['box', 'c3', 115, 270, 'ProductCache', { w: 160 }],
      ['box', 'gen', 345, 180, 'Cache<T>', { w: 140, c: 'acc', o: 0 }],
      ['pill', 'tO', 540, 90, 'Cache<Order>', { w: 160, o: 0 }],
      ['pill', 'tC', 540, 180, 'Cache<Customer>', { w: 160, o: 0 }],
      ['pill', 'tP', 540, 270, 'Cache<Product>', { w: 160, o: 0 }],
      ['arr', 'g1', 'gen', 'tO', '', { o: 0 }], ['arr', 'g2', 'gen', 'tC', '', { o: 0 }], ['arr', 'g3', 'gen', 'tP', '', { o: 0 }],
      ['pill', 'cons', 345, 300, 'where T : IEntity', { c: 'why', o: 0 }]
    ],
    b: [
      { say: 'Three copies of the same code. One bug fix means three edits.', bad: ['c1', 'c2', 'c3'], pulse: ['c1', 'c2', 'c3'] },
      { say: 'A **generic** class is written once, with a placeholder type `T`.', show: ['gen'], mute: ['c1', 'c2', 'c3'] },
      { say: 'Use it with any type. The compiler checks every use, so there are no casts.', show: ['tO', 'tC', 'tP', 'g1', 'g2', 'g3'] },
      { say: '**Constraints** say what `T` must support.', show: ['cons'] },
      { pro: true, say: 'Generics are real at run time. Each **value type** gets its own compiled code, so `List<int>` never boxes.', pulse: ['tO', 'tC', 'tP'], acc: ['tO', 'tC', 'tP'] }
    ],
    key: 'Write it once, for any type, still type-safe.'
  });

  S.scene({
    id: 'delegates-events', part: 'p2', title: 'Behaviour as a value',
    hook: 'The discount rule changes every week, and each change means editing checkout.',
    a: [
      ['box', 'co', 165, 180, 'Checkout', { sub: 'rule: hard-coded', w: 170 }],
      ['pill', 'r1', 475, 90, 'Weekday: −10%', { w: 170, o: 0 }],
      ['pill', 'r2', 475, 180, 'Black Friday: −30%', { w: 170, o: 0 }],
      ['pill', 'r3', 475, 270, 'Loyalty: −5%', { w: 170, o: 0 }],
      ['dot', 'f', 475, 90, 'f', { o: 0 }],
      ['pill', 'e1', 475, 90, 'Send email', { w: 150, o: 0 }],
      ['pill', 'e2', 475, 180, 'Update stock', { w: 150, o: 0 }],
      ['pill', 'e3', 475, 270, 'Analytics', { w: 150, o: 0 }],
      ['arr', 'v1', 'co', 'e1', '', { o: 0 }], ['arr', 'v2', 'co', 'e2', '', { o: 0 }], ['arr', 'v3', 'co', 'e3', '', { o: 0 }],
      ['dot', 'd1', 165, 180, '', { o: 0 }], ['dot', 'd2', 165, 180, '', { o: 0 }], ['dot', 'd3', 165, 180, '', { o: 0 }]
    ],
    b: [
      { say: 'The rule is baked into checkout. Changing it means changing checkout.', bad: ['co'], pulse: ['co'] },
      { say: 'A **delegate** stores a method in a variable. Pass the rule in as a `Func<Order, decimal>`.', show: ['r1', 'r2', 'r3'], go: [['f', 'co']], co: { c: 'ok', sub: 'rule: Weekday' } },
      { say: 'Next week, plug in a different rule. Checkout doesn\'t change.', go: [['f', 'r2', 'co']], co: { sub: 'rule: Black Friday' } },
      { say: 'An **event** is a list of delegates. Checkout raises `OrderPlaced`, and any number of handlers run.', hide: ['r1', 'r2', 'r3', 'f'], show: ['e1', 'e2', 'e3', 'v1', 'v2', 'v3'], co: { sub: 'raises OrderPlaced', c: 'acc' }, go: [['d1', 'e1'], ['d2', 'e2'], ['d3', 'e3']] },
      { pro: true, say: 'A subscriber that never unsubscribes is kept alive by the publisher: a **memory leak**. Lambdas capture **variables**, not their values.', warn: ['e3'], pulse: ['e3'] }
    ],
    key: 'Delegates let you pass behaviour around like data.'
  });

  const items = Array.from({ length: 10 }, (_, i) => ['dot', 'l' + i, 70 + i * 55, 110, String(i + 1), { c: 'mute' }]);
  S.scene({
    id: 'collections', part: 'p2', title: 'The right container',
    hook: 'Kettle has 200,000 orders. Finding one takes forever.',
    a: [
      ['txt', 'lt', 70, 70, 'List', { mono: true }],
      ...items,
      ['dot', 'seek', 70, 160, '?', { c: 'warn', o: 0 }],
      ['pill', 'hash', 320, 200, 'hash("K-1042") → bucket 2', { c: 'why', o: 0 }],
      ...[0, 1, 2, 3].map(i => ['pill', 'b' + i, 110 + i * 140, 265, 'bucket ' + i, { w: 110, o: 0 }]),
      ['pill', 'hs', 120, 330, 'HashSet: seen it?', { o: 0 }],
      ['pill', 'qu', 320, 330, 'Queue: first in, first out', { o: 0 }],
      ['pill', 'ls', 530, 330, 'List: by position', { o: 0 }]
    ],
    b: [
      { say: 'A `List` has to check items one by one. Double the orders, double the time.', go: [['seek', 'l0', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9']], warn: ['l9'] },
      { say: 'A `Dictionary` turns the key into a number, a **hash**, and jumps straight to one bucket.', show: ['hash', 'b0', 'b1', 'b2', 'b3'], go: [['seek', 'hash', 'b2']], acc: ['b2'], plain: ['l9'] },
      { say: 'Choose by the question you ask most.', show: ['hs', 'qu', 'ls'] },
      { pro: true, say: 'A `List` doubles its array when full and copies everything across. Pre-size large ones. `FrozenDictionary` is fastest for lookups that never change.', pulse: ['b2'] }
    ],
    key: 'List scans. Dictionary jumps. Pick by your most common question.'
  });

  S.scene({
    id: 'linq', part: 'p2', title: 'Describe the result',
    hook: 'The owner wants five reports. The nested loops are getting out of hand.',
    a: [
      ['code', 'q', 320, 62, 'orders.Where(o => o.Paid)\n      .OrderByDescending(o => o.Total)\n      .Take(5)'],
      ['pill', 'src', 75, 200, 'orders', { w: 100 }],
      ['pill', 'wh', 225, 200, 'Where paid', { w: 120 }],
      ['pill', 'ob', 390, 200, 'Order by total', { w: 140 }],
      ['pill', 'tk', 545, 200, 'Take 5', { w: 100 }],
      ['arr', 's1', 'src', 'wh', ''], ['arr', 's2', 'wh', 'ob', ''], ['arr', 's3', 'ob', 'tk', ''],
      ['pill', 'tl', 545, 295, 'ToList()', { c: 'acc', o: 0 }],
      ['arr', 's4', 'tk', 'tl', 'runs now', { o: 0 }],
      ['db', 'sql', 225, 300, 'SQL', { o: 0, c: 'why' }],
      ['dot', 'd1', 75, 200, '', { o: 0 }], ['dot', 'd2', 75, 200, '', { o: 0, c: 'bad' }]
    ],
    b: [
      { say: 'LINQ lets you say **what** you want. Each operator is one stage of a pipeline.', acc: ['wh', 'ob', 'tk'] },
      { say: 'Nothing has run yet. The query is only a description: **deferred execution**.', pulse: ['src'] },
      { say: '`ToList()` or `foreach` pulls items through. An unpaid order is dropped at `Where`.', show: ['tl', 's4'], go: [['d1', 'wh', 'ob', 'tk', 'tl'], ['d2', 'wh']] },
      { pro: true, say: 'Against EF Core the query is an `IQueryable`: an **expression tree** translated into SQL and run by the database, not in memory.', show: ['sql'], hide: ['d2'], pulse: ['sql'] }
    ],
    key: 'Describe the result; LINQ runs it lazily, in memory or as SQL.'
  });

  S.scene({
    id: 'exceptions-disposal', part: 'p2', title: 'Failing cleanly',
    hook: 'The bank fails halfway through checkout, and a database connection is left open.',
    a: [
      ['zone', 'cs', 165, 180, 'Call stack', { w: 230, h: 300 }],
      ['box', 'f1', 165, 90, 'Checkout()', { w: 180 }],
      ['box', 'f2', 165, 175, 'Pay()', { w: 180 }],
      ['box', 'f3', 165, 260, 'CallBank()', { w: 180 }],
      ['dot', 'ex', 165, 260, '!', { o: 0, c: 'bad' }],
      ['db', 'conn', 470, 120, 'DB connection', { sub: 'open', c: 'warn' }],
      ['pill', 'use', 470, 250, 'using → Dispose()', { o: 0, c: 'ok' }]
    ],
    b: [
      { say: 'The bank call fails, so it **throws** an exception.', show: ['ex'], bad: ['f3'], pulse: ['f3'] },
      { say: 'The exception unwinds the stack, frame by frame, to the nearest `catch`.', go: [['ex', 'f2', 'f1']], f1: { sub: 'catch (PaymentFailed)', c: 'ok' } },
      { say: 'The connection was never closed. `using` guarantees `Dispose()` runs, even when something throws.', show: ['use'], conn: { sub: 'closed', c: 'ok' } },
      { pro: true, say: 'Rethrow with `throw;`, not `throw ex;`, to keep the stack trace. For **expected** failures, return a result object: exceptions are slow.', pulse: ['f1'] }
    ],
    key: 'Exceptions stop the work; using cleans up either way.'
  });

  S.scene({
    id: 'async-await', part: 'p2', title: 'Don\'t hold the thread',
    hook: 'Black Friday. The site freezes, but the CPU is at 5%.',
    a: [
      ...[0, 1, 2, 3].map(i => ['dot', 'q' + i, 55, 80 + i * 60, 'R', { c: 'warn', o: 0 }]),
      ['box', 't1', 290, 90, 'Thread 1', { sub: 'serving', w: 170 }],
      ['box', 't2', 290, 180, 'Thread 2', { sub: 'serving', w: 170 }],
      ['box', 't3', 290, 270, 'Thread 3', { sub: 'serving', w: 170 }],
      ['box', 'api', 540, 180, 'Payment API', { sub: 'takes 2 s', w: 150 }],
      ['arr', 'w1', 't1', 'api', '', { dash: true, o: 0 }], ['arr', 'w2', 't2', 'api', '', { dash: true, o: 0 }], ['arr', 'w3', 't3', 'api', '', { dash: true, o: 0 }],
      ['dot', 'rep', 540, 180, '✓', { c: 'ok', o: 0 }]
    ],
    b: [
      { say: 'Each request **waits** 2 seconds for the payment API, and holds its thread the whole time.', show: ['w1', 'w2', 'w3', 'q0', 'q1', 'q2', 'q3'], t1: { sub: 'blocked', c: 'bad' }, t2: { sub: 'blocked', c: 'bad' }, t3: { sub: 'blocked', c: 'bad' } },
      { say: '`await` gives the thread back while the call is in flight. It serves the next request.', t1: { sub: 'free', c: 'ok' }, t2: { sub: 'free', c: 'ok' }, t3: { sub: 'free', c: 'ok' }, go: [['q0', 't1'], ['q1', 't2'], ['q2', 't3']] },
      { say: 'When the reply arrives, the rest of the method continues on whichever thread is free.', go: [['rep', 't2']], hide: ['q0', 'q1', 'q2'] },
      { pro: true, say: 'Calling `.Result` blocks a thread again. Under load the pool runs dry: **thread-pool starvation**. The compiler turns each async method into a **state machine**.', t1: { sub: '.Result: blocked', c: 'bad' }, pulse: ['t1'] }
    ],
    key: 'await frees the thread while you wait for I/O.'
  });

  S.scene({
    id: 'modern-csharp', part: 'p2', title: 'Less code, fewer surprises',
    hook: 'A 3 a.m. NullReferenceException, and 300 lines of boilerplate for simple data.',
    a: [
      ['code', 'nul', 175, 85, 'string? note = order.Note;\nint n = note.Length; // ⚠ CS8602'],
      ['code', 'rec', 470, 200, 'record Money(\n  decimal Amount,\n  string Currency);', { o: 0 }],
      ['code', 'sw', 180, 280, 'var fee = order switch {\n  { Total: > 100 } => 0m,\n  _ => 4.99m };', { o: 0 }]
    ],
    b: [
      { say: '**Nullable reference types**: `string?` may be null, and the compiler warns before the code ships.', nul: { hl: 1 } },
      { say: 'A **record** is a data class in one line, with value equality, `ToString` and `with` copies.', show: ['rec'], nul: { hl: -1 } },
      { say: '**Pattern matching** tests the shape and values of data in one expression.', show: ['sw'], sw: { hl: 1 } },
      { pro: true, say: 'Also: primary constructors, `required` members, collection expressions like `[1, 2]`. Less ceremony; the IL is the same.', sw: { hl: -1 }, pulse: ['rec'] }
    ],
    key: 'Modern C# moves bugs from 3 a.m. to compile time.'
  });

  S.scene({
    id: 'advanced-csharp', part: 'p2', title: 'The hot path',
    hook: 'Importing 2 million rows, and the garbage collector can\'t keep up.',
    a: [
      ['box', 'file', 90, 180, 'orders.csv', { sub: '2M rows', w: 130 }],
      ['box', 'gc', 520, 80, 'Garbage collector', { sub: 'busy', w: 170 }],
      ...[0, 1, 2, 3, 4].map(i => ['pill', 'g' + i, 300 + (i % 3) * 95, 150 + Math.floor(i / 3) * 45, 'string', { c: 'bad', o: 0, w: 70 }]),
      ['pill', 'span', 300, 180, 'Span<char>: a window, no copy', { c: 'ok', o: 0 }],
      ['pill', 'pool', 300, 260, 'ArrayPool: borrow and return', { c: 'ok', o: 0 }],
      ['pill', 'gen', 300, 330, 'Source generators, ref returns, interop', { c: 'why', o: 0 }]
    ],
    b: [
      { say: 'Every `Substring` and `Split` allocates a new string. Millions of them.', show: ['g0', 'g1', 'g2', 'g3', 'g4'], gc: { c: 'bad', sub: 'overloaded' }, pulse: ['gc'] },
      { say: '`Span<T>` is a window onto memory that already exists. Slice it without copying.', hide: ['g0', 'g1', 'g2', 'g3', 'g4'], show: ['span'], gc: { c: 'ok', sub: 'calm' } },
      { say: '`ArrayPool` lends out buffers and takes them back, instead of allocating new ones.', show: ['pool'] },
      { pro: true, say: 'The rest of the toolbox: source generators instead of reflection, `ref` returns, expression trees and native interop.', show: ['gen'], pulse: ['gen'] }
    ],
    key: 'On hot paths, allocate less and copy less.'
  });
})(window.STORY);
