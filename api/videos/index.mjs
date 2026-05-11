import { clampLimit, getDb, sendError, sendJson } from "../_db.mjs";

export default function handler(req, res) {
  if (req.method !== "GET") {
    sendError(res, 405, "Method not allowed");
    return;
  }

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
    sendJson(res, 200, getDb().prepare(query).all(...params));
  } catch (error) {
    sendError(res, 500, error.message);
  }
}
