import { GITHUB } from "../links";
import Mark from "./Mark";

/** Sticky, on its own translucent ground so the page runs under it. */
export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-hairline/70 bg-deep/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <a href="#" className="flex items-center gap-3">
          <Mark />
          <span className="text-sm font-medium tracking-[0.22em] text-ivory">
            VARIANCE&nbsp;AUTHORITY
          </span>
        </a>
        <nav className="flex items-center gap-6 text-sm text-quiet">
          <a
            href="#react"
            className="hidden transition-colors hover:text-ivory sm:inline"
          >
            React
          </a>
          <a
            href="#variations"
            className="hidden transition-colors hover:text-ivory sm:inline"
          >
            Variants
          </a>
          <a
            href="#run"
            className="hidden transition-colors hover:text-ivory sm:inline"
          >
            Performance
          </a>
          <a
            href="#agents"
            className="hidden transition-colors hover:text-ivory sm:inline"
          >
            Agents
          </a>
          <a
            href="#packages"
            className="hidden transition-colors hover:text-ivory lg:inline"
          >
            Packages
          </a>
          <a
            href="#integrate"
            className="hidden transition-colors hover:text-ivory sm:inline"
          >
            Integrate
          </a>
          <a
            href={`${GITHUB}/tree/main/docs`}
            className="hidden transition-colors hover:text-ivory sm:inline"
          >
            Docs
          </a>
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
