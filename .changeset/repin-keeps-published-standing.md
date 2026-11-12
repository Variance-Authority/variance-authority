---
'@variance-authority/sense': patch
---

A checkout repinned to a newer mainline record keeps each test where that record's runs say it stands, rather than at the record's commit, so a record that did not run every test there can be laid without losing what changed since a test last ran.
