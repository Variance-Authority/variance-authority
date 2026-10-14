---
'@variance-authority/raster': minor
'@variance-authority/png': minor
'@variance-authority/observe': minor
'@variance-authority/cli': minor
---

A colour change of more than 1% is a change

The default policy counted a pixel only when its colour changed by more than 10%
of the largest difference `pixelmatch`'s YIQ metric measures, which is
`pixelmatch`'s own default. At 10%,
a border colour changed from `#2f3437` to `#3a4043`, or an accent from `#ff4a19`
to `#ff6a19`, reported `unchanged` on every story it painted. `DEFAULT_POLICY` now
uses `threshold: 0.01` and still forgives antialiasing. A subject whose colour
changed by between 1% and 10% since its baseline reports `changed` on its next
run. Stored baselines are not re-keyed.

The reason for a green verdict now gives the pixels the default policy forgave,
when the strict policy counted any: *no pixels differ beyond the tolerance of the
default policy, which forgave 37 pixels as antialiasing or as a colour change of
at most 1%*. The same clause follows the reason for every `ignored` verdict. It
replaces `; 37 pixels differ with antialiasing counted`, which named
antialiasing for pixels that the colour threshold had forgiven.
