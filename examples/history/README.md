# What a token has drifted to, across many approved reviews

Every review here is correct on its own. A card's padding goes 16px → 18px, one
person looks at two near-identical screenshots and approves it. Then 18px → 20px,
approved. Then 20px → 22px, approved. Nobody ever saw the card grow by 6px,
because nobody was ever shown that.

This example runs a history service next to the suite, so the run can be asked.

## 1. Start the record and the app

The service is a Node process, a SQLite file and a port. Pick a token — any
string of 16 characters or more — and export it in every terminal you use here:

```bash
npm install
npx playwright install chromium
export VARIANCE_HISTORY_TOKEN=example-history-token
```

In one terminal:

```bash
npm run history
```

```
variance-authority history service listening on http://127.0.0.1:7788
  database: /path/to/example-history/variance-history.db
  storage:  node:sqlite on 26.7.0 — a built-in, nothing was compiled to install it
  auth:     bearer token from VARIANCE_HISTORY_TOKEN
```

In another, the billing page this example watches:

```bash
npm start
```

## 2. Take the first look

A run that writes to the record has to be able to name itself, so that a value
in it can be traced back to a change:

```bash
npx variance run --run 1 --commit $(git rev-parse --short HEAD)
npx variance accept billing
```

```
1 new

[new] billing: no baseline for `billing` under this renderer; nothing to compare against
```

```
accepted 1 subject(s)
  [accepted] billing — images/billing.after.png
  recorded 1 acceptance(s) in the history record
```

In CI you pass neither flag — GitHub, GitLab and Bitbucket already put both in
the environment, and the run reads them from there.

## 3. Approve three small changes

Open [src/styles.css](src/styles.css), raise `--card-padding` from `16px` to
`18px`, and go round again:

```bash
git commit -am "Loosen the billing card"
npx variance run --run 2 --commit $(git rev-parse --short HEAD)
npx variance accept billing
```

```
[changed] billing: 2439 pixel(s) differ across 3 region(s), and the subject resized from 900×145 to 900×149
```

Four pixels taller. Approve it — it is fine. Do `18px` → `20px` the same way as
run `3`, accept that too, then make the last edit, `20px` → `22px`, and run
without accepting:

```bash
npx variance run --run 4 --commit $(git rev-parse --short HEAD)
```

```
[changed] billing: 2471 pixel(s) differ across 2 region(s), and the subject resized from 900×153 to 900×157

DRIFT: 1 token(s) moved in this run, and the record says what they have
  drifted to across every approved change in the window. No single review saw these
  totals, because each of them approved one step:
    `--card-padding` drifted 16px → 20px, 4px across 2 approved commit(s) (2026-08-27T22:54:41.603Z → 2026-08-27T22:54:44.134Z); the largest single step was 2px, so no per-change review could have seen the total
```

The four-pixel line is what this run did. The DRIFT block is what the earlier
approvals did *together*, and it is the sentence a reviewer needs in order to
decide whether 22px is a fourth reasonable step or the point at which somebody
should say stop.

## 4. Put it in the pull request

```bash
npx variance comment
```

```markdown
## Visual variance — 1 subject(s) need review

### Further than any single review saw

1 token moved in this run, and the record sums every approved change in the window. No review saw these totals, because each of them approved one step:

- `--card-padding` drifted 16px → 20px, 4px across 2 approved commit(s) (2026-08-27T22:54:41.603Z → 2026-08-27T22:54:44.134Z); the largest single step was 2px, so no per-change review could have seen the total
```

Drift is printed above the causes, because it is the part of the comment that
nothing else in the pipeline can tell you.

## Why the drift stops at 20px when the page is at 22px

Because 22px has not been approved yet. The record sums what shipped, and this
run's own change is a proposal — the reviewer reading the comment is the person
who decides whether it joins the total. Accept run `4`, move the token again,
and the drift on the next run reads `16px → 22px, 6px across 3 approved
commit(s)`.

It is also why three approvals were needed before anything was reported. Two
recorded values are one step, and one step is the change in front of you, not a
trend.

## Why you never listed `--card-padding`

You didn't. There is no token list in
[variance.config.json](variance.config.json). The custom properties resolved on
a subject are read along with its pixels, so a token starts being followed the
moment the page uses one and stops when it doesn't.

The corollary: a value hard-coded at the point of use is invisible to this. Had
`padding: 22px` been written straight into `.card`, the run would still have
caught the four pixels and would have had nothing to say about the crawl.

## Running the service for real

Four environment variables are the whole configuration:

| variable | |
|---|---|
| `VARIANCE_HISTORY_TOKEN` | required, 16 characters or more; every request must carry it as a bearer token |
| `VARIANCE_HISTORY_DB` | the SQLite file, `variance-history.db` beside the process by default. Back this up — it *is* the record |
| `VARIANCE_HISTORY_PORT` | defaults to `7788` |
| `VARIANCE_HISTORY_HOST` | defaults to `127.0.0.1`, which is not reachable from another machine |

The suite side is four lines of [variance.config.json](variance.config.json):

```json
"history": {
  "endpoint": "http://localhost:7788",
  "token": { "env": "VARIANCE_HISTORY_TOKEN" }
}
```

`{ "env": "NAME" }` is a config file naming the variable a secret lives in, so
the config can be committed. Leave the variable unset and the run stops with
exit code `2` before it renders anything:

```
variance.config.json: `history.token` names the environment variable "VARIANCE_HISTORY_TOKEN", and it is not set. The config is right and the value is missing, so nothing was substituted here
```

Nothing in the database is ever updated. A value is written once and an approval
is a later row that refers to it — which is why the drift above could be
computed at all. The record still holds every step, including the ones each
review saw in isolation.

## What is where

| file | what it does |
|---|---|
| [server.mjs](server.mjs) | stands in for your application; serves one page |
| [src/styles.css](src/styles.css) | holds `--card-padding`, the token that drifts |
| [variance/routes.mjs](variance/routes.mjs) | the one URL to read |
| [variance.config.json](variance.config.json) | the subject, and where the record lives |
