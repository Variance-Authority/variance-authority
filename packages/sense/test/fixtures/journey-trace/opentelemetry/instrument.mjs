// The service side: OpenTelemetry's own `--import` setup for an ES module
// application, untouched by the journey.
import { register } from 'node:module';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';

register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);
new NodeTracerProvider().register();
registerInstrumentations({ instrumentations: [new HttpInstrumentation(), new UndiciInstrumentation()] });
