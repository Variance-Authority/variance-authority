---
'@variance-authority/cli': minor
'@variance-authority/store': patch
---

A git share on GitHub Actions is reached with the step's `GITHUB_TOKEN` when the clone keeps no header for the remote, as a checkout with `persist-credentials: false` leaves it, so `variance share --publish` needs no git header or `GIT_CONFIG_*` variables from the caller: the publish step sets `env: GITHUB_TOKEN: ${{ github.token }}`. The token is offered only on Actions and only to a remote on the host `GITHUB_SERVER_URL` names, reaches git through its environment configuration and is written to no file; a header the clone or the environment already gives git wins. The review action hands its `github-token` to its publish step the same way.
