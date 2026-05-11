import fs from "node:fs";
import path from "node:path";
import {
  defaultDbPath,
  nowIso,
  openDatabase,
  runInTransaction,
  upsertChannel,
  upsertVideo
} from "./db.mjs";

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  loadEnvFile();

  const args = parseArgs(process.argv.slice(2));
  const apiKey = args.apiKey || process.env.YOUTUBE_API_KEY || process.env.YT_API_KEY;
  const handle = args.handle || "@TheOrganicChemistryTutor";
  const channelId = args.channelId;
  const dbPath = args.db || defaultDbPath;
  const limit = args.limit ? Number(args.limit) : null;

  if (!apiKey) {
    throw new Error(
      [
        "Missing YouTube API key.",
        "Create OrganicChemTutorDB/.env from .env.example and set YOUTUBE_API_KEY=your_key_here,",
        "then run npm run import again."
      ].join(" ")
    );
  }

  if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error("--limit must be a positive whole number.");
  }

  const db = openDatabase(dbPath);
  const channel = await getChannel({ apiKey, handle, channelId });

  upsertChannel(db, {
    ...channel,
    handle,
    lastImportedAt: nowIso()
  });

  console.log(`Importing videos for ${channel.title}`);
  console.log(`Channel ID: ${channel.id}`);
  console.log(`Uploads playlist: ${channel.uploadsPlaylistId}`);

  let pageToken = null;
  let imported = 0;
  let page = 0;

  do {
    const data = await youtubeGet(apiKey, "/playlistItems", {
      part: "snippet,contentDetails",
      playlistId: channel.uploadsPlaylistId,
      maxResults: "50",
      pageToken
    });

    page += 1;
    const items = data.items || [];
    const durations = await getVideoDurations(apiKey, items);

    runInTransaction(db, () => {
      for (const item of items) {
        if (limit !== null && imported >= limit) {
          break;
        }

        const video = videoFromPlaylistItem(item, channel);
        if (!video.id) {
          continue;
        }

        video.duration = durations.get(video.id) || null;
        upsertVideo(db, video);
        imported += 1;
      }
    });

    console.log(`Page ${page}: ${imported} videos imported`);

    if (limit !== null && imported >= limit) {
      break;
    }

    pageToken = data.nextPageToken || null;
  } while (pageToken);

  upsertChannel(db, {
    ...channel,
    handle,
    lastImportedAt: nowIso()
  });

  const total = db.prepare("SELECT COUNT(*) AS count FROM videos WHERE channel_id = ?").get(channel.id).count;
  console.log(`Done. Database now has ${total} videos for ${channel.title}.`);
  console.log(`DB path: ${dbPath}`);
}

async function getVideoDurations(apiKey, playlistItems) {
  const ids = playlistItems
    .map((item) => item.contentDetails?.videoId || item.snippet?.resourceId?.videoId)
    .filter(Boolean);

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
  if (!match) {
    return null;
  }

  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function loadEnvFile() {
  const envPath = path.resolve(".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

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

    if (arg === "--handle") {
      result.handle = next;
      i += 1;
    } else if (arg === "--channel-id") {
      result.channelId = next;
      i += 1;
    } else if (arg === "--api-key") {
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

async function getChannel({ apiKey, handle, channelId }) {
  const params = {
    part: "id,snippet,contentDetails,statistics"
  };

  if (channelId) {
    params.id = channelId;
  } else {
    params.forHandle = handle.startsWith("@") ? handle : `@${handle}`;
  }

  const data = await youtubeGet(apiKey, "/channels", params);
  const item = data.items?.[0];

  if (!item) {
    throw new Error(`Could not find channel for ${channelId || handle}.`);
  }

  const uploadsPlaylistId = item.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) {
    throw new Error("YouTube did not return an uploads playlist for this channel.");
  }

  return {
    id: item.id,
    title: item.snippet?.title || "Unknown channel",
    description: item.snippet?.description || "",
    thumbnailUrl: pickThumbnail(item.snippet?.thumbnails),
    subscriberCount: numberOrNull(item.statistics?.subscriberCount),
    videoCount: numberOrNull(item.statistics?.videoCount),
    uploadsPlaylistId
  };
}

function videoFromPlaylistItem(item, channel) {
  const snippet = item.snippet || {};
  const contentDetails = item.contentDetails || {};
  const thumbnails = snippet.thumbnails || {};
  const videoId = contentDetails.videoId || snippet.resourceId?.videoId;

  return {
    id: videoId,
    channelId: channel.id,
    channelTitle: channel.title,
    title: snippet.title,
    description: snippet.description,
    publishedAt: contentDetails.videoPublishedAt || snippet.publishedAt,
    playlistPosition: Number.isInteger(snippet.position) ? snippet.position : null,
    thumbnailDefault: thumbnails.default?.url || null,
    thumbnailMedium: thumbnails.medium?.url || null,
    thumbnailHigh: thumbnails.high?.url || thumbnails.standard?.url || thumbnails.maxres?.url || null
  };
}

function pickThumbnail(thumbnails = {}) {
  return thumbnails.high?.url || thumbnails.medium?.url || thumbnails.default?.url || null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
