import {
  GITHUB,
  MACHINE_GARDEN,
  MACHINE_GARDEN_GITHUB,
} from "../links";
import { ROOT_DESCRIPTION } from "../metadata";
import Mark from "./Mark";

/** A compact route out after a page; the complete reading order stays in the shell. */
const FOOTER = [
  {
    title: "learn",
    links: [
      { href: "/start", label: "Get started" },
      { href: "/docs/surface", label: "Choose what to observe" },
      { href: "/docs/attribution", label: "Trace a pixel to source" },
      { href: "/docs/flakiness", label: "Classify flakes" },
      { href: "/docs/selecting", label: "Select tests" },
    ],
  },
  {
    title: "project",
    links: [
      { href: "/", label: "Overview" },
      { href: "/agents", label: "Agent workflows" },
      { href: "/docs/architecture", label: "Architecture" },
      { href: "/reference/packages", label: "Package reference" },
      { href: "/reference/comparison", label: "Product comparison" },
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
              {ROOT_DESCRIPTION}
            </p>
          </div>
          {FOOTER.map((col) => (
            <div key={col.title}>
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-quiet">
                {col.title}
              </p>
              <ul className="mt-4 space-y-2.5 text-sm">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      className="text-quiet transition-colors hover:text-ivory"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-12 border-t border-hairline pt-6 font-mono text-xs text-quiet">
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
