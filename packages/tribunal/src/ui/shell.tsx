/**
 * The chrome every page wears, and the three things every page needs.
 *
 * Apart from the pages because it is the part that must not differ between them:
 * a topbar that moves by four pixels between the docket and a subject reads as a
 * page that reloaded, and a failure rendered two ways is a failure a reader has
 * to learn twice.
 */

import { Fragment, type ReactElement, type ReactNode } from 'react';
import { Mark } from './mark.js';
import { hrefOf, type Route } from './route.js';
import { segments } from './text.js';

/** Something fetched, in the three states it can be in. Never two. */
export type Loaded<T> =
  | { readonly state: 'loading' }
  | { readonly state: 'failed'; readonly why: string }
  | { readonly state: 'ready'; readonly value: T };

/** An error as a sentence a reader can act on, never an empty list. */
export function Failure({
  why,
  retry,
}: {
  readonly why: string;
  readonly retry: () => void;
}): ReactElement {
  return (
    <p className="va-failure">
      {why}{' '}
      <button type="button" onClick={retry}>
        retry
      </button>
    </p>
  );
}

/**
 * Report prose, with its identifiers set as identifiers.
 *
 * The sentences on this page were written by the observer, not by this surface,
 * and they are shown as written — this is the record, and a review page that
 * paraphrases it is a review page a reviewer cannot check. The only thing done
 * to them is typographic.
 */
export function Prose({ text }: { readonly text: string }): ReactElement {
  return (
    <>
      {segments(text).map((part, index) =>
        part.code ? (
          <code key={`${String(index)}-${part.text}`}>{part.text}</code>
        ) : (
          <Fragment key={`${String(index)}-${part.text}`}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * A link that is a link.
 *
 * `<a href>` rather than a button, because the address is real: a reviewer who
 * middle-clicks a change gets it in a tab, and one who copies the link gets a
 * link that opens on the same change. The click is intercepted so an ordinary
 * navigation stays a repaint — but only the ordinary one. A modified click, or
 * anything but the primary button, is the browser's.
 */
export function Go({
  to,
  go,
  className,
  title,
  children,
}: {
  readonly to: Route;
  readonly go: (route: Route) => void;
  readonly className?: string | undefined;
  readonly title?: string | undefined;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <a
      href={hrefOf(to)}
      className={className}
      {...(title === undefined ? {} : { title })}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
          return;
        }
        event.preventDefault();
        go(to);
      }}
    >
      {children}
    </a>
  );
}

/**
 * The bar at the top of every page: who you are looking at, and the way back.
 *
 * The crumbs are the whole navigation. There is no menu, because there are seven
 * pages and five of them are *about* the page above them — a build is about a
 * project, a change is about a build. A trail says that; a menu asserts they are
 * peers.
 */
export function Topbar({
  crumbs,
  go,
  title,
  subtitle,
  children,
}: {
  readonly crumbs: readonly { readonly at: Route; readonly say: string }[];
  readonly go: (route: Route) => void;
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <header className="va-topbar">
      <Mark />
      <nav className="va-crumbs">
        {crumbs.map((crumb) => (
          <Fragment key={hrefOf(crumb.at)}>
            <Go to={crumb.at} go={go} className="va-crumb">
              {crumb.say}
            </Go>
            <span className="va-crumb-sep">/</span>
          </Fragment>
        ))}
      </nav>
      <span className="va-topbar-title">
        <strong>{title}</strong>
        {subtitle === undefined ? null : <span className="va-topbar-sub">{subtitle}</span>}
      </span>
      {children}
    </header>
  );
}

/**
 * The shape of what is coming, while it is coming.
 *
 * A page that answers a fetch with one grey line on an empty ground has thrown
 * away everything it already knew. It knows the build it is opening, it knows
 * the crumb back to the list, and it knows roughly how tall the thing landing in
 * a moment is — so the topbar is drawn first and the body is drawn as bars. The
 * reader can leave, and when the data lands nothing jumps.
 *
 * The bars are the honest part: they claim a rough size and nothing else. They
 * are not text, so they are hidden from a screen reader, which is told the one
 * true thing instead — that this is loading.
 */
export function Waiting({
  crumbs,
  go,
  title,
  subtitle,
  bars = 3,
}: {
  readonly crumbs: readonly { readonly at: Route; readonly say: string }[];
  readonly go: (route: Route) => void;
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly bars?: number;
}): ReactElement {
  return (
    <div className="va-app">
      <Topbar crumbs={crumbs} go={go} title={title} subtitle={subtitle} />
      <div className="va-body va-scroll">
        <div className="va-page">
          <Skeleton bars={bars} label={`Loading ${title}`} />
        </div>
      </div>
    </div>
  );
}

/** The bars themselves, for a page that wants them inside chrome it drew itself. */
export function Skeleton({
  bars = 3,
  label,
}: {
  readonly bars?: number;
  readonly label: string;
}): ReactElement {
  return (
    <div className="va-waiting" role="status" aria-live="polite">
      <span className="va-visually-hidden">{label}</span>
      {Array.from({ length: bars }, (_, index) => (
        <span key={index} className="va-waiting-bar" aria-hidden="true" />
      ))}
    </div>
  );
}

/** The chrome kept around a failure, so a reader who cannot load a page can leave it. */
export function Stalled({
  crumbs,
  go,
  title,
  subtitle,
  why,
  retry,
}: {
  readonly crumbs: readonly { readonly at: Route; readonly say: string }[];
  readonly go: (route: Route) => void;
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly why: string;
  readonly retry: () => void;
}): ReactElement {
  return (
    <div className="va-app">
      <Topbar crumbs={crumbs} go={go} title={title} subtitle={subtitle} />
      <div className="va-body va-scroll">
        <div className="va-page">
          <Failure why={why} retry={retry} />
        </div>
      </div>
    </div>
  );
}

/** The one page with no data on it: an address this surface does not answer. */
export function Nowhere({ go }: { readonly go: (route: Route) => void }): ReactElement {
  return (
    <div className="va-app">
      <Topbar crumbs={[]} go={go} title="No page at this address" />
      <div className="va-body va-scroll">
        <div className="va-page">
          <p className="va-note">
            This service answers the build list, a build, a change, a subject, a run and the
            changelog. Whatever this link pointed at, it is not one of them — a link from a later
            version of the surface, or one that has been edited.
          </p>
          <p>
            <Go to={{ page: 'builds' }} go={go} className="va-mode">
              Go to the builds
            </Go>
          </p>
        </div>
      </div>
    </div>
  );
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
