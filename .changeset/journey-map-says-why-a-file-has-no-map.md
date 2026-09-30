---
"@variance-authority/sense": patch
"@variance-authority/help": patch
---

`variance ask journey-map` says why a file has no map

When the recording lists nothing for the file you asked about, the answer says why.

- A test file is named as a test file, with the three modules its recorded tests ran most. Each module shows how many of the file's tests ran it and how many of all recorded tests did.
- A path that git does not list in the checkout and the recording does not hold is refused as not in the checkout, with the nearest recorded path suggested, as `ask slowest-tests` already does. Both commands now accept a new file that git lists as untracked and not ignored, which `ask slowest-tests` used to refuse.
- A file that did not exist at the commit the recording was made at is named as new since the recording.
- For any other file, the answer says no recorded test loaded it only when git lists it at that commit, the test run instruments files of its kind, and the recording lists other files in its directory. Even then it names the one case the recording cannot rule out: a module the test run leaves uninstrumented. Otherwise the answer says the recording cannot tell, and why.
