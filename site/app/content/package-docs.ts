import cli from "../../../packages/cli/README.md?raw";
import core from "../../../packages/core/README.md?raw";
import dom from "../../../packages/dom/README.md?raw";
import event from "../../../packages/event/README.md?raw";
import eyes from "../../../packages/eyes/README.md?raw";
import help from "../../../packages/help/README.md?raw";
import history from "../../../packages/history/README.md?raw";
import jsxSource from "../../../packages/jsx-source/README.md?raw";
import mcp from "../../../packages/mcp/README.md?raw";
import observe from "../../../packages/observe/README.md?raw";
import packageSurface from "../../../packages/package/README.md?raw";
import playwrightTest from "../../../packages/playwright-test/README.md?raw";
import playwright from "../../../packages/playwright/README.md?raw";
import pngSharp from "../../../packages/png-sharp/README.md?raw";
import png from "../../../packages/png/README.md?raw";
import presentation from "../../../packages/presentation/README.md?raw";
import raster from "../../../packages/raster/README.md?raw";
import react from "../../../packages/react/README.md?raw";
import remote from "../../../packages/remote/README.md?raw";
import report from "../../../packages/report/README.md?raw";
import routeCollector from "../../../packages/route-collector/README.md?raw";
import scenario from "../../../packages/scenario/README.md?raw";
import sense from "../../../packages/sense/README.md?raw";
import server from "../../../packages/server/README.md?raw";
import session from "../../../packages/session/README.md?raw";
import store from "../../../packages/store/README.md?raw";
import storybookCollector from "../../../packages/storybook-collector/README.md?raw";
import storybook from "../../../packages/storybook/README.md?raw";
import tribunal from "../../../packages/tribunal/README.md?raw";
import unitTest from "../../../packages/unit-test/README.md?raw";
import vantage from "../../../packages/vantage/README.md?raw";
import wire from "../../../packages/wire/README.md?raw";

export interface PackageDocument {
  readonly name: string;
  readonly source: string;
  readonly sourcePath: string;
}

const packages = [
  ["cli", cli],
  ["core", core],
  ["dom", dom],
  ["event", event],
  ["eyes", eyes],
  ["help", help],
  ["history", history],
  ["jsx-source", jsxSource],
  ["mcp", mcp],
  ["observe", observe],
  ["package", packageSurface],
  ["playwright", playwright],
  ["playwright-test", playwrightTest],
  ["png", png],
  ["png-sharp", pngSharp],
  ["presentation", presentation],
  ["raster", raster],
  ["react", react],
  ["remote", remote],
  ["report", report],
  ["route-collector", routeCollector],
  ["scenario", scenario],
  ["sense", sense],
  ["server", server],
  ["session", session],
  ["store", store],
  ["storybook", storybook],
  ["storybook-collector", storybookCollector],
  ["tribunal", tribunal],
  ["unit-test", unitTest],
  ["vantage", vantage],
  ["wire", wire],
] as const;

export const PACKAGE_DOCUMENTS: readonly PackageDocument[] = packages.map(
  ([name, source]) => ({
    name,
    source,
    sourcePath: `packages/${name}/README.md`,
  }),
);

export function packageDocument(name: string): PackageDocument | undefined {
  return PACKAGE_DOCUMENTS.find((document) => document.name === name);
}
