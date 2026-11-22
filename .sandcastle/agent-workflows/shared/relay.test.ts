import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createRelay } from "./relay.mjs";

type Seen = { method?: string; url?: string; headers: http.IncomingHttpHeaders; body: string };

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

const listen = async (server: http.Server): Promise<number> => {
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return (server.address() as AddressInfo).port;
};

const fakeAnthropic = async () => {
  const seen: Seen[] = [];
  const port = await listen(
    http.createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"type":"message"}');
    })
  );
  return { seen, upstream: { protocol: "http:", host: "127.0.0.1", port } } as const;
};

const startRelay = async (credential: "subscription" | "api-key") => {
  const anthropic = await fakeAnthropic();
  const relay = createRelay({ token: "sk-ant-oat01-real", credential, upstream: anthropic.upstream });
  const port = await listen(relay);
  return { ...anthropic, port };
};

const send = async (
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: string }> =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers }, async (res) => {
      let body = "";
      for await (const chunk of res) body += chunk;
      resolve({ status: res.statusCode ?? 0, body });
    });
    req.on("error", reject);
    req.end(method === "POST" ? '{"model":"m"}' : undefined);
  });

describe("the credential relay", () => {
  it("forwards POST /v1/messages with the subscription token in place of the stand-in", async () => {
    const { seen, port } = await startRelay("subscription");

    const response = await send(port, "POST", "/v1/messages?beta=true", {
      authorization: "Bearer stand-in",
      "anthropic-beta": "fine-grained-tool-streaming-2025-05-14",
    });

    expect(response).toEqual({ status: 200, body: '{"type":"message"}' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: "POST", url: "/v1/messages?beta=true", body: '{"model":"m"}' });
    expect(seen[0]!.headers.authorization).toBe("Bearer sk-ant-oat01-real");
    expect(seen[0]!.headers["anthropic-beta"]).toBe(
      "fine-grained-tool-streaming-2025-05-14,oauth-2025-04-20"
    );
    expect(seen[0]!.headers["x-api-key"]).toBeUndefined();
  });

  it("forwards with the API key as x-api-key when budget.yml names api-key", async () => {
    const { seen, port } = await startRelay("api-key");

    await send(port, "POST", "/v1/messages", { authorization: "Bearer stand-in" });

    expect(seen[0]!.headers["x-api-key"]).toBe("sk-ant-oat01-real");
    expect(seen[0]!.headers.authorization).toBeUndefined();
  });

  it.each([
    ["GET", "/v1/messages"],
    ["PUT", "/v1/messages"],
    ["POST", "/v1/messages/count_tokens"],
    ["POST", "/v1/models"],
    ["POST", "/api/oauth/usage"],
    ["POST", "/v1/messages/../complete"],
    ["POST", "//evil.example/v1/messages"],
    ["POST", "http://evil.example/v1/messages"],
    ["POST", "/v1/messages\\x"],
  ])("refuses %s %s without calling Anthropic", async (method, path) => {
    const { seen, port } = await startRelay("subscription");

    const response = await send(port, method, path);

    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toEqual({
      type: "error",
      error: { type: "relay_error", message: "not relayed" },
    });
    expect(response.body).not.toContain("sk-ant-oat01-real");
    expect(seen).toEqual([]);
  });
});
