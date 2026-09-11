/**
 * `@variance-authority/remote` — the same tools, on the other side of a wire.
 *
 * Every tool in this project takes and returns something serializable, and this
 * package is what that property is *for*: a document acquired in a unit test on
 * one machine can be painted by a pinned machine two networks away, and nothing
 * above or below the hop is written differently. The client half and the serving
 * half live together because they are one protocol — split across two packages
 * they would drift, and a client and server disagreeing about a wire format is
 * the failure that presents as a verdict.
 *
 * Both halves are shipped for both tools, each under its own entrypoint: a
 * renderer reached over HTTP at `./renderer`, and a baseline store reached over
 * HTTP at `./store`. This entrypoint holds what the two share: the batching.
 * What crosses is checked on arrival by `@variance-authority/raster`'s own record
 * checks, so a record that came down a socket is believed on exactly the terms
 * one read off a disk is.
 */

export { batching } from './batch.js';
export type { BatchOptions, SendBatch, Settled } from './batch.js';
