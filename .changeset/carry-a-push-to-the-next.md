---
'@variance-authority/cli': minor
---

`variance carry take` and `variance carry keep` carry a pull request's last push to its next, under the `pushed-*` keys `carry restore` and `carry save` now print, so a later push runs what changed since the last one and every test that push left red or incomplete. `take` sets the mainline's record aside and prints its path as `against-<suite>`, so `variance review --against` still compares with the mainline.
