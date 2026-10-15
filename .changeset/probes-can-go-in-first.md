---
'@variance-authority/sense': minor
'@variance-authority/storybook-collector': minor
---

Place the probes ahead of your transforms with `placement: 'before-transforms'`

The probes go in after your transforms by default, so a compiler that reads
syntax never reads one. That costs a second parse and the map back to each
file. A unit-test run whose transforms only strip types or JSX can skip both:
`placement: 'before-transforms'` places the probes in the file as read, with
one parse and no map. It means the same on the Vitest, Jest and Rstest
`withTestSelection`, on `testSelectionProbes` and `testSelectionRule`, and as an
option of the Storybook addon. With Compiled, React Compiler or another compiler
that reads syntax in the run, keep the default: nothing detects them for you.
