// compass: variance-authority.report.agent-surface

/** More packages than an answer names on one line. */
export const FLAG_KITS = Array.from({ length: 10 }, (_, at) => `flag-kit-${at}`);

/**
 * The files the native answers are asked over, written over `checkout`'s
 * own: a base every question shares, and the files one question needs, chosen
 * by the words it is asked with.
 */
export function nativeFiles(question: readonly string[]): Readonly<Record<string, string>> {
  return {
    'packages/lib/src/index.ts': "export { greet } from './greet.js';\nexport const shared = 'lib';\n",
    'packages/lib-exports/src/index.ts': "export const slug = (title: string): string => title;\nexport const shared = 'lib-exports';\n",
    ...(question[1] === '--package=@acme/tools-only' || question[2] === '@acme/tools-only' ? {
      'packages/tools-only/package.json': JSON.stringify({ name: '@acme/tools-only', exports: { './tools': './src/index.ts' } }),
      'packages/tools-only/src/index.ts': '/** A receipt.\n * Shown in the task.\n *\n * Extra details.\n */\nexport const receipt = 1;\nexport const status = 2;\n',
    } : {}),
    ...(question[0] === 'packages' || question[2] === '@acme/unfollowed' ? {
      'packages/unfollowed/package.json': JSON.stringify({ name: '@acme/unfollowed', main: 'absent.js' }),
      'packages/unfollowed/src/file.ts': "export const held = 'exists';\n",
      'apps/app/src/unfollowed.ts': "import { held } from '@acme/unfollowed';\nexport const value = held;\n",
    } : {}),
    ...(question[2] === 'crowdedLine' ? {
      'apps/app/src/crowded/one.ts': '// crowdedLine\n'.repeat(150),
      'apps/app/src/crowded/two.ts': '// crowdedLine\n'.repeat(60),
    } : {}),
    ...(question[2] === 'dualExport' ? {
      'packages/dual/package.json': JSON.stringify({ name: '@acme/dual', exports: { '.': './src/index.ts', './tools': './src/index.ts' } }),
      'packages/dual/src/index.ts': "export const dualExport = 'dual';\n",
      'apps/app/src/dual-tools.ts': "import { dualExport } from '@acme/dual/tools';\nexport const fromTools = dualExport;\n",
      'apps/app/src/dual-root.ts': "import { dualExport } from '@acme/dual';\nexport const fromRoot = dualExport;\n",
    } : {}),
    ...(question[2] === 'wholeExport' ? {
      'packages/whole/package.json': JSON.stringify({ name: '@acme/whole', main: './src/index.ts' }),
      'packages/whole/src/index.ts': "export const wholeExport = 'held';\n",
      'apps/app/src/whole.ts': "import * as held from '@acme/whole';\nconsole.log(held);\n",
    } : {}),
    'packages/lib/src/also.ts': "import { greet as hello } from './greet.js';\nexport const also = hello('lib');\n",
    'packages/kit/src/money/tax.ts': '/** The levy on an amount. */\nexport function taxOf(amount: number) { return amount / 5; }\nexport const unusedRate = 0.2;\n',
    'packages/kit/src/ledger.ts': "export const ledgerCode = 'kit';\n",
    'packages/lib/src/ledger.ts': "export const ledgerCode = 'lib';\n",
    'packages/kit/src/reader.ts': 'export function readCheckout() { return 3; }\n',
    ...(['externalOnly', 'kitExternal'].includes(question[2] ?? '') ? {
      'package.json': JSON.stringify({ private: true, workspaces: ['packages/*', 'apps/*'], dependencies: { 'search-kit': '1.0.0' } }),
      'node_modules/search-kit/package.json': JSON.stringify({ name: 'search-kit', version: '1.0.0', types: 'index.d.ts' }),
      'node_modules/search-kit/index.d.ts': 'export declare const externalOnly: true;\nexport declare const kitExternal: true;\n',
      'packages/kit/src/external.ts': 'export const kitExternal = true;\n',
    } : {}),
    ...(question[1] === '--query=-only' ? {
      'package.json': JSON.stringify({ private: true, workspaces: ['packages/*', 'apps/*'], dependencies: Object.fromEntries(FLAG_KITS.map((name) => [name, '1.0.0'])) }),
      ...Object.fromEntries(FLAG_KITS.flatMap((name) => [
        [`node_modules/${name}/package.json`, JSON.stringify({ name, version: '1.0.0', types: 'index.d.ts', description: 'handles only flags.' })],
        [`node_modules/${name}/index.d.ts`, 'export declare const onlyFlags: true;\n'],
      ])),
      'packages/kit/src/flags.ts': 'export const onlyFlags = true;\n',
    } : {}),
    ...(question[2] === 'CabinetLedger' ? {
      'package.json': JSON.stringify({ private: true, workspaces: ['packages/*', 'apps/*'], dependencies: { 'readme-kit': '1.0.0' } }),
      'node_modules/readme-kit/package.json': JSON.stringify({ name: 'readme-kit', version: '1.0.0', main: 'index.js' }),
      'node_modules/readme-kit/index.js': 'module.exports = { CabinetLedger() {} };\n',
      'node_modules/readme-kit/README.md': '## CabinetLedger\n\nKeeps a list of cabinet entries.\n',
    } : {}),
    'packages/lib/src/private.ts': 'export const shown = 3;\nfunction 値() { return shown; }\nexport const used = 値();\n',
    'packages/lib/src/private.test.ts': 'export const other = 4;\nfunction 値() { return other; }\nexport const tested = 値();\n',
    ...(question[2]?.startsWith('bound') ? {
      'packages/lib/src/bound-a.js': "const { boundOnly } = make();\nconst { boundToo } = primordials;\nconst boundModule = require('./bound-b');\nexports.use = () => [boundOnly, boundToo, boundModule];\n",
      'packages/lib/src/bound-b.js': "const { boundOnly } = make();\nconst { boundExport } = require('@acme/bound');\nfunction boundToo() {}\nexports.use = () => [boundOnly, boundExport, boundToo];\n",
      'packages/bound/package.json': JSON.stringify({ name: '@acme/bound', main: './src/index.ts' }),
      'packages/bound/src/index.ts': 'export const boundExport = 1;\n',
    } : {}),
    ...(['twinName', 'relayed', 'KitShape', 'KitBox', 'KitBox.nothing', 'size', 'open'].includes(question[2] ?? '') ? {
      'packages/lib/src/twin.ts': "export const twinName = 'lib';\n",
      'packages/lib/src/twins.ts': "import { twinName } from './twin.js';\nexport const twins = [twinName];\n",
      'packages/lib-exports/src/twin.ts': "export function twinName(): string { return 'exports'; }\n",
      'packages/lib-exports/src/twins.ts': "import { twinName as other } from './twin.js';\nexport const twins = other();\n",
      'packages/lib/src/origin.ts': '/** Relayed onwards. */\nexport function relayed(): number { return 1; }\n',
      'packages/lib/src/relay.ts': "export { relayed } from './origin.js';\n",
      'packages/lib/src/relayed.ts': "import { relayed as passed } from './relay.js';\nexport const got = passed();\n",
      'packages/lib/src/shape.ts': 'export type KitShape = { width: number };\nexport class KitBox {\n  open(): void {}\n  size = 2;\n}\n',
      'packages/lib/src/box.ts': "import type { KitShape } from './shape.js';\nimport { KitBox } from './shape.js';\nexport const box: KitShape = { width: new KitBox().size };\n",
    } : {}),
    ...(['Frame', 'Panel', 'runJob', 'zoomIn', 'DeleteRequest', 'MetricsRequest', 'mockOnly'].includes(question[2] ?? '') ? {
      'packages/lib/src/index.ts': "export { greet } from './greet.js';\nexport const shared = 'lib';\nexport function Panel(): string { return 'panel'; }\n",
      'packages/lib-exports/src/index.ts': "export const slug = (title: string): string => title;\nexport const shared = 'lib-exports';\nexport * as Api from './api.js';\n",
      'packages/lib-exports/src/api.ts': 'export type DeleteRequest = { id: string };\n',
      'packages/lib/src/metrics/index.ts': "export * as Metrics from './types.js';\n",
      'packages/lib/src/metrics/types.ts': 'export type MetricsRequest = { id: string };\n',
      'packages/lib/src/metrics/read.ts': "import { Metrics } from './index.js';\nexport const request: Metrics.MetricsRequest = { id: 'a' };\n",
      'packages/lib/src/frame.ts': "export const Frame = 'lib';\n",
      'packages/lib/src/frames.ts': "import { Frame } from './frame.js';\nexport const frames = [Frame];\n",
      'packages/lib-exports/src/frame.ts': "const Frame = 'local';\nexport const framed = Frame;\n",
      'packages/lib-exports/src/panel.ts': "function Panel(): number { return 1; }\nexport const paneled = Panel();\n",
      'apps/app/src/panel.ts': "import { Panel } from '@acme/lib';\nexport const shown = Panel();\n",
      'packages/lib/src/run.ts': 'export function runJob(): number { return 1; }\n',
      'packages/lib/src/runs.ts': "import { runJob } from './run.js';\nexport const ran = runJob();\n",
      'packages/lib-exports/src/runner.ts': 'export class Runner {\n  runJob(): number { return 2; }\n}\nexport const job = new Runner().runJob();\n',
      'packages/lib/src/zoom.ts': 'function zoomIn(level: number): number { return level + 1; }\nexport const zoomed = zoomIn(1);\n',
      'packages/lib-exports/src/camera.ts': 'export class Camera {\n  zoomIn(): void {}\n  Panel(): void {}\n}\nexport const camera = new Camera().zoomIn();\n',
      'packages/lib/src/mock.test.ts': 'export const mockOnly = 1;\n',
      'packages/lib/src/mocked.test.ts': "import { mockOnly } from './mock.test.js';\nexport const seen = mockOnly;\n",
    } : {}),
    ...(question[2] === 'stepAll' ? {
      'packages/lib/src/step.ts': 'export function stepAll(): number { return 1; }\n',
      'packages/lib/src/steps.ts': "import { stepAll } from './step.js';\nexport const stepped = stepAll();\n",
      'packages/lib-exports/src/stepper.ts': 'export class Stepper {\n  stepAll(): number { return 2; }\n}\nexport const once = new Stepper().stepAll();\n',
      'packages/lib-exports/src/kept.ts': 'function stepAll(): number { return 3; }\nexport const kept = stepAll();\n',
    } : {}),
    ...(question[2] === 'greet' && question[4] === '@acme/lib-exports' ? {
      'packages/lib-exports/src/greet.ts': "export const greet = 'unpublished';\n",
      'packages/lib-exports/src/greeted.ts': "import { greet } from './greet.js';\nexport const greeted = greet;\n",
    } : {}),
    ...(question[2] === 'splitFoo' ? {
      'packages/lib/src/index.ts': "export { greet } from './greet.js';\nexport { splitFoo } from './split.js';\n",
      'packages/lib/src/split.ts': 'export const splitFoo = 1;\n',
      'packages/lib-exports/src/split.ts': 'export const splitFoo = 2;\n',
      'packages/lib-exports/src/split-use.ts': "import { splitFoo } from './split.js';\nexport const split = splitFoo;\n",
    } : {}),
    ...(question[2] === 'hiddenFoo' ? {
      'packages/lib/src/hidden.ts': 'function hiddenFoo(): number { return 1; }\nexport const hidden = hiddenFoo();\n',
    } : {}),
    ...(question[2] === 'heldFoo' ? {
      'packages/lib/src/held.ts': 'const { heldFoo } = make();\nexport const held = heldFoo;\n',
      'packages/lib-exports/src/foo.ts': 'export const heldFoo = 1;\n',
    } : {}),
    ...(question[2] === 'PutRequest' ? {
      'packages/lib/src/index.ts': "export { greet } from './greet.js';\nexport * as Api from './api.js';\n",
      'packages/lib/src/api.ts': 'export type PutRequest = { id: string };\n',
      'packages/lib-exports/src/index.ts': "export const slug = (title: string): string => title;\nexport * as Api from './api.js';\n",
      'packages/lib-exports/src/api.ts': 'export type PutRequest = { name: string };\n',
      'apps/app/src/put.ts': "import { slug } from '@acme/lib-exports';\nimport { Api } from '@acme/lib';\nexport const put: Api.PutRequest = { id: slug('a') };\n",
    } : {}),
    ...(question[2] === 'default' ? {
      'packages/lib/src/main-default.ts': 'export default function main(): number { return 1; }\n',
      'apps/app/src/started.ts': "import main from '@acme/lib/src/main-default';\nexport const started = main();\n",
    } : {}),
    ...(question[2] === 'loose' ? {
      'tools/loose.ts': 'export const loose = 1;\n',
      'tools/use-loose.ts': "import { loose } from './loose.js';\nexport const used = loose;\n",
    } : {}),
    ...(question[2] === 'wave' ? {
      'packages/sea/package.json': JSON.stringify({ name: '@acme/sea', main: 'src/index.ts' }),
      'packages/sea/src/index.ts': "export { wave } from './wave.js';\n",
      'packages/sea/src/wave.ts': 'export function wave(): number { return 1; }\n',
      'apps/app/src/beach.ts': "import { wave } from '@acme/sea';\nexport const beach = wave();\n",
      'apps/app/src/surf.ts': "import { wave } from '@acme/sea/src/wave';\nexport const surf = wave();\n",
    } : {}),
    // Kibana's shape, uninstalled: a package with no entry, nested where nothing links it, so the index resolves no file for its name.
    ...(question[2] === 'Schedule' || question[2] === 'Cadence' ? {
      'package.json': JSON.stringify({ private: true, workspaces: ['packages/*', 'packages/reporting/server', 'apps/*'] }),
      'packages/reporting/server/package.json': JSON.stringify({ name: '@acme/reporting-server' }),
      // The entry passes one name on by name, as Kibana's do, and the rest through `export *`.
      'packages/reporting/server/index.ts': "export * from './constants';\nexport { Cadence } from './cadence';\n",
      'packages/reporting/server/cadence.ts': 'export const Cadence = 1;\n',
      'packages/reporting/server/plan.ts': "import { Cadence } from './cadence';\nexport const plan = Cadence;\n",
      'apps/app/src/cadence.ts': "import { Cadence } from '@acme/reporting-server';\nexport const every = Cadence;\n",
      'packages/reporting/server/constants.ts': 'export enum Schedule { Once }\n',
      'apps/app/src/schedule.ts': "import { Schedule } from '@acme/reporting-server';\nexport const once = Schedule.Once;\n",
    } : {}),
    ...(question[2] === 'lost' ? {
      'packages/kit/src/lost.ts': 'export const lost = 1;\n',
      'apps/app/src/found.ts': "import { lost } from '@acme/kit/src/lost';\nexport const found = lost;\n",
      'apps/app/src/stray.ts': "import { lost } from '@acme/kit/src/gone';\nexport const stray = lost;\n",
      'apps/app/src/elsewhere.ts': "import { lost } from '@acme/kit/src/orphan';\nexport const elsewhere = lost;\n",
      'packages/kit/src/barrel.ts': "export * from './lost';\n",
      'apps/app/src/through.ts': "import { lost } from '@acme/kit/src/barrel';\nexport const through = lost;\n",
    } : {}),
    // More imports by path of one file, and more that reach no file, than `--limit` lists.
    ...(question[2] === 'crowdedPath' ? Object.fromEntries([
      ['packages/kit/src/crowd.ts', 'export const crowdedPath = 1;\n'],
      ...[1, 2, 3].map((at) => [`apps/app/src/crowd-${at}.ts`, `import { crowdedPath } from '@acme/kit/src/crowd';\nexport const crowd${at} = crowdedPath;\n`]),
      ...[1, 2, 3].map((at) => [`apps/app/src/gone-${at}.ts`, `import { crowdedPath } from '@acme/kit/src/gone';\nexport const gone${at} = crowdedPath;\n`]),
    ]) : {}),
    'packages/lib/src/session.ts':'interface AgentSession { sessionToken: string }\ninterface SavedSession { sessionToken: number }\nexport function tokenOf(session: AgentSession) { return session.sessionToken; }\n',
    // A file that passes a name on from a file that is not there: an export the index binds to no declaration.
    ...(question[2] === 'unbound' ? {
      'packages/kit/src/relay.ts': "export { unbound } from './nowhere';\n",
      'packages/kit/src/unbound.ts': 'export const unbound = 1;\n',
      'apps/app/src/relayed.ts': "import { unbound } from '@acme/kit/src/relay';\nexport const relayed = unbound;\n",
    } : {}),
    ...(question[2] === 'packages/lib/src/greet.ts,packages/lib/src/index.ts' ? {
      'apps/app/src/bridge.ts': "export { hello } from './hello.js';\n",
      'apps/app/src/outer-a.ts': "import { hello } from './bridge.js';\nexport const a = hello;\n",
      'apps/app/src/outer-b.ts': "import { hello } from './bridge.js';\nexport const b = hello;\n",
    } : {}),
  };
}
