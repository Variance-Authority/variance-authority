import { GITHUB } from "../links";
import Mark from "./Mark";

const PRIMARY = [
  { href: "/", label: "Product" },
  { href: "/start", label: "Get started" },
  { href: "/docs", label: "Docs" },
  { href: "/agents", label: "Agents" },
  { href: "/reference/packages", label: "Reference" },
] as const;

function sectionIsActive(current: string | undefined, href: string): boolean {
  if (!current) return false;
  return (
    current === href ||
    (href === "/docs" && current.startsWith("/docs/")) ||
    (href === "/agents" && current.startsWith("/agents/")) ||
    (href === "/start" && current.startsWith("/start/")) ||
    (href === "/reference/packages" && current.startsWith("/reference/"))
  );
}

export default function DocsHeader({ current }: { current?: string }) {
  return (
    <header className="sticky top-0 z-50 border-b border-hairline/70 bg-deep/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-[94rem] items-center justify-between gap-5 px-5 py-3 sm:px-6">
        <a href="/" className="flex min-w-0 items-center gap-3">
          <Mark />
          <span className="hidden text-sm font-medium tracking-[0.22em] text-ivory sm:inline">
            VARIANCE&nbsp;AUTHORITY
          </span>
        </a>
        <nav
          aria-label="Primary"
          className="flex items-center gap-2 text-sm text-quiet sm:gap-4"
        >
          {PRIMARY.map((item) => {
            const active = sectionIsActive(current, item.href);
            return (
              <a
                key={item.href}
                href={item.href}
                aria-current={current === item.href ? "page" : undefined}
                className={`hidden rounded-md px-1.5 py-2 transition-colors hover:text-ivory md:inline ${
                  active ? "text-ivory" : ""
                }`}
              >
                {item.label}
              </a>
            );
          })}
          <a
            href="/docs"
            className="rounded-md px-2 py-2 text-quiet transition-colors hover:text-ivory md:hidden"
          >
            Docs
          </a>
          <a
            href={GITHUB}
            className="rounded-lg border border-hairline px-3 py-2 text-ivory transition-colors hover:border-orange/60"
          >
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}
