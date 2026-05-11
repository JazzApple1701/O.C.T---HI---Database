import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";
import { defaultDbPath, openDatabase, projectRoot } from "./db.mjs";

const PORT = Number(process.env.PORT || 4173);
const publicDir = path.join(projectRoot, "public");
const activeDbPath = process.env.DB_PATH || defaultDbPath;
const db = openDatabase(activeDbPath);

const sortMap = {
  newest: "published_at DESC, sort_title ASC",
  oldest: "published_at ASC, sort_title ASC",
  title_asc: "sort_title ASC, published_at DESC",
  title_desc: "sort_title DESC, published_at DESC",
  topic_asc: "topic_guess ASC, sort_title ASC",
  channel_order: "playlist_position ASC, published_at DESC"
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (url.pathname === "/api/stats") {
      sendJson(response, getStats());
      return;
    }

    if (url.pathname === "/api/topics") {
      sendJson(response, getTopics());
      return;
    }

    if (url.pathname === "/api/videos") {
      sendJson(response, getVideos(url.searchParams));
      return;
    }

    if (url.pathname.startsWith("/api/videos/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/videos/".length));
      const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(id);

      if (!video) {
        sendJson(response, { error: "Video not found" }, 404);
        return;
      }

      sendJson(response, video);
      return;
    }

    serveStatic(url.pathname, response);
  } catch (error) {
    console.error(error);
    sendJson(response, { error: "Server error", detail: error.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`Organic Chemistry Tutor Video DB running at http://localhost:${PORT}`);
  console.log(`Database: ${activeDbPath}`);
});

function getStats() {
  const videos = db.prepare("SELECT COUNT(*) AS count FROM videos").get().count;
  const channels = db.prepare("SELECT COUNT(*) AS count FROM channels").get().count;
  const channel = db.prepare("SELECT * FROM channels ORDER BY last_imported_at DESC LIMIT 1").get() || null;
  const dbSizeBytes = fs.existsSync(activeDbPath) ? fs.statSync(activeDbPath).size : 0;

  return {
    videos,
    channels,
    channel,
    dbSizeBytes
  };
}

function getTopics() {
  return db.prepare(`
    SELECT topic_guess AS topic, COUNT(*) AS count
    FROM videos
    GROUP BY topic_guess
    ORDER BY topic_guess ASC
  `).all();
}

function getVideos(searchParams) {
  const q = (searchParams.get("q") || "").trim();
  const topic = (searchParams.get("topic") || "").trim();
  const sort = sortMap[searchParams.get("sort")] ? searchParams.get("sort") : "newest";
  const limit = clampInteger(searchParams.get("limit"), 1, 200, 60);
  const offset = clampInteger(searchParams.get("offset"), 0, 1_000_000, 0);
  const where = [];
  const params = [];

  if (q) {
    where.push("(title LIKE ? OR description LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }

  if (topic) {
    where.push("topic_guess = ?");
    params.push(topic);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = db.prepare(`SELECT COUNT(*) AS count FROM videos ${whereSql}`).get(...params).count;
  const items = db.prepare(`
    SELECT
      id, channel_id, channel_title, title, topic_guess, description, published_at,
      playlist_position, thumbnail_default, thumbnail_medium, thumbnail_high,
      youtube_url, embed_url
    FROM videos
    ${whereSql}
    ORDER BY ${sortMap[sort]}
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return {
    total,
    limit,
    offset,
    sort,
    items
  };
}

function clampInteger(raw, min, max, fallback) {
  const number = Number(raw);
  if (!Number.isInteger(number)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, number));
}

function serveStatic(pathname, response) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicDir, safePath));

  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(content);
  });
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}
