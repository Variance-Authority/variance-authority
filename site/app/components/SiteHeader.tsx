import Link from "next/link";
import { GITHUB } from "../links";
import Mark from "./Mark";
import SiteSearch from "./SiteSearch";

/**
 * The landing sections, in page order. Four of them survive to a phone-width
 * header; the rest arrive when there is room for them.
 */
const SECTIONS = [
  { href: "/#questions", label: "Questions", wide: false },
  { href: "/#visual-review", label: "Visual review", wide: false },
  { href: "/#selection", label: "Selection", wide: true },
  { href: "/#integrate", label: "Integrate", wide: true },
  { href: "/#fit", label: "Fit", wide: true },
  { href: "/docs", label: "Docs", wide: false },
] as const;

/** Sticky, on its own translucent ground so the page runs under it. */
export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-hairline/70 bg-deep/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 sm:gap-3">
          <Mark />
          {/* The wordmark tightens rather than disappears: a phone-width header
              carries the name, the search control and the repository at once. */}
          <span className="text-xs font-medium tracking-[0.1em] text-ivory sm:text-sm sm:tracking-[0.22em]">
            VARIANCE&nbsp;AUTHORITY
          </span>
        </Link>
        <nav className="flex items-center gap-2.5 text-sm text-quiet sm:gap-6">
          {SECTIONS.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className={`transition-colors hover:text-ivory ${
                section.wide ? "hidden lg:inline" : "hidden sm:inline"
              }`}
            >
              {section.label}
            </Link>
          ))}
          <SiteSearch />
          <a
            href={GITHUB}
            className="rounded-lg border border-hairline px-2.5 py-1.5 text-ivory transition-colors hover:border-orange/60 sm:px-3"
          >
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}
