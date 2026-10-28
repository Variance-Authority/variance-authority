---
'@variance-authority/sense': minor
'@variance-authority/help': minor
'@variance-authority/cli': minor
---

`ask uses` lists the imports inside the declaring package apart, with the lines that use them, and the classes that implement a member

The first line of `variance ask uses` counted every import of a name as one
number, and the list mixed the imports inside the package that declares it
with the ones from other packages. Both are now counted apart, `imported in 2
places: 1 from another package and 1 inside @acme/lib`, and listed under
`Source, inside @acme/lib:` and `Source, from other packages:`, and the same
for tests and stories. `ask symbol` counts its places the same way. Each
import ends with the lines its file uses what it binds on, `; used on lines
4, 5`.

A member of an interface now lists the member of each class that writes
`implements` of it as an `implement`. An object that takes the interface from
where it goes, such as `run({ deps: { readJourney } })`, writes no type on its
line: the answer says so and names the declaration to ask TypeScript's
go-to-implementation about.

The source index moves to format 37: it holds the lines a file uses each
import's binding on, and the `implement` members. The first command after the
upgrade reads every file again.
