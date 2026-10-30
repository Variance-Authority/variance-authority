import { TestRunner } from 'vitest';

// A runner of the project's own, which the seam leaves in place of its case runner.
export default class OwnRunner extends TestRunner {}
