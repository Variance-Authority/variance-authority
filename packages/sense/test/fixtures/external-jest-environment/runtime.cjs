// A project's own runtime: Jest constructs it with the environment it built.
const Runtime = require('jest-runtime').default;
module.exports = class ProjectRuntime extends Runtime {
  constructor(config, environment, ...rest) {
    super(config, environment, ...rest);
    environment.global.projectRuntime = true;
  }
};
