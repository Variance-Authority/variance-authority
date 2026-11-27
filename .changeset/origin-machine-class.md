---
'@variance-authority/cli': patch
'@variance-authority/help': patch
'@variance-authority/playwright-test': patch
'@variance-authority/sense': patch
---

Each landing in the runs record names the class of machine its run ran on: the CPU and architecture, the OS, the cores (with a Linux cgroup CPU quota beside them), the memory (with the cgroup limit), Node, the CI image where the environment names one, and the workers Vitest, Jest or Playwright ran in. Each field is absent where unknown, and none names a host. A fold of shards keeps each shard's machine, and `variance ask slowest-tests` ranks files once per class of machine rather than across them. Selection never reads it, and it enters no cache key. `recordExecution` takes `workers`.
