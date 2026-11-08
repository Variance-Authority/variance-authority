---
'@variance-authority/cli': minor
---

`variance share --publish` reaches a git share with the publish step's `GITHUB_TOKEN` when the clone keeps no header for the remote, as a checkout with `persist-credentials: false` leaves it. The token is offered only to a remote on the host `GITHUB_SERVER_URL` names (`https://github.com` when it names none), reaches git through its environment configuration and is written to no file; a header the clone or the environment already gives git wins. A publish step sets `env: GITHUB_TOKEN: ${{ github.token }}` and writes no git header or `GIT_CONFIG_*` variables. The review action hands its `github-token` to its publish step the same way.
