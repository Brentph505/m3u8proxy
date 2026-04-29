/**
 * Deno Deploy Edge Function Handler
 * This runs on Deno Deploy (https://dash.deno.com)
 * 
 * Setup:
 * 1. Create a project on dash.deno.com
 * 2. Point it to this file: src/deno-deploy.js
 * 3. Deploy!
 */

// Dynamic base URL - set per request
let web_server_url = "";

/**
 * Make HTTP request using Deno fetch
 */
async function fetchUrl(url, options = {}) {
  const response = await fetch(url, {
    headers: options.headers || {},
  });

  if (!response.ok && response.status !== 404) {
    throw new Error(`HTTP ${response.status}`);
  }

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
}

/**
 * Process m3u8 content - rewrite URLs to proxy
 */
function processM3U8Content(m3u8Content, baseUrl, headers = {}) {
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
        // Use m3u8-proxy for playlist URLs, ts-proxy for segments
        const isTsSegment = line.endsWith(".ts") || line.includes(".ts?");
        const proxyPath = isTsSegment ? "/ts-proxy" : "/m3u8-proxy";
        newLines.push(
          `${web_server_url}${proxyPath}?url=${encodeURIComponent(uri.href)}&headers=${encodeURIComponent(JSON.stringify(headers))}`
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
 * Handle m3u8 proxy request
 */
async function handleM3U8Proxy(url, headers = {}) {
  try {
    const response = await fetchUrl(url, { headers });
    const m3u8Content = response.data;

    const processedContent = processM3U8Content(m3u8Content, url, headers);

    return {
      status: 200,
      body: processedContent,
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
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
 * Handle TS segment proxy request
 */
async function handleTSProxy(url, headers = {}) {
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
 * Parse query parameters
 */
function parseQueryParams(queryString) {
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
 * Route request to appropriate handler
 */
async function routeRequest(pathname, queryString, headers = {}) {
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
</head>
<body>
  <h1>🎬 M3U8 Proxy Server</h1>
  <p>Running on Deno Deploy</p>
  <p>Use: <code>/m3u8-proxy?url=&lt;URL&gt;&headers=&lt;JSON&gt;</code></p>
</body>
</html>`;
}

// Deno Deploy handler
Deno.serve(async (req) => {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const queryString = url.search.slice(1);

  // Set the base URL for this request (for URL rewriting in m3u8)
  web_server_url = `${url.protocol}//${url.host}`;

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