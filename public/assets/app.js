'use strict';

const $ = (id) => document.getElementById(id);
const BOOT_NAV = (() => {
  try {
    // A shared link wins: /anime/<name>[/s1e3], or the older #/detail/<type>/<id> and #/<page> links
    const pm = location.pathname.match(/^\/(anime|tvshow|movie)\/([A-Za-z0-9_-]+)(?:\/s(\d+)e(\d+))?\/?$/);
    if (pm) {
      const t = pm[1] === 'tvshow' ? 'tv_show' : pm[1];
      return pm[3] != null ? { page: 'video', detailType: t, detailId: pm[2], watchS: +pm[3], watchE: +pm[4] } : { page: 'detail', detailType: t, detailId: pm[2] };
    }
    const w = location.hash.match(/^#\/watch\/([a-z_]+)\/([A-Za-z0-9_-]+)\/s(\d+)e(\d+)$/);
    if (w) return { page: 'video', detailType: w[1], detailId: w[2], watchS: +w[3], watchE: +w[4] };
    const d = location.hash.match(/^#\/detail\/([a-z_]+)\/([A-Za-z0-9_-]+)$/);
    if (d) return { page: 'detail', detailType: d[1], detailId: d[2] };
    const pg = location.pathname.match(/^\/(series|movies|schedule|search|profile|admin)\/?$/);
    if (pg) return { page: pg[1] };
    const p = location.hash.match(/^#\/([a-z]+)$/);
    if (p) return { page: p[1] };
    return null;
  } catch (e) { return null; }
})();

const isRealId = (v) => /^[0-9a-f]{24}$/.test(String(v || ''));
function slugify(t) {
  return String(t || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ').replace(/['\u2019]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
// Address-bar part for a title page: the anime name when known, otherwise the id.
function detailRef(id, title) { return slugify(title) || id; }
// Real, indexable page addresses: /anime/<name>, /tvshow/<name>, /movie/<name>, and /anime/<name>/s1e3 for the player.
const TYPE_SEG = { anime: 'anime', tv_show: 'tvshow', movie: 'movie' };
const SEG_TYPE = { anime: 'anime', tvshow: 'tv_show', movie: 'movie' };
const detailPath = (type, ref) => `/${TYPE_SEG[type] || type}/${ref}`;
const watchPath = (type, id, title, s, e) => `${detailPath(type, detailRef(id, title))}/s${s}e${e}`;
const PAGE_PATH = { home: '/', series: '/series', movies: '/movies', schedule: '/schedule', search: '/search', profile: '/profile', admin: '/admin' };
// Every in-app move is a real page load. Only the first page the browser opens may be drawn in place.
let allowSwap = false;
function gotoUrl(url) { location.assign(url); }
const WATCH_RE = /^#\/watch\/([a-z_]+)\/([A-Za-z0-9_-]+)\/s(\d+)e(\d+)$/; // older hash links still work
function parseHash(h) {
  let m = (h || '').match(WATCH_RE);
  if (m) return { page: 'video', detailType: m[1], detailId: m[2], watchS: +m[3], watchE: +m[4] };
  m = (h || '').match(/^#\/detail\/([a-z_]+)\/([A-Za-z0-9_-]+)$/);
  if (m) return { page: 'detail', detailType: m[1], detailId: m[2] };
  m = (h || '').match(/^#\/([a-z]+)$/);
  return m ? { page: m[1] } : null;
}
// Current address -> page. Real paths (/anime/naruto/s1e3) first, then the older #/ hash links.
function parseLocation() {
  const m = location.pathname.match(/^\/(anime|tvshow|movie)\/([A-Za-z0-9_-]+)(?:\/s(\d+)e(\d+))?\/?$/);
  if (m) {
    const detailType = SEG_TYPE[m[1]];
    return m[3] != null ? { page: 'video', detailType, detailId: m[2], watchS: +m[3], watchE: +m[4] } : { page: 'detail', detailType, detailId: m[2] };
  }
  const pg = location.pathname.match(/^\/(series|movies|schedule|search|profile|admin)\/?$/);
  if (pg) return { page: pg[1] };
  return parseHash(location.hash);
}

// Haptic feedback: Telegram native haptics, or phone vibration. Respects on/off + intensity.
let _lastBuzz = 0;
function hapticSettings() {
  try {
    const on = localStorage.getItem('anicore_haptic_on');
    const level = localStorage.getItem('anicore_haptic_level') || 'medium';
    return { on: on === null ? true : on === '1', level: ['light', 'medium', 'heavy'].includes(level) ? level : 'medium' };
  } catch (e) { return { on: true, level: 'medium' }; }
}
function setHapticSettings({ on, level }) {
  try {
    if (on != null) localStorage.setItem('anicore_haptic_on', on ? '1' : '0');
    if (level) localStorage.setItem('anicore_haptic_level', level);
  } catch (e) { /* noop */ }
  syncHapticControls();
}
function syncHapticControls() {
  const s = hapticSettings();
  const onEl = $('hapticOn'), lvEl = $('hapticLevel');
  if (onEl) onEl.checked = s.on;
  if (lvEl) { lvEl.value = s.level; lvEl.disabled = !s.on; }
}
function buzz() { /* haptics removed: the site behaves like a normal website */ }
const PLACEHOLDER = 'https://placehold.co/400x600/17101e/ffffff?text=ANICORE';
const PAGE_SIZE = 20;
const APP_JS_VERSION = 'v54';

console.log('[anicore] app.js loaded —', APP_JS_VERSION);

const state = {
  user: null,
  authMode: 'login',
  page: BOOT_NAV?.page || 'home',
  detailId: BOOT_NAV?.detailId || null,
  detailType: BOOT_NAV?.detailType || null,
  genres: [],
  theme: localStorage.getItem('anicore-theme') || 'dark',
};

// Install popup: start right away so a slow/failed API call can never block it

// videoContext = { type, contentId, contentTitle, episodes: [...], currentIndex: 0 }
let videoContext = null;

const PAGE_ORDER = ['home', 'search', 'series', 'movies', 'schedule', 'profile', 'admin', 'detail', 'video'];

const LISTS = {
  anime: {
    endpoint: '/api/anime', grid: 'seriesGrid', sentinel: 'seriesSentinel', empty: 'seriesEmpty',
    search: 'seriesSearch', genre: 'seriesGenre', status: 'seriesStatus', sort: 'seriesSort', chips: 'seriesChips',
    page: 0, total: 0, loading: false, q: '', genreVal: '', statusVal: '', sortVal: 'newest',
  },
  tv_show: {
    endpoint: '/api/tvshows', grid: 'seriesGrid', sentinel: 'seriesSentinel', empty: 'seriesEmpty',
    search: 'seriesSearch', genre: 'seriesGenre', status: 'seriesStatus', sort: 'seriesSort', chips: 'seriesChips',
    page: 0, total: 0, loading: false, q: '', genreVal: '', statusVal: '', sortVal: 'newest',
  },
  movie: {
    endpoint: '/api/movies', grid: 'movieGrid', sentinel: 'movieSentinel', empty: 'movieEmpty',
    search: 'movieSearch', genre: 'movieGenre', status: 'movieStatus', sort: 'movieSort', chips: 'movieChips',
    page: 0, total: 0, loading: false, q: '', genreVal: '', statusVal: '', sortVal: 'newest',
  },
};

// Series tab filter: 'all' | 'anime' | 'tv_show'
let seriesTypeFilter = 'all';

async function loadSeries(reset = false) {
  const grid = $("seriesGrid");
  const empty = $("seriesEmpty");
  if (!grid) return;

  if (reset) {
    LISTS.anime.page = 0;
    LISTS.tv_show.page = 0;
    grid.innerHTML = "";
    if (empty) empty.classList.add("hidden");
  }

  const types =
    seriesTypeFilter === "all"
      ? ["anime", "tv_show"]
      : seriesTypeFilter === "tv_show"
        ? ["tv_show"]
        : ["anime"];

  // Sync filters from shared series controls
  const q = ($("seriesSearch")?.value || "").trim();
  const genre = $("seriesGenre")?.value || "";
  const status = $("seriesStatus")?.value || "";
  const sort = $("seriesSort")?.value || "newest";

  const allItems = [];
  await Promise.all(
    types.map(async (type) => {
      const l = LISTS[type];
      l.q = q;
      l.genreVal = genre;
      l.statusVal = status;
      l.sortVal = sort;
      try {
        const params = new URLSearchParams({
          page: "1",
          limit: "40",
          sort: sort,
          expand_seasons: "true",
        });
        if (q) params.set("q", q);
        if (genre) params.set("genre", genre);
        if (status) params.set("status", status);
        const data = await api(`${l.endpoint}?${params}`);
        const items = Array.isArray(data) ? data : data.items || [];
        items.forEach((it) => {
          it._type = type;
          allItems.push(it);
        });
      } catch (err) {
        console.warn("series load", type, err);
      }
    })
  );

  // Sort combined
  const sortKey = sort;
  allItems.sort((a, b) => {
    if (sortKey === "title") return (a.title || "").localeCompare(b.title || "");
    if (sortKey === "year") return (b.year || 0) - (a.year || 0);
    if (sortKey === "rating") return (b.avg_rating || 0) - (a.avg_rating || 0);
    if (sortKey === "views") return (b.views || 0) - (a.views || 0);
    return String(b.created_at || "").localeCompare(String(a.created_at || ""));
  });

  if (!allItems.length) {
    grid.innerHTML = "";
    if (empty) {
      empty.textContent = "No series found.";
      empty.classList.remove("hidden");
    }
    return;
  }
  if (empty) empty.classList.add("hidden");
  renderGrid(grid, allItems, "anime");
}

function wireSeriesPage() {
  document.querySelectorAll(".series-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".series-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      seriesTypeFilter = btn.dataset.seriesType || "all";
      loadSeries(true);
    });
  });

  let timer;
  $("seriesSearch")?.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => loadSeries(true), 280);
  });
  ["seriesGenre", "seriesStatus", "seriesSort"].forEach((id) => {
    $(id)?.addEventListener("change", () => loadSeries(true));
  });
}




const PAGE_TYPES = { movies: 'movie' };
const SERIES_TYPES = ['anime', 'tv_show'];


// --- i18n ---
const I18N = {
  en: {
    home: "Home", search: "Search", series: "Series", anime: "Anime", tv: "TV Shows", movies: "Movies",
    profile: "Profile", admin: "Admin", recommended: "Recommended for You",
    schedule: "Schedule", activity: "Your Activity", preferences: "Preferences",
    signIn: "Sign In", logout: "Logout", save: "Save Preferences",
  },
  hi: {
    home: "होम", search: "खोजें", series: "सीरीज़", anime: "एनिमे", tv: "टीवी शो", movies: "फ़िल्में",
    profile: "प्रोफ़ाइल", admin: "एडमिन", recommended: "आपके लिए सुझाव",
    schedule: "शेड्यूल", activity: "आपकी गतिविधि", preferences: "प्राथमिकताएँ",
    signIn: "साइन इन", logout: "लॉग आउट", save: "सेव करें",
  },
};

function t(key) {
  return (I18N[state.language] || I18N.en)[key] || key;
}

function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key && t(key)) el.textContent = t(key);
  });
}


// --- Helpers ---

// --- Season 0 = OVA / Specials ---
function seasonNum(v, def = 1) {
  if (v === '' || v == null) return def;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : def;
}
function epSortKey(s) { return Number(s) === 0 ? 1e6 : (Number(s) || 0); }
function cmpEp(a, b) { return (epSortKey(a.season) - epSortKey(b.season)) || (a.episode - b.episode); }
function seasonLabel(n) { return Number(n) === 0 ? 'Specials / OVA' : `Season ${n}`; }
// OVA / Special episodes live inside their season. They are stored as episode 1000+n (OVA)
// or 2000+n (Special) so they never clash with normal episode numbers, and always sort last.
function kindBase(kind) { return kind === 'ova' ? 1000 : kind === 'special' ? 2000 : 0; }
function epKind(ep) { const n = Number(ep.episode); return n >= 2000 ? 'special' : n >= 1000 ? 'ova' : 'episode'; }
function epNo(ep) { const n = Number(ep.episode); return n >= 1000 ? n % 1000 : n; }
function epBadge(ep) {
  const k = Number(ep.season) === 0 ? 'special' : epKind(ep);
  return `${k === 'ova' ? 'OVA' : k === 'special' ? 'SP' : 'EP'} ${epNo(ep)}`;
}
function epName(ep) {
  const k = Number(ep.season) === 0 ? 'special' : epKind(ep);
  return `${k === 'ova' ? 'OVA' : k === 'special' ? 'Special' : 'Episode'} ${epNo(ep)}`;
}
function epCode(ep, compact = false) {
  const k = Number(ep.season) === 0 ? 'special' : epKind(ep);
  const n = epNo(ep);
  if (k === 'special') return compact ? `SP${n}` : `SP ${n}`;
  if (k === 'ova') return compact ? `S${ep.season}OVA${n}` : `S${ep.season} · OVA ${n}`;
  return compact ? `S${ep.season}E${n}` : `S${ep.season} · E${n}`;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const LOW_DATA_KEY = 'anicore_low_data';
let lowData = false;
try { lowData = localStorage.getItem(LOW_DATA_KEY) === '1'; } catch { /* ignore */ }
document.documentElement.classList.toggle('low-data', lowData);

// Low-data mode: ask AniList's CDN for the smaller image size.
function lowDataUrl(url) {
  return lowData ? url.replace(/\/(extraLarge|large)\//, '/medium/') : url;
}

// Lazy-load every image, including ones added later, so slow connections open the page fast.
(function lazyImages() {
  const mark = (img) => {
    if (!img.hasAttribute('loading')) img.setAttribute('loading', 'lazy');
    if (!img.hasAttribute('decoding')) img.setAttribute('decoding', 'async');
  };
  document.querySelectorAll('img').forEach(mark);
  new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach((n) => {
    if (n.nodeType !== 1) return;
    if (n.tagName === 'IMG') mark(n);
    n.querySelectorAll?.('img').forEach(mark);
  }))).observe(document.documentElement, { childList: true, subtree: true });
})();

function safeUrl(url) {
  url = (url || '').trim();
  if (/^https?:\/\//i.test(url)) return lowDataUrl(url);
  if (url.startsWith('/assets/')) return url;
  return '';
}

function fmtDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString();
}

function toast(message, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
  try {
    buzz(kind === 'error' ? 'error' : 'success');
  } catch (e) {}
}

function errorText(data) {
  if (!data) return '';
  const d = data.detail ?? data.message;
  if (Array.isArray(d)) return d.map((e) => e.msg).join('. ');
  return typeof d === 'string' ? d : '';
}

// Red loading bar at the very top of the screen. It starts instantly on refresh (see index.html),
// trickles forward while requests are running, then snaps to 100% and fades out.
const topLoader = (() => {
  let el = document.getElementById('topLoader');
  if (!el) { el = document.createElement('div'); el.id = 'topLoader'; el.setAttribute('aria-hidden', 'true'); document.documentElement.appendChild(el); }
  let pending = 0;
  let p = 0;
  let trickle = null;
  let showTimer = null;
  let hideTimer = null;
  const set = (v, ms) => { el.style.transition = `transform ${ms}ms ease-out, opacity .3s ease`; el.style.transform = `scaleX(${v})`; };
  function freezeBoot() {
    if (!el.classList.contains('boot')) return false;
    const m = getComputedStyle(el).transform;
    el.style.transform = m === 'none' ? 'scaleX(.3)' : m;
    el.style.opacity = '1';
    el.classList.remove('boot');
    void el.offsetWidth;
    return true;
  }
  function begin() {
    clearTimeout(hideTimer);
    if (!freezeBoot()) {
      p = 0.08;
      el.style.transition = 'none'; el.style.opacity = '1'; el.style.transform = 'scaleX(0)';
      void el.offsetWidth;
      set(p, 200);
    } else {
      p = 0.4;
    }
    clearInterval(trickle);
    trickle = setInterval(() => {
      p = Math.min(0.95, p + (0.95 - p) * 0.1 * Math.random() + 0.004);
      set(p, 400);
    }, 350);
  }
  function end() {
    clearInterval(trickle);
    freezeBoot();
    set(1, 220);
    hideTimer = setTimeout(() => {
      el.style.opacity = '0';
      hideTimer = setTimeout(() => { if (!pending) { el.style.transition = 'none'; el.style.transform = 'scaleX(0)'; } }, 350);
    }, 240);
  }
  return {
    start() {
      pending++;
      if (pending === 1) {
        clearTimeout(showTimer);
        if (el.classList.contains('boot')) return; // already running from the first paint
        showTimer = setTimeout(begin, 80);
      }
    },
    done() {
      pending = Math.max(0, pending - 1);
      if (pending === 0) { clearTimeout(showTimer); if (el.classList.contains('boot') || el.style.opacity === '1') end(); }
    },
  };
})();
topLoader.start();
window.addEventListener('load', () => setTimeout(() => topLoader.done(), 250));

async function api(path, options = {}) {
  topLoader.start();
  try {
    const res = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) throw new Error(errorText(data) || `Request failed (${res.status})`);
    return data;
  } finally {
    topLoader.done();
  }
}

// --- Theme ---


function applyDefaultAccent() {
  document.documentElement.setAttribute("data-accent", "pink");
}

function applyTheme(_theme) {
  state.theme = 'dark';
  document.documentElement.setAttribute('data-theme', 'dark');
  localStorage.setItem('anicore-theme', 'dark');
  const meta = $('themeColorMeta');
  if (meta) meta.content = '#09090f';
}

function toggleTheme() {
  /* light mode removed — dark only */
}

// --- Navigation ---

function movePill(animate = true) {
  const pill = $('navPill');
  const nav = $('bottomNav');
  if (!pill || !nav) return;
  const active = nav.querySelector('button.active');
  if (!active) {
    pill.style.opacity = '0';
    return;
  }
  // Use offset relative to the nav container
  const navRect = nav.getBoundingClientRect();
  const btnRect = active.getBoundingClientRect();
  const left = btnRect.left - navRect.left;
  const width = btnRect.width;

  if (!animate) {
    pill.style.transition = 'none';
  } else {
    pill.style.transition = '';
  }
  pill.style.width = `${width}px`;
  pill.style.transform = `translateX(${left}px)`;
  pill.style.opacity = '1';

  if (!animate) {
    void pill.offsetWidth;
    pill.style.transition = '';
  }
}
window.addEventListener('resize', () => movePill(false));
// Position the floating glass indicator on the initially selected tab.
requestAnimationFrame(() => movePill(false));


// Browser tab / page names. Change SITE_NAME to rename the site everywhere.
const SITE_NAME = 'ANICORE';
const PAGE_NAMES = { home: 'Home', search: 'Search', series: 'Anime & Series', movies: 'Movies', schedule: 'Schedule', profile: 'Profile', admin: 'Admin Studio' };
function updatePageTitle() {
  let name = PAGE_NAMES[state.page] || '';
  if ((state.page === 'detail' || state.page === 'video') && state.detailTitle) name = state.detailTitle;
  document.title = !name || state.page === 'home' ? `${SITE_NAME} – Watch Anime Online` : `${name} – ${SITE_NAME}`;
}

function saveNavState() {
  updatePageTitle();
  try {
    sessionStorage.setItem("anicore-nav", JSON.stringify({
      page: state.page,
      detailId: state.detailId,
      detailType: state.detailType,
      watchS: state.page === 'video' && videoContext ? videoContext.episodes[videoContext.currentIndex]?.season : null,
      watchE: state.page === 'video' && videoContext ? videoContext.episodes[videoContext.currentIndex]?.episode : null,
    }));
  } catch (e) {}
  // Give every page its own link in the address bar
  try {
    let h = '';
    let path = PAGE_PATH[state.page] || '/';
    let ws = null, we = null;
    if (state.page === 'video' && videoContext && state.detailId && state.detailType) {
      const cur = videoContext.episodes[videoContext.currentIndex] || {};
      ws = cur.season; we = cur.episode;
      path = watchPath(state.detailType, state.detailId, state.detailTitle, ws, we); h = '';
    } else if ((state.page === 'detail' || state.page === 'video') && state.detailId && state.detailType) {
      path = detailPath(state.detailType, detailRef(state.detailId, state.detailTitle)); h = '';
    }
    const entry = { key: state.page, page: state.page, detailType: state.detailType, detailId: state.detailId, watchS: ws, watchE: we };
    history.replaceState(entry, '', path + location.search + h);
  } catch (e) {}
}

let navFromHistory = false;

function navigateFromHistory() {
  let st = history.state;
  if (!st || !st.key) {
    st = parseLocation() || { page: 'home' };
  }
  navFromHistory = true;
  try {
    document.querySelectorAll('.modal:not(.hidden)').forEach((m) => m.classList.add('hidden'));
    if ((st.page === 'detail' || st.page === 'video') && st.detailId && st.detailType) {
      if (st.page === 'video' && st.watchS != null && st.watchE != null) openVideoFromLink(st.detailType, st.detailId, st.watchS, st.watchE);
      else { allowSwap = true; openDetail(st.detailType, st.detailId); }
    } else if (PAGE_ORDER.includes(st.page) && st.page !== 'detail' && st.page !== 'video') {
      allowSwap = true; showPage(st.page);
    } else {
      allowSwap = true; showPage('home');
    }
  } finally {
    navFromHistory = false;
  }
}
window.addEventListener('popstate', navigateFromHistory);

function restoreNavState() {
  try {
    const raw = sessionStorage.getItem("anicore-nav");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}


function showPage(page) {
  if (page === 'admin' && !['admin', 'uploader'].includes(state.user?.role)) page = 'home';
  const target = $(`page-${page}`);
  if (!target) return;

  // A normal website loads a new page for every link: send the browser there instead of swapping in place.
  const swap = allowSwap; allowSwap = false;
  if (!swap && page !== state.page) {
    if (page === 'detail' || page === 'video') {
      if (state.detailId && state.detailType) {
        const cur = page === 'video' && videoContext ? (videoContext.episodes[videoContext.currentIndex] || {}) : null;
        gotoUrl(cur && cur.episode != null
          ? watchPath(state.detailType, state.detailId, state.detailTitle, cur.season, cur.episode)
          : detailPath(state.detailType, detailRef(state.detailId, state.detailTitle)));
        return;
      }
    } else if (PAGE_PATH[page]) {
      // Keep bottom-tab navigation in the current document; this prevents the Home page
      // from flashing while a full page reload boots the requested destination.
      try {
        const entry = { key: page, page, detailType: null, detailId: null, watchS: null, watchE: null };
        if (location.pathname !== PAGE_PATH[page]) history.pushState(entry, '', PAGE_PATH[page] + location.search);
      } catch (e) { /* keep the current view if history is unavailable */ }
    }
  }

  // Leaving video → cleanup
  if (state.page === 'video' && page !== 'video') {
    setTgPlayerExpanded(false);
    clearPlayer();
    videoContext = null;
    document.querySelectorAll('.tg-expand-btn').forEach((b) => b.remove());
  }

  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p === target));
  state.page = page;
  if (window.tgSyncBack) tgSyncBack();
  saveNavState();

  // Highlight the parent category when on detail/video
  let activePage = page;
  if (page === 'detail' || page === 'video') {
    const dt = state.detailType;
    if (dt === 'anime' || dt === 'tv_show') activePage = 'series';
    else if (dt === 'movie') activePage = 'movies';
  }
  document.querySelectorAll('.bottom-nav button, .side-nav button').forEach((b) => {
    b.classList.toggle('active', b.dataset.page === activePage);
  });
  requestAnimationFrame(() => movePill(true));
  $('sidebar')?.classList.remove('open');
  document.body.classList.remove('sidebar-open');

  if (page === 'series') {
    loadSeries(true);
  }
  const type = PAGE_TYPES[page];
  if (type && !LISTS[type].page) loadList(type, true);
  if (page === 'home') {
    loadRecommendations();
    loadHome();
  }
  if (page === 'schedule') loadSchedule();
  if (page === 'profile') loadProfile();
  if (page === 'admin') {
    const isAdminUser = state.user?.role === 'admin';
    if ($('adminTitle')) $('adminTitle').textContent = isAdminUser ? 'Admin Studio' : 'Upload Studio';
    populateBulkContentSelect();
    loadLibrary(true);
    if (isAdminUser) {
      loadAdminRequests();
      loadAdminStats();
      loadUploaders();
    }
  }

  window.scrollTo(0, 0);
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-page]');
  if (el) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0) return; // let the browser open it in a new tab
    e.preventDefault();
    showPage(el.dataset.page);
  }
});

const sidebar = $('sidebar');
const menuBtn = $('menuBtn');

const setSidebarOpen = (open) => {
  sidebar?.classList.toggle('open', open);
  document.body.classList.toggle('sidebar-open', open);
  menuBtn?.setAttribute('aria-expanded', String(open));
};

menuBtn?.addEventListener('click', () => {
  setSidebarOpen(!sidebar?.classList.contains('open'));
});

// Close the drawer when the user taps anywhere outside it.
document.addEventListener('pointerdown', (event) => {
  if (!sidebar?.classList.contains('open')) return;
  if (sidebar.contains(event.target) || menuBtn?.contains(event.target)) return;
  setSidebarOpen(false);
});

// Keep the drawer state tidy when navigating with the keyboard.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && sidebar?.classList.contains('open')) {
    setSidebarOpen(false);
  }
});

// Standard website scrolling: no floating app navigation to auto-hide.

// --- Skeleton ---

function showSkeleton(gridId, count = 8) {
  const grid = $(gridId);
  if (!grid) return;
  grid.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'skeleton-grid';
  wrap.style.padding = '0';
  for (let i = 0; i < count; i++) {
    wrap.innerHTML += `
      <div class="skeleton-card">
        <div class="skeleton-poster"></div>
        <div class="skeleton-text"></div>
        <div class="skeleton-text short"></div>
      </div>`;
  }
  grid.appendChild(wrap);
}

// --- Rendering ---

function renderGrid(grid, items, type, { append = false, empty = 'Nothing here yet.' } = {}) {
  if (!append) grid.innerHTML = '';
  if (!items.length) {
    if (!append) grid.innerHTML = `<p class="muted empty">${esc(empty)}</p>`;
    return;
  }

  const frag = document.createDocumentFragment();
  items.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'media-card card-enter';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', item.title || 'Untitled');

    const rating = item.avg_rating ? `<span class="rating-badge">★ ${item.avg_rating}</span>` : '';
    const sub = rating || (item.year ? String(item.year) : (item.status || ''));
    const seasonChip = item._season != null ? `<span class="season-chip">${seasonLabel(item._season)}</span>` : '';

    card.innerHTML = `
      <div class="poster-wrap">
        ${seasonChip}
        <img loading="lazy" decoding="async" alt="">
      </div>
      <div class="media-info">
        <h3></h3>
        <p>${sub}</p>
      </div>`;

    const img = card.querySelector('img');
    const posterWrap = card.querySelector('.poster-wrap');
    posterWrap?.classList.add('poster-loading');
    img.decoding = 'async';
    img.alt = item.title || '';
    const finishPosterLoad = () => posterWrap?.classList.remove('poster-loading');
    img.addEventListener('load', finishPosterLoad, { once: true });
    img.addEventListener('error', () => {
      img.src = PLACEHOLDER;
      finishPosterLoad();
    }, { once: true });
    img.src = safeUrl(item.poster) || PLACEHOLDER;
    if (img.complete && img.naturalWidth > 0) finishPosterLoad();

    card.querySelector('h3').textContent = item.title || 'Untitled';

    const open = () => {
      card.classList.add('card-press');
      requestAnimationFrame(() => openDetail(item._type || type, item._id || item.content_id, item));
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    frag.appendChild(card);
  });
  grid.appendChild(frag);
}

let featuredPromise = null;
let heroCurated = [];
let heroCuratedReady = false;

function loadFeatured() {
  if (!featuredPromise) {
    featuredPromise = api('/api/home-featured').catch(() => ({ hero: [], top_airing: [] }));
  }
  return featuredPromise;
}

async function loadTopAiring() {
  const section = $('topAiringSection');
  const row = $('topAiringRow');
  if (!section || !row) return;
  try {
    const featured = await loadFeatured();
    let items = (featured.top_airing || []).slice(0, 10);
    if (!items.length) {
      const [anime, tv] = await Promise.all([
        api('/api/anime?page=1&limit=10&status=Ongoing&sort=views'),
        api('/api/tvshows?page=1&limit=10&status=Ongoing&sort=views'),
      ]);
      items = [
        ...(anime.items || []).map((i) => ({ ...i, _type: 'anime' })),
        ...(tv.items || []).map((i) => ({ ...i, _type: 'tv_show' })),
      ].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 10);
    }
    if (!items.length) { section.classList.add('hidden'); return; }
    row.innerHTML = '';
    items.forEach((item, i) => {
      const el = document.createElement('div');
      el.className = 'top-item';
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.innerHTML = `
        <span class="top-rank" aria-hidden="true">${i + 1}</span>
        <div class="top-poster"><img alt="" loading="lazy" decoding="async"><span class="top-tag">${item._type === 'movie' ? 'MOVIE' : 'SERIES'}</span></div>
        <div class="top-name"></div>`;
      const img = el.querySelector('img');
      img.src = safeUrl(item.poster) || PLACEHOLDER;
      img.addEventListener('error', () => { img.src = PLACEHOLDER; }, { once: true });
      el.querySelector('.top-name').textContent = item.title || 'Untitled';
      el.setAttribute('aria-label', `Number ${i + 1}: ${item.title || 'Untitled'}`);
      const open = () => {
        el.classList.add('card-press');
        requestAnimationFrame(() => { el.classList.remove('card-press'); openDetail(item._type, item._id, item); });
      };
      el.addEventListener('click', open);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      row.appendChild(el);
    });
    section.classList.remove('hidden');
  } catch {
    section.classList.add('hidden');
  }
}

async function loadTopTenPopular() {
  const section = $('topTenSection');
  const row = $('topTenRow');
  if (!section || !row) return;
  try {
    const [animeData, tvData] = await Promise.all([
      api('/api/anime?page=1&limit=20&sort=views'),
      api('/api/tvshows?page=1&limit=20&sort=views'),
    ]);
    const anime = (Array.isArray(animeData) ? animeData : animeData.items || []).map(x => ({...x, _type:'anime'}));
    const tv = (Array.isArray(tvData) ? tvData : tvData.items || []).map(x => ({...x, _type:'tv_show'}));
    const items = [...anime, ...tv].sort((a,b) => (Number(b.views)||0)-(Number(a.views)||0) || (Number(b.avg_rating)||0)-(Number(a.avg_rating)||0)).slice(0,10);
    row.innerHTML = '';
    if (!items.length) { section.classList.add('hidden'); return; }
    items.forEach((item, index) => {
      const card = document.createElement('button');
      card.type = 'button'; card.className = 'top-ten-card';
      card.innerHTML = `<span class="top-ten-number">${index+1}</span><span class="top-ten-poster"><img loading="lazy" alt=""></span><span class="top-ten-copy"><strong></strong><small>★ ${Number(item.avg_rating)||'—'} · ${Number(item.year)||'Anime'}</small></span>`;
      const img = card.querySelector('img'); img.src = safeUrl(item.poster) || PLACEHOLDER; img.alt = item.title || '';
      img.addEventListener('error', () => { img.src = PLACEHOLDER; }, {once:true});
      card.querySelector('strong').textContent = item.title || 'Untitled';
      card.addEventListener('click', () => openDetail(item._type, item._id || item.content_id, item));
      row.appendChild(card);
    });
    section.classList.remove('hidden');
  } catch { section.classList.add('hidden'); }
}

async function loadHome() {
  featuredPromise = null;
  heroCuratedReady = false;
  loadFeatured().then((f) => {
    heroCurated = f.hero || [];
    heroCuratedReady = true;
    setHeroItems();
  });
  loadTopAiring();
  loadTopTenPopular();
  showSkeleton('homeSeriesGrid', 8);
  showSkeleton('homeAnimeGrid', 6);
  showSkeleton('homeMovieGrid', 6);

  // Merged anime + TV into Trending Series
  try {
    const [animeData, tvData] = await Promise.all([
      api('/api/anime?page=1&limit=10&sort=views&expand_seasons=true'),
      api('/api/tvshows?page=1&limit=10&sort=views&expand_seasons=true'),
    ]);
    const animeItems = (Array.isArray(animeData) ? animeData : animeData.items || []).map((i) => ({ ...i, _type: 'anime' }));
    const tvItems = (Array.isArray(tvData) ? tvData : tvData.items || []).map((i) => ({ ...i, _type: 'tv_show' }));
    const merged = [...animeItems, ...tvItems]
      .sort((a, b) => (b.views || 0) - (a.views || 0) || String(b.created_at || '').localeCompare(String(a.created_at || '')))
      .slice(0, 12);
    renderGrid($('homeSeriesGrid'), merged, 'anime');
    heroSeriesItems = merged;
    setHeroItems();
  } catch {
    const g = $('homeSeriesGrid');
    if (g) g.innerHTML = '<p class="muted empty">Failed to load. Please refresh.</p>';
  }

  try {
    const [a, t] = await Promise.all([
      api('/api/anime?page=1&limit=10&sort=newest&expand_seasons=true'),
      api('/api/tvshows?page=1&limit=10&sort=newest&expand_seasons=true'),
    ]);
    const items = [
      ...(Array.isArray(a) ? a : a.items || []).map((i) => ({ ...i, _type: 'anime' })),
      ...(Array.isArray(t) ? t : t.items || []).map((i) => ({ ...i, _type: 'tv_show' })),
    ].sort((x, y) => String(y.created_at || '').localeCompare(String(x.created_at || ''))).slice(0, 10);
    renderGrid($('homeAnimeGrid'), items, 'anime');
  } catch {
    const g = $('homeAnimeGrid');
    if (g) g.innerHTML = '<p class="muted empty">Failed to load. Please refresh.</p>';
  }

  try {
    const data = await api('/api/movies?page=1&limit=10&sort=views');
    const items = Array.isArray(data) ? data : data.items || [];
    renderGrid($('homeMovieGrid'), items, 'movie');
    heroMovieItems = items.map((i) => ({ ...i, _type: 'movie' }));
    setHeroItems();
  } catch {
    const g = $('homeMovieGrid');
    if (g) g.innerHTML = '<p class="muted empty">Failed to load. Please refresh.</p>';
  }
  if (!hero.items.length) $('hero')?.classList.add('hidden');
}

async function loadList(type, reset = false) {
  const l = LISTS[type];
  if (l.loading) return;
  if (reset) { l.page = 0; l.total = 0; }
  if (l.page > 0 && l.page * PAGE_SIZE >= l.total) return;

  l.loading = true;
  const next = l.page + 1;
  const params = new URLSearchParams({ page: next, limit: PAGE_SIZE, sort: l.sortVal || 'newest', expand_seasons: 'true' });
  if (l.q) params.set('q', l.q);
  if (l.genreVal) params.set('genre', l.genreVal);
  if (l.statusVal) params.set('status', l.statusVal);

  if (reset) showSkeleton(l.grid, 8);

  try {
    const data = await api(`${l.endpoint}?${params}`);
    l.page = next;
    l.total = data.total;
    renderGrid($(l.grid), data.items, type, { append: next > 1, empty: 'No results found.' });
    const emptyEl = $(l.empty);
    if (emptyEl) emptyEl.classList.toggle('hidden', data.items.length > 0 || next > 1);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    l.loading = false;
  }
}

const observers = {};
// Only movies use infinite-scroll list page; series is handled by loadSeries()
Object.entries(LISTS).forEach(([type, l]) => {
  if (type === 'anime' || type === 'tv_show') return;
  const sentinel = $(l.sentinel);
  if (!sentinel) return;
  observers[type] = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && state.page === 'movies') {
      loadList(type);
    }
  }, { rootMargin: '200px' });
  observers[type].observe(sentinel);
});

Object.entries(LISTS).forEach(([type, l]) => {
  if (type === 'anime' || type === 'tv_show') return; // series controls wired in wireSeriesPage
  let timer;
  $(l.search)?.addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      l.q = e.target.value.trim();
      loadList(type, true);
    }, 300);
  });
  $(l.genre)?.addEventListener('change', (e) => {
    l.genreVal = e.target.value;
    document.querySelectorAll(`#${l.chips} .genre-chip`).forEach((c) => {
      c.classList.toggle('active', c.dataset.genre === l.genreVal);
    });
    loadList(type, true);
  });
  $(l.status)?.addEventListener('change', (e) => { l.statusVal = e.target.value; loadList(type, true); });
  $(l.sort)?.addEventListener('change', (e) => { l.sortVal = e.target.value; loadList(type, true); });
});

async function loadGenres() {
  try {
    state.genres = await api('/api/genres');
    Object.values(LISTS).forEach((l) => {
      const sel = $(l.genre);
      if (!sel) return;
      const current = sel.value;
      sel.innerHTML = '<option value="">All Genres</option>';
      state.genres.forEach((g) => {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        sel.appendChild(opt);
      });
      sel.value = current;

      const chips = $(l.chips);
      if (chips) {
        chips.innerHTML = '';
        state.genres.slice(0, 12).forEach((g) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'genre-chip';
          btn.dataset.genre = g;
          btn.textContent = g;
          btn.setAttribute('role', 'option');
          btn.addEventListener('click', () => {
            const active = btn.classList.contains('active');
            chips.querySelectorAll('.genre-chip').forEach((c) => c.classList.remove('active'));
            if (!active) {
              btn.classList.add('active');
              l.genreVal = g;
              if (sel) sel.value = g;
            } else {
              l.genreVal = '';
              if (sel) sel.value = '';
            }
            const listKey = Object.keys(LISTS).find((k) => LISTS[k] === l);
            if (listKey === 'anime' || listKey === 'tv_show') loadSeries(true);
            else loadList(listKey, true);
          });
          chips.appendChild(btn);
        });
      }
    });

    const sg = $("searchGenre");
    if (sg) {
      const cur = sg.value;
      sg.innerHTML = '<option value="">All Genres</option>';
      state.genres.forEach((g) => {
        const opt = document.createElement("option");
        opt.value = g;
        opt.textContent = g;
        sg.appendChild(opt);
      });
      sg.value = cur;
    }


    const ssg = $("seriesGenre");
    if (ssg) {
      const cur = ssg.value;
      ssg.innerHTML = '<option value="">All Genres</option>';
      state.genres.forEach((g) => {
        const opt = document.createElement("option");
        opt.value = g;
        opt.textContent = g;
        ssg.appendChild(opt);
      });
      ssg.value = cur;
    }
    const schips = $("seriesChips");
    if (schips) {
      schips.innerHTML = "";
      state.genres.slice(0, 12).forEach((g) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "genre-chip";
        btn.dataset.genre = g;
        btn.textContent = g;
        btn.addEventListener("click", () => {
          const active = btn.classList.contains("active");
          schips.querySelectorAll(".genre-chip").forEach((c) => c.classList.remove("active"));
          if (!active) {
            btn.classList.add("active");
            if (ssg) ssg.value = g;
          } else if (ssg) ssg.value = "";
          loadSeries(true);
        });
        schips.appendChild(btn);
      });
    }

  } catch { /* ignore */ }
}

// --- Auth ---

function updateAuthUI() {
  const u = state.user;
  $('signInBtn')?.classList.toggle('hidden', !!u);
  $('logoutBtn')?.classList.toggle('hidden', !u);
  const canUpload = u?.role === 'admin' || u?.role === 'uploader';
  document.body.dataset.role = u?.role || '';
  $('adminBtn')?.classList.toggle('hidden', !canUpload);
  if ($('adminBtn')) $('adminBtn').textContent = u?.role === 'uploader' ? 'Upload' : 'Admin';
  $('sideSignIn')?.classList.toggle('hidden', !!u);
  $('sideLogout')?.classList.toggle('hidden', !u);
  $('sideAdminBtn')?.classList.toggle('hidden', !canUpload);
}

const USER_CACHE_KEY = 'anicore_user_cache';
function readCachedUser() {
  try { return JSON.parse(localStorage.getItem(USER_CACHE_KEY) || 'null'); } catch { return null; }
}
function writeCachedUser(u) {
  try { if (u) localStorage.setItem(USER_CACHE_KEY, JSON.stringify(u)); else localStorage.removeItem(USER_CACHE_KEY); } catch { /* ignore */ }
}

async function checkUser() {
  // Show the last known account straight away so a refresh never flashes "Sign In".
  if (!state.user) {
    const cached = readCachedUser();
    if (cached) { state.user = cached; updateAuthUI(); }
  }
  let res = null;
  let failed = true;
  for (let i = 0; i < 3 && failed; i++) {
    try { res = await api('/api/auth/me', { cache: 'no-store' }); failed = false; }
    catch { if (i < 2) await new Promise((r) => setTimeout(r, 600 * (i + 1))); }
  }
  if (failed) { updateAuthUI(); return state.user; } // network problem: do not sign the user out
  state.user = res.authenticated ? {
    email: res.email,
    role: res.role || 'user',
    display_name: res.display_name || '',
    avatar: (res.prefs || {}).avatar || '',
    telegram_id: res.telegram_id || '',
    telegram_username: res.telegram_username || '',
  } : null;
  writeCachedUser(state.user);
  applyBackground(res.authenticated ? (res.prefs || {}).bg_image : '');
  updateAuthUI();
  return state.user;
}

function setAuthMode(mode) {
  state.authMode = mode;
  const login = mode === 'login';
  $('authTitle').textContent = login ? 'Welcome Back' : 'Join ANICORE';
  $('authSubtitle').textContent = login
    ? 'Sign in to continue your journey.'
    : 'Create your free account and build your watchlist.';
  $('authSubmit').textContent = login ? 'Sign In' : 'Create Account';
  $('toggleText').textContent = login ? "Don't have an account?" : 'Already have an account?';
  $('toggleAuthBtn').textContent = login ? 'Create Account' : 'Sign In Instead';
  $('authPass').autocomplete = login ? 'current-password' : 'new-password';
}

function showAuthError(message) {
  const box = $('authError');
  box.textContent = message;
  box.classList.remove('hidden');
}

function openAuth(mode = 'login') {
  setAuthMode(mode);
  $('authError').classList.add('hidden');
  $('authModal').classList.remove('hidden');
  $('authEmail').focus();
}

function closeAuth() {
  $('authModal').classList.add('hidden');
  $('authForm').reset();
  $('authError').classList.add('hidden');
}

$('signInBtn')?.addEventListener('click', () => openAuth('login'));
$('sideSignIn')?.addEventListener('click', () => openAuth('login'));
$('authClose')?.addEventListener('click', closeAuth);
$('toggleAuthBtn')?.addEventListener('click', () => openAuth(state.authMode === 'login' ? 'register' : 'login'));
$('authModal')?.addEventListener('click', (e) => { if (e.target.id === 'authModal') closeAuth(); });

$('authForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('authEmail').value.trim();
  const password = $('authPass').value;
  if (!email || !password) return showAuthError('Please fill in all fields.');
  if (state.authMode === 'register' && password.length < 6) {
    return showAuthError('Password must be at least 6 characters.');
  }

  const btn = $('authSubmit');
  btn.disabled = true;
  btn.textContent = state.authMode === 'login' ? 'Signing in...' : 'Creating account...';

  try {
    await api(`/api/auth/${state.authMode}`, { method: 'POST', body: JSON.stringify({ email, password }) });
    const created = state.authMode === 'register';
    closeAuth();
    await checkUser();
    toast(created ? 'Account created!' : 'Welcome back!');
    if ($('page-profile')?.classList.contains('active')) loadProfile();
  } catch (err) {
    showAuthError(err.message || 'Failed to authenticate. Please try again.');
  } finally {
    btn.disabled = false;
    setAuthMode(state.authMode);
  }
});

async function doLogout() {
  if (!confirm('Are you sure you want to sign out?')) return;
  try {
    await api('/api/auth/logout', { method: 'POST' });
    writeCachedUser(null);
    state.user = null;
    applyBackground('');
    updateAuthUI();
    showPage('home');
    toast('Signed out');
  } catch (err) {
    toast(err.message || 'Failed to sign out', 'error');
  }
}
$('logoutBtn')?.addEventListener('click', doLogout);
$('sideLogout')?.addEventListener('click', doLogout);

// --- Profile ---

// --- Profile card (avatar + display name, Crunchyroll style) ---

function profileName(u = state.user) {
  if (u?.telegram_username) return '@' + String(u.telegram_username).replace(/^@/, '');
  const dn = (u?.display_name || '').trim();
  if (dn) return dn;
  const email = (u?.email || '');
  // hide internal tg_…@telegram.local
  if (email.endsWith('@telegram.local')) return 'Telegram user';
  return email.split('@')[0] || 'User';
}

function safeAvatar(url) {
  if (typeof url !== 'string' || !url) return '';
  if (url.startsWith('/api/users/me/avatar')) return url;
  if (/^https:\/\//i.test(url)) return url;
  return '';
}

function avatarHtml(u = state.user, cls = '') {
  const src = safeAvatar(u?.avatar);
  const initial = esc(profileName(u).charAt(0).toUpperCase());
  return src
    ? `<div class="profile-avatar has-img ${cls}"><img src="${esc(src)}" alt="" loading="lazy"></div>`
    : `<div class="profile-avatar ${cls}">${initial}</div>`;
}

function renderProfileCard(editing = false) {
  const info = $('profileInfo');
  const u = state.user;
  if (!info || !u) return;
  const isAdmin = u.role === 'admin';
  info.innerHTML = `
    <div class="panel profile-panel profile-card">
      <button type="button" class="profile-avatar-btn" id="avatarPick" aria-label="Change profile picture">
        ${avatarHtml(u, 'big')}
        <span class="avatar-edit-badge">✎</span>
      </button>
      <input type="file" id="avatarFile" accept="image/jpeg,image/png,image/webp" hidden>
      <h3 class="profile-name">${esc(profileName(u))}${isAdmin ? ' <span class="role-badge">Admin</span>' : (u.role === 'uploader' ? ' <span class="role-badge">Uploader</span>' : '')}</h3>
      ${u.telegram_id ? `<p class="muted profile-tg-sub">Telegram account</p>` : (u.email && !String(u.email).endsWith('@telegram.local') ? `<p class="muted profile-tg-sub">${esc(u.email)}</p>` : '')}
      <p class="muted profile-email">${esc(u.email)}</p>
      ${editing ? `
        <form id="profileEditForm" class="profile-edit stack">
          <label>Display name
            <input id="profileNameInput" maxlength="30" placeholder="Your name" value="${esc(u.display_name || '')}" autocomplete="nickname">
          </label>
          <div class="bg-actions">
            <button type="submit" class="primary small">Save</button>
            <button type="button" class="outline small" id="avatarUpload">Upload photo</button>
            <button type="button" class="outline small" id="avatarRemove">Remove photo</button>
            <button type="button" class="outline small" id="profileCancel">Cancel</button>
          </div>
          <p id="profileMsg" class="hint"></p>
        </form>`
      : `<button type="button" class="outline small" id="profileEditBtn">Edit profile</button>`}
    </div>`;
  $('avatarPick')?.addEventListener('click', () => $('avatarFile')?.click());
  $('profileEditBtn')?.addEventListener('click', () => renderProfileCard(true));
  $('profileCancel')?.addEventListener('click', () => renderProfileCard(false));
  $('avatarUpload')?.addEventListener('click', () => $('avatarFile')?.click());
  $('avatarFile')?.addEventListener('change', onAvatarFile);
  $('avatarRemove')?.addEventListener('click', removeAvatar);
  $('profileEditForm')?.addEventListener('submit', saveProfileForm);
}

function setProfileMsg(text, isError = false) {
  const el = $('profileMsg');
  if (!el) return;
  el.textContent = text || '';
  el.style.color = isError ? '#ff6b8a' : '';
}

// Center-crop an uploaded picture to a small square JPEG.
function imageFileToAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return reject(new Error('Choose a JPG, PNG or WebP image.'));
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const size = 320;
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - side) / 2;
      const sy = (img.naturalHeight - side) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, size, size);
      let quality = 0.85;
      let out = canvas.toDataURL('image/jpeg', quality);
      while (out.length > 380_000 && quality > 0.4) { quality -= 0.15; out = canvas.toDataURL('image/jpeg', quality); }
      if (out.length > 380_000) return reject(new Error('That image is too large. Try a smaller one.'));
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('That image could not be read.')); };
    img.src = objectUrl;
  });
}

async function saveAvatar(body) {
  const res = await api('/api/users/me/avatar', { method: 'PUT', body: JSON.stringify(body) });
  state.user.avatar = res.avatar || '';
  return res;
}

async function onAvatarFile(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file || !state.user) return;
  try {
    toast('Uploading…');
    await saveAvatar({ data: await imageFileToAvatar(file) });
    renderProfileCard(!!$('profileEditForm'));
    toast('Profile picture updated');
  } catch (err) { toast(err.message, 'error'); }
}

async function removeAvatar() {
  try {
    await api('/api/users/me/avatar', { method: 'DELETE' });
    state.user.avatar = '';
    renderProfileCard(true);
    toast('Profile picture removed');
  } catch (err) { setProfileMsg(err.message, true); }
}

async function saveProfileForm(e) {
  e.preventDefault();
  const name = $('profileNameInput').value.trim();
  try {
    const res = await api('/api/users/me/profile', { method: 'PUT', body: JSON.stringify({ display_name: name }) });
    state.user.display_name = res.display_name || '';
    renderProfileCard(false);
    toast('Profile saved');
  } catch (err) { setProfileMsg(err.message, true); }
}

async function loadProfile() {
  const info = $('profileInfo');
  const member = $('profileMember');

  if (!state.user) {
    info.innerHTML = '<div class="panel profile-panel"><p class="muted">Sign in to see your profile and watchlist.</p><button class="primary" type="button" id="profileSignIn">Sign In</button></div>';
    $('profileSignIn')?.addEventListener('click', () => openAuth('login'));
    member?.classList.add('hidden');
    return;
  }

  renderProfileCard();
  member?.classList.remove('hidden');

  try {
    const list = await api('/api/watchlist');
    const items = list.map((w) => ({
      _id: w.content_id, _type: w.content_type,
      title: w.title, poster: w.poster, avg_rating: w.avg_rating,
    }));
    renderGrid($('watchlistGrid'), items, 'anime', { empty: 'Your watchlist is empty.' });
  } catch (err) {
    toast(err.message, 'error');
  }
}

$('requestForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    await api('/api/requests', {
      method: 'POST',
      body: JSON.stringify({
        title: $('reqTitle').value.trim(),
        language: $('reqLanguage').value,
        notes: $('reqNotes').value.trim(),
      }),
    });
    e.target.reset();
    toast('Request sent!');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// --- Detail ---

function linkList(links) {
  const entries = Object.entries(links || {}).filter(([, url]) => safeUrl(url));
  if (!entries.length) return '';
  return `<div class="links">${entries.map(([quality, url]) =>
    `<a class="chip" href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${esc(quality)}</a>`
  ).join('')}</div>`;
}

function seasonThumb(episodes, season, content) {
  const map = content?.season_thumbnails || videoContext?.season_thumbnails || {};
  // season thumbnail first, then the whole-anime thumbnail (key "all")
  return safeUrl(map[String(season)] || map[Number(season)]) || safeUrl(map.all) || '';
}

const EP_PREVIEW = 8;

// When a page is opened from a season card (or a link with ?season=N) only that season is shown.
function detailSeasonScope(preview) {
  if (preview && preview._season != null) return Number(preview._season);
  try {
    const v = new URLSearchParams(location.search).get('season');
    return v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
  } catch (e) { return null; }
}

// OVAs / specials the admin attached to a season come last; a small divider labels each group.
function rowsWithDividers(list, rowHtml, season) {
  let prev = 'episode';
  return list.map((ep) => {
    const kind = season === 0 ? 'special' : epKind(ep);
    let head = '';
    if (season !== 0 && kind !== prev && kind !== 'episode') {
      head = `<div class="ep-divider ep-divider-${kind}" data-search="" data-divider="1"><span>${kind === 'ova' ? 'OVA' : 'Specials'}</span></div>`;
    }
    prev = kind;
    return head + rowHtml(ep);
  }).join('');
}

function episodesHtml(episodes, type, contentId, contentCtx) {
  if (!episodes?.length) return '';
  const sorted = [...episodes].sort(cmpEp);
  const seasons = [...new Set(sorted.map((e) => e.season))];

  const rowHtml = (ep) => {
    const kind = Number(ep.season) === 0 ? 'special' : epKind(ep);
    const name = ep.title || epName(ep);
    const playable = !!ep.video_url;
    const inner = `
      <span class="ep-badge">${esc(epBadge(ep))}</span>
      <span class="ep-info">${ep.duration ? `<span class="ep-dur">${esc(ep.duration)}</span>` : ''}</span>
      ${playable ? '<span class="ep-go">▶</span>' : '<span class="ep-dur">Soon</span>'}`;
    return `
    <div class="ep-row detail-ep ${kind !== 'episode' ? 'ep-' + kind : ''}" data-search="${esc((epBadge(ep) + ' ' + name).toLowerCase())}">
      ${playable
        ? `<button type="button" class="ep-main ep-play" data-season="${ep.season}" data-episode="${ep.episode}">${inner}</button>`
        : `<div class="ep-main off">${inner}</div>`}
      ${state.user ? `<button type="button" class="ep-check mark-progress" title="Mark watched" data-season="${ep.season}" data-episode="${ep.episode}">✓</button>` : ''}
      ${linkList(ep.quality_links) ? `<div class="ep-links">${linkList(ep.quality_links)}</div>` : ''}
    </div>`;
  };

  const scope = state.detailSeason != null && seasons.some((x) => Number(x) === Number(state.detailSeason)) && seasons.length > 1 ? Number(state.detailSeason) : null;
  const card = (s) => {
    const list = sorted.filter((e) => e.season === s);
    const eps = list.filter((e) => epKind(e) === 'episode').length;
    const ovas = list.filter((e) => epKind(e) === 'ova').length;
    const sps = list.filter((e) => epKind(e) === 'special').length;
    const parts = Number(s) === 0
      ? [`${list.length} special${list.length === 1 ? '' : 's'}`]
      : [`${eps} episode${eps === 1 ? '' : 's'}`];
    if (ovas && Number(s) !== 0) parts.push(`${ovas} OVA`);
    if (sps && Number(s) !== 0) parts.push(`${sps} special${sps === 1 ? '' : 's'}`);
    const art = seasonThumb(sorted, s, contentCtx) || safeUrl(contentCtx?.banner) || safeUrl(contentCtx?.poster) || '';
    // red tag line like "ANIME · COMPLETED · HINDI DUB"
    const dubs = (Array.isArray(contentCtx?.dubbed_on) ? contentCtx.dubbed_on : []).map((l) => `${l} Dub`);
    const tags = [type === 'anime' ? 'Anime' : 'Series', contentCtx?.status, ...dubs, ...(dubs.length ? [] : (contentCtx?.genres || []).slice(0, 2))]
      .filter(Boolean).map((t) => String(t).toUpperCase());
    const title = `${contentCtx?.title || ''} ${seasonLabel(s)}`.trim();
    const badge = Number(s) === 0 ? 'SP' : `S${s}`;
    const countLabel = Number(s) === 0 ? `${list.length} SP` : [`${eps} EP`, ovas ? `${ovas} OVA` : '', sps ? `${sps} SP` : ''].filter(Boolean).join(' + ');
    const off = scope !== null && Number(s) !== scope;
    return `
    <section class="season-card${off ? ' sc-offscope hidden' : ''}" data-season="${s}">
      <button type="button" class="sc-head" aria-expanded="false">
        <span class="sc-art">
          ${art ? `<img src="${esc(art)}" alt="" loading="lazy" decoding="async">` : ''}
          <span class="sc-badge">${esc(badge)}</span>
          <span class="sc-count">${esc(countLabel)}</span>
        </span>
        <span class="sc-info">
          <span class="sc-tags">${esc(tags.join(' · '))}</span>
          <span class="sc-title">${esc(title)}</span>
        </span>
        <span class="sc-foot"><span class="sc-meta">${esc(parts.join(' · '))}</span><span class="sc-toggle">Episodes <i>▾</i></span></span>
      </button>
      <div class="sc-body">
        ${list.length > EP_PREVIEW ? '<input type="search" class="ep-filter season-filter" placeholder="Filter episodes..." autocomplete="off">' : ''}
        <div class="ep-rows">${rowsWithDividers(list, rowHtml, Number(s))}</div>
        <p class="muted ep-none hidden">No episodes found.</p>
        ${list.length > EP_PREVIEW ? '<button type="button" class="ep-more"></button>' : ''}
      </div>
    </section>`;
  };
  const bar = seasons.length > 1
    ? `<div class="season-scope${scope === null ? ' hidden' : ''}"><button type="button" class="scope-all">View all ${seasons.length} seasons</button></div>`
    : '';
  return `<h3>Episodes</h3>` + bar + seasons.map(card).join('');
}

// Wires the "Show all" button and the filter box on each season card.
function setSeasonOpen(cardEl, open) {
  cardEl.classList.toggle('open', open);
  cardEl.querySelector('.sc-head')?.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function bindSeasonCards(container) {
  const all = [...container.querySelectorAll('.season-card')];
  const visible = all.filter((c) => !c.classList.contains('hidden'));
  if (visible.length === 1) setSeasonOpen(visible[0], true); // a single season is just shown open
  container.querySelector('.scope-all')?.addEventListener('click', () => {
    all.forEach((c) => c.classList.remove('hidden', 'sc-offscope'));
    container.querySelector('.season-scope')?.classList.add('hidden');
    state.detailSeason = null;
    try {
      const u = new URL(location.href); u.searchParams.delete('season');
      history.replaceState(history.state, '', u.pathname + (u.search || '') + u.hash);
    } catch (e) { /* noop */ }
  });
  all.forEach((cardEl) => {
    cardEl.querySelector('.sc-head')?.addEventListener('click', () => {
      const open = !cardEl.classList.contains('open');
      setSeasonOpen(cardEl, open);
      if (open && all.length > 1) {
        const selectedSeason = Number(cardEl.dataset.season);
        all.forEach((other) => {
          const selected = other === cardEl;
          other.classList.toggle('hidden', !selected);
          other.classList.toggle('sc-offscope', !selected);
        });
        state.detailSeason = selectedSeason;
        container.querySelector('.season-scope')?.classList.remove('hidden');
        try {
          const u = new URL(location.href);
          u.searchParams.set('season', String(selectedSeason));
          history.replaceState(history.state, '', u.pathname + (u.search || '') + u.hash);
        } catch (e) { /* noop */ }
      }
      if (open) setTimeout(() => cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60);
    });
  });
  container.querySelectorAll('.season-card').forEach((cardEl) => {
    const rows = [...cardEl.querySelectorAll('.detail-ep')];
    const more = cardEl.querySelector('.ep-more');
    const filter = cardEl.querySelector('.season-filter');
    const apply = () => {
      const q = (filter?.value || '').trim().toLowerCase();
      const expanded = cardEl.classList.contains('expanded');
      let shown = 0;
      rows.forEach((r, i) => {
        const match = !q || (r.dataset.search || '').includes(q);
        const extra = r.classList.contains('ep-ova') || r.classList.contains('ep-special'); // OVAs always stay visible
        const visible = match && (q || expanded || i < EP_PREVIEW || extra);
        r.classList.toggle('hidden', !visible);
        if (visible) shown++;
      });
      cardEl.querySelectorAll('.ep-divider').forEach((d) => {
        let n = d.nextElementSibling, any = false;
        while (n && !n.classList.contains('ep-divider')) { if (!n.classList.contains('hidden')) any = true; n = n.nextElementSibling; }
        d.classList.toggle('hidden', !any);
      });
      cardEl.querySelector('.ep-none')?.classList.toggle('hidden', shown > 0);
      if (more) {
        more.classList.toggle('hidden', !!q);
        more.textContent = expanded ? 'Show less ▴' : `Show all ${rows.length} ▾`;
      }
    };
    more?.addEventListener('click', () => { cardEl.classList.toggle('expanded'); apply(); });
    filter?.addEventListener('input', apply);
    apply();
  });
}

function commentsHtml(comments) {
  if (!comments.length) return '<p class="muted">No comments yet.</p>';
  return comments.map((c) => `
    <div class="comment">
      <strong>${esc(c.username)}</strong> <small>${esc(fmtDate(c.created_at))}</small>
      <p>${esc(c.text)}</p>
    </div>`).join('');
}

function metaText(item) {
  if (!('description' in item)) return '';
  const parts = [
    item.avg_rating ? `★ ${item.avg_rating}` : null,
    item.year ? String(item.year) : null,
    item.status || null,
  ].filter(Boolean);
  return parts.join(' · ');
}

function recapHtml(item) {
  return item.ai_recap ? `<div class="recap"><strong>🤖 AI Recap</strong>${esc(item.ai_recap)}</div>` : '';
}


function contentShareUrl(type, id, title) {
  const base = (location.origin || "https://anicore-f6f4.onrender.com").replace(/\/$/, "");
  return `${base}${detailPath(type, detailRef(id, title))}`;
}

async function shareContent(type, id, title) {
  const url = contentShareUrl(type, id, title);
  const text = title ? `${title} on ANICORE` : "Watch on ANICORE";
  try {
    if (window.Telegram && Telegram.WebApp && Telegram.WebApp.openTelegramLink) {
      // Prefer native share sheet when available
      if (navigator.share) {
        await navigator.share({ title: text, text, url });
        toast("Shared");
        return;
      }
    }
    if (navigator.share) {
      await navigator.share({ title: text, text, url });
      toast("Shared");
      return;
    }
  } catch (e) {
    if (e && e.name === "AbortError") return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied");
  } catch (e) {
    // fallback prompt
    window.prompt("Copy this link:", url);
  }
}

function buildDetailHtml(type, item, comments) {
  const banner = safeUrl(item.banner) || safeUrl(item.poster);
  const genres = Array.isArray(item.genres) && item.genres.length ? item.genres.join(', ') : '';

  const rawDesc = ('description' in item) ? (item.description || 'No description available.') : '';
  const longDesc = rawDesc.length > 160;

  return `
    ${banner ? `<img class="detail-banner" src="${esc(banner)}" alt="">` : ''}
    <h2>${esc(item.title)}</h2>
    <p class="muted meta" id="dMeta">${esc(metaText(item))}</p>
    <div class="synopsis ${longDesc ? 'collapsed' : ''}" id="synopsisBox">
      <p class="desc" id="synopsisText">${esc(rawDesc)}</p>
      ${longDesc ? '<button type="button" class="text-button synopsis-toggle" id="synopsisToggle">Read more</button>' : ''}
    </div>
    ${genres ? `<p><span class="muted">Genres:</span> ${esc(genres)}</p>` : ''}
    <div id="dRecapSlot">${recapHtml(item)}</div><div id="similarSlot"></div>
    ${type === 'movie' ? linkList(item.quality_links) : ''}
    ${episodesHtml(item.episodes, type, item._id, item)}
    <div class="detail-actions">
      <button class="primary ${item.in_watchlist ? 'saved' : ''}" id="wlBtn" type="button">${item.in_watchlist ? '♥ In Watchlist' : '♡ Add to Watchlist'}</button>
    </div>
    <h3>Comments</h3>
    ${state.user
      ? `<form id="commentForm"><textarea id="commentText" rows="2" maxlength="1000" placeholder="Write a comment..." required></textarea><button class="outline block" type="submit">Post Comment</button></form>`
      : '<p class="muted">Sign in to comment.</p>'}
    <div id="commentList">${comments ? commentsHtml(comments) : ''}</div>`;
}

function bindDetailEvents(type, item, container) {
  rememberAir(item);
  container.querySelector('.detail-banner')?.addEventListener('error', (e) => e.target.remove(), { once: true });

  const synBtn = container.querySelector('#synopsisToggle');
  synBtn?.addEventListener('click', () => {
    const box = container.querySelector('#synopsisBox');
    const collapsed = box.classList.toggle('collapsed');
    synBtn.textContent = collapsed ? 'Read more' : 'Show less';
  });

  bindSeasonCards(container);
  container.querySelectorAll('.ep-play').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = Number(btn.dataset.season);
      const e = Number(btn.dataset.episode);
      if (!item.episodes) return;
      openVideo(type, item._id, item.title, item.episodes, s, e, item.banner || item.poster, 0, item.season_thumbnails || {});
    });
  });

  container.querySelector('#wlBtn')?.addEventListener('click', async (e) => {
    if (!state.user) return openAuth('login');
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const res = await api(`/api/watchlist/${type}/${item._id}`, { method: 'POST' });
      btn.textContent = res.saved ? '♥ In Watchlist' : '♡ Add to Watchlist';
      btn.classList.toggle('saved', res.saved);
      toast(res.saved ? 'Added to watchlist' : 'Removed from watchlist');
      if ($('page-profile')?.classList.contains('active')) loadProfile();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  container.querySelectorAll('.mark-progress').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!state.user) return openAuth('login');
      try {
        await api('/api/progress', {
          method: 'POST',
          body: JSON.stringify({
            content_type: type, content_id: item._id,
            season: Number(btn.dataset.season), episode: Number(btn.dataset.episode),
            progress_percent: 100,
          }),
        });
        toast('Progress saved');
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  container.querySelector('#commentForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = container.querySelector('#commentText').value.trim();
    if (!text) return;
    try {
      await api('/api/comments', {
        method: 'POST',
        body: JSON.stringify({ content_type: type, content_id: item._id, text }),
      });
      container.querySelector('#commentText').value = '';
      container.querySelector('#commentList').innerHTML = commentsHtml(
        await api(`/api/comments/${type}/${item._id}`)
      );
    } catch (err) { toast(err.message, 'error'); }
  });
}

function detailSkeletonHtml() {
  return `
    <div class="detail-skel" aria-hidden="true">
      <div class="ds-poster"></div>
      <div class="ds-lines">
        <div class="ds-line w70 tall"></div>
        <div class="ds-chips"><span></span><span></span><span></span><span></span></div>
        <div class="ds-line"></div><div class="ds-line"></div><div class="ds-line w50"></div>
      </div>
      <div class="ds-eps"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>
    </div>`;
}

async function openDetail(type, id, preview) {
  const swap = allowSwap; allowSwap = false;
  if (!swap) {
    const sq = preview && preview._season != null ? `?season=${encodeURIComponent(preview._season)}` : '';
    gotoUrl(detailPath(type, detailRef(id, preview && preview.title)) + sq);
    return;
  }
  // A name link (/anime/some-title) is turned into the real id first.
  if (!isRealId(id)) {
    try { id = (await api(`/api/resolve/${type}/${encodeURIComponent(id)}`))._id; }
    catch (err) { toast('Title not found.', 'error'); gotoUrl('/'); return; }
    try { if (history.state) history.replaceState({ ...history.state, key: `detail:${type}:${id}`, detailId: id }, '', location.href); } catch (e) {}
  }
  state.detailId = id;
  state.detailType = type;
  state.detailTitle = (preview && preview.title) || '';
  state.detailSeason = detailSeasonScope(preview);

  allowSwap = true;
  showPage('detail');
  const contentEl = $('detailPageContent');

  if (preview && contentEl) {
    contentEl.innerHTML = buildDetailHtml(type, preview, null);
    bindDetailEvents(type, preview, contentEl);
    scrollToSeason(contentEl, preview._season);
  } else if (contentEl) {
    contentEl.innerHTML = detailSkeletonHtml();
  }

  try {
    const [item, comments] = await Promise.all([
      api(`/api/content/${type}/${id}`),
      api(`/api/comments/${type}/${id}`),
    ]);
    if (state.detailId !== id) return;
    state.detailTitle = item.title || state.detailTitle;
    updatePageTitle();
    try { // show the anime name in the address bar
      const u = detailPath(type, detailRef(id, state.detailTitle)) + location.search;
      if (history.state && history.state.key) history.replaceState(history.state, '', u);
    } catch (e) {}
    contentEl.innerHTML = buildDetailHtml(type, item, comments);
    contentEl.classList.remove('swap-in'); void contentEl.offsetWidth; contentEl.classList.add('swap-in');
    bindDetailEvents(type, item, contentEl);
    scrollToSeason(contentEl, preview && preview._season);
  } catch (err) {
    if (state.detailId !== id) return;
    toast(err.message || 'Failed to load details.', 'error');
    gotoUrl('/');
  }
}

// Jump to a specific season card on the detail page (used when opening from a per-season card).
function scrollToSeason(container, season) {
  if (season == null || !container) return;
  const target = container.querySelector(`.season-card[data-season="${season}"]`);
  if (!target) return;
  setSeasonOpen(target, true); // opening from a season card shows that season's episodes
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('detailBack')?.addEventListener('click', () => {
  let internal = false;
  try { internal = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch (e) {}
  if (internal && history.length > 1) history.back(); else gotoUrl('/');
});

// --- Video Player ---

function isDirectVideo(url) {
  return /\.(mp4|webm|ogg|m3u8|mkv|mov)(\?|#|$)/i.test(url);
}

function isHls(url) {
  return /\.m3u8(\?|#|$)/i.test(url);
}

function youtubeId(url) {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function vimeoId(url) {
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return m ? m[1] : null;
}

function dailyMotionId(url) {
  const m = url.match(/dailymotion\.com\/(?:video|embed\/video)\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

// Many hosts serve a share page (refuses framing) and a separate embed page (allows it).
function hostEmbedUrl(url) {
  let u;
  try { u = new URL(url); } catch { return url; }
  const h = u.hostname.replace(/^www\./, '');
  const id = u.pathname.split('/').filter(Boolean).pop() || '';
  if (/dood/.test(h)) return u.pathname.match(/^\/[dv]\//) ? `${u.origin}/e/${id}` : url;
  if (/streamtape|strtape|tapeadvertisement/.test(h)) return u.pathname.startsWith('/v/') ? u.href.replace('/v/', '/e/') : url;
  if (/mixdrop|mxdrop/.test(h)) return u.pathname.startsWith('/f/') ? u.href.replace('/f/', '/e/') : url;
  if (/filemoon|moonplayer/.test(h)) return u.pathname.startsWith('/d/') ? u.href.replace('/d/', '/e/') : url;
  return url;
}

function normalizeEmbedUrl(url) {
  url = hostEmbedUrl(url);
  const yt = youtubeId(url);
  if (yt) return `https://www.youtube.com/embed/${yt}?autoplay=1&rel=0`;
  const vm = vimeoId(url);
  if (vm) return `https://player.vimeo.com/video/${vm}?autoplay=1`;
  const dm = dailyMotionId(url);
  if (dm) return `https://www.dailymotion.com/embed/video/${dm}?autoplay=1`;
  return url;
}

async function ensureHls() {
  if (window.Hls) return window.Hls;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js';
    script.onload = () => resolve(window.Hls);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// --- Player prefs: auto skip intro / outro, autoplay next ---

const playerPref = {
  get(key) {
    // Autoplay next permanently disabled
    if (key === 'autoplayNext') return false;
    try { const v = localStorage.getItem('anicore_' + key); return v === null ? true : v === '1'; } catch { return true; }
  },
  set(key, on) {
    if (key === 'autoplayNext') {
      try { localStorage.setItem('anicore_autoplayNext', '0'); } catch { /* noop */ }
      return;
    }
    try { localStorage.setItem('anicore_' + key, on ? '1' : '0'); } catch { /* noop */ }
  },
};

// "1:30" / "01:02:03" / "90" -> seconds. Empty -> null. Invalid -> NaN.
function parseTimeInput(v) {
  const t = String(v || '').trim();
  if (!t) return null;
  if (!/^\d+(:\d{1,2}){0,2}$/.test(t)) return NaN;
  return t.split(':').reduce((acc, n) => acc * 60 + Number(n), 0);
}

function fmtTimeInput(sec) {
  if (sec == null || sec === '') return '';
  const n = Math.max(0, Math.floor(Number(sec)));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const ss = String(n % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function nextPlayableIndex() {
  if (!videoContext || !Array.isArray(videoContext.episodes)) return -1;
  for (let i = videoContext.currentIndex + 1; i < videoContext.episodes.length; i++) {
    if (videoContext.episodes[i].video_url) return i;
  }
  return -1;
}

function playNextEpisode() {
  const idx = nextPlayableIndex();
  if (idx === -1) return false;
  videoContext.currentIndex = idx;
  loadVideoEpisode();
  return true;
}

function initPlayerTools() {
  try { localStorage.setItem('anicore_autoplayNext', '0'); } catch (e) {}
  document.querySelectorAll('#playerTools input[data-pref]').forEach((cb) => {
    if (cb.dataset.pref === 'autoplayNext') {
      cb.checked = false;
      cb.closest('label')?.classList.add('hidden');
      return;
    }
    cb.checked = playerPref.get(cb.dataset.pref);
    cb.addEventListener('change', () => playerPref.set(cb.dataset.pref, cb.checked));
  });
}

// Autoplay next: when a direct (<video>) episode ends, count down and play the next one.
function attachPlayerAutomation(video, wrap) {
  let advanced = false;

  const goNext = () => {
    if (advanced) return;
    advanced = true;
    if (!playNextEpisode()) advanced = false;
  };

  const showCountdown = () => {
    const idx = nextPlayableIndex();
    if (idx === -1 || advanced || wrap.querySelector('.player-next')) return;
    const nextEp = videoContext.episodes[idx];
    const box = document.createElement('div');
    box.className = 'player-next';
    box.innerHTML = `
      <p>Up next</p>
      <strong>${esc(epCode(nextEp))}${nextEp.title ? ' — ' + esc(nextEp.title) : ''}</strong>
      <span class="player-next-count"></span>
      <div class="player-next-actions">
        <button type="button" class="outline small" data-act="cancel">Cancel</button>
        <button type="button" class="primary small" data-act="now">Play now</button>
      </div>`;
    wrap.appendChild(box);
    let left = 5;
    const count = box.querySelector('.player-next-count');
    const render = () => { count.textContent = `Playing in ${left}s`; };
    render();
    const timer = setInterval(() => {
      if (!wrap.contains(box)) { clearInterval(timer); return; }
      left -= 1;
      if (left <= 0) { clearInterval(timer); box.remove(); goNext(); return; }
      render();
    }, 1000);
    box.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (act === 'cancel') { clearInterval(timer); box.remove(); }
      if (act === 'now') { clearInterval(timer); box.remove(); goNext(); }
    });
  };

  // Autoplay next removed — episode ends and stays
  video.addEventListener('ended', () => {
    try { saveWatchProgress(100); } catch (e) { /* noop */ }
  });

  // ---- Skip intro / outro (direct video links only) ----
  const ep = videoContext && videoContext.episodes[videoContext.currentIndex];
  if (!ep) return;
  const introEnd = Number.isFinite(Number(ep.intro_end)) && ep.intro_end !== null ? Number(ep.intro_end) : null;
  const introStart = Number.isFinite(Number(ep.intro_start)) && ep.intro_start !== null ? Number(ep.intro_start) : 0;
  const outroStart = Number.isFinite(Number(ep.outro_start)) && ep.outro_start !== null ? Number(ep.outro_start) : null;
  if (introEnd === null && outroStart === null) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'player-skip hidden';
  wrap.appendChild(btn);
  let mode = '';
  let autoIntroDone = false;
  let autoOutroDone = false;
  const hasNext = () => nextPlayableIndex() !== -1;

  const skipIntro = () => { video.currentTime = introEnd; };
  const skipOutro = () => {
    if (hasNext()) { advanced = true; playNextEpisode(); }
    else if (video.duration) video.currentTime = Math.max(0, video.duration - 0.25);
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (mode === 'intro') skipIntro(); else if (mode === 'outro') skipOutro();
  });

  video.addEventListener('timeupdate', () => {
    const t = video.currentTime;
    let next = '';
    if (introEnd !== null && introEnd > introStart && t >= introStart && t < introEnd - 0.5) next = 'intro';
    else if (outroStart !== null && t >= outroStart && (!video.duration || t < video.duration - 0.5)) next = 'outro';

    if (next === 'intro' && !autoIntroDone && playerPref.get('autoSkipIntro')) {
      autoIntroDone = true; skipIntro(); next = '';
    } else if (next === 'outro' && !autoOutroDone && playerPref.get('autoSkipOutro')) {
      autoOutroDone = true; skipOutro(); next = '';
    }

    if (next !== mode) {
      mode = next;
      btn.classList.toggle('hidden', !mode);
      if (mode === 'intro') btn.textContent = 'Skip Intro ▸▸';
      if (mode === 'outro') btn.textContent = hasNext() ? 'Next episode ▸▸' : 'Skip Outro ▸▸';
    }
  });
}

function clearPlayer() {
  const wrap = $('playerWrap');
  if (!wrap) return;
  if (document.body.classList.contains('tg-player-expanded')) setTgPlayerExpanded(false);
  const video = wrap.querySelector('video');
  if (video) {
    try { video.pause(); } catch { /* noop */ }
    video.removeAttribute('src');
    try { video.load(); } catch { /* noop */ }
  }
  wrap.innerHTML = '';
}


// Telegram draws its own overlay (Back/Close, collapse, menu) in native fullscreen and apps can't hide it.
// true  = true edge-to-edge fullscreen (Telegram overlay stays visible)
// false = no Telegram overlay, but the normal Telegram header bar stays on top
const TG_NATIVE_FULLSCREEN = true;

function tgViewportSize() {
  const vv = window.visualViewport;
  const w = Math.round((vv && vv.width) || window.innerWidth);
  const h = Math.round((TG && TG.isFullscreen ? window.innerHeight : 0) || (vv && vv.height) || window.innerHeight);
  return { w, h };
}

function updateTgRotate() {
  // If the phone is still portrait while the player is "full", rotate the player 90deg
  // with CSS so the video really covers the whole screen (Telegram can't force landscape).
  const expanded = document.body.classList.contains("tg-player-expanded");
  const { w, h } = tgViewportSize();
  // Exact pixel sizes (vh/dvh differ between Telegram clients and were leaving gaps)
  const root = document.documentElement.style;
  root.setProperty("--tg-fs-w", w + "px");
  root.setProperty("--tg-fs-h", h + "px");
  document.body.classList.toggle("tg-rotate", expanded && h > w);
}

function tgTryLockLandscape(on) {
  // Real landscape when the WebView allows it; CSS rotate stays as the fallback.
  try {
    const so = screen.orientation;
    if (!so) return;
    if (on) { so.lock && so.lock("landscape").catch(() => {}); }
    else { so.unlock && so.unlock(); }
  } catch (e) {}
}

let tgRotateWired = false;
function setTgPlayerExpanded(on) {
  on = !!on;
  const was = document.body.classList.contains("tg-player-expanded");
  document.body.classList.toggle("tg-player-expanded", on);
  let exit = document.getElementById("tgPlayerExit");
  if (on) {
    if (!exit) {
      exit = document.createElement("button");
      exit.type = "button";
      exit.id = "tgPlayerExit";
      exit.className = "tg-player-exit";
      exit.textContent = "✕ Exit full";
      exit.addEventListener("click", () => setTgPlayerExpanded(false));
      document.body.appendChild(exit);
    }
    if (!was) {
      try { if (TG_NATIVE_FULLSCREEN && TG && TG.requestFullscreen && !TG.isFullscreen) TG.requestFullscreen(); } catch (e) {}
      tgTryLockLandscape(true);
    }
    if (!tgRotateWired) {
      tgRotateWired = true;
      window.addEventListener("resize", updateTgRotate);
      window.visualViewport && window.visualViewport.addEventListener("resize", updateTgRotate);
      window.addEventListener("orientationchange", () => { setTimeout(updateTgRotate, 150); setTimeout(updateTgRotate, 500); });
    }
    try { TG && TG.BackButton && TG.BackButton.hide(); } catch (e) {}
    updateTgRotate();
    [100, 300, 700, 1200].forEach((ms) => setTimeout(updateTgRotate, ms));
  } else {
    try { window.tgSyncBack && window.tgSyncBack(); } catch (e) {}
    exit?.remove();
    document.body.classList.remove("tg-rotate");
    tgTryLockLandscape(false);
    try { if (TG && TG.exitFullscreen && TG.isFullscreen) TG.exitFullscreen(); } catch (e) {}
  }
}

// Floating full-screen button on top of the player (Telegram only)
function addTgFloatBtn(wrap) {
  if (!isTelegram || !wrap || wrap.querySelector(".tg-fs-float")) return;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "tg-fs-float";
  b.setAttribute("aria-label", "Full screen");
  b.textContent = "⛶";
  b.addEventListener("click", (e) => { e.stopPropagation(); setTgPlayerExpanded(true); });
  wrap.appendChild(b);
}

function wireTgVideoFullscreen(video, wrap) {
  if (!isTelegram || !video) return;
  // Double-tap player → expand to full Telegram viewport
  let lastTap = 0;
  wrap.addEventListener("click", () => {
    const now = Date.now();
    if (now - lastTap < 320) setTgPlayerExpanded(true);
    lastTap = now;
  });
  // Native fullscreen when user presses the fullscreen control
  video.addEventListener("webkitbeginfullscreen", () => setTgPlayerExpanded(true));
  video.addEventListener("webkitendfullscreen", () => setTgPlayerExpanded(false));
  const fsBtn = document.createElement("button");
  fsBtn.type = "button";
  fsBtn.className = "outline small tg-expand-btn";
  fsBtn.textContent = "⛶ Full screen";
  fsBtn.style.margin = "8px 14px";
  fsBtn.addEventListener("click", () => {
    setTgPlayerExpanded(true);
    try {
      if (video.requestFullscreen) video.requestFullscreen();
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
    } catch (e) {}
  });
  // Insert after player wrap if not present
  if (!document.querySelector(".tg-expand-btn")) {
    wrap.parentNode?.insertBefore(fsBtn, wrap.nextSibling);
  }
}


// --- Open links in the phone's real browser (Telegram only) ---
function openExternal(url) {
  try {
    if (isTelegram && TG && TG.openLink) {
      TG.openLink(url, { try_browser: "chrome" });
      return;
    }
  } catch (e) {}
  window.open(url, "_blank", "noopener");
}

document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest("#playerOpenLink");
  if (!a || !isTelegram) return;
  e.preventDefault();
  openExternal(a.href);
});

// "Watch in browser" button under the player (Telegram only)
function setWatchInBrowserBtn(url) {
  if (!isTelegram) return;
  const wrap = $("playerWrap");
  if (!wrap) return;
  let btn = document.getElementById("watchInBrowserBtn");
  if (!btn) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.id = "watchInBrowserBtn";
    btn.className = "outline small";
    btn.style.margin = "8px 14px";
    btn.textContent = "🌐 Watch in browser";
    btn.addEventListener("click", () => {
      if (btn.dataset.url) openExternal(btn.dataset.url);
    });
    wrap.parentNode?.insertBefore(btn, wrap.nextSibling);
  }
  btn.dataset.url = url;
}

async function mountPlayer(url, posterSrc = '', startPercent = 0) {
  const wrap = $('playerWrap');
  if (!wrap) return;

  clearPlayer();
  try { setWatchInBrowserBtn(isDirectVideo(url) ? url : normalizeEmbedUrl(url)); } catch (e) {}

  const fallback = $('playerFallback');
  const openLink = $('playerOpenLink');
  if (fallback) fallback.classList.add('hidden');
  if (openLink) openLink.href = url;

  if (isDirectVideo(url)) {
    const video = document.createElement('video');
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = 'metadata';
    if (posterSrc) video.poster = posterSrc;
    video.setAttribute('playsinline', '');
    let lastSave = 0;
    video.addEventListener('timeupdate', () => {
      if (!video.duration) return;
      const now = Date.now();
      if (now - lastSave < 15000) return;
      lastSave = now;
      saveWatchProgress(Math.round((video.currentTime / video.duration) * 100));
    });
    video.addEventListener('ended', () => saveWatchProgress(100));
    video.addEventListener('pause', () => {
      if (video.duration && !video.ended) saveWatchProgress(Math.round((video.currentTime / video.duration) * 100));
    });
    if (startPercent > 0 && startPercent < 95) {
      video.addEventListener('loadedmetadata', () => {
        if (video.duration) video.currentTime = (video.duration * startPercent) / 100;
      }, { once: true });
    }

    if (isHls(url)) {
      try {
        const HlsLib = await ensureHls();
        if (HlsLib && HlsLib.isSupported()) {
          const hls = new HlsLib();
          hls.loadSource(url);
          hls.attachMedia(video);
        } else {
          video.src = url;
        }
      } catch {
        video.src = url;
      }
    } else {
      video.src = url;
    }
    wrap.appendChild(video);
    $('skipNote')?.classList.add('hidden');
    attachPlayerAutomation(video, wrap);
    // Browsers can reject autoplay; the user can still press play.
    video.play?.()?.catch?.(() => {});
  } else {
    const mountIframe = () => {
      wrap.innerHTML = '';
      const iframe = document.createElement('iframe');
      iframe.allowFullscreen = true;
      iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; clipboard-write; fullscreen');
      iframe.src = normalizeEmbedUrl(url);
      wrap.appendChild(iframe);
      if (openLink) openLink.href = normalizeEmbedUrl(url);
      $('skipNote')?.classList.remove('hidden');
    };

    if (posterSrc && !playerPref.get('autoplayNext')) {
      const cover = document.createElement('button');
      cover.type = 'button';
      cover.className = 'player-cover';
      cover.setAttribute('aria-label', 'Play');
      cover.style.backgroundImage = `url("${posterSrc.replace(/"/g, '%22')}")`;
      cover.innerHTML = '<span class="player-play">&#9654;</span>';
      cover.addEventListener('click', mountIframe, { once: true });
      wrap.appendChild(cover);
    } else {
      mountIframe();
    }
  }
}

// --- Watch page: episode list (filter, EP badges, PLAYING, next-episode countdown) ---

const airInfo = {};
function rememberAir(item) {
  if (!item || !item._id) return;
  airInfo[item._id] = { air_weekday: item.air_weekday, air_time: item.air_time, status: item.status };
}

function nextAirDate(air) {
  if (!air || air.air_weekday == null || !/^\d{2}:\d{2}$/.test(air.air_time || '')) return null;
  if (String(air.status || '').toLowerCase() === 'completed') return null;
  const [h, m] = air.air_time.split(':').map(Number);
  const now = new Date();
  const weekStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - ((now.getUTCDay() + 6) % 7) * 864e5;
  let t = weekStart + Number(air.air_weekday) * 864e5 + (h * 60 + m) * 6e4;
  while (t <= now.getTime()) t += 7 * 864e5;
  return new Date(t);
}

function fmtCountdown(ms) {
  const mins = Math.max(0, Math.floor(ms / 6e4));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

function renderVideoEpList() {
  const box = $('videoEpList');
  if (!box) return;
  if (!videoContext || videoContext.type === 'movie' || videoContext.episodes.length < 2) {
    box.innerHTML = '';
    return;
  }
  const { episodes, currentIndex, air } = videoContext;
  const cur = episodes[currentIndex];
  const seasons = [...new Set(episodes.map((e) => e.season))];
  if (videoContext.listSeason == null || !seasons.includes(videoContext.listSeason)) videoContext.listSeason = cur.season;

  const nextAt = nextAirDate(air);
  const regularNos = episodes.filter((e) => Number(e.season) !== 0 && Number(e.episode) < 1000).map((e) => Number(e.episode));
  const nextNo = (regularNos.length ? Math.max(...regularNos) : 0) + 1;
  const bell = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 22a2.2 2.2 0 0 0 2.2-2.2h-4.4A2.2 2.2 0 0 0 12 22zm6.5-6.2V11c0-3.1-1.7-5.7-4.6-6.4V4a1.9 1.9 0 0 0-3.8 0v.6C7.2 5.3 5.5 7.9 5.5 11v4.8L3.5 17.8V19h17v-1.2z"/></svg>';

  box.innerHTML = `
    <div class="ep-list">
      ${seasons.length > 1 ? `<div class="ep-seasons">${seasons.map((n) =>
        `<button type="button" class="ep-season-btn ${n === videoContext.listSeason ? 'active' : ''}" data-season="${esc(n)}">${esc(seasonLabel(n))}</button>`).join('')}</div>` : ''}
      <input type="search" id="epFilter" class="ep-filter" placeholder="Filter episodes..." autocomplete="off" value="${esc(videoContext.epFilter || '')}">
      <div class="ep-rows" id="epRows"></div>
      <button type="button" class="ep-more hidden" id="epMore"></button>
      ${nextAt ? `<div class="ep-next">${bell}<span><strong>Episode ${esc(nextNo)}</strong> in <strong id="epNextIn">${fmtCountdown(nextAt - Date.now())}</strong> <span class="ep-next-date">· ${nextAt.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${pad2(nextAt.getHours())}:${pad2(nextAt.getMinutes())}</span></span></div>` : ''}
    </div>`;

  const LIMIT = 10;
  const fillRows = () => {
    const q = (videoContext.epFilter || '').trim().toLowerCase();
    const rows = $('epRows');
    const more = $('epMore');
    const matches = [];
    episodes.forEach((ep, i) => {
      if (ep.season !== videoContext.listSeason) return;
      const name = epBadge(ep);
      if (q && !name.toLowerCase().includes(q)) return;
      matches.push({ ep, i, name });
    });
    // open the list automatically when the playing episode would be hidden
    if (videoContext.epExpanded == null) videoContext.epExpanded = matches.findIndex((m) => m.i === currentIndex) >= LIMIT;
    const expanded = !!q || videoContext.epExpanded;
    const visible = expanded ? matches : matches.slice(0, LIMIT);
    rows.innerHTML = visible.map(({ ep, i, name }) => {
      const playing = i === currentIndex;
      const off = !ep.video_url;
      const kind = Number(ep.season) === 0 ? 'special' : epKind(ep);
      return `
        <button type="button" class="ep-row ${kind !== 'episode' ? 'ep-' + kind : ''} ${playing ? 'playing' : ''} ${off ? 'off' : ''}" data-idx="${i}" ${off ? 'disabled' : ''}>
          <span class="ep-badge">${esc(epBadge(ep))}</span>
          <span class="ep-info"><span class="ep-name">${esc(name)}</span>${ep.duration ? `<span class="ep-dur">${esc(ep.duration)}</span>` : ''}</span>
          ${playing ? '<span class="ep-playing">PLAYING</span>' : ''}
        </button>`;
    }).join('') || '<p class="muted ep-none">No episodes found.</p>';
    if (more) {
      more.classList.toggle('hidden', !!q || matches.length <= LIMIT);
      more.textContent = videoContext.epExpanded ? 'Show less ▴' : `Show all ${matches.length} ▾`;
    }
  };
  $('epMore')?.addEventListener('click', () => { videoContext.epExpanded = !videoContext.epExpanded; fillRows(); });
  fillRows();

  $('epFilter').addEventListener('input', (ev) => {
    videoContext.epFilter = ev.target.value;
    fillRows();
  });
  box.querySelectorAll('.ep-season-btn').forEach((b) => b.addEventListener('click', () => {
    videoContext.listSeason = Number(b.dataset.season);
    renderVideoEpList();
  }));
  $('epRows').addEventListener('click', (ev) => {
    const row = ev.target.closest('.ep-row');
    if (!row || row.disabled) return;
    const idx = Number(row.dataset.idx);
    if (idx === videoContext.currentIndex) return;
    videoContext.currentIndex = idx;
    loadVideoEpisode();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // keep the countdown live
  clearInterval(renderVideoEpList._t);
  if (nextAt) {
    renderVideoEpList._t = setInterval(() => {
      const el = $('epNextIn');
      if (!el) { clearInterval(renderVideoEpList._t); return; }
      el.textContent = fmtCountdown(nextAt - Date.now());
    }, 30000);
  }
}

function openVideo(type, contentId, contentTitle, episodes, season, episode, poster, resumePercent = 0, seasonThumbnails = null) {
  const swap = allowSwap; allowSwap = false;
  if (!swap) { gotoUrl(watchPath(type, contentId, contentTitle, season, episode)); return; }
  const sorted = [...episodes].sort((a, b) => cmpEp(a, b));
  const idx = sorted.findIndex((e) => Number(e.season) === Number(season) && Number(e.episode) === Number(episode));
  if (idx === -1) { toast('Episode not found', 'error'); return; }
  const ep = sorted[idx];
  if (!ep.video_url) { toast('No video for this episode', 'error'); return; }

  videoContext = {
    type,
    contentId,
    contentTitle,
    episodes: sorted,
    currentIndex: idx,
    poster: poster || null,
    season_thumbnails: seasonThumbnails || {},
    air: airInfo[contentId] || null,
    epFilter: '',
    listSeason: null,
    // Only applies to the first episode loaded; lets a direct video pick up where it stopped.
    resumePercent: Number(resumePercent) || 0,
  };
  state.detailId = contentId;
  state.detailType = type;
  state.detailTitle = contentTitle || state.detailTitle;
  loadVideoEpisode();
  allowSwap = true;
  showPage('video');
}

// Opens the player straight from a /anime/<name>/s1e3 link (page refresh, shared link, Back/Forward).
async function openVideoFromLink(type, ref, s, e) {
  try {
    let id = ref;
    if (!isRealId(id)) id = (await api(`/api/resolve/${type}/${encodeURIComponent(ref)}`))._id;
    const full = await api(`/api/content/${type}/${id}`);
    rememberAir(full);
    const eps = [...(full.episodes || [])].sort((a, b) => cmpEp(a, b));
    const ep = eps.find((x) => Number(x.season) === Number(s) && Number(x.episode) === Number(e) && x.video_url);
    if (!ep) { allowSwap = true; openDetail(type, id); return; }
    try { if (history.state) history.replaceState({ ...history.state, key: `video:${type}:${id}`, detailId: id }, '', location.href); } catch (err) {}
    allowSwap = true;
    openVideo(type, id, full.title, eps, ep.season, ep.episode, full.banner || full.poster, 0, full.season_thumbnails || {});
  } catch (err) {
    toast('Could not open this video.', 'error');
    gotoUrl('/');
  }
}


// --- Save watch progress (used to resume inside the player) ---

function saveWatchProgress(percent = 0) {
  if (!state.user || !videoContext || videoContext.type === 'movie') return;
  const ep = videoContext.episodes[videoContext.currentIndex];
  if (!ep) return;
  api('/api/progress', {
    method: 'POST',
    body: JSON.stringify({
      content_type: videoContext.type,
      content_id: videoContext.contentId,
      season: Number(ep.season),
      episode: Number(ep.episode),
      progress_percent: Math.max(0, Math.min(100, Number(percent) || 0)),
    }),
  }).catch(() => {});
}

function loadVideoEpisode() {
  if (!videoContext) return;
  const ep = videoContext.episodes[videoContext.currentIndex];
  $('videoTitle').textContent = videoContext.contentTitle;
  const sub = `${epCode(ep)}${ep.duration ? ' · ' + ep.duration : ''}`;
  $('videoSubtitle').textContent = sub;

  // Season / episode thumbnail above player
  let thumbEl = $('videoThumb');
  if (!thumbEl) {
    const header = document.querySelector('.video-header');
    if (header) {
      thumbEl = document.createElement('img');
      thumbEl.id = 'videoThumb';
      thumbEl.className = 'video-thumb';
      thumbEl.alt = '';
      header.appendChild(thumbEl);
    }
  }
  if (thumbEl) {
    const src = safeUrl(ep.thumbnail) || seasonThumb(videoContext.episodes, ep.season) || safeUrl(videoContext.poster) || '';
    if (src) {
      thumbEl.src = src;
      thumbEl.classList.remove('hidden');
      thumbEl.onerror = () => thumbEl.classList.add('hidden');
    } else {
      thumbEl.removeAttribute('src');
      thumbEl.classList.add('hidden');
    }
  }

  const posterSrc = safeUrl(ep.thumbnail) || seasonThumb(videoContext.episodes, ep.season) || safeUrl(videoContext.poster) || '';
  const startPercent = videoContext.resumePercent || 0;
  videoContext.resumePercent = 0;
  mountPlayer(ep.video_url, posterSrc, startPercent);
  updateVideoNav();
  renderVideoEpList();
  saveWatchProgress(startPercent);
  // New episode -> new link (replace, so Back still leaves the player in one step)
  if (state.page === 'video') {
    try {
      const u = watchPath(videoContext.type, videoContext.contentId, videoContext.contentTitle, ep.season, ep.episode) + location.search;
      history.replaceState({ ...(history.state || {}), watchS: ep.season, watchE: ep.episode }, '', u);
      const nav = JSON.parse(sessionStorage.getItem('anicore-nav') || '{}');
      sessionStorage.setItem('anicore-nav', JSON.stringify({ ...nav, watchS: ep.season, watchE: ep.episode }));
    } catch (e) {}
    buzz('select');
  }
}

function updateVideoNav() {
  const prevBtn = $('videoPrev');
  const nextBtn = $('videoNext');
  if (!prevBtn || !nextBtn) return;

  if (!videoContext || !Array.isArray(videoContext.episodes) || !videoContext.episodes.length) {
    prevBtn.hidden = true;
    nextBtn.hidden = true;
    prevBtn.classList.add('hidden-nav-btn');
    nextBtn.classList.add('hidden-nav-btn');
    return;
  }

  const { episodes, currentIndex } = videoContext;
  const prevEp = currentIndex > 0 ? episodes[currentIndex - 1] : null;
  const nextEp = currentIndex < episodes.length - 1 ? episodes[currentIndex + 1] : null;

  // Ep 1 → hide Previous. Last ep → hide Next.
  if (prevEp) {
    prevBtn.hidden = false;
    prevBtn.classList.remove('hidden-nav-btn');
    prevBtn.disabled = false;
    prevBtn.textContent = `← ${epCode(prevEp, true)}`;
  } else {
    prevBtn.hidden = true;
    prevBtn.classList.add('hidden-nav-btn');
    prevBtn.disabled = true;
  }

  if (nextEp) {
    nextBtn.hidden = false;
    nextBtn.classList.remove('hidden-nav-btn');
    nextBtn.disabled = false;
    nextBtn.textContent = `${epCode(nextEp, true)} →`;
  } else {
    nextBtn.hidden = true;
    nextBtn.classList.add('hidden-nav-btn');
    nextBtn.disabled = true;
  }

  const nav = prevBtn.parentElement;
  if (nav) {
    nav.classList.toggle('only-next', !prevEp && !!nextEp);
    nav.classList.toggle('only-prev', !!prevEp && !nextEp);
  }
}

initPlayerTools();

$('videoPrev')?.addEventListener('click', () => {
  if (!videoContext || videoContext.currentIndex <= 0) return;
  videoContext.currentIndex -= 1;
  loadVideoEpisode();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

$('videoNext')?.addEventListener('click', () => {
  if (!videoContext || videoContext.currentIndex >= videoContext.episodes.length - 1) return;
  videoContext.currentIndex += 1;
  loadVideoEpisode();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

$('videoBack')?.addEventListener('click', () => {
  if (history.state && history.state.page === 'video') { history.back(); return; }
  clearPlayer();
  const backType = videoContext?.type || state.detailType;
  const backId = videoContext?.contentId || state.detailId;
  videoContext = null;
  if (backType && backId) {
    openDetail(backType, backId);
  } else {
    showPage('home');
  }
});

// --- Admin ---

async function loadAdminStats() {
  if (state.user?.role !== 'admin') return;
  try {
    const s = await api('/api/admin/stats');
    $('adminStats').innerHTML = `
      <div class="stat-card"><strong>${s.anime}</strong><span>Anime</span></div>
      <div class="stat-card"><strong>${s.tv_shows}</strong><span>TV Shows</span></div>
      <div class="stat-card"><strong>${s.movies}</strong><span>Movies</span></div>
      <div class="stat-card"><strong>${s.users}</strong><span>Users</span></div>
      <div class="stat-card"><strong>${s.requests_pending}</strong><span>Pending Requests</span></div>
    `;
  } catch { /* ignore */ }
}

async function loadAdminRequests() {
  try {
    const rows = await api('/api/admin/requests');
    const el = $('adminRequests');
    if (!rows.length) { el.innerHTML = '<p class="muted">No requests yet.</p>'; return; }
    el.innerHTML = rows.map((r) => `
      <div class="request-row">
        <div>
          <strong>${esc(r.title)}</strong>
          <p class="muted">${esc(r.language)} · ${esc(r.email)} · ${esc(fmtDate(r.created_at))}</p>
          ${r.notes ? `<p>${esc(r.notes)}</p>` : ''}
        </div>
        <select data-id="${esc(r._id)}" class="req-status">
          ${['Pending', 'Approved', 'Rejected', 'Completed'].map((s) =>
            `<option ${r.status === s ? 'selected' : ''}>${s}</option>`
          ).join('')}
        </select>
      </div>`).join('');

    el.querySelectorAll('.req-status').forEach((sel) => {
      sel.addEventListener('change', async () => {
        try {
          await api(`/api/admin/requests/${sel.dataset.id}`, {
            method: 'PATCH', body: JSON.stringify({ status: sel.value }),
          });
          toast('Request updated');
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  } catch (err) { toast(err.message, 'error'); }
}

let libPage = 0;
async function loadTrash() {
  const el = $('libList');
  $('libMore').classList.add('hidden');
  try {
    const data = await api('/api/admin/trash');
    el.innerHTML = '';
    if (!data.items.length) { el.innerHTML = '<p class="hint">The trash is empty. Deleted titles stay here for 30 days.</p>'; return; }
    data.items.forEach((t) => {
      const days = Math.max(0, Math.ceil((new Date(t.expires_at) - Date.now()) / 86400000));
      const row = document.createElement('div');
      row.className = 'lib-row';
      row.innerHTML = `
        <img src="${esc(safeUrl(t.poster) || PLACEHOLDER)}" alt="">
        <div><h4>${esc(t.title)}</h4><p>${esc(t.content_type)} · deleted ${esc(new Date(t.deleted_at).toLocaleDateString())} · ${days}d left</p></div>
        <div class="lib-actions">
          <button type="button" class="outline restore-btn">Restore</button>
          <button type="button" class="outline danger purge-btn">Delete forever</button>
        </div>`;
      row.querySelector('.restore-btn').addEventListener('click', async () => {
        try { await api(`/api/admin/trash/${t._id}/restore`, { method: 'POST' }); toast('Restored'); loadTrash(); } catch (err) { toast(err.message, 'error'); }
      });
      row.querySelector('.purge-btn').addEventListener('click', async () => {
        if (!confirm(`Delete "${t.title}" forever? This cannot be undone.`)) return;
        try { await api(`/api/admin/trash/${t._id}`, { method: 'DELETE' }); toast('Deleted permanently'); loadTrash(); } catch (err) { toast(err.message, 'error'); }
      });
      el.appendChild(row);
    });
  } catch (err) { toast(err.message, 'error'); }
}

async function loadLibrary(reset = false) {
  if (!['admin', 'uploader'].includes(state.user?.role)) return;
  if (reset) libPage = 0;
  const type = $('libType').value;
  if (type === 'trash') return loadTrash();
  const q = $('libSearch').value.trim();
  const endpoint = type === 'anime' ? '/api/anime' : type === 'tv_show' ? '/api/tvshows' : '/api/movies';
  try {
    const data = await api(`${endpoint}?page=${libPage + 1}&limit=20&include_hidden=true&q=${encodeURIComponent(q)}`);
    libPage += 1;
    const el = $('libList');
    if (reset) el.innerHTML = '';
    data.items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'lib-row';
      const chips = [
        item.status ? `<span class="lib-chip">${esc(item.status)}</span>` : '',
        `<span class="lib-chip">${item.year || '—'}</span>`,
        `<span class="lib-chip">★ ${item.avg_rating || '—'}</span>`,
        item.hero ? `<span class="lib-chip hot">🎬 Hero${item.hero_order ? ' #' + item.hero_order : ''}</span>` : '',
        item.top_airing ? `<span class="lib-chip hot">🔥 Top${item.top_rank ? ' #' + item.top_rank : ''}</span>` : '',
        item.published === false && item.scheduled_at ? `<span class="lib-chip">⏳ ${esc(new Date(item.scheduled_at).toLocaleString())}</span>` : '',
      ].join('');
      row.innerHTML = `
        <img src="${esc(safeUrl(item.poster) || PLACEHOLDER)}" alt="">
        <div class="lib-main">
          <h4>${esc(item.title)}</h4>
          <div class="lib-chips">${chips}</div>
        </div>
        <div class="lib-actions">
          ${type !== 'movie' ? `<button type="button" class="outline ep-btn"
            data-type="${esc(type)}"
            data-id="${esc(item._id)}"
            data-title="${esc(item.title)}">Eps</button>` : ''}
          <button type="button" class="outline edit-btn">Edit</button>
          <button type="button" class="outline danger del-btn">Del</button>
        </div>`;

      row.querySelector('.edit-btn').addEventListener('click', () => {
        $('aId').value = item._id;
        $('aType').value = type;
        $('aTitle').value = item.title || '';
        $('aDesc').value = item.description || '';
        $('aGenres').value = (item.genres || []).join(', ');
        $('aYear').value = item.year || '';
        $('aRating').value = item.rating || '';
        $('aStatus').value = item.status || 'Ongoing';
        $('aPoster').value = item.poster || '';
        $('aBanner').value = item.banner || '';
        if ($('aPosterTag')) $('aPosterTag').value = item.poster_tag || 'AUTO';
        if ($('aDuration')) $('aDuration').value = item.duration || '';
        fillScheduleFields(item);
        $('aHero').checked = !!item.hero;
        $('aHeroOrder').value = item.hero_order || '';
        $('aTopAiring').checked = !!item.top_airing;
        $('aTopRank').value = item.top_rank || '';
        $('adminFormTitle').textContent = 'Edit Content';
        $('aSubmit').textContent = 'Update';
        $('aCancel').classList.remove('hidden');
        $('adminForm').scrollIntoView({ behavior: 'smooth' });
      });
      row.querySelector('.del-btn').addEventListener('click', async () => {
        if (!confirm(`Move "${item.title}" to the trash? You can restore it for 30 days.`)) return;
        try {
          await api(`/api/admin/content/${type}/${item._id}`, { method: 'DELETE' });
          toast('Moved to trash');
          loadLibrary(true);
        } catch (err) { toast(err.message, 'error'); }
      });
      el.appendChild(row);
    });
    $('libMore').classList.toggle('hidden', libPage * 20 >= data.total);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Event delegation for "Eps" button
$('libList')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.ep-btn');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  openEpisodesModal(btn.dataset.type, btn.dataset.id, btn.dataset.title);
});

$('libType')?.addEventListener('change', () => loadLibrary(true));
$('libSearch')?.addEventListener('input', (() => {
  let t;
  return () => { clearTimeout(t); t = setTimeout(() => loadLibrary(true), 300); };
})());
$('libMore')?.addEventListener('click', () => loadLibrary());

$('adminForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('aId').value;
  const type = $('aType').value;
  const payload = {
    title: $('aTitle').value.trim(),
    description: $('aDesc').value.trim(),
    genres: $('aGenres').value.split(',').map((g) => g.trim()).filter(Boolean),
    year: $('aYear').value ? Number($('aYear').value) : null,
    rating: $('aRating').value.trim(),
    status: $('aStatus').value,
    poster_tag: ($('aPosterTag')?.value || 'AUTO').trim() || 'AUTO',
    duration: ($('aDuration')?.value || '').trim(),
    ...readScheduleFields(),
    hero: $('aHero').checked,
    hero_order: Number($('aHeroOrder').value) || 0,
    top_airing: $('aTopAiring').checked,
    top_rank: Number($('aTopRank').value) || 0,
  };

  const btn = $('aSubmit');
  btn.disabled = true;
  try {
    if (id) {
      await api(`/api/admin/content/${type}/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      toast('Updated');
    } else {
      const path = type === 'anime' ? '/api/admin/anime' : type === 'tv_show' ? '/api/admin/tvshows' : '/api/admin/movies';
      try {
        await api(path, { method: 'POST', body: JSON.stringify(payload) });
      } catch (err) {
        if (!String(err.message).startsWith('DUPLICATE:')) throw err;
        if (!confirm(String(err.message).replace('DUPLICATE:', '').trim() + '\n\nAdd it anyway?')) throw new Error('Not added');
        await api(path, { method: 'POST', body: JSON.stringify({ ...payload, force: true }) });
      }
      toast('Added');
    }
    e.target.reset();
    $('aId').value = '';
    $('adminFormTitle').textContent = 'Add Content';
    $('aSubmit').textContent = 'Save';
    $('aCancel').classList.add('hidden');
    loadLibrary(true);
    loadAdminStats();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

$('aCancel')?.addEventListener('click', () => {
  $('adminForm').reset();
  $('aId').value = '';
  $('adminFormTitle').textContent = 'Add Content';
  $('aSubmit').textContent = 'Save';
  $('aCancel').classList.add('hidden');
});

// --- Admin Episode Manager ---
let currentEpisodeTarget = null;

function openEpisodesModal(type, id, title) {
  currentEpisodeTarget = { type, id, title, mal_id: state._lastMalId || null };
  $('episodesTitle').textContent = `Episodes — ${title}`;
  $('episodeForm').reset();
  $('epId').value = '';
  $('epSeason').value = 1;
  $('epSubmit').textContent = 'Add Episode';
  $('epCancel').classList.add('hidden');
  $('episodesModal').classList.remove('hidden');
  refreshEpisodeList();
}

async function refreshEpisodeList() {
  if (!currentEpisodeTarget) return;
  const { type, id } = currentEpisodeTarget;
  try {
    const doc = await api(`/api/content/${type}/${id}`);
    const eps = (doc.episodes || []).sort((a, b) => cmpEp(a, b));
    const el = $('episodeList');
    if (!eps.length) { el.innerHTML = '<p class="muted">No episodes yet. Add your first above.</p>'; return; }
    el.innerHTML = eps.map((ep) => `
      <div class="ep-admin-row">
        <div>
          <strong>${esc(epCode(ep, true))}</strong>${ep.title ? ` — ${esc(ep.title)}` : ''}
          ${ep.video_url
            ? `<p class="muted" style="margin:2px 0 0;font-size:12px;overflow-wrap:anywhere">${esc(ep.video_url)}</p>`
            : '<p class="muted" style="margin:2px 0 0;font-size:12px">⚠ No video link</p>'}
        </div>
        <div class="lib-actions">
          <button class="outline small ep-edit" type="button"
            data-s="${ep.season}" data-e="${ep.episode}">Edit</button>
          <button class="outline small danger ep-del" type="button"
            data-s="${ep.season}" data-e="${ep.episode}">Del</button>
        </div>
      </div>`).join('');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function moveEpisodeBatchSeason() {
  const msg = $('batchSeasonMsg');
  const fromSeason = Number($('batchSeasonFrom')?.value);
  const toSeason = Number($('batchSeasonTo')?.value);
  if (!currentEpisodeTarget) return;
  if (!Number.isInteger(fromSeason) || fromSeason < 0 || !Number.isInteger(toSeason) || toSeason < 0) {
    if (msg) msg.textContent = 'Enter valid season numbers.';
    return;
  }
  if (fromSeason === toSeason) {
    if (msg) msg.textContent = 'Choose two different seasons.';
    return;
  }
  const btn = $('batchSeasonApply');
  if (btn) btn.disabled = true;
  try {
    const { type, id, title } = currentEpisodeTarget;
    const doc = await api(`/api/content/${type}/${id}`);
    const all = doc.episodes || [];
    const source = all.filter((ep) => Number(ep.season ?? 1) === fromSeason);
    if (!source.length) throw new Error(`No episodes found in Season ${fromSeason}.`);
    const targetKeys = new Set(all.filter((ep) => Number(ep.season ?? 1) === toSeason).map((ep) => Number(ep.episode)));
    const conflicts = source.filter((ep) => targetKeys.has(Number(ep.episode)));
    if (conflicts.length) {
      const labels = conflicts.slice(0, 8).map((ep) => `EP ${epNo(ep)}`).join(', ');
      throw new Error(`Cannot move: Season ${toSeason} already has matching episode number(s): ${labels}${conflicts.length > 8 ? ', …' : ''}. No episodes were changed.`);
    }
    if (!confirm(`Move all ${source.length} episodes of ${title} from Season ${fromSeason} to Season ${toSeason}? Episode numbers and video links will stay the same.`)) return;
    let moved = 0;
    for (const ep of source) {
      await api(`/api/admin/${type}/${id}/episodes/${fromSeason}/${ep.episode}`, {
        method: 'PUT',
        body: JSON.stringify({ season: toSeason }),
      });
      moved++;
      if (msg) msg.textContent = `Moving episodes… ${moved}/${source.length}`;
    }
    if (msg) msg.textContent = `Done — moved ${moved} episode(s) to Season ${toSeason}.`;
    toast(`Moved ${moved} episodes to Season ${toSeason}`);
    await refreshEpisodeList();
    loadLibrary(true);
  } catch (err) {
    if (msg) msg.textContent = err.message || 'Could not change the season.';
    toast(err.message || 'Could not change the season.', 'error');
    await refreshEpisodeList();
  } finally {
    if (btn) btn.disabled = false;
  }
}
$('batchSeasonApply')?.addEventListener('click', moveEpisodeBatchSeason);

$('episodeList')?.addEventListener('click', async (e) => {
  const editBtn = e.target.closest('.ep-edit');
  const delBtn = e.target.closest('.ep-del');

  if (editBtn) {
    e.preventDefault();
    const s = Number(editBtn.dataset.s);
    const en = Number(editBtn.dataset.e);
    if (!currentEpisodeTarget) return;

    try {
      const doc = await api(`/api/content/${currentEpisodeTarget.type}/${currentEpisodeTarget.id}`);
      const eps = doc.episodes || [];
      const ep = eps.find((x) => Number(x.season) === s && Number(x.episode) === en);
      if (!ep) {
        toast('Episode not found — refresh and try again', 'error');
        return;
      }
      $('epSeason').value = ep.season;
      $('epNumber').value = epNo(ep);
      if ($('epKind')) $('epKind').value = epKind(ep);
      $('epDuration').value = ep.duration || '';
      $('epVideo').value = ep.video_url || '';
      $('epIntroStart').value = fmtTimeInput(ep.intro_start);
      $('epIntroEnd').value = fmtTimeInput(ep.intro_end);
      $('epOutroStart').value = fmtTimeInput(ep.outro_start);
      if (ep.intro_start != null || ep.intro_end != null || ep.outro_start != null) {
        const extras = document.querySelector('#episodeForm .ep-extras');
        if (extras) extras.open = true;
      }
      $('epId').value = `${s}_${en}`;
      $('epSubmit').textContent = 'Update Episode';
      $('epCancel').classList.remove('hidden');
      $('episodeForm').scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }

  if (delBtn) {
    e.preventDefault();
    if (!currentEpisodeTarget) return;
    if (!confirm('Delete this episode?')) return;
    try {
      await api(`/api/admin/${currentEpisodeTarget.type}/${currentEpisodeTarget.id}/episodes/${delBtn.dataset.s}/${delBtn.dataset.e}`, { method: 'DELETE' });
      toast('Episode deleted');
      refreshEpisodeList();
    } catch (err) { toast(err.message, 'error'); }
  }
});

// Auto-extract src URL from pasted <iframe ...> HTML
$('epVideo')?.addEventListener('paste', (e) => {
  const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
  const m = text.match(/<iframe[^>]*\ssrc=["']([^"']+)["']/i);
  if (m) {
    e.preventDefault();
    $('epVideo').value = m[1];
    toast('Extracted URL from iframe');
  }
});

$('episodeForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentEpisodeTarget) return toast('No content selected', 'error');
  const { type, id } = currentEpisodeTarget;

  let rawVideo = $('epVideo').value.trim();
  const iframeMatch = rawVideo.match(/<iframe[^>]*\ssrc=["']([^"']+)["']/i);
  if (iframeMatch) rawVideo = iframeMatch[1];

  const payload = {
    season: seasonNum($('epSeason').value),
    episode: kindBase($('epKind')?.value) + (Number($('epNumber').value) || 0),
    duration: $('epDuration').value.trim(),
    video_url: rawVideo,
  };

  const introStart = parseTimeInput($('epIntroStart')?.value);
  const introEnd = parseTimeInput($('epIntroEnd')?.value);
  const outroStart = parseTimeInput($('epOutroStart')?.value);
  if ([introStart, introEnd, outroStart].some(Number.isNaN)) return toast('Use times like 1:30 or 90', 'error');
  payload.intro_start = introStart;
  payload.intro_end = introEnd;
  payload.outro_start = outroStart;

  if (!Number($('epNumber').value)) return toast('Episode number required', 'error');
  if (!payload.video_url) return toast('Video URL required', 'error');
  if (!payload.video_url.startsWith('https://')) return toast('Video URL must start with https://', 'error');

  const epId = $('epId').value;
  try {
    if (epId) {
      const [s, eNum] = epId.split('_').map(Number);
      await api(`/api/admin/${type}/${id}/episodes/${s}/${eNum}`, {
        method: 'PUT', body: JSON.stringify(payload),
      });
      toast('Episode updated');
    } else {
      const path = type === 'anime'
        ? `/api/admin/anime/${id}/episodes`
        : `/api/admin/tvshows/${id}/episodes`;
      await api(path, { method: 'POST', body: JSON.stringify(payload) });
      toast('Episode added');
    }
    if ($('epIntroAllSeason')?.checked && introEnd !== null) {
      try {
        const doc = await api(`/api/content/${type}/${id}`);
        const same = (doc.episodes || []).filter((x) => Number(x.season) === Number(payload.season));
        await Promise.all(same.map((x) => api(`/api/admin/${type}/${id}/episodes/${x.season}/${x.episode}`, {
          method: 'PUT', body: JSON.stringify({ intro_start: introStart, intro_end: introEnd }),
        })));
        toast(`Intro times set on ${same.length} episode(s)`);
      } catch (err) { toast(err.message || 'Could not apply intro to season', 'error'); }
    }
    $('episodeForm').reset();
    $('epId').value = '';
    $('epSeason').value = 1;
    $('epSubmit').textContent = 'Add Episode';
    $('epCancel').classList.add('hidden');
    await refreshEpisodeList();
    loadLibrary(true);
  } catch (err) { toast(err.message, 'error'); }
});

$('epCancel')?.addEventListener('click', () => {
  $('episodeForm').reset();
  $('epId').value = '';
  $('epSeason').value = 1;
  $('epSubmit').textContent = 'Add Episode';
  $('epCancel').classList.add('hidden');
});

$('episodesClose')?.addEventListener('click', () => {
  $('episodesModal').classList.add('hidden');
  currentEpisodeTarget = null;
});
$('episodesModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'episodesModal') {
    $('episodesModal').classList.add('hidden');
    currentEpisodeTarget = null;
  }
});


// --- Image upload helper ---
async function uploadImageFile(file) {
  if (!file) throw new Error("No file selected");
  if (file.size > 1_300_000) throw new Error("Image must be under 1.3MB");
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/upload/image", { method: "POST", body: fd, credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.message || "Upload failed");
  return data.url;
}

function wireImageUpload(fileInputId, urlInputId) {
  const fi = $(fileInputId);
  const ui = $(urlInputId);
  if (!fi || !ui) return;
  fi.addEventListener("change", async () => {
    const file = fi.files && fi.files[0];
    if (!file) return;
    try {
      toast("Uploading…");
      const url = await uploadImageFile(file);
      ui.value = url;
      toast("Uploaded");
    } catch (err) {
      toast(err.message || "Upload failed", "error");
    } finally {
      fi.value = "";
    }
  });
}

// --- Metadata: client-side Anilist (works even when Render can't reach MAL) ---
async function anilistGraphQL(query, variables) {
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.errors) {
    const msg = (data.errors && data.errors[0] && data.errors[0].message) || `Anilist error (${res.status})`;
    throw new Error(msg);
  }
  return data.data;
}

function stripHtml(html) {
  const d = document.createElement("div");
  d.innerHTML = html || "";
  return (d.textContent || d.innerText || "").replace(/\s+/g, " ").trim();
}


async function autoFetchAnimeMeta() {
  const title = ($("aTitle")?.value || "").trim();
  if (!title) return toast("Enter a title first", "error");
  const btn = $("aAutoFetch");
  if (btn) { btn.disabled = true; btn.textContent = "Fetching…"; }
  try {
    toast("Fetching from Anilist…");
    const query = `
      query ($search: String) {
        Media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
          id
          title { romaji english native }
          description(asHtml: false)
          coverImage { large extraLarge }
          bannerImage
          seasonYear
          startDate { year }
          genres
          averageScore
          episodes
          duration
          status
          format
        }
      }`;
    const data = await anilistGraphQL(query, { search: title });
    const m = data && data.Media;
    if (!m) throw new Error("No anime found for that title");

    const name = m.title.english || m.title.romaji || title;
    if ($("aTitle")) $("aTitle").value = name;
    let desc = stripHtml(m.description || "");
    if ($("aDesc")) $("aDesc").value = desc;
    const poster = (m.coverImage && (m.coverImage.extraLarge || m.coverImage.large)) || "";
    if (poster && $("aPoster")) $("aPoster").value = poster;
    if (m.bannerImage && $("aBanner")) $("aBanner").value = m.bannerImage;
    else if (poster && $("aBanner") && !$("aBanner").value) $("aBanner").value = poster;
    const year = m.seasonYear || (m.startDate && m.startDate.year) || "";
    if (year && $("aYear")) $("aYear").value = year;
    if (m.genres && m.genres.length && $("aGenres")) $("aGenres").value = m.genres.join(", ");
    if (m.averageScore && $("aRating")) $("aRating").value = (m.averageScore / 10).toFixed(1);
    if (m.status && $("aStatus")) {
      const map = { RELEASING: "Ongoing", FINISHED: "Completed", NOT_YET_RELEASED: "Upcoming", CANCELLED: "Completed", HIATUS: "Ongoing" };
      const st = map[m.status] || "";
      if (st) $("aStatus").value = st;
    }
    state._lastAnilistId = m.id;
    try { sessionStorage.setItem("anicore-anilist-id", String(m.id)); } catch (e) {}
    toast("Found: " + name);
  } catch (err) {
    toast(err.message || "Could not fetch", "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Fetch anime details & description from AniList"; }
  }
}


// --- Theme buttons ---
$('themeToggle')?.addEventListener('click', toggleTheme);
$('themeToggleMobile')?.addEventListener('click', toggleTheme);

// Media uploads + auto-fetch
$("aAutoFetch")?.addEventListener("click", autoFetchAnimeMeta);
;




// ===================== Hero banner =====================
const hero = { items: [], index: 0, timer: null, bgFlip: false, swiped: false, sx: 0, sy: 0 };
let heroSeriesItems = [];
let heroMovieItems = [];

function heroTypeLabel(t) {
  return t === 'movie' ? 'Movie' : 'Series';
}

function heroSeason(item) {
  return /mushoku[\s-]*tensei/i.test(String(item?.title || '')) ? 3 : null;
}

function heroSeasonEpisodes(item, episodes = item?.episodes || []) {
  const season = heroSeason(item);
  return season == null ? episodes : episodes.filter((ep) => Number(ep.season) === season);
}

function heroInfoHtml(item) {
  const allEps = Array.isArray(item.episodes) ? item.episodes : [];
  const eps = heroSeasonEpisodes(item, allEps);
  const r = parseFloat(item.rating);
  const chips = [];
  if (r > 0) chips.push(`<span class="hero-chip gold">★ ${Math.round(r * 10)}%</span>`);
  if (item.year) chips.push(`<span class="hero-chip">▦ ${esc(item.year)}</span>`);
  if (eps.length) chips.push(`<span class="hero-chip">≣ ${eps.length} Eps</span>`);
  if (eps[0]?.duration) chips.push(`<span class="hero-chip">◷ ${esc(eps[0].duration)}</span>`);
  chips.push(`<span class="hero-chip">${esc(heroTypeLabel(item._type))}</span>`);
  const genres = (item.genres || []).slice(0, 3).map((g) => `<span class="hero-chip ghost">${esc(g)}</span>`).join('');
  return `
    <h2 class="hero-title">${esc(item.title || '')}</h2>
    <div class="hero-chips">${chips.join('')}</div>
    ${genres ? `<div class="hero-chips">${genres}</div>` : ''}
    ${item.description ? `<p class="hero-desc">${esc(item.description)}</p>` : ''}
    <div class="hero-actions">
      <button type="button" class="hero-watch" data-act="watch">▶ Watch</button>
      <button type="button" class="hero-circle" data-act="info" aria-label="Details">ⓘ</button>
    </div>`;
}

function setHeroItems() {
  if (!heroCuratedReady) return; // wait for the admin's picks so the banner doesn't flash the wrong titles
  const auto = [...heroSeriesItems.slice(0, 4), ...heroMovieItems.slice(0, 2)];
  const pool = (heroCurated.length ? heroCurated : auto)
    .filter((i) => safeUrl(i.poster) || safeUrl(i.banner));
  const root = $('hero');
  if (!root) return;
  if (!pool.length) {
    if (!root.dataset.built) root.classList.add('hidden');
    return;
  }
  hero.items = pool;
  hero.index = Math.min(hero.index, pool.length - 1);
  buildHero(root);
}

function buildHero(root) {
  const items = hero.items;
  root.classList.remove('loading', 'hidden');
  root.dataset.built = '1';
  root.innerHTML = `
    <div class="hero-bg"></div><div class="hero-bg"></div>
    <div class="hero-stage" id="heroStage">${items.map((it, i) => `
      <button type="button" class="hero-slide" data-i="${i}" aria-label="${esc(it.title || '')}">
        <img src="${esc(safeUrl(it.poster) || safeUrl(it.banner) || PLACEHOLDER)}" alt="" decoding="async" draggable="false" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'}>
      </button>`).join('')}
    </div>
    <div class="hero-info" id="heroInfo"></div>
    <div class="hero-dots" id="heroDots">${items.map((_, i) => `<button type="button" class="hero-dot" data-i="${i}" aria-label="Slide ${i + 1}"></button>`).join('')}</div>`;
  if (!root.dataset.bound) { root.dataset.bound = '1'; bindHero(root); }
  heroShow(hero.index);
  heroRestartTimer();
}

function heroShow(i) {
  const n = hero.items.length;
  if (!n) return;
  hero.index = ((i % n) + n) % n;
  const root = $('hero');
  root.querySelectorAll('.hero-slide').forEach((el, k) => {
    let d = k - hero.index;
    if (d > n / 2) d -= n;
    if (d < -n / 2) d += n;
    el.className = 'hero-slide ' + (d === 0 ? 'is-active' : d === 1 ? 'is-next' : d === -1 ? 'is-prev' : 'is-far');
  });
  const item = hero.items[hero.index];
  const bg = safeUrl(item.banner) || safeUrl(item.poster) || '';
  const bgs = root.querySelectorAll('.hero-bg');
  hero.bgFlip = !hero.bgFlip;
  const on = bgs[hero.bgFlip ? 1 : 0];
  const off = bgs[hero.bgFlip ? 0 : 1];
  if (on && off) {
    on.style.backgroundImage = bg ? `url("${bg.replace(/"/g, '%22')}")` : '';
    on.classList.add('on');
    off.classList.remove('on');
  }
  const info = $('heroInfo');
  if (info) {
    info.innerHTML = heroInfoHtml(item);
    info.classList.remove('fade');
    void info.offsetWidth;
    info.classList.add('fade');
  }
  root.querySelectorAll('.hero-dot').forEach((d, k) => d.classList.toggle('active', k === hero.index));
}

function heroRestartTimer() {
  clearInterval(hero.timer);
  if (hero.items.length < 2) return;
  hero.timer = setInterval(() => {
    if (document.hidden || state.page !== 'home') return;
    heroShow(hero.index + 1);
  }, 6000);
}

async function heroWatch(item) {
  const type = item._type;
  if (type === 'movie') { openDetail(type, item._id, item); return; }
  try {
    const full = await api(`/api/content/${type}/${item._id}`);
    const season = heroSeason(item);
    const allEps = [...(full.episodes || [])].sort((a, b) => cmpEp(a, b));
    const eps = season == null ? allEps : allEps.filter((e) => Number(e.season) === season);
    const ep = eps.find((e) => e.video_url);
    if (!ep) { openDetail(type, item._id, season == null ? item : { ...item, _season: season }); return; }
    state.detailId = item._id;
    state.detailType = type;
    openVideo(type, item._id, full.title, eps, ep.season, ep.episode, full.banner || full.poster, 0, full.season_thumbnails || {});
  } catch (err) {
    toast(err.message || 'Could not open', 'error');
  }
}

function bindHero(root) {
  root.addEventListener('click', (e) => {
    const slide = e.target.closest('.hero-slide');
    if (slide) {
      if (hero.swiped) return;
      const i = Number(slide.dataset.i);
      if (i === hero.index) {
        const it = hero.items[i];
        openDetail(it._type, it._id, heroSeason(it) == null ? it : { ...it, _season: heroSeason(it) });
      } else {
        heroShow(i);
        heroRestartTimer();
      }
      return;
    }
    const dot = e.target.closest('.hero-dot');
    if (dot) { heroShow(Number(dot.dataset.i)); heroRestartTimer(); return; }
    const act = e.target.closest('[data-act]');
    if (act) {
      const it = hero.items[hero.index];
      if (act.dataset.act === 'watch') heroWatch(it);
      else openDetail(it._type, it._id, it);
    }
  });
  root.addEventListener('touchstart', (e) => {
    hero.sx = e.touches[0].clientX;
    hero.sy = e.touches[0].clientY;
  }, { passive: true });
  root.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    const dx = t.clientX - hero.sx;
    const dy = t.clientY - hero.sy;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
      heroShow(hero.index + (dx < 0 ? 1 : -1));
      heroRestartTimer();
      hero.swiped = true;
      setTimeout(() => { hero.swiped = false; }, 350);
    }
  }, { passive: true });
}



// ============================================================
// Telegram Mini App (WebApp)
// ============================================================
const TG = (() => {
  try {
    return (window.Telegram && window.Telegram.WebApp) || null;
  } catch (e) {
    return null;
  }
})();

const isTelegram = !!(TG && (TG.initData || TG.platform));

function initTelegramWebApp() {
  if (!TG) return;
  try {
    document.documentElement.classList.add("tg-webapp");
    document.body.classList.add("tg-webapp");

    TG.ready();
    TG.expand();
    try { TG.disableVerticalSwipes && TG.disableVerticalSwipes(); } catch (e) {}

    // Match app theme
    try {
      TG.setHeaderColor("#09090f");
      TG.setBackgroundColor("#09090f");
      if (TG.setBottomBarColor) TG.setBottomBarColor("#09090f");
    } catch (e) {}

    // Haptic helper
    window.tgHaptic = (type) => { buzz(type === 'success' || type === 'error' ? type : (type === 'light' ? 'light' : 'select')); };

    // Back button → app navigation
    const bb = TG.BackButton;
    if (bb) {
      bb.onClick(() => {
        try {
          if (document.body.classList.contains("tg-player-expanded")) { setTgPlayerExpanded(false); return; }
          if (state.page === "video" || state.page === "detail") {
            // prefer in-app back
            if (typeof history !== "undefined" && history.length > 1) history.back();
            else showPage("home");
          } else if (state.page !== "home") {
            showPage("home");
          } else {
            TG.close();
          }
        } catch (e) {
          showPage("home");
        }
      });
    }

    // Sync back button visibility with page
    window.tgSyncBack = () => {
      if (!bb) return;
      try {
        if (document.body.classList.contains("tg-player-expanded")) { bb.hide(); return; }
        if (state.page && state.page !== "home") bb.show();
        else bb.hide();
      } catch (e) {}
    };

    // Optional MainButton for install is not needed in TG
    try {
      if (TG.MainButton) TG.MainButton.hide();
    } catch (e) {}

    // Viewport CSS variables
    const applyVp = () => {
      try {
        const h = TG.viewportStableHeight || TG.viewportHeight || window.innerHeight;
        document.documentElement.style.setProperty("--tg-viewport-height", h + "px");
        document.documentElement.style.setProperty("--tg-content-top", ((TG.safeAreaInset?.top || 0) + (TG.contentSafeAreaInset?.top || 0)) + "px");
        document.documentElement.style.setProperty("--tg-safe-top", (TG.safeAreaInset?.top || 0) + "px");
        document.documentElement.style.setProperty("--tg-safe-bottom", (TG.safeAreaInset?.bottom || TG.contentSafeAreaInset?.bottom || 0) + "px");
      } catch (e) {}
    };
    applyVp();
    TG.onEvent && TG.onEvent("viewportChanged", applyVp);
    try {
      TG.onEvent && TG.onEvent("fullscreenChanged", () => {
        // Telegram left fullscreen by itself (system back / swipe) -> leave player-expanded too
        if (!TG.isFullscreen && document.body.classList.contains("tg-player-expanded")) {
          setTgPlayerExpanded(false);
        } else {
          [50, 300, 800].forEach((ms) => setTimeout(updateTgRotate, ms));
        }
      });
      TG.onEvent && TG.onEvent("safeAreaChanged", applyVp);
      TG.onEvent && TG.onEvent("contentSafeAreaChanged", applyVp);
    } catch (e) {}

    console.log("[anicore] Telegram WebApp", TG.platform, TG.version);
  } catch (err) {
    console.warn("[anicore] Telegram init failed", err);
  }
}


// --- Init ---
wireSeriesPage();

(async function init() {
  initTelegramWebApp();
  // Mark the page we landed on as the first history entry, so Back can return to it.
  try {
    const hp = parseLocation();
    const page = hp && PAGE_ORDER.includes(hp.page) ? hp.page : 'home';
    history.replaceState({
      key: hp && hp.detailId ? `${page}:${hp.detailType}:${hp.detailId}` : page, idx: 0, page,
      detailType: hp?.detailType || null, detailId: hp?.detailId || null,
      watchS: hp?.watchS ?? null, watchE: hp?.watchE ?? null,
    }, '', location.href);
  } catch (e) { /* noop */ }
  applyTheme('dark');
  applyDefaultAccent();
  if ($('yearNow')) $('yearNow').textContent = new Date().getFullYear();

  // Website only: remove any service worker / cache left from the old app mode
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then((regs) => regs.forEach((r) => r.unregister()))
      .catch(() => {});
    if (window.caches) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
  }

  await checkUser();

  // Telegram login + multi-account switch
  if (isTelegram && TG && TG.initData) {
    try {
      const tgUser = (TG.initDataUnsafe && TG.initDataUnsafe.user) || {};
      const tgId = String(tgUser.id || "");
      const currentTg = String(state.user?.telegram_id || "");
      const needLogin = !state.user || (tgId && currentTg && tgId !== currentTg) || (tgId && !currentTg && state.user?.email?.endsWith?.("@telegram.local") === false) || (tgId && !currentTg);
      // Always re-auth when Telegram user id differs, or when not logged in
      const mustSwitch = !state.user || (tgId && currentTg !== tgId);
      if (mustSwitch) {
        if (state.user && currentTg && tgId && currentTg !== tgId) {
          try { await api("/api/auth/logout", { method: "POST" }); writeCachedUser(null); } catch (e) {}
          state.user = null;
        }
        await api("/api/auth/telegram", {
          method: "POST",
          body: JSON.stringify({ initData: TG.initData }),
        });
        await checkUser();
        // Apply live TG photo/username immediately if API returned them via me
        if (tgUser.photo_url && state.user) state.user.avatar = tgUser.photo_url;
        if (tgUser.username && state.user) {
          state.user.telegram_username = tgUser.username;
          state.user.display_name = "@" + tgUser.username;
        } else if (tgUser.first_name && state.user) {
          state.user.display_name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ");
        }
        updateAuthUI();
        if (state.user) toast("Signed in as " + profileName(state.user));
      }
    } catch (err) {
      console.warn("[tg auth]", err.message || err);
    }
  }

  // Stay on the same page after refresh
  const saved = BOOT_NAV;
  if (saved?.page && saved.page !== 'home') {
    if ((saved.page === 'detail' || saved.page === 'video') && saved.detailId && saved.detailType) {
      if (saved.page === 'video' && saved.watchS != null && saved.watchE != null) openVideoFromLink(saved.detailType, saved.detailId, saved.watchS, saved.watchE);
      else { allowSwap = true; openDetail(saved.detailType, saved.detailId); }
    } else if (PAGE_ORDER.includes(saved.page) && saved.page !== 'video') {
      allowSwap = true;
      showPage(saved.page);
      if (saved.page === 'search') {
        const q = new URLSearchParams(location.search).get('q') || '';
        const gs = $('globalSearch');
        if (q && gs) { gs.value = q; try { runGlobalSearch(); } catch (e) { /* noop */ } }
      }
    }
  }
  allowSwap = false;

  await loadGenres();
  loadHome();
  requestAnimationFrame(() => { movePill(false); requestAnimationFrame(() => movePill(true)); });
})();


// ============================================================
// NEW FEATURES: Search, Recommendations, Profile Activity,
// Anilist, Bulk Episodes, Analytics, PWA install, Prefs
// ============================================================

async function loadRecommendations() {
  const section = $("recommendSection");
  const grid = $("recommendGrid");
  if (!section || !grid) return;
  try {
    const items = await api("/api/recommendations?limit=12");
    if (!items || !items.length) {
      section.classList.add("hidden");
      return;
    }
    section.classList.remove("hidden");
    renderGrid(grid, items.map((i) => ({ ...i, _type: i.content_type || "anime" })), "anime");
  } catch {
    section.classList.add("hidden");
  }
}

let searchTimer;
let suggestionTimer;
async function updateSearchSuggestions() {
  const input = $('globalSearch');
  const box = $('searchSuggestions');
  const q = (input?.value || '').trim();
  if (!box) return;
  if (q.length < 2) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  try {
    const data = await api('/api/search?' + new URLSearchParams({q, limit:'6', sort:'views'}));
    const items = (data.items || []).slice(0,6);
    if (!items.length) { box.classList.add('hidden'); box.innerHTML=''; return; }
    box.innerHTML = '';
    items.forEach((item) => {
      const type = item.content_type || item._type || 'anime';
      const option = document.createElement('button'); option.type='button'; option.className='search-suggestion'; option.setAttribute('role','option');
      option.innerHTML = '<img alt="" loading="lazy"><span><strong></strong><small></small></span><b>↗</b>';
      const img=option.querySelector('img'); img.src=safeUrl(item.poster)||PLACEHOLDER; img.alt=item.title||'';
      option.querySelector('strong').textContent=item.title||'Untitled';
      option.querySelector('small').textContent=[type.replace('_',' '),item.year||''].filter(Boolean).join(' · ');
      option.addEventListener('click',()=>{ box.classList.add('hidden'); openDetail(type,item._id||item.content_id,item); });
      box.appendChild(option);
    });
    box.classList.remove('hidden');
  } catch { box.classList.add('hidden'); }
}
async function runGlobalSearch() {
  const q = ($("globalSearch")?.value || "").trim();
  const type = $("searchType")?.value || "";
  const genre = $("searchGenre")?.value || "";
  const sort = $("searchSort")?.value || "newest";
  const grid = $("searchGrid");
  const empty = $("searchEmpty");
  if (!grid) return;
  if (!q) {
    grid.innerHTML = "";
    if (empty) {
      empty.textContent = "Type to search the catalogue.";
      empty.classList.remove("hidden");
    }
    return;
  }
  try {
    const base = new URLSearchParams({ q, sort, limit: "30" });
    if (genre) base.set("genre", genre);
    let items;
    if (type === "series") {
      const parts = await Promise.all(["anime", "tv_show"].map((tp) => {
        const p = new URLSearchParams(base);
        p.set("type", tp);
        return api("/api/search?" + p.toString());
      }));
      items = parts.flatMap((d) => d.items || []);
      const cmp = {
        title: (a, b) => String(a.title || "").localeCompare(String(b.title || "")),
        rating: (a, b) => (b.avg_rating || 0) - (a.avg_rating || 0),
        views: (a, b) => (b.views || 0) - (a.views || 0),
        year: (a, b) => (b.year || 0) - (a.year || 0),
        oldest: (a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")),
      }[sort] || ((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
      items = items.sort(cmp).slice(0, 30);
    } else {
      if (type) base.set("type", type);
      const data = await api("/api/search?" + base.toString());
      items = data.items || [];
    }
    if (!items.length) {
      grid.innerHTML = "";
      if (empty) {
        empty.textContent = "No results found.";
        empty.classList.remove("hidden");
      }
      return;
    }
    if (empty) empty.classList.add("hidden");
    renderGrid(grid, items.map((i) => ({ ...i, _type: i.content_type || "anime" })), "anime");
  } catch (err) {
    grid.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

function wireSearchPage() {
  $("globalSearch")?.addEventListener("input", () => {
    clearTimeout(searchTimer);
    clearTimeout(suggestionTimer);
    searchTimer = setTimeout(runGlobalSearch, 280);
    suggestionTimer = setTimeout(updateSearchSuggestions, 180);
  });
  $("globalSearch")?.addEventListener("focus", () => { if (($('globalSearch')?.value || '').trim().length >= 2) updateSearchSuggestions(); });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.search-live-wrap')) $('searchSuggestions')?.classList.add('hidden');
  });
  ["searchType", "searchGenre", "searchSort"].forEach((id) => {
    $(id)?.addEventListener("change", runGlobalSearch);
  });
}

async function savePreferences() {
  if (!state.user) {
    openAuth();
    return;
  }
  const theme = $("profileTheme")?.value || state.theme;
  const lowChk = $("profileLowData");
  if (lowChk) {
    try { localStorage.setItem(LOW_DATA_KEY, lowChk.checked ? '1' : '0'); } catch { /* ignore */ }
    if (lowChk.checked !== lowData) { lowData = lowChk.checked; document.documentElement.classList.toggle('low-data', lowData); toast(lowData ? 'Low-data mode on. Refresh to load smaller posters.' : 'Low-data mode off. Refresh to restore full quality.'); }
  }
  try {
    await api("/api/users/me/prefs", {
      method: "PUT",
      body: JSON.stringify({ theme }),
    });
    applyTheme(theme);
    toast("Preferences saved");
  } catch (err) {
    toast(err.message, "err");
  }
}

async function importFromAnilist(e) {
  e.preventDefault();
  const anilist_id = Number($("anilistId")?.value) || null;
  const search = ($("anilistSearch")?.value || "").trim();
  const content_type = $("anilistType")?.value || "anime";
  const msg = $("anilistMsg");
  if (!anilist_id && !search) {
    if (msg) msg.textContent = "Enter an Anilist ID or search text.";
    return;
  }
  try {
    if (msg) msg.textContent = "Importing…";
    const body = { content_type };
    if (anilist_id) body.anilist_id = anilist_id;
    else body.search = search;
    const res = await api("/api/admin/import/anilist", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (msg) msg.textContent = res.message + (res.item ? ` — ${res.item.title}` : "");
    toast(res.message);
    $("anilistForm")?.reset();
    // refresh lists
    Object.keys(LISTS).forEach((t) => loadList(t, true));
    loadAdminStats();
  } catch (err) {
    if (msg) msg.textContent = err.message;
    toast(err.message, "err");
  }
}

function bulkRows() { return [...document.querySelectorAll('#bulkEpRows tr[data-ep]')]; }

// "Set rows": build one row per episode in the Ep range, keeping anything already typed.
function buildBulkRows() {
  const from = Math.trunc(Number($('bulkEpFrom')?.value));
  const to = Math.trunc(Number($('bulkEpTo')?.value));
  const msg = $('bulkEpMsg');
  if (!from || !to || from < 1 || to < from) { if (msg) msg.textContent = 'Enter a valid Ep range (e.g. 1 – 12).'; return; }
  if (to - from + 1 > 500) { if (msg) msg.textContent = 'Max 500 episodes per batch.'; return; }
  const defDur = ($('bulkEpDefDur')?.value || '').trim() || '24min';
  const old = {};
  bulkRows().forEach((tr) => {
    old[tr.dataset.ep] = {
      url: tr.querySelector('.b-url').value, dur: tr.querySelector('.b-dur').value,
      season: tr.querySelector('.b-season')?.value,
    };
  });
  const seasons = bulkSeasonOptions();
  let html = '';
  for (let n = from; n <= to; n++) {
    const o = old[n] || {};
    html += `<tr data-ep="${n}">
      <td>EP ${n}</td>
      <td><input class="b-url" type="url" placeholder="https://..." value="${esc(o.url || '')}"></td>
      <td><input class="b-dur" type="text" value="${esc(o.dur || defDur)}"></td>
      <td><select class="b-season">${seasons}</select></td>
    </tr>`;
  }
  $('bulkEpRows').innerHTML = html;
  bulkRows().forEach((tr) => {
    const o = old[Number(tr.dataset.ep)] || {};
    const sel = tr.querySelector('.b-season');
    if (sel && o.season != null) sel.value = String(o.season);
  });
  if (msg) msg.textContent = `${to - from + 1} rows ready. Paste the Ep URLs.`;
}

// Generate <option> elements for season select, highlighting the form's bulkEpSeason value.
function bulkSeasonOptions() {
  const formSeason = seasonNum($('bulkEpSeason')?.value);
  const opts = [];
  // Season 0 = Specials / OVA (their own season with its own poster); then seasons 1-8.
  opts.push(`<option value="0"${0 === formSeason ? ' selected' : ''}>Specials / OVA</option>`);
  for (let i = 1; i <= 50; i++) {
    opts.push(`<option value="${i}"${i === formSeason ? ' selected' : ''}>Season ${i}</option>`);
  }
  return opts.join('');
}

// Pasting several URLs (one per line) into any URL cell spreads them down the column.
document.addEventListener('paste', (e) => {
  const input = e.target.closest?.('#bulkEpRows .b-url');
  if (!input) return;
  const lines = (e.clipboardData?.getData('text') || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return;
  e.preventDefault();
  const rows = bulkRows();
  let i = rows.indexOf(input.closest('tr'));
  lines.forEach((l) => { if (rows[i]) rows[i++].querySelector('.b-url').value = l; });
});

async function submitBulkEpisodes(e) {
  e.preventDefault();
  const content_type = $('bulkEpType')?.value || 'anime';
  const content_id = $('bulkEpContent')?.value;
  const msg = $('bulkEpMsg');
  if (!content_id) { if (msg) msg.textContent = 'Select a title first.'; return; }
  const episodes = [];
  for (const tr of bulkRows()) {
    const video_url = tr.querySelector('.b-url').value.trim();
    if (!video_url) continue; // rows without a URL are skipped
    if (!video_url.startsWith('https://')) { if (msg) msg.textContent = `EP ${tr.dataset.ep}: URL must start with https://`; return; }
    const rowSeason = seasonNum(tr.querySelector('.b-season')?.value);
    episodes.push({
      season: rowSeason, episode: kindBase($('bulkKind')?.value) + Number(tr.dataset.ep), video_url,
      duration: tr.querySelector('.b-dur').value.trim() || '24min',
    });
  }
  if (!episodes.length) { if (msg) msg.textContent = 'Add at least one Ep URL.'; return; }
  try {
    if (msg) msg.textContent = 'Saving…';
    const res = await api('/api/admin/bulk-episodes', {
      method: 'POST',
      body: JSON.stringify({ content_type, content_id, episodes }),
    });
    if (msg) msg.textContent = res.message;
    toast(res.message);
    $('bulkEpRows').innerHTML = '<tr><td colspan="4" class="muted">Set an Ep range to create rows.</td></tr>';
  } catch (err) {
    if (msg) msg.textContent = err.message;
    toast(err.message, 'err');
  }
}

$('bulkEpForm')?.addEventListener('submit', submitBulkEpisodes);
$('bulkEpBuild')?.addEventListener('click', buildBulkRows);
$('bulkEpType')?.addEventListener('change', populateBulkContentSelect);

async function populateBulkContentSelect() {
  const type = $("bulkEpType")?.value || "anime";
  const sel = $("bulkEpContent");
  if (!sel) return;
  try {
    const endpoint = type === "tv_show" ? "/api/tvshows?limit=100" : "/api/anime?limit=100";
    const data = await api(endpoint);
    const items = Array.isArray(data) ? data : (data.items || []);
    sel.innerHTML = '<option value="">Select title…</option>' +
      items.map((i) => `<option value="${esc(i._id)}">${esc(i.title)}</option>`).join("");
  } catch {
    sel.innerHTML = '<option value="">Failed to load</option>';
  }
}

async function loadAnalytics() {
  const box = $("analyticsContent");
  const top = $("analyticsTop");
  if (!box) return;
  try {
    const data = await api("/api/admin/analytics");
    const t = data.totals || {};
    const g = data.growth || {};
    box.innerHTML = [
      ["Anime", t.anime],
      ["TV Shows", t.tv_shows],
      ["Movies", t.movies],
      ["Users", t.users],
      ["Comments", t.comments],
      ["Pending Req", t.requests_pending],
      ["Users 7d", g.users_7d],
      ["Comments 7d", g.comments_7d],
    ].map(([label, num]) => `
      <div class="stat-card">
        <div class="num">${num ?? 0}</div>
        <div class="label">${label}</div>
      </div>
    `).join("");

    if (top) {
      const anime = (data.top_viewed?.anime || []).map((a) =>
        `<div class="activity-item">${esc(a.title)} · ${a.views || 0} views</div>`
      ).join("") || "<p class='muted'>No data</p>";
      const movies = (data.top_viewed?.movies || []).map((m) =>
        `<div class="activity-item">${esc(m.title)} · ${m.views || 0} views</div>`
      ).join("") || "<p class='muted'>No data</p>";
      top.innerHTML = `
        <div><h4>Top Anime (views)</h4>${anime}</div>
        <div><h4>Top Movies (views)</h4>${movies}</div>
      `;
    }
  } catch (err) {
    box.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

async function loadSimilar(type, id, container) {
  if (!container) return;
  try {
    const items = await api(`/api/content/${type}/${id}/similar?limit=8`);
    if (!items.length) {
      container.innerHTML = "";
      return;
    }
    container.innerHTML = `
      <div class="similar-row">
        <h3>Similar Titles</h3>
        <div class="media-grid horizontal" id="similarGrid"></div>
      </div>
    `;
    renderGrid($("similarGrid"), items.map((i) => ({ ...i, _type: type })), type);
  } catch {
    container.innerHTML = "";
  }
}

// ============================================================
// v30: Background image (default + per-user), Schedule page,
// admin release fields
// ============================================================

// --- Background -------------------------------------------------

function applyBackground() {
  // Custom backgrounds were removed: always use the default site background.
  document.documentElement.style.removeProperty('--user-bg');
  try { localStorage.removeItem('anicore-bg'); } catch (e) { /* storage unavailable */ }
}

applyBackground();

function bgNeedsSignIn() {
  if (state.user) return false;
  toast('Sign in to customize your background', 'error');
  openAuth('login');
  return true;
}

function setBgMessage(text, isError = false) {
  const el = $('bgMsg');
  if (!el) return;
  el.textContent = text || '';
  el.style.color = isError ? '#ff6b8a' : '';
}

// Shrink an uploaded picture so it stays small enough to store (max 1600px wide, JPEG).
function imageFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return reject(new Error('Choose a JPG, PNG or WebP image.'));
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, 1600 / img.naturalWidth, 1600 / img.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      let quality = 0.85;
      let out = canvas.toDataURL('image/jpeg', quality);
      while (out.length > 1_100_000 && quality > 0.4) { quality -= 0.15; out = canvas.toDataURL('image/jpeg', quality); }
      if (out.length > 1_100_000) return reject(new Error('That image is too large. Try a smaller one.'));
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('That image could not be read.')); };
    img.src = objectUrl;
  });
}

async function saveBackground(body) {
  const res = await api('/api/users/me/background', { method: 'PUT', body: JSON.stringify(body) });
  applyBackground(res.bg_image);
  setBgMessage('Background updated.');
  toast('Background updated');
}

$('bgUrlForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (bgNeedsSignIn()) return;
  const url = $('bgUrl').value.trim();
  if (!url) return setBgMessage('Paste an image link first.', true);
  try {
    // Make sure the picture actually loads before saving it.
    await new Promise((ok, fail) => {
      const probe = new Image();
      probe.onload = ok;
      probe.onerror = () => fail(new Error('That link did not load as an image.'));
      probe.src = url;
    });
    await saveBackground({ url });
  } catch (err) { setBgMessage(err.message, true); }
});

$('bgFile')?.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (bgNeedsSignIn()) return;
  try {
    setBgMessage('Uploading…');
    await saveBackground({ data: await imageFileToDataUrl(file) });
  } catch (err) { setBgMessage(err.message, true); }
});

$('bgReset')?.addEventListener('click', async () => {
  if (bgNeedsSignIn()) return;
  try {
    await api('/api/users/me/background', { method: 'DELETE' });
    applyBackground('');
    setBgMessage('Back to the default background.');
    toast('Background reset');
  } catch (err) { setBgMessage(err.message, true); }
});

// --- Time helpers (release slots are stored in UTC, shown in the viewer's local time) ---

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const pad2 = (n) => String(n).padStart(2, '0');

function utcSlotToLocal(utcWeekday, hhmm) {
  if (!/^\d{2}:\d{2}$/.test(hhmm || '')) return { day: utcWeekday, time: 'TBA', hhmm: '', minutes: 24 * 60 };
  const [h, m] = hhmm.split(':').map(Number);
  const now = new Date();
  const weekStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - ((now.getUTCDay() + 6) % 7) * 864e5;
  const d = new Date(weekStart + utcWeekday * 864e5 + (h * 60 + m) * 6e4);
  return {
    day: (d.getDay() + 6) % 7,
    time: d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    hhmm: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
    minutes: d.getHours() * 60 + d.getMinutes(),
  };
}

function localSlotToUtc(localWeekday, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + localWeekday);
  d.setHours(h, m);
  return { weekday: (d.getUTCDay() + 6) % 7, time: `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}` };
}

// --- Schedule page ------------------------------------------------

let scheduleData = null;
let scheduleDay = (new Date().getDay() + 6) % 7;

function weekDates() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return DAY_NAMES.map((_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
}

function countdownText(minutes) {
  const now = new Date();
  const diff = minutes - (now.getHours() * 60 + now.getMinutes());
  if (diff <= 0) return 'Aired';
  if (diff < 60) return `in ${diff}m`;
  return `in ${Math.floor(diff / 60)}h ${diff % 60}m`;
}

function renderDayTabs() {
  const tabs = $('dayTabs');
  const todayIdx = (new Date().getDay() + 6) % 7;
  const busy = new Set((scheduleData?.weekly || []).map((i) => utcSlotToLocal(i.air_weekday, i.air_time).day));
  tabs.innerHTML = '';
  weekDates().forEach((date, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.className = 'day-tab' + (i === scheduleDay ? ' active' : '') + (i === todayIdx ? ' today' : '') + (busy.has(i) ? ' has-items' : '');
    b.setAttribute('aria-selected', String(i === scheduleDay));
    b.innerHTML = `<span>${i === todayIdx ? 'Today' : DAY_NAMES[i]}</span><strong>${date.getDate()}</strong><span class="dot"></span>`;
    b.addEventListener('click', () => { scheduleDay = i; renderDayTabs(); renderScheduleList(); });
    tabs.appendChild(b);
  });
  tabs.children[scheduleDay]?.scrollIntoView({ inline: 'center', block: 'nearest' });
}

function scheduleRow({ poster, title, timeHtml, sub, right, onClick }) {
  const row = document.createElement('div');
  row.className = 'schedule-item';
  if (onClick) { row.tabIndex = 0; row.setAttribute('role', 'button'); } else { row.style.cursor = 'default'; }
  row.innerHTML = `
    ${timeHtml}
    <img alt="" loading="lazy" decoding="async">
    <div class="schedule-info"><h4></h4><p></p></div>
    ${right || ''}`;
  const img = row.querySelector('img');
  img.src = safeUrl(poster) || PLACEHOLDER;
  img.addEventListener('error', () => { img.src = PLACEHOLDER; }, { once: true });
  row.querySelector('h4').textContent = title || 'Untitled';
  row.querySelector('p').textContent = sub;
  if (onClick) {
    row.addEventListener('click', onClick);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } });
  }
  return row;
}

function renderScheduleList() {
  const list = $('scheduleList');
  list.innerHTML = '';
  const todayIdx = (new Date().getDay() + 6) % 7;
  const items = (scheduleData?.weekly || [])
    .map((i) => ({ ...i, slot: utcSlotToLocal(i.air_weekday, i.air_time) }))
    .filter((i) => i.slot.day === scheduleDay)
    .sort((a, b) => a.slot.minutes - b.slot.minutes || a.title.localeCompare(b.title));

  if (!items.length) {
    list.innerHTML = '<p class="muted empty">Nothing scheduled for this day.</p>';
    return;
  }
  items.forEach((i) => {
    const timeHtml = `<div class="schedule-time">${esc(i.slot.time)}</div>`;
    const sub = [i.status, ...(i.genres || [])].filter(Boolean).join(' · ');
    const next = `<span class="schedule-next">EP ${(i.latest_episode || 0) + 1}</span>`;
    const countdown = scheduleDay === todayIdx && i.slot.hhmm
      ? `<span class="schedule-countdown">${esc(countdownText(i.slot.minutes))}</span>` : '';
    list.appendChild(scheduleRow({
      poster: i.poster, title: i.title, timeHtml, sub, right: next + countdown,
      onClick: () => openDetail(i.content_type, i.content_id, i),
    }));
  });
}

function renderUpcoming() {
  const section = $('upcomingSection');
  const list = $('upcomingList');
  const items = scheduleData?.upcoming || [];
  list.innerHTML = '';
  section.classList.toggle('hidden', !items.length);
  items.forEach((i) => {
    const when = new Date(i.scheduled_at);
    const label = when.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
    const timeHtml = `<div class="schedule-time">${esc(label)}<small>${esc(when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</small></div>`;
    const typeLabel = { anime: 'Series', tv_show: 'Series', movie: 'Movie' }[i.content_type] || '';
    list.appendChild(scheduleRow({
      poster: i.poster, title: i.title, timeHtml, sub: [typeLabel, ...(i.genres || [])].filter(Boolean).join(' · '),
    }));
  });
}

async function loadSchedule() {
  let zone = '';
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { /* noop */ }
  $('scheduleTz').textContent = zone ? `Times shown in your time zone (${zone.replace(/_/g, ' ')}).` : 'Times shown in your local time.';
  if (!scheduleData) $('scheduleList').innerHTML = '<p class="muted empty">Loading schedule…</p>';
  try {
    scheduleData = await api('/api/schedule');
  } catch (err) {
    $('scheduleList').innerHTML = `<p class="muted empty">${esc(err.message)}</p>`;
    return;
  }
  renderDayTabs();
  renderScheduleList();
  renderUpcoming();
}

// --- Admin: release slot + publish time on the content form --------

function fillScheduleFields(item) {
  $('aAirDay').value = '';
  $('aAirTime').value = '';
  $('aPublishAt').value = '';
  if (item.air_weekday !== null && item.air_weekday !== undefined) {
    const slot = utcSlotToLocal(item.air_weekday, item.air_time);
    $('aAirDay').value = String(slot.day);
    $('aAirTime').value = slot.hhmm;
  }
  if (item.published === false && item.scheduled_at) {
    const d = new Date(item.scheduled_at);
    $('aPublishAt').value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
}

function readScheduleFields() {
  const day = $('aAirDay').value;
  const time = $('aAirTime').value;
  const out = { air_weekday: null, air_time: '', scheduled_at: null };
  if (day !== '') {
    if (time) {
      const slot = localSlotToUtc(Number(day), time);
      out.air_weekday = slot.weekday;
      out.air_time = slot.time;
    } else {
      out.air_weekday = Number(day); // no time given: nothing to convert, the day is shown as-is
    }
  }
  const publishAt = $('aPublishAt').value;
  if (publishAt) out.scheduled_at = new Date(publishAt).toISOString();
  return out;
}


// Keep the hero backdrop flush under the (transparent) header.
(function trackHeaderHeight() {
  const set = () => {
    const el = document.querySelector('.app-header');
    if (el) document.documentElement.style.setProperty('--header-h', el.offsetHeight + 'px');
  };
  set();
  window.addEventListener('resize', set);
  window.addEventListener('load', set);
})();


// --- Uploader management (admin only) ---

async function loadUploaders() {
  const box = $('uploaderList');
  if (!box || state.user?.role !== 'admin') return;
  try {
    const list = await api('/api/admin/uploaders');
    box.innerHTML = list.length
      ? list.map((u) => `<div class="activity-item uploader-row"><span>${esc(u.display_name || u.email)}${u.display_name ? ` <span class="muted">· ${esc(u.email)}</span>` : ''}</span><button type="button" class="outline small" data-remove-uploader="${esc(u.email)}">Remove</button></div>`).join('')
      : '<p class="muted">No uploaders yet.</p>';
  } catch (err) { box.innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
}

async function setUploaderRole(email, role) {
  const msg = $('uploaderMsg');
  try {
    const res = await api('/api/admin/users/role', { method: 'PUT', body: JSON.stringify({ email, role }) });
    if (msg) msg.textContent = res.message;
    toast(res.message);
    loadUploaders();
    return true;
  } catch (err) {
    if (msg) msg.textContent = err.message;
    toast(err.message, 'error');
    return false;
  }
}

$('uploaderForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('uploaderEmail').value.trim();
  if (email && await setUploaderRole(email, 'uploader')) $('uploaderEmail').value = '';
});

$('uploaderList')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove-uploader]');
  if (btn) setUploaderRole(btn.dataset.removeUploader, 'user');
});

$('uploaderCreateForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('uploaderMsg');
  const email = $('uploaderNewEmail').value.trim();
  const password = $('uploaderNewPass').value;
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const res = await api('/api/admin/uploaders', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (msg) msg.textContent = `${res.message}. Share the email and password with them.`;
    toast(res.message);
    e.target.reset();
    loadUploaders();
  } catch (err) {
    if (msg) msg.textContent = err.message;
    toast(err.message, 'error');
  } finally { btn.disabled = false; }
});


// ============================================================
// Telegram-style header search overlay
// ============================================================
(function wireSearchOverlay() {
  const overlay = $('searchOverlay'), input = $('soInput'), body = $('soBody'), clearBtn = $('soClear');
  if (!overlay || !input || !body) return;
  let timer, seq = 0;
  const hint = (t) => { body.innerHTML = ''; const p = document.createElement('p'); p.className = 'so-hint'; p.textContent = t; body.appendChild(p); };
  const RK = 'anicore_recent_searches';
  const getRecent = () => { try { return JSON.parse(localStorage.getItem(RK) || '[]'); } catch (e) { return []; } };
  const setRecent = (a) => { try { localStorage.setItem(RK, JSON.stringify(a.slice(0, 6))); } catch (e) { /* noop */ } };
  const saveRecent = (q) => { q = (q || '').trim(); if (q.length < 2) return; setRecent([q, ...getRecent().filter((x) => x.toLowerCase() !== q.toLowerCase())]); };
  let trendCache = null;
  async function showIdle() {
    body.innerHTML = '';
    const recent = getRecent();
    if (recent.length) {
      const head = document.createElement('div'); head.className = 'so-head';
      head.innerHTML = '<span>Recent searches</span><button type="button" class="so-link">Clear</button>';
      head.querySelector('button').addEventListener('click', () => { setRecent([]); showIdle(); });
      body.appendChild(head);
      const row = document.createElement('div'); row.className = 'so-chips';
      recent.forEach((q) => {
        const c = document.createElement('button'); c.type = 'button'; c.className = 'so-chip'; c.textContent = q;
        c.addEventListener('click', () => { input.value = q; run(); input.focus(); });
        row.appendChild(c);
      });
      body.appendChild(row);
    }
    const head2 = document.createElement('div'); head2.className = 'so-head'; head2.innerHTML = '<span>Trending now</span>';
    body.appendChild(head2);
    const list = document.createElement('div'); body.appendChild(list);
    try {
      if (!trendCache) { const d = await api('/api/anime?' + new URLSearchParams({ page: '1', limit: '8', sort: 'views' })); trendCache = d.items || []; }
      if (input.value.trim().length >= 2) return;
      trendCache.slice(0, 8).forEach((item, i) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'so-result';
        b.innerHTML = '<em class="so-rank"></em><img alt="" loading="lazy"><span><strong></strong><small></small></span>';
        b.querySelector('.so-rank').textContent = String(i + 1);
        b.querySelector('img').src = safeUrl(item.poster) || PLACEHOLDER;
        b.querySelector('strong').textContent = item.title || 'Untitled';
        b.querySelector('small').textContent = [(item.content_type || 'anime').replace('_', ' '), item.year || ''].filter(Boolean).join(' · ');
        b.addEventListener('click', () => { close(); openDetail(item.content_type || 'anime', item._id || item.content_id, item); });
        list.appendChild(b);
      });
    } catch (e) { if (!recent.length) hint('Type to search anime, series and movies'); }
  }

  let closeTimer = null;
  function open() {
    clearTimeout(closeTimer);
    // The search icon itself spreads out into the search bar (shared-element morph).
    const btn = $('searchOpenBtn');
    const r = btn ? btn.getBoundingClientRect() : { left: window.innerWidth - 60, top: 10, width: 42, height: 42, right: window.innerWidth - 18, bottom: 52 };
    overlay.classList.remove('hidden', 'closing', 'dropping');
    overlay.querySelectorAll('.so-lens').forEach((n) => n.remove());
    void overlay.offsetWidth;
    const bar = overlay.querySelector('.so-bar');
    if (bar) {
      const bb = bar.getBoundingClientRect();
      const px = (n) => Math.max(0, Math.round(n)) + 'px';
      overlay.style.setProperty('--ct', px(r.top - bb.top));
      overlay.style.setProperty('--cl', px(r.left - bb.left));
      overlay.style.setProperty('--cr', px(bb.right - r.right));
      overlay.style.setProperty('--cb', px(bb.bottom - r.bottom));
      overlay.style.setProperty('--crad', Math.round(r.height / 2) + 'px');
      const svg = btn?.querySelector('svg');
      if (svg) {
        const lens = document.createElement('span');
        lens.className = 'so-lens';
        lens.style.cssText = `left:${Math.round(r.left - bb.left)}px;top:${Math.round(r.top - bb.top)}px;width:${Math.round(r.width)}px;height:${Math.round(r.height)}px`;
        lens.appendChild(svg.cloneNode(true));
        bar.appendChild(lens);
      }
    }
    document.body.classList.add('search-open');
    overlay.classList.add('dropping');
    document.body.style.overflow = 'hidden';
    if (input.value.trim().length < 2) showIdle();
    setTimeout(() => input.focus(), 320);
  }
  function close() {
    input.blur();
    document.body.style.overflow = '';
    overlay.classList.remove('dropping');
    overlay.classList.add('closing');
    clearTimeout(closeTimer);
    // Let the header icon fade back in just before the popup is fully gone.
    setTimeout(() => document.body.classList.remove('search-open'), 330);
    closeTimer = setTimeout(() => overlay.classList.add('hidden'), 480);
  }
  async function run() {
    const q = input.value.trim();
    clearBtn.classList.toggle('hidden', !input.value);
    if (q.length < 2) { showIdle(); return; }
    const mine = ++seq;
    try {
      const data = await api('/api/search?' + new URLSearchParams({ q, limit: '12', sort: 'views' }));
      if (mine !== seq) return;
      const items = data.items || [];
      if (!items.length) { hint('No results found'); return; }
      body.innerHTML = '';
      items.forEach((item) => {
        const type = item.content_type || item._type || 'anime';
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'so-result';
        b.innerHTML = '<img alt="" loading="lazy"><span><strong></strong><small></small></span>';
        const img = b.querySelector('img');
        img.src = safeUrl(item.poster) || PLACEHOLDER;
        b.querySelector('strong').textContent = item.title || 'Untitled';
        b.querySelector('small').textContent = [type.replace('_', ' '), item.year || ''].filter(Boolean).join(' · ');
        b.addEventListener('click', () => { saveRecent(input.value); close(); openDetail(type, item._id || item.content_id, item); });
        body.appendChild(b);
      });
      const all = document.createElement('button');
      all.type = 'button'; all.className = 'so-all'; all.textContent = 'See all results';
      all.addEventListener('click', () => goFull());
      body.appendChild(all);
    } catch (err) {
      if (mine === seq) hint(err.message || 'Search failed');
    }
  }
  function goFull() {
    const q = input.value.trim();
    saveRecent(q);
    close();
    gotoUrl('/search' + (q ? '?q=' + encodeURIComponent(q) : ''));
  }

  $('searchOpenBtn')?.addEventListener('click', open);
  $('soBack')?.addEventListener('click', close);
  // Popup behaviour: tapping the dimmed area outside the card closes search.
  $('searchOverlay')?.addEventListener('click', (e) => { if (e.target === $('searchOverlay')) close(); });
  clearBtn.addEventListener('click', () => { input.value = ''; run(); input.focus(); });
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 220); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && input.value.trim()) { e.preventDefault(); goFull(); } });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) close();
    else if (e.key === '/' && overlay.classList.contains('hidden') && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) { e.preventDefault(); open(); }
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
})();


// ============================================================
// UI ENHANCEMENTS (v60)
// ============================================================
(function enhancements() {
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* noop */ } },
  };
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const DAY = 864e5;

  // ---------- 1. Haptics on every page: taps, switches, dropdowns, sliders ----------
  const TAPPABLE = 'button, a[href], summary, label, select, input:not([type=text]):not([type=search]):not([type=email]):not([type=password]):not([type=url]):not([type=number]), [role=button], [role=tab], [role=switch], [onclick], .media-card, .so-result, .genre-chip, .fx-btn, .fx-chip, .ep-row, .player-cover, .chip, .tab, .card';
  const isTappable = (t) => {
    if (!t || !t.closest) return false;
    if (t.closest(TAPPABLE)) return true;
    // anything styled as clickable (cursor: pointer) counts too
    for (let n = t, i = 0; n && n !== document.body && i < 4; n = n.parentElement, i++) {
      try { if (getComputedStyle(n).cursor === 'pointer') return true; } catch (e) { break; }
    }
    return false;
  };
  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('input[type=range]')) return; // sliders have their own tick
    if (isTappable(e.target)) buzz('light');
  }, true);
  // toggles, radios, dropdowns
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t && t.matches && t.matches('input[type=checkbox], input[type=radio], select')) buzz('select');
  }, true);
  // sliders tick while dragging
  let sliderAt = 0;
  document.addEventListener('input', (e) => {
    if (e.target && e.target.matches && e.target.matches('input[type=range]') && Date.now() - sliderAt > 70) { sliderAt = Date.now(); buzz('select'); }
  }, true);
  // focusing a text box
  document.addEventListener('focusin', (e) => {
    if (e.target && e.target.matches && e.target.matches('input[type=text], input[type=search], input[type=email], input[type=password], input[type=url], input[type=number], textarea')) buzz('soft');
  }, true);

  // Haptic preference controls (sidebar)
  const bindHapticUi = () => {
    syncHapticControls();
    $('hapticOn')?.addEventListener('change', (e) => {
      setHapticSettings({ on: e.target.checked });
      if (e.target.checked) buzz('medium');
    });
    $('hapticLevel')?.addEventListener('change', (e) => {
      setHapticSettings({ level: e.target.value });
      buzz('medium');
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindHapticUi);
  else bindHapticUi();
  // forms
  document.addEventListener('submit', () => buzz('medium'), true);
  // swipe between pages / tabs on touch (end of a horizontal swipe)
  let sx = 0, sy = 0;
  document.addEventListener('touchstart', (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; }, { passive: true, capture: true });
  document.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0]; if (!t) return;
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2 && e.target.closest && e.target.closest('.scroll-row, .hero, .carousel, [data-swipe], .row-scroll')) buzz('soft');
  }, { passive: true, capture: true });

  // ---------- 2. Scroll-to-top button ----------
  const topBtn = el('button', 'scroll-top hidden', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>');
  topBtn.type = 'button'; topBtn.setAttribute('aria-label', 'Back to top');
  document.body.appendChild(topBtn);
  topBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  let topTick = false;
  window.addEventListener('scroll', () => {
    if (topTick) return; topTick = true;
    requestAnimationFrame(() => {
      topTick = false;
      const show = window.scrollY > 700 && ['home', 'series', 'movies', 'search', 'profile', 'schedule'].includes(state.page);
      topBtn.classList.toggle('hidden', !show);
    });
  }, { passive: true });

  // ---------- 3. Skeleton shimmer on poster rows ----------
  const ROW_IDS = ['homeSeriesGrid', 'homeAnimeGrid', 'homeMovieGrid'];
  function skeletonRows() {
    ROW_IDS.forEach((id) => { const g = $(id); if (g && !g.querySelector('.media-card')) showSkeleton(id, 6); });
    setTimeout(() => {
      ROW_IDS.forEach((id) => { const g = $(id); if (g && g.querySelector('.skeleton-grid') && !g.querySelector('.media-card')) g.innerHTML = '<p class="muted empty">Nothing here yet.</p>'; });
    }, 12000);
  }
  skeletonRows();

  // ---------- 5. Empty states + card data + NEW badges (wrap renderGrid) ----------
  const EMPTY_ICON = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="10" y="14" width="44" height="34" rx="6"/><path d="M22 54h20M32 48v6"/><path d="M24 28l6 6M30 28l-6 6M38 31h6"/></svg>';
  function addBadge(card, it, type) {
    const now = Date.now();
    const upd = Date.parse(it.updated_at || ''), cre = Date.parse(it.created_at || '');
    let label = String(it.poster_tag || '').trim();
    // Empty / AUTO → compute from dates; explicit None/OFF clears
    if (!label || label.toUpperCase() === 'AUTO') {
      label = '';
      if (type !== 'movie' && upd && now - upd < DAY) label = 'NEW EP';
      else if (cre && now - cre < 7 * DAY) label = 'NEW';
      // SERIES / MOVIE only when admin sets them explicitly
    } else if (['NONE', 'OFF', '—', '-'].includes(label.toUpperCase())) {
      label = '';
    }
    if (!label) return;
    const kind = label.toUpperCase();
    const cls = 'new-badge' + (kind === 'NEW EP' ? ' ep' : kind === 'SERIES' ? ' series' : kind === 'MOVIE' ? ' movie' : '');
    const b = el('span', cls, label);
    card.querySelector('.poster-wrap')?.appendChild(b);
  }
  const origRenderGrid = renderGrid;
  renderGrid = function (grid, items, type, opts = {}) {
    origRenderGrid(grid, items, type, opts);
    try {
      if (!items.length && !opts.append) {
        const p = grid.querySelector('.empty');
        if (p) {
          const isWl = grid.id === 'watchlistGrid', isMovie = grid.id === 'movieGrid' || grid.id === 'homeMovieGrid';
          const cta = isWl || grid.id === 'searchGrid' || grid.id === 'seriesGrid' ? '' : '';
          p.className = 'fx-empty';
          p.innerHTML = EMPTY_ICON + `<strong>${esc(opts.empty || 'Nothing here yet.')}</strong>`
            + (isWl ? '<span>Tap ♡ on any title to save it here.</span><button type="button" class="outline small" data-page="series">Browse series</button>'
              : (grid.id === 'seriesGrid' || grid.id === 'movieGrid') ? '<span>Try a different filter or search.</span><button type="button" class="outline small fx-reset-filters">Reset filters</button>'
                : `<button type="button" class="outline small" data-page="${isMovie ? 'movies' : 'series'}">Explore</button>`) + cta;
        }
        return;
      }
      const cards = [...grid.children].filter((c) => c.classList && c.classList.contains('media-card'));
      cards.slice(cards.length - items.length).forEach((card, i) => {
        const it = items[i]; card._item = it; card._type = it._type || type;
        addBadge(card, it, card._type);
      });
    } catch (e) { /* noop */ }
  };
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.fx-reset-filters')) return;
    ['seriesGenre', 'seriesStatus', 'movieGenre', 'movieStatus'].forEach((id) => { const s = $(id); if (s && s.value) { s.value = ''; s.dispatchEvent(new Event('change')); } });
    ['seriesSearch', 'movieSearch'].forEach((id) => { const s = $(id); if (s && s.value) { s.value = ''; s.dispatchEvent(new Event('input')); } });
  });

  // ---------- 6. Filters bottom sheet + grid/list toggle ----------
  const sheet = el('div', 'fx-sheet hidden', '<div class="fx-sheet-bg"></div><div class="fx-sheet-card" role="dialog" aria-modal="true"><div class="fx-grabber"></div><div class="fx-sheet-title"></div><div class="fx-sheet-body"></div></div>');
  document.body.appendChild(sheet);
  const sheetTitle = sheet.querySelector('.fx-sheet-title'), sheetBody = sheet.querySelector('.fx-sheet-body');
  const closeSheet = () => sheet.classList.add('hidden');
  const openSheet = (title, build) => { sheetTitle.textContent = title; sheetBody.innerHTML = ''; build(sheetBody); sheet.classList.remove('hidden'); };
  sheet.querySelector('.fx-sheet-bg').addEventListener('click', closeSheet);
  // swipe down to close
  (function () {
    const card = sheet.querySelector('.fx-sheet-card'); let sy = 0, dy = 0, on = false;
    card.addEventListener('touchstart', (e) => { if (card.scrollTop > 0) return; sy = e.touches[0].clientY; dy = 0; on = true; }, { passive: true });
    card.addEventListener('touchmove', (e) => { if (!on) return; dy = Math.max(0, e.touches[0].clientY - sy); card.style.transform = `translateY(${dy}px)`; }, { passive: true });
    card.addEventListener('touchend', () => { if (!on) return; on = false; card.style.transform = ''; if (dy > 90) closeSheet(); });
  })();

  function chipGroup(label, select) {
    const wrap = el('div', 'fx-group'); wrap.appendChild(el('div', 'fx-group-label', label));
    const row = el('div', 'fx-chips'); wrap.appendChild(row);
    [...select.options].forEach((o) => {
      const text = o.textContent.trim(); if (!text) return;
      const c = el('button', 'fx-chip' + (select.value === o.value ? ' active' : ''), '');
      c.type = 'button'; c.textContent = text;
      c.addEventListener('click', () => {
        select.value = o.value; select.dispatchEvent(new Event('change', { bubbles: true }));
        row.querySelectorAll('.fx-chip').forEach((x) => x.classList.toggle('active', x === c));
        refreshToolbars();
      });
      row.appendChild(c);
    });
    return wrap;
  }
  const FILTER_SETS = {
    series: { search: 'seriesSearch', genre: 'seriesGenre', status: 'seriesStatus', sort: 'seriesSort', grid: 'seriesGrid', filters: 'seriesFilters' },
    movies: { search: 'movieSearch', genre: 'movieGenre', status: 'movieStatus', sort: 'movieSort', grid: 'movieGrid', filters: 'movieFilters' },
  };
  const viewMode = () => LS.get('anicore_view', 'grid');
  function applyView() {
    const list = viewMode() === 'list';
    ['seriesGrid', 'movieGrid', 'searchGrid'].forEach((id) => $(id)?.classList.toggle('list-view', list));
    document.querySelectorAll('.fx-view').forEach((b) => { b.innerHTML = list ? ICON_GRID : ICON_LIST; b.setAttribute('aria-label', list ? 'Grid view' : 'List view'); });
  }
  const ICON_LIST = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
  const ICON_GRID = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>';
  function refreshToolbars() {
    Object.entries(FILTER_SETS).forEach(([key, f]) => {
      const btn = document.querySelector(`.fx-filter-btn[data-set="${key}"]`); if (!btn) return;
      const n = [f.genre, f.status].filter((id) => $(id)?.value).length + (($(f.sort)?.value || 'newest') !== 'newest' ? 1 : 0);
      btn.querySelector('.fx-count').textContent = n ? String(n) : '';
      btn.classList.toggle('has', n > 0);
    });
  }
  Object.entries(FILTER_SETS).forEach(([key, f]) => {
    const host = $(f.filters), input = $(f.search); if (!host || !input) return;
    const bar = el('div', 'fx-toolbar');
    const fb = el('button', 'fx-btn fx-filter-btn', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M7 12h10M10 18h4"/></svg><span>Filters</span><b class="fx-count"></b>');
    fb.type = 'button'; fb.dataset.set = key;
    const vb = el('button', 'fx-btn fx-view', ''); vb.type = 'button';
    fb.addEventListener('click', () => openSheet('Filters', (body) => {
      body.appendChild(chipGroup('Genre', $(f.genre)));
      body.appendChild(chipGroup('Status', $(f.status)));
      body.appendChild(chipGroup('Sort by', $(f.sort)));
      const done = el('button', 'primary block', 'Show results'); done.type = 'button'; done.addEventListener('click', closeSheet);
      const reset = el('button', 'outline block', 'Reset'); reset.type = 'button';
      reset.addEventListener('click', () => {
        [f.genre, f.status].forEach((id) => { const s = $(id); if (s) { s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); } });
        const s = $(f.sort); if (s) { s.value = 'newest'; s.dispatchEvent(new Event('change', { bubbles: true })); }
        closeSheet(); refreshToolbars();
      });
      const row = el('div', 'fx-sheet-actions'); row.append(reset, done); body.appendChild(row);
    }));
    vb.addEventListener('click', () => { LS.set('anicore_view', viewMode() === 'list' ? 'grid' : 'list'); applyView(); });
    bar.append(fb, vb);
    input.insertAdjacentElement('afterend', bar);
    ['genre', 'status', 'sort'].forEach((k) => $(f[k])?.addEventListener('change', refreshToolbars));
  });
  applyView(); refreshToolbars();

  // ---------- 7. Seen episodes, streak, genre counts ----------
  const seenMap = () => LS.get('anicore_seen', {});
  function markSeen() {
    if (!videoContext) return;
    const ep = videoContext.episodes[videoContext.currentIndex]; if (!ep) return;
    const key = `${videoContext.type}:${videoContext.contentId}`;
    const m = seenMap(); const a = m[key] || []; const id = `${ep.season}-${ep.episode}`;
    if (!a.includes(id)) { a.push(id); m[key] = a; LS.set('anicore_seen', m); }
    const days = LS.get('anicore_days', []); const today = new Date().toISOString().slice(0, 10);
    if (!days.includes(today)) { days.push(today); LS.set('anicore_days', days.slice(-120)); }
  }
  const origLoadVideoEpisode = loadVideoEpisode;
  loadVideoEpisode = function () {
    const r = origLoadVideoEpisode.apply(this, arguments);
    try { markSeen(); } catch (e) { /* noop */ }
    return r;
  };
  const origBuildDetail = buildDetailHtml;
  buildDetailHtml = function (type, item, comments) {
    if (comments !== null && item) {
      try {
        const g = Array.isArray(item.genres) ? item.genres : String(item.genres || '').split(',');
        const counts = LS.get('anicore_genres', {});
        g.map((x) => String(x).trim()).filter(Boolean).forEach((x) => { counts[x] = (counts[x] || 0) + 1; });
        LS.set('anicore_genres', counts);
      } catch (e) { /* noop */ }
    }
    return origBuildDetail.apply(this, arguments);
  };

  // ---------- 8. Watchlist tabs + status ----------
  const STATUSES = [['all', 'All'], ['plan', 'Plan to Watch'], ['watching', 'Watching'], ['completed', 'Completed']];
  const wlStatusMap = () => LS.get('anicore_wl_status', {});
  const wlKey = (t, id) => `${t}:${id}`;
  function getStatus(t, id) {
    const s = wlStatusMap()[wlKey(t, id)]; if (s) return s;
    return (seenMap()[wlKey(t, id)] || []).length ? 'watching' : 'plan';
  }
  let wlTab = 'all';
  function applyWlFilter() {
    const grid = $('watchlistGrid'); if (!grid) return;
    const counts = { all: 0, plan: 0, watching: 0, completed: 0 };
    grid.querySelectorAll('.media-card').forEach((c) => {
      if (!c._item) return;
      const st = getStatus(c._type, c._item._id || c._item.content_id);
      counts.all++; counts[st]++;
      c.style.display = (wlTab === 'all' || wlTab === st) ? '' : 'none';
      let tag = c.querySelector('.wl-tag');
      if (!tag) { tag = el('span', 'wl-tag'); c.querySelector('.poster-wrap')?.appendChild(tag); }
      tag.textContent = STATUSES.find((s) => s[0] === st)[1]; tag.dataset.st = st;
    });
    document.querySelectorAll('#wlTabs .wl-tab').forEach((b) => {
      b.querySelector('i').textContent = counts[b.dataset.tab] || 0;
      b.classList.toggle('active', b.dataset.tab === wlTab);
    });
    const none = grid.querySelector('.wl-none');
    if (counts.all && !counts[wlTab] && wlTab !== 'all') { if (!none) grid.appendChild(el('p', 'muted empty wl-none', 'Nothing in this list yet. Long-press a title to change its status.')); }
    else none?.remove();
  }
  (function buildWlTabs() {
    const grid = $('watchlistGrid'); if (!grid || $('wlTabs')) return;
    const tabs = el('div', 'wl-tabs'); tabs.id = 'wlTabs';
    STATUSES.forEach(([k, label]) => {
      const b = el('button', 'wl-tab' + (k === 'all' ? ' active' : ''), `${label}<i>0</i>`); b.type = 'button'; b.dataset.tab = k;
      b.addEventListener('click', () => { wlTab = k; applyWlFilter(); });
      tabs.appendChild(b);
    });
    grid.parentNode.insertBefore(tabs, grid);
    new MutationObserver(() => applyWlFilter()).observe(grid, { childList: true });
  })();

  // ---------- 10. Long-press card menu ----------
  let suppressUntil = 0;
  document.addEventListener('click', (e) => {
    if (Date.now() < suppressUntil && e.target.closest('.media-card')) { e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
  document.addEventListener('contextmenu', (e) => { if (e.target.closest('.media-card')) e.preventDefault(); });
  let lpTimer = null, lpX = 0, lpY = 0;
  document.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.media-card'); if (!card || !card._item || e.button > 0) return;
    lpX = e.clientX; lpY = e.clientY;
    clearTimeout(lpTimer);
    lpTimer = setTimeout(() => { suppressUntil = Date.now() + 700; buzz('medium'); openCardMenu(card); }, 480);
  }, { passive: true });
  ['pointerup', 'pointercancel', 'scroll'].forEach((ev) => document.addEventListener(ev, () => clearTimeout(lpTimer), { passive: true, capture: true }));
  document.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - lpX, e.clientY - lpY) > 10) clearTimeout(lpTimer); }, { passive: true });

  function openCardMenu(card) {
    const it = card._item, type = card._type, id = it._id || it.content_id;
    openSheet(it.title || 'Title', (body) => {
      const mk = (icon, label, fn) => { const b = el('button', 'fx-action', `<span>${icon}</span>${label}`); b.type = 'button'; b.addEventListener('click', () => { closeSheet(); fn(); }); body.appendChild(b); return b; };
      mk('▶', 'Open details', () => openDetail(type, id, it));
      const wl = mk('♡', 'Watchlist…', async () => {
        if (!state.user) return openAuth('login');
        try { const res = await api(`/api/watchlist/${type}/${id}`, { method: 'POST' }); toast(res.saved ? 'Added to watchlist' : 'Removed from watchlist'); if (state.page === 'profile') loadProfile(); } catch (err) { toast(err.message, 'error'); }
      });
      if (state.user) api('/api/watchlist').then((list) => {
        const has = list.some((w) => w.content_type === type && String(w.content_id) === String(id));
        wl.innerHTML = has ? '<span>♥</span>Remove from watchlist' : '<span>♡</span>Add to watchlist';
      }).catch(() => {});
      mk('↗', 'Share', () => shareContent(type, id, it.title));
      if (card.closest('#watchlistGrid')) {
        body.appendChild(el('div', 'fx-group-label', 'Set status'));
        const row = el('div', 'fx-chips');
        STATUSES.slice(1).forEach(([k, label]) => {
          const c = el('button', 'fx-chip' + (getStatus(type, id) === k ? ' active' : ''), label); c.type = 'button';
          c.addEventListener('click', () => { const m = wlStatusMap(); m[wlKey(type, id)] = k; LS.set('anicore_wl_status', m); closeSheet(); applyWlFilter(); toast(`Marked ${label}`); });
          row.appendChild(c);
        });
        body.appendChild(row);
      }
    });
  }

  // ---------- 11. Poster fly-in transition ----------
  document.addEventListener('click', (e) => {
    const card = e.target.closest('.media-card');
    if (!card || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const img = card.querySelector('.poster-wrap img'); if (!img) return;
    const r = img.getBoundingClientRect(); if (!r.width) return;
    const c = img.cloneNode(); c.className = 'fly-poster'; c.removeAttribute('loading');
    Object.assign(c.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    document.body.appendChild(c);
    const tw = Math.min(innerWidth * 0.6, 360), th = tw * (r.height / r.width);
    const dx = (innerWidth / 2 - tw / 2) - r.left, dy = 90 - r.top;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      c.style.transform = `translate(${dx}px, ${dy}px) scale(${tw / r.width})`;
      c.style.transformOrigin = '0 0'; c.style.opacity = '0';
    }));
    setTimeout(() => c.remove(), 460);
  }, true);

  // ---------- 12. Toast with Undo for watchlist removal ----------
  let lastWl = null;
  const origApi = api;
  api = async function (path, options = {}) {
    const res = await origApi(path, options);
    try { if (/^\/api\/watchlist\/[^/]+\/[^/]+$/.test(path) && (options.method || 'GET') === 'POST') lastWl = { path, at: Date.now() }; } catch (e) { /* noop */ }
    return res;
  };
  const origToast = toast;
  toast = function (message, kind = 'ok') {
    if (message === 'Removed from watchlist' && lastWl && Date.now() - lastWl.at < 4000) {
      const { path } = lastWl;
      const t = el('div', 'toast ok toast-undo'); t.setAttribute('role', 'status');
      t.innerHTML = '<span>Removed from watchlist</span><button type="button">Undo</button>';
      t.querySelector('button').addEventListener('click', async () => {
        t.remove();
        try {
          const r = await origApi(path, { method: 'POST' });
          const wb = $('wlBtn'); if (wb && r.saved) { wb.textContent = '♥ In Watchlist'; wb.classList.add('saved'); }
          if (state.page === 'profile') loadProfile();
          origToast('Restored to watchlist');
        } catch (err) { origToast(err.message, 'error'); }
      });
      document.body.appendChild(t); setTimeout(() => t.remove(), 5500); buzz('light');
      return;
    }
    return origToast(message, kind);
  };

  // ---------- 13. Anime portrait avatar presets ----------
    // Real anime character portraits are loaded from AniList's character catalogue.
  // No generated/drawn placeholders: show actual character artwork from AniList CDN.
  const ANIME_AVATAR_CACHE = 'anicore_real_anime_avatars_v1';
  let animeAvatarLoad = null;
  async function fetchAnimeAvatarCharacters() {
    try {
      const cached = JSON.parse(localStorage.getItem(ANIME_AVATAR_CACHE) || 'null');
      if (Array.isArray(cached?.items) && cached.items.length && Date.now() - cached.savedAt < 86400000) return cached.items;
    } catch (e) { /* refresh cache */ }
    const query = `query { Page(page: 1, perPage: 50) { characters(sort: FAVOURITES_DESC) { id name { full } image { large } } } }`;
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query })
    });
    if (!response.ok) throw new Error('Anime character images are temporarily unavailable.');
    const payload = await response.json();
    const items = (payload.data?.Page?.characters || [])
      .filter((c) => c.name?.full && /^https:\/\//i.test(c.image?.large || ''))
      .slice(0, 50)
      .map((c) => ({ id: c.id, name: c.name.full, image: c.image.large }));
    if (!items.length) throw new Error('No anime character images were returned.');
    try { localStorage.setItem(ANIME_AVATAR_CACHE, JSON.stringify({ savedAt: Date.now(), items })); } catch (e) {}
    return items;
  }
  const origRenderProfileCard = renderProfileCard;
  let assigningDefaultAnimeAvatar = false;
  renderProfileCard = function (editing = false) {
    origRenderProfileCard(editing);
    const card = $('profileInfo')?.querySelector('.profile-card');
    const form = $('profileEditForm');
    if (!card) return;
    if (!state.user.avatar && !assigningDefaultAnimeAvatar) {
      assigningDefaultAnimeAvatar = true;
      if (!animeAvatarLoad) animeAvatarLoad = fetchAnimeAvatarCharacters().finally(() => { animeAvatarLoad = null; });
      animeAvatarLoad.then(async (characters) => {
        if (state.user && !state.user.avatar && characters.length) {
          const character = characters[Math.floor(Math.random() * characters.length)];
          await saveAvatar({ url: character.image });
          if (!form?.isConnected) origRenderProfileCard(false);
        }
      }).catch(() => {}).finally(() => { assigningDefaultAnimeAvatar = false; });
    }
    if (!editing || card.querySelector('.avatar-presets')) return;
    const box = el('section', 'avatar-presets');
    box.setAttribute('aria-label', 'Real anime character avatars');
    box.appendChild(el('div', 'fx-group-label', 'Choose an anime character'));
    const status = el('p', 'muted avatar-loading', 'Loading real anime character images…');
    const row = el('div', 'avatar-preset-row');
    box.append(status, row);
    const anchor = form?.querySelector('.bg-actions') || card.querySelector('#profileEditBtn') || card.querySelector('.profile-name');
    if (anchor) anchor.insertAdjacentElement('afterend', box);
    if (!animeAvatarLoad) animeAvatarLoad = fetchAnimeAvatarCharacters().finally(() => { animeAvatarLoad = null; });
    animeAvatarLoad.then((characters) => {
      if (!box.isConnected) return;
      status.remove();
      characters.forEach((character) => {
        const b = el('button', 'avatar-preset', '');
        b.type = 'button'; b.title = character.name; b.setAttribute('aria-label', 'Use ' + character.name + ' as profile avatar');
        const portrait = document.createElement('img');
        portrait.src = character.image; portrait.alt = character.name; portrait.loading = 'lazy'; portrait.referrerPolicy = 'no-referrer';
        portrait.onerror = () => { b.remove(); };
        b.appendChild(portrait);
        const caption = el('span', 'avatar-preset-name', character.name);
        b.appendChild(caption);
        b.addEventListener('click', async () => {
          try {
            toast('Saving…');
            await saveAvatar({ url: character.image });
            renderProfileCard(editing);
            toast(character.name + ' avatar saved');
          } catch (err) { toast(err.message, 'error'); }
        });
        row.appendChild(b);
      });
      if (!row.children.length) status.textContent = 'Anime character images could not be loaded. Please try again later.';
    }).catch(() => {
      if (box.isConnected) status.textContent = 'Could not load real anime character images. Check your connection and reopen Profile.';
    });
  };

  // wrap loadProfile so stats/tabs refresh
  const origLoadProfile = loadProfile;
  loadProfile = async function () {
    const r = await origLoadProfile.apply(this, arguments);
    try { applyWlFilter(); } catch (e) { /* noop */ }
    return r;
  };

  // ---------- 14. Notification bell (new episodes on watchlist) ----------
  const bell = el('button', 'header-icon-btn hidden', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 20a1.9 1.9 0 0 0 3.4 0"/></svg><i class="bell-dot hidden"></i>');
  bell.id = 'bellBtn'; bell.type = 'button'; bell.setAttribute('aria-label', 'Notifications');
  $('searchOpenBtn')?.insertAdjacentElement('beforebegin', bell);
  let bellItems = [];
  async function refreshBell(force) {
    if (!state.user) { bell.classList.add('hidden'); return; }
    bell.classList.remove('hidden');
    const last = LS.get('anicore_bell_ts', 0);
    if (!force && Date.now() - last < 30 * 60 * 1000) { bell.querySelector('.bell-dot').classList.toggle('hidden', !bellItems.length); return; }
    try {
      const list = (await api('/api/watchlist')).slice(0, 12);
      const base = LS.get('anicore_ep_counts', null);
      const counts = {}; const fresh = [];
      await Promise.all(list.map(async (w) => {
        try {
          const d = await api(`/api/content/${w.content_type}/${w.content_id}`);
          const k = wlKey(w.content_type, w.content_id); const n = (d.episodes || []).length; counts[k] = n;
          if (base && base[k] != null && n > base[k]) {
            const latest = [...(d.episodes || [])].filter((e) => Number(e.episode) < 1000).sort((a, b) => (b.season - a.season) || (b.episode - a.episode))[0];
            fresh.push({ type: w.content_type, id: w.content_id, title: w.title || d.title, poster: w.poster || d.poster, label: latest ? `${epCode(latest)} is out` : 'New episode' });
          }
        } catch (e) { /* skip */ }
      }));
      bellItems = fresh; LS.set('anicore_bell_pending', fresh);
      if (!base) LS.set('anicore_ep_counts', counts); else LS.set('anicore_bell_next', counts);
      LS.set('anicore_bell_ts', Date.now());
    } catch (e) { bellItems = LS.get('anicore_bell_pending', []); }
    bell.querySelector('.bell-dot').classList.toggle('hidden', !bellItems.length);
  }
  bell.addEventListener('click', () => {
    openSheet('Notifications', (body) => {
      if (!bellItems.length) { body.appendChild(el('p', 'muted so-hint', 'No new episodes for your watchlist yet.')); return; }
      bellItems.forEach((n) => {
        const b = el('button', 'so-result', '<img alt="" loading="lazy"><span><strong></strong><small></small></span>'); b.type = 'button';
        b.querySelector('img').src = safeUrl(n.poster) || PLACEHOLDER; b.querySelector('strong').textContent = n.title || 'Title'; b.querySelector('small').textContent = n.label;
        b.addEventListener('click', () => { closeSheet(); openDetail(n.type, n.id); });
        body.appendChild(b);
      });
    });
    const next = LS.get('anicore_bell_next', null); if (next) LS.set('anicore_ep_counts', next);
    bellItems = []; LS.set('anicore_bell_pending', []); bell.querySelector('.bell-dot').classList.add('hidden');
  });
  const origUpdateAuthUI = updateAuthUI;
  updateAuthUI = function () { const r = origUpdateAuthUI.apply(this, arguments); try { refreshBell(); } catch (e) { /* noop */ } return r; };
  bellItems = LS.get('anicore_bell_pending', []);
  setTimeout(() => refreshBell(), 1500);

  // ---------- 15. Mini-player (direct videos keep playing while you browse) ----------
  let mini = null;
  function closeMini() {
    if (!mini) return;
    try { mini.wrap.querySelector('video')?.pause(); } catch (e) { /* noop */ }
    mini.wrap.remove(); mini.box.remove(); mini = null;
  }
  function openMini() {
    const wrap = $('playerWrap'); if (!wrap || !videoContext) return;
    const video = wrap.querySelector('video'); if (!video || video.paused || video.ended) return;
    const ph = el('div', wrap.className); ph.id = 'playerWrap';
    const box = el('div', 'mini-player');
    const ep = videoContext.episodes[videoContext.currentIndex];
    const bar = el('div', 'mini-bar', '<span class="mini-title"></span><button type="button" class="mini-btn" data-a="expand" aria-label="Expand">⤢</button><button type="button" class="mini-btn" data-a="close" aria-label="Close">✕</button>');
    bar.querySelector('.mini-title').textContent = `${videoContext.contentTitle} · ${ep ? epBadge(ep) : ''}`;
    wrap.parentNode.insertBefore(ph, wrap); wrap.id = 'miniWrap';
    box.append(bar, wrap); document.body.appendChild(box);
    mini = { box, wrap, ph, ctx: videoContext };
    video.play?.().catch(() => {});
    bar.addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.a;
      if (a === 'close') closeMini();
      if (a === 'expand') {
        const m = mini; mini = null;
        m.wrap.id = 'playerWrap'; m.ph.parentNode.replaceChild(m.wrap, m.ph); m.box.remove();
        videoContext = m.ctx; showPage('video');
        try { updateVideoNav(); renderVideoEpList(); } catch (err) { /* noop */ }
        m.wrap.querySelector('video')?.play?.().catch(() => {});
      }
    });
  }
  const origShowPage = showPage;
  showPage = function (page) {
    if (state.page === 'video' && page !== 'video' && !mini) { try { openMini(); } catch (e) { /* noop */ } }
    return origShowPage.apply(this, arguments);
  };
  const origOpenVideo = openVideo;
  openVideo = function () { closeMini(); return origOpenVideo.apply(this, arguments); };

  // ---------- 16. Player extras: double-tap seek, next-ep countdown, embed skip ----------
  if (LS.get('anicore_autonext', null) === null) LS.set('anicore_autonext', true);
  (function addAutoNextToggle() {
    const tools = $('playerTools'); if (!tools || $('fxAutoNext')) return;
    const lab = el('label', 'pt-item pt-check', '<input type="checkbox" id="fxAutoNext"> Auto-play next episode');
    tools.insertBefore(lab, tools.firstChild);
    const cb = lab.querySelector('input'); cb.checked = !!LS.get('anicore_autonext', true);
    cb.addEventListener('change', () => LS.set('anicore_autonext', cb.checked));
  })();

  function ripple(wrap, side, text) {
    const r = el('div', 'seek-ripple ' + side, `<span>${text}</span>`); wrap.appendChild(r); setTimeout(() => r.remove(), 650);
  }
  function setupDirect(video, wrap) {
    if (video._fx) return; video._fx = true;
    let last = 0, lastSide = '';
    const seek = (side) => {
      const d = side === 'left' ? -10 : 10;
      video.currentTime = Math.max(0, Math.min((video.duration || Infinity) - 0.2, video.currentTime + d));
      ripple(wrap, side, (d > 0 ? '+' : '−') + '10s'); buzz('light');
    };
    const handle = (e, x, y) => {
      const r = wrap.getBoundingClientRect(); const rx = (x - r.left) / r.width, ry = (y - r.top) / r.height;
      if (ry > 0.8 || ry < 0.1) return false;
      const side = rx < 0.33 ? 'left' : rx > 0.67 ? 'right' : '';
      if (!side) return false;
      const now = Date.now();
      if (now - last < 320 && lastSide === side) { last = 0; seek(side); return true; }
      last = now; lastSide = side; return false;
    };
    wrap.addEventListener('touchend', (e) => { const t = e.changedTouches[0]; if (t && handle(e, t.clientX, t.clientY)) e.preventDefault(); }, { passive: false });
    wrap.addEventListener('dblclick', (e) => {
      const r = wrap.getBoundingClientRect(); const rx = (e.clientX - r.left) / r.width, ry = (e.clientY - r.top) / r.height;
      if (ry > 0.8) return;
      if (rx < 0.33) { e.preventDefault(); seek('left'); } else if (rx > 0.67) { e.preventDefault(); seek('right'); }
    });
    let started = false;
    video.addEventListener('playing', () => { if (started) buzz('light'); started = true; });
    video.addEventListener('pause', () => { if (started && !video.ended) buzz('light'); });
    video.addEventListener('ended', () => buzz('success'));
    video.addEventListener('ended', () => {
      if (!LS.get('anicore_autonext', true)) return;
      const idx = nextPlayableIndex(); if (idx === -1 || wrap.querySelector('.player-next')) return;
      const nx = videoContext.episodes[idx];
      const box = el('div', 'player-next', `<p>Up next</p><strong></strong><span class="player-next-count"></span><div class="player-next-actions"><button type="button" class="outline small" data-act="cancel">Cancel</button><button type="button" class="primary small" data-act="now">Play now</button></div>`);
      box.querySelector('strong').textContent = `${epCode(nx)}${nx.title ? ' — ' + nx.title : ''}`;
      wrap.appendChild(box);
      let left = 5; const cnt = box.querySelector('.player-next-count'); cnt.textContent = `Playing in ${left}s`;
      const go = () => { clearInterval(tm); box.remove(); playNextEpisode(); };
      const tm = setInterval(() => { if (!wrap.contains(box)) { clearInterval(tm); return; } left--; if (left <= 0) go(); else cnt.textContent = `Playing in ${left}s`; }, 1000);
      box.addEventListener('click', (e) => { const a = e.target.closest('button')?.dataset.act; if (a === 'cancel') { clearInterval(tm); box.remove(); } if (a === 'now') go(); });
    });
  }

  // Embedded players (e.g. upload18.org): best-effort skip controls.
  const embedMsgHandlers = new Set();
  window.addEventListener('message', (e) => { embedMsgHandlers.forEach((h) => { try { h(e); } catch (err) { /* noop */ } }); });
  function readTime(data) {
    let d = data;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return null; } }
    if (!d || typeof d !== 'object') return null;
    const cands = [d.currentTime, d.time, d.position, d.seconds, d.data && d.data.currentTime, d.data && d.data.time, d.info && d.info.currentTime, d.value && d.value.currentTime, d.payload && d.payload.currentTime];
    for (const c of cands) { if (typeof c === 'number' && Number.isFinite(c)) return c; }
    return null;
  }
  function seekEmbed(iframe, sec) {
    const w = iframe.contentWindow; if (!w) return;
    const msgs = [
      { event: 'command', func: 'seekTo', args: [sec, true] },
      { method: 'setCurrentTime', value: sec },
      { method: 'seekTo', value: sec }, { method: 'seek', value: sec },
      { command: 'seek', time: sec }, { command: 'seekTo', time: sec, value: sec },
      { type: 'seek', time: sec, value: sec }, { action: 'seek', time: sec, value: sec },
      { event: 'seek', time: sec }, { name: 'seek', value: sec },
      { seekTo: sec }, { currentTime: sec }, { cmd: 'seek', value: sec },
    ];
    msgs.forEach((m) => { try { w.postMessage(m, '*'); w.postMessage(JSON.stringify(m), '*'); } catch (e) { /* noop */ } });
  }
  function reloadAt(iframe, url, sec) {
    try {
      const u = new URL(normalizeEmbedUrl(url), location.href);
      ['t', 'start', 'startTime', 'time', 'seek'].forEach((k) => u.searchParams.set(k, String(Math.floor(sec))));
      iframe.src = u.toString();
    } catch (e) { /* noop */ }
  }
  const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  function setupEmbed(iframe, wrap, url) {
    const ep = videoContext && videoContext.episodes[videoContext.currentIndex]; if (!ep) return;
    const iS = num(ep.intro_start) ?? 0, iE = num(ep.intro_end), oS = num(ep.outro_start);
    if (iE === null && oS === null) return;
    const box = el('div', 'embed-skip');
    let introBtn = null, outroBtn = null, armed = 0, armTimer = null;
    if (iE !== null) {
      introBtn = el('button', 'embed-skip-btn', 'Skip Intro ▸▸'); introBtn.type = 'button';
      introBtn.addEventListener('click', () => {
        if (armed) { clearTimeout(armTimer); armed = 0; reloadAt(iframe, url, iE); toast(`Reloading at ${fmtT(iE)}`); return; }
        seekEmbed(iframe, iE); buzz('light');
        armed = Date.now(); armTimer = setTimeout(() => { armed = 0; }, 5000);
        toast(`Jumping to ${fmtT(iE)} — if it didn't move, tap Skip Intro again to reload there`);
      });
      box.appendChild(introBtn);
    }
    if (oS !== null) {
      const hasNext = nextPlayableIndex() !== -1;
      outroBtn = el('button', 'embed-skip-btn', hasNext ? 'Next episode ▸▸' : 'Skip Outro ▸▸'); outroBtn.type = 'button';
      outroBtn.addEventListener('click', () => { if (hasNext) playNextEpisode(); else seekEmbed(iframe, oS + 600); });
      box.appendChild(outroBtn);
    }
    wrap.appendChild(box);
    // If the embed reports its playback time, show each button only in its window and honour auto-skip.
    let gotTime = false, autoI = false, autoO = false;
    const handler = (e) => {
      if (e.source !== iframe.contentWindow) return;
      const t = readTime(e.data); if (t === null) return;
      if (!gotTime) { gotTime = true; box.classList.add('smart'); }
      const inIntro = iE !== null && t >= iS && t < iE - 0.5, inOutro = oS !== null && t >= oS;
      introBtn?.classList.toggle('on', inIntro); outroBtn?.classList.toggle('on', inOutro);
      if (inIntro && !autoI && playerPref.get('autoSkipIntro')) { autoI = true; seekEmbed(iframe, iE); }
      if (inOutro && !autoO && playerPref.get('autoSkipOutro')) { autoO = true; outroBtn?.click(); }
    };
    embedMsgHandlers.add(handler);
    const obs = new MutationObserver(() => { if (!wrap.contains(iframe)) { embedMsgHandlers.delete(handler); obs.disconnect(); } });
    obs.observe(wrap, { childList: true });
  }

  const origMountPlayer = mountPlayer;
  mountPlayer = async function (url) {
    closeMini();
    const r = await origMountPlayer.apply(this, arguments);
    try {
      const wrap = $('playerWrap'); if (!wrap) return r;
      const v = wrap.querySelector('video'); if (v) setupDirect(v, wrap);
      const f = wrap.querySelector('iframe'); if (f) setupEmbed(f, wrap, url);
      // the embed may be mounted after a "tap to play" cover: watch for it
      if (!f && !v) {
        const mo = new MutationObserver(() => { const f2 = wrap.querySelector('iframe'); if (f2 && !wrap.querySelector('.embed-skip')) { setupEmbed(f2, wrap, url); mo.disconnect(); } const v2 = wrap.querySelector('video'); if (v2) { setupDirect(v2, wrap); mo.disconnect(); } });
        mo.observe(wrap, { childList: true, subtree: true }); setTimeout(() => mo.disconnect(), 60000);
      }
    } catch (e) { /* noop */ }
    return r;
  };
  // cover click mounts iframe later: also catch that case when the cover exists
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.player-cover')) return;
    setTimeout(() => { const wrap = $('playerWrap'); const f = wrap?.querySelector('iframe'); if (f && !wrap.querySelector('.embed-skip') && videoContext) setupEmbed(f, wrap, videoContext.episodes[videoContext.currentIndex].video_url); }, 120);
  }, true);

  // ---------- 17. Episode grid view + watched ticks ----------
  const origRenderVideoEpList = renderVideoEpList;
  renderVideoEpList = function () {
    origRenderVideoEpList.apply(this, arguments);
    try {
      const box = $('videoEpList'); const list = box && box.querySelector('.ep-list'); if (!list || list.querySelector('.ep-view-toggle')) { decorateEps(); return; }
      const t = el('button', 'fx-btn ep-view-toggle', ''); t.type = 'button';
      const paint = () => { const g = LS.get('anicore_epview', 'list') === 'grid'; t.innerHTML = (g ? ICON_LIST : ICON_GRID) + `<span>${g ? 'List' : 'Grid'}</span>`; $('epRows')?.classList.toggle('ep-rows-grid', g); };
      t.addEventListener('click', () => { LS.set('anicore_epview', LS.get('anicore_epview', 'list') === 'grid' ? 'list' : 'grid'); paint(); });
      list.insertBefore(t, list.firstChild); paint();
      const rows = $('epRows'); if (rows) new MutationObserver(decorateEps).observe(rows, { childList: true });
      decorateEps();
    } catch (e) { /* noop */ }
  };
  function decorateEps() {
    if (!videoContext) return;
    const seen = new Set(seenMap()[`${videoContext.type}:${videoContext.contentId}`] || []);
    document.querySelectorAll('#epRows .ep-row').forEach((row) => {
      const ep = videoContext.episodes[Number(row.dataset.idx)]; if (!ep) return;
      row.classList.toggle('seen', seen.has(`${ep.season}-${ep.episode}`) && !row.classList.contains('playing'));
    });
    $('epRows')?.classList.toggle('ep-rows-grid', LS.get('anicore_epview', 'list') === 'grid');
  }

  // ---------- 18. Apply list view to search results when they render ----------
  const sg = $('searchGrid'); if (sg) new MutationObserver(applyView).observe(sg, { childList: true });
})();
