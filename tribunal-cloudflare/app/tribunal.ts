import { createTribunal, declaredPolicy, type Tribunal } from '@variance-authority/tribunal/worker';
import { env } from 'cloudflare:workers';

/**
 * The service, built once per isolate.
 *
 * `declaredPolicy` reads `INGEST_CREDENTIALS` and `REVIEW_CREDENTIALS`, the same
 * two lists the packaged Worker reads, so this console recognizes exactly who a
 * deployment of that Worker would. An isolate serves many requests and there is
 * nothing per-request about either.
 */
let built: Tribunal | undefined;

export function tribunal(): Tribunal {
  if (built !== undefined) return built;

  const retentionDays = Number(env.RETENTION_DAYS);
  built = createTribunal({
    db: env.DB,
    bucket: env.BUCKET,
    project: env.PROJECT,
    policy: declaredPolicy(env as unknown as Readonly<Record<string, unknown>>),
    // `Number(undefined)` is NaN and `Number('')` is 0, and zero days would sweep
    // every build the first time anybody asked. Both fall back to the default.
    ...(Number.isFinite(retentionDays) && retentionDays > 0 ? { retentionDays } : {}),
  });
  return built;
}
