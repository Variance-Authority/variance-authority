# Put one Storybook story through review

Use this path when Storybook already owns mounting, decorators, play functions,
and readiness. The collector reads its built `index.json`, switches stories
through the preview channel, and gives the CLI one subject per story.

## Before you collect

Build the Storybook artifact you want to judge. A served development Storybook
also works, but this first loop uses `storybook-static/index.json`. Stories that
continue work after Storybook's `storyRendered` signal need an application-owned
ready selector; ordinary stories need none.

```bash
npm install --save-dev @variance-authority/cli @variance-authority/storybook-collector
npx playwright install chromium
```

## Point the collector at the build

Create the smallest collector module. Replace `src` if components are declared
somewhere else:

```js
// variance/storybook.mjs
import { storybookCollector } from '@variance-authority/storybook-collector';

export default storybookCollector({
  source: { dirs: ['src'] },
});
```

Then add the durable run config:

```json
{
  "project": "checkout-ui",
  "profile": "chromium",
  "viewport": { "width": 1280, "height": 800 },
  "retention": "durable",
  "subjects": {
    "kind": "storybook",
    "index": "storybook-static/index.json",
    "collector": "variance/storybook.mjs"
  },
  "baselines": { "kind": "directory", "root": ".variance/baselines" },
  "fonts": [],
  "report": ".variance/report.json"
}
```

## Run the first review loop

Check the same machine or CI image that performs the run, then collect:

```bash
npx variance doctor --config variance.config.json
npx variance run --config variance.config.json
```

The first successful durable run exits `1` and reports the stories as `new`.
Render the HTML report beside the JSON report so its relative image links hold:

```bash
npx variance report --config variance.config.json --format html > .variance/report.html
```

Open that report and review the candidate. Copy the exact subject id it shows;
Storybook subjects use the `story:` prefix. For a story whose Storybook id is
`checkout--empty`:

```bash
npx variance accept --config variance.config.json story:checkout--empty
npx variance run --config variance.config.json
```

Acceptance promotes the candidate the report already names. The rerun exits `0`
and reports that story as `unchanged`.

## Go deeper

Read [attribution](attribution.md) before choosing how declaration and JSX source
locations survive a production build, or [composition](composition.md) when the
story result must join other evidence. Read the
[`@variance-authority/storybook-collector` reference](../packages/storybook-collector/README.md)
for readiness, loading fallbacks, served Storybooks, source provenance, and the
complete option contract.
