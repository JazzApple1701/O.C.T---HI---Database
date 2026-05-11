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

export function hasCloudDb() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

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

function supabaseUrl(pathname, params = {}) {
  const base = process.env.SUPABASE_URL.replace(/\/$/, "");
  const url = new URL(`${base}/rest/v1/${pathname}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  return url;
}

function supabaseHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json"
  };
}

async function supabaseFetch(pathname, params = {}) {
  const response = await fetch(supabaseUrl(pathname, params), {
    headers: supabaseHeaders()
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || data?.hint || `Supabase request failed: ${response.status}`);
  }

  return data;
}

function filterParams({ q, subject, theme, topicId, limit }) {
  const params = {
    select: "*",
    order: "published_at.desc.nullslast",
    limit
  };

  if (q) {
    const value = String(q).replace(/[*,()]/g, " ").trim();
    if (value) {
      params.or = `(title.ilike.*${value}*,description.ilike.*${value}*)`;
    }
  }

  if (subject) params.ib_subject = `eq.${subject}`;
  if (theme) params.ib_theme = `eq.${theme}`;
  if (topicId) params.ib_topic_id = `eq.${topicId}`;

  return params;
}

export async function getVideos(filters) {
  const limit = clampLimit(filters.limit);
  if (hasCloudDb()) {
    return supabaseFetch("videos", filterParams({ ...filters, limit }));
  }

  let query = "SELECT * FROM videos WHERE 1=1";
  const params = [];

  if (filters.q) {
    query += " AND (title LIKE ? OR description LIKE ?)";
    params.push(`%${filters.q}%`, `%${filters.q}%`);
  }

  if (filters.subject) {
    query += " AND ib_subject = ?";
    params.push(filters.subject);
  }

  if (filters.theme) {
    query += " AND ib_theme = ?";
    params.push(filters.theme);
  }

  if (filters.topicId) {
    query += " AND ib_topic_id = ?";
    params.push(filters.topicId);
  }

  query += " ORDER BY published_at DESC LIMIT ?";
  params.push(limit);

  return getDb().prepare(query).all(...params);
}

export async function getVideoById(id) {
  if (hasCloudDb()) {
    const rows = await supabaseFetch("videos", {
      select: "*",
      id: `eq.${id}`,
      limit: 1
    });

    return rows[0] || null;
  }

  return getDb().prepare("SELECT * FROM videos WHERE id = ?").get(id);
}

function relationScore(source, candidate, terms) {
  let score = 0;
  if (source.ib_topic_id && candidate.ib_topic_id === source.ib_topic_id) score += 100;
  if (source.ib_theme && candidate.ib_theme === source.ib_theme) score += 30;
  if (source.ib_subject && candidate.ib_subject === source.ib_subject) score += 12;

  const haystack = `${candidate.title || ""} ${candidate.description || ""}`.toLowerCase();
  for (const term of terms) {
    if (haystack.includes(term)) score += 15;
  }

  return score;
}

export async function getRelatedVideos(id, limit) {
  const video = await getVideoById(id);
  if (!video) {
    return { video: null, related: [] };
  }

  const relatedLimit = clampLimit(limit, 12);
  const terms = titleTerms(video.title);

  if (hasCloudDb()) {
    const searches = [];
    if (video.ib_topic_id) {
      searches.push(supabaseFetch("videos", {
        select: "*",
        ib_topic_id: `eq.${video.ib_topic_id}`,
        id: `neq.${id}`,
        order: "published_at.desc.nullslast",
        limit: 80
      }));
    }

    if (video.ib_subject) {
      searches.push(supabaseFetch("videos", {
        select: "*",
        ib_subject: `eq.${video.ib_subject}`,
        id: `neq.${id}`,
        order: "published_at.desc.nullslast",
        limit: 80
      }));
    }

    if (terms.length) {
      searches.push(supabaseFetch("videos", {
        select: "*",
        or: `(${terms.slice(0, 4).map((term) => `title.ilike.*${term}*`).join(",")})`,
        id: `neq.${id}`,
        order: "published_at.desc.nullslast",
        limit: 80
      }));
    }

    const rows = (await Promise.all(searches)).flat();
    const unique = new Map(rows.map((row) => [row.id, row]));
    const related = [...unique.values()]
      .map((candidate) => ({
        ...candidate,
        relation_score: relationScore(video, candidate, terms)
      }))
      .filter((candidate) => candidate.relation_score > 0)
      .sort((a, b) => {
        if (b.relation_score !== a.relation_score) return b.relation_score - a.relation_score;
        return String(b.published_at || "").localeCompare(String(a.published_at || ""));
      })
      .slice(0, relatedLimit);

    return { video, related };
  }

  const scoreParams = [];
  const matchParams = [];
  const scoreParts = [];
  const matchParts = [];

  if (video.ib_topic_id) {
    scoreParts.push("CASE WHEN ib_topic_id = ? THEN 100 ELSE 0 END");
    matchParts.push("ib_topic_id = ?");
    scoreParams.push(video.ib_topic_id);
    matchParams.push(video.ib_topic_id);
  }

  if (video.ib_theme) {
    scoreParts.push("CASE WHEN ib_theme = ? THEN 30 ELSE 0 END");
    scoreParams.push(video.ib_theme);
  }

  if (video.ib_subject) {
    scoreParts.push("CASE WHEN ib_subject = ? THEN 12 ELSE 0 END");
    scoreParams.push(video.ib_subject);
  }

  for (const term of terms) {
    scoreParts.push("CASE WHEN title LIKE ? OR description LIKE ? THEN 15 ELSE 0 END");
    matchParts.push("title LIKE ? OR description LIKE ?");
    scoreParams.push(`%${term}%`, `%${term}%`);
    matchParams.push(`%${term}%`, `%${term}%`);
  }

  const scoreSql = scoreParts.length ? scoreParts.join(" + ") : "0";
  const matchSql = matchParts.length ? `AND (${matchParts.join(" OR ")})` : "";
  const related = getDb().prepare(`
    SELECT *, (${scoreSql}) AS relation_score
    FROM videos
    WHERE id != ? ${matchSql}
    ORDER BY relation_score DESC, published_at DESC
    LIMIT ?
  `).all(...scoreParams, id, ...matchParams, relatedLimit);

  return { video, related };
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
