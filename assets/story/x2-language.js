// Explanations for Part II (the C# language).
(S => {
  S.explain('csharp-story', {
    base: [
      '**C#** is the programming language used throughout this book. It\'s **statically typed**: every variable has a type (number, text, order...) that the compiler checks before the program runs, so many mistakes are caught early.',
      'C# is **object-oriented**: code is organised into **classes**, each bundling some data with the code that works on it.',
      'Part II follows Kettle, a small online tea shop, as its code grows. Each scene starts from a real bug and shows the language feature that fixes it.'
    ],
    beats: [
      'Kettle starts as a tiny program. Each time the shop grows (more orders, more developers, more features), a new kind of problem shows up that the simple code can\'t handle.',
      'Language features exist because of problems like these. Learning "what a struct is" is hard to remember; learning "the bug where editing a copy changed the original, and the feature that prevents it" sticks.',
      'The episodes go roughly from basic (how values are stored) to advanced (squeezing performance out of hot code). Each one only assumes the ones before it.'
    ]
  });

  S.explain('type-system', {
    base: [
      'A **variable** is a named slot that holds a value, like `var price = 5;`.',
      'Your program uses two areas of memory. The **stack** holds the local variables of the method that\'s running; it\'s small and very fast. The **heap** is a large area for objects that can outlive a method call.',
      'A **class** defines a type of object. When you create one with `new`, the object goes on the heap and your variable holds only a **reference**: in effect its address, an arrow pointing at it.',
      'A **struct** is a type whose variable holds the value itself, not an arrow. Numbers like `int` and `decimal` are structs. This difference, **reference type** vs **value type**, explains a whole family of bugs.'
    ],
    beats: [
      '`var a = new Basket();` creates one basket object on the heap. The variable `a` doesn\'t contain the basket; it contains a reference to where the basket lives.',
      '`var b = a;` copies what\'s in `a`, and what\'s in `a` is a reference. So `b` now holds a second arrow to the **same** basket. There is still only one basket.',
      'Calling `b.Add(tea)` follows the arrow to that one basket and changes it. Reading through `a` follows its arrow to the same basket, so `a` "changed" too. Kettle wanted a saved copy, but saved a second arrow. To really copy, you must create a new object, for example with a record\'s `with` expression.',
      '`Money` is a struct, so the variable holds the whole value. `var m2 = m1;` copies every field into `m2`. Changing `m2` can\'t affect `m1`: they\'re independent. That\'s why small, value-like things (money, coordinates, dates) are good structs.',
      'Some code only accepts `object`, which is a reference type. To store a struct there, .NET **boxes** it: copies it into a new object on the heap and hands over an arrow. Each box is extra memory the garbage collector must later clean up. Done millions of times in a loop, it slows the program down. Generics, covered later, avoid it.'
    ]
  });

  S.explain('everyday-types', {
    base: [
      'Computers store numbers in **binary** (base 2). Some ordinary decimal numbers, such as 0.1, have no exact binary form, just as 1/3 has no exact decimal form (0.333...).',
      '`double` is a fast binary number type for science and graphics. `decimal` stores numbers in base 10, so 0.1 is exact. It\'s slower, but money needs exactness.',
      '**UTC** is the world\'s reference time, with no time zones or daylight saving. Local time depends on where the computer is.',
      'A **GUID** (or UUID) is a 128-bit random-looking ID that can be generated anywhere without asking a database. A database **index** keeps rows in key order so they can be found quickly.'
    ],
    beats: [
      'Adding 0.1 + 0.2 as `double` gives 0.30000000000000004, because both numbers were stored slightly inaccurately. Over thousands of orders these tiny errors become missing pennies. `decimal` stores 0.1 exactly, so money adds up. Rule: money is always `decimal`.',
      'What is 2.5 rounded to a whole number? School says 3. .NET\'s default, `Math.Round(2.5)`, says 2, because it rounds halves to the nearest **even** number ("banker\'s rounding"), which avoids always pushing totals up. Neither is wrong, so always say which you mean: `MidpointRounding.AwayFromZero` for the school rule.',
      'A `DateTime` may be UTC, local, or unspecified, and comparing two of them ignores that difference. "09:00 local" and "09:00 UTC" look equal but are hours apart. Store moments in time as UTC, or as `DateTimeOffset`, which keeps the offset from UTC alongside the time, and convert to local only to display.',
      'Random GUIDs are spread evenly across all possible values, so each new row lands at a random spot in the index. The database keeps splitting pages to make room, which is slow. **Version 7** GUIDs start with a timestamp, so new ones sort after old ones and inserts go to the end. SQL Server compares GUIDs using a different byte order, so there you need a different approach.'
    ]
  });

  S.explain('operators-expressions', {
    base: [
      'An **operator** is a symbol that does something with values: `+` adds, `==` compares, `&&` means "and".',
      'An **expression** is anything that produces a value, such as `price * 2` or `isPaid && inStock`.',
      '`null` means "no object here". Using a null reference as if it were an object, such as `customer.Name` when `customer` is null, crashes with a **NullReferenceException**.',
      'Some things happen at **compile time** (checked by the compiler before the program runs), others at **run time** (while it runs). Knowing which is which explains many surprises.'
    ],
    beats: [
      '`a && b` is true only if both are true. If `a` is false, the answer is already known, so C# never evaluates `b`. This is **short-circuiting**. Put the cheap check first, `inStock && await CheckFraudAsync()`, and the expensive call is skipped whenever it isn\'t needed. It also guards: `customer != null && customer.IsVip` never crashes.',
      '`customer?.Address` means: if `customer` is null, the whole expression is null instead of crashing. `??` supplies a fallback: `customer?.Name ?? "Guest"` gives "Guest" when either is missing. Together they handle "might be missing" without a crash.',
      'With nullable checking on, the compiler warns when something might be null. Writing `customer!.Name` tells it "I know this isn\'t null, stop warning". But `!` adds no check at all. If you were wrong, it still crashes at run time, just without the warning that would have caught it.',
      'You can name tuple items, `(int Count, decimal Total)`, but the names exist only for the compiler. At run time it\'s a `ValueTuple` with fields `Item1` and `Item2`, so the names disappear in JSON or reflection. For data that leaves a method, a `record` keeps real names.'
    ]
  });

  S.explain('oop', {
    base: [
      'A **class** bundles data (**fields** and **properties**) with the code that uses it (**methods**). An **object** is one instance of a class, such as one particular order.',
      '`public` members can be used by any code. `private` members can only be used inside the class itself.',
      'An **invariant** is a rule that must always be true, such as "quantity is at least 1" or "an order can\'t be shipped before it\'s paid".',
      'An **interface** is a contract: a list of methods a class promises to have, with no code of its own.'
    ],
    beats: [
      'When `Quantity` and `Status` are public fields, any line anywhere can write anything into them: −3 teas, "Shipped" before payment. Nothing in between can say no, and the bad data reaches the database.',
      '**Encapsulation** makes the data private and lets changes happen only through methods that check the rules: `order.Pay()`, `order.Ship()`. `Ship()` refuses if the order isn\'t paid. The bad line from before is now a compile error. The rules live in one place instead of being repeated, or forgotten, in every caller.',
      '`IPayment` says "anything that can `Charge(amount)`". Card, PayPal and gift-card classes each implement it in their own way. Checkout only knows about `IPayment`, so a new payment method needs no change to checkout. This also makes testing easy: give checkout a fake payment.',
      'When code calls a method through an interface, which class\'s version runs is decided while the program runs, based on the actual object: **dynamic dispatch**. **Inheritance** (a class extending another) reuses code but couples them tightly, and deep trees get fragile. **Composition**, building an object from smaller parts it holds, is usually easier to change.'
    ]
  });

  S.explain('generics', {
    base: [
      'Often the same logic works for many types: a cache, a list, a "find by ID" method. Writing it once per type means copying code, and copied code gets fixed in one place and forgotten in the others.',
      'A **generic** type has a type parameter, usually called `T`, that\'s filled in when it\'s used: `Cache<Order>`, `Cache<Customer>`.',
      'A **cast** converts a value to a type, like `(Order)item`. If it\'s wrong, the program crashes at run time. Generics remove the need for most casts.'
    ],
    beats: [
      'Three caches, identical except for the type they store. A bug fixed in one is still in the other two, and a fourth type means a fourth copy.',
      '`class Cache<T>` is written once. Inside, `T` stands for "whatever type the user picks". Methods use `T` like any other type: `T Get(string key)`, `void Set(string key, T value)`.',
      '`new Cache<Order>()` makes a cache where `T` means `Order`. Putting a `Customer` into it is a compile error, and `Get` returns an `Order` directly, with no cast. The older alternative, storing everything as `object`, needed casts everywhere and failed only at run time.',
      'Inside `Cache<T>` you can only do what works for every possible `T`. A **constraint** narrows it: `where T : IEntity` means T must have an `Id`, so the cache can use `item.Id`. `where T : class` or `where T : struct` limit it to reference or value types.',
      'In .NET, generic types still exist while the program runs (unlike in Java). For value types like `int`, the JIT compiles a separate, specialised version: `List<int>` really stores ints, with no boxing. Reference types share one compiled version, because all references are the same size.'
    ]
  });

  S.explain('delegates-events', {
    base: [
      'Normally a variable holds data: a number, a string, an object. A **delegate** is a variable that holds a **method**, so you can pass behaviour around like data.',
      '`Func<Order, decimal>` is a ready-made delegate type: "a method that takes an Order and returns a decimal". `Action<T>` is the same for methods that return nothing.',
      'A **lambda** is a short way to write a small method inline: `order => order.Total * 0.9m` means "given an order, return 90% of its total".',
      'An **event** is a way for one object to announce "something happened" to any number of others that asked to be told.'
    ],
    beats: [
      'The discount calculation is written directly inside checkout. Every weekly promotion means editing, retesting and redeploying checkout, the most important code in the shop, for a change that has nothing to do with checking out.',
      'Instead, checkout accepts the rule as a parameter: `Func<Order, decimal> discount`. Checkout calls `discount(order)` without knowing what the rule does. The caller decides by passing in a method or a lambda.',
      'Weekdays: `o => o.Total * 0.10m`. Black Friday: `o => o.Total * 0.30m`. Loyalty members: 5% off. Checkout\'s code doesn\'t change, and each rule can be tested on its own.',
      'An event holds a list of delegates. Other parts of the app subscribe with `+=`: email, loyalty points, analytics. When checkout raises `OrderPlaced`, every subscribed method runs. Checkout doesn\'t need to know who is listening, so new reactions can be added without touching it.',
      'Subscribing stores a reference to the subscriber inside the publisher. If a short-lived object subscribes to a long-lived one and never unsubscribes with `-=`, the publisher keeps it alive forever: a memory leak. Also, a lambda that uses an outside variable **captures the variable itself**, so it sees the variable\'s value when it runs, not when it was created.'
    ]
  });

  S.explain('collections', {
    base: [
      'A **collection** holds many items. Different collections are built for different questions: "in order?", "find by key?", "is it there?", "first in, first out?".',
      '`List<T>` keeps items in order, like a numbered list. `Dictionary<TKey, TValue>` stores pairs, such as order number → order, for fast lookup by key.',
      'Speed is described by how the work grows with the number of items: **O(n)** means double the items, double the time. **O(1)** means roughly the same time however many items there are.'
    ],
    beats: [
      'To find order 184,302 in a `List`, the program checks each order from the start until it finds a match. With 200,000 orders that\'s up to 200,000 comparisons, and with twice the orders it takes twice as long (O(n)). Do that per request and the site slows to a crawl.',
      'A `Dictionary` runs the key through a **hash function**, which turns it into a number. That number picks a **bucket**, a slot in an internal array, so the dictionary jumps straight to the right place and checks the one or two items there. The time stays about the same with 200 or 200 million items (O(1)).',
      'Pick by your most common question. Ordered, accessed by position: `List`. Find by key: `Dictionary`. "Have I seen this?": `HashSet`. Process in arrival order: `Queue`. Always sorted: `SortedDictionary`. The wrong choice works in testing and fails at real volume.',
      'Inside, a `List` is an array with spare room. When it fills up, it allocates an array twice as big and copies every item across. Creating it with an expected size (`new List<Order>(200_000)`) avoids repeated copying. A `FrozenDictionary` is built once and optimised purely for fast reading: ideal for data like a price list that never changes after startup.'
    ]
  });

  S.explain('linq', {
    base: [
      '**LINQ** (Language Integrated Query) is a set of methods for asking questions of collections: filter, sort, group, total. You describe the result instead of writing the loops yourself.',
      'Each LINQ method takes a lambda: `.Where(o => o.Paid)` keeps paid orders, `.Select(o => o.Total)` picks out each total.',
      'The methods chain into a **pipeline**: items flow through each stage in turn, like an assembly line.'
    ],
    beats: [
      'Instead of nested loops with `if` statements and temporary lists, you write `orders.Where(o => o.Paid).OrderByDescending(o => o.Total).Take(5)`. Each method is one clear stage: filter, sort, keep the top five. The code reads like the report the owner asked for.',
      'Writing the query doesn\'t run it. The variable holds a description of the pipeline: **deferred execution**. That\'s useful (you can add stages later) and surprising (if the data changes before you run it, you get the new data, and running it twice does the work twice).',
      'The query runs when something asks for results: a `foreach`, `ToList()`, `Count()` or `Sum()`. Items are then pulled through one at a time. An unpaid order reaches `Where`, fails the test and goes no further, so the later stages never see it.',
      'When the source is an EF Core database table, the same code builds an `IQueryable`. The lambdas are stored as **expression trees**, data describing the code, and EF Core translates them into SQL that runs inside the database. Only the matching rows travel back. That\'s why some C# methods can\'t be used in such queries: they can\'t be translated to SQL.'
    ]
  });

  S.explain('exceptions-disposal', {
    base: [
      'An **exception** is how .NET reports that something went wrong and the current work can\'t continue: the network failed, a file is missing, an argument is invalid.',
      '`throw` raises an exception. `try { ... } catch (SomeException ex) { ... }` runs code and handles that type of exception if it happens.',
      'The **call stack** is the chain of methods currently running: Main called Checkout, which called ChargeCard, and so on.',
      'Some objects hold resources outside .NET, like a database connection or an open file. They must be released by calling `Dispose()`, or the resources run out.'
    ],
    beats: [
      'The bank\'s API times out. The payment code can\'t return a sensible result, so it **throws** an exception describing what went wrong. From that moment, normal execution stops.',
      '.NET looks for a matching `catch` in the current method. If there isn\'t one, it leaves that method and tries the caller, then its caller, back down the call stack: **unwinding**. Code after the failing line in each of those methods never runs. If nothing catches it, the request fails with an error.',
      'The method had opened a database connection and planned to close it at the end, but the end never ran. Each failure leaks a connection until the pool is empty. `using var conn = ...` makes the compiler add a hidden `finally` that calls `Dispose()` whether the method finishes normally or throws.',
      '`throw;` rethrows the same exception with its original stack trace, which tells you where it really started. `throw ex;` resets the trace to the current line, hiding the real source. Throwing and catching is also relatively slow, so for expected outcomes ("card declined") return a result object instead.'
    ]
  });

  S.explain('async-await', {
    base: [
      'A **thread** is a worker that runs code. A web server keeps a **thread pool**, a limited group of threads that handle incoming requests.',
      '**I/O** (input/output) means waiting for something outside the CPU: a database, another web API, a disk. During that wait the CPU has nothing to do.',
      'A `Task` represents work that will finish later, like a receipt you can redeem when the result is ready.',
      '`await` means: "wait for this task without blocking the thread, and continue this method when it\'s done".'
    ],
    beats: [
      'Each checkout calls the payment API, which takes 2 seconds. With **blocking** code, the request\'s thread sits idle for those 2 seconds, unable to do anything else. With 200 threads and hundreds of checkouts arriving, every thread is soon waiting and new requests queue up. CPU is at 5% because nobody is computing: everyone is waiting.',
      'With `await httpClient.PostAsync(...)`, the method starts the network call, then **returns its thread to the pool**. The operating system watches the network connection. Meanwhile that same thread serves other requests. Waiting no longer costs a thread.',
      'When the payment reply arrives, the rest of the method is scheduled on the pool and continues from the line after `await`, on whichever thread is free, possibly a different one. Your code reads top to bottom as if it had waited.',
      '`.Result` and `.Wait()` block the thread until the task finishes, undoing the benefit. Under load, all threads end up blocked waiting for work that itself needs a free thread to complete: **thread-pool starvation**, where everything slows to a halt. Behind the scenes, the compiler rewrites each async method into a **state machine** that remembers where it was and resumes there.'
    ]
  });

  S.explain('files-streams-io', {
    base: [
      'A file is just a sequence of **bytes**. Text is bytes interpreted using an **encoding** (such as UTF-8) that maps bytes to characters.',
      'A **stream** reads or writes data a piece at a time, instead of loading everything into memory at once.',
      '**Compression** (like gzip) shrinks data; it must be decompressed before use.',
      'An **atomic** operation happens entirely or not at all: nobody can observe it half-done.'
    ],
    beats: [
      '`File.ReadAllText` loads the entire file into one string. A 2 GB file becomes about 4 GB in memory, because .NET strings use two bytes per character, before any processing starts. The server runs out of memory and the import crashes.',
      'Streams fix it. A `FileStream` reads bytes from disk. A `GZipStream` wrapped around it decompresses them as they arrive. A `StreamReader` around that turns bytes into lines of text. Each layer passes small chunks along, so memory use stays small however big the file is.',
      'If the warehouse reads the export file while Kettle is still writing it, it gets half a file. Instead, write to a temporary file, then **rename** it to the real name. On the same disk, a rename is atomic: readers see either the complete old file or the complete new one.',
      'The pound sign "£" is two bytes in UTF-8. If those bytes are read as a different encoding (Latin-1), each byte becomes its own character and you see "Â£". Always state the encoding when converting between bytes and text, and use UTF-8 unless a partner requires something else.'
    ]
  });

  S.explain('modern-csharp', {
    base: [
      'C# gets a new version roughly every year. Recent versions mostly add features that **remove boilerplate** (repetitive code) and let the compiler catch more mistakes.',
      'The most common crash in older C# code is the **NullReferenceException**: using something that turned out to be null.',
      'A lot of code is plain data classes: an order line, an address, an API request. Writing them the old way needs many lines for constructors, equality and printing.'
    ],
    beats: [
      'With **nullable reference types** turned on, `string` means "never null" and `string?` means "might be null". The compiler tracks this through your code and warns when you use a `string?` without checking it first. The 3 a.m. crash becomes a compile-time warning on your screen.',
      '`record Tea(string Name, decimal Price);` is a full data class in one line. It gives you a constructor, read-only properties, a readable `ToString()`, and **value equality**: two records with the same values are equal, which is what you want for data. `tea with { Price = 4m }` makes a modified copy without changing the original.',
      '`order switch { { Total: > 100 } => 0m, { Country: "FR" } => 5m, _ => 3m }` checks the shape and values of an object in one readable expression. It replaces chains of `if` statements and type checks, and the compiler warns if you missed a case.',
      'Other additions: **primary constructors** put constructor parameters on the class line; `required` forces callers to set a property; collection expressions like `[1, 2, 3]` create lists and arrays. They mostly compile to the same IL as the long version: the benefit is less code to read and fewer places for bugs.'
    ]
  });

  S.explain('advanced-csharp', {
    base: [
      'An **allocation** is creating a new object on the heap. Each one costs a little time, and the **garbage collector** (GC) must later find and free it.',
      'With millions of allocations per second, the GC runs constantly and pauses the program, so code that allocates less often runs much faster.',
      'A **hot path** is code that runs extremely often, such as the inner loop of an import or a function called on every request. Optimising is only worth it there.'
    ],
    beats: [
      'Parsing a CSV line with `Split(\',\')` creates a new string for every field. Two million rows × 10 fields = 20 million short-lived strings. The GC spends more time cleaning up than the import spends importing.',
      '`Span<T>` is a lightweight view onto memory that already exists: a start position and a length. Slicing a span to get one field creates no new string, just a new view of the same characters. You can parse numbers directly from a span. Spans live only on the stack, which is what makes them safe and free.',
      'When you need a temporary buffer, `ArrayPool<T>.Shared.Rent(size)` lends you an existing array, and `Return` gives it back for reuse. The same few arrays are used over and over instead of allocating, and collecting, millions of new ones.',
      'More tools for special cases: **source generators** write code at compile time instead of using slow reflection at run time; `ref` returns hand back a reference into existing data instead of a copy; **expression trees** let code inspect and translate other code (as LINQ to SQL does); **interop** calls native C libraries. Measure first, and use them only where profiling shows a hot path.'
    ]
  });
})(window.STORY);
