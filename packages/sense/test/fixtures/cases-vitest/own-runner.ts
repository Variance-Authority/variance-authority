import { VitestTestRunner } from 'vitest/runners';

// A runner of the project's own, which the seam leaves in place of its case runner.
export default class OwnRunner extends VitestTestRunner {}
