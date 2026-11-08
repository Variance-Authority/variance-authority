---
'@variance-authority/cli': minor
---

`variance carry merge <commit>` stands a pull request's checkout on its head merged into the commit the mainline's record was made at, so `select` and the review measure the pull request alone. It reads the head from the pull request's event, or from `--head <sha>`, and makes the same commit in every clone: the parents, the author, the committer, the date and the message are fixed. Under `--format github` it prints `merged=` and `checkout=`. `--on-conflict stay` leaves a head that conflicts on the host's merge, where the default fails the step; a merge stopped by anything else always fails it, and every stop leaves the checkout where it was. `--expect <sha>` fails a job whose merge is not the one another job made. It replaces the git commands the sharing guide had a workflow paste.
