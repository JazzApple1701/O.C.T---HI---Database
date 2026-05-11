import { IB_SYLLABUS } from "../server/ib-syllabus.js";
import { sendJson } from "./_db.mjs";

export default function handler(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  sendJson(res, 200, IB_SYLLABUS);
}
