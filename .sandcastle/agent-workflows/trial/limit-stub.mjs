// Trial probe: a stand-in for the credential relay that answers every
// request the way Anthropic answers a subscription over its usage limit, so a
// real Claude Code run inside bwrap() hits a forced limit. It holds no token
// and calls nothing. Start it in place of the relay:
//   node limit-stub.mjs > "$RUNNER_TEMP/limit-stub.log" 2>&1 &
import * as http from "node:http";
import { relayPort } from "../shared/relay.mjs";

const resetMinutes = 15;

const clockTime = (date) => {
  const hours = date.getUTCHours();
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${hours % 12 === 0 ? 12 : hours % 12}:${minutes}${hours < 12 ? "am" : "pm"}`;
};

http
  .createServer((req, res) => {
    req.resume();
    const reset = new Date(Date.now() + resetMinutes * 60_000);
    const seconds = Math.floor(reset.getTime() / 1000);
    console.log(`${req.method} ${JSON.stringify((req.url ?? "").slice(0, 120))} -> 429`);
    res.writeHead(429, {
      "content-type": "application/json",
      "request-id": "req_trial_probe",
      "retry-after": String(resetMinutes * 60),
      "x-should-retry": "false",
      "anthropic-ratelimit-unified-status": "rejected",
      "anthropic-ratelimit-unified-reset": String(seconds),
      "anthropic-ratelimit-unified-5h-status": "rejected",
      "anthropic-ratelimit-unified-5h-reset": String(seconds),
      "anthropic-ratelimit-unified-representative-claim": "five_hour",
    });
    res.end(
      JSON.stringify({
        type: "error",
        error: { type: "rate_limit_error", message: `You've hit your session limit · resets ${clockTime(reset)}` },
      })
    );
  })
  .listen(relayPort, "127.0.0.1", () => console.log(`limit stub ready on 127.0.0.1:${relayPort}`));
