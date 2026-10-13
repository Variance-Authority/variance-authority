import Link from "next/link";
import { documentDescription, headingId } from "../content/markdown-text";
import { routedDocument } from "../content/routed-docs";
import type { DocumentationIndex as Index } from "../navigation";
import DocsPage from "./DocsPage";

/** An index routes to existing documents using catalogue captions or their openings. */
export default function DocumentationIndex({ index }: { readonly index: Index }) {
  return (
    <DocsPage
      contentKind="index"
      current={index.href}
      title={index.label}
      description={index.description}
      eyebrow="Documentation"
      toc={index.sections.map(({ label }) => ({ id: headingId(label), label }))}
    >
      <div className="space-y-12">
        {index.sections.map((section) => (
          <section key={section.label} aria-labelledby={headingId(section.label)}>
            <h2 id={headingId(section.label)} className="mb-5 text-xl font-semibold text-ivory">
              {section.label}
            </h2>
            <ul className="divide-y divide-hairline">
              {section.items.map((item) => {
                const document = routedDocument(item.href);
                const description = item.description ??
                  (document ? documentDescription(document.source) : undefined);
                return (
                  <li key={item.href}>
                    <Link href={item.href} className="group block py-4">
                      <span className="text-base font-medium text-ivory transition-colors group-hover:text-orange">
                        {item.label}
                      </span>
                      {description ? (
                        <p className="mt-1 line-clamp-3 text-sm leading-6 text-quiet">
                          {description}
                        </p>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </DocsPage>
  );
}
