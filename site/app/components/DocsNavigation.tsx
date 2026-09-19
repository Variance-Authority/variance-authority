"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import { NAVIGATION, navigationItem, navigationSection } from "../navigation";

/**
 * The reading order as links. It lives in a client component so the active
 * entry follows the pathname while the layout around it stays mounted; a
 * server layout has no pathname to give it.
 */
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
              {section.items
                .filter((item) => !item.unlisted)
                .map((item, index, items) => {
                  const active =
                    item.href === current ||
                    (item.href === "/reference/packages" &&
                      current.startsWith("/reference/packages/"));
                  const previous = items[index - 1];
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
                          {"clusterOverview" in item && item.clusterOverview ? (
                            <Link
                              href={item.href}
                              aria-current={active ? "page" : undefined}
                              className={`block rounded-md border-l-2 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.13em] transition-colors ${
                                active
                                  ? "border-orange bg-orange/[0.07] text-ivory"
                                  : "border-transparent text-quiet hover:border-hairline hover:bg-panel/70 hover:text-ivory"
                              }`}
                            >
                              {item.cluster}
                            </Link>
                          ) : (
                            <span className="px-3 font-mono text-[9px] uppercase tracking-[0.13em] text-quiet">
                              {item.cluster}
                            </span>
                          )}
                        </li>
                      ) : null}
                      {"clusterOverview" in item &&
                      item.clusterOverview ? null : (
                        <li>
                          <Link
                            href={item.href}
                            aria-current={active ? "page" : undefined}
                            className={`block rounded-md border-l-2 px-3 py-2 text-sm leading-5 transition-colors ${
                              active
                                ? "border-orange bg-orange/[0.07] font-medium text-ivory"
                                : "border-transparent text-quiet hover:border-hairline hover:bg-panel/70 hover:text-ivory"
                            }`}
                          >
                            {item.label}
                          </Link>
                        </li>
                      )}
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

/**
 * Below the desktop breakpoint the reading order folds into a disclosure under
 * the header. It is keyed on the pathname so it remounts closed on arrival
 * instead of staying open over the page the reader just chose.
 */
export function DocsMobileNavigation() {
  const current = usePathname();
  const item = navigationItem(current);

  return (
    <details
      key={current}
      className="docs-mobile-navigation sticky top-16 z-40 border-b border-hairline bg-deep/95 px-5 py-3 backdrop-blur-md lg:hidden"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 text-sm text-ivory">
        <span>
          <span className="mr-2 font-mono text-[10px] uppercase tracking-[0.16em] text-orange">
            Browse
          </span>
          {item?.label ?? navigationSection(current)}
        </span>
        <span aria-hidden="true" className="docs-mobile-chevron text-orange">
          ↓
        </span>
      </summary>
      <div className="max-h-[70vh] overflow-y-auto border-t border-hairline py-5">
        <NavigationLinks current={current} />
      </div>
    </details>
  );
}

/** The first grid column: sticky, and scrolled wherever the reader left it. */
export function DocsSidebar() {
  const current = usePathname();
  const item = navigationItem(current);

  return (
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
  );
}
