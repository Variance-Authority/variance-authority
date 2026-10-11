import { appendFileSync } from 'node:fs';
import { it } from 'vitest';

// Six tests that write their names, as each runs, to the file the test that
// runs this fixture names: the order the tests in one file ran in.
const order = process.env['FIXTURE_ORDER'];
const ran = (name: string) => () => {
  if (order !== undefined) appendFileSync(order, `${name}\n`);
};

it('a', ran('a'));
it('b', ran('b'));
it('c', ran('c'));
it('d', ran('d'));
it('e', ran('e'));
it('f', ran('f'));
