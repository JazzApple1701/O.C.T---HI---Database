import fs from "node:fs";
import path from "node:path";
import { defaultDbPath, openDatabase, runInTransaction } from "./db.mjs";

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  loadEnvFile();

  const args = parseArgs(process.argv.slice(2));
  const apiKey = args.apiKey || process.env.YOUTUBE_API_KEY || process.env.YT_API_KEY;
  const dbPath = args.db || defaultDbPath;
  const limit = args.limit ? Number(args.limit) : null;

  if (!apiKey) {
    throw new Error("Missing YouTube API key. Set YOUTUBE_API_KEY in .env.");
  }

  const db = openDatabase(dbPath);
  const videos = db.prepare(`
    SELECT id, title
    FROM videos
    WHERE duration IS NULL OR duration = ''
    ORDER BY published_at DESC
    ${limit ? "LIMIT ?" : ""}
  `).all(...(limit ? [limit] : []));

  console.log(`Backfilling durations for ${videos.length} videos`);

  let updated = 0;
  for (let index = 0; index < videos.length; index += 50) {
    const batch = videos.slice(index, index + 50);
    const durations = await getVideoDurations(apiKey, batch.map((video) => video.id));

    runInTransaction(db, () => {
      const update = db.prepare("UPDATE videos SET duration = ?, updated_at = datetime('now') WHERE id = ?");
      for (const video of batch) {
        const duration = durations.get(video.id);
        if (duration) {
          update.run(duration, video.id);
          updated += 1;
        }
      }
    });

    console.log(`Processed ${Math.min(index + 50, videos.length)} / ${videos.length}`);
  }

  console.log(`Done. Updated ${updated} durations.`);
}

function loadEnvFile() {
  const envPath = path.resolve(".env");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;

    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function parseArgs(argv) {
  const result = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--api-key") {
      result.apiKey = next;
      i += 1;
    } else if (arg === "--db") {
      result.db = path.resolve(next);
      i += 1;
    } else if (arg === "--limit") {
      result.limit = next;
      i += 1;
    }
  }

  return result;
}

async function getVideoDurations(apiKey, ids) {
  if (ids.length === 0) {
    return new Map();
  }

  const data = await youtubeGet(apiKey, "/videos", {
    part: "contentDetails",
    id: ids.join(","),
    maxResults: "50"
  });

  return new Map((data.items || []).map((item) => [
    item.id,
    formatYouTubeDuration(item.contentDetails?.duration)
  ]));
}

function formatYouTubeDuration(duration) {
  const match = String(duration || "").match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;

  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

async function youtubeGet(apiKey, endpoint, params) {
  const url = new URL(`${YOUTUBE_API_BASE}${endpoint}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  }

  url.searchParams.set("key", apiKey);

  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = body.error?.message || response.statusText;
    throw new Error(`YouTube API error (${response.status}): ${message}`);
  }

  return body;
}
