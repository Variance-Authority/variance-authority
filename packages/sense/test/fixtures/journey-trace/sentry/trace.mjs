import * as Sentry from '@sentry/node';
import { sentry } from '@variance-authority/sense/journey';

export const trace = sentry(Sentry);
