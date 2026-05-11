const state = {
  q: "",
  topic: "",
  sort: "newest",
  limit: 60,
  offset: 0,
  total: 0,
  selectedId: null
};

const elements = {
  videoCount: document.querySelector("#videoCount"),
  dbSize: document.querySelector("#dbSize"),
  resultCount: document.querySelector("#resultCount"),
  pageLabel: document.querySelector("#pageLabel"),
  searchInput: document.querySelector("#searchInput"),
  topicSelect: document.querySelector("#topicSelect"),
  sortSelect: document.querySelector("#sortSelect"),
  prevButton: document.querySelector("#prevButton"),
  nextButton: document.querySelector("#nextButton"),
  emptyState: document.querySelector("#emptyState"),
  videoList: document.querySelector("#videoList"),
  player: document.querySelector("#player"),
  selectedTopic: document.querySelector("#selectedTopic"),
  selectedTitle: document.querySelector("#selectedTitle"),
  selectedDate: document.querySelector("#selectedDate"),
  selectedLink: document.querySelector("#selectedLink"),
  playerStatus: document.querySelector("#playerStatus")
};

init();

async function init() {
  bindEvents();
  await Promise.all([loadStats(), loadTopics()]);
  await loadVideos();
}

function bindEvents() {
  elements.searchInput.addEventListener("input", debounce(() => {
    state.q = elements.searchInput.value.trim();
    state.offset = 0;
    loadVideos();
  }, 250));

  elements.topicSelect.addEventListener("change", () => {
    state.topic = elements.topicSelect.value;
    state.offset = 0;
    loadVideos();
  });

  elements.sortSelect.addEventListener("change", () => {
    state.sort = elements.sortSelect.value;
    state.offset = 0;
    loadVideos();
  });

  elements.prevButton.addEventListener("click", () => {
    state.offset = Math.max(0, state.offset - state.limit);
    loadVideos();
  });

  elements.nextButton.addEventListener("click", () => {
    if (state.offset + state.limit < state.total) {
      state.offset += state.limit;
      loadVideos();
    }
  });

  elements.player.addEventListener("load", () => {
    elements.playerStatus.hidden = true;
  });
}

async function loadStats() {
  const stats = await getJson("/api/stats");
  elements.videoCount.textContent = formatNumber(stats.videos);
  elements.dbSize.textContent = formatBytes(stats.dbSizeBytes);
}

async function loadTopics() {
  const topics = await getJson("/api/topics");

  for (const topic of topics) {
    const option = document.createElement("option");
    option.value = topic.topic;
    option.textContent = `${topic.topic} (${formatNumber(topic.count)})`;
    elements.topicSelect.append(option);
  }
}

async function loadVideos() {
  const params = new URLSearchParams({
    q: state.q,
    topic: state.topic,
    sort: state.sort,
    limit: String(state.limit),
    offset: String(state.offset)
  });
  const data = await getJson(`/api/videos?${params.toString()}`);

  state.total = data.total;
  renderVideos(data.items);
  renderPagination();
}

function renderVideos(videos) {
  elements.videoList.replaceChildren();
  elements.emptyState.hidden = videos.length > 0 || state.total > 0;

  for (const video of videos) {
    const card = document.createElement("article");
    card.className = "video-card";
    card.dataset.videoId = video.id;

    const thumbnail = document.createElement("img");
    thumbnail.className = "thumb";
    thumbnail.loading = "lazy";
    thumbnail.alt = "";
    thumbnail.src = video.thumbnail_high || video.thumbnail_medium || video.thumbnail_default || "";

    const body = document.createElement("div");
    body.className = "video-body";

    const topic = document.createElement("p");
    topic.className = "topic-pill";
    topic.textContent = video.topic_guess;

    const title = document.createElement("h2");
    title.textContent = video.title;

    const date = document.createElement("p");
    date.className = "video-date";
    date.textContent = formatDate(video.published_at);

    body.append(topic, title, date);

    const actions = document.createElement("div");
    actions.className = "video-actions";

    const playButton = document.createElement("button");
    playButton.type = "button";
    playButton.textContent = "Play";
    playButton.addEventListener("click", () => selectVideo(video));

    const youtubeLink = document.createElement("a");
    youtubeLink.href = video.youtube_url;
    youtubeLink.target = "_blank";
    youtubeLink.rel = "noreferrer";
    youtubeLink.textContent = "YouTube";

    actions.append(playButton, youtubeLink);
    card.append(thumbnail, body, actions);
    elements.videoList.append(card);
  }

  if (!state.selectedId && videos[0]) {
    selectVideo(videos[0], { autoplay: false });
  } else {
    markActiveCard();
  }
}

function selectVideo(video, options = {}) {
  state.selectedId = video.id;
  const autoplay = options.autoplay === false ? "0" : "1";
  const embedUrl = buildEmbedUrl(video.id, autoplay);

  elements.playerStatus.hidden = false;
  elements.playerStatus.classList.remove("is-error");
  elements.playerStatus.textContent = autoplay === "1" ? "Starting player..." : "Loading player...";
  elements.player.src = embedUrl;
  elements.selectedTopic.textContent = video.topic_guess;
  elements.selectedTitle.textContent = video.title;
  elements.selectedDate.textContent = formatDate(video.published_at);
  elements.selectedLink.href = video.youtube_url;
  elements.selectedLink.hidden = false;

  markActiveCard();
}

function buildEmbedUrl(videoId, autoplay) {
  const url = new URL(`https://www.youtube.com/embed/${videoId}`);
  url.searchParams.set("autoplay", autoplay);
  url.searchParams.set("playsinline", "1");
  url.searchParams.set("rel", "0");
  url.searchParams.set("modestbranding", "1");
  url.searchParams.set("origin", window.location.origin);
  return url.toString();
}

function markActiveCard() {
  for (const card of elements.videoList.querySelectorAll(".video-card")) {
    card.classList.toggle("is-active", card.dataset.videoId === state.selectedId);
  }
}

function renderPagination() {
  const first = state.total === 0 ? 0 : state.offset + 1;
  const last = Math.min(state.offset + state.limit, state.total);
  const page = Math.floor(state.offset / state.limit) + 1;
  const pages = Math.max(1, Math.ceil(state.total / state.limit));

  elements.resultCount.textContent = `${formatNumber(first)}-${formatNumber(last)} of ${formatNumber(state.total)} results`;
  elements.pageLabel.textContent = `Page ${page} / ${pages}`;
  elements.prevButton.disabled = state.offset === 0;
  elements.nextButton.disabled = state.offset + state.limit >= state.total;
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json();
}

function debounce(callback, wait) {
  let timeout = null;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => callback(...args), wait);
  };
}

function formatDate(value) {
  if (!value) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value || 0);
}

function formatBytes(bytes) {
  if (!bytes) {
    return "0 KB";
  }

  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
