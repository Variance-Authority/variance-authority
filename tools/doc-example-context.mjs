/**
 * Names a README example may use without declaring, and the signature each is
 * typed from.
 *
 * The rule that makes this worth having: **a name is typed from the signature
 * that consumes it**, never from a type written here. `viewport` is *whatever
 * `acquireDocument` takes*, spelled `Parameters<...>`. Nothing in this file can
 * drift from the API, because nothing in it restates the API — and an example
 * reaching for a name no signature produces fails to compile, which is how a
 * plausible invention gets caught while the real field passes.
 */

export const CONTEXT = {
  // core
  capture: `Parameters<typeof import('@variance-authority/core').normalize>[0]`,
  recapture: `Parameters<typeof import('@variance-authority/core').normalize>[0]`,
  mask: `Parameters<typeof import('@variance-authority/core').isolateRegions>[0]`,

  // dom / react
  container: `Parameters<typeof import('@variance-authority/dom').collect>[0]`,
  subject: `Parameters<typeof import('@variance-authority/dom').acquireDocument>[1]['subject']`,
  fonts: `NonNullable<Parameters<typeof import('@variance-authority/dom').acquireDocument>[1]['fonts']>`,
  viewport: `Parameters<typeof import('@variance-authority/dom').acquireDocument>[1]['viewport']`,

  // observe
  renderer: `import('@variance-authority/observe').ObserveOptions['renderer']`,
  store: `import('@variance-authority/observe').ObserveOptions['store']`,
  snapshot: `NonNullable<import('@variance-authority/observe').ObserveOptions['snapshot']>`,
  source: `NonNullable<import('@variance-authority/observe').ObserveOptions['source']>`,
  'packages/observe/README.md#before': `Parameters<typeof import('@variance-authority/observe').observePair>[0]`,
  'packages/observe/README.md#after': `Parameters<typeof import('@variance-authority/observe').observePair>[1]`,
  'packages/observe/README.md#document': `Parameters<typeof import('@variance-authority/observe').observeAgainstBaseline>[0]`,

  // png
  before: `Parameters<typeof import('@variance-authority/png').compareRasters>[0]`,
  after: `Parameters<typeof import('@variance-authority/png').compareRasters>[1]`,
  chromiumPng: `Parameters<typeof import('@variance-authority/png/difference').observePngDifference>[0]['firstImage']`,
  webkitPng: `Parameters<typeof import('@variance-authority/png/difference').observePngDifference>[0]['secondImage']`,

  // raster
  first: `Parameters<typeof import('@variance-authority/raster').gateStability>[0][number]`,
  second: `Parameters<typeof import('@variance-authority/raster').gateStability>[0][number]`,
  chromiumPixels: `Parameters<typeof import('@variance-authority/raster/difference').observeDifference>[0]['firstImage']`,
  webkitPixels: `Parameters<typeof import('@variance-authority/raster/difference').observeDifference>[0]['secondImage']`,
  current: `Awaited<ReturnType<typeof import('@variance-authority/raster/difference').observeDifference>>`,

  // sense
  subjectsThisRunPainted: `NonNullable<NonNullable<Parameters<typeof import('@variance-authority/sense/test-selection').journeysApart>[1]>['observers']>`,

  // playwright / remote
  'packages/playwright/README.md#document': `Parameters<Awaited<ReturnType<typeof import('@variance-authority/playwright').createPlaywrightRenderer>>['render']>[0]`,
  iifeBundleInstallingYourAgent: `Parameters<typeof import('@variance-authority/playwright').createHarness>[0]['bundle']`,
  harness: `Parameters<typeof import('@variance-authority/storybook').harnessPage>[0]`,

  // report / mcp / history / server
  runReport: `Parameters<typeof import('@variance-authority/report/file').writeRunReport>[1]`,
  report: `Parameters<NonNullable<ReturnType<typeof import('@variance-authority/mcp/tools').toolByName>>['run']>[0]`,
  token:`Parameters<typeof import('@variance-authority/server').serveHistory>[0]['token']`,

  // session — the one place a fence invents a shape, because the loop it shows is
  // the reader's own: a list of things to render, which this package never names.
  'packages/session/README.md#document': `Parameters<typeof import('@variance-authority/session').createSession>[0]['document']`,
  createRoot: `typeof import('react-dom/client').createRoot`,
  subjects: `readonly {
    readonly ref: Parameters<ReturnType<typeof import('@variance-authority/session').createSession>['run']>[0];
    readonly element: Parameters<ReturnType<typeof import('react-dom/client').createRoot>['render']>[0];
  }[]`,
};
