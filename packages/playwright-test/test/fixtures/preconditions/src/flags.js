import { varianceBreadcrumb } from '@variance-authority/event';

// What the page's code reads, through the entry an application ships.
varianceBreadcrumb('flags', 'page', 'on'); // page read
varianceBreadcrumb('flags', 7, 'on'); // page misuse
globalThis.flagsRead = true;
