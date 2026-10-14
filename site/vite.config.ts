import { defineConfig, type Plugin } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { cdnAdapter } from "@vinext/cloudflare/cache/cdn-adapter";

/**
 * `VARIANCE_AUTHORITY_PROBES` builds the site a recorded run photographs: every
 * page rendered per request, by a Worker that says which journey ran what.
 * Prerendering and every page cache are off there, since a page served from
 * any of them runs none of the code that made it.
 */
const recorded = process.env.VARIANCE_AUTHORITY_PROBES !== undefined;

async function probes(): Promise<Plugin[]> {
  if (!recorded) return [];
  const { testSelectionProbes } = await import("@variance-authority/sense/journal");
  const root = import.meta.dirname;
  // The site's own source only. The packages it is recorded with resolve into
  // this checkout's `packages/`, and their maps name source there too.
  const app = `${root}/app/`;
  const include = (file: string) => file.startsWith(app) && /\.[cm]?[jt]sx?$/.test(file);
  const server = testSelectionProbes({ root, include, label: "site", journeys: true });
  const page = testSelectionProbes({ root, include });
  return [
    { ...server, applyToEnvironment: (environment) => environment.config.consumer === "server" },
    { ...page, applyToEnvironment: (environment) => environment.config.consumer !== "server" },
  ];
}

export default defineConfig({
  plugins: [
    ...(await probes()),
    vinext(
      recorded
        ? { cache: { data: { adapter: `${import.meta.dirname}/variance/no-cache.ts`, options: {} } } }
        : { cache: { cdn: cdnAdapter() }, prerender: { routes: "*" } },
    ),
    cloudflare({
      ...(recorded ? { configPath: "./variance/wrangler.jsonc" } : {}),
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
