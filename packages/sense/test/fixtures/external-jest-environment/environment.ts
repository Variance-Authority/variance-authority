import { TestEnvironment } from 'jest-environment-node';
import { read } from './src/shared.js';
import data from './src/environment-data.json';
import { setting } from './src/environment-only.js';
export default class Environment extends TestEnvironment {
  constructor(config: ConstructorParameters<typeof TestEnvironment>[0], context: ConstructorParameters<typeof TestEnvironment>[1]) {
    super(config, context);
    this.global.environmentValue = read(data.value === setting() ? setting() : 'invalid');
  }
}
