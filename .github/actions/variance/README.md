# Variance Authority action

This action runs the `variance` CLI your project already installed over a pull
request. The CLI's exit code sets the check's colour. Around that run, the
action does the three things a command line cannot do for itself:

- It posts the result to the pull request as one comment, updated in place.
- It restores and saves the baselines the Actions cache carries.
- It accepts a change on a run a person asked for, such as one a label started.

```yaml
permissions:
  pull-requests: write # the comment

steps:
  - uses: actions/checkout@v4
  - run: npm ci
  - uses: Variance-Authority/action@v<version>
    with:
      config: variance.config.json
      github-token: ${{ secrets.GITHUB_TOKEN }}
```

Name the action by `v` and the version of `@variance-authority/cli` in your
lockfile. A release publishes the CLI and the action together under one
version, and the action stops before the run, naming both versions, when the
CLI it finds is another one. It downloads nothing during the run; it calls the
CLI from your `node_modules`.

Every input is described in [`action.yml`](action.yml). The
[CLI reference](https://variance-authority.dev/reference/packages/cli#run-it-in-ci) covers
running it in CI, including how to accept a change and where the baselines can
live.

Released from
[Variance-Authority/variance-authority](https://github.com/Variance-Authority/variance-authority).
MIT.
