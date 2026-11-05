import { AGENT_SKILLS } from "../../../content/agent-skills";

export const revalidate = 3600;

/**
 * The Agent Skills discovery index: what `npx skills add` reads from a site's
 * address. Each `url` is relative to this document, so the index holds wherever
 * the site is served from. An installer drops a skill whose digest does not
 * match, so this and an archive must come from one deploy: the cache key holds
 * the Worker version as long as `cross_version_cache` stays unset.
 */
export function GET(): Response {
  const index = {
    $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills: AGENT_SKILLS.map(({ name, description, archiveName, digest }) => ({
      name,
      type: "archive",
      description,
      url: archiveName,
      digest,
    })),
  };

  return new Response(`${JSON.stringify(index, null, 2)}\n`, {
    headers: {
      "access-control-allow-origin": "*",
      "content-type": "application/json",
    },
  });
}
