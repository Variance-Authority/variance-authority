import { shout } from '../src/strings';
import { click, open } from '../src/dialog';

function loud(text: string): string {
  return shout(text);
}

describe('dialog', () => {
  it('opens', () => {
    expect(open()).toBe('open');
  });
  it('confirms on click', () => {
    expect(click(true)).toBe('yes');
  });
});

export { loud };
