/**
 * Simplified Node.js HTTP Server for M3U8 Proxy
 * Uses the platform-agnostic proxyCore module
 */

import http from "node:http";
import dotenv from "dotenv";
import colors from "colors";
import { routeRequest, parseQueryParams } from "./proxyCore.js";

dotenv.config();

const host = process.env.HOST || "127.0.0.1";
const port = process.env.PORT || 8080;
const web_server_url = process.env.PUBLIC_URL || `http://${host}:${port}`;

export default function createSimpleServer() {
  const server = http.createServer(async (req, res) => {
    // CORS headers
    const setDefaultHeaders = () => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "*");
    };

    // Handle OPTIONS
    if (req.method === "OPTIONS") {
      setDefaultHeaders();
      res.writeHead(204);
      res.end();
      return;
    }

    // Only handle GET
    if (req.method !== "GET") {
      setDefaultHeaders();
      res.writeHead(405, { "Content-Type": "text/plain" });
      res.end("Method Not Allowed");
      return;
    }

    try {
      const url = new URL(req.url, `http://${host}:${port}`);
      const pathname = url.pathname;
      const queryString = url.search.slice(1);

      // Extract headers
      const headers = {
        referer: req.headers.referer || "",
        origin: req.headers.origin || "",
        ...req.headers,
      };

      // Route the request
      const result = await routeRequest(pathname, queryString, headers);

      // Set response headers
      setDefaultHeaders();
      Object.entries(result.headers || {}).forEach(([key, value]) => {
        res.setHeader(key, value);
      });

      res.writeHead(result.status);

      // Send response
      if (result.isArrayBuffer) {
        res.end(Buffer.from(result.body));
      } else {
        res.end(result.body);
      }
    } catch (err) {
      console.error("Error:", err);
      setDefaultHeaders();
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(`Internal Server Error: ${err.message}`);
    }
  });

  server.listen(port, host, () => {
    console.log(
      colors.green("🚀 M3U8 Proxy Server running on ") +
        colors.blue(`${web_server_url}`)
    );
  });

  return server;
}

// Auto-start if running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  createSimpleServer();
}
