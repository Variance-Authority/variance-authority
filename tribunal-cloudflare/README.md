# tribunal-cloudflare

This directory is a deployable **review console** that is never itself deployed.
It is a complete [vinext](https://vinext.dev/) app on a Worker — D1 for rows, R2
for images, Cloudflare Access for the people who decide — and it exists to be
read, run locally, and copied. Its `wrangler.jsonc` carries a placeholder
`database_id`, so nothing here points at a database that exists; its dependency
on [`@variance-authority/tribunal`](../packages/tribunal/README.md) is a `link:`
into this repository, so it always builds against the package as it stands here
rather than against a published version. It is a project of its own — its own
`yarn.lock`, outside the repository's workspaces — so installing it touches
nothing it serves. [Your own deployment](#your-own-deployment) is what you do
with it.

The console is the page where a person looks at what a run changed and decides
it, one **subject** at a time — one named UI state, under the id the run used. A
run (`npx variance run`) sends each fresh image, the **candidate**, to this
service; that is **ingest**. A reviewer opens the page, puts the candidate beside
the **baseline** it was judged against, and approving promotes that candidate to
be the baseline the next run is judged against.

## The files

Eight files are the whole app; everything else is
[`@variance-authority/tribunal`](../packages/tribunal/README.md).

| file | what it is |
| --- | --- |
| `app/api/[[...path]]/route.ts` | the package's whole router, mounted once, plus this deployment's authorization policy |
| `app/tribunal.ts` | builds the service from the Worker's bindings, once per isolate |
| `app/access.ts` | verifies the Cloudflare Access JWT and answers who is asking |
| `app/page.tsx` | the review page, rendered per request because who is asking is a per-request fact |
| `app/review.tsx` | the client component, holding no credential |
| `app/layout.tsx`, `app/env.ts`, `app/cloudflare.d.ts` | shell, binding types |
| `wrangler.jsonc` | the deployment descriptor you edit |

Everything under `/api` is the package's own router. The service a run talks to
and the pages a reviewer reads are one deployment, and no route is reimplemented
here to fall behind the package's.

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
  --var INGEST_TOKEN:local-ingest-token-0123 --var REVIEW_TOKEN:local-review-token-0123
```

`PROJECT` scopes every row and object key — one deployment holds one project, and
`todomvc` above is just a name for the suite you point at it. There is no Access
in front of a local Worker, so `/` refuses to draw the review surface and the two
bearer tokens are how the API is exercised.

## Your own deployment

A deployment of yours is a small project in your own git that installs
`@variance-authority/tribunal` from npm instead of linking it, and the package's
README carries that route end to end — a `worker.ts` of two lines, a
`wrangler.jsonc`, and the resources below:
[Deploy it on Cloudflare](../packages/tribunal/README.md#deploy-it-on-cloudflare).
That page also covers the other deployment, a single Node process on your own
machine that needs no Cloudflare account at all.

Copy from here when you want the console's pages rather than the bare API: `app/`
is the part the package does not ship, and the `link:` in `package.json` becomes
`"@variance-authority/tribunal": "^0.2.0"` in yours.

### The resources, in order

```bash
yarn wrangler d1 create variance-tribunal      # put the printed id in wrangler.jsonc
yarn wrangler r2 bucket create variance-tribunal

yarn build
yarn wrangler d1 migrations apply variance-tribunal --remote \
  --config dist/server/wrangler.json

yarn wrangler secret put INGEST_TOKEN          # ≥16 characters
yarn wrangler secret put REVIEW_TOKEN          # ≥16 characters, and not the other one

yarn deploy
```

The two tokens are secrets, not `vars`: they are the deployment's capabilities,
and `wrangler.jsonc` is in git. `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are `vars`
and are safe there — a team domain and an audience tag are public identifiers,
and neither authorizes anything on its own. `RETENTION_DAYS`, if you set it,
bounds how many days of builds `POST /review/sweep` keeps; unset, the package's
default applies.

Migrations are not written by hand: the repository's `yarn build` generates them
from the package's schema into `packages/tribunal/migrations`, and
`migrations_dir` points at them rather than at a copy. In your own project they
arrive at `node_modules/@variance-authority/tribunal/migrations`, and that is
where you point it. A console whose schema history diverged from the packaged
Worker's would be a second database wearing the same name.

## Who is allowed what

`app/api/[[...path]]/route.ts` is this deployment's policy, and the package
supplies no default for it, because a default is a published approve button. It
is nine lines:

```ts
authorize: async (request: Request) => {
  const header = request.headers.get('authorization') ?? '';
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
  if (bearer !== null && bearer === TOKENS.ingest) return 'ingest';
  if (bearer !== null && bearer === TOKENS.review) return 'review';
  return (await identify(request)) === null ? null : 'review';
},
```

| The request carries | It gets | Because |
| --- | --- | --- |
| `Authorization: Bearer <INGEST_TOKEN>` | ingest | CI writes builds and cannot decide them |
| `Authorization: Bearer <REVIEW_TOKEN>` | review | a machine acting for the operator — a script approving on `main` |
| A valid Access JWT | review | a person, with a name to put on the decision |
| Anything else | 401 | |

A caller cannot choose its own capability: `createTribunalRoutes`, the package
function that turns that policy plus the service into `GET`/`POST`/`HEAD`
handlers, replaces the authorization header with the token the answer implies, so
a browser sending `Bearer <anything>` is still whatever the policy above says it
is.

The page at `/` is drawn for an Access identity and never for a bearer. A
rendered review surface has to put a reviewer's name on a decision, and a token
has none to give — it can be held by anything the operator handed it to. That is
also why no page ever carries `REVIEW_TOKEN`: a token in a document is a token in
everybody's devtools, and this one promotes baselines.

## Access

Put an Access application in front of the deployment, then set both of:

- `ACCESS_TEAM_DOMAIN` — e.g. `your-team.cloudflareaccess.com`, where the signing
  keys are published.
- `ACCESS_AUD` — the application's audience tag, so a token minted for another
  application in the same team is refused here.

Both live in `vars` in `wrangler.jsonc`, where they ship empty.

`app/access.ts` verifies the JWT's RS256 signature against those keys and checks
`aud`, `exp` and `iss`. It does not read
`Cf-Access-Authenticated-User-Email`, which is a header and therefore something a
request can simply claim.

With either variable unset, `/` explains that it has no way to know who is asking
and draws no review surface. The API is unaffected: a bearer still works, which
is the same shape the single-process Node deployment has when it is bound to
anything but loopback.

## Pointing a run at it

In the suite you are capturing — not in this directory — `baselines.kind` becomes
`"remote"` and the endpoint is the deployment's URL with `/api`. The ingest token
goes here, never the review one: a run records candidates and does not decide
them.

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
    "token": "the ingest token"
  },
  "report": "out/report.json"
}
```

`profile` names the observation profile the run captures under, `retention:
"durable"` says baselines are kept rather than discarded with the run, and
`subjects` says where the named UI states come from — here, a built Storybook
index plus a collector module. The full set of keys is
[the CLI's configuration reference](../packages/cli/README.md#configuration).
