"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  DOCUMENTATION_ENTRY_POINTS,
  navigationContext,
  navigationItem,
  navigationSection,
} from "../navigation";

/** Direct entry routes followed by the question being read, on both surfaces. */
function NavigationLinks({ current }: { readonly current: string }) {
  const context = navigationContext(current);
  const active = (href: string) =>
    href === current ||
    (href === "/reference/packages" && current.startsWith("/reference/packages/"));

  const links = (items: readonly { href: string; label: string }[]) => (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            aria-current={active(item.href) ? "page" : undefined}
            className={`block rounded-md border-l-2 px-3 py-2 text-sm leading-5 transition-colors ${
              active(item.href)
                ? "border-orange bg-orange/[0.07] font-medium text-ivory"
                : "border-transparent text-quiet hover:border-hairline hover:bg-panel/70 hover:text-ivory"
            }`}
          >
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <nav aria-label="Documentation">
      {links(DOCUMENTATION_ENTRY_POINTS)}
      {context ? (
        <div className="mt-6 border-t border-hairline pt-5">
          <p className="mb-2 px-3 text-xs font-medium leading-5 text-quiet">
            {context.label}
          </p>
          {links(context.items.filter((item) =>
            !DOCUMENTATION_ENTRY_POINTS.some((entry) => entry.href === item.href),
          ))}
        </div>
      ) : null}
    </nav>
  );
}

/** Navigation closes on arrival, so it does not cover the chosen page. */
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
        <span aria-hidden="true" className="docs-mobile-chevron text-orange">↓</span>
      </summary>
      <div className="max-h-[70vh] overflow-y-auto border-t border-hairline py-5">
        <NavigationLinks current={current} />
      </div>
    </details>
  );
}

/** Nearby pages stay visible while the article owns the scroll. */
export function DocsSidebar() {
  return (
    <aside className="docs-sidebar hidden lg:block">
      <NavigationLinks current={usePathname()} />
    </aside>
  );
}
