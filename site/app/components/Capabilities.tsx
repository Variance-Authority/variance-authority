/**
 * What a reader can do with it, in the hero's first column so it shows above
 * the fold. Each opens the page that starts that task.
 */
const CAPABILITIES = [
  { name: "Coverage", href: "/docs/test-level-coverage" },
  { name: "Code search", href: "/docs/locate" },
  { name: "VR", href: "/docs/path-visual-review" },
  { name: "Debugging", href: "/docs/path-test-failure" },
  { name: "Review signals", href: "/docs/path-code-review" },
  { name: "Cost", href: "/docs/path-faster-ci" },
] as const;

export default function Capabilities() {
  return (
    <nav
      aria-label="Capabilities"
      className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs tracking-widest text-quiet uppercase"
    >
      {CAPABILITIES.map((capability, index) => (
        <span key={capability.name} className="flex items-center gap-x-3">
          {index > 0 && <span aria-hidden="true" className="text-hairline">·</span>}
          <a
            href={capability.href}
            className="rounded-sm transition-colors hover:text-orange focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange"
          >
            {capability.name}
          </a>
        </span>
      ))}
    </nav>
  );
}
