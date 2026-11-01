---
id: everyday-types
title: "Everyday Types: Numbers, Text, Dates and IDs Done Right"
summary: "Kettle's first month of real data, and the small type mistakes that cost real money: a penny lost to floating point, a rounding rule nobody expected, an overflowing counter, two strings that are equal and not equal, opening hours in the wrong time zone, and duplicate order numbers from two servers. Covers every built-in numeric type, float vs double vs decimal, rounding and overflow, string immutability, StringBuilder, interning, == vs Equals, null vs default, is/as/casts, Nullable<T> vs nullable reference types, DateTime vs DateTimeOffset vs DateOnly/TimeOnly and TimeProvider, Guid keys and version 7, and record struct vs record class."
layer: language
where: C# language › The built-in types you use every day
fits: A companion to [Types](ch:type-system), which explained value vs reference. This chapter is the reference for the specific types every backend uses, and the traps in each. Dates and IDs reappear in [EF Core](ch:efcore-fundamentals) and [API design](ch:api-design); numbers reappear in [Performance](ch:performance-engineering).
levels: b,i,a
prereqs: type-system
next: oop
---

## The 30-second version

- **Money is `decimal`**, never `double`. `0.1 + 0.2` isn't `0.3` in binary floating point.
- **`Math.Round(2.5)` is 2.** .NET rounds halves to the nearest **even** number unless you say otherwise.
- Integer arithmetic **wraps silently** on overflow unless you use `checked`.
- Strings are **immutable**. Building one in a loop copies everything each time; use `StringBuilder` or interpolation.
- For strings, `==` compares characters. For `object` variables, `==` compares **references**, so the same text can be "not equal".
- **`DateTime` ignores its `Kind` when comparing.** Store instants as UTC or `DateTimeOffset`, use `DateOnly`/`TimeOnly` for calendar dates and clock times, and inject `TimeProvider` so tests can control time.
- **Random `Guid` keys fragment clustered indexes.** Time-ordered version 7 GUIDs (`Guid.CreateVersion7()`, .NET 9) fix that on most databases, but not on SQL Server, which sorts GUIDs in its own order.
- `int?` is a real struct, `Nullable<int>`. `string?` is only a **compiler annotation**; at run time it's the same `string`.

## Words you'll meet

| Word | In plain words |
|---|---|
| **two's complement** | How CPUs store negative integers. It's why `int.MaxValue + 1` becomes `int.MinValue`. |
| **floating point** | Numbers stored as binary digits times a power of two (`float`, `double`). Fast, but most decimal fractions can't be stored exactly. |
| **banker's rounding** | Rounding halves to the nearest even digit: 2.5 → 2, 3.5 → 4. .NET's default. |
| **immutable** | Can't be changed after creation. Every "change" makes a new object. |
| **interning** | Keeping one shared copy of each distinct string literal. |
| **ordinal comparison** | Comparing strings character code by character code, ignoring language rules. |
| **UTC** | Coordinated Universal Time: one global clock, no time zones, no daylight saving. |
| **offset** | How far a local clock is ahead of or behind UTC at that moment, e.g. +01:00. |
| **GUID / UUID** | A 128-bit identifier that can be generated anywhere without coordination. |

## Previously, and Kettle's first month {b}

In [Episode 1](ch:type-system) Kettle learnt that some types are copied and some are shared. Then Kettle went live, and real data arrived. Within a month, the finance team found a penny missing from a report, a loyalty counter went negative, customers in New York saw the wrong opening hours, and two servers both created order 1042. None of these was a design flaw. Each was a fact about a built-in type that nobody had looked up. This chapter is that look-up, in one place.

## Integers: sizes, ranges and overflow {b}

:::plain
Each integer type is a fixed number of bits, so it has a largest and smallest value. Go past the end and, by default, the number wraps round to the other end without any error.
:::

| Type | Bits | Range | Use it for |
|---|---|---|---|
| `sbyte` / `byte` | 8 | −128…127 / 0…255 | raw bytes (`byte[]`), not counters |
| `short` / `ushort` | 16 | −32,768…32,767 / 0…65,535 | file formats and protocols |
| **`int`** / `uint` | 32 | about ±2.1 billion / 0…4.3 billion | **the default** for counts and indexes |
| **`long`** / `ulong` | 64 | about ±9.2 × 10¹⁸ / 0…1.8 × 10¹⁹ | IDs, timestamps, totals that may pass 2 billion |
| `nint` / `nuint` | 32 or 64 | depends on the process | interop and pointer arithmetic |
| `Int128` / `UInt128` | 128 | about ±1.7 × 10³⁸ | rare: hashes, very large counters (.NET 7) |

Use `int` unless you have a reason not to. Unsigned types look tempting for "can't be negative" values, but they mix badly with the rest of the library (`Count` and `Length` are `int`), and subtracting below zero wraps to a huge number instead of going negative.

**Overflow wraps silently.** Integers are stored in **two's complement**, where the bit pattern after the largest positive value is the most negative one. Adding 1 to `int.MaxValue` gives `int.MinValue`, and C# doesn't complain unless you ask it to:

:::walk A counter that goes negative
```csharp
int points = int.MaxValue;
points++;
Console.WriteLine(points);

try
{
    int safe = int.MaxValue;
    safe = checked(safe + 1);
}
catch (OverflowException)
{
    Console.WriteLine("checked: overflow caught");
}

Console.WriteLine(7 / 2);
Console.WriteLine(-7 / 2);
Console.WriteLine(-7 % 2);
```
@1 | points = 2,147,483,647
The largest value an `int` can hold.
@2 | points = -2,147,483,648
One more wraps round to the smallest value. No exception, no warning: arithmetic is **unchecked** by default, because checking every addition costs a little speed.
@3 | | > -2147483648
Kettle's loyalty counter did exactly this after a bulk import double-counted points.
@7-8 | safe = 2,147,483,647
`checked(...)` turns on overflow checking for this expression.
@10-13 | | > checked: overflow caught
Now overflow throws an `OverflowException` instead of silently producing nonsense.
@15 | | > 3
Integer division **truncates** toward zero: 7 / 2 is 3, not 3.5.
@16 | | > -3
Toward zero, not down: −3.5 becomes −3.
@17 | | > -1
The remainder takes the sign of the left-hand number.
:::

To check everything in a project, set `<CheckForOverflowUnderflow>true</CheckForOverflowUnderflow>`. Many teams turn it on in Debug builds only, so tests catch overflow without slowing production. For money totals and IDs, prefer `long` and keep `checked` arithmetic where a wrap would corrupt data.

**Literals you'll see:** `1_000_000` (underscores are ignored, just for reading), `0xFF` (hex), `0b1010` (binary), and suffixes `L` (long), `U` (unsigned), `m` (decimal), `f` (float), `d` (double).

## float, double and decimal {b}

:::plain
`float` and `double` store numbers in binary, so most decimal fractions like 0.1 are stored slightly wrong. `decimal` stores them in base ten, so money adds up exactly.
:::

| Type | Size | Precision | Base | Speed | Use it for |
|---|---|---|---|---|---|
| `float` | 4 bytes | about 7 digits | binary | fastest | graphics, ML weights, sensor data |
| `double` | 8 bytes | about 15–16 digits | binary | fast, hardware-supported | science, statistics, measurements |
| **`decimal`** | 16 bytes | 28–29 digits | **decimal** | much slower, done in software | **money**, and anything a person checks by hand |

**Why `0.1 + 0.2 != 0.3`.** In binary, 0.1 is a repeating fraction, the way 1/3 is 0.333… in decimal. A `double` has to stop somewhere, so it stores the nearest binary value. 0.1 and 0.2 are each a tiny bit off, and their sum lands on a different nearest value than 0.3 does. `decimal` stores digits in base ten, so 0.1 is exactly 0.1.

:::walk The penny that went missing
```csharp
Console.WriteLine(0.1 + 0.2 == 0.3);
Console.WriteLine(0.1m + 0.2m == 0.3m);

double sum = 0;
for (int i = 0; i < 10; i++) sum += 0.1;
Console.WriteLine(sum == 1.0);
Console.WriteLine(Math.Abs(sum - 1.0) < 1e-9);

Console.WriteLine(double.NaN == double.NaN);
Console.WriteLine(double.IsInfinity(1.0 / 0));
```
@1 | | > False
Two doubles that "should" be equal aren't. This is what lost Kettle its penny: VAT computed in `double`, then rounded.
@2 | | > True
The same sum in `decimal` is exact.
@4-5 | sum = 0.9999999999999999
Adding 0.1 ten times collects ten tiny errors.
@6 | | > False
So never compare doubles with `==`.
@7 | | > True
Compare with a **tolerance** instead: "close enough for this purpose".
@9 | | > False
`NaN` ("not a number", e.g. 0.0 / 0.0) isn't equal to anything, itself included. Check with `double.IsNaN(x)`.
@10 | | > True
Dividing a double by zero gives infinity, not an exception. Dividing an `int` or `decimal` by zero throws `DivideByZeroException`.
:::

**Rule:** money, prices, tax and anything that must add up to the penny is `decimal`. In the database, use a `decimal(19,4)`-style column and configure the precision in EF Core, so values round-trip exactly.

## Rounding and conversions {i}

:::plain
.NET rounds halves to the nearest even number by default, and a cast just chops off the fraction. Say which rounding you mean every time.
:::

:::walk Three ways to turn 2.5 into a whole number
```csharp
Console.WriteLine(Math.Round(2.5));
Console.WriteLine(Math.Round(3.5));
Console.WriteLine(Math.Round(2.5, MidpointRounding.AwayFromZero));
Console.WriteLine((int)2.9);
Console.WriteLine(Convert.ToInt32(2.5));
Console.WriteLine(Math.Round(1.005m, 2, MidpointRounding.AwayFromZero));
```
@1 | | > 2
Surprise: not 3. The default is **banker's rounding** (`MidpointRounding.ToEven`): a half goes to the nearest **even** number.
@2 | | > 4
3.5 goes up, because 4 is even. Over many values, rounding halves up and down equally means totals don't drift upward, which is why banks and IEEE 754 prefer it.
@3 | | > 3
The "school" rule, which most invoices and tax rules expect, has to be asked for by name.
@4 | | > 2
A cast doesn't round at all. It **truncates** toward zero.
@5 | | > 2
`Convert.ToInt32` rounds, using banker's rounding again.
@6 | | > 1.01
In `decimal`, 1.005 is exactly 1.005, so it rounds the way a person expects. In `double`, 1.005 is stored as 1.00499999…, which rounds to 1.00.
:::

**Implicit vs explicit conversions.** C# converts silently only when nothing can be lost: `int` to `long`, `int` to `double`. Narrowing needs a cast: `(int)someLong`, which keeps the low bits (in an unchecked context) and can produce garbage. For text, use `int.TryParse(text, out var n)` rather than `int.Parse`, so bad input is a `false`, not an exception. Always pass `CultureInfo.InvariantCulture` when parsing or formatting data, as opposed to text for people: in Germany, "6,50" is six and a half.

**Generic math (C# 11).** Interfaces such as `INumber<T>` let you write one method for every numeric type: `static T Sum<T>(IEnumerable<T> xs) where T : INumber<T>`. This works through *static abstract interface members* ([Generics](ch:generics)).

## Strings: immutable, and why that matters {b}

:::plain
A string can never change. Methods like `Replace` and `+` hand you a brand-new string, and the old one is left for the GC.
:::

Once created, a .NET string's characters never change. `s.ToUpper()` doesn't change `s`; it returns a new string. That's a deliberate design choice, and it buys a lot:

- **Safe sharing.** Any number of variables, threads and dictionaries can hold the same string, because nobody can change it under them. No locks needed.
- **Stable hash codes.** A string used as a dictionary key can't change after it's inserted, so it can't end up in the wrong bucket.
- **Security.** A file path or SQL fragment that has been validated can't be changed afterwards by other code.
- **Interning**, below, is only possible because strings can't change.

The cost is that building a string piece by piece **copies everything every time**. Appending to a 10,000-character string allocates a new 10,001-character string and copies all 10,000 characters across.

:::walk Building a report line by line
```csharp
using System.Text;

var before = GC.GetAllocatedBytesForCurrentThread();
string slow = "";
for (int i = 0; i < 2_000; i++) slow += $"order {i};";
var slowBytes = GC.GetAllocatedBytesForCurrentThread() - before;

before = GC.GetAllocatedBytesForCurrentThread();
var sb = new StringBuilder();
for (int i = 0; i < 2_000; i++) sb.Append("order ").Append(i).Append(';');
string fast = sb.ToString();
var fastBytes = GC.GetAllocatedBytesForCurrentThread() - before;

Console.WriteLine(slow == fast);
Console.WriteLine($"+= allocated {slowBytes / fastBytes}x more than StringBuilder");
```
@4-5 | slow = "order 0;order 1;…" (growing)
Each `+=` creates a new string containing everything so far plus the new piece. Round 1,000 copies about 9,000 characters; round 2,000 copies about 20,000.
@6 | slowBytes = tens of megabytes
The total work grows with the **square** of the number of pieces.
@8-10 | sb = buffer with spare room
A `StringBuilder` keeps a growable buffer of characters. `Append` writes into the spare room and only grows the buffer occasionally.
@11 | fast = "order 0;order 1;…"
`ToString()` copies the result out once.
@14 | | > True
Same text.
@15 | | > += allocated …x more than StringBuilder
Typically tens to hundreds of times more garbage for the `+=` version, depending on the runtime.
:::

**When to use what:**

| Situation | Use |
|---|---|
| A fixed, small number of pieces | `+` or interpolation `$"…"`. The compiler turns `a + b + c` into one `string.Concat(a, b, c)` call, and interpolation uses a builder internally (C# 10 interpolated-string handlers). |
| A loop, or an unknown number of pieces | `StringBuilder`, or `string.Join` when the pieces are already in a collection |
| Hot paths with a known final length | `string.Create(length, state, (span, s) => …)`, which writes straight into the new string's memory |
| Joining with a separator | `string.Join(", ", items)` |

## == vs Equals, and interning {i}

:::plain
For two strings, `==` compares the characters. But when the same strings are held in `object` variables, `==` compares whether they're the same object, so it can say "not equal".
:::

:::walk Equal, and not equal
```csharp
string a = "tea";
string b = new string(new[] { 't', 'e', 'a' });
object oa = a, ob = b;

Console.WriteLine(a == b);
Console.WriteLine(ReferenceEquals(a, b));
Console.WriteLine(oa == ob);
Console.WriteLine(oa.Equals(ob));
Console.WriteLine(ReferenceEquals(a, "tea"));
Console.WriteLine(ReferenceEquals(b, string.Intern(b)));
```
@1-2 | a = → "tea" (the literal) ; b = → "tea" (a separate copy built at run time)
Two different string objects with the same characters.
@5 | | > True
`string` defines its own `==` operator that compares characters.
@6 | | > False
They really are two objects.
@7 | | > False
Here the variables are typed `object`. Operators are chosen at **compile time** from the variables' types, and `object`'s `==` compares references. So the same two strings are "not equal".
@8 | | > True
`Equals` is a **virtual** method, chosen at run time from the actual object. `string` overrides it to compare characters, so it works even through `object` variables.
@9 | | > True
String **literals** are interned: every `"tea"` in the program is the same object.
@10 | | > False
`string.Intern(b)` returns the shared interned copy, which is the literal, not `b`.
:::

**The rule:** `==` is chosen by the compiler from the declared types, and `Equals` is chosen at run time by the object. In generic code (`T a, T b`), use `EqualityComparer<T>.Default.Equals(a, b)`, which respects each type's own equality. For your own types, see [Equality](ch:type-system#equality-the-same-means-three-things).

**Interning.** The runtime keeps one table of interned strings. Every literal in your code is put there automatically, and `string.Intern(s)` adds a run-time string to it (or returns the existing copy). `string.IsInterned(s)` checks without adding. Interning saves memory only when you hold **many copies** of a **small set** of strings that were built at run time, such as country codes parsed from millions of rows. But interned strings are never freed while the process runs, so interning user input is a memory leak. For a bounded set of values, a `HashSet<string>` or a dictionary used as a pool of your own gives you the same saving, and you control its lifetime.

**Comparing text correctly.** Pass a `StringComparison` every time you compare text:

- `StringComparison.Ordinal` (or `OrdinalIgnoreCase`) for **identifiers**: SKUs, headers, file names, keys. Fast, and the same on every machine.
- `CurrentCulture` for text **shown to people** and sorted for them.

Culture-sensitive comparison has real surprises. In Turkish, `"file".ToUpper()` is `"FİLE"`, with a dotted capital İ, so a culture-sensitive comparison of "FILE" and "file" fails on a Turkish server. Use `ToUpperInvariant()` and ordinal comparisons for anything that isn't for display.

**Length isn't characters.** .NET strings are UTF-16. `"🍵".Length` is **2**, because the emoji needs two UTF-16 units (a surrogate pair). Accented letters can also be two code points (`e` plus a combining accent). For "characters as a person sees them", use `StringInfo` (text elements) or `Rune` (code points). This matters for length limits and for truncating names.

## null, default, and the three ways to convert {b}

:::plain
`default` is "all zeros" for a type: 0 for numbers, false for bools, null for references. `null` itself only exists for reference types and nullable value types.
:::

| Type | `default(T)` |
|---|---|
| any reference type (`string`, `Order`) | `null` |
| numbers | `0` |
| `bool` | `false` |
| `char` | `'\0'` |
| `DateTime` | 1 January 0001, midnight |
| `Guid` | `00000000-0000-0000-0000-000000000000` |
| a struct | every field set to its own default |
| `int?` | `null` (an empty `Nullable<int>`) |

`default` matters most in generic code, where you don't know whether `T` is a class or a struct: `T result = default;` works for both. A defaulted struct skips every constructor, so a struct must make sense when all its fields are zero: a `Money` with amount 0 and a null currency is a value your code will meet.

**is, as and casts.** Three ways to treat an `object` as something more specific:

:::walk Three ways to convert
```csharp
object x = "Assam";

if (x is string s) Console.WriteLine(s.Length);

string? asString = x as string;
Uri? asUri = x as Uri;
Console.WriteLine(asUri is null);

try { var u = (Uri)x; }
catch (InvalidCastException) { Console.WriteLine("cast threw"); }
```
@1 | x = → "Assam" (declared as object)
The variable's type is `object`, but the object is a string.
@3 | s = "Assam" | > 5
`is string s` tests the type **and** gives you a typed variable if it matches. This is the modern way.
@5 | asString = "Assam"
`as` returns the object typed as `string`, or `null` if it isn't one.
@6 | asUri = null
`x` isn't a `Uri`, so `as` quietly returns `null`. That's its danger: forget to check, and you get a `NullReferenceException` far from the real mistake.
@7 | | > True
@9-10 | | > cast threw
A cast `(Uri)x` throws `InvalidCastException` immediately. Use a cast when a mismatch is a **bug** you want to hear about at once.
:::

`as` only works for reference types and nullable value types, because it needs `null` to signal failure. Today, `is T t` replaces almost every use of `as` followed by a null check.

## Nullable<T> vs nullable reference types {i}

:::plain
`int?` is a real wrapper struct that can hold "no value". `string?` is not a type at all at run time: it's a note to the compiler, which then warns you about possible nulls.
:::

The `?` means two completely different things, depending on what it's attached to:

| | `int?` (nullable **value** type) | `string?` (nullable **reference** type) |
|---|---|---|
| What it really is | `Nullable<int>`, a struct with `HasValue` and `Value` | just `string`, with an annotation in the metadata |
| Exists at run time? | yes: a different type, 8 bytes instead of 4 | no: identical to `string` |
| Without the `?` | `int` can never be null | `string` can still be null at run time; the compiler just warns |
| Introduced | C# 2 (2005) | C# 8 (2019), as compile-time analysis |
| Enforced by | the type system | compiler **warnings** only |

:::walk What `int?` really is
```csharp
int? stock = null;
Console.WriteLine(stock.HasValue);
Console.WriteLine(stock.GetValueOrDefault());

object boxedEmpty = stock;
Console.WriteLine(boxedEmpty is null);

stock = 5;
object boxedFive = stock;
Console.WriteLine(boxedFive.GetType().Name);
```
@1 | stock = Nullable<int> { HasValue = false }
`int?` is short for `Nullable<int>`: a struct holding a `bool HasValue` and an `int` value. "null" here just means `HasValue` is false.
@2 | | > False
@3 | | > 0
`GetValueOrDefault()` returns the value, or `default(int)` when there isn't one. `.Value` would throw instead.
@5 | boxedEmpty = null
The runtime treats `Nullable<T>` specially when boxing: an empty one boxes to a **null reference**, not to a box containing "nothing".
@6 | | > True
@8-9 | stock = Nullable<int> { HasValue = true, Value = 5 } ; boxedFive = → boxed int 5
A non-empty one boxes to a boxed **`int`**, not a boxed `Nullable<int>`.
@10 | | > Int32
So there is no such thing as a boxed `Nullable<T>`. That's what lets `object o = (int?)5; if (o is int n)` work.
:::

The two meet in generic code. With no constraint, `T?` on a type parameter means "may be the default value", which is `null` for classes but plain `0` for `int`, not `Nullable<int>`. Add `where T : struct` to get a real `Nullable<T>`.

## Dates and times {i}

:::plain
`DateTime` doesn't know which time zone it's in. For a moment in time, use UTC or `DateTimeOffset`. For a birthday, use `DateOnly`. For "opens at 9", use `TimeOnly`.
:::

Kettle opened a New York warehouse, and the "orders placed today" report started counting yesterday evening's London orders. The cause was a `DateTime` that didn't know which clock it came from.

| Type | Holds | Use it for |
|---|---|---|
| `DateTime` | a date and time, plus a `Kind`: `Utc`, `Local` or `Unspecified` | legacy APIs; UTC timestamps if you're disciplined |
| **`DateTimeOffset`** | a date and time **plus its offset from UTC** | **instants**: when an order was placed, when a token expires |
| **`DateOnly`** (.NET 6) | a calendar date, no time | birthdays, delivery dates, billing days |
| **`TimeOnly`** (.NET 6) | a clock time, no date | opening hours, "send the report at 06:00" |
| `TimeSpan` | a duration | timeouts, "3 days" |
| `TimeZoneInfo` | a time zone's rules, including daylight saving | converting an instant to a local clock |

:::walk Same moment, different answers
```csharp
var asUtc = new DateTime(2026, 3, 29, 1, 30, 0, DateTimeKind.Utc);
var asLocal = new DateTime(2026, 3, 29, 1, 30, 0, DateTimeKind.Local);
Console.WriteLine(asUtc == asLocal);

var london = new DateTimeOffset(2026, 7, 1, 10, 0, 0, TimeSpan.FromHours(1));
var newYork = new DateTimeOffset(2026, 7, 1, 5, 0, 0, TimeSpan.FromHours(-4));
Console.WriteLine(london == newYork);
Console.WriteLine(london.UtcDateTime.Hour);

DateOnly delivery = new(2026, 7, 14);
TimeOnly opens = new(9, 0);
Console.WriteLine($"{delivery:yyyy-MM-dd} at {opens:HH:mm}");
```
@1-2 | asUtc = 2026-03-29 01:30 (Kind = Utc) ; asLocal = 2026-03-29 01:30 (Kind = Local)
Two values labelled as different clocks. Unless the server runs on UTC, they're different moments.
@3 | | > True
`DateTime` comparison looks only at the date and time digits and **ignores `Kind`** completely. This is the bug in Kettle's report.
@5-6 | london = 10:00 +01:00 ; newYork = 05:00 −04:00
Two `DateTimeOffset` values written with different local clocks.
@7 | | > True
`DateTimeOffset` compares the **instant**: both are 09:00 UTC.
@8 | | > 9
`UtcDateTime` converts to UTC.
@10-12 | delivery = 2026-07-14 ; opens = 09:00 | > 2026-07-14 at 09:00
A delivery **date** has no time, and "opens at 9" has no date. Using `DateTime` for either invites a midnight-and-time-zone bug.
:::

**Rules that prevent most date bugs:**

1. **Store instants in UTC**, or as `DateTimeOffset` (a `datetimeoffset` column in SQL Server). Convert to local time only when showing it to a person.
2. Use **`DateOnly`/`TimeOnly`** for dates and clock times that aren't instants. EF Core 8+ maps them to `date` and `time` columns.
3. **Daylight saving creates impossible and repeated times.** In London, 01:30 on 29 March 2026 doesn't exist (clocks jump from 01:00 to 02:00), and 01:30 on 25 October happens twice. Schedule recurring jobs in UTC, or use `TimeZoneInfo` and decide explicitly what happens on those days.
4. Time zone IDs: since .NET 6, both IANA IDs (`"Europe/London"`) and Windows IDs work on every OS.
5. Measure durations with **`Stopwatch`**, never by subtracting `DateTime.Now` values. The wall clock can jump when NTP corrects it or daylight saving starts.

**`TimeProvider` (.NET 8): time you can control in tests.** Code that calls `DateTime.UtcNow` directly can't be tested for "what happens when the token expires tomorrow". Inject `TimeProvider` instead:

```csharp norun
public sealed class TokenService(TimeProvider clock)
{
    public bool IsExpired(Token t) => clock.GetUtcNow() >= t.ExpiresAt;
}

// Production: services.AddSingleton(TimeProvider.System);
// Tests (Microsoft.Extensions.TimeProvider.Testing):
var clock = new FakeTimeProvider(new DateTimeOffset(2026, 7, 1, 9, 0, 0, TimeSpan.Zero));
var svc = new TokenService(clock);
clock.Advance(TimeSpan.FromDays(1));          // jump a day, instantly
```

`TimeProvider` also creates timers (`CreateTimer`), and `Task.Delay` and `CancellationTokenSource` accept it, so delays and timeouts become testable without waiting.

## Guid: identifiers you can make anywhere {i}

:::plain
A GUID is a 128-bit number that's almost certainly unique, so any server can create IDs without asking the database. Random GUIDs make database indexes slow; time-ordered ones fix that.
:::

Kettle added a second server, and both servers created order 1042, because both asked "what's the highest ID?" at the same moment. A **GUID** (globally unique identifier, also called a UUID) avoids that question: 122 random bits give so many possible values that two servers will, in practice, never pick the same one.

**Why use GUIDs as keys:**
- Any server, client or offline device can create an ID **before** saving, with no database round trip. That helps with batching, outboxes and offline sync.
- IDs from different databases can be merged without clashes.
- They don't reveal how many orders you have, unlike `/orders/1042`.

**Why not:**
- 16 bytes instead of 4 or 8, in every index and foreign key.
- Harder to read aloud or type.
- **Random GUIDs fragment indexes.** A clustered index (the table's physical order) is sorted by key. Sequential integers always insert at the end. Random GUIDs insert all over the table, splitting pages, wasting space, and keeping far more of the index "hot" in memory.

**Version 7 GUIDs fix the ordering.** `Guid.NewGuid()` makes a **version 4** GUID: all random. **`Guid.CreateVersion7()`** (.NET 9) puts a millisecond **timestamp first**, followed by random bits. New IDs then sort after old ones, and inserts land near the end of the index, like integers.

:::gotcha SQL Server sorts GUIDs in its own order
PostgreSQL and most other systems sort a UUID byte by byte, so version 7 GUIDs are in time order there. SQL Server's `uniqueidentifier` sorts by the **last** six bytes first. A version 7 GUID's timestamp is at the front, so SQL Server still sees it as random. For SQL Server, use EF Core's default client-side GUID generator, which arranges the bytes the way SQL Server sorts (`SequentialGuidValueGenerator`), or `NEWSEQUENTIALID()` in the database.
:::

**Not a secret.** A GUID is unique, not unguessable by design, and a version 7 GUID even reveals its creation time. For password-reset tokens or API keys, use `RandomNumberGenerator.GetBytes(32)` ([Web security](ch:web-security)).

## record struct vs record class {a}

:::plain
Both kinds of record compare by value. A record class is a heap object you share; a record struct is a value that's copied. A record struct is also changeable unless you mark it readonly.
:::

| | `record class` (or just `record`) | `record struct` |
|---|---|---|
| Kind of type | reference type: allocated on the heap, shared by reference | value type: copied on assignment, no separate allocation |
| Equality | value-based (generated `Equals`, `==`, `GetHashCode`) | value-based, also generated |
| Positional properties `record X(int A)` | `init`-only: **immutable** | **get and set: mutable**, unless you write `readonly record struct` |
| Inheritance | yes, records can derive from records | no, structs can't inherit |
| `with` expression | allocates a new object | makes a modified copy, no allocation |
| `null` | allowed | not without `?` |

:::walk Two records, two behaviours
```csharp
var a = new PriceClass(5m);
var b = new PriceClass(5m);
Console.WriteLine(a == b);
Console.WriteLine(ReferenceEquals(a, b));

var s = new PriceStruct(5m);
s.Amount = 6m;
var t = s with { Amount = 7m };
Console.WriteLine($"{s.Amount} {t.Amount}");
Console.WriteLine(s);

record PriceClass(decimal Amount);
record struct PriceStruct(decimal Amount);
```
@1-2 | a = → PriceClass { Amount = 5 } ; b = → PriceClass { Amount = 5 }
Two separate objects on the heap.
@3 | | > True
Records compare by value: same type, same property values.
@4 | | > False
But they're still two objects.
@6 | s = PriceStruct { Amount = 5 }
A record struct lives directly in the variable.
@7 | s = PriceStruct { Amount = 6 }
Surprise: this compiles. Positional record **structs** get settable properties, unlike record classes. Write `readonly record struct` to get the immutable version, which is almost always what you want.
@8 | s = PriceStruct { Amount = 6 } ; t = PriceStruct { Amount = 7 }
`with` copies the struct and changes the copy. No allocation.
@9 | | > 6 7
@10 | | > PriceStruct { Amount = 6 }
Both kinds get a generated `ToString`.
:::

**Why record structs are faster than plain structs for equality.** A struct that doesn't override `Equals` inherits `ValueType.Equals`, which, when the struct contains any reference-type field, compares fields **using reflection**: slow, and it boxes. A `record struct` generates a proper typed `Equals(PriceStruct other)` and `GetHashCode`, and implements `IEquatable<T>`. So for a small value used as a dictionary key, `readonly record struct` gives value semantics and fast equality with no hand-written code.

**Choosing:** use a `readonly record struct` for small values (two or three fields) that are created in large numbers: money, coordinates, strongly typed IDs ([Types](ch:type-system#strongly-typed-ids-the-bug-a-struct-can-make-impossible)). Use a `record class` for DTOs, messages and events, which are bigger, often nullable, and passed around by reference.

## var: inference, not dynamic {b}

`var` asks the compiler to work out a local variable's type from the right-hand side. The variable is still **statically typed**: `var x = 5;` makes `x` an `int` forever, and `x = "tea"` is a compile error. That's the difference from `dynamic`, which really does skip compile-time checking ([Advanced C#](ch:advanced-csharp#reflection-in-depth)).

Use `var` when the type is obvious from the line (`var orders = new List<Order>();`), when it's long and noisy (`var groups = orders.GroupBy(o => o.CustomerId);`), and when it's impossible to write (anonymous types). Spell the type out when the right-hand side hides it and the type matters to the reader: `decimal total = Calculate();` tells you the result is money, `var total = Calculate();` doesn't.

## Interview questions {i}

:::qa What are the built-in integer types and how do they differ?
`sbyte`/`byte` (8 bits), `short`/`ushort` (16), `int`/`uint` (32), `long`/`ulong` (64), `nint`/`nuint` (pointer-sized) and `Int128`/`UInt128` (128). Each has a fixed range. Arithmetic wraps silently on overflow unless you use `checked` or the project-wide overflow setting. `int` is the default, `long` for values that may pass about 2.1 billion, and unsigned types mainly for bit manipulation and protocols.
:::

:::qa float vs double vs decimal: when do you use each?
`float` (4 bytes, ~7 digits) and `double` (8 bytes, ~15–16 digits) are binary floating point: fast and hardware-supported, but most decimal fractions can't be stored exactly, so `0.1 + 0.2 != 0.3`. Use them for measurements and science, and compare with a tolerance. `decimal` (16 bytes, 28–29 digits) is base ten and much slower, but exact for decimal fractions, so it's the type for money.
:::

:::qa Follow-up: what does Math.Round(2.5) return, and why?
2. The default is banker's rounding (`MidpointRounding.ToEven`), which sends halves to the nearest even number so rounding errors don't drift one way across many values. Pass `MidpointRounding.AwayFromZero` for the "school" rule most invoices expect. A cast to `int` truncates instead of rounding.
:::

:::qa Why are strings immutable, and what does it cost?
Immutability makes strings safe to share across threads and variables without locks, keeps their hash codes stable as dictionary keys, prevents validated values being changed later, and makes interning possible. The cost is that every modification creates a new string, so concatenating in a loop copies all the text each time and allocates heavily. Use `StringBuilder`, `string.Join` or `string.Create` there.
:::

:::qa Follow-up: string vs StringBuilder: when is each appropriate?
For a fixed, small number of pieces, plain concatenation or interpolation is best, because the compiler turns it into a single `Concat` or an interpolation handler. For loops or an unknown number of pieces, `StringBuilder` appends into a growable buffer and copies the result out once. For a known final length on a hot path, `string.Create` writes directly into the new string.
:::

:::qa What's the difference between == and Equals()?
`==` is an operator chosen at compile time from the variables' declared types. For classes it compares references unless the type overloads it, as `string` and records do. `Equals` is virtual and chosen at run time from the actual object, so types override it to define value equality. That's why two strings held in `object` variables can be `!=` yet `Equals`. In generic code use `EqualityComparer<T>.Default`.
:::

:::qa How does string interning work, and should you use it?
All string literals are interned automatically into a runtime-wide table, so each distinct literal exists once. `string.Intern` adds run-time strings to that table and `string.IsInterned` checks it. Interned strings live for the whole process, so interning unbounded or user-supplied strings leaks memory. It helps only when many copies of a small, fixed set of run-time strings would otherwise exist, and a pool you control is usually safer.
:::

:::qa null vs default?
`null` is the absence of an object and only applies to reference types and nullable value types. `default(T)` is the zero value of any type: null for references, 0 for numbers, false for bool, all-zero fields for structs, and an empty `Nullable<T>`. In generic code `default` works for any `T`.
:::

:::qa is vs as vs a cast?
`is` tests a type and, with a pattern (`x is Order o`), gives a typed variable. `as` returns the converted reference or `null`, so it only works for reference and nullable types, and a forgotten null check surfaces later as a `NullReferenceException`. A cast throws `InvalidCastException` immediately, which is right when a mismatch means a bug.
:::

:::qa Nullable<T> vs a nullable reference type?
`int?` is `Nullable<int>`, a real struct with `HasValue` and `Value`; it exists at run time and boxes to either null or a boxed `int`. `string?` is only a compile-time annotation that drives flow-analysis warnings; at run time it's the same `string`, and a non-nullable `string` can still hold null. One is enforced by the type system, the other by compiler warnings.
:::

:::qa DateTime vs DateTimeOffset vs DateOnly vs TimeOnly?
`DateTime` is a date and time with a `Kind` that comparisons ignore, so mixing UTC and local values silently breaks. `DateTimeOffset` carries the UTC offset and compares instants, so it's the right type for timestamps. `DateOnly` and `TimeOnly` represent calendar dates and clock times with no instant attached, such as birthdays and opening hours. Store instants in UTC, inject `TimeProvider` for testable time, and measure durations with `Stopwatch`.
:::

:::qa When would you use a Guid as an identifier?
When IDs must be created without the database, by several servers, clients or offline devices, or merged across databases, or shouldn't reveal counts. The costs are 16-byte keys and, with random version 4 GUIDs, fragmented clustered indexes. Time-ordered version 7 GUIDs (`Guid.CreateVersion7()`) fix ordering on databases that sort UUIDs bytewise, but SQL Server sorts by the last bytes first, so use a SQL Server–ordered sequential generator there. GUIDs aren't secrets; use `RandomNumberGenerator` for tokens.
:::

:::qa record struct vs record class?
Both generate value-based equality, `ToString` and `with`. A record class is a reference type: heap-allocated, shareable, can inherit, and its positional properties are init-only. A record struct is a value type: copied on assignment and allocation-free, but its positional properties are mutable unless declared `readonly record struct`, and it can't inherit. Record structs also get a fast generated `Equals`, unlike plain structs, whose default `ValueType.Equals` may use reflection.
:::

## Next {b}

With the everyday types under control, Kettle's numbers add up and its timestamps agree. Next, Kettle's order objects start getting into impossible states, and classes have to start guarding their own rules. [Episode 2 · Classes →](ch:oop)

## Further reading

- [Floating-point numeric types](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/floating-point-numeric-types) and [integral types](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/integral-numeric-types)
- [Best practices for comparing strings](https://learn.microsoft.com/en-us/dotnet/standard/base-types/best-practices-strings)
- [Choosing between DateTime, DateTimeOffset, TimeSpan and TimeZoneInfo](https://learn.microsoft.com/en-us/dotnet/standard/datetime/choosing-between-datetime)
- [TimeProvider](https://learn.microsoft.com/en-us/dotnet/standard/datetime/timeprovider-overview)
- [Records](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/record)

## Verify this chapter

```csharp
using System.Text;

Check(0.1 + 0.2 != 0.3 && 0.1m + 0.2m == 0.3m, "double can't store 0.1 exactly; decimal can");
Check(Math.Round(2.5) == 2 && Math.Round(2.5, MidpointRounding.AwayFromZero) == 3, "default rounding is to even");
Check((int)2.9 == 2, "a cast truncates");
int max = int.MaxValue;
Check(unchecked(max + 1) == int.MinValue, "integer overflow wraps by default");
Check(-7 / 2 == -3 && -7 % 2 == -1, "integer division truncates toward zero");

string a = "tea", b = new string(new[] { 't', 'e', 'a' });
object oa = a, ob = b;
Check(a == b && !(oa == ob) && oa.Equals(ob), "== depends on declared type, Equals on the object");
Check(ReferenceEquals(a, "tea"), "literals are interned");

int? empty = null; object boxed = empty;
Check(boxed is null, "an empty Nullable<T> boxes to null");
object five = (int?)5;
Check(five.GetType() == typeof(int), "a non-empty Nullable<int> boxes to an int");

var u = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
var l = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Local);
Check(u == l, "DateTime equality ignores Kind");
Check(new DateTimeOffset(2026, 7, 1, 10, 0, 0, TimeSpan.FromHours(1)) == new DateTimeOffset(2026, 7, 1, 9, 0, 0, TimeSpan.Zero), "DateTimeOffset compares instants");

var s = new PS(1m); s.Amount = 2m;
Check(s.Amount == 2m && new PC(1m) == new PC(1m), "record structs are mutable; records compare by value");
Check(default(Guid) == Guid.Empty && default(string) is null, "default is the zero value");

static void Check(bool ok, string claim) =>
    Console.WriteLine(ok ? $"OK: {claim}" : throw new Exception($"FAIL: {claim}"));

record PC(decimal Amount);
record struct PS(decimal Amount);
```
