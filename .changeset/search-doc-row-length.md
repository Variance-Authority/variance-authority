---
'@variance-authority/help': patch
---

`ask search` weighs a word a short doc holds below a word a name holds, as it says, rather than up to a name word's weight, so test constants with one-line docs no longer sort above a name whose doc says what was asked. A row's weight is also multiplied by how much of the question it holds, each word by its rarity, so a long doc holding most of the question sorts in the first rows rather than below short names holding two of its words. A name published by more than one package, or published and also exported, is weighed by the row whose doc holds the most of the question, with that doc's length, and shown with that row; when two rows hold the same words the shorter doc wins, and at an equal length a published row.
