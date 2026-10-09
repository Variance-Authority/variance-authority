---
'@variance-authority/tribunal': minor
---

Reviewers can flag a render as suspicious without deciding it

A subject page gains *Looks suspicious*, which raises a concern: a title, the
region or the whole render, evidence — the components, files or baseline you
point at — a note and a hypothesis. A concern moves from open to investigating
to resolved with a name on each step, stays on the subject across builds until
resolved, and survives the retention sweep. Approving never resolves a concern,
and resolving one approves nothing. The build header counts the concerns its
subjects carry.

The routes are `GET` and `POST /review/concerns` and `POST
/review/concerns/<id>`. Either token reads them, so a run or an agent holding
CI's token can learn that a subject is under suspicion; only the review token
raises or moves one. `/version` reports API 4 and schema 19; apply migration
`0017_concerns.sql` before deploying. `createConcernStore` and the concern types
are exported from `@variance-authority/tribunal/review`, and `Concerns`,
`ConcernTrail`, `ConcernTallyLine` and `useConcernTally` from
`@variance-authority/tribunal/ui`.
