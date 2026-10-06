---
'@variance-authority/cli': patch
---

`variance select` no longer waits for the code map, the journeys, the
dependency lexicon and the questions that `variance index` leaves to a process
of its own on your machine. It reads none of them. It waits only while that
process brings the index up to date and folds its working layer into its base,
which it does before the four, and prints `waiting for process <pid> to fold the source index`
on stderr while it does. `variance index` followed at once by `variance select`
no longer pays for the follow-ups. Every other command still waits for all of
them, and the `follow-ups:` line now says the next command that reads them
waits. When that process ended before it finished, `select` reads the index as
it stands and leaves the follow-ups to the next command that reads them, which
makes them as before.
