import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import { pathToFileURL } from "node:url";

const anthropic = { protocol: "https:", host: "api.anthropic.com", port: 443 };
const oauthBeta = "oauth-2025-04-20";
const droppedHeaders = new Set(["host", "authorization", "x-api-key", "connection", "proxy-authorization", "proxy-connection", "keep-alive", "transfer-encoding", "upgrade"]);

const credentialHeaders = (credential, token, incoming) => {
  if (credential === "api-key") return { "x-api-key": token };
  const betas = new Set(String(incoming["anthropic-beta"] ?? "").split(",").map((b) => b.trim()).filter(Boolean));
  betas.add(oauthBeta);
  return { authorization: `Bearer ${token}`, "anthropic-beta": [...betas].join(",") };
};

/** @type {readonly ["subscription", "api-key"]} */
export const credentials = ["subscription", "api-key"];

/** The form in which later host steps (the push guard) know the Claude token. */
export const claudeTokenHash = (token) => createHash("sha256").update(token).digest("hex");

const relayedPath = "/v1/messages";

const isRelayed = (method, url) => method === "POST" && url.split("?")[0] === relayedPath;

const refuse = (res, status, message) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ type: "error", error: { type: "relay_error", message } }));
};

/**
 * @param {{ token: string, credential: (typeof credentials)[number],
 *   upstream?: { protocol: "http:" | "https:", host: string, port: number } }} options
 */
export const createRelay = ({ token, credential, upstream = anthropic }) =>
  http.createServer((req, res) => {
    const started = Date.now();
    const url = req.url ?? "";
    const log = (status) =>
      console.log(`${req.method} ${JSON.stringify(url.slice(0, 120))} -> ${status} ${Date.now() - started}ms`);
    if (!isRelayed(req.method, url)) {
      log(404);
      return refuse(res, 404, "not relayed");
    }
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (!droppedHeaders.has(name)) headers[name] = value;
    }
    Object.assign(headers, credentialHeaders(credential, token, req.headers), { host: upstream.host });
    const client = upstream.protocol === "https:" ? https : http;
    const forwarded = client.request(
      { host: upstream.host, port: upstream.port, method: req.method, path: req.url, headers },
      (answer) => {
        log(answer.statusCode);
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      }
    );
    forwarded.on("error", () => {
      log(502);
      if (res.headersSent) res.destroy();
      else refuse(res, 502, "upstream unreachable");
    });
    req.pipe(forwarded);
  });

const readStdin = async () => {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data.trim();
};

const serve = async ([credential, port = "8787"]) => {
  if (!credentials.includes(credential)) {
    console.error(`usage: relay.mjs <${credentials.join("|")}> [port]`);
    process.exit(2);
  }
  const token = await readStdin();
  if (!token) {
    console.error("relay: no token on stdin");
    process.exit(2);
  }
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `claude-token-sha256=${claudeTokenHash(token)}
`);
  const relay = createRelay({ token, credential });
  relay.listen(Number(port), "127.0.0.1", () =>
    console.log(`relay ready on 127.0.0.1:${relay.address().port} credential=${credential}`)
  );
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await serve(process.argv.slice(2));
