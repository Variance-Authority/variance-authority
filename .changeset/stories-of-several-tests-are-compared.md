---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

`variance story` compares tests with each other: name each with its own `--name`, two or more, and every test is a side, set against the others the way the readings of one test are. Write `<file> > <name>` for a name two test files hold. `--compare` takes more than two labels, as `--compare a,b,c`. A comparison of any number of sides lists what holds on every reading of some sides and none of the others under the sides that hold it, and an order the sides hold differently with the sides on each side of it. `compareReadings` takes the sides as one list, and a `Comparison` carries `only` and `orders` in place of `places`, `said` and `reversed`.
