import Link from "next/link";
import { GITHUB } from "../links";
import Mark from "./Mark";

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
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-3">
          <Mark />
          <span className="text-sm font-medium tracking-[0.22em] text-ivory">
            VARIANCE&nbsp;AUTHORITY
          </span>
        </Link>
        <nav className="flex items-center gap-6 text-sm text-quiet">
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
          <a
            href={GITHUB}
            className="rounded-lg border border-hairline px-3 py-1.5 text-ivory transition-colors hover:border-orange/60"
          >
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}
