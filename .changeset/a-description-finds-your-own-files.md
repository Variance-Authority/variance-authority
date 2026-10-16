---
'@variance-authority/cli': patch
'@variance-authority/help': patch
'@variance-authority/sense': patch
---

A description finds this repository's own files, and a typo finds a name its file keeps to itself

`variance ask search --query 'loose reading'` did not answer
`packages/help/src/tools/loose.ts`, and `suite precision grain` did not answer
`packages/sense/src/test-selection/precision.ts`: what a file is for is said in
the doc it opens with, and no reading looked there. Now a file answers in the
`described` section by the words of its own name and that doc, as
`packages/help/src/tools/loose.ts [file] — @variance-authority/help — The loose
pass's membership, read off the published dictionary. [holds: loose, reading]`,
and `--format json` carries it with `source: 'file'`. The doc a file opens with
is the first `/**` comment ending before its first statement that is not an
import, unless it documents that statement.

Between two rows that hold as many of the words, the one whose doc writes more
of the question's adjacent word pairs adjacent now comes first, before the
words in the name; the pairs are of the words the question is about, not of
`it is` or `of a`. The words every package says about itself — `package`,
`module`, `use`, `tool`, `library`, `get`, `set` and the like — are words again
when your own code is asked, while staying stopwords for an installed package.
`what`, `where`, `who`, `whom`, `whose`, `why`, `does`, `did`, `was`, `were`,
`been`, `there`, `their`, `them`, `they`, `then`, `than`, `but`, `about` and
`each` are now stopwords for both, since they say how a question is put.

The loose reading — words apart, or one character off — now reaches a name its
file declares and does not export, after every exported one.

`@variance-authority/sense` exports `declaredTermsOf`, `declaredLooseOf` and
`nearOfNative`, and `declaredDescribedOf` takes the query and answers with
`files`. The source index format moves to version 24; an older index is
rebuilt.
