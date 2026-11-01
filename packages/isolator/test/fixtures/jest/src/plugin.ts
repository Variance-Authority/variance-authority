import { register } from './registry';

// Registers itself into a module already loaded, as it loads.
register('plugin', 'loaded');
