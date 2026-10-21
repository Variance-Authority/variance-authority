# Spec 0101 — the deployer decides who the tribunal recognizes

**Missing:** a way for a deployment to say who it recognizes, and a way to
recognize a machine without a shared secret. Today each deployment hard-codes
whom it recognizes: whoever holds `INGEST_TOKEN`, `REVIEW_TOKEN` or
`SHARE_TOKEN`; on the console, whoever passes Cloudflare Access; and on a
loopback Node process, whoever sends no token at all. So every consumer mints a
token, a person carries it into a CI secret store, and a pull
request that needs the tribunal waits until that person has done it.
**Built on:** the capability split
([ADR-0022](../context/adr/0022-deciding-is-not-writing.md)); the packaged
Worker's `grant` in `packages/tribunal/src/worker-auth.ts`; the `authorize` hook
`createTribunalRoutes` takes with no default; the Access verifier in
`tribunal-cloudflare/app/access.ts`; the Node process's loopback rule in
`packages/tribunal/src/node/bin.ts`; and the client's deferred credential,
`declaredSecret` in `packages/cli/src/config-values.ts`.
**Amends:** ADR-0022's review secret, which this spec stops accepting from
outside, and
[ADR-0087](../context/adr/0087-the-share-token-reads-never-decides.md)'s
consequence that an agent on a loopback machine decides by sending no token.
**Takes over from:** [0014](0014-hosted-who-the-caller-is-and-what-the-bill-counts.md)
its items 1 and 3 — option 2, machines carry tokens and people carry sessions,
and an approval that requires a named subject — for one deployment. Whether the
credential also establishes the *project* stays 0014's question.

## The rule

**The deployer decides who the tribunal recognizes, and how.** Trust is
deployment configuration. The tribunal ships the mechanisms that can verify a
caller, holds no policy of its own, and refuses whatever the deployment did not
declare.

- Which mechanisms a deployment accepts, and the allowlists they check, are
  plain values committed with the deployment: `vars` in `wrangler.jsonc`, or the
  environment a Node supervisor passes. Only an actual secret goes in the
  deployment's secret store.
- Changing who is trusted is a redeploy. There is no admin page, no table of
  grants, and no route that edits one.
- A deployer can delegate only to what the tribunal can verify. A mechanism
  joins the list when the package can check its proof, not when a deployer would
  like to trust it.

## Two questions

Every request asks one of two questions, and each is answered by the sources the
deployment declared for it.

| Question | Who asks it | Declared by | Values |
|---|---|---|---|
| May this machine write a build? | CI | `INGEST_CREDENTIALS` | `token`, `github-actions` |
| Which named person is deciding? | A reviewer | `REVIEW_CREDENTIALS` | `access`, and `loopback` on Node |

Each value names a mechanism, and each mechanism names what it needs:

| Mechanism | Needs | Kind |
|---|---|---|
| `token` | `INGEST_TOKEN` | secret |
| `github-actions` | `GITHUB_ACTIONS_REPOSITORIES`, `GITHUB_ACTIONS_AUDIENCE`; `GITHUB_ACTIONS_ISSUER` only to replace the public issuer | committed values |
| `access` | `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | committed values |
| `loopback` | a loopback bind; the reviewer is `VARIANCE_TRIBUNAL_REVIEWER`, or the OS user as today | committed values |

On Node every name carries the `VARIANCE_TRIBUNAL_` prefix the process already
uses: `VARIANCE_TRIBUNAL_INGEST_CREDENTIALS`, and so on.

**Why these names.** *Credential* is the word the capability chart already uses
for what a request presents, and the variable holds the set of credential kinds
the question accepts, so it is named after that quantity. `INGEST=token` would
read beside `INGEST_TOKEN` as if one set the other. The OIDC mechanism is
`github-actions` rather than `github`, because a reviewer who signs in through
Access with GitHub as the login provider is also "GitHub", and the two must not
share a word. Each mechanism's own values carry its name as a prefix, as
`ACCESS_*` already does, so a deployment's `vars` read as a list of what it
trusts.

Sources combine: `INGEST_CREDENTIALS=token,github-actions` recognizes either.
The share token answers a third question — who may read what review settled
([ADR-0087](../context/adr/0087-the-share-token-reads-never-decides.md)) — and
stays a token. Making it declarable the same way is not part of this spec.

### Declared, never discovered

- **A declared mechanism whose configuration is missing refuses to start**, and
  names the variable. On a Worker that is a 500 carrying the sentence, the shape
  construction failures already have; on Node it is the process exiting with the
  sentence on stderr.
- **Nothing declared is refusal.** The deployment starts, and a question with
  no declared credential is answered `null` for every request. An empty `REVIEW_CREDENTIALS` means no
  review surface, which is today's meaning of an empty `ACCESS_TEAM_DOMAIN`, now
  said on purpose.
- **A valid credential of an undeclared kind is refused.** A correctly signed
  GitHub Actions token reaching a deployment that declared only `token` gets the
  same refusal as a wrong token.
- **A committed value for an undeclared mechanism is an error**, not a dormant
  setting. `GITHUB_ACTIONS_REPOSITORIES` with `github-actions` absent from
  `INGEST_CREDENTIALS` is a deployer who believes something is trusted that is
  not. A secret for an undeclared mechanism is logged and never read instead: a
  secret outlives the deploy that stops declaring it, and removing it and
  redeploying cannot happen in one step, so refusing would take the deployment
  down between the two.
- **The caller's refusal does not change.** Missing, wrong, undeclared and
  expired all get the refusal each deployment gives today: the Worker's
  `UNAUTHENTICATED` sentence, or the mount's 401. The reason — which mechanism
  looked, and which claim failed with the value it saw — goes to the
  deployment's log. The caller learns nothing it did not send.

Each deployment ships declaring what it does today, less the review token:

| Deployment | Declares | What stops working |
|---|---|---|
| The console | `INGEST_CREDENTIALS=token`, `REVIEW_CREDENTIALS=access` | A script approving with `REVIEW_TOKEN` |
| The packaged Worker | `INGEST_CREDENTIALS=token`, nothing for review | Reviewing at all, until the deployer adds `access` |
| Node | `INGEST_CREDENTIALS=token`, and `REVIEW_CREDENTIALS=loopback` on a loopback bind | Approving with `REVIEW_TOKEN`, on any bind |

The packaged Worker and a networked Node process lose their only review path.
That is the point — it was a path with no name on it — and the replacement is
`access` in front of them. Per-person named tokens would be the other
replacement, and are not proposed: a token names whoever holds it, which is not a
person.

### One credential, one verifier

Both an opaque token and an OIDC token ride `Authorization: Bearer`. The
deployment routes by shape and never tries every verifier in turn:

- A value that parses as a JWT goes to the one declared mechanism whose issuer
  matches its unverified `iss`. No match is refusal.
- Anything else is a token, compared in constant time against `INGEST_TOKEN`
  only if `token` is declared. Today only the packaged Worker compares in
  constant time; the console and Node use `===`.

Routing on an unverified `iss` is safe because it only picks which key set the
signature is checked against. It never grants anything by itself.

### What the policy hands the handler

Today the console and Node mount answer `authorize`, then replace the request's
`Authorization` header with `INGEST_TOKEN` or `REVIEW_TOKEN`, and the handler
checks that token again. That seam carries a capability and nothing else, so it
cannot carry a name, and it needs both tokens in every deployment's secret store
whatever the deployment declared.

The policy instead answers a principal — the capability, and for review the
verified name — and `createTribunal` takes the policy where it takes the two
tokens today. The mount passes the principal on rather than substituting a
header, and the packaged Worker runs the same policy where it runs `grant`. So
`INGEST_TOKEN` is read only when `token` is declared, `REVIEW_TOKEN` is no
longer configuration anywhere, and the name a decision carries comes from the
principal.

### One issuer verifier

`access` and `github-actions` are the same check: an issuer, the keys it
publishes, an audience, a lifetime, and one claim. The package carries one
verifier for it, and each mechanism is a declared instance:

| Mechanism | Issuer | Audience | Claim |
|---|---|---|---|
| `access` | the team domain | `ACCESS_AUD` | `email`, read as the reviewer's name; Access has already decided who passes |
| `github-actions` | `GITHUB_ACTIONS_ISSUER`, or the public issuer | `GITHUB_ACTIONS_AUDIENCE` | `repository`, or `repository_owner` for an `Owner/*` entry, checked against `GITHUB_ACTIONS_REPOSITORIES` |

## Ingest from GitHub Actions: a trusted issuer and a claim allowlist

`github-actions` recognizes a workflow run by the OIDC token GitHub mints for it.
No secret exists for it: the workflow asks for a token, the tribunal checks
it, and there is nothing to provision, carry or rotate.

The checks:

1. **Issuer.** `iss` is `https://token.actions.githubusercontent.com`, or
   `GITHUB_ACTIONS_ISSUER` when the deployment declares one.
2. **Signature.** RS256, against the key named by `kid` in the issuer's published
   key set, found through its OpenID discovery document. Keys are cached per
   isolate or process, as `published` already does for Access. An unknown `kid`
   refetches at most once per interval, which `published` does not do today;
   being one verifier, `access` gains it too. A failed fetch is not cached. The
   fetch is an outbound call the deployer declared by naming the mechanism, as
   the Access certs fetch already is; the standing constraint in the
   [index](README.md#standing-constraints) says so.
3. **Audience.** `aud` equals `GITHUB_ACTIONS_AUDIENCE` exactly. The audience is
   declared, never taken from the request's `Host`: on Node the `Host` header is
   whatever the client sent, so an audience derived from it would accept a token
   minted for any other deployment. The convention is the endpoint URL the
   client pushes to, but the declaration is what counts.
4. **Lifetime.** `exp` and `nbf`, with a skew of seconds, not minutes.
5. **Repository.** `repository` is one of `GITHUB_ACTIONS_REPOSITORIES`,
   `Owner/name`, comma-separated, or `repository_owner` is the owner of an
   `Owner/*` entry, which admits every repository of that owner. Both are
   compared case-insensitively because GitHub treats those names that way.

What the token grants is `ingest`, and `ingest` is more than a proposal.
ADR-0022 gives it builds, the render cache and history, and also two writes no
person reviews: `/baseline/put` writes a baseline directly, for a run whose
baseline store is the tribunal, and the approvals route appends approval rows to
history. So the grain of the allowlist decides who may write a baseline, not
only who may propose one.

The grain proposed is the repository, because it is exactly the grain of the
secret it replaces. A repository secret is readable by every workflow, on every
branch, in that repository — `pull_request_target` and `workflow_run` runs
included, which execute in the base repository whatever code they check out. A
`github-actions` allowlist of repositories admits the same runs, and no other.
Two finer bindings are named and left out:

- **Repository id.** A repository that is deleted and its name re-registered
  carries the same `repository` and a new `repository_id`. Pinning by id closes
  that, at the price of an allowlist nobody can read in a diff. PyPI records the
  owner's account id against the same attack.
- **Workflow, ref and environment.** PyPI and npm bind a workflow file and
  optionally an environment. Here the environment is the counterpart of an
  environment secret, and a ref the counterpart of a protected branch: either
  would let a deployment say *only `main` writes a baseline*, which no token can
  say today. They are a later step.

**Fork pull requests get no token.** GitHub withholds `id-token: write` from
`pull_request` runs triggered from forks, exactly as it withholds secrets. A
fork's run cannot push under `github-actions` any more than it can under
`token` today, and nothing here changes that.

**The mechanism is general; only one instance ships.** A trusted issuer is an
issuer URL, an audience, a claim and an allowlist. GitLab CI
(`https://gitlab.com`, claim `project_path`) and Bitbucket Pipelines fit the same
shape and would arrive as a new value of `INGEST_CREDENTIALS` with its own
prefixed variables. Neither is built until somebody needs it. Inside GitHub, an enterprise that
switches to its own issuer
(`https://token.actions.githubusercontent.com/<enterprise>`), or GitHub
Enterprise Server on its own host, declares that issuer as
`GITHUB_ACTIONS_ISSUER`; the claims are the same.

### The client asks for the token

The seam already exists for the two calls that matter. `review.token`, which
`variance push` sends, and the share token are read through `declaredSecret`,
which returns `() => string` and reads the environment when the request is made,
not when the config is parsed. `history.token` and `baselines.token` are read
eagerly. A GitHub Actions token is fetched over HTTP from the runner —
`ACTIONS_ID_TOKEN_REQUEST_URL` with `ACTIONS_ID_TOKEN_REQUEST_TOKEN` and
`audience` — and expires within minutes, so the seam has to become
`() => Promise<string>`, and the two eager reads have to move onto it. The
credential becomes a third form beside `"…"` and `{ "env": … }`:

```json
"token": { "github-actions": { "audience": "https://tribunal.example/api" } }
```

It is fetched when a request is about to be made and fetched again near `exp`.
Run outside GitHub Actions, or in a job without `permissions: id-token: write`,
it fails before the first request, naming that permission. GitLab hands its ID
token to the job as an environment variable, so a GitLab issuer would need no new
client form: `{ "env": … }` already reads it.

## Review: a named person, through Access

`access` is Cloudflare Access, verified as `access.ts` verifies it today:
RS256 against the team's published certs, `aud` against `ACCESS_AUD`, `exp`, and
`iss`. Who may pass Access is the deployer's Cloudflare configuration, not the
tribunal's. Access can use GitHub as its login provider and restrict it to an
organization or a team, which gives "reviewers are the people who review our
pull requests" with no GitHub App, no OAuth client of ours and no password
stored here.

**A decision carries the name the credential proved.** Today the page passes the
Access email to the client, and the client sends it back as `by` in the decision
body, where the API accepts any non-empty string from any caller holding
`review`. Concerns carry a client-supplied `by` the same way. A named reviewer
means `by` is written from the principal's name on both, and a body that names
someone else is refused. The approval rows ingest appends carry a
caller-supplied `approver` too, and keep it: rules for ingest's writes come
later.

### Machines never review

An automated flow observes and never approves. The two charts already split the
work this way, and the split holds once machines are recognized without secrets:

- **Identity** authenticates a person and never a machine. It is unchanged: a
  GitHub Actions token carries no person, so it never reaches identity, and an
  Access service token, which carries no email, still gives no name.
- **Capability** decides what a caller may do. It is where `github-actions` is
  verified, and the only capability that mechanism can produce is `ingest`.
  Ingest's direct baseline write and its approval rows (above) are ADR-0022's
  line, older than this spec, and this spec leaves them where they are.

Two things today let a caller with no proven name decide, and both go:

- **`REVIEW_TOKEN` as an outside bearer.** Every deployment grants it `review`.
  The console documents it as "a machine acting for the operator — a script
  approving on `main`"; the packaged Worker documents it as held by people; Node
  accepts it on any bind. Each is a decision with no reviewer behind it, and the
  scripted approval is removed on purpose. `review` is not a value of
  `INGEST_CREDENTIALS` or `REVIEW_CREDENTIALS`, and with the policy handing the
  handler a principal, nothing substitutes the token either: it stops existing.
- **Loopback on Node** grants `review` to any request with no token, and
  ADR-0087 records that "an agent on that machine decides by sending none".
  Declared as `loopback`, it names its reviewer from `VARIANCE_TRIBUNAL_REVIEWER`
  and stays the operator's word for the person at the machine. It is the one
  review mechanism that is not Access, kept on purpose: a tribunal on your own
  machine has nobody to sign in. Who acts at that machine is the operator's
  process, which the tribunal does not define. A local
  tribunal that CI starts declares no review credential, so CI cannot approve
  through it.

## Deploying is a separate axis

Who may *deploy* a tribunal is not who the tribunal recognizes. `wrangler` runs
on a laptop through its OAuth login, or in CI with `CLOUDFLARE_API_TOKEN`, and a
deployment changes about monthly. Nothing in this spec reads either.

In `token` mode the ingest token has to come from somewhere. Provisioning
generates it and hands it to one destination: printed once by default, or piped
into a command such as `gh secret set VARIANCE_INGEST_TOKEN`. It is then held in
two secret stores, the deployment's and the CI's, and in neither place is it
readable again. A lost token is rotated, never recovered. Under `github-actions`
there is nothing to provision and the step disappears.

## Prior art

- **npm trusted publishing** and **PyPI trusted publishers** verify the GitHub
  Actions OIDC token against a declared repository and workflow, and exchange it
  for a short-lived upload credential. This repository's own npm release
  publishes through it ([ADR-0060](../context/adr/0060-a-release-is-one-version-and-a-pressed-button.md)).
  The tribunal skips the exchange: it holds no sessions, so it verifies the OIDC
  token on every request, and the token's minutes-long lifetime is the session.
- **Cloud workload identity federation** (AWS, Google Cloud, Azure) is the
  general form: a trusted issuer plus conditions on its claims. `github-actions`
  is one instance of it with a single condition.
- **Argos** uploads from GitHub Actions without a token in the workflow, through
  its GitHub integration. That integration is a GitHub App, which this spec
  declines.
- **Percy, Chromatic and Argos** all let reviewers sign in with GitHub. Access
  with GitHub as its login provider gives the same experience without the
  tribunal being an OAuth client.

## What exists, and what does not

| Area | Today | Missing |
|---|---|---|
| Policy | Each deployment hard-codes its own: the console's `authorize` in `route.ts`, Node's `authorizeFor`, and the packaged Worker's `grant`, which runs inside `createTribunal` with no mount. | One policy built from `INGEST_CREDENTIALS` and `REVIEW_CREDENTIALS`, in the package, used by all three. |
| Handler seam | The mount substitutes `INGEST_TOKEN` or `REVIEW_TOKEN`, and `createTribunal` requires both. | The handler takes the policy's principal: a capability and a name. |
| Access | Verified only in `tribunal-cloudflare/app/access.ts`, with no refetch on an unknown `kid`. An unset `ACCESS_*` silently means no surface. | One issuer verifier in the package, so the packaged Worker and Node can declare it. A declared `access` without its values fails loudly. |
| GitHub Actions | Nothing. | An instance of that verifier: discovery, the five checks, the log line on refusal. |
| Client | A string, or `{ "env": … }`, read when the request is made for `review` and `share` and at parse time for `history` and `baselines`; synchronous either way. | `{ "github-actions": { "audience": … } }`, fetched asynchronously and refreshed near expiry. |
| Decision name | `by` is whatever the decision or concern body says. | `by` written from the verified identity. |
| Review token | Accepted from outside as a reviewer on every deployment. | Gone. |
| Loopback | Implicit on any loopback bind, with a reviewer named by `VARIANCE_TRIBUNAL_REVIEWER` or the OS user. | Declared as `loopback`. |
| Provisioning | `wrangler secret put`, typed by a person. | A generated ingest token handed to one destination. |

## What would discharge it

1. **Move the Access verifier into `@variance-authority/tribunal`** as the one
   issuer verifier, with the unknown-`kid` refetch, and have the console import
   it. It is the refactor the rest stands on.
2. **Build the policy from the declaration.** One function reads the two
   variables and the mechanisms' values, refuses missing or undeclared
   configuration by name, and answers a principal. `createTribunal` takes it in
   place of the two tokens; the console and Node pass it as their `authorize`
   and hand its principal to the handler; the packaged Worker uses it in place
   of `grant`. Each ships declaring what the table above says. `authorize` stays
   a hook: the declared policy is what the shipped deployments pass to it, not a
   default the package applies.
3. **Add `github-actions`** as a second instance of the verifier, with a test against a locally signed
   token and a recorded discovery document: each of the five checks refused on
   its own, routing by `iss`, and an undeclared kind refused.
4. **Add the client form**, with a test that a missing
   `ACTIONS_ID_TOKEN_REQUEST_URL` fails before any request and names the
   permission.
5. **Write `by` from the principal** on decisions and concerns, and refuse a
   body that disagrees.
6. **Retire the review token** on all three deployments, scripted approval
   included.
7. **Provisioning**: generate the ingest token and hand it to one destination.
8. **Update the charts.** The capability chart's responsibility says it decides
   "which of a deployment's secrets a caller presented", and its boundary that it
   "ships no default policy for a hosted mount"; the review context's README and
   `VIEWPORTS.md` repeat the two-secrets wording. With `github-actions` it
   decides which declared credential a caller presented, and one of them is not
   a secret. Its "Depends on: Nothing" changes too: an issuer verifier fetches
   keys. The deployment-adapters chart's mount stops replacing the incoming
   authorization with a token and passes the principal. The identity chart's
   boundary does not change.
9. **Write the ADRs** — trust is deployment configuration; machines never review —
   mark ADR-0022 and ADR-0087 as amended by them, update
   [`checkpoint.md`](../context/checkpoint.md), and delete this file.

### Follow-ups

- The `example-tribunal` repository declares
  `INGEST_CREDENTIALS=github-actions` and `REVIEW_CREDENTIALS=access`, and then
  holds no tribunal secret.
- This repository's `tribunal-service` CI job, proposed in pull request 340,
  would run this commit's tribunal locally under `token` with a token the job
  generates, declare no review credential, and need no Cloudflare secret. As
  proposed it deploys to Cloudflare and mints both tokens.

## What it does not do

- It does not add a GitHub App, or make the tribunal an OAuth client.
- It does not decide whether a credential establishes the project
  ([0014](0014-hosted-who-the-caller-is-and-what-the-bill-counts.md)). A
  verified `repository` is a natural key for that; using it is 0014's call.
- It does not record which repository or run wrote a build. `builds` has no
  writer column, and a verified repository is the first writer there is to
  record.
- It does not change the share token.

## Settled

1. **The allowlist names repositories, or a whole owner.** An entry is
   `Owner/name`, or `Owner/*` for every repository of that owner, matched
   against `repository_owner`. A name stays readable in a diff; the
   re-registered-name risk is accepted, and pinning by id is not built.
2. **The audience is required.** No fixed default: a token minted for one
   deployment is never accepted by another.
3. **The repository is the grain.** Workflow, ref and environment bindings are
   a later step, not this one.
4. **Ingest keeps what ADR-0022 gives it.** The direct baseline write and the
   approval rows stay on `ingest`, unchanged; rules for them come later.
5. **No deployment exists to migrate.** Nothing declared is refusal from the
   first release, with no grace.
6. **Who acts at a machine is the operator's process.** The tribunal recognizes
   a declared credential and defines no process around it; loopback names the
   reviewer `VARIANCE_TRIBUNAL_REVIEWER` gives.
