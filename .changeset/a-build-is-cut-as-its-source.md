---
'@variance-authority/sense': patch
---

A module your suite loads as both TypeScript and its `tsc` build keeps the cases recorded on it

The source and its build are recorded under one path, and a merge keeps only the
regions both readings cut. They did not cut the same ones. `tsc` erases the
`import type` lines above a module's first import, so the build's module opened
lower than the source's. It also maps the closing `)` of a call written over
several lines to the line of the last argument, so an `await` on that call
ended a line short. The module region and those `await` regions fell out of
the merge, together with every case recorded on them. In this repository's own
unit suite that dropped all 606 crossings carried for one such module. A
build is now recorded at its source's regions, and so is any code a runner's
transform hands over with a source map. A build that cut a region its source
has not, such as a helper a bundler wrote, keeps its regions where its map puts
them, and only its module region takes the source's lines, so an `await` the
map closed a line short can still fall out there.

Every seam, and the fold that cuts a module again from the checkout, cuts it
through one function, so a module and its build carry one cut, and a build
walks its source once more to get it. Coverage written before this release
still holds the old cut. For a module loaded both ways, the first run layered
over it is expected to drop what it carried, and the next record holds the
source's cut; a module whose regions only moved lines is carried as before.
