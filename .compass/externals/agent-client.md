# Agent client

## What it is

The client a coding agent runs inside — an editor, a terminal agent, a desktop
assistant — which speaks Model Context Protocol over stdio and decides which
tools its model may call.

## Good at

Asking a narrow question at the moment it matters, and reading a structured
answer instead of a rendered page.

## Bad at

Distinguishing an absence from a zero on its own. It will read *no findings* out
of a tool that was never given anything to look at, unless the answer says
which of the two it is.

## How it breaks

It calls a tool before it knows what evidence exists, and reasons from a
partial inventory. It treats a comparison of one invocation against a
remembered previous one as a durable record, when nothing was written down.

## How you talk to it

Model Context Protocol over stdio. Tools that read already-collected evidence
and never run a test, rerender a **subject**, or change a **baseline**.

## Their chart

—
