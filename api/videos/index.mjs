import { getVideos, sendError, sendJson } from "../_db.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    sendError(res, 405, "Method not allowed");
    return;
  }

  try {
    sendJson(res, 200, await getVideos(req.query));
  } catch (error) {
    sendError(res, 500, error.message);
  }
}
