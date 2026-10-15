---
'@variance-authority/cli': patch
---

An embedded HTML report carries what changed, not every full page

`variance report --format html --embed-images` carried every subject's before,
difference and after pages. One documentation page 57,691 rows tall made a
42.5 MB file whose change picture arrived last, after 17 seconds on a 20 Mbit/s
link. A subject with a change picture now carries a full page only when the
page holds no more pixels than that picture, and its card names each page left
out, with its size; the pages stay beside `report.json`. The picture each card
opens on is carried before every other picture, and a carried picture is
decoded only when a view near the screen shows it. The same run's page is
486 KB and shows its change picture within 90 ms on that link.
