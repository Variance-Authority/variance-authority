# Set up or check a Cloudflare tribunal

Install the package in the repository the tribunal is for, then run one command
there. It needs no config: it writes one when there is none, and that config
points into the installed package, so a run refuses to write one from a package
cache.

```bash
npm install --save-dev @variance-authority/tribunal wrangler
```

```bash
variance-authority-tribunal-provision --config deploy/wrangler.jsonc
```

Do not ask the person for an id, a token, a client id or a secret. The command
makes or reads each one and writes it where it belongs:

- `wrangler.jsonc`, when absent, for the packaged Worker. Its paths point into the
  installed package, so an upgrade is an install and a deploy;
- the D1 database and the R2 bucket the config names, and the database's id
  into `database_id`;
- the schema, by `d1 migrations apply --remote`;
- `INGEST_CREDENTIALS=github-actions` and `REVIEW_CREDENTIALS=github` into `vars`,
  when absent, with `GITHUB_REPOSITORY`, `GITHUB_ACTIONS_REPOSITORIES` and
  `GITHUB_ACTIONS_AUDIENCE`;
- a GitHub App with read access to metadata and nothing else: `GITHUB_CLIENT_ID`
  into `vars`, `GITHUB_CLIENT_SECRET` and `GITHUB_SESSION_SECRET` into the Worker;
- the deploy itself, when anything changed or the Worker is not answering.

Those who can write to `GITHUB_REPOSITORY` decide, under their GitHub login.
Workflows in `GITHUB_ACTIONS_REPOSITORIES` push with the token the runner issues,
so no secret is stored for CI, and only workflows on the default branch move a
baseline. The run ends by printing the `review` and `baselines` blocks and the
job's `permissions`: apply them yourself, to `variance.config` and the workflow.
For an open source project, add `"VIEW": "public"` to `vars` and
deploy: anybody can read, and only a person with write access can decide.

`--repository owner/name` names the repository; without it, the one `gh` sees in
the working directory. A run refuses a repository the deployment does not already
name; widening who may push is a change to `GITHUB_ACTIONS_REPOSITORIES` in
`vars`, made on purpose. `--mount /api` is where a deployment serves the API when not at
the root. `--skip-deploy` leaves publishing to a deployment with its own build,
such as the console. `--rotate` replaces the session key, which signs everybody
out, and the ingest token where `token` is declared. The run needs `gh` authenticated; `wrangler` is logged in by the run itself.

The run asks before it makes anything, so a second run changes nothing and says
`already provisioned`.

What the config already declares is the deployer's. A deployment that declares
`REVIEW_CREDENTIALS=access` gets no App: who passes Cloudflare Access, or the SSO
behind it, is theirs, and so are `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`. Hand them
[the steps](https://variance-authority.dev/reference/packages/tribunal#your-companys-sso), which include the
bypass that keeps a workflow's push working. One that
declares `INGEST_CREDENTIALS=token` gets `INGEST_TOKEN` in the Worker and the
same value in the repository's `VARIANCE_INGEST_TOKEN` secret, through stdin, and
never printed. Neither copy can be read back. A repository with no copy while the
Worker holds one is refused, because a new token would move the push to it:
`--rotate` mints both, and is also the way back from a rotation that failed
between the two, which the error says.

Three steps need the person, and the command says which:

- No Cloudflare login. The command runs `wrangler login`, and the person allows
  it in the browser window that opens. This happens once per machine.
- R2 is not enabled on the account. Enabling it is agreeing to a storage plan;
  the command prints the dashboard address and exits `1`. Run it again after.
- The GitHub App. The browser opens on GitHub's page for it: the person confirms
  it, then installs it on the repository. An organization's App needs an owner of
  that organization. A run stopped here starts the App again next time.

Commit the config the run wrote.
