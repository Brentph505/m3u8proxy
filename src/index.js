import { IS_DENO, IS_NODE } from "./lib/runtime.js";

if (IS_NODE) {
  // Node.js - use HTTP server
  import("./lib/server.js").then((module) => {
    module.default();
  });
} else if (IS_DENO) {
  // Deno - use Deno.serve
  import("./deno-deploy.js");
} else {
  console.error("Unknown runtime environment");
  process.exit(1);
}