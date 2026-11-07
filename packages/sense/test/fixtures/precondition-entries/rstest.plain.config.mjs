import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/rstest';

// `plain` is a project nobody wrapped, beside a wrapped `two` that `--project` may leave out.
const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
const include = (file) => file.startsWith(source);

export default withTestSelection(
  {
    root,
    projects: [
      { name: 'plain', root, globals: true, include: ['test/entries.check.ts'] },
      withTestSelection(
        { name: 'two', root, globals: true, include: [process.env['FIXTURE_TWO_INCLUDE'] ?? 'test/entries.check.ts'] },
        { coverageFile, include, preconditions: JSON.parse(process.env['FIXTURE_PROJECT_PRECONDITIONS'] ?? '[]') },
      ),
    ],
  },
  { coverageFile, include, preconditions: JSON.parse(process.env['FIXTURE_PRECONDITIONS']) },
);
