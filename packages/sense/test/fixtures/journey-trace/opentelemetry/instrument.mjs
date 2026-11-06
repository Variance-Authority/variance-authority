// The service side: OpenTelemetry's own `--import` setup for an ES module
// application, untouched by the journey.
import { register } from 'node:module';
import { context, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } from '@opentelemetry/core';
import { TracerProvider } from '@opentelemetry/sdk-trace';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';

register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);
context.setGlobalContextManager(new AsyncLocalStorageContextManager());
propagation.setGlobalPropagator(
  new CompositePropagator({ propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()] }),
);
trace.setGlobalTracerProvider(new TracerProvider());
registerInstrumentations({ instrumentations: [new HttpInstrumentation(), new UndiciInstrumentation()] });
