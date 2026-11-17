// The shop's contract: the only states a test may stand in, and the edges
// between them. Everything a test touches goes through here.
import { back, over, byLabel, byRole, byTestId, changed, fragment, leads, stay, stays } from './broker/broker.js';

export const Results = fragment('results', {
  probe: byRole('region', 'Results'),
  reads: { items: (r) => r.texts(byRole('listitem')) },
});

export const Header = fragment('header', {
  probe: byRole('banner'),
  actions: {
    search: leads({ results: Results }, async (d, q: string) => {
      await d.fill(byRole('searchbox', 'Search'), q);
      await d.press(byRole('searchbox', 'Search'), 'Enter');
    }),
  },
});

export const Payment = fragment('payment', {
  probe: byRole('form', 'Payment'),
  uses: { header: Header },
});

export const SignIn = fragment('sign-in', {
  probe: byRole('dialog', 'Sign in'),
  actions: {
    email: (d, email: string) => d.fill(byLabel('Email'), email),
    signIn: leads({ payment: Payment }, (d) => d.click(byRole('button', 'Sign in'))),
    cancel: leads({ billing: back }, (d) => d.click(byRole('button', 'Cancel'))),
  },
});

export const Billing = fragment('billing', {
  probe: byRole('form', 'Billing details'),
  uses: { header: Header },
  actions: {
    country: (d, country: string) => d.select(byLabel('Country'), country),
    street: (d, street: string) => d.fill(byLabel('Street'), street),
    submit: leads({ payment: Payment, signIn: over(SignIn), invalid: stay }, (d) =>
      d.click(byRole('button', 'Continue')),
    ),
  },
  reads: {
    errors: (r) => r.texts(byRole('alert')),
    address: (r) => r.value(byLabel('Street')),
  },
});

const likes = (r: { number: (where: ReturnType<typeof byTestId>) => Promise<number> }) =>
  r.number(byTestId('likes'));

export const Product = fragment('product', {
  probe: byRole('article', 'Product'),
  uses: { header: Header },
  actions: {
    like: stays((d) => d.click(byRole('button', 'Like')), { until: changed(likes) }),
  },
  reads: { likes },
});
