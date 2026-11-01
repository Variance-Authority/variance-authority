import { isolateEnv, isolateGlobals, isolateListeners, isolateTimers, nextSession } from '@variance-authority/isolator';
import { next } from './counter';

isolateTimers();
isolateListeners();
isolateGlobals();
isolateEnv();

export { next, nextSession };
