---
'@variance-authority/react': minor
'@variance-authority/route-collector': minor
'@variance-authority/playwright': minor
---

A route waits for hydration only while something can still finish it, and says when hydration changed it

No clock decides how long a route waits for React to hydrate it: the route
collector's `hydrationTimeoutMs` option and its two-second default are gone. React's own record decides: the collector
waits while a root has a render React can do or a commit has effects React has
not run, and, while React is stuck on a promise or has no root yet, for as long
as anything the page requested is still arriving. A route React stops
hydrating with nothing left arriving is refused at once, and the refusal says
React had no work it could do and nothing was arriving to give it some. A slow
route is waited for however long its responses take; a route held on a timer
or on a promise nothing settles is refused without waiting.

A route React never loaded on is read once nothing it requested is still
arriving: the route agent taps React's commits from before the page's first
script, so it knows no React came, and its `react-root-absent` warning says
React had not loaded and suggests `wiring: false`.

A route that hydrates is now compared. The commit tap copies the markup in
React's hydration commit, inert, and it is compared with the markup once React
has nothing left to do, so a fast machine and a slow one give the same answer.
A difference is reported as a `hydration-changed-markup` warning that quotes
the markup at the hydration commit and the client's around the change, and
names the components of that root that committed after hydrating. The route is
still read as it ended.

`awaitHydration` takes `tap`, a `tapCommits` tap, and `outstanding`, a function
that resolves `true` once something the page requested has arrived and `false`
when nothing is in flight; without it, a root stuck on a promise is returned as
`hydrating` at once. Its `timeoutMs` option is gone. Its settlement carries
`loaded: false` when the tap saw no React load, and `changed`, a
`MarkupChange`, when the markup moved. A `tapCommits` tap gains
`effectsPending(root?)`, true while a commit's passive effects have not run on
that root, or on any without one, and `hydration(root)`, a `RootHydration`: the
markup copied at that root's hydration commit and the commits since. The tap
reads React 18's passive-effect flags as React 18 sets them, so a React 18 root
is no longer held busy by flags React 18 never clears. `detectReactVersion`
reads the hook through the same reader as the tap.

`watchArrivals(page)`, exported by the Playwright package, answers
`outstanding` from the page's own requests, leaving out event streams,
WebSockets and media, which are open by design, and fonts and images, which
React waits on neither and the asset stages wait for and name. The Playwright harness installs
it, and its page agent by init script before the first navigation, so the first
document gets the agent ahead of its own scripts, as every later one already
did. A page agent that fails while a request is still arriving fails naming
that request, with Playwright's error as the cause.
