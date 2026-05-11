CREATE TABLE IF NOT EXISTS videos (
  id text PRIMARY KEY,
  channel_id text NOT NULL,
  channel_title text NOT NULL,
  title text NOT NULL,
  sort_title text NOT NULL,
  topic_guess text NOT NULL,
  description text,
  published_at timestamptz,
  playlist_position integer,
  thumbnail_default text,
  thumbnail_medium text,
  thumbnail_high text,
  youtube_url text NOT NULL,
  embed_url text NOT NULL,
  imported_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  ib_subject text,
  ib_theme text,
  ib_topic_id text,
  duration text
);

CREATE INDEX IF NOT EXISTS idx_videos_published_at ON videos(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_ib_subject ON videos(ib_subject);
CREATE INDEX IF NOT EXISTS idx_videos_ib_theme ON videos(ib_theme);
CREATE INDEX IF NOT EXISTS idx_videos_ib_topic ON videos(ib_topic_id);
CREATE INDEX IF NOT EXISTS idx_videos_sort_title ON videos(sort_title);
CREATE INDEX IF NOT EXISTS idx_videos_topic_guess ON videos(topic_guess);
