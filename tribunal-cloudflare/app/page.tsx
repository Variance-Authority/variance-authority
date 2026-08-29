import { headers } from 'next/headers';
import { identify } from './access';
import { Review } from './review';

/**
 * Rendered per request, because who is asking is a per-request fact.
 *
 * There is no anonymous view of this page. A reader with no Access identity is
 * not shown a read-only docket, because the only thing that would buy is a
 * second code path that has to stay in step with the first one about which
 * evidence is public — and none of it is.
 */
export const dynamic = 'force-dynamic';

export default async function ReviewPage(): Promise<React.ReactElement> {
  const identity = await identify(new Request('https://review.invalid/', { headers: await headers() }));

  if (identity === null) {
    return (
      <main className="va-review">
        <h1>No reviewer</h1>
        <p>
          This deployment draws an approve button, so it serves the review surface only to somebody
          Cloudflare Access has authenticated. Either this request carried no Access assertion, or
          <code>ACCESS_TEAM_DOMAIN</code> and <code>ACCESS_AUD</code> are not set on the Worker — in
          which case nothing here can tell one visitor from another, and the button stays undrawn.
        </p>
        <p>
          Ingest is unaffected: <code>variance run</code> holds the ingest token and posts to{' '}
          <code>/api</code> without ever reaching this page.
        </p>
      </main>
    );
  }

  return <Review reviewer={identity.email} />;
}
