/**
 * How the tribunal Storybook is photographed: the shipped collector, with the
 * component source it attributes a changed region to.
 *
 * `source.dirs` is read from the repository root, which is where the gate runs
 * `variance run`.
 */
import { storybookCollector } from '@variance-authority/storybook-collector';

export default storybookCollector({
  source: { dirs: ['packages/tribunal/src/ui'] },
});
