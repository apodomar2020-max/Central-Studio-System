import { spawn } from "node:child_process";
import path from "node:path";
import http from "node:http";
import { createRuntimeEnvironment } from "./database-role-boundaries.mjs";

const isWorker = process.env.QUEUE_WORKER_ENABLED === "true";
const scriptPath = isWorker
  ? path.resolve(import.meta.dirname, "../dist/worker.mjs")
  : path.resolve(import.meta.dirname, "../dist/index.mjs");

console.log(
  `[Railway Start Router] Starting ${isWorker ? "Queue Worker" : "API Server"}...`,
);

if (isWorker) {
  // Start dummy healthcheck server for Railway on PORT
  const port = process.env.PORT || 3000;
  const server = http.createServer((req, res) => {
    if (req.url === "/api/healthz" || req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "worker-healthcheck" }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(port, () => {
    console.log(
      `[Railway Start Router] Dummy healthcheck server listening on port ${port}`,
    );
  });
}

// The migration credential is deploy-time-only. Remove it before application
// code starts so an API/worker runtime compromise cannot read it from env.
const runtimeEnv = createRuntimeEnvironment(process.env);
delete process.env.MIGRATION_DATABASE_URL;

// Spawn the target script as a child process
const child = spawn("node", ["--enable-source-maps", scriptPath], {
  stdio: "inherit",
  env: runtimeEnv,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});

// Forward signals to child process
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
