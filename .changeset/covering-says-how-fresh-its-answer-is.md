---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

`variance covering` says how fresh and how actual its answer is for the question you asked

A partial run moves the record to its commit, and every test file it did not run keeps where it last ran, so one answer can name a test file that ran a minute ago over your text beside one that ran days ago over a text that was never committed. Every answer about a file, a line, a run of lines or a function now ends with where its line numbers stand in your text, then, for the test files it names, whether they ran over your text and when their runs landed, a group the record holds no time for first, then the oldest:

```
The recorded lines of src/pay.ts are placed in its text as it is now.
src/pay.test.ts ran over another text of src/pay.ts, in a run that landed 9 hours ago; `pay` is the same in both.
src/pay.ts is the text the other test file named here ran over, in a run that landed 6 minutes ago.
```

Your text is the `--text` buffer, else the file on disk, compared by digest with the text the runs record names for where each test file last ran, else the committed one there. For `--line` and `--function`, a test file that ran over another text is told whether the asked region is the same in both, or why that is not known. The time is when the runs there landed, first to latest; a commit's date is never used. A record written before runs kept their time or their texts says what it does not hold. `--since` says the same under its regions, and an answer that names no test file is dated by the test files that entered the file, else by every case it read.

The frame line replaces the `, placed in the text as it is now` the file answer's heading ended with, and `frame` is now on `--function` answers too: under `mapped` a part no case ran that an edit touched prints as `edited`, and under `stale` the answer names the function's cases and no parts. In JSON, `at` is the record's commit on every answer whose record names one, `ran` holds the groups the lines are read from (`commit`, `tests`, `landed`, `text`, `other`, `region`, `unknown`, `assumed`), `moved: true` marks a `--function` answer and each `unrun` part an edit touched, and `unheld: true` a file not on disk.

Landings now keep the texts their runs ran over where those were not committed, and `@variance-authority/sense/test-selection` exports `testPlaces`, where and when each test last ran and over which texts, `placeAcross`, which places a range of one text in another, `recordedDigests`, `shardsTexts`, and the `TestPlace`, `KeptTexts` and `ShardRuns` types.
