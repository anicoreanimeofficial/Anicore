'use strict';

const $ = (id) => document.getElementById(id);
const BOOT_NAV = (() => {
  try {
    // A shared link wins: #/detail/<type>/<id> or #/<page>
    const d = location.hash.match(/^#\/detail\/([a-z_]+)\/([A-Za-z0-9_-]+)$/);
    if (d) return { page: 'detail', detailType: d[1], detailId: d[2] };
    const p = location.hash.match(/^#\/([a-z]+)$/);
    if (p) return { page: p[1] };
    return JSON.parse(sessionStorage.getItem('anicore-nav') || 'null');
  } catch (e) { return null; }
})();

const isRealId = (v) => /^[0-9a-f]{24}$/.test(String(v || ''));
function slugify(t) {
  return String(t || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ').replace(/['\u2019]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
// Address-bar part for a title page: the anime name when known, otherwise the id.
function detailRef(id, title) { return slugify(title) || id; }
const PLACEHOLDER = 'https://placehold.co/400x600/17101e/ffffff?text=ANICORE';
const PAGE_SIZE = 20;
const APP_JS_VERSION = 'v53';

console.log('[anicore] app.js loaded —', APP_JS_VERSION);

const state = {
  user: null,
  authMode: 'login',
  page: 'home',
  detailId: null,
  detailType: null,
  genres: [],
  theme: localStorage.getItem('anicore-theme') || 'dark',
  accent: localStorage.getItem('anicore-accent') || 'pink',
  language: localStorage.getItem('anicore-lang') || 'en',
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
    continue: "Continue Watching", schedule: "Schedule", activity: "Your Activity", preferences: "Preferences",
    signIn: "Sign In", logout: "Logout", save: "Save Preferences",
  },
  hi: {
    home: "होम", search: "खोजें", series: "सीरीज़", anime: "एनिमे", tv: "टीवी शो", movies: "फ़िल्में",
    profile: "प्रोफ़ाइल", admin: "एडमिन", recommended: "आपके लिए सुझाव",
    continue: "देखना जारी रखें", schedule: "शेड्यूल", activity: "आपकी गतिविधि", preferences: "प्राथमिकताएँ",
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
    if (window.tgHaptic) tgHaptic(kind === 'error' ? 'error' : 'success');
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


function applyAccent(accent) {
  state.accent = accent || "pink";
  document.documentElement.setAttribute("data-accent", state.accent);
  localStorage.setItem("anicore-accent", state.accent);
  const sel = $("accentSelect");
  if (sel) sel.value = state.accent;
  const psel = $("profileAccent");
  if (psel) psel.value = state.accent;
  const lc = $("profileLowData");
  if (lc) lc.checked = lowData;
}

function applyLanguage(lang) {
  state.language = lang === "hi" ? "hi" : "en";
  localStorage.setItem("anicore-lang", state.language);
  document.documentElement.lang = state.language === "hi" ? "hi" : "en";
  const sel = $("langSelect");
  if (sel) sel.value = state.language;
  const psel = $("profileLang");
  if (psel) psel.value = state.language;
  applyI18n();
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
    }));
  } catch (e) {}
  // Give every page its own link in the address bar
  try {
    let h = state.page === 'home' ? '' : '#/' + state.page;
    if ((state.page === 'detail' || state.page === 'video') && state.detailId && state.detailType) {
      h = '#/detail/' + state.detailType + '/' + detailRef(state.detailId, state.detailTitle);
    }
    const key = (state.page === 'detail' || state.page === 'video')
      ? `${state.page}:${state.detailType}:${state.detailId}` : state.page;
    const idx = (history.state && history.state.idx) || 0; // how many in-app pages sit behind this one
    const entry = { key, idx, page: state.page, detailType: state.detailType, detailId: state.detailId };
    const url = location.pathname + location.search + h;
    // Each page the user opens gets its own history entry so the phone's Back button steps back
    // through the app instead of leaving the site. Back/forward itself must not add entries.
    if (navFromHistory || !history.state || !history.state.key) {
      history.replaceState(entry, '', url);
    } else if (history.state.key !== key) {
      entry.idx = idx + 1;
      history.pushState(entry, '', url);
    }
  } catch (e) {}
}

let navFromHistory = false;

function navigateFromHistory() {
  let st = history.state;
  if (!st || !st.key) {
    const d = location.hash.match(/^#\/detail\/([a-z_]+)\/([A-Za-z0-9_-]+)$/);
    const pg = location.hash.match(/^#\/([a-z]+)$/);
    st = d ? { page: 'detail', detailType: d[1], detailId: d[2] } : { page: pg ? pg[1] : 'home' };
  }
  navFromHistory = true;
  try {
    document.querySelectorAll('.modal:not(.hidden)').forEach((m) => m.classList.add('hidden'));
    if ((st.page === 'detail' || st.page === 'video') && st.detailId && st.detailType) {
      // A video can't be rebuilt from history alone, so Back/Forward land on its details page.
      openDetail(st.detailType, st.detailId);
    } else if (PAGE_ORDER.includes(st.page) && st.page !== 'detail' && st.page !== 'video') {
      showPage(st.page);
    } else {
      showPage('home');
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

  // Leaving video → cleanup
  if (state.page === 'video' && page !== 'video') {
    setTgPlayerExpanded(false);
    clearPlayer();
    videoContext = null;
    document.querySelectorAll('.tg-expand-btn').forEach((b) => b.remove());
  }
  if (page === 'video') hideResumeBar();
  else if (state.page === 'video' && state.user) setTimeout(loadContinueWatching, 400);

  if (page !== state.page) { topLoader.start(); setTimeout(() => topLoader.done(), 500); } // always show the red bar when moving between pages
  const dir = PAGE_ORDER.indexOf(page) >= PAGE_ORDER.indexOf(state.page) ? 'from-right' : 'from-left';
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p === target));
  target.classList.remove('from-left', 'from-right');
  void target.offsetWidth;
  if (page !== state.page) target.classList.add(dir);
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
  movePill();
  $('sidebar')?.classList.remove('open');

  if (page === 'series') {
    loadSeries(true);
  }
  const type = PAGE_TYPES[page];
  if (type && !LISTS[type].page) loadList(type, true);
  if (page === 'home') {
    loadRecommendations();
    loadHome();
    loadContinueWatching();
  }
  if (page === 'schedule') loadSchedule();
  if (page === 'profile') { loadProfileActivity(); } loadProfile();
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
    e.preventDefault();
    showPage(el.dataset.page);
  }
});

$('menuBtn')?.addEventListener('click', () => {
  $('sidebar')?.classList.toggle('open');
});

let lastScrollY = window.scrollY;
let scrollTick = false;
window.addEventListener('scroll', () => {
  if (scrollTick) return;
  scrollTick = true;
  requestAnimationFrame(() => {
    const y = window.scrollY;
    if (Math.abs(y - lastScrollY) >= 8) {
      $('bottomNav')?.classList.toggle('hidden-nav', y > lastScrollY && y > 100);
      lastScrollY = y;
    }
    scrollTick = false;
  });
}, { passive: true });

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
    card.className = 'media-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', item.title || 'Untitled');

    const rating = item.avg_rating ? `<span class="rating-badge">★ ${item.avg_rating}</span>` : '';
    const sub = rating || (item.year ? String(item.year) : (item.status || ''));

    card.innerHTML = `
      <div class="poster-wrap">
        <img loading="lazy" decoding="async" alt="">
      </div>
      <div class="media-info">
        <h3></h3>
        <p>${sub}</p>
      </div>`;

    const img = card.querySelector('img');
    img.decoding = 'async';
    img.src = safeUrl(item.poster) || PLACEHOLDER;
    img.alt = item.title || '';
    img.addEventListener('error', () => { img.src = PLACEHOLDER; }, { once: true });

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
      api('/api/anime?page=1&limit=10&sort=views'),
      api('/api/tvshows?page=1&limit=10&sort=views'),
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
      api('/api/anime?page=1&limit=10&sort=newest'),
      api('/api/tvshows?page=1&limit=10&sort=newest'),
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

function continueProgress(item) {
  // Overall progress through the series: finished episodes plus the part of the current one.
  const total = Number(item.total_episodes) || 0;
  const n = Number(item.episode_number) || 0;
  if (total && n) return Math.min(100, (((n - 1) + (Number(item.progress_percent) || 0) / 100) / total) * 100);
  return Number(item.progress_percent) || 0;
}

async function loadContinueWatching() {
  const section = $('continueSection');
  const grid = $('continueGrid');
  if (!state.user) {
    hideResumeBar();
    section?.classList.add('hidden');
    return;
  }
  try {
    const items = await api('/api/continue-watching');
    if (items.length) {
      showResumeBar(items[0]);
      if (section && grid) {
        section.classList.remove('hidden');
        grid.innerHTML = '';
        items.slice(0, 8).forEach((item) => {
          const type = item.content_type || item.type || 'anime';
          const card = document.createElement('button');
          card.type = 'button';
          card.className = 'continue-card';
          const pct = Math.max(0, Math.min(100, continueProgress(item)));
          const poster = safeUrl(item.poster || item.content_poster) || PLACEHOLDER;
          card.innerHTML = `<img loading="lazy" alt=""><span class="continue-card-copy"><strong></strong><small>Episode ${Number(item.episode) || 1} · ${Math.round(pct)}% watched</small><i><b style="width:${pct}%"></b></i></span><span class="continue-play">▶</span>`;
          card.querySelector('img').src = poster;
          card.querySelector('img').alt = item.title || 'Continue watching';
          card.querySelector('strong').textContent = item.title || 'Continue watching';
          card.addEventListener('click', () => openDetail(type, item.content_id || item._id, item));
          grid.appendChild(card);
        });
      }
    } else {
      hideResumeBar();
      section?.classList.add('hidden');
    }
  } catch {
    hideResumeBar();
    section?.classList.add('hidden');
  }
}

// --- Floating resume bar (latest title, sits above the nav) ---

let resumeItem = null;

function durationMinutes(text) {
  const t = String(text || '').toLowerCase();
  const h = (t.match(/(\d+)\s*h/) || [])[1];
  const m = (t.match(/(\d+)\s*m/) || [])[1] || (!h && (t.match(/^\d+$/) || [])[0]);
  const total = (Number(h) || 0) * 60 + (Number(m) || 0);
  return total || 0;
}

function resumeDismissKey(item) {
  return `anicore-resume-dismissed:${item.content_id}:${item.season}:${item.episode}`;
}

function hideResumeBar() {
  resumeItem = null;
  $('resumeBar')?.classList.add('hidden');
}

function showResumeBar(item) {
  const bar = $('resumeBar');
  if (!bar || !item || state.page === 'video') { hideResumeBar(); return; }
  try { if (sessionStorage.getItem(resumeDismissKey(item))) { hideResumeBar(); return; } } catch (e) { /* noop */ }
  resumeItem = item;

  const pct = Math.round(continueProgress(item));
  const epPct = Number(item.progress_percent) || 0;
  const mins = durationMinutes(item.duration);
  $('resumeEp').textContent = `EP ${item.episode || 1}`;
  $('resumeLeft').textContent = mins
    ? `${Math.max(1, Math.round(mins * (1 - epPct / 100)))} min left`
    : (item.up_next ? 'Up next' : 'Resume');
  $('resumeTitle').textContent = item.title || 'Untitled';
  $('resumeFill').style.width = `${Math.max(pct, 3)}%`;
  $('resumePct').textContent = `${pct}%`;
  const img = $('resumeImg');
  img.onerror = () => { img.onerror = null; img.src = PLACEHOLDER; };
  img.src = safeUrl(item.poster) || safeUrl(item.thumbnail) || safeUrl(item.banner) || PLACEHOLDER;
  bar.classList.remove('hidden');
}

$('resumeMain')?.addEventListener('click', () => {
  if (resumeItem) resumeWatching({ ...resumeItem, _id: resumeItem.content_id, _type: resumeItem.content_type });
});
$('resumeClose')?.addEventListener('click', () => {
  if (resumeItem) { try { sessionStorage.setItem(resumeDismissKey(resumeItem), '1'); } catch (e) { /* noop */ } }
  hideResumeBar();
});

async function loadList(type, reset = false) {
  const l = LISTS[type];
  if (l.loading) return;
  if (reset) { l.page = 0; l.total = 0; }
  if (l.page > 0 && l.page * PAGE_SIZE >= l.total) return;

  l.loading = true;
  const next = l.page + 1;
  const params = new URLSearchParams({ page: next, limit: PAGE_SIZE, sort: l.sortVal || 'newest' });
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
    loadContinueWatching();
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
    hideResumeBar();
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
          <label>Profile picture link
            <input id="avatarUrlInput" type="url" placeholder="https://..." value="${esc((u.avatar || '').startsWith('https://') ? u.avatar : '')}" autocomplete="off">
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
  const url = $('avatarUrlInput').value.trim();
  try {
    if (url && url !== state.user.avatar) {
      await new Promise((ok, fail) => {
        const probe = new Image();
        probe.onload = ok;
        probe.onerror = () => fail(new Error('That link did not load as an image.'));
        probe.src = url;
      });
      await saveAvatar({ url });
    }
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
    info.innerHTML = '<div class="panel profile-panel"><p class="muted">Sign in to see your profile and watchlist, and to set your own background image.</p><button class="primary" type="button" id="profileSignIn">Sign In</button></div>';
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

function episodesHtml(episodes, type, contentId, contentCtx) {
  if (!episodes?.length) return '';
  const sorted = [...episodes].sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
  const seasons = [...new Set(sorted.map((e) => e.season))];
  const epHtml = (ep) => {
    const thumb = safeUrl(ep.thumbnail) || seasonThumb(sorted, ep.season, contentCtx) || '';
    return `
    <div class="episode" data-season="${ep.season}" data-episode="${ep.episode}">
      ${thumb ? `<img class="ep-thumb" src="${esc(thumb)}" alt="" loading="lazy" decoding="async">` : ''}
      <div class="ep-body">
        <div class="ep-header">
          <strong>S${esc(ep.season)} · E${esc(ep.episode)}</strong>${ep.title ? ` — ${esc(ep.title)}` : ''}${ep.duration ? `<span class="muted"> · ${esc(ep.duration)}</span>` : ''}
        </div>
        <div class="ep-actions">
          ${ep.video_url ? `<button type="button" class="outline medium ep-play"
            data-season="${ep.season}"
            data-episode="${ep.episode}">▶ Watch</button>` : ''}
          ${state.user ? `<button type="button" class="outline small mark-progress"
            data-season="${ep.season}" data-episode="${ep.episode}">Mark watched</button>` : ''}
        </div>
        ${linkList(ep.quality_links)}
      </div>
    </div>`;
  };
  return `<h3>Episodes</h3>` + seasons.map((s) => {
    const list = sorted.filter((e) => e.season === s);
    const st = seasonThumb(sorted, s);
    return `
    <div class="season-block">
      <div class="season-head">
        ${st ? `<img class="season-thumb" src="${esc(st)}" alt="" loading="lazy" decoding="async">` : ''}
        <div><strong>Season ${esc(s)}</strong><div class="muted small-muted">${list.length} episode${list.length === 1 ? '' : 's'}</div></div>
      </div>
      <div class="episodes">${list.map(epHtml).join('')}</div>
    </div>`;
  }).join('');
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
  return `${base}/#/detail/${type}/${detailRef(id, title)}`;
}

async function shareContent(type, id, title) {
  const url = contentShareUrl(type, id);
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
      ${state.user?.role === 'admin' ? `<button class="outline" id="shareBtn" type="button">🔗 Share link</button>` : ''}
    </div>
    ${state.user?.role === 'admin' ? `<p class="hint share-url-hint" id="shareUrlHint">${esc(contentShareUrl(type, item._id, item.title))}</p>` : ''}
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

  container.querySelectorAll('.ep-play').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = Number(btn.dataset.season);
      const e = Number(btn.dataset.episode);
      if (!item.episodes) return;
      openVideo(type, item._id, item.title, item.episodes, s, e, item.banner || item.poster, 0, item.season_thumbnails || {});
    });
  });

  container.querySelector('#shareBtn')?.addEventListener('click', () => {
    shareContent(type, item._id, item.title);
  });
  container.querySelector('#shareUrlHint')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(contentShareUrl(type, item._id, item.title));
      toast("Link copied");
    } catch (e) {
      window.prompt("Copy this link:", contentShareUrl(type, item._id, item.title));
    }
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
        loadContinueWatching();
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
  // A name link (#/detail/anime/some-title) is turned into the real id first.
  if (!isRealId(id)) {
    try { id = (await api(`/api/resolve/${type}/${encodeURIComponent(id)}`))._id; }
    catch (err) { toast('Title not found.', 'error'); showPage('home'); return; }
    try { if (history.state) history.replaceState({ ...history.state, key: `detail:${type}:${id}`, detailId: id }, '', location.href); } catch (e) {}
  }
  state.detailId = id;
  state.detailType = type;
  state.detailTitle = (preview && preview.title) || '';

  showPage('detail');
  const contentEl = $('detailPageContent');

  if (preview && contentEl) {
    contentEl.innerHTML = buildDetailHtml(type, preview, null);
    bindDetailEvents(type, preview, contentEl);
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
      const u = location.pathname + location.search + '#/detail/' + type + '/' + detailRef(id, state.detailTitle);
      if (history.state && history.state.key) history.replaceState(history.state, '', u);
    } catch (e) {}
    contentEl.innerHTML = buildDetailHtml(type, item, comments);
    contentEl.classList.remove('swap-in'); void contentEl.offsetWidth; contentEl.classList.add('swap-in');
    bindDetailEvents(type, item, contentEl);
  } catch (err) {
    if (state.detailId !== id) return;
    toast(err.message || 'Failed to load details.', 'error');
    showPage('home');
  }
}

$('detailBack')?.addEventListener('click', () => {
  if (history.state && history.state.idx > 0) history.back(); else showPage('home');
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
      <strong>S${esc(nextEp.season)} · E${esc(nextEp.episode)}${nextEp.title ? ' — ' + esc(nextEp.title) : ''}</strong>
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
  const nextNo = Number(episodes[episodes.length - 1].episode) + 1;
  const bell = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 22a2.2 2.2 0 0 0 2.2-2.2h-4.4A2.2 2.2 0 0 0 12 22zm6.5-6.2V11c0-3.1-1.7-5.7-4.6-6.4V4a1.9 1.9 0 0 0-3.8 0v.6C7.2 5.3 5.5 7.9 5.5 11v4.8L3.5 17.8V19h17v-1.2z"/></svg>';

  box.innerHTML = `
    <div class="ep-list">
      ${seasons.length > 1 ? `<div class="ep-seasons">${seasons.map((n) =>
        `<button type="button" class="ep-season-btn ${n === videoContext.listSeason ? 'active' : ''}" data-season="${esc(n)}">Season ${esc(n)}</button>`).join('')}</div>` : ''}
      <input type="search" id="epFilter" class="ep-filter" placeholder="Filter episodes..." autocomplete="off" value="${esc(videoContext.epFilter || '')}">
      <div class="ep-rows" id="epRows"></div>
      ${nextAt ? `<div class="ep-next">${bell}<span><strong>Episode ${esc(nextNo)}</strong> in <strong id="epNextIn">${fmtCountdown(nextAt - Date.now())}</strong> <span class="ep-next-date">· ${nextAt.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${pad2(nextAt.getHours())}:${pad2(nextAt.getMinutes())}</span></span></div>` : ''}
    </div>`;

  const fillRows = () => {
    const q = (videoContext.epFilter || '').trim().toLowerCase();
    const rows = $('epRows');
    const html = episodes.map((ep, i) => {
      if (ep.season !== videoContext.listSeason) return '';
      const name = ep.title || `Episode ${ep.episode}`;
      if (q && !(`episode ${ep.episode} ${ep.episode} ${name}`.toLowerCase().includes(q))) return '';
      const playing = i === currentIndex;
      const off = !ep.video_url;
      return `
        <button type="button" class="ep-row ${playing ? 'playing' : ''} ${off ? 'off' : ''}" data-idx="${i}" ${off ? 'disabled' : ''}>
          <span class="ep-badge">EP ${esc(ep.episode)}</span>
          <span class="ep-info"><span class="ep-name">${esc(name)}</span>${ep.duration ? `<span class="ep-dur">${esc(ep.duration)}</span>` : ''}</span>
          ${playing ? '<span class="ep-playing">PLAYING</span>' : ''}
        </button>`;
    }).join('');
    rows.innerHTML = html || '<p class="muted ep-none">No episodes found.</p>';
  };
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
  const sorted = [...episodes].sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
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
  loadVideoEpisode();
  showPage('video');
}


// --- Continue Watching: save + resume ---

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

async function resumeWatching(item) {
  const type = item._type || item.content_type;
  const id = item._id || item.content_id;
  try {
    const full = await api(`/api/content/${type}/${id}`);
    rememberAir(full);
    const eps = [...(full.episodes || [])].sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
    if (!eps.length) { openDetail(type, id, item); return; }
    let idx = eps.findIndex((e) => Number(e.season) === Number(item.season) && Number(e.episode) === Number(item.episode));
    if (idx === -1) idx = 0;
    const ep = eps[idx];
    state.detailId = id;
    state.detailType = type;
    openVideo(type, id, full.title, eps, ep.season, ep.episode, full.banner || full.poster, item.progress_percent, full.season_thumbnails || {});
  } catch (err) {
    toast(err.message || 'Could not resume', 'error');
  }
}

function loadVideoEpisode() {
  if (!videoContext) return;
  const ep = videoContext.episodes[videoContext.currentIndex];
  $('videoTitle').textContent = videoContext.contentTitle;
  const sub = `S${ep.season} · E${ep.episode}${ep.title ? ' — ' + ep.title : ''}${ep.duration ? ' · ' + ep.duration : ''}`;
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
    prevBtn.textContent = `← S${prevEp.season}E${prevEp.episode}`;
  } else {
    prevBtn.hidden = true;
    prevBtn.classList.add('hidden-nav-btn');
    prevBtn.disabled = true;
  }

  if (nextEp) {
    nextBtn.hidden = false;
    nextBtn.classList.remove('hidden-nav-btn');
    nextBtn.disabled = false;
    nextBtn.textContent = `S${nextEp.season}E${nextEp.episode} →`;
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
      row.innerHTML = `
        <img src="${esc(safeUrl(item.poster) || PLACEHOLDER)}" alt="">
        <div>
          <h4>${esc(item.title)}</h4>
          <p>${esc(item.status || '')} · ${item.year || '—'} · ★ ${item.avg_rating || '—'}${item.hero ? ` · 🎬 Hero${item.hero_order ? ' #' + item.hero_order : ''}` : ''}${item.top_airing ? ` · 🔥 Top${item.top_rank ? ' #' + item.top_rank : ''}` : ''}${item.published === false && item.scheduled_at ? ` · ⏳ goes live ${esc(new Date(item.scheduled_at).toLocaleString())}` : ''}</p>
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
    poster: $('aPoster').value.trim(),
    banner: $('aBanner').value.trim(),
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
    const eps = (doc.episodes || []).sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
    const el = $('episodeList');
    if (!eps.length) { el.innerHTML = '<p class="muted">No episodes yet. Add your first above.</p>'; return; }
    el.innerHTML = eps.map((ep) => `
      <div class="ep-admin-row">
        <div>
          <strong>S${esc(ep.season)}E${esc(ep.episode)}</strong>${ep.title ? ` — ${esc(ep.title)}` : ''}
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
      $('epNumber').value = ep.episode;
      $('epTitle').value = ep.title || '';
      $('epDuration').value = ep.duration || '';
      if ($('epThumb')) $('epThumb').value = ep.thumbnail || '';
      $('epVideo').value = ep.video_url || '';
      $('epDesc').value = ep.description || '';
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
    season: Number($('epSeason').value) || 1,
    episode: Number($('epNumber').value),
    title: $('epTitle').value.trim(),
    duration: $('epDuration').value.trim(),
    description: $('epDesc').value.trim(),
    thumbnail: ($('epThumb')?.value || '').trim(),
    video_url: rawVideo,
  };

  const introStart = parseTimeInput($('epIntroStart')?.value);
  const introEnd = parseTimeInput($('epIntroEnd')?.value);
  const outroStart = parseTimeInput($('epOutroStart')?.value);
  if ([introStart, introEnd, outroStart].some(Number.isNaN)) return toast('Use times like 1:30 or 90', 'error');
  payload.intro_start = introStart;
  payload.intro_end = introEnd;
  payload.outro_start = outroStart;

  if (!payload.episode) return toast('Episode number required', 'error');
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
    const thumbScope = $('epThumbScope')?.value || 'episode';
    if (thumbScope !== 'episode' && payload.thumbnail) {
      try {
        await applySeasonThumbnail(type, id, thumbScope === 'all' ? 'all' : payload.season, payload.thumbnail);
        toast(thumbScope === 'all' ? 'Thumbnail set on all episodes' : 'Season thumbnail saved');
      } catch (err) {
        toast(err.message || 'Season thumb failed', 'error');
      }
    }
    $('episodeForm').reset();
    if ($('epThumb')) $('epThumb').value = '';
    if ($('epThumbScope')) $('epThumbScope').value = 'episode';
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

async function applySeasonThumbnail(type, id, season, thumbUrl) {
  if (!thumbUrl) return;
  await api(`/api/admin/${type}/${id}/season-thumbnail`, {
    method: "POST",
    body: JSON.stringify({ season: season === 'all' ? 'all' : Number(season), thumbnail: thumbUrl, overwrite: true }),
  });
}

// Standalone thumbnail tools (no need to fill the episode form)
async function runThumbTool(season, url) {
  if (!currentEpisodeTarget) return toast('No content selected', 'error');
  url = (url || '').trim();
  if (!url.startsWith('https://') && !url.startsWith('/assets/')) return toast('Enter a valid thumbnail URL (https://...)', 'error');
  try {
    await applySeasonThumbnail(currentEpisodeTarget.type, currentEpisodeTarget.id, season, url);
    toast(season === 'all' ? 'Thumbnail set on all episodes' : `Season ${season} thumbnail saved`);
    await refreshEpisodeList();
    loadLibrary(true);
  } catch (err) { toast(err.message || 'Failed to set thumbnail', 'error'); }
}
$('thumbAllApply')?.addEventListener('click', () => runThumbTool('all', $('thumbAllUrl').value));
$('thumbSeasonApply')?.addEventListener('click', () => runThumbTool(Number($('thumbSeasonNum').value) || 1, $('thumbSeasonUrl').value));


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


// --- Wikipedia (no API key, CORS-friendly) ---
async function wikiSearch(title) {
  const q = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: title,
    srlimit: "5",
    format: "json",
    origin: "*",
  });
  const res = await fetch("https://en.wikipedia.org/w/api.php?" + q);
  const data = await res.json();
  return (data.query && data.query.search) || [];
}

async function wikiSummary(pageTitle) {
  const url = "https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(pageTitle.replace(/ /g, "_"));
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Wikipedia page not found");
  return res.json();
}

function pickWikiAnimeResult(results, title) {
  if (!results.length) return null;
  const t = (title || "").toLowerCase();
  const scored = results.map((r) => {
    const rt = (r.title || "").toLowerCase();
    let score = 0;
    if (rt === t) score += 10;
    if (rt.includes(t) || t.includes(rt.split("(")[0].trim())) score += 5;
    if (/anime|manga|television|series|film|ova/.test((r.snippet || "").toLowerCase())) score += 3;
    if (/\(tv series\)|\(anime\)|\(manga\)|\(film\)/i.test(r.title || "")) score += 2;
    return { r, score };
  }).sort((a, b) => b.score - a.score);
  return scored[0].r;
}

async function fetchWikipediaForTitle(title) {
  const results = await wikiSearch(title + " anime");
  let hit = pickWikiAnimeResult(results, title);
  if (!hit) {
    const results2 = await wikiSearch(title);
    hit = pickWikiAnimeResult(results2, title) || results2[0];
  }
  if (!hit) throw new Error("No Wikipedia page found");
  const sum = await wikiSummary(hit.title);
  return {
    title: sum.title || hit.title,
    description: (sum.extract || "").trim(),
    poster: (sum.thumbnail && sum.thumbnail.source) || (sum.originalimage && sum.originalimage.source) || "",
    url: (sum.content_urls && sum.content_urls.desktop && sum.content_urls.desktop.page) || "",
  };
}

// --- Wikipedia episode tables (reads the "Episodes" list on the page) ---
const wikiEpisodeCache = {};

async function wikiParsePage(pageTitle) {
  const q = new URLSearchParams({
    action: "parse",
    page: pageTitle,
    prop: "text",
    format: "json",
    formatversion: "2",
    redirects: "1",
    origin: "*",
  });
  const res = await fetch("https://en.wikipedia.org/w/api.php?" + q);
  const data = await res.json();
  if (data.error) throw new Error(data.error.info || "Wikipedia page not found");
  return { title: data.parse.title, html: data.parse.text };
}

function wikiCleanText(node) {
  const c = node.cloneNode(true);
  c.querySelectorAll("sup, .reference, style, .mw-editsection").forEach((n) => n.remove());
  return (c.textContent || "").replace(/\s+/g, " ").trim();
}

function wikiEnglishEpisodeTitle(raw) {
  // Cell looks like: "English Title" Transliteration: "Romaji" (Japanese: ...)
  const quoted = raw.match(/["\u201C]([^"\u201D]+)["\u201D]/);
  if (quoted && quoted[1].trim()) return quoted[1].trim();
  return raw.split(/\s*(?:Transliteration|\(Japanese|Japanese:|\()/)[0].replace(/^["\u201C]|["\u201D]$/g, "").trim();
}

function wikiSeasonForTable(table, fallback) {
  let el = table;
  for (let i = 0; i < 12 && el; i++) {
    el = el.previousElementSibling;
    if (!el) break;
    const isHeading = /^H[2-6]$/.test(el.tagName) || el.classList.contains("mw-heading");
    if (isHeading) {
      const m = (el.textContent || "").match(/season\s*(\d+)/i);
      if (m) return Number(m[1]);
      if (/^H2$/.test(el.tagName) || el.classList.contains("mw-heading2")) break;
    }
  }
  const cap = table.querySelector("caption");
  const cm = cap && (cap.textContent || "").match(/season\s*(\d+)/i);
  return cm ? Number(cm[1]) : fallback;
}

function parseWikiEpisodes(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out = [];
  let tableNo = 0;
  doc.querySelectorAll("table.wikitable").forEach((table) => {
    const rows = Array.from(table.querySelectorAll("tr"));
    if (rows.length < 2) return;
    const heads = Array.from(rows[0].children).map((c) => (c.textContent || "").trim().toLowerCase());
    const titleIdx = heads.findIndex((h) => h.startsWith("title") || h.includes("episode title"));
    if (titleIdx < 0) return;
    tableNo += 1;
    let numIdx = heads.findIndex((h) => /in season|in series|^no\.?\s*in/.test(h));
    if (numIdx < 0) numIdx = heads.findIndex((h) => /^(no|#|ep)/.test(h));
    if (numIdx < 0) numIdx = 0;
    const dateIdx = heads.findIndex((h) => /(release|air|broadcast).*date|date/.test(h));
    const season = wikiSeasonForTable(table, tableNo);

    rows.slice(1).forEach((row, ri) => {
      const cells = Array.from(row.children);
      if (cells.length <= titleIdx) return;
      const num = parseInt((cells[numIdx].textContent || "").replace(/[^\d]/g, ""), 10);
      if (!num) return;
      const title = wikiEnglishEpisodeTitle(wikiCleanText(cells[titleIdx]));
      if (!title) return;
      let airDate = "";
      if (dateIdx >= 0 && cells[dateIdx]) {
        const iso = cells[dateIdx].querySelector(".bday");
        airDate = iso ? iso.textContent.trim() : wikiCleanText(cells[dateIdx]);
      }
      let description = "";
      const next = rows[ri + 2];
      if (next && (next.classList.contains("expand-child") || next.children.length === 1)) {
        const d = next.querySelector("td.description, td");
        if (d) description = wikiCleanText(d);
      }
      out.push({ season, episode: num, title, description, airDate });
    });
  });
  return out;
}

async function getWikiEpisodes(pageTitle) {
  if (wikiEpisodeCache[pageTitle]) return wikiEpisodeCache[pageTitle];
  const page = await wikiParsePage(pageTitle);
  const list = parseWikiEpisodes(page.html);
  wikiEpisodeCache[pageTitle] = list;
  return list;
}

function wikiTitleFromInput(value) {
  const m = (value || "").trim().match(/wikipedia\.org\/wiki\/([^#?]+)/i);
  return m ? decodeURIComponent(m[1]).replace(/_/g, " ") : "";
}

async function fetchWikipediaEpisode(seriesTitle, season, episode, wikiInput) {
  const pages = [];
  const direct = wikiTitleFromInput(wikiInput);
  if (direct) {
    pages.push(direct);
  } else {
    for (const name of [`List of ${seriesTitle} episodes`, seriesTitle]) {
      try { (await wikiSearch(name)).slice(0, 3).forEach((r) => pages.push(r.title)); } catch (e) { /* try next */ }
    }
  }
  const tried = new Set();
  let lastErr = null;
  let listed = 0;
  for (const p of pages) {
    if (tried.has(p)) continue;
    tried.add(p);
    try {
      const list = await getWikiEpisodes(p);
      if (!list.length) continue;
      listed = Math.max(listed, list.length);
      const seasons = new Set(list.map((e) => e.season));
      const hit = list.find((e) => e.season === season && e.episode === episode)
        || (seasons.size === 1 ? list.find((e) => e.episode === episode) : null);
      if (hit) return { ...hit, source: p, total: list.length };
    } catch (e) { lastErr = e; }
  }
  if (listed) {
    throw new Error(`Season ${season} episode ${episode} isn't in that Wikipedia list (it lists ${listed} episodes).`);
  }
  throw lastErr || new Error(
    direct
      ? "No episode table with titles found on that Wikipedia page"
      : "No episode list found. Paste the Wikipedia link in the box above the button."
  );
}

async function autoFetchWikipediaAnime() {
  const title = ($("aTitle")?.value || "").trim();
  if (!title) return toast("Enter a title first", "error");
  const btn = $("aWikiFetch");
  if (btn) { btn.disabled = true; btn.textContent = "Fetching Wikipedia…"; }
  try {
    toast("Fetching from Wikipedia…");
    const data = await fetchWikipediaForTitle(title);
    if (data.description && $("aDesc")) $("aDesc").value = data.description;
    if (data.poster && $("aPoster") && !$("aPoster").value) $("aPoster").value = data.poster;
    if (data.poster && $("aBanner") && !$("aBanner").value) $("aBanner").value = data.poster;
    toast("Wikipedia: " + (data.title || "description filled"));
  } catch (err) {
    toast(err.message || "Wikipedia fetch failed", "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Fetch description from Wikipedia"; }
  }
}

async function autoFetchWikipediaEpisode() {
  if (!currentEpisodeTarget) return toast("Open Manage Episodes first", "error");
  const title = currentEpisodeTarget.title || ($("aTitle")?.value || "");
  const ep = Number($("epNumber")?.value) || 1;
  const season = Number($("epSeason")?.value) || 1;
  const urlBox = $("epWikiUrl");
  if (urlBox && !urlBox.value.trim()) {
    try { urlBox.value = sessionStorage.getItem("anicore-wiki-url") || ""; } catch (e) {}
  }
  const wikiInput = (urlBox?.value || "").trim();
  const btn = $("epWikiFetch");
  if (btn) { btn.disabled = true; btn.textContent = "Fetching Wikipedia…"; }
  try {
    toast("Fetching from Wikipedia…");
    const data = await fetchWikipediaEpisode(title, season, ep, wikiInput);
    if (wikiInput) { try { sessionStorage.setItem("anicore-wiki-url", wikiInput); } catch (e) {} }
    if (data.title && $("epTitle")) $("epTitle").value = data.title;
    if (data.description && $("epDesc")) $("epDesc").value = data.description.slice(0, 2000);
    toast(`Episode ${ep}: ${data.title}`);
  } catch (err) {
    toast(err.message || "Wikipedia fetch failed", "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Fetch ep name from Wikipedia"; }
  }
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
    if (!desc || desc.length < 80) {
      try {
        const wiki = await fetchWikipediaForTitle(name || title);
        if (wiki.description) desc = wiki.description;
        if (wiki.poster && !$("aPoster")?.value) {
          if ($("aPoster")) $("aPoster").value = wiki.poster;
        }
      } catch (e) { /* optional */ }
    }
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
    if (btn) { btn.disabled = false; btn.textContent = "Auto-fetch title info (name, description, poster)"; }
  }
}


function getTmdbKey() {
  try { return (localStorage.getItem("anicore_tmdb_key") || "").trim(); } catch (e) { return ""; }
}

function setTmdbKey(key) {
  try { localStorage.setItem("anicore_tmdb_key", (key || "").trim()); } catch (e) {}
}

async function tmdbFetch(path, params = {}) {
  const key = getTmdbKey();
  if (!key) throw new Error("Add a TMDB API key first (Admin form → Save key)");
  const q = new URLSearchParams({ api_key: key, language: "en-US", ...params });
  const res = await fetch(`https://api.themoviedb.org/3${path}?${q}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.status_message || `TMDB error (${res.status})`);
  }
  return data;
}

async function autoFetchEpisodeMeta() {
  if (!currentEpisodeTarget) return toast("Open Manage Episodes from a title first", "error");
  const title = currentEpisodeTarget.title || ($("aTitle")?.value || "");
  const ep = Number($("epNumber")?.value) || 0;
  const season = Number($("epSeason")?.value) || 1;
  if (!ep) return toast("Enter episode number first", "error");
  const btn = $("epAutoFetch");
  if (btn) { btn.disabled = true; btn.textContent = "Fetching…"; }

  try {
    const key = getTmdbKey();
    if (key) {
      toast("Fetching episode from TMDB…");
      // Search TV show
      let tmdbId = currentEpisodeTarget.tmdb_id || state._lastTmdbId || 0;
      if (!tmdbId) {
        const search = await tmdbFetch("/search/tv", { query: title || "" });
        const row = (search.results || [])[0];
        if (!row) throw new Error("No TV show found on TMDB for that title");
        tmdbId = row.id;
      }
      state._lastTmdbId = tmdbId;
      currentEpisodeTarget.tmdb_id = tmdbId;

      const data = await tmdbFetch(`/tv/${tmdbId}/season/${season}/episode/${ep}`);
      if (data.name && $("epTitle")) $("epTitle").value = data.name;
      if (data.overview && $("epDesc")) $("epDesc").value = data.overview;
      if (data.runtime && $("epDuration")) $("epDuration").value = data.runtime + "m";
      if (data.still_path && $("epThumb")) {
        $("epThumb").value = "https://image.tmdb.org/t/p/w500" + data.still_path;
      }
      toast(data.name ? ("Episode: " + data.name) : "Episode details filled");
      return;
    }

    // Fallback: Anilist (often has titles, rarely full descriptions)
    toast("No TMDB key — trying Anilist (titles only)…");
    let anilistId = state._lastAnilistId || currentEpisodeTarget.anilist_id || 0;
    if (!anilistId) {
      try { anilistId = Number(sessionStorage.getItem("anicore-anilist-id") || 0); } catch (e) {}
    }
    let m = null;
    if (anilistId) {
      const q = `query ($id: Int) { Media(id: $id, type: ANIME) { id duration coverImage { large } streamingEpisodes { title thumbnail } } }`;
      const data = await anilistGraphQL(q, { id: anilistId });
      m = data && data.Media;
    } else {
      const q = `query ($search: String) { Media(search: $search, type: ANIME, sort: SEARCH_MATCH) { id duration coverImage { large } streamingEpisodes { title thumbnail } } }`;
      const data = await anilistGraphQL(q, { search: title || "" });
      m = data && data.Media;
    }
    if (!m) throw new Error("Not found. Add a free TMDB API key for episode name & description.");
    state._lastAnilistId = m.id;
    const streams = m.streamingEpisodes || [];
    const hit = streams[ep - 1] || null;
    if (hit && hit.title && $("epTitle")) $("epTitle").value = hit.title;
    if (m.duration && $("epDuration")) $("epDuration").value = m.duration + "m";
    if (hit && hit.thumbnail && $("epThumb")) $("epThumb").value = hit.thumbnail;
    toast(hit
      ? ("Title only (Anilist). For description, add TMDB API key.")
      : "Limited data. Add TMDB API key for full episode name & description.");
  } catch (err) {
    toast(err.message || "Could not fetch episode", "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Auto-fetch ep name, duration and description"; }
  }
}

// --- Theme buttons ---
$('themeToggle')?.addEventListener('click', toggleTheme);
$('themeToggleMobile')?.addEventListener('click', toggleTheme);

// Media uploads + auto-fetch
$("aAutoFetch")?.addEventListener("click", autoFetchAnimeMeta);
$("aWikiFetch")?.addEventListener("click", autoFetchWikipediaAnime);
$("epAutoFetch")?.addEventListener("click", autoFetchEpisodeMeta);
$("epWikiFetch")?.addEventListener("click", autoFetchWikipediaEpisode);
(function wireMetaKey() {
  const input = $("metaApiKey");
  if (input) input.value = getTmdbKey();
  $("metaApiKeySave")?.addEventListener("click", () => {
    setTmdbKey(input?.value || "");
    toast(getTmdbKey() ? "TMDB API key saved on this device" : "API key cleared");
  });
})();




// ===================== Hero banner =====================
const hero = { items: [], index: 0, timer: null, bgFlip: false, swiped: false, sx: 0, sy: 0 };
let heroSeriesItems = [];
let heroMovieItems = [];

function heroTypeLabel(t) {
  return t === 'movie' ? 'Movie' : 'Series';
}

function heroInfoHtml(item) {
  const eps = Array.isArray(item.episodes) ? item.episodes : [];
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
    const eps = [...(full.episodes || [])].sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
    const ep = eps.find((e) => e.video_url);
    if (!ep) { openDetail(type, item._id, item); return; }
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
        openDetail(it._type, it._id, it);
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

// ===================== AC intro =====================
(function initSplash() {
  const el = document.getElementById('splash');
  if (!el) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { el.remove(); return; }
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    try { sessionStorage.setItem('anicore-splash', '1'); } catch (e) {}
    el.classList.add('out');
    setTimeout(() => el.remove(), 450);
  };
  document.getElementById('splashSkip')?.addEventListener('click', finish);
  setTimeout(finish, 3300);
})();


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
    window.tgHaptic = (type) => {
      try {
        if (!TG.HapticFeedback) return;
        if (type === "success") TG.HapticFeedback.notificationOccurred("success");
        else if (type === "error") TG.HapticFeedback.notificationOccurred("error");
        else if (type === "light") TG.HapticFeedback.impactOccurred("light");
        else TG.HapticFeedback.selectionChanged();
      } catch (e) {}
    };

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
    const d = location.hash.match(/^#\/detail\/([a-z_]+)\/([A-Za-z0-9_-]+)$/);
    const pg = location.hash.match(/^#\/([a-z]+)$/);
    const page = d ? 'detail' : (pg && PAGE_ORDER.includes(pg[1]) ? pg[1] : 'home');
    history.replaceState({
      key: d ? `detail:${d[1]}:${d[2]}` : page, idx: 0, page,
      detailType: d ? d[1] : null, detailId: d ? d[2] : null,
    }, '', location.href);
  } catch (e) { /* noop */ }
  applyTheme('dark');
  applyAccent(state.accent);
  applyLanguage(state.language);
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
      openDetail(saved.detailType, saved.detailId);
    } else if (PAGE_ORDER.includes(saved.page) && saved.page !== 'video') {
      showPage(saved.page);
    }
  }

  await loadGenres();
  loadHome();
  loadContinueWatching();
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

async function loadProfileActivity() {
  if (!state.user) return;
  try {
    const data = await api("/api/users/me/activity");
    const box = $("profileActivity");
    if (!box) return;
    const rows = [];
    (data.progress || []).slice(0, 5).forEach((p) => {
      rows.push(`<div class="activity-item">▶ Continue S${p.season || 1}E${p.episode || 1} · ${esc(p.content_type)} · ${Math.round(p.progress_percent || 0)}%</div>`);
    });
    (data.ratings || []).slice(0, 5).forEach((r) => {
      rows.push(`<div class="activity-item">★ Rated ${esc(r.rating)}/10 · ${esc(r.content_type)}</div>`);
    });
    (data.requests || []).slice(0, 3).forEach((r) => {
      rows.push(`<div class="activity-item">✉ Request: <strong>${esc(r.title)}</strong> · ${esc(r.status)}</div>`);
    });
    if (!rows.length) {
      box.innerHTML = `<p class="muted">No recent activity yet.</p>`;
    } else {
      box.innerHTML = rows.join("");
    }
    // Prefs
    const prefs = data.prefs || {};
    applyTheme('dark');
    if (prefs.accent) applyAccent(prefs.accent);
    if (prefs.language) applyLanguage(prefs.language);
  } catch { /* ignore */ }
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
  const accent = $("profileAccent")?.value || state.accent;
  const language = $("profileLang")?.value || state.language;
  try {
    await api("/api/users/me/prefs", {
      method: "PUT",
      body: JSON.stringify({ theme, accent, language }),
    });
    applyTheme(theme);
    applyAccent(accent);
    applyLanguage(language);
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

async function submitBulkEpisodes(e) {
  e.preventDefault();
  const content_type = $("bulkEpType")?.value || "anime";
  const content_id = $("bulkEpContent")?.value;
  const text = ($("bulkEpText")?.value || "").trim();
  const msg = $("bulkEpMsg");
  if (!content_id || !text) {
    if (msg) msg.textContent = "Select a title and paste episode lines.";
    return;
  }
  const episodes = [];
  text.split("\n").forEach((line) => {
    const parts = line.split("|").map((s) => s.trim());
    if (parts.length < 2) return;
    const season = Number(parts[0]) || 1;
    const episode = Number(parts[1]);
    if (!episode) return;
    episodes.push({
      season,
      episode,
      title: parts[2] || "",
      video_url: parts[3] || "",
      duration: parts[4] || "",
      description: parts[5] || "",
    });
  });
  if (!episodes.length) {
    if (msg) msg.textContent = "No valid episode lines found.";
    return;
  }
  try {
    if (msg) msg.textContent = "Saving…";
    const res = await api("/api/admin/bulk-episodes", {
      method: "POST",
      body: JSON.stringify({ content_type, content_id, episodes }),
    });
    if (msg) msg.textContent = res.message;
    toast(res.message);
    $("bulkEpText").value = "";
  } catch (err) {
    if (msg) msg.textContent = err.message;
    toast(err.message, "err");
  }
}

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

function applyBackground(url) {
  const root = document.documentElement;
  const clean = typeof url === 'string' && /^(https:\/\/|\/api\/users\/me\/background)/.test(url) ? url : '';
  if (clean) root.style.setProperty('--user-bg', `url("${clean.replace(/["\\()\s]/g, (c) => encodeURIComponent(c))}")`);
  else root.style.removeProperty('--user-bg');
  try {
    if (clean) localStorage.setItem('anicore-bg', clean);
    else localStorage.removeItem('anicore-bg');
  } catch (e) { /* storage unavailable */ }
  const input = $('bgUrl');
  if (input && document.activeElement !== input) input.value = clean && clean.startsWith('https://') ? clean : '';
}

// Paint the remembered background immediately (cleared again if the session turns out to be signed out).
try { const saved = localStorage.getItem('anicore-bg'); if (saved) applyBackground(saved); } catch (e) { /* noop */ }

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
    showPage('search');
    const gs = $('globalSearch');
    if (gs) { gs.value = q; runGlobalSearch(); }
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
  const buzz = (kind = 'light') => {
    try {
      const h = window.Telegram?.WebApp?.HapticFeedback;
      if (h) { h.impactOccurred(kind); return; }
      navigator.vibrate?.(8);
    } catch (e) { /* noop */ }
  };
  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const DAY = 864e5;

  // ---------- 1. Haptics on taps ----------
  document.addEventListener('click', (e) => {
    if (e.target.closest('.bottom-nav button, .header-icon-btn, #signInBtn, .media-card, .so-result, .genre-chip, .fx-btn, .fx-chip')) buzz('light');
  }, true);

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

  // ---------- 4. Pull-to-refresh on Home ----------
  const ptr = el('div', 'ptr', '<span class="ptr-spin"></span>');
  document.body.appendChild(ptr);
  let py = 0, pdy = 0, pulling = false, refreshing = false;
  document.addEventListener('touchstart', (e) => {
    if (state.page !== 'home' || window.scrollY > 0 || refreshing || e.touches.length !== 1) return;
    if (e.target.closest('.hero, .media-grid.horizontal, .top-row, .home-genre-chips, #searchOverlay')) return;
    py = e.touches[0].clientY; pdy = 0; pulling = true;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    pdy = e.touches[0].clientY - py;
    if (pdy <= 0) { ptr.style.transform = ''; ptr.style.opacity = '0'; return; }
    const d = Math.min(pdy * 0.5, 80);
    ptr.style.opacity = String(Math.min(d / 50, 1));
    ptr.style.transform = `translate(-50%, ${d}px) rotate(${d * 4}deg)`;
  }, { passive: true });
  document.addEventListener('touchend', () => {
    if (!pulling) return; pulling = false;
    if (pdy * 0.5 >= 56) {
      refreshing = true; buzz('medium');
      ptr.classList.add('spinning'); ptr.style.transform = 'translate(-50%, 56px)'; ptr.style.opacity = '1';
      ROW_IDS.forEach((id) => { const g = $(id); if (g) g.innerHTML = ''; });
      skeletonRows();
      try { showPage('home'); } catch (e) { /* noop */ }
      setTimeout(() => { ptr.classList.remove('spinning'); ptr.style.transform = ''; ptr.style.opacity = '0'; refreshing = false; }, 1100);
    } else { ptr.style.transform = ''; ptr.style.opacity = '0'; }
    pdy = 0;
  }, { passive: true });

  // ---------- 5. Empty states + card data + NEW badges (wrap renderGrid) ----------
  const EMPTY_ICON = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="10" y="14" width="44" height="34" rx="6"/><path d="M22 54h20M32 48v6"/><path d="M24 28l6 6M30 28l-6 6M38 31h6"/></svg>';
  function addBadge(card, it, type) {
    const now = Date.now();
    const upd = Date.parse(it.updated_at || ''), cre = Date.parse(it.created_at || '');
    let label = '';
    if (type !== 'movie' && upd && now - upd < DAY) label = 'NEW EP';
    else if (cre && now - cre < 7 * DAY) label = 'NEW';
    if (!label) return;
    const b = el('span', 'new-badge' + (label === 'NEW EP' ? ' ep' : ''), label);
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
    renderStats(counts.all);
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

  // ---------- 9. Stats card on profile ----------
  function renderStats(titles) {
    const member = $('profileMember'); if (!member || member.classList.contains('hidden')) return;
    let panel = $('statsPanel');
    if (!panel) { panel = el('div', 'panel'); panel.id = 'statsPanel'; member.insertBefore(panel, member.firstChild); }
    const seen = seenMap(); let eps = 0; Object.values(seen).forEach((a) => { eps += a.length; });
    const hours = Math.round((eps * 24) / 6) / 10;
    const gc = LS.get('anicore_genres', {}); const top = Object.entries(gc).sort((a, b) => b[1] - a[1])[0];
    const days = new Set(LS.get('anicore_days', [])); let streak = 0; const d = new Date();
    if (!days.has(d.toISOString().slice(0, 10))) d.setDate(d.getDate() - 1);
    while (days.has(d.toISOString().slice(0, 10))) { streak++; d.setDate(d.getDate() - 1); }
    panel.innerHTML = `<h3>Your stats</h3><div class="stat-cards">
      <div class="stat-card"><b>${eps}</b><span>Episodes watched</span></div>
      <div class="stat-card"><b>~${hours}h</b><span>Watch time</span></div>
      <div class="stat-card"><b>${streak}🔥</b><span>Day streak</span></div>
      <div class="stat-card"><b>${titles || 0}</b><span>In watchlist</span></div>
      <div class="stat-card wide"><b>${top ? esc(top[0]) : '—'}</b><span>Favourite genre</span></div></div>`;
  }

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

  // ---------- 13. Avatar presets ----------
  const PRESETS = [['😺', '#ff3f82'], ['🦊', '#f97316'], ['🐼', '#64748b'], ['🐉', '#16a34a'], ['👻', '#8b5cf6'], ['🌸', '#ec4899'], ['⚡', '#eab308'], ['🔥', '#ef4444']];
  function presetDataUrl(emoji, color) {
    const c = document.createElement('canvas'); c.width = c.height = 320; const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 320, 320); grad.addColorStop(0, color); grad.addColorStop(1, '#14101c');
    g.fillStyle = grad; g.fillRect(0, 0, 320, 320);
    g.font = '170px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(emoji, 160, 176);
    return c.toDataURL('image/jpeg', 0.85);
  }
  const origRenderProfileCard = renderProfileCard;
  renderProfileCard = function (editing = false) {
    origRenderProfileCard(editing);
    if (!editing) return;
    const form = $('profileEditForm'); if (!form || form.querySelector('.avatar-presets')) return;
    const box = el('div', 'avatar-presets'); box.appendChild(el('div', 'fx-group-label', 'Or pick an avatar'));
    const row = el('div', 'avatar-preset-row');
    PRESETS.forEach(([emoji, color]) => {
      const b = el('button', 'avatar-preset', emoji); b.type = 'button'; b.style.background = `linear-gradient(135deg, ${color}, #14101c)`;
      b.addEventListener('click', async () => {
        try { toast('Saving…'); await saveAvatar({ data: presetDataUrl(emoji, color) }); renderProfileCard(true); toast('Avatar updated'); } catch (err) { toast(err.message, 'error'); }
      });
      row.appendChild(b);
    });
    box.appendChild(row);
    form.querySelector('.bg-actions')?.insertAdjacentElement('beforebegin', box);
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
            const latest = [...(d.episodes || [])].sort((a, b) => (b.season - a.season) || (b.episode - a.episode))[0];
            fresh.push({ type: w.content_type, id: w.content_id, title: w.title || d.title, poster: w.poster || d.poster, label: latest ? `S${latest.season} · E${latest.episode} is out` : 'New episode' });
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
    bar.querySelector('.mini-title').textContent = `${videoContext.contentTitle} · E${ep ? ep.episode : ''}`;
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
    video.addEventListener('ended', () => {
      if (!LS.get('anicore_autonext', true)) return;
      const idx = nextPlayableIndex(); if (idx === -1 || wrap.querySelector('.player-next')) return;
      const nx = videoContext.episodes[idx];
      const box = el('div', 'player-next', `<p>Up next</p><strong></strong><span class="player-next-count"></span><div class="player-next-actions"><button type="button" class="outline small" data-act="cancel">Cancel</button><button type="button" class="primary small" data-act="now">Play now</button></div>`);
      box.querySelector('strong').textContent = `S${nx.season} · E${nx.episode}${nx.title ? ' — ' + nx.title : ''}`;
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
