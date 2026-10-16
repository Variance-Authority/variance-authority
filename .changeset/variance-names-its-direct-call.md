---
'@variance-authority/cli': minor
---

`variance` names its faster direct call when a package manager launched it

`yarn variance` and `npm exec variance` start the package manager before the
program, and on a large workspace that start can cost more than the answer.
Launched that way, `variance` ends its stderr with one line naming the same
command through the installed binary:

```
variance: the same command answers faster without yarn: node_modules/.bin/variance ask symbol --name readFlags
```

When the package manager ran the program in another directory than the one it
was typed in, as Yarn 1 runs it from the project root, the line goes there
first: `cd <dir> && node_modules/.bin/variance …`.

The answer on stdout and the exit code are unchanged. The line is not printed
for a direct call, inside a package script, in CI, or when the nearest
`node_modules/.bin/variance` is not this program's file — missing, as under
Plug'n'Play, a wrapper script, as pnpm and Windows write it, or another
install's.
