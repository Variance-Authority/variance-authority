---
'@variance-authority/help': minor
---

`ask search` weighs and shows a name through one of its rows

A word in a doc weighs at most two thirds of the same word in a name, however short the doc.

A name's weight is multiplied by how much of the question it writes, each word counted by its rarity, so a long doc that writes every word can sort before a short one that writes most of them.

A word's rarity is counted once per name, declaration and file found, a name writing it when any of its rows does, and the mean doc length over the doc of every row found, so no name's weight depends on the row another name is shown through.

A name published by more than one package or exported from more than one file is weighed and shown through one row, never several rows' docs added up: the row its words weigh most through, then the one whose doc writes more of the question's adjacent word pairs, then the first one the published or exported section would show.

A name stays in the described section only when the row it is weighed through writes at least half the question's words; a name whose rows write that many only together is listed in the loose section, when every word finds it there.

A name published anywhere is shown in the published section through a published row, whatever its exported rows write, and the described section weighs a name's rows before it asks whether they are published.

The published and exported sections settle a tie between one name's rows by the doc's text, then what a published row declares or the line an exported row is declared on, then the file, where they used to settle it by where the index wrote each row, which follows package and file names.

A published row has no line, so the file settles two published declarations of one kind under one doc.

The exported section used to show a name through its first row by kind, then the first one written, even when another of its rows was the one whose doc opens with the question and ranked it; it now shows that row.

With `from` or `to`, a name is counted, weighed, ordered and shown only through the rows of the area: a published row a file of the area imports, or an exported row of a file in the area.

The published `SearchIndex` type no longer declares `publishedFile`, the file id of a published row.
