// The test side: Sentry as any application's tests would initialize it, with a
// transport that sends nothing, then one line that hands it the journeys.
const Sentry = require('@sentry/node');
const { carryJourneys, sentry } = require('@variance-authority/sense/case-journey');

Sentry.init({
  dsn: 'https://public@127.0.0.1:1/1',
  transport: () => ({ send: async () => ({}), flush: async () => true }),
});
carryJourneys(sentry(Sentry));
