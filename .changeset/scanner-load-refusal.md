---
'@variance-authority/sense': patch
---

Say why the native scanner did not load

Finalizing or stitching journeys without the scanner now carries the loader's
own message — a missing package, or a `dlopen` refusal naming the glibc symbol —
instead of only naming the addon.
