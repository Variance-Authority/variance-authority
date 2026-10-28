import Link from "next/link";
import { documentDescription, headingId } from "../content/markdown-text";
import { routedDocument } from "../content/routed-docs";
import { reads } from "../content/reads";
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
                // A caption the catalogue holds is the index's own; one read
                // from the document's opening is a file this page showed.
                const opening = item.description === undefined ? document : undefined;
                const description = item.description ??
                  (opening ? documentDescription(opening.source) : undefined);
                return (
                  <li key={item.href}>
                    <Link href={item.href} className="group block py-4">
                      <span className="text-base font-medium text-ivory transition-colors group-hover:text-orange">
                        {item.label}
                      </span>
                      {description ? (
                        <p
                          className="mt-1 line-clamp-3 text-sm leading-6 text-quiet"
                          {...reads(opening?.sourcePath)}
                        >
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
