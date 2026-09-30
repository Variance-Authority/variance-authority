---
"@variance-authority/sense": patch
"@variance-authority/help": patch
---

`variance ask journey-map` says why a file has no map

When the recording lists nothing for the file you asked about, the answer says why.

- A test file is named as a test file, with the three modules its recorded tests ran most. Each module shows how many of the file's tests ran it and how many of all recorded tests did.
- A directory is named as a directory: the map is drawn around one file, so the answer asks for one of the files in it.
- A path that git does not list in the checkout and the recording does not hold is refused as not in the checkout. The refusal names the recorded path one typo away, as `ask slowest-tests` already does, or else the recorded files with the same name in other directories. A file on disk that git ignores is named as ignored instead.
- A file that existed at the commit the recording was made at and is gone from the checkout is named as deleted since, from the CLI and from `journeyMap` alike.
- A file that did not exist at that commit is named as new since the recording.
- For any other file, the answer says no recorded test loaded it only when git lists it at that commit, the test run instruments files of its kind, and the recording lists other files in the same directory. Files in the directories below do not count, and a file at the repository root is judged by the files at the root. Even then the answer names the one case the recording cannot rule out: a module the test run is configured to leave uninstrumented. Otherwise the answer says the recording cannot tell, and why.
- The path may be spelled through `..` or from the root of the file system; the map names it from the root of the checkout. A path outside the checkout is refused as outside it.
- `journeyMap` and `journeyMaps` take the listing `checkoutListing` returns, so a caller that already asked git about the path does not ask again.
- `ask journey-map` and `ask slowest-tests` share one check for a path that is not in the checkout. It accepts a new file that git lists as untracked and not ignored, which `ask slowest-tests` refused before.
