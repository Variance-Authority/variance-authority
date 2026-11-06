import { mounted } from '../../routes';

/**
 * Every service route, mounted once.
 *
 * The whole router — baselines, cache, history, share, review, sweep — is one
 * `fetch` handler, so this file is the mount point and not a list of endpoints
 * that could fall behind the package's own. Who a request is stays the declared
 * policy's: see `tribunal.ts`.
 */
export const { GET, POST, PUT, HEAD } = mounted('/api');
