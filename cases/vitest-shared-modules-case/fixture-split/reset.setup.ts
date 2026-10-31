import { beforeEach } from 'vitest';
import { configureResetHandler } from '@variance-authority/ioc/reset/setup';

// Vitest runs a setup file again for every test file, on a module graph it
// keeps under `isolate: false`: from the second file on, the application
// modules have already registered their handlers with the driver this installed.
configureResetHandler(beforeEach);
