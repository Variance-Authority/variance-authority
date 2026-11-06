import { TestEnvironment } from 'jest-environment-node';
import { setting } from '../src/environment-only.js';
export default class Environment extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    this.global.environmentValue = setting();
  }
}
