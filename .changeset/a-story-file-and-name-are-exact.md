---
'@variance-authority/cli': patch
---

`variance story` and `variance journeys` read a file and a name exactly

`variance story --file` and `--name` kept every story whose test file path or
test name held the text you typed, so `--file a.test.ts` also kept
`data.test.ts`, and `--name adds` kept `data > adds one`. `--in` kept every
step whose file held its text, and `variance journeys --file` kept a module
whose path ended with, or whose name held, the text in any case. Each now
names one thing. `--file` and `--in` are a path in the checkout, read as
`variance covering --file` and `variance distill --file` read one, and a path outside the checkout is refused
as one. `--name` is the test's whole name as the runner reports it, its
`describe` blocks and its own name joined with ` > `. When nothing is that
path or name, the answer says so.

The steps through one workspace package, which `--in @acme/ui` used to open by
matching the package name as text, are now `variance story --package @acme/ui`.
