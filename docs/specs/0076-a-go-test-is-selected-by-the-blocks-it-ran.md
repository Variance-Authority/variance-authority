# Spec 0076 — a Go test is selected by the blocks it ran

**Missing:** everything for Go. No reader parses a `.go` file, so `variance
reach` does not list one, no recorder writes a row for a Go test, and no journey
has a part from a Go service.
**Built on:** [ADR-0066](../context/adr/0066-a-language-is-a-reader-not-a-sense.md)
and [ADR-0074](../context/adr/0074-one-reader-per-tree-sitter-language.md) (a
language is one tree-sitter reader in the addon),
[ADR-0069](../context/adr/0069-every-answer-has-an-owner.md) (ride the
toolchain's counters, never a second instrument),
[ADR-0072](../context/adr/0072-a-change-is-read-before-it-is-charged.md) (both
texts decide what a change charges),
[ADR-0070](../context/adr/0070-a-journey-travels-as-trace-context.md) (the id
travels as trace context), [0073](0073-a-test-owns-the-files-its-services-ran.md)
(the lane model for a service with one counter store), and
[0027](0027-a-test-is-selected-by-what-it-executed.md).

## Purpose

Go has the best-placed owner of any language here, and the least built on it.
`go test -cover` rewrites every basic block into a counter assignment, Go 1.20
added `runtime/coverage` with `ClearCounters` and `WriteCountersDir`, and `go
build -cover` with `GOCOVERDIR` records a whole binary, a service included. Per
test, per region and across processes are all reachable from what the toolchain
already ships. What is missing is the reader that gives those blocks an identity
that survives an edit, and the seam that cuts the counters per test.

The selection returned is what `go test` already takes: a package list and a
`-run` expression per package. The `go test` result cache stays in charge of
whole packages; this narrows inside a package it would rerun, and never turns
it off.

## Existing solutions

No open-source tool below records per-test coverage and ships it except one,
and it is early. Everything else is package or target grain.

| Tool | Grain | How it decides | Source |
| --- | --- | --- | --- |
| `go test` result cache | package (the test binary) | same binary, cacheable flags, and unchanged files and env vars the test read | [go help test](https://pkg.go.dev/cmd/go) |
| digitalocean/gta | package | git diff, then the reverse import graph | [github](https://github.com/digitalocean/gta) |
| jharlap/affected | package | git range, then transitive package dependencies | [github](https://github.com/jharlap/affected) |
| Symflower test impact analysis | package | git diff, then package dependencies; 29% average time saved over six open-source repositories (Tailscale 38%, go-ethereum 37%, Hugo 11%) | [blog](https://symflower.com/en/company/blog/2024/test-impact-analysis/) |
| Bazel `rules_go`, target-determinator | Bazel target, usually one `go_test` per package | input hashes at two commits | [target-determinator](https://github.com/bazel-contrib/target-determinator) |
| Uber Changed Targets Calculation | Bazel target | a Merkle tree over each package's inputs; CI build time halved | [blog](https://www.uber.com/blog/how-we-halved-go-monorepo-ci-build-time) |
| emoss08/assay | line, per test | clears and snapshots `runtime/coverage` counters between tests; v0.6.0, no published test overhead | [github](https://github.com/emoss08/assay) |
| Datadog Test Impact Analysis (Orchestrion) | test function, mapped to files | skips a test whose covered files are identical to a commit where it passed; needs `-covermode=count` or `atomic` and `-coverpkg` over every dependency | [docs](https://docs.datadoghq.com/tests/test_impact_analysis/setup/go/) |
| SeaLights Go agent | method | a method-entry call prepended at build time; sends the runner a skip list | [docs](https://documentation.tricentis.com/sealights/en/content/sealights/sealights_go_agent.htm) |
| Teamscale | method, test-wise | accepts Go coverage uploads; a Go test-wise profiler is not documented | [docs](https://docs.teamscale.com/reference/cli/teamscale-build/) |
| Launchable (CloudBees Smart Tests) | not documented for Go | a model over test history, not coverage | [docs](https://help.launchableinc.com/resources/integrations/go-test/) |

The Go team declined a testmon equivalent: [golang/go#35534](https://github.com/golang/go/issues/35534)
was closed on the grounds that the package cache covers it.

## Research

No peer-reviewed paper on regression test selection for Go was found (web, the
arXiv API; Semantic Scholar and DBLP were not reachable, so one indexed only
there may exist). The general background is Yoo and Harman,
[*Regression testing minimization, selection and prioritization: a survey*](https://dl.acm.org/doi/abs/10.1002/stv.430),
STVR 22(2), 2012. The only Go figures are industrial: Symflower and Uber above.
A measured function- or region-grain result on public Go code would be the
first.

## What would discharge it

**1. A Go reader.** tree-sitter-go in the addon, as ADR-0074 lays out. Resolution
is the module path in `go.mod` plus the package directory; every file of a
package sees every other with no import, as a Java package does, so a file asks
for its own package. `_test.go` files in package `foo_test` are a second
package in the same directory. `go.work` names the modules of a workspace. A
build constraint (`//go:build`, `_linux.go`) is recorded as an edge and walked,
because the reader does not know the target the test will build for.

**2. Regions and a both-texts verdict.** A region is a function, a method, an
`if`/`else` arm, a `case` of `switch` and `select`, a loop body and a function
literal. Its identity is its address in the tree plus a digest of its own text.
The verdict is `none` for comments and formatting (`gofmt` output changes
nothing that runs), `bodies` for edits inside functions, `values` for a changed
package-level `var` initializer, `const` or `init()`, charged to the functions
that read it, and `load` when an `init()` or import set changes.

**3. The recorder rides the cover counters.** Tests build with
`-cover -covermode=atomic -coverpkg=<the module>`; `atomic` is required because
`ClearCounters` refuses the other modes. A cover block is a line and column
range, so each block is charged to the innermost region containing it; the
mapping is read once per build from the meta-data file, never recomputed from
source at the far end. Counters are cleared before a test and written after it.
The seam that owns "before" and "after" is the open question: `TestMain`
brackets the whole binary, not each test, and `go test -json` reports
boundaries from outside the process. The candidates are a `testing` hook the
user installs once in `TestMain`, or one process per top-level test through
`-run '^TestX$'`, measured against each other.

**4. Parallel tests are a containment problem, not a new one.** `t.Parallel()`
runs tests at once over one counter store, which is exactly
[0073](0073-a-test-owns-the-files-its-services-ran.md)'s reset problem. Tests
that overlapped are recorded as one group whose rows are the union, or as
incomplete; either widens, neither misses. A goroutine a test leaves running is
reported by name at the test's end, as the JVM listener reports a live thread.

**5. What no counter sees selects by reach.** A changed `const` is inlined by the
compiler into its readers. A `//go:embed` file, a `//go:generate` input, a
`testdata/` fixture and a struct tag read by reflection (`json:"…"`) run no
code in the file that declares them. The verdict names each kind and the
static walk answers it.

**6. A Go service is a journey participant.** A binary built with `go build
-cover` runs in a lane, as in 0073. Its counters are written at the attempt's
boundary through `WriteCountersDir`, because the default write happens only on
a clean exit and a panic loses it. The id arrives the way ADR-0070 says, as a
`baggage` member or an OpenTelemetry trace id, and it travels on
`context.Context`, which Go code already threads by hand. The part is a VAREC
inventory under a Go recipe, which the native fold reads under any recipe.

**7. Measured on public code.** One of the repositories Symflower measured
(Tailscale or Hugo) is replayed commit by commit: the go test cache, gta,
this selection at package grain and at region grain, with seeded faults as in
[`jvm/measure`](../../jvm/measure/README.md). The recording cost is measured
against a bare `go test` and against `-cover` alone.

## Acceptance

1. `variance reach` lists `.go` files, and a change to one file selects the
   packages that import its package and the files of its own package.
2. A comment or `gofmt` edit selects nothing. An edit inside one function
   selects only the tests whose rows name that function's regions.
3. A changed package-level `const` selects every test that reads it, including
   those whose rows lack the declaring file.
4. The selection is given as `-run` expressions per package, and a package the
   result cache would skip is left to the cache.
5. Two `t.Parallel()` tests never produce a row that misses a region either ran.
6. A Go service in a lane, called from a Jest or Playwright case, adds its
   regions to that case's journey.
7. The replay reports tests run and faults missed for each selector, and the
   recording cost against a bare run.

## Boundary

cgo, assembly and generated code without a `//line` directive are recorded as
files, not regions. A test that shells out to another binary is a process edge,
and follows [0036](0036-a-journey-crosses-processes.md).
