---
'@variance-authority/sense': patch
---

A tree's scans open git's object store once, when the files they have read
reach 3,000, and every later wave of their import walks reads from it. It used to open the store
again for every wave of 160 files or more, about 15 ms each time on Kibana, and
read every smaller wave from disk.
