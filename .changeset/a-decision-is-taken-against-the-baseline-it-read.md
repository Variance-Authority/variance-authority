---
'@variance-authority/tribunal': minor
---

An approval is taken against the baseline it read, the way a merge reads code

Each subject on a build page now carries `baselineVersion`: the document digest
of the baseline an approval would replace, or `null` when there is none. A
baseline that moved after the page was read does not block by itself: when the
approvals that moved it changed regions none of this build's regions meets, the
approval goes through. It is refused with a 409, and nothing is recorded, only
when they meet, when a run's `/baseline/put` wrote what stands, or when there was
no baseline as the page was read. The answer names what you read, what is there
now and the build whose change met yours, as a sentence and as `read` and
`current` digests. The review pages send the version with every decision and, on
a 409, say "The baseline changed while you were reviewing" with both digests
shortened, and a button that reloads the subject or the change. A rejection, or a
decision without `baselineVersion`, is not checked.
