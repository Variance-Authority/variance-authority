import { defineConfig, type Plugin } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { cdnAdapter } from "@vinext/cloudflare/cache/cdn-adapter";
import { discoveryFiles, skillArchives, skillDirectory } from "./app/content/agent-skills";

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
 * `--mode unminified` builds the site the `site` check photographs: the
 * production build with its script unminified, so a change is attributed to
 * the client component that wrote it under its source name rather than a
 * minified `wo`. React stays on its production build, which is what the
 * deploy paints.
 */
function unminified(mode: string): Plugin[] {
  if (mode !== "unminified") return [];
  return [
    {
      name: "site:unminified-build",
      enforce: "post",
      // `cssMinify` follows `minify` unless it is set, and the stylesheet the
      // deploy serves is minified, so only the script is left as written.
      configEnvironment: () => ({ build: { minify: false, cssMinify: true } }),
    },
  ];
}

/**
 * The Agent Skills discovery files, written among the client's assets. An
 * installer refuses an archive whose digest does not match, and assets change in
 * one step with a deploy, so an index never meets an archive from another. The list
 * is `packages/cli/skills/`, so a skill added there is published with no edit
 * here. `vite dev` writes no bundle, so it serves none of them.
 */
function publishedSkills(): Plugin {
  return {
    name: "site:agent-skills",
    applyToEnvironment: (environment) => environment.name === "client",
    generateBundle() {
      const skills = skillArchives(skillDirectory(`${import.meta.dirname}/../packages/cli/skills`));
      for (const [path, source] of discoveryFiles(skills)) {
        this.emitFile({ type: "asset", fileName: `.well-known/agent-skills/${path}`, source });
      }
    },
  };
}

export default defineConfig(async ({ mode }) => ({
  plugins: [
    ...(await probes()),
    ...unminified(mode),
    publishedSkills(),
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
