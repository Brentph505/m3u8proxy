/**
 * Core proxy logic - platform agnostic
 * Used by both Deno Deploy and Node.js servers
 */

import axios from "axios";

// Get environment variable in a runtime-agnostic way
function getEnv(key, defaultValue) {
  if (typeof process !== "undefined" && process.env) {
    return process.env[key] || defaultValue;
  }
  if (typeof Deno !== "undefined") {
    return Deno.env.get(key) || defaultValue;
  }
  return defaultValue;
}

const host = getEnv("HOST", "127.0.0.1");
const port = getEnv("PORT", "8080");
const web_server_url =
  getEnv("PUBLIC_URL", "") || `http://${host}:${port}`;

/**
 * Make HTTP request - compatible with both Node.js and Deno
 */
async function fetchUrl(url, options = {}) {
  try {
    if (typeof Deno !== "undefined") {
      // Deno: use fetch
      const response = await fetch(url, {
        headers: options.headers || {},
      });

      if (!response.ok && response.status !== 404) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type") || "";
      if (options.responseType === "arraybuffer") {
        return {
          data: await response.arrayBuffer(),
          status: response.status,
        };
      }

      return {
        data: await response.text(),
        status: response.status,
      };
    } else {
      // Node.js: use axios
      return await axios.get(url, {
        headers: options.headers || {},
        responseType: options.responseType,
      });
    }
  } catch (err) {
    throw new Error(
      `Failed to fetch ${url}: ${err.message}`
    );
  }
}

/**
 * Fetch and process m3u8 playlist
 */
export async function handleM3U8Proxy(url, headers = {}) {
  try {
    const response = await fetchUrl(url, { headers });
    const m3u8Content = response.data;

    const processedContent = processM3U8Content(m3u8Content, url, headers);

    return {
      status: 200,
      body: processedContent,
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "*",
      },
    };
  } catch (err) {
    return {
      status: 500,
      body: `Error fetching m3u8: ${err.message}`,
      headers: { "Content-Type": "text/plain" },
    };
  }
}

/**
 * Process m3u8 content - rewrite URLs to proxy
 */
export function processM3U8Content(m3u8Content, baseUrl, headers = {}) {
  const lines = m3u8Content.split("\n");
  const newLines = [];

  for (const line of lines) {
    if (line.startsWith("#")) {
      // Handle tags with URI attribute
      if (line.includes("URI=") || /https?:\/\//.test(line)) {
        if (line.includes("URI=")) {
          const regex = /URI="([^"]+)"|URI=([^\s,]+)/g;
          let processedLine = line;
          let match;
          const lineRegex = new RegExp(regex);
          while ((match = lineRegex.exec(line)) !== null) {
            const uriValue = match[1] || match[2];
            try {
              const uri = new URL(uriValue, baseUrl);
              const proxiedUrl = `${web_server_url}/ts-proxy?url=${encodeURIComponent(uri.href)}&headers=${encodeURIComponent(JSON.stringify(headers))}`;
              processedLine = processedLine.replace(uriValue, proxiedUrl);
            } catch (e) {
              // Keep original if URL parsing fails
            }
          }
          newLines.push(processedLine);
        } else {
          const regex = /https?:\/\/[^\""\s]+/g;
          const match = line.match(regex);
          if (match) {
            const proxiedUrl = `${web_server_url}/ts-proxy?url=${encodeURIComponent(match[0])}&headers=${encodeURIComponent(JSON.stringify(headers))}`;
            newLines.push(line.replace(regex, proxiedUrl));
          } else {
            newLines.push(line);
          }
        }
      } else {
        newLines.push(line);
      }
    } else if (line.trim()) {
      // Non-comment, non-empty lines are URLs/paths
      try {
        const uri = new URL(line, baseUrl);
        newLines.push(
          `${web_server_url}/m3u8-proxy?url=${encodeURIComponent(uri.href)}&headers=${encodeURIComponent(JSON.stringify(headers))}`
        );
      } catch (e) {
        newLines.push(line);
      }
    } else {
      newLines.push(line);
    }
  }

  return newLines.join("\n");
}

/**
 * Fetch and proxy TS segment
 */
export async function handleTSProxy(url, headers = {}) {
  try {
    const response = await fetchUrl(url, {
      headers,
      responseType: "arraybuffer",
    });

    return {
      status: 200,
      body: response.data,
      headers: {
        "Content-Type": "video/mp2t",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "*",
      },
      isArrayBuffer: true,
    };
  } catch (err) {
    return {
      status: 500,
      body: `Error fetching TS: ${err.message}`,
      headers: { "Content-Type": "text/plain" },
    };
  }
}

/**
 * Parse query parameters (platform agnostic)
 */
export function parseQueryParams(queryString) {
  const params = {};
  if (!queryString) return params;

  const pairs = queryString.split("&");
  for (const pair of pairs) {
    const [key, value] = pair.split("=");
    if (key) {
      params[decodeURIComponent(key)] = value
        ? decodeURIComponent(value)
        : "";
    }
  }
  return params;
}

/**
 * Route handler - determines which action to take
 */
export async function routeRequest(pathname, queryString, headers = {}) {
  const params = parseQueryParams(queryString);

  if (pathname === "/m3u8-proxy") {
    const url = params.url;
    const reqHeaders = params.headers ? JSON.parse(params.headers) : {};
    return handleM3U8Proxy(url, reqHeaders);
  }

  if (pathname === "/ts-proxy") {
    const url = params.url;
    const reqHeaders = params.headers ? JSON.parse(params.headers) : {};
    return handleTSProxy(url, reqHeaders);
  }

  if (pathname === "/" || pathname === "") {
    return {
      status: 200,
      body: getIndexHTML(),
      headers: { "Content-Type": "text/html" },
    };
  }

  // Handle direct .m3u8 and .ts requests
  if (pathname.endsWith(".m3u8") || pathname.endsWith(".ts")) {
    const referer = headers.referer || "";
    let attemptUrl = null;
    let attemptHeaders = {};

    if (referer && referer.includes("?url=")) {
      const match = referer.match(/[?&]url=([^&]+)(?:&|$)/);
      const headersMatch = referer.match(/[?&]headers=([^&]+)(?:&|$)/);

      if (match) {
        try {
          const baseUrl = decodeURIComponent(match[1]);
          const basePath = new URL(baseUrl).href.substring(
            0,
            new URL(baseUrl).href.lastIndexOf("/") + 1
          );
          attemptUrl = new URL(pathname.slice(1), basePath).href;

          if (headersMatch) {
            attemptHeaders = JSON.parse(decodeURIComponent(headersMatch[1]));
          }
        } catch (e) {
          // Silently fail
        }
      }
    }

    if (!attemptUrl) {
      if (!pathname.slice(1).includes("://")) {
        attemptUrl = "https://" + pathname.slice(1);
      } else {
        attemptUrl = pathname.slice(1);
      }
    }

    if (pathname.endsWith(".m3u8")) {
      return handleM3U8Proxy(attemptUrl, attemptHeaders);
    } else if (pathname.endsWith(".ts")) {
      return handleTSProxy(attemptUrl, attemptHeaders);
    }
  }

  return {
    status: 404,
    body: "Not Found",
    headers: { "Content-Type": "text/plain" },
  };
}

function getIndexHTML() {
  return `<!DOCTYPE html>
<html>
<head>
  <title>M3U8 Proxy</title>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 900px;
      margin: 50px auto;
      padding: 20px;
      background: #f5f5f5;
    }
    .container {
      background: white;
      padding: 30px;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    h1 { color: #333; }
    code {
      background: #f0f0f0;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: monospace;
    }
    .example {
      background: #f9f9f9;
      padding: 15px;
      border-left: 3px solid #007bff;
      margin: 15px 0;
      overflow-x: auto;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎬 M3U8 Proxy Server</h1>
    <p>This is a proxy server for HLS/M3U8 playlists. Use it to proxy m3u8 files with custom headers.</p>
    
    <h2>Usage</h2>
    <p>Make a request to <code>/m3u8-proxy</code> or <code>/ts-proxy</code> with URL and headers parameters:</p>
    
    <div class="example">
      <code>/m3u8-proxy?url=&lt;URL&gt;&headers=&lt;JSON&gt;</code>
    </div>
    
    <h2>Example</h2>
    <div class="example">
      <code>/m3u8-proxy?url=https://example.com/playlist.m3u8&headers={"Referer":"https://example.com"}</code>
    </div>
    
    <p><strong>Status:</strong> ✅ Running</p>
  </div>
</body>
</html>`;
}
