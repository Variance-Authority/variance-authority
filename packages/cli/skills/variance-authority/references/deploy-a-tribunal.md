# Set up or check a Cloudflare tribunal

Run one command from the directory that holds the deployment's
`wrangler.jsonc`, or name the file:

```bash
npx -p @variance-authority/tribunal variance-authority-tribunal-provision --config deploy/wrangler.jsonc
```

Do not ask the person for an id, a token, a team domain or an AUD. The command
makes or reads each one and writes it where it belongs:

- the D1 database and the R2 bucket the config names, and the database's id
  into `database_id`;
- the schema, by `d1 migrations apply --remote`;
- an Access organization, one-time PIN sign-in, an application in front of the
  review pages that admits `--reviewer` (the Cloudflare login's email when
  absent), and a bypass application on the paths CI and share links call with
  a bearer token;
- `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` into the config's `vars`;
- `INGEST_TOKEN` into the Worker and the same value into the repository's
  `VARIANCE_INGEST_TOKEN` secret, through stdin. It is never printed;
- `REVIEW_TOKEN` into the Worker, which refuses every request without one. It is
  shown to nobody; do not ask for it. A person who needs one sets their own with
  `wrangler secret put REVIEW_TOKEN`.

`--repository owner/name` names the repository whose CI pushes builds; without
it, the one `gh` sees in the working directory. It needs `wrangler` logged in
and `gh` authenticated with permission to set that repository's secrets and
variables.

The run asks before it makes anything, so a second run changes nothing and says
`already provisioned`. A token missing on either side, the Worker or the
repository, is minted again for both. `--rotate` mints both tokens regardless.
Neither copy can be read back, so a rotation is journaled in the repository
variable `VARIANCE_INGEST_ROTATION`: set before the Worker is written, deleted
after the repository is. A rotation that fails between the two leaves CI with a
token the Worker refuses, and the error says so; run the command again and it
replaces both. A token changed by hand outside the command leaves no journal:
run it with `--rotate`.

An Access application already there is checked, not trusted: the review one
must admit the reviewer, the machines one must bypass every machine path. A
difference stops the run with exit 1 and names it; fix the application in the
Zero Trust dashboard, or delete it and run again to have it made.

Two steps need the person, and the command says which:

- The Cloudflare login lacks Access. The command runs `wrangler login` with the
  Access scopes added, and the person allows it in the browser window that
  opens. This happens once per machine.
- R2 is not enabled on the account. Enabling it is agreeing to a storage plan;
  the command prints the dashboard address and exits `1`. Run it again after.

The command does not deploy. Commit the config it wrote, then run the
deployment's own deploy step so the Worker serves the new `vars`.
