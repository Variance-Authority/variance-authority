import DocumentationIndex from "../../../components/DocumentationIndex";
import { pageMetadata } from "../../../metadata";
import { documentationIndex } from "../../../navigation";

export const revalidate = 3600;

const index = documentationIndex("/docs/all")!;
export const metadata = pageMetadata(index.href, index.label, index.description);

export default function Page() {
  return (
    <DocumentationIndex
      index={index}
      exclude="the list of every page: it grows with the docs and repeats their openings, reviewed as text"
    />
  );
}
