// Explanations for Parts V-VII (data, architecture, testing).
(S => {
  S.explain('relational-fundamentals', {
    base: [
      'A **database** stores data so it survives restarts and can be searched quickly. A **relational** database (SQL Server, PostgreSQL) stores data in **tables**: rows and columns, like a spreadsheet with strict rules.',
      '**SQL** is the language for asking a relational database questions and changing its data: `SELECT * FROM Orders WHERE Id = 42`.',
      'A **primary key** uniquely identifies each row. A **foreign key** is a column that points at another table\'s primary key, linking rows together.',
      'Many users read and write at the same time, so the database must stop their changes from corrupting each other.'
    ],
    beats: [
      '`Customers` has one row per customer; `Orders` has one row per order. Each order has a `CustomerId` column holding its customer\'s key. That link, a **foreign key**, lets you join the two tables ("orders with their customer names"), and the database can refuse an order for a customer who doesn\'t exist.',
      'To find the customer with email `ana@x.com`, a database without an index must read every row and compare: a **table scan**. With 5 million customers, that\'s slow, and it gets slower as the table grows.',
      'An **index** is a separate, sorted structure (usually a B-tree) of one or more columns, each entry pointing to its row. Like an index at the back of a book, the database can jump to the right place in a few steps, even among millions of rows. The cost: every insert or update must also update the index, so index what you search on, not everything.',
      'Placing an order means: insert the order, insert its lines, reduce stock. If the server crashes after the first step, the data is inconsistent. A **transaction** groups the steps: either all of them are saved (**commit**) or none are (**rollback**). Committed changes survive crashes.',
      'While one transaction runs, others may read the same rows. **Isolation levels** decide what they can see: stricter levels prevent more anomalies but make transactions wait for each other. Azure SQL\'s default, read-committed snapshot, lets readers see the last committed version of a row while a writer is changing it, so reads and writes don\'t block each other.'
    ]
  });

  S.explain('ado-dapper', {
    base: [
      'Your C# code talks to the database through a **connection**: an open network link to the database server.',
      '**ADO.NET** is .NET\'s low-level database API: open a connection, run a command (some SQL), and read the result rows one by one.',
      '**Dapper** is a small library on top of ADO.NET that does the boring part, turning rows into C# objects.',
      '**SQL injection** is an attack where user input is treated as part of the SQL itself, letting an attacker run their own commands.'
    ],
    beats: [
      'Every .NET data tool, including EF Core, ends up using ADO.NET: a `DbConnection` to the server, a `DbCommand` holding the SQL, and a `DbDataReader` to walk through the result rows. Using it directly gives full control, at the cost of a lot of code.',
      'With Dapper, `conn.QueryAsync<Order>("SELECT * FROM Orders WHERE Email = @email", new { email })` runs the SQL and creates an `Order` per row, matching columns to properties by name. You write exactly the SQL you want, which is ideal for hand-tuned reports.',
      'Never build SQL by pasting in user input: `"... WHERE Name = \'" + name + "\'"`. Input like `\'; DROP TABLE Orders; --` would become part of the command. With **parameters** (`@email` plus a value), the database receives the SQL and the values separately, so input is always treated as data, never as SQL.',
      'Opening a database connection is slow, so .NET keeps a **pool** of open connections. "Closing" one really returns it to the pool for the next request. Open it as late as possible and close it (`using`) as early as possible. A connection that\'s never closed is never returned; when the pool (100 by default) is empty, every request waits.'
    ]
  });

  S.explain('efcore-fundamentals', {
    base: [
      'An **ORM** (object-relational mapper) translates between C# objects and database tables, so you work with objects and it writes the SQL.',
      '**EF Core** (Entity Framework Core) is .NET\'s main ORM. An **entity** is a class that maps to a table, such as `Order` → `Orders`.',
      'A **DbContext** is your session with the database: it runs queries and remembers which loaded objects you changed.',
      'The **schema** is the database\'s structure: tables, columns, keys, indexes.'
    ],
    beats: [
      'You describe entities as normal classes, and EF Core works out the tables, columns and relationships, with conventions you can override. A `DbContext` exposes tables as properties like `db.Orders`. Each request gets its own DbContext, which acts as one **unit of work**: load, change, save.',
      '`var order = await db.Orders.FindAsync(42);` loads the row as an `Order` object. The **change tracker** keeps a snapshot of its original values. When you call `order.Pay()`, nothing is sent to the database yet; EF simply notices the difference later.',
      '`SaveChangesAsync()` compares every tracked object with its snapshot, generates `INSERT`, `UPDATE` and `DELETE` statements only for what changed, and runs them all in one transaction. Either all changes are saved or none.',
      'When you add a property to an entity, the database needs a matching column. A **migration** is generated code describing that schema change (`dotnet ef migrations add AddDeliveryDate`), kept in source control and applied in order to every database, so the schema evolves together with the code.',
      'A DbContext must not be used by two threads at once, which is why it\'s registered as scoped: one per request. In production, apply migrations as reviewed SQL scripts or migration bundles in the deploy pipeline, not automatically at app startup. During a deploy old and new code run together, so never remove a column the old code still reads.'
    ]
  });

  S.explain('efcore-querying', {
    base: [
      'Each **query** is a round trip: the app sends SQL over the network, the database runs it, and the results come back. Even fast queries cost a few milliseconds each.',
      'A **navigation property** is a property that links to a related entity, like `order.Customer`.',
      '**Lazy loading** means a navigation property is loaded automatically the first time you use it, which quietly runs a query.'
    ],
    beats: [
      'The order list page loads 100 orders: `SELECT ... FROM Orders`. One query, quick.',
      'The page then shows each order\'s customer name: `order.Customer.Name`. With lazy loading, each first access runs another query to fetch that customer. 100 orders = 100 more queries: **N+1**. Each is fast on its own, but together the page takes seconds, and it gets worse as data grows.',
      'Tell EF Core what you need up front: `db.Orders.Select(o => new { o.Id, o.Total, CustomerName = o.Customer.Name })`. EF translates the whole thing into one SQL query with a JOIN, returning just those three columns. One round trip, and less data.',
      'For read-only screens, `AsNoTracking()` skips the change tracker\'s snapshots, saving memory and time. `Include` loads related data as whole entities, but including several collections at once multiplies rows (each order × each line × each payment), a **cartesian explosion**. `AsSplitQuery()` fetches each collection with its own query instead.'
    ]
  });

  S.explain('efcore-advanced', {
    base: [
      '**Concurrency** means several things happening at once. Two people can load the same order, edit it, and save.',
      'Without protection, the last save silently overwrites the first: a **lost update**.',
      'One fix is **locking**: making others wait while you edit. It works, but it slows everyone down and locks can be held for too long. The usual alternative is a version check.'
    ],
    beats: [
      'The order row has a **version** column, a number the database changes on every update (a `rowversion` in SQL Server, or a token EF manages). Ana and Ben both load order 42 at version 7. Ana saves first, and the version becomes 8.',
      'EF Core sends Ben\'s update as `UPDATE Orders SET ... WHERE Id = 42 AND Version = 7`. The version is now 8, so no row matches and zero rows are updated. EF notices and throws `DbUpdateConcurrencyException` instead of silently overwriting Ana\'s change. Ben\'s app can reload and show him what changed.',
      'This is **optimistic concurrency**: assume conflicts are rare, take no locks, and check at save time whether someone else got there first. It scales well because nobody waits; the rare loser retries.',
      'More tools: a **global query filter** automatically adds a condition to every query for an entity, such as `WHERE TenantId = @current` in a multi-customer app or `WHERE IsDeleted = 0` for soft deletes, so nobody can forget it. `ExecuteUpdateAsync` updates thousands of rows with one SQL statement, without loading them into memory first.'
    ]
  });

  S.explain('nosql-redis', {
    base: [
      '**NoSQL** covers databases that don\'t use relational tables. A **document database** (Cosmos DB, MongoDB) stores records as JSON documents. A **key-value store** (Redis) stores values under keys.',
      'They give up some relational features, like joins and transactions across many records, in return for easy scaling and fast access by key.',
      'In a **distributed** database, data is spread across many servers. **Partitioning** decides which server holds which data.'
    ],
    beats: [
      'A shopping cart is always read and written as a whole, by one key (the customer). Spreading it over Carts and CartItems tables means joins for no benefit. A document database stores the cart as one JSON document, read and written in a single operation.',
      'Each document has a **partition key**, such as `customerId`. The database hashes it to decide which partition, and which server, stores the document. Reading by partition key goes straight to one place: fast and cheap. A query across all partitions has to ask every server, which is slow and expensive.',
      '**Redis** keeps all its data in memory, so reads take microseconds. It\'s used for caching, user sessions, counters, rate limits and locks. Because memory is limited and can be lost, it usually holds copies or short-lived data, not the only copy of important records.',
      'If the network splits a distributed database into parts that can\'t talk, each part must choose: refuse requests to stay correct (**consistency**) or keep answering with possibly stale data (**availability**). This is the CAP theorem. And because all data is spread out by partition key, changing it later means moving every document. Choose it from your most common query.'
    ]
  });

  S.explain('design-principles', {
    base: [
      'Code is read and changed far more often than it\'s written. **Design principles** are rules of thumb for keeping it easy and safe to change.',
      '**Coupling** is how much one part depends on another\'s details; low coupling means you can change one without breaking the other. **Cohesion** is how closely the things inside one part belong together.',
      '**SOLID** is five principles; three matter most day to day and appear in this scene.'
    ],
    beats: [
      'One 900-line `OrderService` handles payment, emails, invoice PDFs and tax. Adding Apple Pay means editing it, and any mistake can break emails or invoices, which have nothing to do with payments. Every change is risky, and two developers can\'t work on it at once.',
      '**Single responsibility**: each class should have one reason to change. Split it into `PaymentProcessor`, `EmailSender` and `InvoiceRenderer`. A change to emails now touches only the email class.',
      '**Dependency inversion**: the order code depends on an `IPayment` interface, not on the Stripe class directly. The concrete provider is plugged in from outside (with dependency injection), so checkout doesn\'t change when the provider does, and tests can use a fake.',
      '**Open/closed**: code should be open to extension but closed to modification. Apple Pay becomes a new class implementing `IPayment`. The existing, tested classes stay untouched.',
      'These principles serve one goal: parts that are internally focused and loosely connected. Apply them where code actually changes. An interface with one implementation that will never have a second only adds indirection. "YAGNI" (you aren\'t gonna need it) applies to abstractions too.'
    ]
  });

  S.explain('design-patterns', {
    base: [
      'A **design pattern** is a named, well-known solution to a problem that keeps coming up in software design.',
      'Their main value is vocabulary: saying "use a decorator" communicates a whole design, with its costs, in two words.',
      'You don\'t need to memorise all of them. Recognise the common ones, and notice them in .NET itself.'
    ],
    beats: [
      '**Strategy**: put each variant of an algorithm in its own class behind a common interface, and choose one at run time. Kettle\'s pricing rules (weekday, sale) each implement one pricing interface, and checkout uses whichever applies today. New rules don\'t change checkout.',
      '**Decorator**: a class implements the same interface as the one it wraps, adds behaviour, and passes calls through. `CachingCatalog` wraps the real `CatalogService`: it checks a cache first and only calls the real service on a miss. Neither the caller nor the original class changes.',
      '**Observer**: objects subscribe to be told when something happens; C# events are this pattern. **State**: an object\'s behaviour depends on its current state (draft, paid, shipped), with each state as its own class or clear transitions. **Factory**: one place decides how to create objects, hiding the details from callers.',
      'Patterns have costs (more classes, more indirection), so use them where the problem really exists. You already use several: ASP.NET Core middleware is **Chain of Responsibility** (each step handles or passes on), and DI makes decorators easy for adding logging, caching or retries around existing services.'
    ]
  });

  S.explain('app-architectures', {
    base: [
      '**Architecture** here means how a codebase is divided into parts, and which parts are allowed to depend on which.',
      'The **domain** is the core business logic: what an order is, how prices are calculated. **Infrastructure** is the technical detail: databases, email, external APIs.',
      'Good architecture keeps business rules from being tangled up with technical details, so each can change without breaking the other.'
    ],
    beats: [
      '**Layered architecture** separates code by technical role: web (endpoints), application (use cases), domain (business rules), data (database access). Each layer only calls the one below. It\'s simple and familiar, but the domain often ends up depending on the database layer.',
      '**Clean Architecture** (also called onion or hexagonal) reverses that: every dependency points **inward**, toward the domain. The domain defines interfaces it needs, like `IOrderRepository`; infrastructure implements them. Business rules can then be tested without a database, and swapping the database doesn\'t touch them.',
      '**Vertical slices** organise by feature instead of by layer: everything for "place order" (endpoint, validation, handler, data access) sits together in one folder. A change to one feature touches one place, not five layers.',
      'A **modular monolith** is one deployable app divided into modules (catalogue, ordering, billing) with clear boundaries, each owning its data and talking through defined interfaces. You get most of the benefits of separation without the cost of network calls. Choose the structure that matches how your code actually changes.'
    ]
  });

  S.explain('cqrs-mediator-result', {
    base: [
      'Code that **changes** data (commands: place an order, cancel it) has different needs from code that **reads** it (queries: the order history page). Commands need rules and consistency; queries need speed and the right shape.',
      'A **handler** is a class that handles one kind of request.',
      'Some failures are expected, like "out of stock" or "card declined". They\'re normal outcomes, not crashes.'
    ],
    beats: [
      '**CQRS** (command query responsibility segregation) separates the two. A command like `PlaceOrder` goes through the domain model and its rules. A query like `GetOrder` can skip the domain model and read exactly the columns the screen needs, often with simple SQL. Each side is optimised for its own job.',
      'A **mediator** (MediatR is a popular library) receives a message such as `PlaceOrder` and calls the one handler for it. Shared steps (validation, logging, transactions) run as **pipeline behaviours** around every handler, written once instead of in each handler.',
      'Instead of throwing an exception for "out of stock", the handler returns a **Result**: success with a value, or failure with an error. The caller must check it, the outcome is visible in the method signature, and it avoids the cost of exceptions for normal events.',
      'In the full form, writes go to one store and a separate read model is updated afterwards. Reads then lag slightly behind writes (**eventual consistency**), which the UI must handle. It adds complexity, so use it where reads and writes really differ a lot, not for simple CRUD screens.'
    ]
  });

  S.explain('ddd', {
    base: [
      '**Domain-driven design** (DDD) is an approach to modelling complex business logic by working closely with the people who know the business, and using their language in the code.',
      'The same word can mean different things in different parts of a business. To sales, a "product" has a price and photos; to the warehouse, it has a weight and a shelf location.',
      'An **invariant** is a business rule that must always hold, such as "an order\'s total equals the sum of its lines".'
    ],
    beats: [
      'A **bounded context** is a boundary inside which each word has exactly one meaning. The catalogue context\'s `Product` and the warehouse context\'s `Product` are different models, each holding only what that context needs. Trying to make one model serve everyone produces a huge class that satisfies nobody.',
      'An **aggregate** is a cluster of objects that must stay consistent together, such as an order and its lines. Outside code can only change it through its **root** (the `Order`), which enforces every rule, so the aggregate is never left in an invalid state.',
      'Contexts don\'t reach into each other\'s tables. When something happens, a context publishes a **domain event** ("OrderPlaced"), and other contexts react: the warehouse reserves stock, billing creates an invoice. Each context stays independent.',
      'Two rules make this hold: change only **one aggregate per transaction**, and refer to other aggregates by **ID**, not by holding the object. Consistency between aggregates then comes through events. Those same rules are what let a bounded context later become its own service without a rewrite.'
    ]
  });

  S.explain('microservices', {
    base: [
      'A **monolith** is one application, built and deployed as one unit. **Microservices** split a system into several small applications, each deployed separately.',
      'A **deployment** is releasing a new version to production.',
      'Splitting has real costs: calls between services go over the network, which is slower and can fail, and data is spread across several databases.'
    ],
    beats: [
      'One codebase, one deploy, one database is simple to build, test and run. Problems appear as the organisation grows: three teams must coordinate every release, and the catalogue needs 20 times more capacity than billing on Black Friday, but you can only scale the whole app together.',
      'With microservices, each service (catalogue, ordering, billing) is owned by one team, has **its own database** that nobody else touches, and deploys on its own schedule. Each can scale independently and even use different technology.',
      'Clients shouldn\'t have to know about a dozen services. An **API gateway** is one entry point that routes each request to the right service and handles shared concerns like authentication and rate limits.',
      'Done badly, you get the costs of both. Services that share a database, or must all be deployed together, or call each other in long synchronous chains, form a **distributed monolith**: one system that\'s simply harder to run. Split gradually with the **strangler fig**: move one capability at a time out of the monolith, behind the gateway, until the old code can be removed.'
    ]
  });

  S.explain('unit-testing', {
    base: [
      'A **test** is code that runs other code and checks the result automatically, so you know the code still works after every change.',
      'A **unit test** checks one small piece of logic, such as a pricing rule, in isolation, without a database or network. It runs in milliseconds.',
      'A **regression** is a bug in something that used to work, often caused by a change somewhere else.'
    ],
    beats: [
      'Each test has three parts. **Arrange**: set up the situation, such as an order totalling £45. **Act**: run the behaviour, calculating shipping. **Assert**: check the result, shipping is £0 because orders over £40 ship free. If someone later breaks free shipping, this test fails.',
      'Some things make tests slow or unpredictable: the current time, random numbers, a real payment gateway. Replace them with **fakes** (also called test doubles): a clock that always says 14:00, a payment client that always approves. Pass them in through interfaces, which is one reason dependency injection matters.',
      'Because unit tests touch no database or network, hundreds run in a couple of seconds, on every save and in CI on every change. That fast feedback is what would have caught the free-shipping bug the moment it was introduced, not a week later.',
      'Test what the code **does**, through its public behaviour, not how it does it internally. Tests tied to internal details break on every refactor, so people stop refactoring. **Mutation testing** deliberately introduces small bugs into your code and checks whether any test fails; if none does, your tests wouldn\'t catch that kind of bug.'
    ]
  });

  S.explain('integration-testing', {
    base: [
      'Unit tests check pieces in isolation. But bugs also live where pieces connect: middleware order, DI registrations, routes, JSON shape, real database queries.',
      'An **integration test** runs several real parts together, ideally the whole app with a real database, and checks they work as a whole.',
      'A **container** (via Docker) can start a real database in seconds and throw it away afterwards.'
    ],
    beats: [
      '`WebApplicationFactory` starts the whole ASP.NET Core app in memory, with real `Program.cs`, middleware, DI and routing, and gives you an `HttpClient` connected to it. Tests send real HTTP requests and check real responses. A wrong middleware order that returns 401 for everyone fails here immediately.',
      '**Testcontainers** starts a real database (SQL Server, Postgres) in a Docker container for the tests. An in-memory fake database behaves differently (no real SQL, constraints or transactions), so tests could pass while production fails. A real one tests what actually runs.',
      'Each test should start from a known state, regardless of which tests ran before. Reset the data between tests (for example with a tool like Respawn that quickly empties tables), so tests can run in any order and a failure points at one real problem.',
      'Replace only things you don\'t control or can\'t use in tests: the real payment provider, the email service, the clock. Keep your own code and database real. If you fake your own repositories too, you\'re back to a unit test and you lose what made this test valuable.'
    ]
  });
})(window.STORY);
