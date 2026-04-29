/**
 * Deno Deploy Edge Function Handler
 * This runs on Deno Deploy (https://dash.deno.com)
 * 
 * Setup:
 * 1. Create a project on dash.deno.com
 * 2. Point it to this file: src/deno-deploy.js
 * 3. Deploy!
 */

import { routeRequest } from "./lib/proxyCore.js";

// Deno Deploy handler
Deno.serve(async (req) => {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const queryString = url.search.slice(1); // Remove leading ?

  // Extract headers from request
  const headers = {
    referer: req.headers.get("referer") || "",
    origin: req.headers.get("origin") || "",
  };

  try {
    const result = await routeRequest(pathname, queryString, headers);

    const responseHeaders = new Headers(result.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    responseHeaders.set("Access-Control-Allow-Headers", "*");

    // Handle OPTIONS
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: responseHeaders });
    }

    let responseBody = result.body;
    if (result.isArrayBuffer) {
      return new Response(responseBody, {
        status: result.status,
        headers: responseHeaders,
      });
    }

    return new Response(responseBody, {
      status: result.status,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error("Error:", err);
    const headers = new Headers({ "Content-Type": "text/plain" });
    return new Response(`Error: ${err.message}`, {
      status: 500,
      headers,
    });
  }
});

console.log("🚀 M3U8 Proxy running on Deno Deploy");
