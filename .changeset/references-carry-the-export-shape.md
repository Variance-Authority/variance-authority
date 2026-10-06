---
"@variance-authority/sense": minor
---

`importReferences` says what the file exports, `exports`, absent where an
`export *` leaves the set to another file, and which of its exports carry a
name it reads when it loads, `carries`, with the file that name is imported
from.
It also lists each line inside a function that reads such a name, or a
binding that name set at load, `traced`: a case that runs the line sees a mock
of that import.
