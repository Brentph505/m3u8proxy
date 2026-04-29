/**
 * Runtime detection - determines if running on Deno Deploy or Node.js
 */

export function getRuntime() {
  // Check for Deno
  if (typeof Deno !== "undefined") {
    return "deno";
  }

  // Check for Deno Deploy specifically
  if (typeof globalThis.Deno !== "undefined") {
    return "deno";
  }

  // Node.js
  if (typeof process !== "undefined" && process.versions?.node) {
    return "node";
  }

  return "unknown";
}

export const RUNTIME = getRuntime();
export const IS_DENO = RUNTIME === "deno";
export const IS_NODE = RUNTIME === "node";
