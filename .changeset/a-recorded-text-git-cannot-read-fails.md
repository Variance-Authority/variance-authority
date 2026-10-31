---
'@variance-authority/sense': minor
---

Selection reads the text a recording was cut from through the native addon, which it now requires, and the same reader the journeys walk uses. A file is missing at the recording's commit only when that commit's tree does not list it. When git cannot read it — the checkout does not hold the commit at all (a shallow clone, or `fetch-depth: 1`), no remote serves a blob a partial clone lacks, the object store lost a blob, the root is no checkout, git 2.43 refuses a lazy fetch — selection fails with git's own reason, or names the commit and how to fetch it, rather than reading every such file as missing and widening. A blob git holds as a git-LFS pointer is read as its content, or the read fails with git-lfs's reason, including when the checkout holds the pointer on disk too. In a partial clone only the blobs the clone lacks are fetched.

The journeys walk reads a file unchanged since the recording from the checkout. A file git does not track, untracked or ignored, is one the recorded commit did not hold, and the walk reads it as absent rather than from disk. When the checkout holds a git-LFS pointer there, the walk fails with the scan's message and the commands that fetch the content, rather than parsing the pointer as an empty module.
