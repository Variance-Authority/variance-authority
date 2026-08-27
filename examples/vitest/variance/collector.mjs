import { captureCollector } from '@variance-authority/unit-test';

// Reads what the unit tests wrote. Two tests writing the same subject id is an
// error rather than a last-write-wins, because picking one silently would make
// half the suite invisible.
export default captureCollector({ directory: '.variance/captures' });
