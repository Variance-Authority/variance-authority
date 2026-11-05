<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/tribunal

> A self-hosted review service for Variance Authority baselines, history and per-subject decisions.

Part of [Variance Authority](https://variance-authority.dev).
Point your coding agent at [`llms.txt`](https://variance-authority.dev/llms.txt).

Install this package when you want a place — yours, on your infrastructure — where
a finished run lands, a person looks at what changed, and approves or rejects it
per **subject**: one named UI state you asked for and can ask for again, such as
`cart/empty`, identified here by a string id like `story:card`.

It gives you a service you run: a database of builds, decisions and history, an
object store of images, an HTTP API, and a React review page. It is not a hosted
endpoint, and it does not render anything or decide anything — producing runs and
verdicts is [`@variance-authority/cli`](https://variance-authority.dev/reference/packages/cli)'s job.

Two deployments ship. The first needs no account.

## Run it on your own machine

```bash
npm install @variance-authority/tribunal
```

```bash
VARIANCE_TRIBUNAL_PROJECT=todomvc \
VARIANCE_TRIBUNAL_INGEST_TOKEN=ingest-token-0123456789 \
npx variance-authority-tribunal
```

```
variance-authority tribunal listening on http://127.0.0.1:7789
  project:  todomvc
  database: /home/you/variance-tribunal.db (schema version 21)
  objects:  /home/you/variance-tribunal-objects
  review:   served at http://127.0.0.1:7789 to loopback
  ingest:   token
```

Open `http://127.0.0.1:7789` and you are on the review page. The SQLite file and
the image directory are created and migrated on start; the token is invented
above and is long enough — the service refuses a token under 16 characters.

Then point a suite at it. In your `variance.config.json`, `review.endpoint` is
where `variance push` sends a finished run, and the token it presents is the
**ingest** token:

```jsonc
// variance.config.json — `review` is the part this page is about; the rest is
// your suite's, and is what it already was.
{
  "project": "snkr-shop",
  "profile": "chromium",
  "retention": "durable",
  "viewport": { "width": 1280, "height": 800 },
  "subjects": { "kind": "collector", "collector": "variance/collector.mjs" },
  "baselines": { "kind": "directory", "root": "baselines" },
  "report": "out/report.json",
  "review": {
    "endpoint": "http://127.0.0.1:7789",
    "token": { "env": "VARIANCE_INGEST_TOKEN" }
  }
}
```

```bash
variance run
variance push --branch "$(git branch --show-current)"
```

Reload the page and the build is there.

To keep approved images in this service too — so approval stops being a commit —
add `baselines` beside it:

```jsonc
// variance.config.json — `retention` and `baselines` are what changed; the
// `review` section above stays as it is.
{
  "project": "snkr-shop",
  "profile": "chromium",
  "viewport": { "width": 1280, "height": 800 },
  "subjects": { "kind": "collector", "collector": "variance/collector.mjs" },
  "report": "out/report.json",
  "retention": "durable",
  "baselines": {
    "kind": "remote",
    "endpoint": "http://127.0.0.1:7789",
    "token": { "env": "VARIANCE_INGEST_TOKEN" }
  },
  "review": {
    "endpoint": "http://127.0.0.1:7789",
    "token": { "env": "VARIANCE_INGEST_TOKEN" }
  }
}
```

### What the environment sets

`variance-authority-tribunal` takes no flags and reads no arguments; passing
`--port` is refused by name rather than ignored; `--help` names every variable.
Every name a [declared mechanism](#deploy-it-on-cloudflare) reads is read here
under this prefix, as `VARIANCE_TRIBUNAL_GITHUB_REPOSITORY`.

| variable | default | what it decides |
|---|---|---|
| `VARIANCE_TRIBUNAL_PROJECT` | required | scopes every row and every object key, so one deployment serves several repositories without their `story:card` colliding. There is no default: an invented one puts two projects' baselines in one namespace and the first symptom is a mass `changed` |
| `VARIANCE_TRIBUNAL_INGEST_CREDENTIALS` | `token` | what may write a run: `token`, `github-actions`, or both, separated by a comma |
| `VARIANCE_TRIBUNAL_INGEST_TOKEN` | required with `token` | written into CI. Writes builds, baselines and history. 16 characters or more |
| `VARIANCE_TRIBUNAL_REVIEW_CREDENTIALS` | `loopback` on a loopback bind, otherwise unset | who may decide: `loopback`, `github`, `access`, or several, separated by a comma. `loopback` refuses to start on a network bind |
| `VARIANCE_TRIBUNAL_VIEW` | unset | `public` opens reading to anybody, who cannot decide. It takes no other value |
| `VARIANCE_TRIBUNAL_SHARE_TOKEN` | unset | given to machines that read and never decide: the share, the changelog and the decision history. 16 characters or more, and not the ingest token. Unset, only an ingest credential opens the share |
| `VARIANCE_TRIBUNAL_PORT` | `7789` | a whole number from 0 to 65535, or the process refuses to start |
| `VARIANCE_TRIBUNAL_HOST` | `127.0.0.1` | the bind address. Any address other machines can connect to also needs `VARIANCE_TRIBUNAL_TRUST_NETWORK` |
| `VARIANCE_TRIBUNAL_DB` | `variance-tribunal.db` | the SQLite file. Created and migrated on start; the startup line prints its absolute path and its schema version |
| `VARIANCE_TRIBUNAL_STORAGE` | `variance-tribunal-objects` | the directory that stores baseline and candidate bytes |
| `VARIANCE_TRIBUNAL_RETENTION_DAYS` | `30` | days of builds `POST /review/sweep` keeps |
| `VARIANCE_TRIBUNAL_REVIEWER` | the OS user | the name `loopback` writes on decisions |
| `VARIANCE_TRIBUNAL_TRUST_NETWORK` | unset | confirms a non-loopback bind; what that costs is below |
| `VARIANCE_TRIBUNAL_ORIGIN` | the request's `Host` | the address people reach this at, such as `https://review.example.com`. Set it behind a proxy that terminates TLS, because sign-in hands this address to GitHub |

**On loopback, a browser is a reviewer.** The bare URL serves the review page,
and a caller with no bearer decides as `VARIANCE_TRIBUNAL_REVIEWER`: anything that
can open `127.0.0.1:7789` is already running as the person who started it. A
bearer is read as a machine here too, so a wrong one is refused.

**On a network bind nobody decides until you declare who**, and the review page
is served only once `VARIANCE_TRIBUNAL_REVIEW_CREDENTIALS` names somebody. There
is no TLS here and no rate limit, so there would be nothing between an approve
button and the internet. For a reviewer who is not at the machine, declare
`github` or `access` behind a proxy that terminates TLS, with
`VARIANCE_TRIBUNAL_ORIGIN` naming its address, mount the Next.js adapter
behind your own sign-in, or leave the process on loopback behind a proxy that
authenticates.

The tokens are never printed and never rendered. The startup line names the
mechanisms, not their values, and the served page has no credential in it: the
browser calls the service, and `GET /auth/me` says who it is.

## Words this page uses

| word | what it means here |
|---|---|
| subject | one named UI state you asked for and can ask for again — a story, a route, a fixture — identified by a string id such as `story:card` |
| verdict | the per-subject outcome a run decided: `unchanged`, `changed`, `new` or `ignored`. Decided by the CLI, stored here |
| shape | the digest of one distinct difference, computed from the changed pixels alone: the region cropped to its box, resampled onto a fixed grid, with its aspect and size bucketed beside it. Two subjects that changed the same way share one shape, so one token edit across forty stories is one shape. The component is not part of it, so the same-looking change in `Avatar` and in `Badge` is one shape too |
| cause | a flag on a changed region: the analysis attributed that region to a component's own edit rather than to something upstream of it |
| collateral | pixels that moved because something else did — every changed region not flagged a cause. Counted once for the build, never split between causes |
| the record | the history rows every run appends: which component hashes changed for which subject, and the token values resolved at the time. `POST /v1/observations` writes it; the `/v1` reads derive from it |
| docket | the reviewer's list of causes for one build, one entry per component, largest first |

## Deploy it on Cloudflare

The database is D1, the object store is R2, the runtime is a Worker. Everything
above the bindings takes a `D1Like` and an `R2Like` and names no runtime, so the
routes, the refusals and the status codes are one module serving both
deployments. What differs is underneath them — see
[Operational boundaries](#operational-boundaries).

The package ships the deployable Worker, its review page and its migrations.
**The one file you edit is yours and lives in your repository, not in
`node_modules`** — a project of your own, with the package installed into it.

```bash
npm install @variance-authority/tribunal wrangler
npx variance-authority-tribunal-provision --config wrangler.jsonc
```

When `wrangler.jsonc` is absent the command writes it, named for the repository:

```jsonc
// wrangler.jsonc — yours, in your git
{
  "$schema": "https://developers.cloudflare.com/schemas/wrangler.json",
  "name": "todomvc-tribunal",
  "main": "node_modules/@variance-authority/tribunal/dist/worker-entry.js",
  "compatibility_date": "2026-08-05",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "todomvc-tribunal",
      "database_id": "",  // provisioning writes it
      // The package's generated migrations, read where they are installed. Never
      // copied: a database migrated by a copy that drifted is a second schema
      // history wearing the same name.
      "migrations_dir": "node_modules/@variance-authority/tribunal/migrations"
    }
  ],
  "r2_buckets": [{ "binding": "BUCKET", "bucket_name": "todomvc-tribunal" }],
  "assets": { "directory": "node_modules/@variance-authority/tribunal/dist/public" },
  "vars": { "PROJECT": "todomvc" },
  "observability": { "enabled": true }
}
```

`main` and `assets.directory` point into the installed package, so there is no
Worker module of yours to write, and an upgrade is an install, the migrations
below and a deploy.

`variance-authority-tribunal-provision` makes what the config names and writes
back what it learns, so nothing is copied out of a dashboard. It creates the D1
database and the R2 bucket, writes the database's id into `database_id`, and
applies the migrations. It declares `INGEST_CREDENTIALS=github-actions` and
`REVIEW_CREDENTIALS=github` in `vars`, keeping any you wrote there, and fills in
what those two need for the repository, read from `gh` or named with `--repository
owner/name`; a run for a second repository adds it to
`GITHUB_ACTIONS_REPOSITORIES`. For `github` it registers a public GitHub App with
`metadata: read` from a manifest: you confirm one page in the browser and install
the App on the repository. It mints `GITHUB_SESSION_SECRET`, deploys, and prints
what a suite adds:

```jsonc
"baselines": {
  "kind": "remote",
  "endpoint": "https://todomvc-tribunal.you.workers.dev",
  "token": { "github-actions": { "audience": "https://todomvc-tribunal.you.workers.dev" } }
}
```

```yaml
permissions:
  id-token: write
```

Every run prints these, so you can run it again to read them. A second run changes
nothing else and says so. `--skip-deploy` leaves publishing to a deployment with
its own build, and `--mount /api` names where such a deployment serves the API.
`--rotate` replaces the session key, and the ingest token where `token` is
declared.

A run refuses a repository the deployment does not already name, rather than
widening who may push: add it to `GITHUB_ACTIONS_REPOSITORIES` in `vars` yourself.

The ingest token exists only when you declare `token`. The command then mints
`INGEST_TOKEN` into the Worker and the same value into the repository's
`VARIANCE_INGEST_TOKEN` secret, without printing it. When one side fails, the run
says which, and `--rotate` replaces both.

When your Cloudflare login is missing, the command runs `wrangler login`. When the
login sees several accounts, it lists them and stops until `account_id` picks one.
When R2 is off on the account, it prints the dashboard address where you enable
it; run the command again afterwards. A deployment that declares `access` gets no
App, and its two values come from [your company's SSO](#your-companys-sso).
`SHARE_TOKEN` is optional and set by hand: `wrangler secret put SHARE_TOKEN`,
16 characters or more and not the ingest token.

`wrangler d1 migrations apply` is what puts the schema into your database, and
Wrangler records which steps it has applied — so run it again after you upgrade
the package, as `npx wrangler d1 migrations apply todomvc-tribunal --remote`. A
release that adds a step applies that step alone; one that adds none applies
nothing. `GET /version` reports the schema version the deployed build expects.

`INGEST_TOKEN`, `SHARE_TOKEN`, `GITHUB_CLIENT_SECRET` and `GITHUB_SESSION_SECRET`
are secrets rather than `vars`: they are the deployment's capabilities, and
`wrangler.jsonc` is in your repository.

`worker-entry` reads two bindings, two settings and what you declared. A
mechanism's name in the kind column means the value is read only with that
mechanism declared:

| name | kind | what it decides |
|---|---|---|
| `DB` | binding | D1. Rows: builds, verdicts, decisions, baseline metadata, history observations |
| `BUCKET` | binding | R2. Baseline and candidate bytes, and the share; never a row |
| `PROJECT` | var, default `default` | scopes every row and object |
| `RETENTION_DAYS` | var, default `30` | days of builds `POST /review/sweep` keeps. A value that is not a positive finite number falls back instead of sweeping everything |
| `INGEST_CREDENTIALS` | var | what may write a run: `github-actions`, `token`, or both, separated by a comma |
| `REVIEW_CREDENTIALS` | var | who may decide: `github`, `access`, or both, separated by a comma. Behind [your company's SSO](#your-companys-sso) it is `access` alone, because a second way in undoes the list of approvers. `loopback` is the Node service's alone |
| `VIEW` | var, optional | `public` opens reading to anybody, who cannot decide. It takes no other value |
| `GITHUB_ACTIONS_REPOSITORIES` | var, `github-actions` | whose workflows may push: `owner/name` separated by commas, any case, or `owner/*` |
| `GITHUB_ACTIONS_AUDIENCE` | var, `github-actions` | the audience a workflow's token must name |
| `GITHUB_ACTIONS_BASELINE_REF` | var, `github-actions` | the one ref whose workflows move baselines, such as `refs/heads/main`. Any other ref still pushes builds and reads |
| `GITHUB_ACTIONS_ISSUER` | var, optional, `github-actions` | the token's issuer. Default `https://token.actions.githubusercontent.com` |
| `GITHUB_REPOSITORY` | var, `github` | `owner/name`: whoever can write to it decides |
| `GITHUB_CLIENT_ID` | var, `github` | the GitHub App's client id |
| `GITHUB_CLIENT_SECRET` | secret, `github` | the GitHub App's client secret. 16 characters or more |
| `GITHUB_SESSION_SECRET` | secret, `github` | signs the session cookie. 16 characters or more. Replacing it signs everybody out |
| `ACCESS_TEAM_DOMAIN` | var, `access` | e.g. `your-team.cloudflareaccess.com`, where the signing keys are published |
| `ACCESS_AUD` | var, `access` | the audience tag of the Access application that names the reviewers |
| `INGEST_TOKEN` | secret, `token` | written into CI. Writes builds, baselines and history. 16 characters or more |
| `SHARE_TOKEN` | secret, optional | given to machines that read and never decide: the share, the changelog and the decision history. 16 characters or more |

**Nothing is discovered.** Only the two lists turn a mechanism on. A declared
mechanism whose value is missing refuses by name, a committed value for a
mechanism you did not declare refuses by name, and two empty lists refuse because
they recognize nobody. An undeclared secret is logged and not read, so rotating
one out does not take a deployment down.

**With `github`, people sign in with GitHub** at `/auth/github/login`, and those
with write access to `GITHUB_REPOSITORY` decide, under their login. The session is
a signed cookie holding the login and an expiry, one hour out, and GitHub's token
is discarded after the sign-in, so somebody who loses write access stops deciding
within the hour.

**With `github-actions`, a workflow pushes with the token its runner signs**, so
no secret is stored anywhere. The job needs `id-token: write`, and a `token` of
`{ "github-actions": { "audience": "…" } }` in the suite's configuration asks for
it on use.

**With `access`, your company's SSO names the person**, through
[Cloudflare Access](#your-companys-sso). The service verifies the JWT against the
team's published keys and writes the decision under its email. A service token has
no email, so it decides nothing.

A bad environment answers **500 with a sentence**, not a deployment-wide platform
error: construction happens inside `fetch`, so *github is declared and needs
GITHUB_CLIENT_SECRET, which is not set* and *REVIEW_CREDENTIALS declares loopback
and this deployment is reachable from elsewhere* come back to you as the response
body.

`PROJECT` is a deployment setting, so one deployment serves one project; a second
tenant needs a second deployment.

`worker-entry` serves the review page as well as the API. With `github` declared,
a person who is not recognized goes to the sign-in. With `VIEW=public` they read
the same page with nothing to decide with, and a link to sign in.

### Your company's SSO

Cloudflare Access can sign people in through the provider your company already
runs, so tribunal needs no sign-in of its own for them: Okta, Microsoft Entra ID,
Google Workspace, or anything that speaks SAML or OIDC. Setting it up takes an
admin of that provider and an admin of the Cloudflare account, once:

1. Serve the deployment from a hostname in your Cloudflare zone, as a route with
   `custom_domain: true`, with `workers_dev` and `preview_urls` both set to `false`:
   Access guards a hostname, and any other address that reaches the Worker walks
   around it. Wrangler keeps an existing `preview_urls` when the key is absent, so
   write it down, and check that no other route or custom domain points at the
   Worker. `GITHUB_ACTIONS_AUDIENCE`, and the suite's `endpoint` and `audience`, name
   the new hostname.
2. In Cloudflare Zero Trust, add your company's provider as a login method. Its
   admin registers Cloudflare on their side.
3. Add a self-hosted Access application on the deployment's hostname, with a policy
   naming the people or groups who review. Everybody it lets in can decide, so this
   policy is your list of approvers. Give the same application the paths
   `review/builds/*` and `review/concerns/*`, under the mount if the API has one:
   step 4 opens their parents, and these are where a decision is recorded and a
   concern is raised or moved. In its cookie settings, set `SameSite` to `Lax`, so a browser
   holds the cookie back from another site's write before the service has to refuse
   it, and leave the cookie's path attribute off, because the page reads step 4's
   paths with that cookie.
4. Add a second application on the same hostname, with a Bypass policy for everyone,
   on the paths `auth/me`, `version`, `baseline`, `cache`, `v1`, `share`,
   `review/builds`, `review/have`, `review/changelog`, `review/decisions` and
   `review/concerns`, under the mount if the API has one. A workflow, a developer's
   CLI and the provisioner cannot sign in, and these are the paths they call. The service guards them instead of Access: it asks
   every request for its credential, a reviewer's browser still carries its Access
   cookie there, and Access logs nothing that bypasses it.
5. Set `ACCESS_TEAM_DOMAIN` to the team domain and `ACCESS_AUD` to the first
   application's audience tag, set `REVIEW_CREDENTIALS` to `access`, replacing
   `github`, and delete `GITHUB_CLIENT_ID` and `GITHUB_REPOSITORY` from `vars`.
6. Check that Access holds the paths from step 3, with a POST that has no cookie,
   with the mount in the address if the API has one:

   ```bash
   curl -si -X POST https://your-hostname/review/builds/any/subjects/any/decision
   curl -si -X POST https://your-hostname/review/concerns/raise
   ```

   Access answers with a redirect to sign in. An answer with
   `www-authenticate: Bearer` came from the service, so the request went past Access
   and step 4 won. The service still asks for a credential, but removing a reviewer
   then waits for their session to run out, so shorten the session.

Leave `VIEW` unset. Access keeps the page behind a sign-in, but with `VIEW=public`
the paths in step 4 answer anybody. An open project that wants public reading
declares `github` and `VIEW=public`.

To remove a reviewer, take them out of the policy and revoke their session in Zero
Trust, which ends everything they can write: every reviewer write sits on a path
from step 3. The paths in step 4 check only that their token is signed and
unexpired, so until the session runs out, that token still reads the evidence there. How long that is
comes from the application's session duration, or from the policy's if it sets one.
A shorter session closes that sooner.

## The HTTP API

Recognition happens before routing. A caller this deployment does not recognize
gets the same response for a wrong credential, a missing one, and a path that does
not exist. A machine sends `Authorization: Bearer <token>`: the ingest token, the
share token, or the token a workflow's runner signed. A bearer is read as a machine
and nothing else, so a wrong one is refused even with `VIEW=public`. A person sends
no bearer, and is recognized by the mechanism `REVIEW_CREDENTIALS` declares. A
write a browser sent from another origin, a sibling subdomain included, is not
recognized, whatever cookie it carries, under any policy. A bearer is the way to
write across origins on purpose. Only `GET /auth/me` and the sign-in answer a caller nobody recognized.

| method and path | capability | what it does |
|---|---|---|
| `GET /auth/me` | none needed | `{"capability":"review","name":"…","signIn":"…"}`: who this request is, and where a person signs in. Each key is absent when it has no value |
| `GET /auth/github/login[?return]`, `GET /auth/github/callback` | none needed | the sign-in, with `github` declared. `return` is a path on this deployment to come back to |
| `GET /version` | any | `{"service":"variance-authority-tribunal","api":6,"schema":21}` |
| `POST /baseline/find` | ingest | the approved image for a key, bytes and all |
| `POST /baseline/describe` | ingest | the same lookup without moving the image |
| `POST /baseline/put` | ingest, from `GITHUB_ACTIONS_BASELINE_REF` under `github-actions` | store an approved image |
| `POST /cache/find`, `POST /cache/put` | ingest | the render cache the same store backs |
| `POST /v1/observations` | ingest | append a run: its observations, its resolved token values, its instability reports. 204 |
| `POST /v1/approvals` | ingest, from `GITHUB_ACTIONS_BASELINE_REF` under `github-actions` | append which subjects were signed off in which run. 204 |
| `POST /v1/current` | ingest | a run asking what is currently recorded for a list of subject ids. A POST because three hundred ids in a query string is a 414 from a proxy nobody configured |
| `GET /v1/last-changed?subject&component[&band]` | ingest, review or view | the last observation in which that component's hash changed for that subject |
| `GET /v1/churn?component` | ingest, review or view | how often that component's own hashes changed, as a rate |
| `GET /v1/flakiness?subject` | ingest, review or view | how often that subject read differently from itself |
| `GET /v1/reach?component` | ingest, review or view | which subjects that component appears in now that it did not before |
| `GET /v1/value-journey?token` | ingest, review or view | how one design token's resolved values drifted across approved runs |
| `POST /review/builds` | ingest | file a finished run as a build. What `variance push` calls |
| `POST /review/have` | ingest | given image digests, which of them this deployment already has, so a push uploads only the rest |
| `GET /review/builds[?limit]` | review or view | recent builds |
| `GET /review/builds/{id}` | review or view | one build: its subjects, their verdicts, their regions, the docket |
| `POST /review/builds/{id}/subjects/{subject}/decision` | review | `{"decision":"approved"\|"rejected","by":"…","note":"…","baselineVersion":"…"}`. 409 when an approval's baseline moved since `baselineVersion` where this build changed it too, below |
| `GET /review/builds/{id}/subjects/{subject}/{before\|after\|diff}.png` | review or view | one image, immutable and cacheable |
| `GET /review/changelog[?component&subject&since&limit]` | review, share or view | every approval, grouped by shape |
| `GET /review/decisions[?build&subject&limit]` | review, share or view | every decision, newest first, reversals included: `{"decisions":[{"build","subject","decision","by","at","note"}]}`. Names `build`, `subject` or both; `limit` defaults to 200 and goes no higher |
| `POST /review/sweep[?days=N]` | review | retention, below |
| `GET /review/concerns[?build&subject&state]` | review, share or view | the concerns on a subject, or on every subject a build showed, with the build's `tally` per state |
| `POST /review/concerns/raise` | review | `{"build","subject","title","by","note","hypothesis","region":{x,y,width,height,component},"evidence":["…"],"state"}`. 201 |
| `POST /review/concerns/{id}` | review | `{"state":"open"\|"investigating"\|"resolved","by","note","hypothesis"}`: the next step of its trail |
| `GET /share/<mainline\|branch>/<line>/manifest.json` | ingest or share | the line's manifest, with its version as the `ETag`. 404 when nothing was published |
| `PUT /share/<mainline\|branch>/<line>/manifest.json` | ingest | replace the manifest. With `If-Match: <ETag>` it replaces only that version, and with `If-None-Match: *` only when there is none. A stale version answers 412, and a write with neither header answers 428 |
| `GET /share/<mainline\|branch>/<line>/entries/<sha256>` | ingest or share | one entry's bytes, immutable and cacheable |
| `PUT /share/<mainline\|branch>/<line>/entries/<sha256>` | ingest | store an entry. 400 when the bytes do not have that digest |
| `GET /share/images/<sha256>`, `PUT /share/images/<sha256>` | ingest or share to read, ingest to write | an image any line names, stored once for every line |

The four `/v1` reads take `since`, `until` and `limit` to bound the window, and
`project` where one deployment is queried for another's rows.

A decision and a concern are written under the name the request proved. `by` is
optional, and a `by` naming anybody else answers 403.

**A reviewer reads what runs recorded and never writes it.** The five reads answer
ingest, review and view because they derive from rows already recorded, and the
review page draws them. Concerns are not derived: a person wrote them, so raising
and moving them takes review, and reading them takes review, share or view.
`/v1/observations` and `/v1/approvals` take ingest because they write;
`/v1/current` takes ingest because its caller is a run deciding what to write.

**The share is for runs, not for reviewers.** `/share/` is the store an `http`
share reads and writes when its endpoint is this deployment:

```json
{
  "share": {
    "kind": "http",
    "endpoint": "https://variance.example.com/share",
    "token": { "env": "VARIANCE_SHARE_TOKEN" }
  }
}
```

`token` names the environment variable the CLI reads the token from, so one
configuration serves every machine and only the variable's value differs:

- **In CI, where a run publishes**, an ingest credential publishes and reads the
  share, so the job that runs the suite needs no new secret. Where `token` is
  declared, set `VARIANCE_SHARE_TOKEN` to the ingest token. Where `github-actions`
  is declared, `token` is `{ "github-actions": { "audience": "…" } }` instead, and
  the job needs `id-token: write`.
- **On a machine that only reads what CI published**, such as a laptop running
  `variance ask` or `variance serve`, set it to the share token: the value of
  `VARIANCE_TRIBUNAL_SHARE_TOKEN` on the Node deployment, or of `SHARE_TOKEN`
  on Cloudflare. With the share token a machine reads `/share/`,
  `GET /review/changelog`, `GET /review/decisions` and `GET /review/concerns`,
  and `GET /version` answers it as it answers every credential. Every other route
  answers 403 before it checks the method, so the machine cannot push a build,
  decide one or raise a concern. A path this deployment does not serve answers
  404, as it does for every token. A path under `/share/` that is not a line's
  manifest, one of its entries or an image answers 400 and names the three it
  could be.

A person is refused under `/share/`, reviewer or viewer: the share is what runs
read and write, and the review page never asks it.

**What review settled is read by a reviewer, a viewer or the share token, never
an ingest credential.** The changelog and the decision history are what an agent
or a developer's machine asks after the fact: was this subject approved, by whom,
and why. Give that reader the share token, which reads them and cannot decide. An
ingest credential is refused both, because CI holds it, and a build log has no
reason to read reviews.

Two writers publishing to one line do not lose each other's entries. Each writes
the manifest against the version it read, the one that lost answers 412, and
the client reads the winner's manifest, adds its own entries and writes again.
Share objects sit under `<project>/share/` in the bucket and have no rows, so
`POST /review/sweep` leaves them in place.

`api` is the wire contract, not the package version — it changes when what a
client may send or expect changes. `variance push` queries the API version
before it uploads and prints both numbers. A CLI newer than its deployment is
not an error: it works, and what the older deployment lacks shows up somewhere
else — before API 2 as upload it could have skipped and as an approved subject
that stays `new`, before API 3 as a share that is always empty, and before API 4
as a review page that answers 404 when you flag a concern, before API 5 as a
share token refused at `/review/changelog` with no `/review/decisions` to read,
and before API 6 as every baseline description refused as malformed.
Until something prints both numbers, neither looks like a version mismatch.

## What a reviewer sees

When `ReviewApp` is open on a build, in this order:

1. **The docket** — one entry per component the analysis named as a cause,
   largest first, with the file each is declared in. Ranked by cause pixels, not
   by total area, so a large container that only reflowed does not outrank the
   smaller edit that pushed it. Collateral is one number for the build.
2. **The regions, drawn on the render** — cause and collateral styled apart, each
   labelled with the component that owns it.
3. **The comparison** — swipe, onion, side-by-side, difference mask — last, and
   only the modes this build actually kept images for.
4. **The record, on request per subject**: how often this subject has failed to
   read the same way twice, how often its cause has caused an approved change,
   and how many subjects that component reaches. Fetched when a reviewer clicks
   *Has this changed before?* rather than with the build — a build with three
   hundred changed subjects would otherwise make nine hundred history requests to
   draw a page on which only one of them is read.

Step 4 is the question a before-and-after cannot answer. The same 2px shift is a
bug in a component nobody has touched since March and a Tuesday in one that
drifts in nineteen runs out of twenty. Two numbers are drawn as missing rather
than as zero: a flake rate is **absent** until a run has read every subject
twice, and a coverage that was never stated is unknown rather than clean.

A render you decide on, whose candidate is the same image an earlier build kept,
says so under its name. A candidate is stored under the SHA-256 of its
bytes, so two builds that kept one key for a subject kept one picture. Only
builds rendered by the same identity count: a baseline is kept per identity, so
a decision made on another engine or platform says nothing about this one. The
line names the earlier build, links to the subject there, and gives the decision
made on it with who made it. **An image an earlier build rejected** is drawn as a
rejection: it is a render you already rejected, not a new defect. You can still
approve it, since accepting a known defect is how the change it blocks gets
merged, and the approval then opens a concern titled with the build that
rejected it, carrying who rejected it and their note, so the defect stays on record. The
decision's answer carries the concern's id as `concern`. A second approval in
the same build opens no second concern, and neither does an image whose latest
earlier decision approved it. **An image
approved before this build ran, on a render that still differs from its
baseline**, is drawn as a warning, and the line says only that: the render may
alternate, a change may have been reverted, or the baseline moved again. An
approval made after this build ran replaced the very baseline this build was
compared to, so it is named without the warning. Only builds this deployment
still keeps are counted, so a build removed by `POST /review/sweep` is not named.
A render that is `unchanged` or `ignored`, or kept no candidate, has no line.

*Approve* and *Reject* sit at the top right of the render, beside its name, and
stay there while the picture scrolls. A decided render shows who decided it,
when and why, and both stay live. A render whose image the run did not keep
offers neither, and the page says why beside them. An image on screen with no
document behind it can be rejected, not approved: it cannot become a baseline.
Everything else sits in one bar under the picture, with where the render stands
in the rail — *2 of 5*, or *not in the queue* for one opened by a link.
Single keys reach the moves that cost nothing to undo: <kbd>J</kbd> and
<kbd>K</kbd> walk the rail in the order it is drawn, <kbd>F</kbd> opens a
concern and <kbd>I</kbd> opens one already under investigation, as
*Investigate* does. *Approve* and *Reject* have no key, because a key that
promotes a baseline is a key pressed by accident. No key fires while a modifier,
Shift included, is held, while the focus is in a text field or anywhere in a
form, or as a held key repeats; a slider such as the wipe keeps them. While the
concern form is open, J and K do nothing wherever the focus went, so no key
leaves a draft behind; *Next* and *Previous* still move. F and I on an open
form change its state and keep what was typed.
On a layout that does not type Latin letters, the keys are the ones in the
same place. *Keys off* at the end of the bar turns
every single-letter key off, for speech input and screen readers that take
letters as their own commands; the browser remembers the choice.

A render you would not approve and cannot yet call wrong has a third answer.
*Looks suspicious*, in the bar, raises a **concern**: a
title, the region you mean or the whole render, the components, files or the
baseline you are pointing at, a note and your hypothesis. It moves between
open, investigating and resolved, each step with a name on it. It stays on the
subject, shown with its trail on every later build that reports it; resolving it
closes it without removing it. Its region is a place on the image of the build
it was raised in, so it names a place nobody can see once that build is swept;
the component it carries still says what was there, as `Button · 24×18 at
154,85`. A concern and a decision never settle each other: approving does not resolve
a concern, and resolving one approves nothing. One approval does open a concern:
approving an image an earlier build rejected, which accepts a known defect and
keeps it on record. The build's header counts the
concerns its subjects carry, and says so when it could not read them rather than
showing none.

The top of the rail names the work a build still asks for: **Unreviewed**,
**Open**, **Investigating** and **Resolved**, each with the number of renders
it covers. *Unreviewed* counts what the header's *awaiting review* counts; the
other three are the states a concern moves through. Two concerns on one render
count once, since a render is what you open. Choosing a task narrows the rail to
its renders, and J, K and the bar walk that list. The render on screen keeps its
place in that list until you move on, even once approving it or resolving its
concern takes it out of the task, so J still goes to the row below. The header's
own line counts concerns, not renders, as
`concerns: 2 open · 1 investigating · 0 resolved`. The address carries the
task, as `?task=open`, so a link opens the same list. A concern task includes renders the build left unchanged: a concern
raised two builds ago still stands on a render that has not moved since, and
nothing else on the page would lead you to it. A task with nothing in it cannot
be chosen. When the concerns could not be read, the three concern tasks show `?`
and say why instead of a count of zero.

The run page — *what this run read*, one link from the docket — shows **where
the subjects parted**, when the build was instrumented with probes and so has
a [journey](https://variance-authority.dev/docs/journeys) for each subject. The
record `variance journeys` prints per module is turned round to face the subject:
the stretches of source (a function body, a branch, a `case`) this subject
covered that another subject of the same module did not, and the ones it missed
that another covered, with the file and the lines. The count of subjects the
journal covers is drawn even when nothing parted: no partings among five subjects
is agreement, and among one it is nothing at all. A build with no journal draws
no panel.

The same page lists the run's **variations**: each subject read against the
subject it varies from, with the pair that renders one image first. Each pair is
drawn as its two pictures, parent first, at one scale and at their own pixel
grid, and each picture links to its subject's page. A side shows its candidate
when the run kept one and its baseline, labelled `baseline`, when the run kept
only that. A side the run kept no image for, or never read, says which instead of
drawing an empty frame, and one it never read has no page to link to. A variation
whose parent the run did not observe draws the one picture it has. A capture
too large for its tile even at quarter size, such as a full route, is drawn at a
quarter and cropped to its top-left corner, and says so: smaller, the rows that
survive are the sampler's choice.

A family — a base and every subject that varies from it — that varies on exactly
two axes, every link read by the configured name format, is drawn first as a
grid, the base in the corner and one scale for the whole grid. The axis the
format lists first runs down. The combination where both axes meet sits beside
its two arms, and a combination nothing in the family is at says which two
values it is missing. The pairs stay listed underneath with what each measured, without
repeating their pictures.

**Stories of one component that render the same image** are named on the
docket, though no diff shows them: both are `new`, or both changed the same
way, and neither is red. A story whose candidate is byte for byte its sibling's is an arm
whose flag reaches no pixel, or one state under two names (`dark-narrow` and
`narrow-dark`). The build already stores every candidate under the SHA-256 of
its PNG, so the grouping reads the keys it holds and asks the run for nothing
more. Stories are grouped only within their component, the part of the id
before the first `--`; an id with no `--` is a component of one. Only stories
whose candidate the build kept are compared. A story that settled on its
baseline's digest kept none, so a pair is named only on a build where both are
`new` or both changed, and a new arm beside a base that settled is not. A subject
page lays its component's stories side by side and marks the ones that are one
picture.

The `Changelog` tab is the same evidence at project scale.

## The changelog

A build reports what changed today; `GET /review/changelog` returns what was
*approved*, grouped by shape rather than by which screenshot changed — so a token
edit across forty stories is one entry, not forty.

```ts
// runnable as written: `testing` supplies an in-memory database and bucket
import { createReviewStore } from '@variance-authority/tribunal/review';
import { createMemoryR2, createSqliteD1 } from '@variance-authority/tribunal/testing';

const review = createReviewStore({
  db: await createSqliteD1(),
  bucket: createMemoryR2(),
  project: 'todomvc',
});

const { changes, ungrouped } = await review.changelog({ component: 'Card', limit: 50 });

changes[0]?.subjects;  // approved subjects this shape landed in, newest first
changes[0]?.by;        // everyone who approved part of it
changes[0]?.builds;    // where the approvals came from
```

`changelog` takes `component` (substring, case-insensitive), `subject` (exact),
`since` (ISO 8601) and `limit` (default 500). The route takes the same four as
query parameters, refuses a `limit` above 500 with 400, and answers a reviewer, a
viewer and the share token.

`decisions` is the history under the approvals: every decision recorded,
rejections and reversals included, newest first. It takes `build`, `subject` and
`limit` (default 200), and `GET /review/decisions` takes the same three. The route
refuses a reading that names neither a build nor a subject, and a `limit` above
200, with 400.

**One row is written per approval, and its columns are copies, not a join.** The
regions, the commit, the intent and the reviewer are frozen at the moment of
approval rather than read live from `builds` and `build_subjects`, because a
sweep removes builds and a baseline's explanation has to outlive them.

**Nothing is written for a rejection.** It is recorded in `decisions`, but no
baseline changed.

**Shapes are grouped when somebody reads**, not when a row is written — approval
here is per subject, so there is no batch at write time to cluster, and a shape
approved across several sessions still reads as one change. Approved subjects
that no shape could group are returned as `ungrouped`, not dropped.

## Entrypoints

| entrypoint | requires | exports |
|---|---|---|
| `@variance-authority/tribunal` | nothing | the binding types, `SCHEMA`, `applySchema`, `MIGRATIONS` |
| `@variance-authority/tribunal/store` | D1 and R2 | `createBucketStore` — baselines |
| `@variance-authority/tribunal/history` | D1 | `createD1Backend` — the record |
| `@variance-authority/tribunal/review` | D1 and R2 | `createReviewStore` — builds, decisions, retention |
| `@variance-authority/tribunal/worker` | D1, R2 and a `Policy` | `createTribunal` — one `fetch` handler; `declaredPolicy` — a `Policy` from what you declared |
| `@variance-authority/tribunal/worker-entry` | the bindings and the declared names, as an `env` | the deployable module: `export default { fetch, scheduled }` |
| `@variance-authority/tribunal/node` | Node 22, a writable file and directory | `openDatabase`, `createDirectoryBucket`, `serveTribunal`, and the `variance-authority-tribunal` executable |
| `@variance-authority/tribunal/ui` | React 19 | the review surface, its JSON client, its stylesheet |
| `@variance-authority/tribunal/next` | an App Router app | `createTribunalRoutes` |
| `@variance-authority/tribunal/testing` | Node 22 | D1 over `node:sqlite`, an in-memory bucket |

This is one service, deployed once, so React is an ordinary production
dependency even though only `/ui` and `/next` touch it. The rows list which
entrypoint needs what, which is what you want when you read the code or split
the deployment across two Workers.

## Wiring a Worker of your own

Copy this when you want your own module rather than the one that ships.

```ts
// worker.ts — yours, not ours
import type { D1Like, R2Like } from '@variance-authority/tribunal';
import { createTribunal, declaredPolicy, type Tribunal } from '@variance-authority/tribunal/worker';

interface Env {
  readonly DB: D1Like;
  readonly BUCKET: R2Like;
  readonly [declared: string]: unknown;
}

let tribunal: Tribunal | undefined;

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    tribunal ??= createTribunal({
      db: env.DB,
      bucket: env.BUCKET,
      project: 'todomvc',
      policy: declaredPolicy(env),
    });
    return tribunal.fetch(request);
  },
};
```

| option | default | what it decides |
|---|---|---|
| `db` | required | the D1 binding |
| `bucket` | required | the R2 binding |
| `project` | required | scopes every row and every object key. There is no default, for the reason given above |
| `policy` | required | who this deployment recognizes. `declaredPolicy(values, options)` builds one from the [names above](#deploy-it-on-cloudflare), and its options are `loopback`, `log`, `fetch` and `now`. A host with its own session [writes its own](#mounting-the-review-surface-in-nextjs) |
| `retentionDays` | `30` | days of builds `POST /review/sweep` keeps. Applied by the packaged Worker's `scheduled` handler and by `POST /review/sweep` |
| `now` | the wall clock | supplies every recorded `at`; override it when the deployment has its own clock source |

`env.DB` and `env.BUCKET` are Cloudflare's own `D1Database` and `R2Bucket`,
accepted as-is via structural typing: this package declares only the subset it
uses and does **not** depend on `@cloudflare/workers-types`, which is why the
store is testable in a plain `vitest` process.

If you apply the schema yourself rather than through `wrangler d1 migrations
apply`, call `applySchema(db)` once, or run the statements in `SCHEMA` through
whatever you use for migrations. Nothing here migrates on a request, since D1 has
no advisory lock to serialize a migration running under concurrent load.

An **already-deployed** database is not upgraded by that call: `SCHEMA` is the
whole schema, and applying it a second time fails on the first `CREATE TABLE`.
Apply `MIGRATIONS` instead — one entry per version after the package's initial
schema, each writing the version it lands on. Step `i` lands on
`INITIAL_VERSION + i + 1`, so a database reporting `schema_version` `n` needs
every step from `n - INITIAL_VERSION` on.

## Composing the Node service yourself

The same three pieces without the executable, for a process that is also serving
something else:

```ts
import { createDirectoryBucket, openDatabase, serveTribunal } from '@variance-authority/tribunal/node';
import { createTribunal, declaredPolicy } from '@variance-authority/tribunal/worker';

const service = await serveTribunal({
  tribunal: createTribunal({
    db: await openDatabase('variance-tribunal.db'),
    bucket: createDirectoryBucket('variance-tribunal-objects'),
    project: 'todomvc',
    policy: declaredPolicy(
      {
        INGEST_CREDENTIALS: 'token',
        INGEST_TOKEN: process.env.INGEST_TOKEN,
        REVIEW_CREDENTIALS: 'loopback',
        REVIEWER: 'marina',
      },
      { loopback: true },
    ),
  }),
  host: '127.0.0.1',
  port: 7789,
  ui: true,
});

service.url;  // http://127.0.0.1:7789
await service.close();
```

`serveTribunal` takes the `tribunal` to serve, `host`, `port`, `origin`, which
names the address behind a proxy, and `ui`, which
decides whether the review surface and its bundle are served at all and defaults
to `true`. `openDatabase` opens, creates or migrates the file and reports the
`version` it settled on; `createDirectoryBucket` writes each object through a
staging file and renames it, so a reader never sees half of one.

`{ loopback: true }` is what admits `loopback`, which makes every caller with no
bearer the reviewer. That is right for a loopback bind and wrong for anything
else, so state it only there: the executable derives it from the bind address, and
without it `declaredPolicy` refuses `loopback`.

## Mounting the review surface in Next.js

```tsx
// app/variance/page.tsx — excerpt: `whoIsThis` is your session lookup
import '@variance-authority/tribunal/fonts.css';
import { ReviewApp, REVIEW_STYLES, createReviewClient } from '@variance-authority/tribunal/ui';

declare function whoIsThis(): Promise<string>;

const client = createReviewClient({ endpoint: '/variance' });

export default async function VariancePage(): Promise<React.ReactElement> {
  return (
    <>
      <style>{REVIEW_STYLES}</style>
      <ReviewApp client={client} reviewer={await whoIsThis()} />
    </>
  );
}
```

```ts
// app/variance/[[...path]]/route.ts — excerpt: `env` is your platform's bindings,
// `sessionName` your session lookup
import type { D1Like, R2Like } from '@variance-authority/tribunal';
import { createTribunalRoutes } from '@variance-authority/tribunal/next';
import { createTribunal, declaredPolicy, type Policy } from '@variance-authority/tribunal/worker';

declare const env: {
  readonly DB: D1Like;
  readonly BUCKET: R2Like;
  readonly [declared: string]: unknown;
};
declare function sessionName(request: Request): Promise<string | null>;

// What may write a run is declared; who decides is whoever your session proved.
const machines = declaredPolicy(env);
const policy: Policy = {
  async principal(request) {
    const name = await sessionName(request);
    return name === null ? machines.principal(request) : { capability: 'review', name };
  },
};

const worker = createTribunal({ db: env.DB, bucket: env.BUCKET, project: 'todomvc', policy });

export const { GET, POST, PUT, HEAD } = createTribunalRoutes(worker, { basePath: '/variance' });
```

`REVIEW_STYLES` is text, and text cannot carry a font file, so the faces it is
set in — Inter and JetBrains Mono, under the SIL Open Font License beside them —
ship as `@variance-authority/tribunal/fonts.css`, whose `url()`s your bundler
resolves next to the sheet. Leave the import out and the surface falls back to
the system sans and monospace stacks.

`createReviewClient` takes `endpoint` — where the Worker is mounted — and an
optional `token` for a machine calling with a bearer of its own. Omit `token`
behind the adapter above: the browser's session says who it is. `ReviewApp` without
a `reviewer` is a reader, with nothing to decide with.

`createTribunalRoutes` takes `basePath`, which is stripped before the request
reaches the Worker. `PUT` is what an `http` share writes with, so export it when
the share is mounted too.

`policy` has **no default**: a default that made a caller a reviewer would be a
published approve button. `principal` returns `null` for a request it does not
recognize, which answers 401, or `{ capability: 'ingest' | 'share' | 'view' }`, or
`{ capability: 'review', name }`, whose `name` is written on the decision.
Optional `serve` answers routes the mechanism owns, such as a sign-in, and optional
`signIn` is the path a person goes to. When the declared mechanisms are the ones you
want, pass `declaredPolicy(env)` itself. With `github` declared under a `basePath`,
also mount the routes at the root of the host, because GitHub returns to
`/auth/github/callback` unmounted.

## Review invariants

**Approval promotes an image; it never records one.** Deciding *approved* makes
that build's uploaded candidate the baseline, through the same `RasterStore` the
next run reads. A subject whose candidate was never uploaded **cannot be
approved**.

**An approval is taken against the baseline you read, and read the way a merge
reads code.** Each subject a build answers with carries `baselineVersion`: the
document digest of the baseline an approval would replace, or `null` when there
is none. Send it back with the decision. A baseline that moved since is not a
conflict by itself: when every approval that moved it after this build ran
changed regions none of this build's regions meets, the approval goes through.
The service records nothing and answers 409 with
`{"error":"…","read":…,"current":…,"clash":"…"}` only when they meet, when the
baseline standing now was written by something that names no regions — a run's
`/baseline/put` — when a region list on either side was cut short, when the
baseline you read has since been deleted, or when there was no baseline as you
read it, since then both sides added the whole image. An approval whose own
image already stands goes through. The sentence names the two baselines and,
when it is one, the build whose change met yours; `read` and `current` are the
two document digests, `null` for none, and `clash` is why the two changes could
not be told apart, as a clause. The version is the baseline standing when you
read the build, not the one its run compared against, so it guards the time the
page is open. The review pages send it, and on a 409 both the subject panel and
the change page offer to reload what you were deciding.

An approval that goes through over a moved baseline replaces it with this
build's image, so the other build's change is not in the new baseline; the next
run compares against it and shows that change again. A rejection promotes
nothing and is never checked, and neither is a decision without
`baselineVersion`. The check and the promotion are not one transaction: two
decisions landing in the same instant can both pass.

**A store failure is never a verdict.** Every D1 and R2 failure raises
`RasterStoreError` instead of returning a value; `null` is reserved for *the
store looked and there is no baseline*.

**A row without its object is damage, not absence.** The metadata sidecar lives
in D1 and the image in R2. `describe` spends an R2 `head` call to confirm the
object still exists rather than answering from the D1 row alone.

**A coverage list that was never stated is not an empty one.** `undefined` and
`[]` are stored, returned, and drawn as different values: absent means nothing
looked, `[]` means inspected and clean. The same distinction applies to findings.

**Nothing is recognized that was not declared.** `INGEST_CREDENTIALS` and
`REVIEW_CREDENTIALS` say who a deployment recognizes, and construction refuses a
declaration it cannot honour. It refuses a token under 16 characters and a share
token equal to the ingest token.

**A decision has a name on it.** Only a person the policy proved decides. An
ingest credential writes builds, baselines, history and the share; the optional
share token reads the share, the changelog and the decision history; `VIEW=public`
reads what a reviewer reads. None of them decides.

**Which capability a route requires is only revealed to a caller already
recognized.** Recognition happens before routing.

**The service reports to nobody.** It asks an issuer for its public keys and GitHub
during a sign-in, and nothing else: not a status check, not a PR comment, not a
webhook, not telemetry. The pipeline reports to the service.

**The record is append-only, and the database enforces it.** Runs, observations,
token values, decisions and concerns all have `UPDATE` and `DELETE` triggers, so a direct
`wrangler d1 execute` against the database is refused too.

## Retention

`POST /review/sweep?days=N` removes builds older than `N` days: their subject
rows, their coverage rows, and every image they kept. It **reports counts** for
everything it removed — `builds`, `subjects`, `objects`.

What it does not remove: **promoted baselines** (what the next run compares
against), **decisions**, **concerns**, and the **changelog**. The fourth count,
`decisionsKept`, is how many approvals outlived the builds this call removed, not
a fourth removal.

The packaged Worker sweeps nightly: the provisioned `wrangler.jsonc` carries a
`triggers.crons` entry, and a config written before it needs the entry added. The
Node service and a host of your own sweep on request, so call the route from a
timer you already run.

## Testing your own wiring

```ts
import { createReviewStore } from '@variance-authority/tribunal/review';
import { createMemoryR2, createSqliteD1 } from '@variance-authority/tribunal/testing';

const review = createReviewStore({
  db: await createSqliteD1(),
  bucket: createMemoryR2(),
  project: 'todomvc',
});
```

D1 is built on SQLite, so this adapter runs the package's own schema, indexes,
triggers, `ON CONFLICT` clauses and ordering through `node:sqlite` — your routes,
your ingest, your retention settings, in a plain `vitest` process, with no
`wrangler`, no container and no account. What it does not reproduce is
Cloudflare; see below. `createMemoryR2().fail(…)` makes the bucket throw, so you
can exercise your store-failure path.

## Operational boundaries

The Worker relies on the platform's D1 transaction and `batch` semantics, request
and subrequest limits, object-size ceilings, quotas, and the behavior of
concurrent writes. Those are deployment conditions, not behavior this package can
configure or infer, and none of them are reproduced by the SQLite adapter above.

**Concurrency around run lineage is weaker on Cloudflare than on the Node
deployment.** The router is one module and answers identically; what differs is
underneath it. A SQLite file has a single writer and a lock, so the Node backend
takes that lock before checking whether a run id is registered. Two Workers
cannot. A unique index still refuses a run id pointing at two commits either way.

**A share manifest is replaced on its version by the bucket, not by the router.**
On Cloudflare the comparison is R2's own conditional `put`, so it holds across
every Worker instance. That is why `R2Like.put` takes `onlyIf`, with
`etagMatches` and `etagDoesNotMatch` as R2 spells them, and answers `null` when
the condition fails. `createDirectoryBucket` compares and writes inside one
process, which is the whole of a Node deployment.

**The Node store keeps two keys apart only where its volume does.** On a
volume that treats two spellings as one name, such as the default APFS on
macOS, `branch/Feature` and `branch/feature` are one directory.
`createDirectoryBucket` refuses a write to the spelling the volume did not keep
with 422, naming the one it holds, and reads under that spelling answer 404, so
one line never reads or replaces the other. Put `VARIANCE_TRIBUNAL_STORAGE` on
a case-sensitive volume to keep both.

**A build's images are as large as the run kept.** Nothing here compresses,
resizes, or deduplicates across builds.

**A build cannot distinguish two images of one subject.** The per-subject outcome
a run reports names a subject and no label, so labelled baselines are writable
through the store and the review path can never address them.

**Anything that satisfies `D1Like` and `R2Like` is an adapter away**, and the
package makes no portability promise beyond the two deployments it ships. Your
deployment's platform limits are yours.

---

**[@variance-authority/tribunal](https://variance-authority.dev/reference/packages/tribunal)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · [GitHub](https://github.com/Variance-Authority/variance-authority/tree/main/packages/tribunal) · MIT
