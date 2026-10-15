---
'@variance-authority/cli': minor
---

`variance` names its faster direct call when a package manager launched it

`yarn variance`, `pnpm exec variance` and `npm exec variance` start the package
manager before the program, and on a large workspace that start can cost more
than the answer. Launched that way, `variance` ends its stderr with one line
naming the same command through the installed binary:

```
The same command answers faster without yarn: node_modules/.bin/variance ask symbol --name readFlags
```

The answer on stdout and the exit code are unchanged. The line is not printed
for a direct call, inside a package script, or when the nearest
`node_modules/.bin/variance` is missing — as under Plug'n'Play — or belongs to
another install.
