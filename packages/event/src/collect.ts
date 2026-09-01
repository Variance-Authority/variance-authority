/**
 * `@variance-authority/event/collect` — the listening half.
 *
 * Split from the announcing half because they ship to different places. A
 * product bundle imports {@link vae} and takes on a property read; a driver and a
 * service under test import this, and nothing that reaches a user does.
 */

export { createEventLog, type EventLog, type RecordedEvent, type WaitOptions } from './log.js';
export { eventCollectorSource } from './page.js';
export {
  collectEvents,
  EVENT_HEAD_VARIABLE,
  EVENT_VARIABLE,
  type EventCollector,
  type EventCollectorOptions,
  type HeadEventReport,
} from './head.js';
