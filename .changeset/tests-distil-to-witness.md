---
'@variance-authority/distill': minor
'@variance-authority/cli': minor
'@variance-authority/mcp': minor
---

Distil one test to the behavior it witnesses.

`@variance-authority/distill` combines an Eyes attention journal and a Sense
execution index by exact test identity. It keeps authored Arrange, Act and
Assert attention, React update initiators, and whole-test source entry separate,
then names entered files without addressed source attribution as opportunities
for a counterfactual check rather than safe mocks.

`variance distill` reads the portable files from a shell and can emit text or
JSON. A combined MCP connection exposes the same analyzer as
`variance_distill`; the former `variance_testing_surface` name is replaced.
