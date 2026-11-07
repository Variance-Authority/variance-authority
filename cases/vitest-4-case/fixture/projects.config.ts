import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';

// A configuration that describes the run, whose hooks Vitest 4 does not call, over two wrapped projects.
const root = fileURLToPath(new URL('.', import.meta.url));
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE']!;
const include = (file: string): boolean => file === resolve(root, 'add.ts');
const entries = (name: string): string[] => JSON.parse(process.env[name] ?? '[]') as string[];

export default withTestSelection(
  {
    root,
    test: {
      projects: [
        withTestSelection({ root, test: { name: 'one', include: ['one.case.ts'] } }, { coverageFile, include }),
        withTestSelection(
          { root, test: { name: 'two', include: [process.env['FIXTURE_TWO_INCLUDE'] ?? 'two.case.ts'] } },
          { coverageFile, include, preconditions: entries('FIXTURE_PROJECT_PRECONDITIONS') },
        ),
      ],
    },
  },
  { coverageFile, include, preconditions: entries('FIXTURE_ROOT_PRECONDITIONS') },
);
