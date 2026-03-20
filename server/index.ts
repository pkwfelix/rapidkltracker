import express from "express";
import cors from "cors";
import { POLL_INTERVAL_MS, SERVER_PORT } from "./config.js";
import { loadProto, pollAll } from "./poller.js";
import router from "./routes.js";

async function start(): Promise<void> {
  await loadProto();
  await pollAll();
  setInterval(pollAll, POLL_INTERVAL_MS);

  const app = express();
  app.use(cors());
  app.use("/api", router);

  app.listen(SERVER_PORT, () => {
    console.log(`[server] Listening on http://localhost:${SERVER_PORT}`);
  });
}

start().catch(err => {
  console.error("[server] Fatal:", err);
  process.exit(1);
});
