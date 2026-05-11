import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, "..", "data", "videos.sqlite");

const DEFAULT_LIMIT = 80;
const STOP_WORDS = new Set([
  "the", "and", "for", "with", "into", "from", "this", "that", "how", "what",
  "why", "are", "you", "your", "video", "tutorial", "practice", "problem",
  "problems", "introduction", "intro", "part", "review", "study", "guide"
]);

let db;

export function getDb() {
  if (!db) {
    db = new DatabaseSync(dbPath, { readOnly: true });
  }

  return db;
}

export function clampLimit(value, fallback = DEFAULT_LIMIT) {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return fallback;
  }

  return Math.max(1, Math.min(number, 200));
}

export function titleTerms(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((term) => term.length > 3 && !STOP_WORDS.has(term))
    .slice(0, 8);
}

export function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=86400");
  res.end(JSON.stringify(body));
}

export function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}
