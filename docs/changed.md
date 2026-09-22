# See what changed.

Every change has a beginning and an end. In between is the mess. You edit a
line, move a component, replace a dependency, change a condition, fix one bug
and expose another; the program takes branches, schedules work, updates state,
calls services, renders components, and eventually produces something you can
see. Usually you keep the beginning and the end, and throw the middle away.

That is enough while everything goes as expected. When it does not, the missing
middle is exactly what you need.

This is the same boundary that makes a high-level test useful. [A test preserves
the path it names](tests.md#high-level-is-a-strength-and-a-blind-spot) while
remaining insensitive to how that promise was kept. The pass becomes a blind
spot only when it is asked to mean that nothing else changed.

## A diff says what you changed, not what changed

Source control gives a precise account of the edit. It does not give a precise
account of its effect.

One changed line can reach forty screens. Forty changed lines can leave
observable behaviour untouched. A refactor can preserve the result while taking
a completely different route through the program. A dependency, an environment
or a piece of data can change the result without your source changing at all.

A diff records where you acted. It does not tell you where the effect
travelled. That path only exists while the system runs.

## The result says what happened, not how

The other end has the opposite problem. A screenshot shows that a button moved.
An accessibility tree shows that its name changed. A request returns a
different value. A page renders the wrong state. Those are effects, and they
leave the questions that matter unanswered:

- Which input changed?
- Which branch did execution take?
- Which component produced the result?
- Which source was actually involved?
- Did the same cause reach anything else?
- Was the state already different before this action?
- Does another run do the same thing?

Looking only at the end turns investigation into reconstruction. You walk
backwards from the symptom, open files, add logs, rerun the program and form a
theory — after the evidence of what happened has gone.

## The middle carries the explanation

A useful model of a change is not just before and after.

The exact pieces differ by system; the shape does not. Something starts in one
condition, something acts on it, work happens, state changes, and an observable
result appears.

A regression can start anywhere along that path. The wrong state may be
arranged at the beginning. An edit may reach code it was not meant to affect.
Execution may take a different branch. A component may receive a different
input. The same input may produce unstable output. The interface may change
while the behaviour you explicitly cared about stays intact.

By the time you notice the end, all of those look like the same thing:
something changed.

## Variance comes before regression

A regression does not require a failing test. It does not require a test at
all. It is a system diverging from something you meant to preserve. A test
codifies one such intention and tells you the moment it is no longer true;
without that assertion the change still happened, and you need another
observation to find it.

Nor is every difference a regression. The feature you are building is supposed
to change something. A refactor may deliberately change execution while
preserving behaviour. A redesign may alter every pixel on the page. A state may
never have existed before.

So the first useful fact is not regression. It is **variance**: this reading
differs from that one. Only then can you ask whether the difference was
intended, acceptable, irrelevant or damage. Observation establishes the
difference; judgement gives it meaning.

## Changing code is a loop

Most development is not one edit followed by one verdict. You form an
intention, change the system, look at what happened, adjust your understanding,
and change it again. Sometimes you are building something new, sometimes
repairing damage, sometimes bending an existing abstraction until it serves
another case, sometimes removing code while proving that nothing anyone depends
on changed with it.

The question is the same every time: what did this change actually do? The
faster and more precisely you can answer it, the safer it becomes to change the
system again.

Driven by inference, that loop is read the diff, run something, look at the
page, search the code, add a log, run it again. Driven by evidence, those
become readings of one change: what source could be reached, what execution
covered, what state changed, what the interface exposed, and where the
difference came from.

The goal is not to collect everything. It is to retain enough of the path that
the next question can be answered without recreating the event from scratch.

## Different readings answer different parts

No single observation describes a whole change.

Source tells you what could be connected. Execution tells you what was actually
covered. State tells you what changed inside the running system. The interface
tells you what became externally distinguishable. History tells you whether the
same thing has happened before. Each is partial; together they connect cause to
effect.

You can travel that chain in either direction. When you changed the code
deliberately, start at the source and ask how far the effect travelled. When
you found something wrong, start at the effect and ask where the two readings
first parted. Those are not separate problems — they are opposite directions
through the same evidence.

## Keep what disappears

A running system knows far more than its final output reveals. It knows which
branch ran, which component rendered, which input changed, which work happened
before other work, and which source took part in producing the state you
eventually saw. Then execution ends, and most of that knowledge goes with it.

That makes retention part of observation. Evidence that already exists in
source can be read later. Evidence that exists only while the program runs has
to be captured while it exists — not because every execution deserves a
permanent archive, but because useful evidence is cheapest at the moment the
system already knows it. The expensive version is reconstructing it afterwards.

Kept at depth — fine-grained evidence of what code did, across hundreds of
thousands of files and tests, over time — that middle answers a question from
the record, instead of sending you to run the whole suite again to find out.

## Observe enough to choose what to do next

The point of observing a change is not a larger report. It is a defensible
choice of what to do next.

Maybe the effect is exactly what you intended and you continue. Maybe one
changed component explains twenty changed states. Maybe the visible symptom
came from an input much earlier in the path. Maybe execution never covered the
code you edited and your fix did nothing. Maybe two identical runs disagree and
there is no stable comparison to make yet. Maybe the evidence stops before the
question is answered.

That boundary matters too. Where the available observation cannot separate two
explanations, the correct result is not a guess. It is another question, and
another point of observation.

Software changes by moving through paths. Tests preserve [the ones you cared
enough to codify](tests.md#high-level-is-a-strength-and-a-blind-spot). That is
their strength. Keeping the rest is what prevents that strength becoming a
blind spot, and lets you explain what happened while the system ran.
