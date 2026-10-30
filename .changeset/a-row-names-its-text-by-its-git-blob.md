---
"@variance-authority/sense": minor
"@variance-authority/cli": minor
---

A coverage record names the text each module row was cut from by its git blob as well as by its digest, in a new `modules.blob` section of record format 12; format 11 records still open, with no blob named. `variance coverage` compares that name with the one the source index gives the file now, hashing no text, and reads two texts only to diff them where their names differ. Outside CI it brings the source index up to the checkout first; when that fails, every region run counts as not known and the reason names the failure. A file the source index does not hold counts as not known too, and nothing reads the disk in its place. A file whose rows were written before rows named their blob counts its regions run as not known, with that reason, until a run records the file again. In CI it takes the source index as the pipeline published it and builds none; with no index to have, it reads no text, and every region run counts as not known because no source index names the checkout's texts.
