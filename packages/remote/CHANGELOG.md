# @variance-authority/remote

## 0.1.1

### Patch Changes

- @variance-authority/core@0.1.1
  - @variance-authority/raster@0.1.1

## 0.1.0

### Patch Changes

- 12a5043: Send the batch a client is waiting on. The timer that dispatches a batched
  render was `unref`'d, so a process whose only remaining work was that batch —
  the ordinary shape of a client that offloaded rendering and holds no browser,
  no server and no socket of its own — exited before the request left. Every
  caller's promise stayed pending and the render reported nothing at all. The
  timer is now ref'd and cleared when a full batch flushes early.
- Updated dependencies [e8fee66]
- Updated dependencies [5c34e6d]
  - @variance-authority/core@0.1.0
  - @variance-authority/raster@0.1.0
