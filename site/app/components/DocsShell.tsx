import { Fragment, type ReactNode } from "react";
import {
  NAVIGATION,
  navigationItem,
  navigationNeighbors,
} from "../navigation";
import DocsFooter from "./DocsFooter";
import DocsHeader from "./DocsHeader";

export interface TableOfContentsItem {
  readonly id: string;
  readonly label: string;
}

export interface DocsShellProps {
  readonly current: string;
  readonly title: string;
  readonly description: string;
  readonly eyebrow: string;
  readonly toc: readonly TableOfContentsItem[];
  readonly children: ReactNode;
}

function NavigationLinks({ current }: { readonly current: string }) {
  return (
    <nav aria-label="Documentation">
      <div className="space-y-7">
        {NAVIGATION.map((section) => (
          <div key={section.label}>
            <p className="mb-2 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-quiet">
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item, index) => {
                const active =
                  item.href === current ||
                  (item.href === "/reference/packages" &&
                    current.startsWith("/reference/packages/"));
                const previous = section.items[index - 1];
                const startsCluster =
                  "cluster" in item &&
                  item.cluster !==
                    (previous && "cluster" in previous
                      ? previous.cluster
                      : undefined);
                return (
                  <Fragment key={item.href}>
                    {startsCluster ? (
                      <li className="pb-1 pt-4 first:pt-1">
                        <span className="px-3 font-mono text-[9px] uppercase tracking-[0.13em] text-quiet">
                          {item.cluster}
                        </span>
                      </li>
                    ) : null}
                    <li>
                      <a
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`block rounded-md border-l-2 px-3 py-2 text-sm leading-5 transition-colors ${
                          active
                            ? "border-orange bg-orange/[0.07] font-medium text-ivory"
                            : "border-transparent text-quiet hover:border-hairline hover:bg-panel/70 hover:text-ivory"
                        }`}
                      >
                        {item.label}
                      </a>
                    </li>
                  </Fragment>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

export default function DocsShell({
  current,
  title,
  description,
  eyebrow,
  toc,
  children,
}: DocsShellProps) {
  const item = navigationItem(current);
  const { previous, next } = navigationNeighbors(current);
  const section =
    item?.section ??
    (current.startsWith("/reference/packages/")
      ? "Package reference"
      : "Documentation");

  return (
    <div className="min-h-screen bg-deep">
      <a
        href="#main-content"
        className="docs-skip-link rounded-md bg-orange px-4 py-2 text-sm font-semibold text-deep"
      >
        Skip to content
      </a>
      <DocsHeader current={current} />

      <details className="docs-mobile-navigation sticky top-[3.25rem] z-40 border-b border-hairline bg-deep/95 px-5 py-3 backdrop-blur-md lg:hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 text-sm text-ivory">
          <span>
            <span className="mr-2 font-mono text-[10px] uppercase tracking-[0.16em] text-orange">
              Browse
            </span>
            {item?.label ?? title}
          </span>
          <span aria-hidden="true" className="docs-mobile-chevron text-orange">
            ↓
          </span>
        </summary>
        <div className="max-h-[70vh] overflow-y-auto border-t border-hairline py-5">
          <NavigationLinks current={current} />
        </div>
      </details>

      <div className="docs-grid mx-auto max-w-[94rem] px-5 sm:px-6">
        <aside className="docs-sidebar hidden lg:block">
          {item ? (
            <div className="mb-7 border-l-2 border-orange px-3 py-1">
              <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-quiet">
                Current page
              </p>
              <p className="mt-1 text-xs leading-5 text-ivory">{item.label}</p>
            </div>
          ) : null}
          <NavigationLinks current={current} />
        </aside>

        <main id="main-content" className="min-w-0 py-10 sm:py-14 lg:py-16">
          <nav aria-label="Breadcrumb" className="mb-8">
            <ol className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-quiet">
              {current === "/docs" ? (
                <li aria-current="page" className="text-quiet">
                  Documentation
                </li>
              ) : (
                <>
                  <li>
                    <a href="/docs" className="transition-colors hover:text-ivory">
                      Docs
                    </a>
                  </li>
                  <li aria-hidden="true">/</li>
                  <li>{section}</li>
                  <li aria-hidden="true">/</li>
                  <li aria-current="page" className="text-quiet">
                    {item?.label ?? title}
                  </li>
                </>
              )}
            </ol>
          </nav>

          <article>
            <header className="mb-12 border-b border-hairline pb-9">
              <p className="mb-4 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-orange">
                {eyebrow}
              </p>
              <h1 className="max-w-3xl text-4xl font-bold leading-[1.08] tracking-tight text-ivory sm:text-5xl">
                {title}
              </h1>
              <p className="mt-5 max-w-3xl text-lg leading-8 text-quiet">
                {description}
              </p>
            </header>

            <div className="docs-content">{children}</div>
          </article>

          {previous || next ? (
            <nav
              aria-label="Documentation pagination"
              className="mt-16 grid gap-4 border-t border-hairline pt-8 sm:grid-cols-2"
            >
              {previous ? (
                <a
                  href={previous.href}
                  className="group rounded-xl border border-hairline bg-panel/50 p-4 transition-colors hover:border-orange/50"
                >
                  <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-quiet">
                    ← Previous
                  </span>
                  <span className="mt-2 block text-sm font-medium text-ivory group-hover:text-orange">
                    {previous.label}
                  </span>
                </a>
              ) : (
                <span />
              )}
              {next ? (
                <a
                  href={next.href}
                  className="group rounded-xl border border-hairline bg-panel/50 p-4 text-right transition-colors hover:border-orange/50"
                >
                  <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-quiet">
                    Next →
                  </span>
                  <span className="mt-2 block text-sm font-medium text-ivory group-hover:text-orange">
                    {next.label}
                  </span>
                </a>
              ) : null}
            </nav>
          ) : null}
        </main>

        {toc.length > 0 ? (
          <aside className="docs-toc hidden xl:block">
            <nav aria-label="On this page">
              <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-quiet">
                On this page
              </p>
              <ul className="space-y-2 border-l border-hairline">
                {toc.map((entry) => (
                  <li key={entry.id}>
                    <a
                      href={`#${entry.id}`}
                      className="block border-l border-transparent py-1 pl-4 text-xs leading-5 text-quiet transition-colors hover:border-orange hover:text-ivory"
                    >
                      {entry.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>
        ) : null}
      </div>

      <DocsFooter />
    </div>
  );
}
