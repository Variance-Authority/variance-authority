---
'@variance-authority/tribunal': minor
'@variance-authority/cli': minor
---

`variance push` asks what the deployment already holds, and uploads only the rest

Objects in a tribunal deployment are addressed by their content, which made most
of what a push sent redundant without anything being able to notice: a run's
`before` **is** the baseline that deployment handed it over `/baseline/find`, and
an unchanged subject's `after` is a second copy of that same picture. Every run
re-encoded and re-uploaded them, and the second and every later copy landed at a
key the store already had.

A push now opens with one `POST /review/have` naming the SHA-256 of every image
it is holding. Images the deployment can already produce travel as a digest; the
rest travel as bytes. A suite where nothing moved sends its report and almost no
pixels, and `variance push` reports how many images it did not have to upload.

The digest form is re-checked on ingest rather than trusted. A digest this
deployment does not hold — invented, or collected by retention between the
question and the build — refuses the build naming the subject and the remedy,
because the run still has the image on disk and may push it again. Recording a
subject whose picture is not there would surface as a 404 on a review page days
later instead.

A deployment that does not answer `/review/have` gets the push this command made
before the route existed: larger, and correct. Upgrading the CLI ahead of the
service is not a breaking change.
