---
'@variance-authority/sense': patch
---

A scan opens git's object store once, when the files it has read reach 3,000,
and every later wave of its import walk reads from it. It used to open the store
again for every wave of 160 files or more, about 15 ms each time on Kibana, and
read every smaller wave from disk.
