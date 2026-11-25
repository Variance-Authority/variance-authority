---
'@variance-authority/sense': minor
'@variance-authority/cli': patch
---

`recordedAttempts` names the retried cases no attempt of which passed

A case that fails every attempt ended the same way each time, so `differed` leaves it out and nothing listed it as failed. `unpassed` and `unpassing` carry it, and `variance view` shows it under "Cases that did not pass".
