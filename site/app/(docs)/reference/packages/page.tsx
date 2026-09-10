import DocsPage from "../../../components/DocsPage";
import Packages from "../../../components/Packages";
import { pageMetadata } from "../../../metadata";

const TITLE = "Package map";
const DESCRIPTION =
  "Find the smallest public surface that matches what you already have and what your process can supply.";

export const metadata = pageMetadata(
  "/reference/packages",
  TITLE,
  DESCRIPTION,
);

export default function Page() {
  return (
    <DocsPage
      current="/reference/packages"
      eyebrow="Reference"
      title={TITLE}
      description={DESCRIPTION}
      toc={[{ id: "packages", label: "Packages by responsibility" }]}
    >
      <Packages />
    </DocsPage>
  );
}
