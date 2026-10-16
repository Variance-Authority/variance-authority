---
'@variance-authority/cli': patch
---

A refusal reads the checkout as it is

`variance ask` reused a published source generation for an hour and built the
dependency lexicon only under `variance index`, so a function written since the
last index was refused as not published, and a fresh checkout refused an
installed package's export with *the dependency lexicon is not published*. Both
read as real absences. A refused question is now asked again of a generation
made from the checkout now, with the dependency lexicon brought up to date, and
only that answer is given; an answer that found its name still comes from the
reused generation, so only a refusal pays for the reading. Under
`--just-answer`, and on every `search`, which reads the published generation at
any age, the snapshot line under an answer or a refusal says the checkout was
not compared with it.
