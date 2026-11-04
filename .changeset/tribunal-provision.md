---
'@variance-authority/tribunal': minor
'@variance-authority/cli': minor
'@variance-authority/history': minor
'@variance-authority/remote': minor
---

A tribunal says who it recognizes, and one command deploys one

`INGEST_CREDENTIALS` and `REVIEW_CREDENTIALS` declare who a deployment recognizes, and every deployment runs that one policy. Reviewers sign in with GitHub, those who can write to `GITHUB_REPOSITORY` decide, and a decision carries the login that signed in; a body naming somebody else is refused. Workflows in `GITHUB_ACTIONS_REPOSITORIES` push with the token the runner issues, which `baselines.token` asks for with `{ "github-actions": { "audience": … } }`, so CI stores no secret. `VIEW=public` opens reading to an anonymous visitor and nothing else. `access` remains for Cloudflare Access and any SSO behind it. `REVIEW_TOKEN` is gone, and a script no longer decides: move a deployment to `github` or `access` before upgrading. `createTribunal` takes a `policy` in place of its two tokens.

`variance-authority-tribunal-provision` now takes a repository to a serving deployment: it writes `wrangler.jsonc` when there is none, registers the GitHub App from a manifest, so you confirm one page and install it, and deploys. It no longer makes Cloudflare Access applications, and `--reviewer` is gone. `--skip-deploy` leaves publishing to a deployment with its own build. The review bundle and fonts are laid out in `dist/public`, so a Worker's `assets` directory points into the package.
