import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { IB_SYLLABUS } from "./ib-syllabus.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(__dirname, "..");
export const defaultDbPath = path.join(projectRoot, "data", "videos.sqlite");

const TOPIC_RULES = [
  ["Organic Chemistry", [
    "organic chemistry", "alkane", "alkene", "alkyne", "aromatic", "benzene",
    "nmr", "ir spectroscopy", "mass spectrometry", "sn1", "sn2", "e1", "e2",
    "stereochemistry", "chirality", "enantiomer", "diastereomer", "carbonyl",
    "carboxylic", "ester", "ether", "alcohol", "ketone", "aldehyde", "amine",
    "amide", "grignard", "diels alder", "friedel", "acylation", "alkylation"
  ]],
  ["General Chemistry", [
    "chemistry", "stoichiometry", "molarity", "moles", "periodic table",
    "chemical reaction", "chemical equilibrium", "acid base", "ph", "poh",
    "thermochemistry", "electrochemistry", "redox", "gas law", "lewis structure",
    "molecular geometry", "orbital", "quantum numbers", "kinetics", "solubility"
  ]],
  ["Physics", [
    "physics", "kinematics", "newton", "force", "momentum", "torque", "energy",
    "work", "power", "electric field", "magnetic field", "circuit", "voltage",
    "current", "resistor", "capacitor", "inductor", "waves", "optics", "lens",
    "thermodynamics", "fluid", "pressure"
  ]],
  ["Calculus", [
    "calculus", "derivative", "integral", "limits", "differentiation",
    "integration", "chain rule", "product rule", "quotient rule", "u substitution",
    "laplace", "series", "taylor", "maclaurin", "optimization", "related rates"
  ]],
  ["Algebra", [
    "algebra", "equation", "linear equation", "quadratic", "polynomial",
    "factoring", "rational expression", "radical", "exponents", "logarithm",
    "inequality", "systems of equations", "matrices", "determinant"
  ]],
  ["Trigonometry", [
    "trigonometry", "trig", "sine", "cosine", "tangent", "secant", "cosecant",
    "cotangent", "unit circle", "law of sines", "law of cosines"
  ]],
  ["Statistics", [
    "statistics", "probability", "standard deviation", "variance", "normal distribution",
    "binomial distribution", "z score", "confidence interval", "hypothesis test",
    "regression", "correlation"
  ]],
  ["Biology", [
    "biology", "cell", "dna", "rna", "protein synthesis", "photosynthesis",
    "respiration", "anatomy", "physiology", "mitosis", "meiosis", "genetics"
  ]],
  ["Finance", [
    "finance", "interest", "annuity", "loan", "mortgage", "present value",
    "future value", "npv", "irr", "bond", "stock"
  ]]
];

export function openDatabase(dbPath = defaultDbPath) {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  createSchema(db);
  return db;
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      handle TEXT,
      description TEXT,
      thumbnail_url TEXT,
      subscriber_count INTEGER,
      video_count INTEGER,
      uploads_playlist_id TEXT,
      last_imported_at TEXT
    );

    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      channel_title TEXT NOT NULL,
      title TEXT NOT NULL,
      sort_title TEXT NOT NULL,
      topic_guess TEXT NOT NULL,
      description TEXT,
      published_at TEXT,
      playlist_position INTEGER,
      thumbnail_default TEXT,
      thumbnail_medium TEXT,
      thumbnail_high TEXT,
      youtube_url TEXT NOT NULL,
      embed_url TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (channel_id) REFERENCES channels(id)
    );
  `);

  // Migration: Add IB columns if they don't exist
  try { db.exec("ALTER TABLE videos ADD COLUMN ib_subject TEXT;"); } catch(e) {}
  try { db.exec("ALTER TABLE videos ADD COLUMN ib_theme TEXT;"); } catch(e) {}
  try { db.exec("ALTER TABLE videos ADD COLUMN ib_topic_id TEXT;"); } catch(e) {}
  try { db.exec("ALTER TABLE videos ADD COLUMN duration TEXT;"); } catch(e) {}
  try { db.exec("ALTER TABLE videos ADD COLUMN playlist_position INTEGER;"); } catch(e) {}

  // Now create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_videos_channel ON videos(channel_id);
    CREATE INDEX IF NOT EXISTS idx_videos_published_at ON videos(published_at);
    CREATE INDEX IF NOT EXISTS idx_videos_ib_subject ON videos(ib_subject);
    CREATE INDEX IF NOT EXISTS idx_videos_ib_topic ON videos(ib_topic_id);
    CREATE INDEX IF NOT EXISTS idx_videos_sort_title ON videos(sort_title);
    CREATE INDEX IF NOT EXISTS idx_videos_topic_guess ON videos(topic_guess);
  `);
}

export function normalizeTitle(title) {
  return String(title || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function mapVideoToIB(title) {
  const normalized = normalizeTitle(title);
  let bestMatch = null;
  
  for (const [subjectKey, subject] of Object.entries(IB_SYLLABUS)) {
    for (const theme of subject.themes) {
      for (const topic of theme.topics) {
        for (const keyword of topic.keywords) {
          const normalizedKeyword = normalizeTitle(keyword);
          if (!normalizedKeyword || !normalized.includes(normalizedKeyword)) {
            continue;
          }

          const score = normalizedKeyword.length + normalizedKeyword.split(" ").length * 10;
          if (!bestMatch || score > bestMatch.score) {
            bestMatch = {
              score,
              subject: subjectKey,
              theme: theme.id,
              topicId: topic.id
            };
          }
        }
      }
    }
  }

  if (bestMatch) {
    return {
      subject: bestMatch.subject,
      theme: bestMatch.theme,
      topicId: bestMatch.topicId
    };
  }
  
  return { subject: "other", theme: null, topicId: null };
}

export function guessTopic(title) {
  const normalized = normalizeTitle(title);

  for (const [topic, needles] of TOPIC_RULES) {
    if (needles.some((needle) => normalized.includes(normalizeTitle(needle)))) {
      return topic;
    }
  }

  return "Other";
}

export function nowIso() {
  return new Date().toISOString();
}

export function runInTransaction(db, callback) {
  db.exec("BEGIN");
  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function upsertChannel(db, channel) {
  db.prepare(`
    INSERT INTO channels (
      id, title, handle, description, thumbnail_url, subscriber_count,
      video_count, uploads_playlist_id, last_imported_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      handle = excluded.handle,
      description = excluded.description,
      thumbnail_url = excluded.thumbnail_url,
      subscriber_count = excluded.subscriber_count,
      video_count = excluded.video_count,
      uploads_playlist_id = excluded.uploads_playlist_id,
      last_imported_at = excluded.last_imported_at
  `).run(
    channel.id,
    channel.title,
    channel.handle ?? null,
    channel.description ?? null,
    channel.thumbnailUrl ?? null,
    channel.subscriberCount ?? null,
    channel.videoCount ?? null,
    channel.uploadsPlaylistId,
    channel.lastImportedAt ?? nowIso()
  );
}

export function upsertVideo(db, video) {
  const updatedAt = nowIso();
  const title = video.title || "Untitled video";
  const id = video.id;
  const mapping = mapVideoToIB(title);

  db.prepare(`
    INSERT INTO videos (
      id, channel_id, channel_title, title, sort_title, topic_guess, description,
      published_at, playlist_position, thumbnail_default, thumbnail_medium,
      thumbnail_high, youtube_url, embed_url, imported_at, updated_at,
      ib_subject, ib_theme, ib_topic_id, duration
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      channel_id = excluded.channel_id,
      channel_title = excluded.channel_title,
      title = excluded.title,
      sort_title = excluded.sort_title,
      topic_guess = excluded.topic_guess,
      description = excluded.description,
      published_at = excluded.published_at,
      playlist_position = excluded.playlist_position,
      thumbnail_default = excluded.thumbnail_default,
      thumbnail_medium = excluded.thumbnail_medium,
      thumbnail_high = excluded.thumbnail_high,
      youtube_url = excluded.youtube_url,
      embed_url = excluded.embed_url,
      updated_at = excluded.updated_at,
      ib_subject = excluded.ib_subject,
      ib_theme = excluded.ib_theme,
      ib_topic_id = excluded.ib_topic_id,
      duration = excluded.duration
  `).run(
    id,
    video.channelId,
    video.channelTitle,
    title,
    normalizeTitle(title),
    guessTopic(title),
    video.description ?? null,
    video.publishedAt ?? null,
    video.playlistPosition ?? null,
    video.thumbnailDefault ?? null,
    video.thumbnailMedium ?? null,
    video.thumbnailHigh ?? null,
    `https://www.youtube.com/watch?v=${id}`,
    `https://www.youtube.com/embed/${id}`,
    updatedAt,
    updatedAt,
    mapping.subject,
    mapping.theme,
    mapping.topicId,
    video.duration ?? null
  );
}

export function updateIBMappings(db) {
  const videos = db.prepare("SELECT id, title FROM videos").all();
  const updateStmt = db.prepare(`
    UPDATE videos SET 
      ib_subject = ?, 
      ib_theme = ?, 
      ib_topic_id = ? 
    WHERE id = ?
  `);

  db.exec("BEGIN");
  try {
    for (const video of videos) {
      const mapping = mapVideoToIB(video.title);
      updateStmt.run(mapping.subject, mapping.theme, mapping.topicId, video.id);
    }
    db.exec("COMMIT");
    console.log(`Updated IB mappings for ${videos.length} videos.`);
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
