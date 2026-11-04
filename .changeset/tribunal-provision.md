---
'@variance-authority/tribunal': minor
'@variance-authority/cli': minor
'@variance-authority/history': minor
'@variance-authority/remote': minor
---

A tribunal says who it recognizes, and one command deploys one

`INGEST_CREDENTIALS` and `REVIEW_CREDENTIALS` declare who a deployment recognizes, and every deployment runs that one policy. Reviewers sign in with GitHub, those who can write to `GITHUB_REPOSITORY` decide, and a decision carries the login that signed in; a body naming somebody else is refused. Workflows in `GITHUB_ACTIONS_REPOSITORIES` push with the token the runner issues, which `baselines.token` asks for with `{ "github-actions": { "audience": … } }`, so CI stores no secret. `VIEW=public` opens reading to an anonymous visitor and nothing else. `access` remains for Cloudflare Access and any SSO behind it. `REVIEW_TOKEN` is gone, and a script no longer decides: move a deployment to `github` or `access` before upgrading. `createTribunal` takes a `policy` in place of its two tokens, and `createTribunalRoutes` and `serveTribunal` take no `authorize`, `tokens` or `reviewer`: the policy replaces them. `Capability`, `authorizeFor` and `REVIEW_TOKEN_VARIABLE` are gone with them.

`GITHUB_ACTIONS_BASELINE_REF` is required with `github-actions`: it names the one ref whose workflows move a baseline, and every other ref still pushes builds and reads the render cache, and writes neither a baseline nor the cache. The packaged Worker sweeps on a schedule; add `triggers.crons` to a `wrangler.jsonc` that predates it. The Node service takes `VARIANCE_TRIBUNAL_ORIGIN` behind a proxy.

`variance-authority-tribunal-provision` now takes a repository to a serving deployment: it writes `wrangler.jsonc` when there is none, registers the GitHub App from a manifest, so you confirm one page and install it, and deploys. A run refuses a repository the deployment does not already name, and `--rotate` is how a token goes to a repository that holds none. `--repository` and `--mount` place it, and `--skip-deploy` leaves publishing to a deployment with its own build. The review bundle and fonts are laid out in `dist/public`, so a Worker's `assets` directory points into the package, and the packaged Worker serves the review page. The `token` of a history or remote client may be a function, asked on each use. `./testing` adds `bearerPolicy`, `signer` and `Signer`.
