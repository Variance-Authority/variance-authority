// The extractor in a plain Rspack build, as a Storybook built by Rspack runs
// it: SWC, then the extractor, then the probes at `enforce: 'post'` from the
// rule `testSelectionRule` writes. The entry is a virtual module at the root,
// as Storybook's `storybook-config-entry.js` is: no file on disk holds it.
// Builds into the directory named by the first argument.
import { fileURLToPath } from 'node:url';
import { rspack } from '@rspack/core';
import { testSelectionRule } from '@variance-authority/sense/journal';

const root = fileURLToPath(new URL('.', import.meta.url));
const output = process.argv[2];
if (output === undefined) throw new Error('the output directory is required');
// Where the probes go: after the project's loaders unless the test asks for before.
const placement = process.env['VARIANCE_AUTHORITY_PLACEMENT'];

const compiler = rspack({
  mode: 'development',
  context: root,
  entry: './virtual-entry.js',
  target: 'web',
  devtool: 'source-map',
  output: { path: output, filename: 'page.js' },
  resolve: { extensions: ['.ts', '.js'] },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: [
          { loader: fileURLToPath(new URL('./extract-loader.cjs', import.meta.url)) },
          { loader: 'builtin:swc-loader', options: { jsc: { parser: { syntax: 'typescript' }, target: 'es2022' } } },
        ],
      },
      // A function: it crosses into Rspack's core as data, so the rule carries a key to it.
      testSelectionRule({ root, include: (file) => file.startsWith(root), ...(placement === undefined ? {} : { placement }) }),
    ],
  },
  plugins: [
    new rspack.experiments.VirtualModulesPlugin({
      './virtual-entry.js': "import { label } from './src/tone.ts';\nglobalThis.pressed = label(true);\n",
    }),
  ],
});

compiler.run((error, stats) => {
  if (error) throw error;
  if (stats.hasErrors()) {
    process.stderr.write(stats.toString({ all: false, errors: true }));
    process.exitCode = 1;
  }
  compiler.close(() => {});
});
