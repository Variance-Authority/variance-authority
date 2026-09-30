---
"@variance-authority/cli": patch
---

`variance coverage --format markdown` answers a change no suite loads in one sentence: which files changed since the base was recorded, and that no suite loads them. It prints this when every suite has a base recorded at one commit, no suite's count changed, and none of the changed files is a module, a test file or a harness file a suite loads. Otherwise it prints the whole report. The line about the source index now uses whole sentences, and the harness column is named for the test harness. `variance review` no longer lists a test file under "Not compared" when the case index holds no case of it, such as a browser suite whose every case is skipped on a machine with no browser. The text format is unchanged.
