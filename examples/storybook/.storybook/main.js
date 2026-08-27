import { jsxSource } from '@variance-authority/jsx-source/vite';

export default {
  stories: ['../src/**/*.stories.jsx'],
  framework: { name: '@storybook/react-vite', options: {} },

  viteFinal: async (config) => ({
    ...config,

    // A built Storybook is minified: the browser knows your component as `V`,
    // not `Button`. This plugin stamps every element with the file and line
    // that wrote it — the one identifier a bundler cannot rename.
    plugins: [...(config.plugins ?? []), jsxSource()],

    // `jsxDev` is what the plugin hooks. `jsx: 'automatic'` is only here
    // because this example ships no tsconfig; a real project already compiles
    // JSX this way and needs neither line.
    esbuild: { ...config.esbuild, jsx: 'automatic', jsxDev: true },
  }),
};
