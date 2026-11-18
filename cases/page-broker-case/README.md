# An action that says where it ended, on apps that announce nothing

`src/declared/` runs [`@variance-authority/page-broker`](../../packages/page-broker)
under the real Playwright CLI, over two apps that were not written for their
tests:

- **A shop**, `src/server.mjs`, that races its tests on purpose: the form
  hydrates late, every answer takes a random 50–600 ms, and it writes no
  attribute and no event for a test.
- **The manager of the Storybook** `cases/storybook-case` builds, served as
  files and unchanged.

`src/declared.config.mjs` is their Playwright config.

## Run it

CI runs it from `src/workflow.chromium.test.js` in the chromium slice: the shop
once, and Storybook's manager thirty times. By hand, from the repository root,
after `yarn install && yarn build`:

```bash
cd cases/page-broker-case && node ../../node_modules/@playwright/test/cli.js test --config=src/declared.config.mjs
```
