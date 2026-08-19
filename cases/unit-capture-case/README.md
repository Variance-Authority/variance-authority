# Browserless capture, later browser

This case runs an ordinary jsdom Vitest in one process. That process writes a
resource-closed capture and imports no browser package. A second CLI process
loads the artifact through `@variance-authority/unit-test`, launches the normal
renderer, records the first baseline, and observes the same artifact unchanged.

It is the consumer proof for the two-step unit-runner offering. It is not
Vitest Browser Mode: the unit test has finished before Chromium starts.
