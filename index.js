const http = require("http");

const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");

const STRIP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

const server = http.createServer(async (req, res) => {
  if (!TARGET_BASE) {
    res.writeHead(500);
    return res.end("Misconfigured: TARGET_DOMAIN is not set");
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const targetUrl = TARGET_BASE + url.pathname + url.search;

    const headers = {};
    let clientIp = null;

    for (const key in req.headers) {
      const k = key.toLowerCase();
      const value = req.headers[key];

      if (STRIP_HEADERS.has(k)) continue;

      if (k === "x-real-ip") {
        clientIp = value;
        continue;
      }

      if (k === "x-forwarded-for") {
        if (!clientIp) clientIp = value;
        continue;
      }

      headers[k] = value;
    }

    if (clientIp) {
      headers["x-forwarded-for"] = clientIp;
    }

    const options = {
      method: req.method,
      headers,
    };

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : req,
    });

    res.writeHead(upstream.status, Object.fromEntries(upstream.headers));

    if (upstream.body) {
      const reader = upstream.body.getReader();
      const pump = async () => {
        const { done, value } = await reader.read();
        if (done) return res.end();
        res.write(value);
        pump();
      };
      pump();
    } else {
      res.end();
    }
  } catch (err) {
    res.writeHead(502);
    res.end("Bad Gateway: Tunnel Failed");
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Proxy running on port", PORT);
});
