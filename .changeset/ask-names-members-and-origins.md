---
'@variance-authority/cli': patch
'@variance-authority/help': patch
'@variance-authority/sense': patch
---

`ask symbol` lists a container's members, and `ask uses` takes `--limit` and follows a passed-on name

`ask symbol` on an interface, a type alias or a class now lists the members it
declares after its signature, one line each as the checkout writes it, with its
file and line. A nested type literal's members are not listed, and an alias that
fits on its line lists nothing more.

`ask uses --limit <n>` shows that many sites of each kind. Without it the answer
shows twelve and counts the rest, as before.

A name a file only passes on, as in `export { taxOf as levy } from './tax.js'`,
is now followed to the declaration it reaches, through every file between them
and every rename. `ask uses` names that declaration after the export line, and
`ask symbol` shows its line too.

Yarn 2 and later have no `-s` flag, so `yarn -s variance` fails before the CLI
starts. The skill now says that `yarn variance` already prints only the CLI's
output.
