import {
  DOCS,
  DOCS_INDEX,
  GITHUB,
  MACHINE_GARDEN,
  MACHINE_GARDEN_GITHUB,
} from "../links";
import Mark from "./Mark";

/** Only destinations that exist: page anchors, and files under docs/. */
const FOOTER = [
  {
    title: "on this page",
    links: [
      { href: "#evidence", label: "Evidence slices" },
      { href: "#react", label: "React trail" },
      { href: "#review", label: "Grouped review" },
      { href: "#intent", label: "Agent intent" },
      { href: "#selection", label: "Selection + reuse" },
      { href: "#fit", label: "Operating fit" },
      { href: "#integrate", label: "Integrate" },
    ],
  },
  {
    title: "project",
    links: [
      { href: DOCS_INDEX, label: "Documentation" },
      { href: `${DOCS}/architecture.md`, label: "Architecture" },
      { href: `${DOCS}/attribution.md`, label: "Attribution" },
      { href: `${DOCS}/comparison.md`, label: "Comparison" },
      { href: GITHUB, label: "GitHub" },
    ],
  },
];

export default function SiteFooter() {
  return (
    <footer className="border-t border-hairline py-12">
      <div className="mx-auto max-w-6xl px-6">
      <div className="grid gap-10 sm:grid-cols-[1.4fr_1fr_1fr] [&>*]:min-w-0">
        <div>
          <div className="flex items-center gap-3">
            <Mark size={24} />
            <span className="text-sm font-medium tracking-[0.22em] text-ivory">
              VARIANCE&nbsp;AUTHORITY
            </span>
          </div>
          <p className="mt-4 max-w-xs text-sm leading-6 text-quiet">
            Visual review that names the cause, across pixel, document,
            accessibility, React, and source evidence. Runs in your own
            infrastructure.
          </p>
        </div>
        {FOOTER.map((col) => (
          <div key={col.title}>
            <p className="font-mono text-[11px] tracking-[0.2em] text-warm uppercase">
              {col.title}
            </p>
            <ul className="mt-4 space-y-2.5 text-sm">
              {col.links.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    className="text-quiet transition-colors hover:text-ivory"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-12 border-t border-hairline pt-6 font-mono text-xs text-warm">
        MIT · Copyright © 2026{" "}
        <a className="transition-colors hover:text-ivory" href={MACHINE_GARDEN}>
          Machine Garden
        </a>{" "}
        ·{" "}
        <a
          className="transition-colors hover:text-ivory"
          href={MACHINE_GARDEN_GITHUB}
        >
          GitHub
        </a>
      </p>
      </div>
    </footer>
  );
}
