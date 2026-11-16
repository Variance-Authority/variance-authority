---
'@variance-authority/sense': patch
---

An index or an update opens git's object store once, when the files its scans
have read reach 3,000, and every later file it reads comes from the store. It
used to open the store again for every wave of 160 files or more, about 15 ms
each time on Kibana, and read every smaller wave from disk.
