---
'@variance-authority/react': minor
'@variance-authority/route-collector': minor
'@variance-authority/playwright': minor
---

A route waits for hydration only while something can still finish it, and says when hydration changed it

No clock decides how long a route waits for React to hydrate it. React's own
record does: the collector waits while a root has a render React can do or a
commit has effects React has not run, and, while React is stuck on a promise,
for as long as anything the page requested is still arriving. A route React
stops hydrating with nothing left arriving is refused at once, and the refusal
says React had no work it could do and nothing was arriving to give it some.
A slow route is waited for however long its responses take; a route held on a
timer or on a promise nothing settles is refused without waiting.

A route React never loaded on is read at once: the route agent taps React's
commits from before the page's first script, so it knows no React is coming,
and its `react-root-absent` warning says React did not load and suggests
`wiring: false`. A route already committed was, and is, read at once.

A route that was waited for is now compared. Its markup when the wait began is
read again once React has committed and run the effects hydration scheduled,
and a difference is reported as a `hydration-changed-markup` warning that
quotes the server's markup and the client's around the change and names the
components that committed after hydrating. The route is still read as it
ended.

`awaitHydration` takes `tap`, a `tapCommits` tap, and `outstanding`, a function
that resolves `true` once something the page requested has arrived and `false`
when nothing is in flight; without it, a root stuck on a promise is returned as
`hydrating` at once. Its `timeoutMs` option is gone. Its settlement carries
`loaded: false` when the tap saw no React load, and `changed`, a
`MarkupChange`, when the markup moved. A `tapCommits` tap gains
`effectsPending()`, true while a commit's passive effects have not run.

`watchArrivals(page)`, exported by the Playwright package, answers
`outstanding` from the page's own requests, leaving out event streams and
WebSockets, which are open by design. The Playwright harness installs it, and
its page agent by init script before the first navigation, so the first
document gets the agent ahead of its own scripts, as every later one already
did.
