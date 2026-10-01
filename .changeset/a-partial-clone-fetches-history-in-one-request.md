---
"@variance-authority/sense": patch
---

A partial clone fetches the texts at a recorded commit in one request

In a clone made with `--filter`, such as `actions/checkout` with `filter: blob:none`, the files changed since a recording's commit are on the remote until something reads them, and `git cat-file --batch` fetched each one in a request of its own. Reading a recording's text now asks without fetching first, fetches every blob it found missing in one request from the remote that promised them, then reads those again. On a blobless clone of Material UI from GitHub, fifteen texts took 9.0 s fetched one at a time and 0.7 s fetched together. A fetch that fails falls back to fetching one object at a time, as before. A full clone runs nothing extra.
