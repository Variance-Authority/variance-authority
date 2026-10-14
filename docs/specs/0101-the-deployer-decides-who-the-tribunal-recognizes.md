# Spec 0101 — the deployer decides who the tribunal recognizes

**Missing:** a way for a deployment to say who it recognizes, and a way to
recognize a machine without a shared secret. Today every deployment recognizes
callers the same way: whoever holds `INGEST_TOKEN`, `REVIEW_TOKEN` or
`SHARE_TOKEN`, and on the console whoever passes Cloudflare Access. So every
consumer mints a token, a person carries it into a CI secret store, and a pull
request that needs the tribunal waits until that person has done it.
**Built on:** the capability split and its one refusal
([ADR-0022](../context/adr/0022-deciding-is-not-writing.md)); the `authorize`
hook `createTribunalRoutes` takes with no default; the Access verifier in
`tribunal-cloudflare/app/access.ts`; the Node process's loopback rule in
`packages/tribunal/src/node/bin.ts`; and the client's `{ "env": … }` credential
form in `packages/cli/src/config-values.ts`.
**Relates to:** [0014](0014-hosted-who-the-caller-is-and-what-the-bill-counts.md),
whose option 2 — machines carry tokens, people carry sessions — this spec takes
as given for one deployment. Whether the credential also establishes the
*project* stays 0014's question.

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
| `github-actions` | `GITHUB_ACTIONS_REPOSITORIES`, `GITHUB_ACTIONS_AUDIENCE` | committed values |
| `access` | `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | committed values |
| `loopback` | a loopback bind, `VARIANCE_TRIBUNAL_REVIEWER` | committed values |

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
- **Nothing declared is refusal.** A question with no declared credential is
  answered `null` for every request. An empty `REVIEW_CREDENTIALS` means no
  review surface, which is today's meaning of an empty `ACCESS_TEAM_DOMAIN`, now
  said on purpose.
- **A valid credential of an undeclared kind is refused.** A correctly signed
  GitHub Actions token reaching a deployment that declared only `token` gets the
  same refusal as a wrong token.
- **Configuration present for an undeclared mechanism is an error**, not a
  dormant setting. `GITHUB_ACTIONS_REPOSITORIES` with `github-actions` absent
  from `INGEST_CREDENTIALS` is a deployer who believes something is trusted that
  is not.
- **The caller still gets one sentence.** Missing, wrong, undeclared and expired
  all answer with ADR-0022's single refusal. The reason — which mechanism looked,
  and which claim failed with the value it saw — goes to the deployment's log.
  The caller learns nothing it did not send.

Today's deployments are `INGEST_CREDENTIALS=token` and
`REVIEW_CREDENTIALS=access`, and declaring exactly that changes nothing they do.

### One credential, one verifier

Both an opaque token and an OIDC token ride `Authorization: Bearer`. The
deployment routes by shape and never tries every verifier in turn:

- A value that parses as a JWT goes to the one declared mechanism whose issuer
  matches its unverified `iss`. No match is refusal.
- Anything else is a token, compared in constant time against `INGEST_TOKEN`
  only if `token` is declared.

Routing on an unverified `iss` is safe because it only picks which key set the
signature is checked against. It never grants anything by itself.

## Ingest from GitHub Actions: a trusted issuer and a claim allowlist

`github-actions` recognizes a workflow run by the OIDC token GitHub mints for it.
No secret exists anywhere: the workflow asks for a token, the tribunal checks
it, and there is nothing to provision, carry or rotate.

The checks:

1. **Issuer.** `iss` is `https://token.actions.githubusercontent.com`.
2. **Signature.** RS256, against the key named by `kid` in the issuer's published
   key set, found through its OpenID discovery document. Keys are cached per
   isolate or process, as `published` already does for Access. An unknown `kid`
   refetches at most once per interval, and a failed fetch is not cached. The
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
   `Owner/name`, comma-separated, compared case-insensitively because GitHub
   treats those names that way.

What the token grants is `ingest` and nothing else. A build written this way is
a proposal a person reviews, so the repository is the grain that matters: a
workflow in an allowlisted repository that writes nonsense produces a build
nobody approves. Two finer bindings are named and left out:

- **Repository id.** A repository that is deleted and its name re-registered
  carries the same `repository` and a new `repository_id`. Pinning by id closes
  that, at the price of an allowlist nobody can read. PyPI pins the id; this
  spec leaves it to the owner (below).
- **Workflow, ref and environment.** PyPI and npm bind a workflow file and
  optionally an environment. Here that would stop a second workflow in the same
  repository from pushing builds, which matters for publishing a package and
  less for proposing one.

**Fork pull requests get no token.** GitHub withholds `id-token: write` from
`pull_request` runs triggered from forks, exactly as it withholds secrets. A
fork's run cannot push under `github-actions` any more than it can under
`token` today, and nothing here changes that.

**The mechanism is general; only one instance ships.** A trusted issuer is an
issuer URL, an audience, a claim and an allowlist. GitLab CI
(`https://gitlab.com`, claim `project_path`) and Bitbucket Pipelines fit the same
shape and would arrive as a new value of `INGEST_CREDENTIALS` with its own
prefixed variables. Neither is built until somebody needs it.

### The client asks for the token

`variance push`, the share publish and every other ingest call today read a
string from the config, resolved once when the config is parsed. A GitHub
Actions token is fetched over HTTP from the runner — `ACTIONS_ID_TOKEN_REQUEST_URL`
with `ACTIONS_ID_TOKEN_REQUEST_TOKEN` and `audience` — and expires within
minutes, so it cannot be a string fixed at parse time. The credential becomes a
third form beside `"…"` and `{ "env": … }`:

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
Access email to the client, and the client sends it back as `by` in the approval
body, where the API accepts any non-empty string from any caller holding
`review`. A named reviewer means the mount writes `by` from the verified identity
and refuses a body that names someone else.

### Machines never review

An automated flow observes and never approves. The two charts already split the
work this way, and the split holds once machines are recognized without secrets:

- **Identity** authenticates a person and never a machine. It is unchanged: a
  GitHub Actions token carries no person, so it never reaches identity, and an
  Access service token, which carries no email, still gives no name.
- **Capability** decides what a caller may do. It is where `github-actions` is
  verified, and the only capability that mechanism can produce is `ingest`.

Two things today let a caller with no proven name decide, and both go:

- **`REVIEW_TOKEN` as an outside bearer.** The console accepts it as "a machine
  acting for the operator — a script approving on `main`", and the packaged
  Worker documents it as held by people. Either is a decision with no reviewer
  behind it. `review` is not a value of `INGEST_CREDENTIALS` or
  `REVIEW_CREDENTIALS`, and the review token survives only as what the mount
  substitutes after a person was recognized.
- **Loopback on Node** grants `review` to any request with no token, and
  ADR-0087 records that "an agent on that machine decides by sending none".
  Declared as `loopback`, it names its reviewer from `VARIANCE_TRIBUNAL_REVIEWER`
  and stays the operator's word for the person at the machine. Whether an agent
  on that machine may still approve is the owner's question (below). A local
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
  for a short-lived upload credential. This repository's own npm release already
  works this way ([ADR-0060](../context/adr/0060-a-release-is-one-version-and-a-pressed-button.md)).
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
| Policy | Each deployment hard-codes its own `authorize`: the console in `route.ts`, the packaged Worker in `worker-entry.ts`, Node in `authorizeFor`. | One policy built from `INGEST_CREDENTIALS` and `REVIEW_CREDENTIALS`, in the package, used by all three. |
| Access | Verified only in `tribunal-cloudflare/app/access.ts`. An unset `ACCESS_*` silently means no surface. | The verifier in the package, so the packaged Worker and Node can declare it. A declared `access` without its values fails loudly. |
| GitHub Actions | Nothing. | The verifier: discovery, key cache, the five checks, the log line on refusal. |
| Client | A string, or `{ "env": … }`, resolved at parse time. | `{ "github-actions": { "audience": … } }`, fetched per request and refreshed near expiry. |
| Decision name | `by` is whatever the approval body says. | `by` written from the verified identity. |
| Review token | Accepted from outside as a reviewer on the console and the packaged Worker. | Only the mount's substitution. |
| Loopback | Implicit on any loopback bind. | Declared as `loopback`, with its reviewer. |
| Provisioning | `wrangler secret put`, typed by a person. | A generated ingest token handed to one destination. |

## What would discharge it

1. **Move the Access verifier into `@variance-authority/tribunal`** and have the
   console import it. No behaviour changes; it is the refactor the rest stands
   on.
2. **Build the policy from the declaration.** One function reads the two
   variables and the mechanisms' values, refuses missing or undeclared
   configuration by name, and returns the `authorize` hook. The console, the
   packaged Worker and Node all call it, and each ships declaring today's
   behaviour.
3. **Add `github-actions`** to the policy, with a test against a locally signed
   token and a recorded discovery document: each of the five checks refused on
   its own, routing by `iss`, and an undeclared kind refused.
4. **Add the client form**, with a test that a missing
   `ACTIONS_ID_TOKEN_REQUEST_URL` fails before any request and names the
   permission.
5. **Write `by` from the verified identity**, and refuse a body that disagrees.
6. **Retire the review token as an outside credential**, with the owner's answer
   on loopback agents.
7. **Provisioning**: generate the ingest token and hand it to one destination.
8. **Update the capability chart.** Its boundary says it decides "which of a
   deployment's secrets a caller presented". With `github-actions` it decides
   which declared credential a caller presented, and one of them is not a secret.
   The identity chart's boundary does not change.
9. **Write the ADRs** — trust is deployment configuration; machines never review —
   and delete this file.

### Follow-ups in this repository

- `example-tribunal` declares `INGEST_CREDENTIALS=github-actions` and
  `REVIEW_CREDENTIALS=access`, and its repository then holds no tribunal secret.
- The CI job pull request 340 proposes, `tribunal-service`, runs this commit's
  tribunal locally under `token` with a token the job generates, declares no
  review credential, and needs no Cloudflare secret.

## What it does not do

- It does not add a GitHub App, or make the tribunal an OAuth client.
- It does not decide whether a credential establishes the project
  ([0014](0014-hosted-who-the-caller-is-and-what-the-bill-counts.md)). A
  verified `repository` is a natural key for that; using it is 0014's call.
- It does not record which repository or run wrote a build. `builds` has no
  writer column, and a verified repository is the first writer there is to
  record.
- It does not change the share token.

## Questions for the owner

1. **Repository by name or by id?** By name is readable and open to a
   re-registered name; by id is closed to it and unreadable in a diff.
2. **Is the audience required?** This spec requires `GITHUB_ACTIONS_AUDIENCE`.
   A fixed audience such as `variance-authority` would save one value per
   deployment, and would let a token minted for one deployment be replayed at
   another that trusts the same repository.
3. **Finer claims?** Workflow file, ref or environment, as npm and PyPI allow.
4. **What does a deployment that declares nothing do after upgrading?** Refusing
   it is the rule; reading it as `token` plus `access` is one release of grace
   for every deployment that exists.
5. **May an agent on a loopback tribunal still approve?** ADR-0087 says it may,
   and this spec says machines never review.
