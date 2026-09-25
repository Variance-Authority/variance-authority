import * as api from '@opentelemetry/api';
import { openTelemetry } from '@variance-authority/sense/journey';

export const trace = openTelemetry(api);
