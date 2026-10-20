<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/reads

> Say, on the element that shows it, which files a page showed, so an edit to
> one of them photographs only the pages that show it.

Part of [Variance Authority](https://variance-authority.dev).
Point your coding agent at [`llms.txt`](https://variance-authority.dev/llms.txt).

A recorded page run knows what code each page ran: the browser drains its own
coverage, and the server reports what it executed under the page's journey. The
code does not always name what the page showed. A document read at build time,
a string bundled with `?raw`, or a body a cache answered runs the same code
whichever file it holds, so the code alone says that every page reading
documents depends on every document. You edit one markdown file and the whole
site is photographed again.

The element that shows the file knows which file it is. You spread `reads()` on
it, the element carries the paths as an attribute, and
[`@variance-authority/route-collector`](https://variance-authority.dev/reference/packages/route-collector)
keeps each one as something that page showed. The next run selects a page when
a file it showed changed, beside the pages that ran the code that changed.

```bash
npm install @variance-authority/reads
```

It is a dependency, not a dev dependency: the call is in the code you ship.

## Requirements

Node 22 or newer, and an ESM project. The package declares no dependencies and
no peers, reads no environment and has no side effect, so it is safe in
production code and in any framework that spreads props onto an element.

## Name the file where it is shown

```tsx
import { reads } from '@variance-authority/reads';

export function Article({ document }) {
  return <article {...reads(document.path)}>{document.body}</article>;
}
```

The markup carries `data-variance-reads="docs/a.md"`. A component that shows
several files names them all — `reads(a.path, [b.path, c.path])` — and an
element inside another one names its own: the page run reads the attribute on
the subject's root and on every element under it, and unions the paths.

Each path is repository-relative, the way `git` names the file. The page run
reads the file at that path in the checkout and keeps its digest; a path the
checkout does not hold is kept as nothing, so the edit that adds the file is a
change no record names, and that runs every page.

## What it returns

| You pass | You get |
|---|---|
| one or more paths | `{ 'data-variance-reads': '<paths>' }`: each path once, in code-unit order, space-separated |
| nothing, or only `undefined` | `{}`: an element handed no file carries no claim |
| an empty path, or one holding whitespace | a `TypeError`, because the attribute is space-separated and the path would come back as files nobody showed |

The order does not depend on the order you named them in, so the same files are
the same markup on every machine.

`READS_ATTRIBUTE` is the attribute's name, for code that reads it back.

## What it costs a page

One attribute per element you name. It is markup, so the document's digest
moves once when you add it. The structure Variance Authority compares keeps
only the attributes it names, and this is not one of them, so no comparison
shows it.

---

**[@variance-authority/reads](https://variance-authority.dev/reference/packages/reads)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · [GitHub](https://github.com/Variance-Authority/variance-authority/tree/main/packages/reads) · MIT
