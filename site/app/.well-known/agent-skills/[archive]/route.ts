import { AGENT_SKILLS } from "../../../content/agent-skills";

export const revalidate = 3600;

/** One skill's archive, the bytes the discovery index digests. */
export async function GET(_request: Request, { params }: { params: Promise<{ archive: string }> }): Promise<Response> {
  const { archive } = await params;
  const skill = AGENT_SKILLS.find(({ archiveName }) => archiveName === archive);
  if (skill === undefined) return new Response("Not found\n", { status: 404 });

  return new Response(skill.archive, {
    headers: {
      "access-control-allow-origin": "*",
      "content-type": "application/zip",
    },
  });
}
