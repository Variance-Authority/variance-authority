---
'@variance-authority/cli': minor
---

`variance select`, `variance run --since` and `variance journeys` take `--suite <name>`. Once the root `variance.config.json` declares suites, each of these commands reads one suite's record: the one `--suite` names, or the only one declared. With more than one suite declared and no `--suite`, the command stops and lists the suites. Passing `--suite` together with `--execution` or `--into` is refused, because both name the record.
