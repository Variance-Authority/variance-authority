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

/**
 * `--mode development` builds the site the `site` check photographs: React's
 * development build in every environment, nothing minified, so a change is
 * attributed to the component that wrote it under its source name. Under a
 * production React build a server component leaves no name on the page at
 * all, and the minifier renames every client component (`wo`).
 *
 * vinext sets `NODE_ENV` to `production` on every build, and the Cloudflare
 * plugin then defines it for the worker from that, so it is defined last, per
 * environment, rather than set in the shell. Only `NODE_ENV` moves: Vite's
 * `import.meta.env.DEV` and `PROD` still read production, and
 * nothing the site paints branches on them.
 */
function development(mode: string): Plugin[] {
  if (mode !== "development") return [];
  const env = JSON.stringify("development");
  return [
    {
      name: "site:development-build",
      enforce: "post",
      configEnvironment: () => ({
        define: {
          "process.env.NODE_ENV": env,
          "global.process.env.NODE_ENV": env,
          "globalThis.process.env.NODE_ENV": env,
        },
        build: { minify: false },
      }),
    },
  ];
}

export default defineConfig(async ({ mode }) => ({
  plugins: [
    ...(await probes()),
    ...development(mode),
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
}));
