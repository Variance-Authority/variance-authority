// The declared edges are the app's test interface; the journals say which were walked.
import { edges, walked } from '../broker/journal.js';
import { expect, test } from '../fixture.js';
import { Billing } from '../shop.js';

test('a model lists its edges, through the fragments it reaches', () => {
  expect(edges([Billing])).toEqual([
    'billing.country',
    'billing.street',
    'billing.submit → invalid',
    'billing.submit → payment',
    'billing.submit → signIn',
    'header.search → results',
    'sign-in.cancel → billing',
    'sign-in.email',
    'sign-in.signIn → payment',
  ]);
});

test('the journals mark each edge with how often it was walked', () => {
  const journal = [
    { from: 'billing', action: 'country', kind: 'stay', to: 'billing' },
    { from: 'billing', action: 'submit', kind: 'lead', outcome: 'payment', to: 'payment' },
    { from: 'billing', action: 'submit', kind: 'lead', outcome: 'payment', to: 'payment' },
    { from: 'billing', action: 'raw', kind: 'raw', to: 'billing' },
  ] as const;
  expect(walked(['billing.country', 'billing.submit → payment', 'billing.submit → signIn'], [journal])).toEqual({
    walked: { 'billing.country': 1, 'billing.submit → payment': 2 },
    unwalked: ['billing.submit → signIn'],
    raw: 1,
  });
});

test('the reporter prints every declared edge, unwalked ones at zero', async () => {
  const { default: EdgesReporter } = await import('../edges-reporter.js');
  const reporter = new EdgesReporter();
  const journal = [{ from: 'billing', action: 'country', kind: 'stay', to: 'billing' }];
  reporter.onTestEnd({} as never, { attachments: [{ name: 'journal', body: Buffer.from(JSON.stringify(journal)) }] } as never);
  const printed: string[] = [];
  const log = console.log;
  console.log = (line: string) => void printed.push(line);
  try {
    reporter.onEnd();
  } finally {
    console.log = log;
  }
  expect(printed.join('\n')).toContain('edges walked: 1 of ');
  expect(printed.join('\n')).toMatch(/^ {5}1 {2}billing\.country$/m);
  expect(printed.join('\n')).toMatch(/^ {5}0 {2}billing\.street$/m);
});
