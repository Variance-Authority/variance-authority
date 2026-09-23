# Search read the whole value to print fifteen rows

**Date:** 2026-09-23

`variance ask search` was already called fast, and on a small checkout it was.
On a 300,000-file monorepo the same command took 1.2 s to 2.4 s. The answer
was 71 ms of that. Most of the rest was `JSON.parse` over a 258 MB snapshot of
the whole Help value, about 836 ms, spent to print at most fifteen rows. The
remainder was a CLI that imported Playwright on startup for a question that
opens no browser.

## What the question needs

Search matches a word against names and docs, ranks by two counts, and prints
a few rows. It needs a lowercase text column to scan, the rank columns, and the
rows it prints decoded. The value holds much more than that: every opening,
every entry, every import site, every exported name with its line and kind. It
also has to be parsed whole before a single name is compared.

So the producer now publishes a second file beside the value,
`${index}.help-search.bin`. It carries the same generation: root, graph root,
graph digest and time. It holds:

- a string pool;
- NUL-joined lowercase blobs, searched with `Buffer.indexOf`;
- integer rank columns, read for a top-k;
- a sorted term dictionary for the loose pass;
- file ids, so an area check compares integers.

A question opens it and decodes only the rows it prints. The import graph is
read only when `--from` or `--to` asks for it, and it is read from the tree file
the value already published.

## The loose pass had to be exact, not close

The loose pass built a MiniSearch index per question: every held name, with its
docs, tokenized and indexed so it could answer one query. Only membership was
ever read from it, because the tool orders what it returns by its own rules. The
replacement reads the same membership off the published dictionary. It uses
MiniSearch's tokenizer, drops terms shorter than two, lowercases the rest, and
matches each query term by prefix and by Levenshtein distance within
`round(0.2 × length)`, capped at six. Every term must land.

Walking the edit distance over a sorted array shares matrix rows between
neighbours. A prefix already over budget skips every term under it with one
binary search. That is the walk a trie makes, and it needs no trie.
`loose.test.ts` holds it to MiniSearch on 195 queries: the fixture's terms
whole, cut, dropped, swapped and doubled, plus non-ASCII names and a surrogate
pair.

## Equal output was the only acceptance

A differential ran the old tool and the new one over the same Help, on three
corpora: this repository, Material UI and seven Material UIs side by side. On
this repository that was 555 queries, 264 of them loose, with 0 differing
bytes. The whole-value search took 9,994 ms over those 555 and the index took
715 ms.

One more cost turned up in the area check. `entryPoints` split every path of the
tree into segments to compare against the start point: 70 ms on 198,000 files.
Rejecting on a string prefix first brings it to 9 ms, and the segment compare
still decides every path the prefix admits.

## What it cost

| Repository | tracked paths | `git grep` | `rg` | `ask search`, whole command | the answer, in process |
| --- | --- | --- | --- | --- | --- |
| this one | 2,535 | 41–46 ms | 46 ms | 104–115 ms | 1.6–7.1 ms |
| Material UI | 41,171 | 1.25–1.28 s | 0.92–1.02 s | 100–102 ms | 1.5–5.3 ms |
| seven Material UIs | 288,197 | 9.7–11.4 s | 7.9–8.7 s | 101–104 ms | 3.3–6.1 ms |

The whole command is now flat at about 100 ms from 2,500 files to 290,000.
Nearly all of it is Node starting and the CLI importing itself. Before the
Playwright import moved behind the renderer probe, startup alone was 190 ms.
With a path, `--from` costs 228 ms and `--to` 263 ms on the largest corpus,
because they load the graph and walk it. Producing that corpus's generation into
an empty index took 6.7 s, which is less than one `rg`.

`grep -r` was measured too and dropped: 56 s a run on the largest corpus. It is
not a comparison anybody makes.

## What it taught

The 71 ms was never the cost, and it was the only number anybody had looked at.
The answer was sitting in a file already published beside the value: the
generation, the tree, the counts. Reading the value was a way to reach them.
Once the question says what it needs, the value is what the other tools read.
