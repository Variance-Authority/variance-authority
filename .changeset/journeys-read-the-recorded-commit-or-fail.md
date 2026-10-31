---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
'@variance-authority/help': patch
---

Journeys read the recorded commit, or say why git could not

On git 2.43, the version Ubuntu 24.04 and the Playwright images ship, the
journeys walk could not read the files that had changed since the recorded
commit in a partial clone. Asking `cat-file` with `GIT_NO_LAZY_FETCH=1` makes
that git exit 128 at the first object it lacks, instead of answering
`missing`. The walk then parsed those files as the working tree had them.
Now the walk lists the changed files' objects with `diff --raw`, fetches them
from the promisor remote in one request, and reads them by object name. When
git cannot serve one, the journeys are not prepared, and `variance index`
prints git's own reason. A recording that names no commit is not walked.

A call whose import resolves to no function is no longer placed on a function
the case ran because that function is exported under the imported name. Such a
call has no place.

The `variance index` journeys line names the unit of each count. Functions
entered are counted once per case that entered each, and calls and package
flows are distinct. A recording kept inside the checkout is named by its
checkout path, and one in a shared cache by its own path.
