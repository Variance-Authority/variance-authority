import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/rstest';

// The configuration that describes the run declares for every project, and `two` for itself.
const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
const include = (file) => file.startsWith(source);
const two = process.env['FIXTURE_TWO_INCLUDE'] ?? 'test/entries.check.ts';

export default withTestSelection(
  {
    root,
    projects: [
      withTestSelection({ name: 'one', root, globals: true, include: ['test/entries.check.ts'] }, { coverageFile, include }),
      withTestSelection(
        { name: 'two', root, globals: true, include: [two] },
        { coverageFile, include, preconditions: JSON.parse(process.env['FIXTURE_PROJECT_PRECONDITIONS'] ?? '[]') },
      ),
    ],
  },
  { coverageFile, include, preconditions: JSON.parse(process.env['FIXTURE_PRECONDITIONS']) },
);
