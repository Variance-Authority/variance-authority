export { observe, createVariance } from './direct.js';
export type {
  CreateVarianceOptions,
  DirectObservationOptions,
  VarianceSession,
} from './direct.js';
export { varianceFixtures } from './fixture.js';
export type {
  VarianceFixtures,
  VarianceOptions,
  InPlaceCaptureOptions,
  MaterializationOptions,
  VarianceRuntime,
  VarianceWorkerFixtures,
} from './fixture.js';
export { assertUnchanged, toBeUnchanged, varianceMatchers } from './matcher.js';
export type { UnchangedOptions } from './matcher.js';
export { AGENT, AGENT_VERSION, acquire } from './page-agent.js';
export type { Acquired, AcquireRequest, InstalledAgent } from './page-agent.js';
export { bundlePageAgent } from './bundle.js';
export { createExecutionRecorder, ownerOf } from './execution.js';
export type {
  EventDesk,
  VarianceEventFixtures,
  VarianceEventsOptions,
  VarianceEventWorkerFixtures,
} from './events.js';
export type { ExecutionRecorder, ExecutionRecording } from './execution.js';
export { varianceVantageFixtures } from './vantage.js';
export type { VarianceVantageFixtures, VarianceVantageWorkerFixtures } from './vantage.js';
export { varianceWireFixtures } from './wire.js';
export type { VarianceWireFixtures } from './wire.js';
export { CHROMIUM_RASTER_ARGS } from '@variance-authority/playwright';
