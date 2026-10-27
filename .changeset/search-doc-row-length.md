---
'@variance-authority/help': patch
---

`ask search` weighs a word a short doc holds below a word a name holds, as it says, rather than up to a name word's weight, so test constants with one-line docs no longer sort above a name whose doc says what was asked. A name published by more than one package, or published and also exported, is weighed by the row whose doc holds the words, with that doc's length, and shown with that row; at a tie a published row wins.
