// Spike for "Test a Claude credential relay outside the bwrap sandbox".
// Not factory code: it is thrown away once the findings are recorded.
//
// A credential relay: the agent talks to it with a stand-in token, and it
// forwards to api.anthropic.com with the real one. The real token arrives on
// stdin, so it is never in this process's environment or argv.
//
//   printf %s "$TOKEN" | node relay.mjs <oauth|apikey> <port>
//
// Only the path of each request is kept. The upstream host is fixed, so a
// Host header, an absolute-form URL or a "//host" path can't redirect it.
import * as http from "node:http";
import * as https from "node:https";

const [mode, port = "8787"] = process.argv.slice(2);
if (mode !== "oauth" && mode !== "apikey") {
  console.error("usage: relay.mjs <oauth|apikey> [port]");
  process.exit(2);
}

const UPSTREAM = "api.anthropic.com";
const ALLOWED = [/^\/v1\//, /^\/api\//];
const OAUTH_BETA = "oauth-2025-04-20";
const DROP = new Set(["host", "authorization", "x-api-key", "connection", "proxy-authorization", "proxy-connection", "keep-alive", "transfer-encoding", "upgrade"]);

const readStdin = async () => {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data.trim();
};

const token = await readStdin();
if (!token) {
  console.error("relay: no token on stdin");
  process.exit(2);
}

const credentialHeaders = (incoming) => {
  if (mode === "apikey") return { "x-api-key": token };
  const betas = new Set(String(incoming["anthropic-beta"] ?? "").split(",").map((b) => b.trim()).filter(Boolean));
  betas.add(OAUTH_BETA);
  return { authorization: `Bearer ${token}`, "anthropic-beta": [...betas].join(",") };
};

const refuse = (res, status, message) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ type: "error", error: { type: "relay_error", message } }));
};

const server = http.createServer((req, res) => {
  const started = Date.now();
  // Absolute-form ("GET http://x/ HTTP/1.1") and "//host/..." are refused,
  // never parsed for a host.
  const raw = req.url ?? "";
  const path = raw.startsWith("/") && !raw.startsWith("//") ? raw : null;
  const log = (status) => console.log(`${new Date().toISOString()} ${req.method} ${JSON.stringify(raw.slice(0, 120))} -> ${status} ${Date.now() - started}ms`);

  if (path === null || !ALLOWED.some((re) => re.test(path)) || path.includes("/../") || path.includes("\\")) {
    log(404);
    return refuse(res, 404, "not relayed");
  }

  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (!DROP.has(name)) headers[name] = value;
  }
  Object.assign(headers, credentialHeaders(req.headers), { host: UPSTREAM });

  const upstream = https.request({ host: UPSTREAM, port: 443, method: req.method, path, headers }, (up) => {
    log(up.statusCode);
    res.writeHead(up.statusCode ?? 502, up.headers);
    up.pipe(res);
  });
  // Errors name no header or value: only a generic message goes back.
  upstream.on("error", () => {
    log(502);
    if (!res.headersSent) refuse(res, 502, "upstream unreachable");
    else res.destroy();
  });
  req.pipe(upstream);
});

server.listen(Number(port), "127.0.0.1", () => console.log(`relay ready on 127.0.0.1:${port} mode=${mode}`));
