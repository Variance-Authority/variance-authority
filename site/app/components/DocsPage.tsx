import Link from "next/link";
import type { ReactNode } from "react";
import {
  navigationItem,
  navigationNeighbors,
  navigationSection,
} from "../navigation";

export interface TableOfContentsItem {
  readonly id: string;
  readonly label: string;
}

export interface DocsPageProps {
  readonly current: string;
  readonly title: string;
  readonly description: string;
  readonly eyebrow: string;
  readonly toc: readonly TableOfContentsItem[];
  readonly children: ReactNode;
}

/**
 * One documentation page inside the documentation layout's grid: the article
 * column, and the contents column when there is something to list. Both are
 * returned as siblings so the grid places them; nothing here wraps them.
 */
export default function DocsPage({
  current,
  title,
  description,
  eyebrow,
  toc,
  children,
}: DocsPageProps) {
  const item = navigationItem(current);
  const { previous, next } = navigationNeighbors(current);
  const section = navigationSection(current);

  return (
    <>
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
                  <Link
                    href="/docs"
                    className="transition-colors hover:text-ivory"
                  >
                    Docs
                  </Link>
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
              <Link
                href={previous.href}
                className="group rounded-xl border border-hairline bg-panel/50 p-4 transition-colors hover:border-orange/50"
              >
                <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-quiet">
                  ← Previous
                </span>
                <span className="mt-2 block text-sm font-medium text-ivory group-hover:text-orange">
                  {previous.label}
                </span>
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link
                href={next.href}
                className="group rounded-xl border border-hairline bg-panel/50 p-4 text-right transition-colors hover:border-orange/50"
              >
                <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-quiet">
                  Next →
                </span>
                <span className="mt-2 block text-sm font-medium text-ivory group-hover:text-orange">
                  {next.label}
                </span>
              </Link>
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
    </>
  );
}
