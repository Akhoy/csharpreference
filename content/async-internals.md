---
id: async-internals
title: "The Compiler-Generated Async State Machine"
summary: "Every async method is rewritten by the compiler into a small object that remembers where it paused. This chapter opens that object up piece by piece: what it holds, when it moves to the heap, which thread resumes it, and why a plain void method can't do any of this safely. Third of five chapters on async/await."
layer: language
where: C# language › Asynchrony › Compiler internals
fits: Explains the mechanism behind every `await` used in [the core model](ch:async-await) and [concurrent work](ch:async-concurrency). This is what separates using async/await from being able to explain an allocation spike or a weird production bug caused by it.
levels: a
prereqs: async-concurrency
next: async-valuetask
---

## The Big Idea {a}

:::plain
When you write `async`, the compiler rewrites your method into a small object that remembers two things: where it paused, and what its variables were at that point. That object is called a **state machine**. Each `await` is one numbered pause point on it.
:::

Nothing about `await` is magic at runtime. It's all decided at compile time, before your code ever runs. The compiler reads your `async` method and rewrites it into a completely different shape: a small struct with a few fields, and one method called `MoveNext()` that does the real work.

Three fields matter most:

| Field | What it holds |
|---|---|
| a **state number** | which `await` (if any) the method is currently paused at |
| your **local variables** | moved from the method body into fields, so they survive a pause |
| a **builder** | the object that creates and completes the `Task` your method returns |

That's the whole idea. Everything else in this chapter is what follows from it.

## Look Inside a Real One {a}

You don't have to take this on faith. .NET lets you ask a method for its generated state machine type and list its fields:

:::walk Look inside the state machine
```csharp
using System.Reflection;
using System.Runtime.CompilerServices;

var machine = typeof(Shop).GetMethod(nameof(Shop.CheckoutAsync))!
    .GetCustomAttribute<AsyncStateMachineAttribute>()!.StateMachineType;

Console.WriteLine($"{machine.Name} is a {(machine.IsValueType ? "struct" : "class")} with fields:");
foreach (var f in machine.GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic))
    Console.WriteLine($"  {f.FieldType.Name,-24} {f.Name}");

static class Shop
{
    public static async Task<string> CheckoutAsync(Task<decimal> payment)
    {
        var orderId = 42;                 // used after the await → becomes a FIELD
        var charged = await payment;
        return $"{orderId}: {charged}";
    }
}
```
@13-18 | -
A plain async method. One local variable, one `await`.
@4-5 | machine = <CheckoutAsync>d__0
The compiler gave this method a hidden companion type. Reflection can find it by name.
@7 | | > <CheckoutAsync>d__0 is a struct with fields:
It's a struct. Its fields are what carries the method's state across a pause.
@8-9 | | >   Int32                    <>1__state | >   AsyncTaskMethodBuilder`1 <>t__builder | >   Task`1                   payment | >   Int32                    <orderId>5__2 | >   TaskAwaiter`1            <>u__1
:::

Here's what those odd names mean:

| Generated field | Plain meaning |
|---|---|
| `<>1__state` | the state number: "paused at await #0", or "not paused" |
| `<>t__builder` | the builder. It makes and completes the returned `Task` |
| `payment` | your parameter, carried over unchanged |
| `<orderId>5__2` | your local variable `orderId`, now living as a field |
| `<>u__1` | the awaiter for whatever task is currently being waited on |

Every one of these exists because `MoveNext()` can be called again later, maybe by a different thread, and it needs to pick up exactly where it left off.

## How MoveNext Resumes {a}

Here's a simplified version of what the compiler writes for that one-await method, close enough to the real thing to reason about:

```csharp norun
public void MoveNext()
{
    if (state != 0)
    {
        awaiter = payment.GetAwaiter();
        if (!awaiter.IsCompleted)
        {
            state = 0;                                              // remember: paused at await #0
            builder.AwaitUnsafeOnCompleted(ref awaiter, ref this);  // call MoveNext again when it's done
            return;                                                 // and leave, for now
        }
    }
    var charged = awaiter.GetResult();                              // we're resuming: read the result
    builder.SetResult($"{orderId}: {charged}");                     // done. complete the Task
}
```

Read it as two visits to the same method:

1. **First call.** `state` isn't 0 yet, so it checks the payment task. Not finished? Remember "paused at 0," register a callback, and return.
2. **Second call**, later, when the payment finishes. `state` is now 0, so it skips straight to reading the result and finishing the `Task`.

One method, called twice, taking a different path each time depending on one integer. That's the entire mechanism.

### Reading It Line by Line

- `if (state != 0)` is the whole dispatch here. With only one `await`, there are only two states to tell apart: `0` (paused, waiting on `payment`) and anything else (not paused, meaning this is the first call). A method with one `await` doesn't need a `switch`; one `if` does the same job.
- **On the first call**, `state` isn't `0`, so the body of the `if` runs: `awaiter = payment.GetAwaiter()` gets an awaiter for the task, and `awaiter.IsCompleted` is checked straight away.
  - **Not completed:** `state = 0` records the bookmark, `builder.AwaitUnsafeOnCompleted(ref awaiter, ref this)` registers the callback that will call `MoveNext()` again later (the full mechanics of this call are below), and `return` leaves. This is the pause.
  - **Already completed:** the `if (!awaiter.IsCompleted)` block is skipped entirely, and execution falls straight through to `awaiter.GetResult()` below, with no pause.
- **On the second call** (the one the registered callback triggers), `state` is `0`, so the whole outer `if (state != 0)` block is skipped completely. Notice that `awaiter` isn't re-fetched and `IsCompleted` isn't re-checked. The method already knows, from the state number alone, that it's resuming, and jumps straight to reading the result.
- `awaiter.GetResult()` does two jobs depending on how things went: on success, it returns the payment amount; if the payment task failed, this is the exact line that rethrows that failure, which is what the surrounding method (in the real multi-step version below) catches and turns into `builder.SetException`.
- `builder.SetResult(...)` is the only way this method's `Task` ever completes successfully. It's reached exactly once, on whichever call (first or second) finally has the result in hand.

Three things follow directly from this:

- If `payment` is **already finished** the first time `MoveNext()` runs, the method never pauses at all. It reads the result and returns in one call, with no second visit.
- The **first real pause is what moves the struct to the heap**. Here's why: the struct starts out living on the calling method's stack. But when it pauses, the method returns, and the stack frame it was sitting in disappears. Something still has to hold those fields until the second call happens, possibly on a different stack entirely. So the runtime copies the struct onto the heap, and the callback points at that copy instead.
- That's also why a `Span<T>` can never be stored in a field that crosses an `await`. A span can point at stack memory, and stack memory from a popped frame is gone. If it survived onto the heap as a field, it would point at nothing. The compiler simply refuses to compile that ([more in Advanced C#](ch:advanced-csharp-span#why-span-has-strict-rules-ref-structs)).

:::qa What does the compiler generate for an async method?
A struct implementing `IAsyncStateMachine`. Locals and parameters become fields, each `await` becomes a numbered state, and `MoveNext()` runs forward to the next unfinished await, registers itself as the callback, and returns. An `AsyncTaskMethodBuilder` creates and completes the returned Task. The struct moves to the heap the first time it has to pause.
:::

## What AwaitUnsafeOnCompleted Actually Does {a}

Everywhere the method pauses, it's this one line doing the real work:

```csharp norun
builder.AwaitUnsafeOnCompleted(ref awaiter, ref this);
```

This chapter has named that call twice without opening it up. Here's what it does, in order:

1. **It boxes the state machine onto the heap, once.** The struct has been living on the stack up to this point. The first time any `await` in the method pauses, this call copies the whole struct onto the heap and keeps that one copy. Every field read or write after this point goes through the heap copy, not the original. If the *same* method call pauses a second time later (at a later `await`, in a method that has more than one), the struct is already on the heap, so this step is skipped; that's the point of passing `ref this` rather than `this`, it lets the builder tell a plain stack struct apart from an already-boxed one.
2. **It gets a delegate pointing at that boxed instance's `MoveNext`.** Something has to be handed to the awaiter that, when called, runs `MoveNext()` on this exact boxed copy. The builder builds (and caches) that delegate.
3. **It registers that delegate with the awaiter**, by calling `awaiter.UnsafeOnCompleted(thatDelegate)`. For a `TaskAwaiter<T>`, this attaches the delegate as a continuation on the underlying `Task`. From this point on, finishing that `Task` is what triggers the callback, not anything the state machine itself does.
4. **"Unsafe" means it skips capturing `ExecutionContext` itself.** There are two versions of this hookup: `OnCompleted`, which captures the current `ExecutionContext` (the thing `AsyncLocal<T>` rides on, [covered below](#synchronizationcontext-and-configureawait)) and restores it before the continuation runs, and `UnsafeOnCompleted`, which skips that capture. The compiler emits the unsafe version whenever it can, because `AsyncTaskMethodBuilder` already captured the `ExecutionContext` once, up front, when the method first started, and restores it itself around every `MoveNext()` call. Capturing it a second time, inside the awaiter, would just repeat work that's already being done correctly one level up. "Unsafe" doesn't mean dangerous here. It means a safety step that would otherwise happen automatically is instead the caller's responsibility, and the caller (the builder) genuinely is handling it.
5. **The delegate runs whenever the underlying `Task` completes.** That happens when whatever is doing the real work calls `SetResult`, `SetException`, or `TrySetResult` on it, directly or through its own builder. Completing a `Task` runs every continuation registered on it, including this one. Depending on the situation, that can happen synchronously, on whichever thread happens to complete the task, or by being queued onto the thread pool. Either way, the outcome is the same from this method's point of view: eventually `MoveNext()` is called again, `state` says exactly where to resume, and the method continues as if it had never left.

:::qa What does AwaitUnsafeOnCompleted do?
It boxes the state machine onto the heap the first time the method pauses (and reuses that same box on any later pause in the same call), builds a delegate pointing at that boxed instance's MoveNext, and registers that delegate as a continuation on the awaited Task through the awaiter's UnsafeOnCompleted method. "Unsafe" means it skips capturing ExecutionContext itself, because AsyncTaskMethodBuilder already captured it once when the method started and restores it around every MoveNext call. The continuation runs whenever the underlying Task completes, which calls MoveNext() again and resumes the method exactly where its state number says to.
:::

## Two Awaits, in Plain Words First {a}

One `await` only needs one yes/no check. A real method usually has more than one, and that's where the state number does real work: it's not a flag, it's an address to jump back to. Take a checkout that looks up an order, then charges it:

```csharp norun
public async Task<Receipt> ProcessAsync(int orderId, CancellationToken ct)
{
    var order = await db.Orders.FindAsync([orderId], ct);
    var charge = await payments.ChargeAsync(order!.Total, ct);
    return new Receipt(orderId, charge);
}
```

Before looking at the generated code, walk through what has to happen, in plain steps:

1. The method starts. Nothing is paused yet.
2. It asks for the order. Not ready yet? Remember "paused at step 1," and leave.
3. Later, something calls the method again. It sees "paused at step 1," so it skips straight past the part that starts the order lookup, and reads the result.
4. It asks for the charge. Not ready yet? Remember "paused at step 2," and leave.
5. Later, it's called again. It sees "paused at step 2," skips to reading the charge result, and finishes.
6. If anything in any of these steps throws, the method stops stepping forward and instead marks the `Task` as failed.

That's the whole shape. Here's the real generated code for it, so you can see those six steps as actual `C#` rather than a description of them:

```csharp norun
public void MoveNext()
{
    int state = this.state;
    Receipt result;
    try
    {
        TaskAwaiter<Order> awaiter1;
        TaskAwaiter<decimal> awaiter2;
        switch (state)
        {
            default:                                         // not paused: starting fresh
                awaiter1 = db.Orders.FindAsync([orderId], ct).GetAwaiter();
                if (!awaiter1.IsCompleted)
                {
                    this.state = 0;
                    this.awaiter1 = awaiter1;
                    builder.AwaitUnsafeOnCompleted(ref awaiter1, ref this);
                    return;                                  // step 2: leave, paused at the order lookup
                }
                goto case0;
            case 0:                                          // step 3: resumed after FindAsync
                awaiter1 = this.awaiter1;
                this.state = -1;
            case0:
                this.order = awaiter1.GetResult();
                awaiter2 = payments.ChargeAsync(this.order.Total, ct).GetAwaiter();
                if (!awaiter2.IsCompleted)
                {
                    this.state = 1;
                    this.awaiter2 = awaiter2;
                    builder.AwaitUnsafeOnCompleted(ref awaiter2, ref this);
                    return;                                  // step 4: leave, paused at the charge
                }
                goto case1;
            case 1:                                          // step 5: resumed after ChargeAsync
                awaiter2 = this.awaiter2;
                this.state = -1;
            case1:
                var charge = awaiter2.GetResult();
                result = new Receipt(orderId, charge);
                break;
        }
    }
    catch (Exception ex)
    {
        this.state = -2;
        builder.SetException(ex);                             // step 6: any failure lands here
        return;
    }
    this.state = -2;
    builder.SetResult(result);
}
```

### Reading It Block by Block

Line by line, this is what each part is doing:

- `int state = this.state;` copies the state number into a local variable, so the rest of the method reads it once instead of going back to the field repeatedly.
- `Receipt result;` is declared up here, outside the `switch`, because the very last line of the method (`builder.SetResult(result)`) needs to see it, and that line is outside the `switch` too.
- `try { ... } catch (Exception ex) { ... }` wraps everything: both awaits, both `GetResult()` calls, the `new Receipt(...)`, all of it. One `try` for the whole method body, not one per await.
- `switch (state)` is the dispatch point. `state` is `-1` on the very first call (which is what the implicit `default:` label catches), `0` if this call is resuming after the order lookup, `1` if it's resuming after the charge.
- **The `default:` branch** runs only on the first call. It starts the order lookup and immediately checks `awaiter1.IsCompleted`.
  - **Not completed:** record `this.state = 0` (the bookmark), save the awaiter into a field (`this.awaiter1 = awaiter1`, so it's still there next time), call `AwaitUnsafeOnCompleted` to register the callback ([full mechanics above](#what-awaitunsafeoncompleted-actually-does)), and `return`. This is the pause.
  - **Already completed:** skip straight to `goto case0;`, landing just past the pause logic, with no pause at all.
- **`case 0:` then `case0:`** is where the *next* call to `MoveNext()` lands, specifically the call that happens once the order lookup's task finishes. It pulls the awaiter back out of the field, resets `state` to `-1` (not currently paused), then falls into `case0:`, where `awaiter1.GetResult()` reads the `Order` (or rethrows, if the lookup failed).
- The same shape repeats for the second await: `awaiter2`, `case 1` / `case1`, `this.state = 1`.
- `break;` fires only once both awaits have resolved inside a single call. It exits the `switch`, the `try` finishes cleanly, and execution falls through to `builder.SetResult(result)` at the very bottom.
- `catch (Exception ex)` catches anything that throws anywhere in that `try`: a bad `orderId`, a failed charge, or `GetResult()` itself rethrowing a stored exception. It sets `state = -2` (finished, not resumable again) and hands the exception to `builder.SetException(ex)`, which is what turns the returned `Task` into a `Faulted` one.

Three facts fall out of reading this slowly:

- **The whole method body sits inside one `try`.** It doesn't matter which line throws. A bad argument before the first `await`, or a failed payment after the second, both land in the same `catch`, which hands the exception to `SetException` and returns. There's no path through this code where an exception escapes as a normal, thrown exception. It's always stored on the `Task` instead. That's the real mechanism behind ["exceptions are stored in the Task"](ch:async-await#the-task-type-and-its-end-states).
- **`awaiter.GetResult()` is what throws**, if the task it's reading from failed. It's called once, right after each resume, and that single call is doing double duty: reading the result on success, and rethrowing on failure.
- **Each `await` gets its own number and its own place to jump back to.** The method doesn't track "where am I" as a line number. It tracks it as one integer and a `switch` that can jump straight into the middle of itself. Both `AwaitUnsafeOnCompleted` calls above work exactly the way [the single-await version does](#what-awaitunsafeoncompleted-actually-does): same boxing, same callback, same `ExecutionContext` handling, just registered against a different awaiter field each time.

## What Gets Hoisted, and Why It Can Leak {a}

Not every local variable becomes a field. The rule is narrower than "everything in the method":

- **Parameters and `this`** always become fields. `MoveNext()` can be called again much later, maybe on a different thread, and it needs them to still be there.
- **A local only becomes a field if it's still needed after an `await`.** A variable that's created and fully used before pausing, or between two pauses, never has to survive a pause. It can stay an ordinary local.

That second rule has a real consequence: whatever does get hoisted stays alive for as long as the state machine does. Once that struct is on the heap, a field on it counts as "still in use" to the garbage collector, no matter how long the method takes to finish.

```csharp norun
public async Task ArchiveAsync(int orderId, CancellationToken ct)
{
    byte[] payload = await documents.FetchAsync(orderId, ct);   // read again later → hoisted to a field

    await Task.Delay(TimeSpan.FromSeconds(10), ct);              // payload sits in memory for all 10 seconds,
                                                                   // because the field on the heap still holds it

    await audit.LogAsync(payload.Length, ct);
}
```

`payload` is read again after the ten-second delay, so it has to be hoisted. For those ten seconds, nothing can free that buffer. The same applies to anything else you keep across a long `await`: an EF Core `DbContext`, an open `Stream`, a big `List<T>`. If you're done with the value before the long wait, clearing it (`payload = null!;`) lets the collector take it back right away instead of ten seconds later. More on how the collector decides what's "in use" in [Memory and the GC](ch:memory-gc).

:::gotcha Hoisting depends on timing, not on where a variable is declared
A variable used only before the first `await`, or only between two awaits, is not hoisted, even though it's written "inside" an async method. What decides it is simple: is this variable read again after a pause? If yes, it's a field. If no, it isn't.
:::

## SynchronizationContext and ConfigureAwait {a}

:::plain
In a desktop app, only one specific thread is allowed to touch the screen. So after an `await`, the rest of your method has to go back to that exact thread. ASP.NET Core has no such rule, so any free thread can pick it up.
:::

When an `await` resumes, which thread runs the rest of the method? That depends on whether a **SynchronizationContext** was captured when the method paused:

:::scene visuals/scenes/async-context.svg | Who runs the rest of the method?
1. A UI app (WPF, WinForms, MAUI) has one special **UI thread**. Only it is allowed to touch buttons and labels. It works through a queue of jobs, one at a time.
2. By default, `await` puts "the rest of the method" into that thread's queue. The rule that does this is the **SynchronizationContext**.
3. ASP.NET Core has no such queue. Whichever pool thread is free just runs the rest of the method directly.
4. `ConfigureAwait(false)` means "skip the queue, any thread will do." Libraries should use it, since they might be called from a UI app. In ASP.NET Core it changes nothing. It also avoids the deadlock covered in [diagnosing async failures](ch:async-pitfalls).
:::

| App type | Context | The rest of the method runs on |
|---|---|---|
| WPF, WinForms, MAUI | UI context | **the UI thread**, so it can safely touch controls |
| Old ASP.NET (.NET Framework) | per-request context | one thread at a time, per request |
| **ASP.NET Core**, console apps, workers | **none** | any free pool thread |

`ConfigureAwait(false)` means "don't go back to whatever context was captured. Resume anywhere."

- In **ASP.NET Core app code**, there's no context to go back to, so this makes no difference. You can leave it out.
- In **library code** that might be called from a UI app or an old ASP.NET app, put it on every `await`. It avoids needless trips back to the UI thread, and it prevents a specific deadlock.

`ExecutionContext` is a separate thing. It carries `AsyncLocal<T>` values (logging scopes, the current trace, culture) and always flows across an `await`, no matter what `ConfigureAwait` says.

:::qa What is ConfigureAwait(false) and do you need it in ASP.NET Core?
It tells `await` not to resume on the captured SynchronizationContext. ASP.NET Core has no SynchronizationContext, so in application code it makes no difference. Library code that might run under a UI or classic ASP.NET context should use it, to avoid deadlocks and unnecessary context switches.
:::

## async void and Exception Propagation {a}

[Rule 3](ch:async-await#five-rules-for-correct-async-code) says: don't use `async void`. Now that you've seen how `MoveNext()` handles exceptions, here's the mechanism behind that rule.

`async Task` methods use a builder called `AsyncTaskMethodBuilder`. When something fails, its job is simple: store the exception on the `Task` object. That's the `catch` block [in the generated code above](#two-awaits-in-plain-words-first) doing its job. Nothing is thrown at anyone. The failure just sits on the `Task`, waiting for whoever awaits it.

`async void` methods have no `Task` to return, so the compiler plugs in a different builder instead: `AsyncVoidMethodBuilder`. It still has the same `try`/`catch`/`switch` shape inside `MoveNext()`. But its `catch` block has nowhere to put the exception. There's no `Task`. So instead, it rethrows the exception directly, onto whatever `SynchronizationContext` was active when the method started, or the thread pool if there wasn't one.

```csharp norun
async void HandleClick(object sender, EventArgs e)   // event handler: the one legitimate use of async void
{
    await SaveAsync();     // if SaveAsync fails after this line...
}                           // ...nothing can catch what happens next
```

Nobody called `HandleClick` with `await`, so nobody is in a position to wrap it in a `try`/`catch` either. By the time it throws, the caller has already moved on. In ASP.NET Core or a console app, that exception reaches the runtime's own unhandled-exception handler and **crashes the process**. The one place this is fine is a UI event handler, where the framework itself is the caller, there's genuinely no `Task` to hand back, and a `SynchronizationContext` is there to catch the exception and route it to the UI framework instead of taking the whole app down.

:::qa Why does an exception in async void crash the process, but an exception in async Task doesn't?
`async Task` uses `AsyncTaskMethodBuilder`, which stores the exception on the returned `Task` for whoever awaits it. `async void` uses `AsyncVoidMethodBuilder`, which has no `Task` to store anything on, so it rethrows the exception directly onto the captured `SynchronizationContext` or the thread pool. Nothing is positioned to catch it there, so it reaches the runtime's unhandled-exception handler and ends the process.
:::

## Interviewer "why" deep-dives {a}

### "Does the thread that starts an async method ever come back to finish it?"

Usually not, and that's deliberate. `MoveNext()` doesn't care which thread calls it. Whichever thread is free when the awaited `Task` finishes is the one that resumes the method, reading the state back out of the fields on the struct. In ASP.NET Core, that's deliberate: if a continuation had to run on one specific thread, you'd lose the whole benefit of freeing threads during I/O in the first place. The one place a specific thread does matter is a UI app, where `SynchronizationContext` forces the rest of the method back onto the UI thread.

### "Why does Roslyn generate a struct for this, instead of a class?"

Because most `await`s, in real code, finish immediately far more often than you'd guess: a cache hit, a buffered read, a `ValueTask` that already has its answer. If the state machine were a class, every single call to an `async` method would allocate a heap object right away, whether it needed to pause or not. By making it a struct, the state machine starts out on the stack for free, and the method only pays for a heap allocation on the specific calls that pause ([see "The Big Idea"](#the-big-idea)). A call that never pauses allocates nothing at all.

### "Can two threads ever run MoveNext on the same state machine at once?"

No, and not because anything is locking it. At any moment, a state machine has at most one pending callback registered: the method pauses, hands one awaiter exactly one "call me back" instruction, and `MoveNext()` always runs either to the next pause or to the very end before it returns. There's never a moment where two separate completions are both waiting to resume the same instance, because the next pause point isn't even registered until the current call reaches it. The one way to break this yourself is to await the *same* `ValueTask` from two places at once, which is exactly why [a ValueTask has to be awaited exactly once](ch:async-valuetask#interviewer-why-deep-dives). That's not a gap in the compiler's protection. That's you stepping outside the one-callback-at-a-time rule it relies on.

## Summary {a}

Every `async` method becomes a struct with a state number, your hoisted locals, and a builder. One method, `MoveNext()`, runs it forward: it does as much as it can, and the moment it has to wait on something unfinished, it records where it is and leaves. The whole body sits inside one `try`, so any failure, anywhere, ends up stored on the `Task` instead of thrown at anyone. The struct lives on the stack for free until the first real pause, which is the one moment it has to move to the heap. Only locals read again after a pause get hoisted into fields, and once hoisted, they stay alive for as long as the state machine does. `async void` is the one case with no `Task` to store a failure on, which is why its exceptions crash the process instead of waiting for someone to observe them. And which thread picks the method back up depends only on whether a `SynchronizationContext` was captured. None, in ASP.NET Core, so any free thread will do.

Next: [ValueTask and allocation-free completions](ch:async-valuetask) picks up straight from the struct-vs-heap question above. It's about how `ValueTask<T>` avoids allocating a `Task` at all, on the path that never pauses.
