---
'@variance-authority/cli': patch
---

An embedded HTML report opens on what changed and decodes what is shown

`variance report --format html --embed-images` carried every subject's before,
difference and after pages first and decoded every picture as it arrived. One
documentation page 57,691 rows tall made a 42.5 MB file whose change picture
arrived last, after 17 seconds on a 20 Mbit/s link. The picture each card opens
on is now carried before every other picture, and a carried picture is decoded
only when a view near the screen shows it. A full page longer than 16,384
pixels is not carried when its run cut a change picture; the card names each
page left out, with its size, and the pages stay beside `report.json`. The same
run's page is 486 KB and shows its change picture within 90 ms on that link.
