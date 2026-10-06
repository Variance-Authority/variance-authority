---
"@variance-authority/cli": patch
---

Each `variance` command loads only the modules it calls. Every command used
to load every other command's modules first, Storybook, the pixel stores,
history, the MCP tools and the help among them. On this repository:

- `variance --version` takes about 85 ms, where it took about 170 ms.
- `variance index` takes about 165 ms, where it took about 245 ms. The help
  is loaded only by the follow-ups `index` hands to another process.
- `variance select --suite unit` takes about 445 ms, where it took about
  565 ms; part of that is fewer git processes.
