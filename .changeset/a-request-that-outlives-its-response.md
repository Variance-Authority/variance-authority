---
'@variance-authority/sense': minor
'@variance-authority/playwright-test': patch
---

A head's account that lands after the last spec is recorded

A head reports a request when what its handler returned settles, which can be
well after the response went out: a streamed body, a write behind, a log flushed
after `end()`. When that happened in the last spec a worker ran, the account
reached a worker that had already stopped listening, and it was dropped without
a word. If every account from a head went that way, the run blamed the head for
reporting nothing.

A head now says a request opened before the handler runs, and every account
says it settled. At teardown the worker waits up to five seconds for every
opened request to settle before it records. One still open after that retires
the run with a reason that names the head, as a silent head does.
`unsettledScopes`, exported from `@variance-authority/sense/journey`, gives a
driver of its own the same count to wait on.
