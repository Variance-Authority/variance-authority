// The reset driver goes first: a module imported before it would register too early.
const { configureResetHandler } = require('@variance-authority/ioc/reset/setup');

configureResetHandler(beforeEach);
