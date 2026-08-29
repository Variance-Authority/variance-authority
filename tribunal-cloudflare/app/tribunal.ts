import { createTribunal, type Tribunal } from '@variance-authority/tribunal/worker';
import { env } from 'cloudflare:workers';

/**
 * The service, built once per isolate.
 *
 * `createTribunal` validates the two tokens and builds the routing table; an
 * isolate serves many requests and there is nothing per-request about either.
 */
let built: Tribunal | undefined;

export function tribunal(): Tribunal {
  if (built !== undefined) return built;

  const retentionDays = Number(env.RETENTION_DAYS);
  built = createTribunal({
    db: env.DB,
    bucket: env.BUCKET,
    project: env.PROJECT,
    ingestToken: env.INGEST_TOKEN,
    reviewToken: env.REVIEW_TOKEN,
    // `Number(undefined)` is NaN and `Number('')` is 0, and zero days would sweep
    // every build the first time anybody asked. Both fall back to the default.
    ...(Number.isFinite(retentionDays) && retentionDays > 0 ? { retentionDays } : {}),
  });
  return built;
}

export const TOKENS = {
  get ingest(): string {
    return env.INGEST_TOKEN;
  },
  get review(): string {
    return env.REVIEW_TOKEN;
  },
};
