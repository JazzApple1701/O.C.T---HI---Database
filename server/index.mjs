import express from "express";
import cors from "cors";
import { openDatabase } from "./db.mjs";
import { IB_SYLLABUS } from "./ib-syllabus.js";

const app = express();
const port = process.env.PORT || 3001;
const db = openDatabase();

app.use(cors());
app.use(express.json());

// Get full syllabus structure
app.get("/api/syllabus", (req, res) => {
  res.json(IB_SYLLABUS);
});

const DEFAULT_LIMIT = 80;
const STOP_WORDS = new Set([
  "the", "and", "for", "with", "into", "from", "this", "that", "how", "what",
  "why", "are", "you", "your", "video", "tutorial", "practice", "problem",
  "problems", "introduction", "intro", "part"
]);

function clampLimit(value, fallback = DEFAULT_LIMIT) {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return fallback;
  }

  return Math.max(1, Math.min(number, 200));
}

function titleTerms(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((term) => term.length > 3 && !STOP_WORDS.has(term))
    .slice(0, 8);
}

// Search and browse videos
app.get("/api/videos", (req, res) => {
  const { q, subject, theme, topicId } = req.query;
  const limit = clampLimit(req.query.limit);
  
  let query = "SELECT * FROM videos WHERE 1=1";
  const params = [];

  if (q) {
    query += " AND (title LIKE ? OR description LIKE ?)";
    params.push(`%${q}%`, `%${q}%`);
  }

  if (subject) {
    query += " AND ib_subject = ?";
    params.push(subject);
  }

  if (theme) {
    query += " AND ib_theme = ?";
    params.push(theme);
  }

  if (topicId) {
    query += " AND ib_topic_id = ?";
    params.push(topicId);
  }

  query += " ORDER BY published_at DESC LIMIT ?";
  params.push(limit);

  try {
    const videos = db.prepare(query).all(...params);
    res.json(videos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/videos/:id/related", (req, res) => {
  const { id } = req.params;
  const limit = clampLimit(req.query.limit, 12);

  try {
    const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(id);
    if (!video) {
      res.status(404).json({ error: "Video not found" });
      return;
    }

    const terms = titleTerms(video.title);
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

    for (const term of terms) {
      scoreParts.push("CASE WHEN title LIKE ? THEN 15 ELSE 0 END");
      matchParts.push("title LIKE ?");
      scoreParams.push(`%${term}%`);
      matchParams.push(`%${term}%`);
    }

    const scoreSql = scoreParts.length ? scoreParts.join(" + ") : "0";
    const matchSql = matchParts.length ? `AND (${matchParts.join(" OR ")})` : "";
    const related = db.prepare(`
      SELECT *, (${scoreSql}) AS relation_score
      FROM videos
      WHERE id != ? ${matchSql}
      ORDER BY relation_score DESC, published_at DESC
      LIMIT ?
    `).all(...scoreParams, video.id, ...matchParams, limit);

    res.json(related);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get videos for a specific subtopic
app.get("/api/subtopic/:id", (req, res) => {
  const { id } = req.params;
  try {
    const videos = db.prepare("SELECT * FROM videos WHERE ib_topic_id = ? ORDER BY published_at DESC").all(id);
    res.json(videos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
