import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Group, CachePayload } from "./types.js";

const CACHE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "cache");

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

export async function readCache(group: Group): Promise<CachePayload | null> {
  try {
    const raw = await fs.promises.readFile(path.join(CACHE_DIR, `${group}.json`), "utf8");
    return JSON.parse(raw) as CachePayload;
  } catch {
    return null;
  }
}

export async function writeCache(group: Group, payload: CachePayload): Promise<void> {
  try {
    await fs.promises.writeFile(
      path.join(CACHE_DIR, `${group}.json`),
      JSON.stringify(payload)
    );
  } catch (err) {
    console.error(`[cache] Failed to write ${group}.json:`, err);
  }
}
