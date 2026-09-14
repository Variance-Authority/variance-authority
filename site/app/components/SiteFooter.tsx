import Link from "next/link";
import {
  EXAMPLE_BUILD,
  GITHUB,
  MACHINE_GARDEN,
  MACHINE_GARDEN_GITHUB,
} from "../links";
import Mark from "./Mark";

/** Product anchors and documentation destinations shared across every route. */
const FOOTER = [
  {
    title: "on this page",
    links: [
      { href: "/#questions", label: "Start with a question" },
      { href: "/#visual-review", label: "Causal visual review" },
      { href: "/#selection", label: "Selection + reuse" },
      { href: "/#integrate", label: "Integrate" },
      { href: "/#fit", label: "Operating fit" },
    ],
  },
  {
    title: "project",
    links: [
      { href: "/docs", label: "Documentation" },
      { href: "/agents/questions", label: "Agent questions" },
      { href: "/reference/packages", label: "Package reference" },
      { href: "/reference/comparison", label: "Comparison" },
      { href: EXAMPLE_BUILD, label: "Example build" },
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
            Composable evidence tools that connect source, execution, rendered
            interfaces, public APIs, and decisions. Runs in your own
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
                  <Link
                    href={l.href}
                    className="text-quiet transition-colors hover:text-ivory"
                  >
                    {l.label}
                  </Link>
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
