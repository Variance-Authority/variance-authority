---
'@variance-authority/help': patch
---

`ask search` (and the `docs_search` MCP tool) no longer drops the repository's own wording when a question of two words or more is matched somewhere as written. At most five near matches now follow the direct answer: names and files that hold most of the question's words, the rarer words counting for more, each labelled with the words it holds and leaving out what the answer already shows. When nothing matches as written, the near matches lead, as before. Their heading now opens with `Near matches, not exact:`. A one-word question that is answered gets no near matches, and the loose section still appears only on an empty answer. For example, `code layers` on this repository used to print one weak export and two test titles, then installed packages that hold only `code`. It now also lists `PackageLayer`, `packageLayers` and `LayerMoves`.
