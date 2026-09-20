import DocsPage from "../../../components/DocsPage";
import Packages from "../../../components/Packages";
import { pageMetadata } from "../../../metadata";

export const revalidate = 3600;

const TITLE = "Package map";
const DESCRIPTION =
  "Every published package, and the install command for the three most common starting points: a Playwright suite, a Storybook, and a suite you want to run less of.";

export const metadata = pageMetadata("/reference/packages", TITLE, DESCRIPTION);

export default function Page() {
  return (
    <DocsPage
      current="/reference/packages"
      eyebrow="Reference"
      title={TITLE}
      description={DESCRIPTION}
      toc={[
        { id: "packages", label: "Start from what you already have" },
        { id: "responsibility", label: "Choose by responsibility" },
      ]}
    >
      <Packages />
    </DocsPage>
  );
}
