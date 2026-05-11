import { getRelatedVideos, sendError, sendJson } from "../../_db.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    sendError(res, 405, "Method not allowed");
    return;
  }

  const { id } = req.query;

  try {
    const { video, related } = await getRelatedVideos(id, req.query.limit);
    if (!video) {
      sendError(res, 404, "Video not found");
      return;
    }

    sendJson(res, 200, related);
  } catch (error) {
    sendError(res, 500, error.message);
  }
}
