// Lists every open TCP port on the runner's loopback, as seen from inside the
// sandbox. Loopback refuses closed ports at once, so a full sweep is quick.
import * as net from "node:net";

const tryPort = (host, port) =>
  new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (open) => { s.destroy(); resolve(open); };
    s.setTimeout(300, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });

for (const host of ["127.0.0.1", "::1"]) {
  const open = [];
  const started = Date.now();
  for (let base = 1; base <= 65535; base += 500) {
    const ports = Array.from({ length: Math.min(500, 65536 - base) }, (_, i) => base + i);
    const results = await Promise.all(ports.map((p) => tryPort(host, p)));
    ports.forEach((p, i) => results[i] && open.push(p));
  }
  console.log(`open ports on ${host}: ${open.join(", ") || "none"} (${Date.now() - started}ms)`);
}
