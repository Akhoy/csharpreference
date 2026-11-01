// Explanations for Parts XII (performance), XIII (security) and XV (interview).
(S => {
  S.explain('memory-gc', {
    base: [
      'Every object your program creates with `new` takes memory on the **heap**. When nothing refers to it any more, that memory should be reused.',
      'In .NET you don\'t free memory yourself. The **garbage collector** (GC) periodically finds objects that can no longer be reached from your running code and frees them.',
      'An object is **reachable** if there\'s a chain of references to it from something in use: a local variable, a static field, or another reachable object.',
      'While the GC works, your program may be briefly paused, so how often it runs, and how much it scans, affects performance.'
    ],
    beats: [
      'Most objects are short-lived: a string built for one log line, a DTO for one request. So the heap is split into **generations**. New objects go into **Gen 0**, which is small, so collecting it is fast. The GC collects Gen 0 often, and most objects there are already garbage.',
      'A collection marks everything reachable, frees the rest, and compacts what\'s left. Objects that survive are **promoted**: Gen 0 to Gen 1, Gen 1 to Gen 2. Surviving suggests they\'re long-lived, like a cache, so the GC checks them less often.',
      'A **Gen 2** collection examines the whole heap, so it\'s the most expensive and should be rare. Objects of 85,000 bytes or more, such as large arrays, go straight to the **large object heap**, which is only collected with Gen 2 and isn\'t normally compacted. Frequently allocating big buffers is costly; pool them instead.',
      'The GC only frees what\'s **unreachable**, so a .NET memory leak is something you no longer need that\'s still referenced: a static list that only grows, a cache with no size limit, an event handler that was never unsubscribed. `dotnet-gcdump` captures what\'s on the heap, and `gcroot` shows the chain of references keeping an object alive.'
    ]
  });

  S.explain('threading-concurrency', {
    base: [
      'A web server handles many requests at the same time on different **threads**. When two threads use the same data at once, their steps can interleave in unexpected ways.',
      '**Shared state** is data more than one thread can read and write, such as a static counter or a shared dictionary.',
      'A **race condition** is a bug where the result depends on the exact timing of threads. It may appear only under load and be impossible to reproduce on demand.'
    ],
    beats: [
      '`count++` looks like one step, but the CPU does three: **read** the current value, **add** one, **write** it back. Two threads handling two orders both read the counter at the same moment, and both see 5.',
      'Thread A computes 6 and writes 6. Thread B, which also read 5, computes 6 and writes 6. Two orders were counted, but the counter only went up by one. No exception, no log: the number is just quietly wrong. Under heavy load this happens again and again, which is why 1,000 orders show as 994.',
      'Fix it by making the update **atomic**, impossible to interrupt halfway: `Interlocked.Increment(ref count)`. For larger changes, a `lock` lets only one thread at a time run that block. Concurrent collections like `ConcurrentDictionary` do this safely inside.',
      'Locks have their own danger: if thread A holds lock 1 and waits for lock 2, while thread B holds lock 2 and waits for lock 1, both wait forever, a **deadlock**. Always take locks in the same order. And you can\'t `await` inside a `lock` (the code may resume on a different thread); use `SemaphoreSlim` with `WaitAsync` for async code.'
    ]
  });

  S.explain('performance-engineering', {
    base: [
      '**Latency** is how long one request takes. **Throughput** is how many requests the system handles per second.',
      'Intuition about what\'s slow is usually wrong. A **profiler** or **trace** measures where time actually goes.',
      'A **percentile** answers "what did the slowest users experience?": p95 = 300 ms means 95% of requests took 300 ms or less, and 5% took longer.'
    ],
    beats: [
      'Someone spent a day optimising a loop that takes 3 ms. A trace of the slow page shows the request takes 1.8 seconds, and 1.6 of those are one SQL query. The loop was never the problem. Always measure before changing anything.',
      'Fix the largest cost first. A missing index or an N+1 query pattern can cost seconds; micro-optimising C# usually saves microseconds. One database fix here does more than every code tweak combined.',
      'The average response time was 148 ms, which looks fine. But averages hide the slow tail: most requests took 50 ms, while some users waited 5 seconds. **p95** and **p99** show what the slowest 5% and 1% experience, and those are the users who complain or leave.',
      'If the app is slow but CPU use is low, threads are waiting rather than working, often blocked on synchronous calls: **thread-pool starvation**. Start with `dotnet-counters` (live numbers like thread-pool queue length) and `dotnet-trace` (where time goes). Use **BenchmarkDotNet**, a precise micro-benchmarking tool, only on hot code you\'ve already identified this way.'
    ]
  });

  S.explain('web-security', {
    base: [
      'Attackers don\'t use your app the way you intended. They change URLs, edit requests and send unexpected input to see what happens.',
      'The **OWASP Top 10** is a widely used list of the most common and serious web application security risks.',
      'Rule one: **never trust input**. Anything from outside (URLs, forms, headers, JSON, files) can be crafted by an attacker.'
    ],
    beats: [
      '`GET /orders/41` checks that the caller is logged in, then returns order 41. But nothing checks that order 41 belongs to them. Change the number and you can read any customer\'s order. This is **broken access control**, also called IDOR (insecure direct object reference), and it\'s the most common serious web vulnerability.',
      'Every query for user data includes the user: `WHERE Id = @id AND CustomerId = @me`. If nothing matches, return **404 Not Found** rather than 403, so an attacker can\'t even learn which order numbers exist.',
      'If SQL is built by pasting input into a string, input can contain SQL that changes the query: **SQL injection**. With **parameters**, the database receives the query and the values separately, so input can never become code. EF Core and Dapper both parameterise for you.',
      '**XSS** (cross-site scripting) is attacker input containing a script that ends up in your page and runs in other users\' browsers; the defences are encoding all output (Razor does it automatically) and a Content Security Policy. **CSRF** (cross-site request forgery) is a malicious site making a logged-in user\'s browser send a request, because browsers attach cookies automatically; the defences are SameSite cookies and antiforgery tokens.'
    ]
  });

  S.explain('oauth-oidc-identity', {
    base: [
      'Storing passwords yourself means protecting them, resetting them, supporting MFA (multi-factor authentication), detecting attacks... It\'s a lot of risk for a tea shop.',
      'An **identity provider** (IdP) such as Microsoft Entra ID, Auth0 or Google handles sign-in for you.',
      '**OAuth 2.0** is the standard for giving an app limited access to an API, via tokens. **OpenID Connect** (OIDC) adds a standard way to sign users in on top of OAuth.',
      'A **token** is signed data proving something: who the user is (ID token), or what the caller may access (access token).'
    ],
    beats: [
      'When a shopper clicks "Sign in", Kettle redirects the browser to the identity provider\'s login page. The password is typed there, MFA happens there, and Kettle never sees or stores it.',
      'After a successful login, the provider redirects back to Kettle with a short-lived, single-use **authorisation code**. Kettle\'s server exchanges it with the provider for tokens. **PKCE** adds a secret that Kettle generated at the start and only Kettle knows, so a code intercepted on the way back is useless to anyone else.',
      'The **access token** is sent with each API call (`Authorization: Bearer ...`). The API checks the signature, issuer, audience and expiry before trusting any claim inside it. A token that fails any check is rejected with 401.',
      'The **ID token** tells the app who signed in; it\'s not for calling APIs. The **access token** is for APIs, and the app shouldn\'t rely on reading it. For apps running in the browser, tokens there can be stolen by malicious scripts, so a **BFF** (backend for frontend) keeps the tokens on the server and gives the browser only a secure, HTTP-only cookie.'
    ]
  });

  S.explain('system-design', {
    base: [
      'A **system design interview** asks you to design a large system, like a checkout for millions of users, in about 45 minutes, talking through your reasoning.',
      'There\'s no single right answer. Interviewers judge how you clarify the problem, reason about scale and explain trade-offs.',
      'Every building block you need appeared earlier in this storybook: load balancers, caches, databases, queues, services.'
    ],
    beats: [
      'Don\'t start drawing. Ask what the system must do (functional requirements), how fast, how available and how consistent it must be (non-functional requirements), and agree what\'s out of scope. Five minutes here prevents designing the wrong thing.',
      'Do rough numbers: users per day, requests per second at peak, data size per year, the ratio of reads to writes. If reads outnumber writes 100 to 1, caching comes first. If writes are huge, partitioning matters. The numbers justify each choice.',
      'Sketch the high-level design: clients → gateway → services → databases, with a cache for hot reads, a queue for slow work, and a CDN for static content. Walk one request through it so the interviewer can follow.',
      'Go deep on the hardest part, for checkout that\'s correctness: an outbox so events aren\'t lost, idempotency keys so retries don\'t charge twice, a saga with compensation across payment and stock. For every decision, say what you gain and what you give up. Staff-level interviews are judged mostly on that.'
    ]
  });

  S.explain('study-plan-resources', {
    base: [
      'Reading something once creates familiarity, not memory. You remember what you actively retrieve and use.',
      'This storybook is the **breadth** pass: every topic once, so you know where everything fits. The book chapters are the **depth** pass.'
    ],
    beats: [
      'You\'ve now seen every layer, from C# basics to cloud and security, and how they connect. Knowing where a topic sits is what makes later details easy to place and remember.',
      'Now go deep, one part at a time. Each scene\'s "Go deeper" button opens its full chapter, with the details, runnable code and interview questions.',
      'After reading a chapter, close it and explain the main ideas out loud, or write them from memory. It feels harder than rereading, and that effort is exactly what makes it stick (**retrieval practice**). Revisit topics after a few days, then a week.',
      'Finally, build a small version of Kettle yourself: an API, a database, a background job, tests, deployed somewhere real. The bugs you hit and fix become concrete stories. In an interview, "when I implemented the outbox, I found..." beats any memorised definition.'
    ]
  });
})(window.STORY);
