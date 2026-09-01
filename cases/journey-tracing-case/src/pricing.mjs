// Product source. Nothing in here knows about a test: it announces what it
// decided, which the application would want anyway, and it is instrumented by
// its build, which the application never sees.
import { vae } from '@variance-authority/event';

export function quote(locale) {
  if (locale === 'de') {
    vae('pricing', 'quote', 'euros');
    return '1200 EUR';
  }
  vae('pricing', 'quote', 'dollars');
  return '1200 USD';
}
