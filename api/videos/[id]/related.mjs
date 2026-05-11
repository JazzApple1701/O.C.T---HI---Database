import { clampLimit, getDb, sendError, sendJson, titleTerms } from "../../_db.mjs";

export default function handler(req, res) {
  if (req.method !== "GET") {
    sendError(res, 405, "Method not allowed");
    return;
  }

  const { id } = req.query;
  const limit = clampLimit(req.query.limit, 12);

  try {
    const db = getDb();
    const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(id);
    if (!video) {
      sendError(res, 404, "Video not found");
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
    const related = db.prepare(`
      SELECT *, (${scoreSql}) AS relation_score
      FROM videos
      WHERE id != ? ${matchSql}
      ORDER BY relation_score DESC, published_at DESC
      LIMIT ?
    `).all(...scoreParams, video.id, ...matchParams, limit);

    sendJson(res, 200, related);
  } catch (error) {
    sendError(res, 500, error.message);
  }
}
