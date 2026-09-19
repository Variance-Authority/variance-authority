import { captureCollector } from '@variance-authority/unit-test';

const directory = process.env.VARIANCE_CAPTURE_DIRECTORY;
if (!directory) throw new Error('VARIANCE_CAPTURE_DIRECTORY is required');

export default captureCollector({ directory });
