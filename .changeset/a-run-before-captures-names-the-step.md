---
"@variance-authority/unit-test": patch
---

A run before the unit tests names the step it needs

`variance run` over a capture directory that does not exist exits 2 with an
operator error that says what is missing and what writes it:

```text
capture directory test/.variance/captures does not exist, so there is no capture to compare. Your unit tests write it through `writeCapture`: run them first, then run variance again. If they have run, none of them wrote a capture to this directory.
```

It used to exit 2 with `cannot read capture directory` under a banner that
called it a defect in the tool. A capture directory that cannot be read for
another reason, such as a path that is a file, is an operator error too, with
the system's reason.
