# tribunal-cloudflare

This directory is a deployable **review console** that is never itself deployed.
It is a complete [vinext](https://vinext.dev/) app on a Worker — D1 for rows, R2
for images, GitHub or Cloudflare Access for the people who decide — and it exists
to be read, run locally, and copied. Its `wrangler.jsonc` carries a placeholder
`database_id`, so nothing here points at a database that exists; its dependency
on [`@variance-authority/tribunal`](../packages/tribunal/README.md) is a `link:`
into this repository, so it always builds against the package as it stands here
rather than against a published version. It is a project of its own — its own
`yarn.lock`, outside the repository's workspaces — so installing it touches
nothing it serves. [Your own deployment](#your-own-deployment) is what you do
with it.

Point your coding agent at [`llms.txt`](https://variance-authority.dev/llms.txt).

The console is the page where a person looks at what a run changed and decides
it, one **subject** at a time — one named UI state, under the id the run used. A
run (`npx variance run`) sends each fresh image, the **candidate**, to this
service; that is **ingest**. A reviewer opens the page, puts the candidate beside
the **baseline** it was judged against, and approving promotes that candidate to
be the baseline the next run is judged against.

## The files

Ten files are the whole app; everything else is
[`@variance-authority/tribunal`](../packages/tribunal/README.md).

| file | what it is |
| --- | --- |
| `app/api/[[...path]]/route.ts` | the package's whole router, mounted once at `/api` |
| `app/auth/[[...path]]/route.ts` | the same router at the root of the host, for the sign-in GitHub returns to |
| `app/routes.ts` | builds both mounts on the first request, so a refused declaration answers 500 with its sentence |
| `app/tribunal.ts` | builds the service from the Worker's bindings and what you declared, once per isolate |
| `app/page.tsx` | the review page, rendered per request because who is asking is a per-request fact |
| `app/review.tsx` | the client component, holding no credential |
| `app/layout.tsx`, `app/env.ts`, `app/cloudflare.d.ts` | shell, binding types |
| `wrangler.jsonc` | the deployment descriptor you edit |

Everything under `/api` and `/auth` is the package's own router. The service a run
talks to and the pages a reviewer reads are one deployment, and no route is
reimplemented here to fall behind the package's.

## Running this copy

From this directory. It needs a checkout of this repository and the repository's
own `yarn build` first, because `link:` resolves to `packages/tribunal`'s `dist/`
and its generated migrations.

```bash
yarn install
yarn dev         # vinext dev server
yarn build       # writes dist/, including dist/server/wrangler.json
```

`wrangler.jsonc` is the file you edit. `yarn build` rewrites
`dist/server/wrangler.json` from it — that generated file is what `wrangler` is
pointed at, and editing it is pointless because the next build overwrites it.
The D1 database id goes in `wrangler.jsonc`.

`wrangler` is a devDependency here, so run it as `yarn wrangler`; there is
nothing to install globally.

### Against a local D1 and R2

`wrangler dev` runs the built Worker against local storage. The state lives
wherever `--persist-to` says, and pointing it outside `dist/` matters: `yarn
build` rewrites `dist/`, and a database under it is discarded by the next build.

```bash
yarn build
yarn wrangler d1 migrations apply variance-tribunal --local \
  --persist-to .wrangler/local --config dist/server/wrangler.json
yarn wrangler dev --config dist/server/wrangler.json --persist-to .wrangler/local \
  --var PROJECT:todomvc \
  --var INGEST_CREDENTIALS:token --var INGEST_TOKEN:local-ingest-token-0123 \
  --var VIEW:public
```

`PROJECT` scopes every row and object key — one deployment holds one project, and
`todomvc` above is just a name for the suite you point at it. The bearer token is
how the API is exercised, and `VIEW:public` draws the review surface at `/` with
nothing to decide with. Deciding takes `github` or `access` with their values,
because `loopback` is the Node service's alone. With neither list declared, `/api`
answers 500 with a sentence naming them.

## Your own deployment

A deployment of yours is a small project in your own git that installs
`@variance-authority/tribunal` from npm instead of linking it, and the package's
README carries that route end to end — one command that writes the
`wrangler.jsonc`, makes the resources below and deploys:
[Deploy it on Cloudflare](../packages/tribunal/README.md#deploy-it-on-cloudflare).
That page also covers the other deployment, a single Node process on your own
machine that needs no Cloudflare account at all.

Copy from here when you want the review pages in an app you build rather than the
packaged Worker: `app/` is the part the package does not ship, and the `link:` in
`package.json` becomes a caret range on the current version of
`@variance-authority/tribunal` in yours.

### The resources, in order

```bash
yarn variance-authority-tribunal-provision --config wrangler.jsonc --mount /api --skip-deploy
yarn build && yarn deploy
```

Provisioning writes the database id and what it declares into `wrangler.jsonc`;
commit them. It makes the database and the bucket, declares `github-actions` for
runs and `github` for people, registers the GitHub App and mints the session key:
[Deploy it on Cloudflare](../packages/tribunal/README.md#deploy-it-on-cloudflare)
has the whole list. `--mount /api` says where this app serves the API, and
`--skip-deploy` leaves publishing to the build above.

`GITHUB_CLIENT_SECRET`, `GITHUB_SESSION_SECRET` and any token are secrets, not
`vars`: they are the deployment's capabilities, and `wrangler.jsonc` is in git.
The two lists and the values beside them are `vars` and are safe there — a client
id, a repository name, a team domain and an audience tag are public identifiers,
and none of them authorizes anything on its own. `RETENTION_DAYS`, if you set it,
bounds how many days of builds `POST /review/sweep` keeps; unset, the package's
default applies.

Migrations are not written by hand: the repository's `yarn build` generates them
from the package's schema into `packages/tribunal/migrations`, and
`migrations_dir` points at them rather than at a copy. In your own project they
arrive at `node_modules/@variance-authority/tribunal/migrations`, and that is
where you point it. A console whose schema history diverged from the packaged
Worker's would be a second database wearing the same name.

## Who is allowed what

`vars` in `wrangler.jsonc` is this deployment's policy: `app/tribunal.ts` passes
them to `declaredPolicy`, and the package declares nothing for you, because a
default is a published approve button. Provisioning writes these two:

```jsonc
"vars": {
  "PROJECT": "todomvc",
  "INGEST_CREDENTIALS": "github-actions",
  "REVIEW_CREDENTIALS": "github"
}
```

| The request carries | It gets | Because |
| --- | --- | --- |
| `Authorization: Bearer <a token a runner signed>` | ingest | with `github-actions` declared, a workflow in `GITHUB_ACTIONS_REPOSITORIES` writes builds and cannot decide them |
| `Authorization: Bearer <INGEST_TOKEN>` | ingest | with `token` declared, CI writes builds and cannot decide them |
| `Authorization: Bearer <SHARE_TOKEN>` | share | a machine that reads the share at `/api/share` and writes nothing |
| A GitHub session | review | with `github` declared, a person with write access to `GITHUB_REPOSITORY`, with a login to put on the decision |
| A valid Access JWT | review | with `access` declared, a person with an email to put on the decision |
| Nothing, with `VIEW` set to `public` | view | anybody reads what a reviewer reads and decides nothing |
| Anything else | 401 | |

A caller cannot choose its own capability: a bearer is read as a machine and
nothing else, so a browser sending `Bearer <anything>` is refused or is what that
token proves, even with `VIEW` set to `public`.

The page at `/` is drawn for a reviewer or a viewer and never for a bearer. With
`github` declared, a person who is not recognized goes to the sign-in; anybody
else gets a page naming `REVIEW_CREDENTIALS` and `VIEW`. A rendered review surface
has to put a reviewer's name on a decision, and a token has none to give — it can
be held by anything the operator handed it to. That is also why no page has a
credential in it: a token in a document is a token in everybody's devtools.

## Access

`access` is the other way to name a reviewer, and the values are your own:
provisioning registers no App for it and makes no Access application. Put an
Access application in front of the deployment as
[your company's SSO](https://variance-authority.dev/reference/packages/tribunal#your-companys-sso)
says, with the bypass a workflow needs under `/api`, set `REVIEW_CREDENTIALS` to
`access`, and set both of:

- `ACCESS_TEAM_DOMAIN` — e.g. `your-team.cloudflareaccess.com`, where the signing
  keys are published.
- `ACCESS_AUD` — the application's audience tag, so a token minted for another
  application in the same team is refused here.

Both live in `vars` in `wrangler.jsonc`.

`declaredPolicy` verifies the JWT's RS256 signature against those keys and checks
`aud`, `exp` and `iss`. It does not read
`Cf-Access-Authenticated-User-Email`, which is a header and therefore something a
request can simply claim. The decision is written under the JWT's email, so a
service token, which has none, decides nothing.

With `access` declared and either variable unset, `/api` answers 500 with a
sentence naming it.

## Pointing a run at it

In the suite you are capturing — not in this directory — `baselines.kind` becomes
`"remote"` and the endpoint is the deployment's URL with `/api`. A run records
candidates and does not decide them, so it presents an ingest credential. With
`github-actions` declared that is the token its runner signs: the workflow needs
`id-token: write` under `permissions`, `audience` is `GITHUB_ACTIONS_AUDIENCE`, and
only `GITHUB_ACTIONS_BASELINE_REF` moves a baseline. With `token` declared, it is
`{ "env": "VARIANCE_INGEST_TOKEN" }`.

```jsonc
// variance.config.json
{
  "project": "todomvc",
  "profile": "chromium",
  "viewport": { "width": 1280, "height": 800 },
  "retention": "durable",
  "subjects": {
    "kind": "storybook",
    "index": "storybook-static/index.json",
    "collector": "variance/collector.mjs"
  },
  "baselines": {
    "kind": "remote",
    "endpoint": "https://variance-tribunal-console.example.workers.dev/api",
    "token": { "github-actions": { "audience": "https://variance-tribunal-console.example.workers.dev" } }
  },
  "report": "out/report.json"
}
```

`profile` names the observation profile the run captures under, `retention:
"durable"` says baselines are kept rather than discarded with the run, and
`subjects` says where the named UI states come from — here, a built Storybook
index plus a collector module. The full set of keys is
[the CLI's configuration reference](../packages/cli/README.md#configuration).
