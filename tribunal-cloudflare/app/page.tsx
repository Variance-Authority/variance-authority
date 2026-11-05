import type { Introduced } from '@variance-authority/tribunal/worker';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Review } from './review';
import { tribunal } from './tribunal';

/**
 * Rendered per request, because who is asking is a per-request fact.
 *
 * The question is the service's own `/auth/me`, so this page cannot disagree with
 * the routes about who may read or decide. A reader the deployment opened to is
 * drawn the same surface with nothing to decide with.
 */
export const dynamic = 'force-dynamic';

export default async function ReviewPage(): Promise<React.ReactElement> {
  const asked = new Request('https://review.invalid/auth/me', { headers: await headers() });
  const answer = await tribunal().fetch(asked);
  if (!answer.ok) throw new Error(`/auth/me answered ${answer.status}`);
  const me = (await answer.json()) as Introduced;

  if (me.capability === undefined && me.signIn !== undefined) redirect(`/api${me.signIn}?return=/`);
  if (me.capability !== 'review' && me.capability !== 'view') {
    return (
      <main className="va-review">
        <h1>No reviewer</h1>
        <p>
          This deployment recognizes nobody here. <code>REVIEW_CREDENTIALS</code> says who may decide
          and <code>VIEW</code> whether anybody else may read.
        </p>
      </main>
    );
  }

  return <Review reviewer={me.name} />;
}
