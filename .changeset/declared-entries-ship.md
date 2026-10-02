---
'@variance-authority/sense': patch
---

A file a package's `exports`, `main`, `module` or `bin` names now ships in the
code map whatever its name says, and so does every file it loads. A package
that publishes `./src/jest.ts` as `./jest`, or `./src/playwright.ts` as
`./playwright`, used to have it read as a test because a runner is named on
the path, which left it out of the package's closure in `variance layers` and
out of the shipped files a transitive rule in `variance restrictions` starts
from. A package whose manifest names none of its files still starts at the
files its own code never imports, and a test file is still not one of them. A
package inside a test's fixtures directory ships nothing, as before.
