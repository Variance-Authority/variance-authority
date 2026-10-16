---
'@variance-authority/help': patch
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

`uses` answers the lines that use a field of an interface or a type

`variance ask uses --name size` listed where a member named `size` was
declared, and sent you to a text search for everything that touched it. Now
each declaration on a named container is followed by the lines that read,
write or destructure the member through a value whose type the line writes:
`props: Props`, `value as Props`, `{ size: 3 } satisfies Props`,
`({ size }: Props) =>`. Each line says its package and how it uses the member:
`use.ts:6 — @acme/lib, write`.

The type's name is followed through the import that binds it, renamed or
passed on by a barrel, to the file that declares it, so `Props.size` and
`Other.size` are listed apart, and a value typed as neither is a use of
neither. What a type checker would infer stays the text search's, which the
answer still names.

The source index records these uses with each file's parse, in format version
23; `variance index` rebuilds an older one.
