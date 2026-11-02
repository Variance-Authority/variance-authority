import { isolateEnv, isolateGlobals, isolateTimers, nextSession } from '@variance-authority/isolator';
import { next } from './counter';

isolateTimers();
isolateGlobals();
isolateEnv();

export { next, nextSession };
