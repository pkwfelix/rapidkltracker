import path from "path";
import { fileURLToPath } from "url";

export const POLL_INTERVAL_MS = 30_000;
export const SERVER_PORT = 3001;

/**
 * Absolute path to the bundled gtfs-realtime.proto schema file.
 * Must use fileURLToPath so Windows paths are resolved correctly —
 * new URL(...).pathname returns "/C:/..." on Windows which doubles the
 * drive letter when passed to fs/protobufjs APIs.
 */
export const PROTO_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "gtfs-realtime.proto",
);

/**
 * Allowed CORS origin. Set ALLOWED_ORIGIN in the environment for production.
 * Defaults to the Astro dev server so local development works out of the box.
 */
export const ALLOWED_ORIGIN: string =
  process.env.ALLOWED_ORIGIN ?? "http://localhost:4321";
