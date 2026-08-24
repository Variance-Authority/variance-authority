import { DOCS, GITHUB } from "../links";
import Mark from "./Mark";

/** Only destinations that exist: page anchors, and files under docs/. */
const FOOTER = [
  {
    title: "on this page",
    links: [
      { href: "#react", label: "React attribution" },
      { href: "#variations", label: "A/B + variants" },
      { href: "#run", label: "Performance" },
      { href: "#runtime", label: "Runtime evidence" },
      { href: "#report", label: "The report" },
      { href: "#agents", label: "Agentic review" },
      { href: "#integrate", label: "Integrate" },
    ],
  },
  {
    title: "project",
    links: [
      { href: DOCS, label: "Documentation" },
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
      <div className="grid gap-10 sm:grid-cols-[1.4fr_1fr_1fr] [&>*]:min-w-0">
        <div>
          <div className="flex items-center gap-3">
            <Mark size={24} />
            <span className="text-sm font-medium tracking-[0.22em] text-ivory">
              VARIANCE&nbsp;AUTHORITY
            </span>
          </div>
          <p className="mt-4 max-w-xs text-sm leading-6 text-quiet">
            Visual Regression and Verifiable Results, with React attribution,
            variant-aware reports, and infrastructure you control.
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
        MIT · Copyright © 2026 Mechanic Garden
      </p>
    </footer>
  );
}
