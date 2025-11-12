/**
 * Global setup file that runs before any test files are loaded
 * Used to stub browser APIs that aren't available in Node.js
 */

// Stub localStorage before any modules are loaded
// Must be defined as actual methods, not arrow functions
globalThis.localStorage = {
  getItem: function() { return null; },
  setItem: function() {},
  removeItem: function() {},
  clear: function() {},
  key: function() { return null; },
  length: 0,
} as Storage;
