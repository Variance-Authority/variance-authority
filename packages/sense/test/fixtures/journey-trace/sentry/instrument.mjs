// The service side: Sentry's own `--import` setup, untouched by the journey.
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: 'https://public@127.0.0.1:1/1',
  transport: () => ({ send: async () => ({}), flush: async () => true }),
});
