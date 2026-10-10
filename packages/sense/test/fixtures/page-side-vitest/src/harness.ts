import { inPage } from './page';

/** A harness whose `open` subscribes in the page; its function crosses as text, so no probe may sit in it. */
export function createHarness(): { open(): string } {
  return {
    open: () => inPage(() => ['load', 'pageerror'].join(',')),
  };
}
