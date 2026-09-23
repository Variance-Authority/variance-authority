---
'@variance-authority/sense': patch
---

Write each case's journal when it settles, not when its file ends

With per-case recording on, a test worker used to hold a counter array for
every module every case touched until the file's `afterAll`. A file of a
thousand cases held a thousand sets, mostly zeros. Each case is now written and
dropped as soon as it settles, so a worker holds one case's counters and the
file's union. What ran before the first test is closed in the first
`beforeAll` as a record of its own, rather than copied. Work that outlives its
case arrives as a second frame for that case, and the reader joins the two.

Writing a journal reads each counter array once instead of six times, which
takes the encoding of a thousand-case file 7.5 times faster, and byte for byte
the same.
