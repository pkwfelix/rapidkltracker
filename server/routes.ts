import express from "express";
import type { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { readCache } from "./cache.js";
import { sseClients } from "./poller.js";
import type { Group } from "./types.js";

const router = express.Router();

router.use(
  rateLimit({
    windowMs: 60_000,
    max: 60,
    message: { error: "Too many requests" },
  })
);

router.get("/vehicles/:group", async (req: Request, res: Response) => {
  const group = req.params.group as Group;
  if (group !== "bus" && group !== "train") {
    res.status(400).json({ error: "Unknown group" });
    return;
  }
  const payload = await readCache(group);
  if (!payload) {
    res.status(503).json({ error: "Cache not ready yet" });
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.json(payload);
});

router.get("/events/:group", (req: Request, res: Response) => {
  const group = req.params.group as Group;
  if (group !== "bus" && group !== "train") {
    res.status(400).json({ error: "Unknown group" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ connected: true })}\n\n`);
  sseClients[group].add(res);

  req.on("close", () => {
    sseClients[group].delete(res);
  });
});

router.get("/health", async (_req: Request, res: Response) => {
  const status: Record<string, unknown> = {};
  for (const group of ["bus", "train"] as Group[]) {
    const payload = await readCache(group);
    if (payload) {
      status[group] = { updatedAt: payload.updatedAt, ageSeconds: Math.round((Date.now() - payload.updatedAt) / 1000) };
    } else {
      status[group] = null;
    }
  }
  res.json({ ok: true, cache: status });
});

export default router;
