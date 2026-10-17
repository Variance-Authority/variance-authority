---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

A record cut under other probes answers, and names what it leaves open

`variance covering`, `review`, `select`, `journeys` and a `run --since` read a
record cut under probes this build does not place, such as
`sense:instrument/presence-v5` under a build that places `presence-v6`, as if
it described the code as this build cuts it. Each still answers from it, and now
says beside the answer which probes cut the record, which this build places,
and that whether a region this build cuts and those probes did not ran is not
answered. `covering --file` compares that file's regions in the record with the
ones this build cuts in the text the record was made over, and says when they
are the same or names the ones that differ. When the mainline's record cut under
this build's probes is on the machine beneath the one read, the note names its
path, which `--execution` reads. A `covering` refusal that such a record holds
nothing of the asked file carries the same note.

A suite with nothing recorded is refused as before, now without naming a
recorder to run; a suite the share carries names `variance share --suite` to
fetch the mainline's record.

`covering` on a file the suite declares a precondition of its test files, such
as a Rust source under a Node suite, now says that the file is not instrumented
and that the suite declares it, rather than listing every test file as having
met it. A file the run loaded without instrumenting keeps the old wording.

`covering` on a whole module many test files import names the cases that ran a
range and counts, per range, the ones that ran it only while their file
imported the module, instead of listing all of them.

A reader no longer refuses what it can partly answer, and no message asks you
to run the suite or record it again:

- `covering` over a file whose recorded text could not be found names the cases
  that ran code in the file, and says that which of them ran the asked line
  cannot be said. It used to refuse.
- `covering --where` over a record that holds no case's preconditions keeps
  none and counts every case as unmeasured. It used to exit `2` with
  `{"refused":"unmeasured"}`.
- `covering --line` on lines no recorded region holds, such as a blank line or
  an import, or on lines your edit wrote, answers with no case and says which
  each line is, rather than refusing. Under `--format json` that answer, which
  holds no recorded line, carries `outside` and `written` as answers with one
  already did.
- `covering --hops` and `--at-distance` beside a coverage snapshot from another
  run than the per-case index list the test files with no hops, and say why.
- `review --since <ref>` beside a runs record that cannot be read answers from
  the named base and says, beside the answer and under `runsUnread` in JSON,
  that the record could not be read, so no case is said to have moved unless
  `--against` names the base's cases. With no base named it is still refused,
  and the refusal names `--since <ref>`.
- `story --compare` with a side that holds no reading draws the newest reading
  of the other and says which side is missing, rather than refusing; JSON
  carries it as `unmatched`. A comparison with one reading on a side says so
  and no longer asks for another run.
- The refusals that stay say what they cannot read and why an answer past it
  would mislead: an unreadable runs record, a journal that names
  no commit, an unreadable execution journal, and `--cases last` over runs that
  name no case. Where a base answers them they name `--since <ref>`. A merged
  report that drops the composition says that each shard's report still holds
  its own, and a record another build wrote is left as it was.
