import { createHarness } from './index';
import { inPage } from './page';

/** Open a page through the harness and read its title in it. */
export function visit(): string {
  const events = createHarness().open();
  return `${events}:${inPage(() => 'title')}`;
}
