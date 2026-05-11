import { Fragment, useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Search, Menu, X, BookOpen, Clock, Play, Camera, Loader2, ChevronRight, ChevronDown, CirclePlay, ExternalLink, Layers, Cpu, Atom, FunctionSquare, Bookmark, BookmarkCheck, ListVideo, FolderOpen, SlidersHorizontal, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? '/api' : 'http://localhost:3001/api');
const DEFAULT_PLAYER_VOLUME = 90;
const WATCH_LATER_KEY = 'hi-watch-later-videos';
const THEME_KEY = 'hi-interface-theme';
const THEME_OPTIONS = [
  { id: 'zen', name: 'Zen Paper', note: 'Warm paper, coral, blue' },
  { id: 'graphite', name: 'Graphite', note: 'Soft dark, amber, mint' },
  { id: 'midnight', name: 'Midnight', note: 'Navy study room, cyan' },
  { id: 'ember', name: 'Ember', note: 'Deep ink, copper, rose' },
  { id: 'aurora', name: 'Aurora', note: 'Cool mist, violet, green' },
  { id: 'scholar', name: 'Scholar', note: 'Ivory, ink, library red' }
];
let youtubeApiPromise = null;

function loadWatchLater() {
  try {
    return JSON.parse(localStorage.getItem(WATCH_LATER_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveWatchLater(videos) {
  localStorage.setItem(WATCH_LATER_KEY, JSON.stringify(videos));
}

function loadTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  return THEME_OPTIONS.some((theme) => theme.id === saved) ? saved : 'zen';
}

function getPathTitle(path) {
  if (!path) return 'Browse';
  return path.topic?.title || path.theme?.title || path.subjectTitle || path.subject || 'Browse';
}

function getPathStage(path) {
  if (!path?.subject) return 'subject';
  if (!path.theme) return 'theme';
  if (!path.topic) return 'topic';
  return 'videos';
}

const SEARCH_DATE_OPTIONS = [
  { value: 'any', label: 'Any date' },
  { value: 'year', label: 'Past year' },
  { value: 'month', label: 'Past month' }
];

const KEYWORD_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'into', 'from', 'this', 'that', 'what', 'when',
  'where', 'which', 'your', 'video', 'tutorial', 'practice', 'problem', 'intro',
  'introduction', 'part', 'review', 'test', 'study', 'guide'
]);

function getVideoKeywords(video) {
  return String(`${video.title || ''} ${video.description || ''}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((word) => word.length > 3 && !KEYWORD_STOP_WORDS.has(word))
    .slice(0, 18);
}

function scoreRelatedVideo(source, candidate) {
  const sourceTerms = new Set(getVideoKeywords(source));
  const candidateTerms = new Set(getVideoKeywords(candidate));
  let score = 0;

  if (source.ib_topic_id && source.ib_topic_id === candidate.ib_topic_id) score += 100;
  if (source.ib_theme && source.ib_theme === candidate.ib_theme) score += 35;
  if (source.ib_subject && source.ib_subject === candidate.ib_subject) score += 18;

  sourceTerms.forEach((term) => {
    if (candidateTerms.has(term)) score += 9;
  });

  return score;
}

function filterVideosBySearchFacets(videoList, filters) {
  const now = Date.now();
  return videoList.filter((video) => {
    if (filters.subject && video.ib_subject !== filters.subject) return false;
    if (filters.topicId && video.ib_topic_id !== filters.topicId) return false;

    if (filters.date !== 'any') {
      const published = new Date(video.published_at).getTime();
      if (!Number.isFinite(published)) return false;
      const ageDays = (now - published) / 86400000;
      if (filters.date === 'month' && ageDays > 31) return false;
      if (filters.date === 'year' && ageDays > 366) return false;
    }

    return true;
  });
}

function buildPathForVideo(video, path, syllabus) {
  const subjectKey = path?.subject || video.ib_subject || 'other';
  const subject = syllabus[subjectKey];
  const theme = path?.theme || subject?.themes?.find((item) => item.id === video.ib_theme);
  const topic = path?.topic || theme?.topics?.find((item) => item.id === video.ib_topic_id);

  return {
    subject: subjectKey,
    subjectTitle: subject?.title || path?.subjectTitle || subjectKey,
    theme: theme ? { id: theme.id, title: theme.title } : video.ib_theme ? { id: video.ib_theme, title: `Topic ${video.ib_theme}` } : null,
    topic: topic ? { id: topic.id, title: topic.title } : video.ib_topic_id ? { id: video.ib_topic_id, title: `Topic ${video.ib_topic_id}` } : null
  };
}

function App() {
  const [view, setView] = useState('home'); // home, search, category
  const [searchQuery, setSearchQuery] = useState('');
  const [syllabus, setSyllabus] = useState({});
  const [videos, setVideos] = useState([]);
  const [searchResultPool, setSearchResultPool] = useState([]);
  const [searchFilters, setSearchFilters] = useState({ subject: '', topicId: '', date: 'any' });
  const [searchSuggestions, setSearchSuggestions] = useState([]);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [selectedPath, setSelectedPath] = useState(null);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [watchLater, setWatchLater] = useState(() => loadWatchLater());
  const [theme, setTheme] = useState(() => loadTheme());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchSyllabus = async () => {
      try {
        const res = await axios.get(`${API_BASE}/syllabus`);
        setSyllabus(res.data);
      } catch (err) {
        console.error("Failed to fetch syllabus", err);
      }
    };

    fetchSyllabus();
  }, []);

  useEffect(() => {
    saveWatchLater(watchLater);
  }, [watchLater]);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 2) {
      return undefined;
    }

    let isCancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setIsSuggesting(true);
      try {
        const res = await axios.get(`${API_BASE}/videos`, {
          params: { q: query, limit: 5 }
        });
        if (!isCancelled) {
          setSearchSuggestions(res.data.slice(0, 5));
        }
      } catch {
        if (!isCancelled) {
          setSearchSuggestions([]);
        }
      } finally {
        if (!isCancelled) {
          setIsSuggesting(false);
        }
      }
    }, 220);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [searchQuery]);

  const toggleWatchLater = (video, path = selectedPath) => {
    setWatchLater((current) => {
      if (current.some((item) => item.id === video.id)) {
        return current.filter((item) => item.id !== video.id);
      }

      return [
        {
          ...video,
          saved_at: new Date().toISOString(),
          saved_path: buildPathForVideo(video, path, syllabus)
        },
        ...current
      ];
    });
  };

  const isWatchLater = (videoId) => watchLater.some((item) => item.id === videoId);

  const updateSearchQuery = (value) => {
    setSearchQuery(value);
    if (value.trim().length < 2) {
      setSearchSuggestions([]);
    }
  };

  const runSearch = async (query = searchQuery, filters = searchFilters) => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    setLoading(true);
    setView('search');
    setSelectedPath(null);
    setSearchSuggestions([]);

    const params = new URLSearchParams();
    params.set('q', trimmedQuery);
    params.set('limit', '200');
    if (filters.subject) params.set('subject', filters.subject);
    if (filters.topicId) params.set('topicId', filters.topicId);

    try {
      const res = await axios.get(`${API_BASE}/videos?${params.toString()}`);
      setSearchResultPool(res.data);
      setVideos(filterVideosBySearchFacets(res.data, filters));
    } catch (err) {
      console.error("Search failed", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;
    runSearch();
  };

  const updateSearchFilter = (key, value) => {
    const nextFilters = { ...searchFilters, [key]: value };
    if (key === 'subject') {
      nextFilters.topicId = '';
    }

    setSearchFilters(nextFilters);
    if (view === 'search') {
      runSearch(searchQuery, nextFilters);
    }
  };

  const selectPath = async (path) => {
    setView('category');
    setSelectedPath(path);
    setIsSidebarOpen(false);

    if (!path.topic) {
      setVideos([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const params = new URLSearchParams();
    if (path.subject) params.set('subject', path.subject);
    if (path.theme) params.set('theme', path.theme.id);
    if (path.topic) params.set('topicId', path.topic.id);

    try {
      const res = await axios.get(`${API_BASE}/videos?${params.toString()}`);
      setVideos(res.data);
    } catch (err) {
      console.error("Failed to fetch browse videos", err);
    } finally {
      setLoading(false);
    }
  };

  const selectSubject = (subjectKey) => {
    const subject = syllabus[subjectKey];
    if (!subject) return;
    selectPath({ subject: subjectKey, subjectTitle: subject.title });
  };

  const selectTheme = (subjectKey, theme) => {
    const subject = syllabus[subjectKey];
    selectPath({ subject: subjectKey, subjectTitle: subject?.title || subjectKey, theme });
  };

  const selectTopic = (subjectKey, theme, topic) => {
    const subject = syllabus[subjectKey];
    selectPath({ subject: subjectKey, subjectTitle: subject?.title || subjectKey, theme, topic });
  };

  const showWatchLater = () => {
    setView('watchLater');
    setSelectedPath(null);
    setSelectedVideo(null);
    setIsSidebarOpen(false);
  };

  return (
    <div data-theme={theme} className="min-h-screen bg-[var(--zen-paper)] text-[var(--zen-ink)] selection:bg-[var(--zen-coral)]/20">
      {/* Dynamic Background */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 zen-paper-texture"></div>
      </div>

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 h-20 z-50 px-8 flex items-center justify-between backdrop-blur-xl border-b-2 border-[var(--zen-line)] bg-[var(--zen-paper)]/90">
        <div className="flex items-center gap-6">
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="p-3 hover:bg-[var(--zen-muted)] rounded-lg transition-all group"
          >
            <Menu size={20} className="group-hover:scale-110 transition-transform" />
          </button>
          <div 
            onClick={() => {
              setView('home');
              setSelectedPath(null);
            }} 
            className="hi-brand text-2xl font-black tracking-tighter cursor-pointer hover:opacity-80 transition-opacity"
          >
            HI
          </div>
        </div>

        <div className="relative flex-1 max-w-xl px-12">
          {view !== 'home' && view !== 'watchLater' && (
            <form onSubmit={handleSearch} className="search-box-3d h-12">
              <Search className="ml-4 text-[var(--zen-muted-text)]" size={18} />
              <input 
                type="text"
                placeholder="Search resources..."
                className="flex-1 px-4 text-sm"
                value={searchQuery}
                onChange={(e) => updateSearchQuery(e.target.value)}
              />
            </form>
          )}
          {view !== 'home' && view !== 'watchLater' && (
            <SearchSuggestions
              query={searchQuery}
              suggestions={searchSuggestions}
              isLoading={isSuggesting}
              onSelect={setSelectedVideo}
            />
          )}
        </div>

        <div className="flex items-center gap-4">
           <div className="relative">
             <button
               onClick={() => setIsSettingsOpen((current) => !current)}
               className={`p-2 transition-colors ${isSettingsOpen ? 'text-[var(--zen-coral)]' : 'text-[var(--zen-muted-text)] hover:text-[var(--zen-ink)]'}`}
               aria-label="Open settings"
             >
               <SlidersHorizontal size={20} />
             </button>
             <AnimatePresence>
               {isSettingsOpen && (
                 <motion.div
                   initial={{ opacity: 0, y: -8 }}
                   animate={{ opacity: 1, y: 0 }}
                   exit={{ opacity: 0, y: -8 }}
                   className="settings-panel"
                 >
                   <div className="settings-title">Settings</div>
                   <div className="settings-label">Theme</div>
                   <div className="grid gap-1">
                     {THEME_OPTIONS.map((option) => (
                       <button
                         key={option.id}
                         onClick={() => {
                           setTheme(option.id);
                           setIsSettingsOpen(false);
                         }}
                         className="theme-choice"
                       >
                         <span>
                           <span className="theme-choice-name">{option.name}</span>
                           <span className="theme-choice-note">{option.note}</span>
                         </span>
                         {theme === option.id && <Check size={16} />}
                       </button>
                     ))}
                   </div>
                 </motion.div>
               )}
             </AnimatePresence>
           </div>
           <button
             onClick={showWatchLater}
             className={`p-2 transition-colors ${view === 'watchLater' ? 'text-[var(--zen-coral)]' : 'text-[var(--zen-muted-text)] hover:text-[var(--zen-ink)]'}`}
             aria-label="Open watch later"
           >
             <Bookmark size={20} />
           </button>
           <a
             href="https://www.youtube.com/@TheOrganicChemistryTutor"
             target="_blank"
             rel="noreferrer"
             aria-label="Open The Organic Chemistry Tutor on YouTube"
             className="p-2 text-[var(--zen-muted-text)] hover:text-[var(--zen-ink)] transition-colors"
           >
             <CirclePlay size={20} />
           </a>
           <a
             href="https://www.youtube.com"
             target="_blank"
             rel="noreferrer"
             aria-label="Open YouTube"
             className="p-2 text-[var(--zen-muted-text)] hover:text-[var(--zen-ink)] transition-colors"
           >
             <ExternalLink size={20} />
           </a>
        </div>
      </nav>

      {/* Sidebar */}
      <AnimatePresence>
        {isSidebarOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
            />
            <motion.aside 
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 left-0 bottom-0 w-80 bg-[var(--zen-surface)] border-r-2 border-[var(--zen-line)] z-[70] flex flex-col"
            >
              <div className="p-8 flex items-center justify-between border-b-2 border-[var(--zen-line)]">
                <span className="hi-brand font-black text-xl tracking-tighter">HI GUIDE</span>
                <button onClick={() => setIsSidebarOpen(false)} className="p-2 hover:bg-[var(--zen-muted)] rounded-lg transition-colors">
                  <X size={20} />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto sidebar-scroll p-4">
                <div className="flex flex-col gap-2">
                  {Object.entries(syllabus).map(([key, subject]) => (
                    <SubjectAccordion 
                      key={key} 
                      subjectKey={key}
                      subject={subject} 
                      onSelectSubject={selectSubject}
                      onSelectTheme={selectTheme}
                      onSelectTopic={selectTopic}
                      isActive={selectedPath?.subject === key}
                    />
                  ))}
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="pt-20 min-h-screen">
        <AnimatePresence mode="wait">
          {view === 'home' ? (
            <motion.div
              key="home"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="px-8 py-20"
            >
              <HomeView 
                syllabus={syllabus} 
                onSelectSubject={selectSubject}
                onSearch={handleSearch}
                searchQuery={searchQuery}
                setSearchQuery={updateSearchQuery}
                suggestions={searchSuggestions}
                isSuggesting={isSuggesting}
                onSelectSuggestion={setSelectedVideo}
              />
            </motion.div>
          ) : view === 'watchLater' ? (
            <motion.div
              key="watch-later"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="px-8 py-12 max-w-[1600px] mx-auto"
            >
              <WatchLaterView
                videos={watchLater}
                onPlay={setSelectedVideo}
                onRemove={(video) => toggleWatchLater(video)}
                onNavigate={selectPath}
              />
            </motion.div>
          ) : (
            <motion.div
              key="content"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="px-8 py-12 max-w-[1600px] mx-auto"
            >
              <div className="mb-16">
                {view === 'category' && (
                  <Breadcrumbs path={selectedPath} onSubject={selectSubject} onTheme={selectTheme} onTopic={selectTopic} />
                )}
                <div className="flex items-center gap-2 text-[var(--zen-coral)] font-bold text-[10px] uppercase tracking-[0.2em] mb-4">
                   <Layers size={12} />
                   <span>{view === 'search' ? 'Search Results' : `IB ${selectedPath?.subject}`}</span>
                </div>
                <h1 className="text-6xl font-black tracking-tighter mb-4">
                  {view === 'search' ? `"${searchQuery}"` : getPathTitle(selectedPath)}
                </h1>
                <p className="text-[var(--zen-muted-text)] max-w-2xl text-lg">
                  {view === 'search'
                    ? `Showing ${videos.length} results matching your search query.`
                    : selectedPath?.topic
                      ? `Showing ${videos.length} videos for this subtopic.`
                      : 'Choose the next part of the directory to narrow the lesson list.'}
                </p>
                {view === 'search' && (
                  <SearchFilters
                    filters={searchFilters}
                    syllabus={syllabus}
                    resultCount={videos.length}
                    poolCount={searchResultPool.length}
                    onChange={updateSearchFilter}
                  />
                )}
              </div>

              {loading ? (
                <div className="flex flex-col items-center justify-center py-40 gap-4">
                  <div className="w-12 h-12 border-2 border-[var(--zen-coral)] border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-[var(--zen-muted-text)] font-bold tracking-widest text-xs uppercase">Curating content</span>
                </div>
              ) : view === 'category' && getPathStage(selectedPath) !== 'videos' ? (
                <CategoryMenu
                  path={selectedPath}
                  syllabus={syllabus}
                  onTheme={selectTheme}
                  onTopic={selectTopic}
                />
              ) : (
                <div className="video-grid">
                  {videos.map((video, index) => (
                    <motion.div
                      key={video.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                    >
                      <VideoCard
                        video={video}
                        onPlay={() => setSelectedVideo(video)}
                        isSaved={isWatchLater(video.id)}
                        onToggleWatchLater={() => toggleWatchLater(video)}
                      />
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Video Modal */}
      <AnimatePresence>
        {selectedVideo && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-6 md:p-12"
          >
            <div className="absolute inset-0 bg-black/90 backdrop-blur-2xl" onClick={() => setSelectedVideo(null)}></div>
            <CustomVideoPlayer
              key={selectedVideo.id}
              video={selectedVideo}
              onClose={() => setSelectedVideo(null)}
              onSelectVideo={setSelectedVideo}
              isSaved={isWatchLater(selectedVideo.id)}
              onToggleWatchLater={() => toggleWatchLater(selectedVideo)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Breadcrumbs({ path, onSubject, onTheme, onTopic }) {
  if (!path?.subject) {
    return null;
  }

  return (
    <div className="mb-8 flex flex-wrap items-center gap-2 text-sm font-black uppercase tracking-[0.16em]">
      <button onClick={() => onSubject(path.subject)} className="breadcrumb-text-link">
        {path.subjectTitle || path.subject}
      </button>
      {path.theme && (
        <>
          <ChevronRight size={14} className="text-[var(--zen-muted-text)]" />
          <button onClick={() => onTheme(path.subject, path.theme)} className="breadcrumb-text-link">
            Topic {path.theme.id}: {path.theme.title}
          </button>
        </>
      )}
      {path.topic && (
        <>
          <ChevronRight size={14} className="text-[var(--zen-muted-text)]" />
          <button onClick={() => onTopic(path.subject, path.theme, path.topic)} className="breadcrumb-text-link is-current">
            {path.topic.id}: {path.topic.title}
          </button>
        </>
      )}
    </div>
  );
}

function CategoryMenu({ path, syllabus, onTheme, onTopic }) {
  if (!path?.subject) {
    return null;
  }

  const subject = syllabus[path.subject];
  if (!subject) {
    return null;
  }

  if (!path.theme) {
    return (
      <div className="directory-menu-grid">
        {subject.themes.map((theme) => (
          <button
            key={theme.id}
            onClick={() => onTheme(path.subject, theme)}
            className="directory-text-card group"
          >
            <span className="directory-card-kicker">Topic {theme.id}</span>
            <span className="directory-card-title">{theme.title}</span>
            <span className="directory-card-meta">{theme.topics.length} subtopics</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="directory-menu-list">
      {path.theme.topics.map((topic) => (
        <button
          key={topic.id}
          onClick={() => onTopic(path.subject, path.theme, topic)}
          className="directory-text-row group"
        >
          <span className="directory-row-id">{topic.id}</span>
          <span className="directory-row-title">{topic.title}</span>
          <ChevronRight size={18} className="directory-row-icon" />
        </button>
      ))}
    </div>
  );
}

function WatchLaterView({ videos, onPlay, onRemove, onNavigate }) {
  const grouped = videos.reduce((acc, video) => {
    const path = video.saved_path || buildPathForVideo(video, null, {});
    const subjectKey = path.subject || 'other';
    const themeKey = path.theme?.id || 'misc';
    const topicKey = path.topic?.id || 'core';

    acc[subjectKey] ??= { path, themes: {} };
    acc[subjectKey].themes[themeKey] ??= { path, topics: {} };
    acc[subjectKey].themes[themeKey].topics[topicKey] ??= { path, videos: [] };
    acc[subjectKey].themes[themeKey].topics[topicKey].videos.push(video);
    return acc;
  }, {});

  return (
    <div>
      <div className="mb-12 flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="mb-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--zen-coral)]">
            <BookmarkCheck size={14} />
            <span>Watch Later</span>
          </div>
          <h1 className="text-6xl font-black tracking-tighter">Saved lessons</h1>
          <p className="mt-4 max-w-2xl text-lg text-[var(--zen-muted-text)]">Your saved videos grouped by the directory address they came from.</p>
        </div>
        <div className="rounded-xl border-2 border-[var(--zen-line)] bg-[var(--zen-muted)] px-5 py-3 text-sm font-bold text-[var(--zen-muted-text)]">
          {videos.length} saved
        </div>
      </div>

      {videos.length === 0 ? (
        <div className="rounded-2xl border-2 border-[var(--zen-line)] bg-[var(--zen-surface)] p-12 text-center">
          <FolderOpen className="mx-auto mb-4 text-[var(--zen-muted-text)]" size={42} />
          <h2 className="text-2xl font-black">Nothing saved yet</h2>
          <p className="mt-2 text-[var(--zen-muted-text)]">Use the bookmark button on any video card or in the player.</p>
        </div>
      ) : (
        <div className="grid gap-8">
          {Object.entries(grouped).map(([subjectKey, subjectGroup]) => (
            <section key={subjectKey} className="rounded-2xl border-2 border-[var(--zen-line)] bg-[var(--zen-surface)] p-6">
              <button onClick={() => onNavigate({ subject: subjectGroup.path.subject, subjectTitle: subjectGroup.path.subjectTitle })} className="mb-5 text-left text-3xl font-black tracking-tighter hover:text-[var(--zen-coral)]">
                {subjectGroup.path.subjectTitle || subjectKey}
              </button>
              <div className="grid gap-5">
                {Object.entries(subjectGroup.themes).map(([themeKey, themeGroup]) => (
                  <div key={themeKey} className="border-l-2 border-[var(--zen-line)] pl-5">
                    <button onClick={() => themeGroup.path.theme && onNavigate({ subject: themeGroup.path.subject, subjectTitle: themeGroup.path.subjectTitle, theme: themeGroup.path.theme })} className="mb-3 text-sm font-black uppercase tracking-[0.2em] text-[var(--zen-muted-text)] hover:text-[var(--zen-coral)]">
                      {themeGroup.path.theme ? `Topic ${themeGroup.path.theme.id}: ${themeGroup.path.theme.title}` : 'Unsorted'}
                    </button>
                    <div className="grid gap-4">
                      {Object.entries(themeGroup.topics).map(([topicKey, topicGroup]) => (
                        <div key={topicKey}>
                          <button onClick={() => topicGroup.path.topic && onNavigate(topicGroup.path)} className="mb-3 text-left text-lg font-black hover:text-[var(--zen-coral)]">
                            {topicGroup.path.topic ? `${topicGroup.path.topic.id}: ${topicGroup.path.topic.title}` : 'Core videos'}
                          </button>
                          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {topicGroup.videos.map((video) => (
                              <CompactVideoRow key={video.id} video={video} onPlay={() => onPlay(video)} actionLabel="Remove" onAction={() => onRemove(video)} />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function CompactVideoRow({ video, onPlay, actionLabel, onAction }) {
  return (
    <div className="flex gap-4 rounded-xl border-2 border-[var(--zen-line)] bg-[var(--zen-surface)] p-3">
      <button onClick={onPlay} className="relative h-20 w-32 shrink-0 overflow-hidden rounded-lg bg-[var(--zen-muted)]">
        <img src={video.thumbnail_medium || video.thumbnail_high || video.thumbnail_default} alt="" className="h-full w-full object-cover" />
        <div className="absolute inset-0 grid place-items-center bg-black/30">
          <Play size={18} fill="currentColor" />
        </div>
      </button>
      <div className="min-w-0 flex-1">
        <button onClick={onPlay} className="line-clamp-2 text-left text-sm font-black hover:text-[var(--zen-coral)]">{video.title}</button>
        <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-[var(--zen-muted-text)]">{video.ib_topic_id || 'Core'} {video.ib_subject}</p>
        <button onClick={onAction} className="mt-3 text-[10px] font-black uppercase tracking-widest text-[var(--zen-coral)] hover:text-[var(--zen-blue)]">{actionLabel}</button>
      </div>
    </div>
  );
}

function SearchSuggestions({ query, suggestions, isLoading, onSelect }) {
  if (query.trim().length < 2) {
    return null;
  }

  if (!isLoading && suggestions.length === 0) {
    return null;
  }

  return (
    <div className="search-suggestions">
      {isLoading && suggestions.length === 0 ? (
        <div className="search-suggestion-empty">Searching...</div>
      ) : suggestions.length === 0 ? (
        null
      ) : suggestions.map((video) => (
        <button key={video.id} type="button" onClick={() => onSelect(video)} className="search-suggestion-row">
          <img src={video.thumbnail_medium || video.thumbnail_high || video.thumbnail_default} alt="" className="search-suggestion-image" />
          <span className="min-w-0 flex-1">
            <span className="search-suggestion-title">{video.title}</span>
            <span className="search-suggestion-meta">{video.duration || 'Length unavailable'} - {video.ib_topic_id || video.ib_subject || 'Core'}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function SearchFilters({ filters, syllabus, resultCount, poolCount, onChange }) {
  const subjects = Object.entries(syllabus);
  const selectedSubject = filters.subject ? syllabus[filters.subject] : null;
  const topics = selectedSubject?.themes?.flatMap((theme) => (
    theme.topics.map((topic) => ({
      ...topic,
      label: `${topic.id}: ${topic.title}`
    }))
  )) || [];

  return (
    <div className="search-filter-panel">
      <div className="search-filter-summary">{resultCount} shown from {poolCount} matches</div>
      <label className="search-filter-field">
        <span>Subject</span>
        <select value={filters.subject} onChange={(event) => onChange('subject', event.target.value)}>
          <option value="">All subjects</option>
          {subjects.map(([key, subject]) => (
            <option key={key} value={key}>{subject.title}</option>
          ))}
        </select>
      </label>
      <label className="search-filter-field">
        <span>Subtopic</span>
        <select value={filters.topicId} onChange={(event) => onChange('topicId', event.target.value)} disabled={!filters.subject}>
          <option value="">All subtopics</option>
          {topics.map((topic) => (
            <option key={topic.id} value={topic.id}>{topic.label}</option>
          ))}
        </select>
      </label>
      <label className="search-filter-field">
        <span>Date</span>
        <select value={filters.date} onChange={(event) => onChange('date', event.target.value)}>
          {SEARCH_DATE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

function loadYouTubeIframeApi() {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (!youtubeApiPromise) {
    youtubeApiPromise = new Promise((resolve, reject) => {
      const previousReady = window.onYouTubeIframeAPIReady;
      const timeoutId = window.setTimeout(() => {
        if (!window.YT?.Player) {
          youtubeApiPromise = null;
          reject(new Error('YouTube player API timed out'));
        }
      }, 10000);

      window.onYouTubeIframeAPIReady = () => {
        window.clearTimeout(timeoutId);
        if (typeof previousReady === 'function') {
          previousReady();
        }
        resolve(window.YT);
      };

      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
        script.onerror = () => {
          window.clearTimeout(timeoutId);
          youtubeApiPromise = null;
          reject(new Error('YouTube player API failed to load'));
        };
        document.body.appendChild(script);
      }
    });
  }

  return youtubeApiPromise;
}

function getYouTubeVideoId(video) {
  if (video.id) {
    return video.id;
  }

  const url = video.embed_url || video.youtube_url || '';
  const match = url.match(/(?:embed\/|watch\?v=|youtu\.be\/)([^?&/]+)/);
  return match?.[1] || '';
}

function LinkifiedText({ text }) {
  if (!text) {
    return 'No description stored for this video yet.';
  }

  return String(text).split(/(https?:\/\/[^\s]+)/g).map((part, index) => {
    if (!part.match(/^https?:\/\//)) {
      return <Fragment key={`${part}-${index}`}>{part}</Fragment>;
    }

    const match = part.match(/^(.*?)([).,;:!?]*)$/);
    const url = match?.[1] || part;
    const trailing = match?.[2] || '';

    return (
      <Fragment key={`${url}-${index}`}>
        <a href={url} target="_blank" rel="noreferrer" className="description-link">
          {url}
        </a>
        {trailing}
      </Fragment>
    );
  });
}

function CustomVideoPlayer({ video, onClose, onSelectVideo, isSaved, onToggleWatchLater }) {
  const mountRef = useRef(null);
  const playerRef = useRef(null);
  const captureStreamRef = useRef(null);
  const captureVideoRef = useRef(null);
  const captureImageRef = useRef(null);
  const cropDragRef = useRef(null);
  const [isReady, setIsReady] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [relatedVideos, setRelatedVideos] = useState([]);
  const [status, setStatus] = useState('Loading player');
  const [captureStatus, setCaptureStatus] = useState('');
  const [captureImage, setCaptureImage] = useState(null);
  const [cropRect, setCropRect] = useState(null);
  const [useFallbackEmbed, setUseFallbackEmbed] = useState(false);
  const videoId = getYouTubeVideoId(video);

  useEffect(() => {
    let isCancelled = false;

    const loadFallbackRelated = async () => {
      const params = new URLSearchParams();
      params.set('limit', '120');
      if (video.ib_subject) params.set('subject', video.ib_subject);

      const res = await axios.get(`${API_BASE}/videos?${params.toString()}`);
      return res.data
        .filter((candidate) => candidate.id !== video.id)
        .map((candidate) => ({
          ...candidate,
          relation_score: scoreRelatedVideo(video, candidate)
        }))
        .filter((candidate) => candidate.relation_score > 0)
        .sort((a, b) => b.relation_score - a.relation_score || new Date(b.published_at) - new Date(a.published_at))
        .slice(0, 10);
    };

    axios.get(`${API_BASE}/videos/${video.id}/related?limit=10`)
      .then((res) => {
        if (!isCancelled) {
          setRelatedVideos(res.data);
        }
      })
      .catch(async () => {
        if (!isCancelled) {
          try {
            setRelatedVideos(await loadFallbackRelated());
          } catch {
            setRelatedVideos([]);
          }
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [video]);

  useEffect(() => {
    let isCancelled = false;

    loadYouTubeIframeApi().then((YT) => {
      if (isCancelled || !mountRef.current || !videoId) {
        return;
      }

      const player = new YT.Player(mountRef.current, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 1,
          controls: 1,
          disablekb: 0,
          enablejsapi: 1,
          fs: 1,
          modestbranding: 1,
          origin: window.location.origin,
          playsinline: 1,
          rel: 0
        },
        events: {
          onReady: (event) => {
            if (isCancelled) {
              return;
            }

            playerRef.current = event.target;
            event.target.setVolume(DEFAULT_PLAYER_VOLUME);
            setIsReady(true);
            setStatus('Ready');
            event.target.playVideo();
          },
          onStateChange: (event) => {
            if (!window.YT?.PlayerState) {
              return;
            }

            if (event.data === window.YT.PlayerState.PLAYING) {
              setStatus('Playing');
            } else if (event.data === window.YT.PlayerState.PAUSED) {
              setStatus('Paused');
            } else if (event.data === window.YT.PlayerState.ENDED) {
              setStatus('Finished');
            } else if (event.data === window.YT.PlayerState.BUFFERING) {
              setStatus('Buffering');
            }
          },
          onError: () => {
            setUseFallbackEmbed(true);
            setStatus('Standard embed');
          }
        }
      });

      playerRef.current = player;
    }).catch(() => {
      if (!isCancelled) {
        setUseFallbackEmbed(true);
        setStatus('Standard embed');
      }
    });

    return () => {
      isCancelled = true;
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
  }, [videoId]);

  useEffect(() => {
    return () => {
      captureStreamRef.current?.getTracks?.().forEach((track) => track.stop());
      captureStreamRef.current = null;
      captureVideoRef.current = null;
    };
  }, []);

  const ensureCaptureVideo = async () => {
    const activeStream = captureStreamRef.current;
    const isActive = activeStream?.getVideoTracks?.().some((track) => track.readyState === 'live');

    if (!activeStream || !isActive) {
      setCaptureStatus('Choose this tab or window once');
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 10 },
        audio: false
      });
      captureStreamRef.current = stream;
      captureVideoRef.current = null;
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        captureStreamRef.current = null;
        captureVideoRef.current = null;
        setCaptureStatus('Capture permission ended');
      });
    }

    if (!captureVideoRef.current) {
      const screenVideo = document.createElement('video');
      screenVideo.srcObject = captureStreamRef.current;
      screenVideo.muted = true;
      screenVideo.playsInline = true;
      await screenVideo.play();
      captureVideoRef.current = screenVideo;
    }

    return captureVideoRef.current;
  };

  const prepareScreenCapture = async () => {
    try {
      const screenVideo = await ensureCaptureVideo();
      const width = screenVideo.videoWidth;
      const height = screenVideo.videoHeight;

      if (!width || !height) {
        throw new Error('Capture stream is not ready');
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(screenVideo, 0, 0, width, height);

      setCaptureImage(canvas.toDataURL('image/png'));
      setCropRect(null);
      setCaptureStatus('Drag to select an area');
    } catch (err) {
      setCaptureStatus(err.name === 'NotAllowedError' ? 'Capture cancelled' : 'Capture unavailable');
    }
  };

  const getCropPoint = (event) => {
    const image = captureImageRef.current;
    if (!image) {
      return { x: 0, y: 0 };
    }

    const bounds = image.getBoundingClientRect();
    const x = Math.max(0, Math.min(event.clientX - bounds.left, bounds.width));
    const y = Math.max(0, Math.min(event.clientY - bounds.top, bounds.height));
    return { x, y };
  };

  const startCrop = (event) => {
    const point = getCropPoint(event);
    cropDragRef.current = point;
    setCropRect({ x: point.x, y: point.y, width: 0, height: 0 });
  };

  const moveCrop = (event) => {
    if (!cropDragRef.current) return;

    const start = cropDragRef.current;
    const point = getCropPoint(event);
    setCropRect({
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y)
    });
  };

  const finishCrop = () => {
    cropDragRef.current = null;
  };

  const copySelectedCapture = async () => {
    try {
      const image = captureImageRef.current;
      if (!image || !cropRect || cropRect.width < 8 || cropRect.height < 8) {
        setCaptureStatus('Select a larger area first');
        return;
      }

      const scaleX = image.naturalWidth / image.getBoundingClientRect().width;
      const scaleY = image.naturalHeight / image.getBoundingClientRect().height;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(cropRect.width * scaleX);
      canvas.height = Math.round(cropRect.height * scaleY);
      canvas.getContext('2d').drawImage(
        image,
        cropRect.x * scaleX,
        cropRect.y * scaleY,
        cropRect.width * scaleX,
        cropRect.height * scaleY,
        0,
        0,
        canvas.width,
        canvas.height
      );

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob || !navigator.clipboard?.write || !window.ClipboardItem) {
        throw new Error('Clipboard image copy is unavailable');
      }

      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCaptureStatus('Selected area copied to clipboard');
      setCaptureImage(null);
      setCropRect(null);
    } catch (err) {
      setCaptureStatus(err.name === 'NotAllowedError' ? 'Capture cancelled' : 'Capture copy unavailable');
    }
  };

  return (
    <motion.div
      initial={{ scale: 0.9, y: 40 }}
      animate={{ scale: 1, y: 0 }}
      exit={{ scale: 0.9, y: 40 }}
      className="relative w-full max-w-[1500px] overflow-hidden rounded-[1.5rem] border-2 border-[var(--zen-line)] bg-[var(--zen-surface)] shadow-[0_24px_80px_rgba(46,46,46,0.16)]"
    >
      <div className="grid max-h-[92vh] overflow-y-auto bg-[var(--zen-surface)]">
        <div className="flex items-center justify-between gap-4 border-b-2 border-[var(--zen-line)] px-5 py-4">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--zen-coral)]">
              <CirclePlay size={13} />
              <span>{status}</span>
            </div>
            <h2 className="truncate text-xl font-black tracking-tight text-[var(--zen-ink)]">{video.title}</h2>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={prepareScreenCapture} className="player-icon-button" aria-label="Capture selected screen area">
              <Camera size={18} />
            </button>
            <button onClick={onToggleWatchLater} className="player-icon-button" aria-label={isSaved ? 'Remove from watch later' : 'Save to watch later'}>
              {isSaved ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
            </button>
            <a href={video.youtube_url} target="_blank" rel="noreferrer" className="player-icon-button" aria-label="Open video on YouTube">
              <ExternalLink size={18} />
            </a>
            <button onClick={onClose} className="player-icon-button" aria-label="Close player">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div>
            <div className="relative bg-black">
              <div className="aspect-video">
                {useFallbackEmbed ? (
                  <iframe
                    title={video.title}
                    src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&playsinline=1&controls=1`}
                    className="h-full w-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  />
                ) : (
                  <div ref={mountRef} className="h-full w-full" />
                )}
              </div>

              {!isReady && !useFallbackEmbed && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black text-white/50">
                  <Loader2 className="animate-spin text-indigo-400" size={34} />
                  <span className="text-[10px] font-black uppercase tracking-[0.2em]">Preparing video</span>
                </div>
              )}
            </div>

            {captureStatus && (
              <div className="border-t-2 border-[var(--zen-line)] bg-[var(--zen-muted)] px-5 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--zen-muted-text)]">
                {captureStatus}
              </div>
            )}

            <div className="border-t-2 border-[var(--zen-line)] bg-[var(--zen-surface)] p-6">
              <button onClick={() => setDescriptionOpen(!descriptionOpen)} className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-[var(--zen-muted-text)] hover:text-[var(--zen-coral)]">
                Description {descriptionOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
              <p className={`${descriptionOpen ? '' : 'line-clamp-3'} whitespace-pre-wrap text-sm leading-relaxed text-[var(--zen-muted-text)]`}>
                <LinkifiedText text={video.description} />
              </p>
            </div>
          </div>

          <aside className="border-t-2 border-[var(--zen-line)] bg-[var(--zen-muted)] p-5 xl:border-l-2 xl:border-t-0">
            <div className="mb-5 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--zen-coral)]">
              <ListVideo size={14} />
              <span>Related videos</span>
            </div>
            <div className="grid gap-3">
              {relatedVideos.length === 0 ? (
                <p className="rounded-xl border-2 border-[var(--zen-line)] bg-[var(--zen-surface)] p-4 text-sm text-[var(--zen-muted-text)]">No close matches found yet.</p>
              ) : relatedVideos.map((related) => (
                <CompactVideoRow key={related.id} video={related} onPlay={() => onSelectVideo(related)} actionLabel="Play next" onAction={() => onSelectVideo(related)} />
              ))}
            </div>
          </aside>
        </div>
      </div>
      <AnimatePresence>
        {captureImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="capture-crop-modal"
          >
            <div className="capture-crop-panel">
              <div className="capture-crop-header">
                <span>Drag to select capture area</span>
                <button onClick={() => setCaptureImage(null)} aria-label="Close capture cropper">
                  <X size={18} />
                </button>
              </div>
              <div
                className="capture-crop-stage"
                onPointerDown={startCrop}
                onPointerMove={moveCrop}
                onPointerUp={finishCrop}
                onPointerLeave={finishCrop}
              >
                <img ref={captureImageRef} src={captureImage} alt="Captured screen preview" draggable="false" />
                {cropRect && (
                  <div
                    className="capture-crop-rect"
                    style={{
                      left: cropRect.x,
                      top: cropRect.y,
                      width: cropRect.width,
                      height: cropRect.height
                    }}
                  />
                )}
              </div>
              <div className="capture-crop-actions">
                <span>{cropRect?.width > 8 && cropRect?.height > 8 ? 'Selection ready' : 'Select the part you want copied'}</span>
                <button onClick={copySelectedCapture}>Copy selection</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function SubjectAccordion({ subjectKey, subject, onSelectSubject, onSelectTheme, onSelectTopic, isActive }) {
  const [isOpen, setIsOpen] = useState(isActive);

  return (
    <div className="flex flex-col">
      <button 
        onClick={() => {
          setIsOpen(!isOpen);
          onSelectSubject(subjectKey);
        }}
        className={`flex items-center justify-between p-4 rounded-xl transition-all ${isActive ? 'bg-[var(--zen-muted)] text-[var(--zen-coral)]' : 'hover:bg-[var(--zen-muted)] text-[var(--zen-muted-text)] hover:text-[var(--zen-ink)]'}`}
      >
        <div className="flex items-center gap-3">
           <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-[var(--zen-coral)] shadow-[0_0_8px_var(--accent)]' : 'bg-[var(--zen-line)]'}`}></div>
           <span className="font-bold text-sm">{subject.title}</span>
        </div>
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden flex flex-col ml-6 mt-1 border-l-2 border-[var(--zen-line)]"
          >
            {subject.themes.map(theme => (
              <div key={theme.id} className="flex flex-col py-2">
                <button
                  onClick={() => onSelectTheme(subjectKey, theme)}
                  className="px-4 py-2 text-left text-[9px] uppercase tracking-[0.2em] text-[var(--zen-muted-text)] hover:text-[var(--zen-coral)] font-black"
                >
                  {theme.title}
                </button>
                {theme.topics.map(topic => (
                  <button 
                    key={topic.id}
                    onClick={() => onSelectTopic(subjectKey, theme, topic)}
                    className="px-4 py-2 text-xs text-left text-[var(--zen-muted-text)] hover:text-[var(--zen-coral)] hover:bg-[var(--zen-muted)] rounded-lg transition-all flex items-center gap-3 group"
                  >
                    <span className="w-5 text-[10px] font-black opacity-30 group-hover:opacity-100 transition-opacity">{topic.id}</span>
                    <span className="flex-1 truncate">{topic.title}</span>
                  </button>
                ))}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function HomeView({ syllabus, onSelectSubject, onSearch, searchQuery, setSearchQuery, suggestions, isSuggesting, onSelectSuggestion }) {
  return (
    <div className="max-w-6xl mx-auto flex flex-col items-center">
      <div className="text-center mb-24">
        <motion.h1 
          className="hi-logo mb-8"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 1, type: 'spring' }}
        >
          HI
        </motion.h1>
        <motion.p 
          className="text-[var(--zen-muted-text)] text-xl max-w-xl mx-auto leading-relaxed"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          Premium video library for IB students. <br/>
          Select a subject or search for any concept.
        </motion.p>
      </div>

      <div className="search-container-3d mb-32">
        <form onSubmit={onSearch} className="search-box-3d p-2">
          <div className="flex-1 flex items-center pl-6">
            <Search className="text-[var(--zen-muted-text)]" size={24} />
            <input 
              type="text"
              placeholder="What are we learning today?"
              className="w-full py-4 px-6 text-xl placeholder:text-[var(--zen-muted-text)]/60"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button 
            type="submit"
            className="bg-[var(--zen-coral)] hover:bg-[var(--zen-blue)] text-[var(--zen-paper)] px-10 py-4 rounded-xl font-black transition-all shadow-[0_8px_20px_rgba(247,111,83,0.22)] active:scale-95 text-sm tracking-widest"
          >
            SEARCH
          </button>
        </form>
        <SearchSuggestions
          query={searchQuery}
          suggestions={suggestions}
          isLoading={isSuggesting}
          onSelect={onSelectSuggestion}
        />
      </div>

      <div className="w-full grid grid-cols-1 md:grid-cols-3 gap-8">
        {Object.entries(syllabus).map(([key, subject], i) => (
          <motion.div 
            key={key}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 + i * 0.1 }}
            className="card-3d p-8 group cursor-pointer relative overflow-hidden"
            onClick={() => onSelectSubject(key)}
          >
            <div className="absolute -right-4 -bottom-4 text-[var(--zen-muted)] scale-[3] group-hover:text-[var(--zen-coral)]/10 transition-colors">
               {key === 'physics' && <Atom size={100} />}
               {key === 'chemistry' && <Cpu size={100} />}
               {key === 'mathematics' && <FunctionSquare size={100} />}
            </div>
            
            <div className="flex items-center justify-between mb-8">
              <div className="w-12 h-12 rounded-xl bg-[var(--zen-muted)] flex items-center justify-center group-hover:bg-[var(--zen-coral)] group-hover:text-[var(--zen-paper)] transition-colors">
                <BookOpen size={20} />
              </div>
              <ChevronRight size={20} className="text-[var(--zen-muted-text)] group-hover:text-[var(--zen-ink)] transition-colors" />
            </div>
            
            <h3 className="text-2xl font-black mb-2 tracking-tighter">{subject.title}</h3>
            <p className="text-[var(--zen-muted-text)] text-sm mb-6 leading-relaxed">
              Explore {subject.themes.length} modules covering all essential IB requirements.
            </p>
            
            <div className="flex flex-wrap gap-2">
               {subject.themes.slice(0, 2).map(t => (
                 <span key={t.id} className="text-[9px] font-black uppercase tracking-widest text-[var(--zen-muted-text)] px-3 py-1 rounded-lg border-2 border-[var(--zen-line)] group-hover:border-[var(--zen-coral)]/40 transition-colors">
                   {t.title.split(' ')[0]}
                 </span>
               ))}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function VideoCard({ video, onPlay, isSaved, onToggleWatchLater }) {
  return (
    <div className="card-3d group cursor-pointer overflow-hidden flex flex-col h-full" onClick={onPlay}>
      <div className="relative aspect-video overflow-hidden">
        <button
          onClick={(event) => {
            event.stopPropagation();
            onToggleWatchLater();
          }}
          className={`absolute left-4 top-4 z-10 rounded-full border border-[var(--zen-line)] bg-[var(--zen-paper)]/90 p-2 backdrop-blur-md transition-colors ${isSaved ? 'text-[var(--zen-coral)]' : 'text-[var(--zen-muted-text)] hover:text-[var(--zen-ink)]'}`}
          aria-label={isSaved ? 'Remove from watch later' : 'Save to watch later'}
        >
          {isSaved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
        </button>
        <img 
          src={video.thumbnail_high || video.thumbnail_medium} 
          alt={video.title} 
          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
        />
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
           <motion.div 
             whileHover={{ scale: 1.1 }}
             whileTap={{ scale: 0.9 }}
             className="w-16 h-16 bg-[var(--zen-paper)] text-[var(--zen-ink)] rounded-full flex items-center justify-center shadow-2xl"
           >
              <Play size={24} fill="currentColor" className="ml-1" />
           </motion.div>
        </div>
        <div className="absolute bottom-4 right-4 px-3 py-1 bg-[var(--zen-paper)]/90 text-[var(--zen-ink)] backdrop-blur-md rounded-full text-[10px] font-black tracking-widest border border-[var(--zen-line)] flex items-center gap-2">
           <Clock size={12} className="text-[var(--zen-coral)]" />
           {video.duration || 'Length unavailable'}
        </div>
      </div>
      
      <div className="p-6 flex-1 flex flex-col">
        <div className="flex items-center gap-3 mb-4">
           <span className="text-[10px] font-black text-[var(--zen-coral)] uppercase tracking-widest px-2 py-0.5 bg-[var(--zen-coral)]/10 rounded border border-[var(--zen-coral)]/20">
             {video.ib_topic_id || 'CORE'}
           </span>
           <span className="text-[10px] font-black text-[var(--zen-muted-text)] uppercase tracking-widest">
             {video.ib_subject}
           </span>
        </div>
        
        <h3 className="text-xl font-bold tracking-tight mb-3 line-clamp-2 leading-[1.2] group-hover:text-[var(--zen-coral)] transition-colors">
          {video.title}
        </h3>
        
        <p className="text-[var(--zen-muted-text)] text-xs line-clamp-2 mb-6 leading-relaxed flex-1">
          {video.description || "In-depth tutorial covering essential concepts and exam-style questions for the IB syllabus."}
        </p>
        
        <div className="flex items-center justify-between pt-4 border-t-2 border-[var(--zen-line)]">
           <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-[var(--zen-muted)] border border-[var(--zen-line)] overflow-hidden">
                 <img src={video.channel_thumbnail || "https://yt3.ggpht.com/ytc/AIdro_mC26S6oHlO6pX9R2oO4z8-m-zO-2S-R-R-S-R-=s88-c-k-c0x00ffffff-no-rj"} className="w-full h-full object-cover opacity-50" />
              </div>
              <span className="text-[9px] font-bold text-[var(--zen-muted-text)] uppercase tracking-widest">{new Date(video.published_at).getFullYear()}</span>
           </div>
           <span className="text-[9px] font-black text-[var(--zen-muted-text)] uppercase tracking-widest group-hover:text-[var(--zen-coral)] transition-colors">Watch Now</span>
        </div>
      </div>
    </div>
  );
}

export default App;
