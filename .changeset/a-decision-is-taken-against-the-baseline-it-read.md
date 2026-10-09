---
'@variance-authority/tribunal': minor
---

A decision is taken against the baseline it read

Each subject on a build page now carries `baselineVersion`: the document digest
of the baseline an approval would replace, or `null` when there is none. A
decision that sends it back is refused with a 409 when another build's approval
or a run's `/baseline/put` replaced that baseline after the page was read; the answer
names what you read and what is there now, and nothing is recorded. The review
pages send the version with every decision and, on a 409, show "The baseline
changed while you were reviewing"; the subject panel adds a button that reloads
the subject. A decision without `baselineVersion` is not checked.
