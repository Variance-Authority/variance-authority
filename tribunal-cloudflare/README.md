# tribunal-cloudflare

The review console, deployed to Cloudflare: a [vinext](https://vinext.dev/) app
on a Worker, with D1 for rows, R2 for images, and Cloudflare Access for the
people who decide. It is a project of its own — its own lockfile, outside the
repository's workspaces — so it installs and deploys without touching the
packages it serves. The dependency on `@variance-authority/tribunal` is a
`link:` into this repository, so the console always builds against the package as
it stands here; a deployment of your own points at the published version instead.

Everything under `/api` is `@variance-authority/tribunal`'s own router, mounted
once. The service the CLI talks to and the pages a reviewer reads are the same
deployment, and there is no second implementation of a route here to fall behind
the package's.

```bash
yarn install
yarn dev         # vinext dev server
yarn build       # writes dist/, including dist/server/wrangler.json
yarn deploy      # wrangler login first
```

## What it needs before it can run

```bash
wrangler d1 create variance-tribunal      # put the printed id in wrangler.jsonc
wrangler r2 bucket create variance-tribunal
wrangler d1 migrations apply variance-tribunal --remote

wrangler secret put INGEST_TOKEN          # ≥16 characters
wrangler secret put REVIEW_TOKEN          # ≥16 characters, and not the other one
```

The two tokens are secrets, not `vars`: they are the deployment's capabilities,
and `wrangler.jsonc` is in the repository. `PROJECT` in `vars` scopes every row
and object key — one deployment holds one project.

Migrations are generated from the package's `schema.ts`, and `migrations_dir`
points at them rather than at a copy. A console whose schema history diverged
from the packaged Worker's would be a second database wearing the same name.

## Who is allowed what

`app/api/[[...path]]/route.ts` is this deployment's policy, and the package
supplies no default for it, because a default is a published approve button.

| The request carries | It gets | Because |
| --- | --- | --- |
| `Authorization: Bearer <INGEST_TOKEN>` | ingest | CI writes builds and cannot decide them |
| `Authorization: Bearer <REVIEW_TOKEN>` | review | a machine acting for the operator — a script approving on `main` |
| A valid Access JWT | review | a person, with a name to put on the decision |
| Anything else | 401 | |

A caller cannot choose its own capability: `createTribunalRoutes` replaces the
authorization header with the token the answer implies, so a browser sending
`Bearer <anything>` is still whatever the policy above says it is.

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

`app/access.ts` verifies the JWT's RS256 signature against those keys and checks
`aud`, `exp` and `iss`. It does not read
`Cf-Access-Authenticated-User-Email`, which is a header and therefore something a
request can simply claim.

With either variable unset, `/` explains that it has no way to know who is asking
and draws no review surface. The API is unaffected: a bearer still works, which
is the same shape the Node service has when it is bound to anything but loopback.

## Locally

`wrangler dev` runs the built Worker against a local D1 and R2. The state lives
wherever `--persist-to` says, and pointing it outside `dist/` matters: `yarn
build` rewrites `dist/`, and a database under it is discarded by the next build.

```bash
yarn build
wrangler d1 migrations apply variance-tribunal --local \
  --persist-to .wrangler/local --config dist/server/wrangler.json
wrangler dev --config dist/server/wrangler.json --persist-to .wrangler/local \
  --var PROJECT:todomvc \
  --var INGEST_TOKEN:local-ingest-token-0123 --var REVIEW_TOKEN:local-review-token-0123
```

There is no Access in front of a local Worker, so `/` refuses to draw the review
surface and the bearers are how the API is exercised.

## Pointing a run at it

`baselines.kind: "remote"` and the deployment's URL. The ingest token goes here,
never the review one — a run records candidates and does not decide them.

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
