---
'@variance-authority/cli': patch
---

`variance push` says where it is while it is there

A push of a real suite spends most of its wall clock before the request exists:
every image the report named is read off disk and base64-encoded into one body,
and a few hundred subjects of that is tens of seconds of a command that has
printed nothing. Silence there is indistinguishable from a hang against an
address that is not answering, and the two call for opposite responses — wait,
or interrupt and check the endpoint.

So the two phases report themselves, on stderr, in the shape the reader is in.
A terminal gets one line rewritten in place, cleared before the report lands on
stdout. A log file gets one line per phase and nothing per subject, because a
build log is read afterwards, where every intermediate count is noise.

`sending` carries a size and no progress, which is the truth about it: the body
is one POST, and the number that explains the silence after it is how large that
body turned out to be.

`PushOptions` gained an optional `onProgress`, and nothing computes an event for
a caller that did not ask for one.
