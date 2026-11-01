import { register } from './registry.js';

// Registers itself into a module already loaded, as it loads.
register('plugin', 'loaded');
