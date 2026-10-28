import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/rstest';

const root = fileURLToPath(new URL('.', import.meta.url));
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
// Where the probes go: after the project's transforms unless the test asks for before.
const placement = process.env['VARIANCE_AUTHORITY_PLACEMENT'];
// `post` puts the extractor among the post loaders, which run right to left.
const enforce = process.env['VARIANCE_AUTHORITY_EXTRACTOR_ENFORCE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');

export default withTestSelection(
  {
    root,
    globals: true,
    include: ['test/*.case.ts'],
    tools: {
      rspack: {
        module: { rules: [{ test: /\.ts$/, ...(enforce === undefined ? {} : { enforce }), use: [{ loader: fileURLToPath(new URL('./extract-loader.cjs', import.meta.url)) }] }] },
      },
    },
  },
  { coverageFile, ...(placement === undefined ? {} : { placement }) },
);
