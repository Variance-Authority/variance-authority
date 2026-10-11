---
'@variance-authority/cli': minor
'@variance-authority/distill': minor
'@variance-authority/mcp': minor
---

`variance story`, `variance journeys`, `variance distill` and the test tools read a file and a name exactly

`variance story --file` and `--name` kept every story whose test file path or
test name held the text you typed, so `--file a.test.ts` also kept
`data.test.ts`, and `--name adds` kept `data > adds one`. `--in` kept every
step whose file held its text, and `variance journeys --file` kept a module
whose path ended with, or whose name held, the text in any case. Each now
names one thing. `--file` and `--in` are a path in the checkout, read as
`variance covering --file` and `variance distill --file` read one, and a path outside the checkout is refused
as one. `--name` is the test's whole name as the runner reports it, its
`describe` blocks and its own name joined with ` > `. When nothing is that
path or name, the answer says so, and `variance story` alone lists the stories
that are written.

`variance distill --test` took a case's id, its whole title, or any part of
the title in any case, so `--test submits` read `checkout > submits` when it
was the only title holding the word. It now takes the id or the whole title,
`--test 'checkout > submits'`, and a part of either is answered as no case.
`variance_test_signals` (`variance ask test-signals --test`) and
`variance_test_attention` did the same and now take the id or the whole title
too.

The steps through one workspace package, which `--in @acme/ui` used to open by
matching the package name as text, are now `variance story --package @acme/ui`.
