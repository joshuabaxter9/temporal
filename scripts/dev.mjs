import { connect } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const compose = spawnSync("docker", ["compose", "up", "-d", "temporal"], {
  stdio: "inherit",
});
if (compose.status !== 0) {
  console.error("\nCould not start Temporal. Is Docker Desktop running?");
  process.exit(compose.status ?? 1);
}

async function waitForPort(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await new Promise((resolve) => {
      const socket = connect({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Temporal did not become ready on port ${port}.`);
}

// Temporal opens its port before the gRPC frontend is ready — on a fresh
// volume the gap can be several seconds — so wait until a real call succeeds
// rather than letting the Worker's first connection be reset.
async function waitForTemporal(timeoutMs = 90_000) {
  const { Connection } = await import("@temporalio/client");
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const connection = await Connection.connect({ address: "127.0.0.1:7233" });
      await connection.close();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`Temporal did not answer within ${timeoutMs / 1000}s: ${lastError?.message ?? lastError}`);
}

await waitForPort(7233);
await waitForTemporal();

// Spawn tsx directly (not via `npm run`) so a SIGTERM reaches the real process
// and nothing is left holding port 3000 after shutdown.
const tsx = createRequire(import.meta.url).resolve("tsx/cli");
const children = [
  spawn(process.execPath, [tsx, "src/worker.ts"], { stdio: "inherit" }),
  spawn(process.execPath, [tsx, "src/api.ts"], { stdio: "inherit" }),
];
let shuttingDown = false;
function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  process.exit(exitCode);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
for (const child of children) {
  child.once("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(`A development process stopped (${signal ?? code}).`);
      shutdown(code ?? 1);
    }
  });
}
console.log("\nJuniper Salon is launching:");
console.log("  Staff app:   http://localhost:3000");
console.log("  Temporal UI: http://localhost:8233\n");
