---
'@variance-authority/cli': minor
---

`variance` names its faster direct call when a package manager launched it

A package manager that runs an installed binary starts itself first, and on a
large workspace that start can cost more than the answer. Launched that way,
`variance` ends its stderr with one line naming the same command through the
installed binary, by its full path:

```
variance: the same command answers faster: /path/to/checkout/node_modules/.bin/variance ask symbol --name readFlags
```

The answer on stdout and the exit code are unchanged. The line is not printed
for a direct call, inside a package script, in CI, or when the nearest
`node_modules/.bin/variance` is not this program's file — missing, as under
Plug'n'Play, a wrapper script, or another install's.
