// The test side: Sentry as any application's tests would initialize it, with a
// transport that sends nothing, handed over as the trace each case runs in.
// Required once per Jest worker, outside every test file's sandbox.
const Sentry = require('@sentry/node');
const { sentry } = require('@variance-authority/sense/case-journey');

Sentry.init({
  dsn: 'https://public@127.0.0.1:1/1',
  transport: () => ({ send: async () => ({}), flush: async () => true }),
});
module.exports = sentry(Sentry);
