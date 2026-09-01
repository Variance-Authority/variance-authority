# Announcement case

This case proves that a test can assert the branch where nothing happens, in a
real browser, against a real service, through the actual Playwright Test CLI.

The application decides whether to show a modal only after a request whose
latency varies by hundreds of milliseconds — the kind of wait that makes a
screen-only assertion pass or fail depending on the machine. The consumer spec
never names a duration. It waits for the decision to be announced, then asserts
the screen once, with polling switched off.

One spec in here is written to fail. `diagnosis.spec.mjs` waits for coordinates
nothing announces, and the outer Vitest file asserts what the failure says: the
list of what *was* announced, in order, and the sentence that separates "no
listener is installed" from "the code does not announce yet". That message is the
product when a wait does not settle, so it is asserted like one.

Six executions run concurrently against one service process to show the
attribution: each hears its own request and no other.

The outer Vitest file is orchestration only: it launches the consumer processes
and reads what they printed.
