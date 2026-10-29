// Single source of truth for the core version. Kept in its own module so that a surface
// (server, CLI) can read it without importing the whole public barrel — which would also
// load the test suites as a side effect.
export const CIEL_VERSION = '0.2.0';
