---
'@variance-authority/cli': minor
'@variance-authority/help': minor
---

`variance ask` and `variance-authority-help` answer a source question from the generation `variance index` last published, at any age, and do nothing else: they no longer look at the files an answer rests on, refresh a generation over an hour old, or build one when none is published. After an edit, run `variance index`, then ask. With no generation, a question refuses in one line that names `variance index`. On Kibana, `ask symbol --name HttpServer` after a one-line edit to the file that declares it went from about 6.6 s to the unedited time. `--just-answer` leaves both commands, since it is what they now always do; `variance serve` and the help server keep it and their one-hour reuse. `--changed-file` and `--taint-file` still ask for a new generation by name.
