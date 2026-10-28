import { varianceBreadcrumb } from '@variance-authority/event';

const label = varianceBreadcrumb('copy', 'label', 'Pay'); // load read

export function checkoutOn(flags: { readonly checkout?: boolean }): boolean {
  if (varianceBreadcrumb('flags', 'checkout', flags.checkout === true)) return true; // flag read
  return false;
}

export function buttonLabel(): string {
  return label;
}
