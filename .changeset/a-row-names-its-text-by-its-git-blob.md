---
"@variance-authority/sense": minor
"@variance-authority/cli": minor
---

A coverage record names the text each module row was cut from by its git blob as well as by its digest, in a new `modules.blob` section of record format 12; format 11 records still open, with no blob named. `variance coverage` compares that name with the one the source index gives the file on disk, and reads a file's text and the edits since only where the two differ or a run ran another text. A file whose rows were written before rows named their blob counts its regions run as not known, with that reason, until a run records the file again. In CI it takes the source index as the pipeline published it and builds none; with no index to have, it reads no text, and every region run counts as not known because no source index names the checkout's texts.
