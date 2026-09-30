---
"@variance-authority/sense": patch
---

`variance ask journey-map` says why a file has no map

When the recording has no module row for the file you asked about, the answer tells you what to ask next. A test file is named as a test file, with the three modules its recorded tests ran most, each with how many of its tests and how many of all recorded tests ran it. For any other file, the answer depends on its directory. If the recording lists other files under that directory, the answer says that no recorded test ran the file, and that this is a finding about the tests, not a gap in the recording. If the recording lists no file under that directory, the answer says the recording cannot tell whether a test ran it.
