'use strict';

const $ = (id) => document.getElementById(id);
const BOOT_NAV = (() => {
  try { return JSON.parse(sessionStorage.getItem('anicore-nav') || 'null'); } catch (e) { return null; }
})();
const PLACEHOLDER = 'https://placehold.co/400x600/17101e/ffffff?text=ANICORE';
const PAGE_SIZE = 20;
const APP_JS_VERSION = 'v13';

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
  deferredInstall: null,
};

// videoContext = { type, contentId, contentTitle, episodes: [...], currentIndex: 0 }
let videoContext = null;

const PAGE_ORDER = ['home', 'search', 'series', 'movies', 'profile', 'admin', 'detail', 'video'];

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
    continue: "Continue Watching", activity: "Your Activity", preferences: "Preferences",
    signIn: "Sign In", logout: "Logout", save: "Save Preferences",
  },
  hi: {
    home: "होम", search: "खोजें", series: "सीरीज़", anime: "एनिमे", tv: "टीवी शो", movies: "फ़िल्में",
    profile: "प्रोफ़ाइल", admin: "एडमिन", recommended: "आपके लिए सुझाव",
    continue: "देखना जारी रखें", activity: "आपकी गतिविधि", preferences: "प्राथमिकताएँ",
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

function safeUrl(url) {
  return /^https?:\/\//i.test(url || '') ? url : '';
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
}

function errorText(data) {
  if (!data) return '';
  const d = data.detail ?? data.message;
  if (Array.isArray(d)) return d.map((e) => e.msg).join('. ');
  return typeof d === 'string' ? d : '';
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) throw new Error(errorText(data) || `Request failed (${res.status})`);
  return data;
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


function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
  localStorage.setItem('anicore-theme', theme);
  const meta = $('themeColorMeta');
  if (meta) meta.content = theme === 'light' ? '#f4f2f8' : '#09090f';
}

function toggleTheme() {
  applyTheme(state.theme === 'dark' ? 'light' : 'dark');
}

// --- Navigation ---

function movePill(animate = true) {
  const pill = $('navPill');
  if (!pill) return;
  const active = document.querySelector('.bottom-nav button.active');
  if (!active) { pill.style.opacity = '0'; return; }
  if (!animate) pill.style.transition = 'none';
  pill.style.width = `${active.offsetWidth}px`;
  pill.style.transform = `translateX(${active.offsetLeft}px)`;
  pill.style.opacity = '1';
  if (!animate) { void pill.offsetWidth; pill.style.transition = ''; }
}
window.addEventListener('resize', () => movePill(false));


function saveNavState() {
  try {
    sessionStorage.setItem("anicore-nav", JSON.stringify({
      page: state.page,
      detailId: state.detailId,
      detailType: state.detailType,
    }));
  } catch (e) {}
}

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
  if (page === 'admin' && state.user?.role !== 'admin') page = 'home';
  const target = $(`page-${page}`);
  if (!target) return;

  // Leaving video → cleanup
  if (state.page === 'video' && page !== 'video') {
    clearPlayer();
    videoContext = null;
  }

  const dir = PAGE_ORDER.indexOf(page) >= PAGE_ORDER.indexOf(state.page) ? 'from-right' : 'from-left';
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p === target));
  target.classList.remove('from-left', 'from-right');
  void target.offsetWidth;
  if (page !== state.page) target.classList.add(dir);
  state.page = page;
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
  if (page === 'home' && loadRecommendations()) {
    loadHome();
    loadContinueWatching();
  }
  if (page === 'profile') { loadProfileActivity(); } loadProfile();
  if (page === 'admin') {
    loadAdminRequests();
    loadLibrary(true);
    loadAdminStats();
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
window.addEventListener('scroll', () => {
  const y = window.scrollY;
  if (Math.abs(y - lastScrollY) < 8) return;
  $('bottomNav')?.classList.toggle('hidden-nav', y > lastScrollY && y > 100);
  lastScrollY = y;
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
    const progress = item.progress_percent
      ? `<div class="progress-bar"><span style="width:${Math.min(100, item.progress_percent)}%"></span></div>`
      : '';
    const sub = item._continue
      ? `▶ Resume S${item.season || 1} · E${item.episode || 1}`
      : (rating || (item.year ? String(item.year) : (item.status || '')));

    card.innerHTML = `
      <div class="poster-wrap">
        <img loading="lazy" alt="">
        ${progress}
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
      if (item._continue) { requestAnimationFrame(() => resumeWatching(item)); return; }
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

async function loadHome() {
  showSkeleton('homeSeriesGrid', 8);
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
  } catch {
    const g = $('homeSeriesGrid');
    if (g) g.innerHTML = '<p class="muted empty">Failed to load. Please refresh.</p>';
  }

  try {
    const data = await api('/api/movies?page=1&limit=10&sort=views');
    const items = Array.isArray(data) ? data : data.items || [];
    renderGrid($('homeMovieGrid'), items, 'movie');
  } catch {
    const g = $('homeMovieGrid');
    if (g) g.innerHTML = '<p class="muted empty">Failed to load. Please refresh.</p>';
  }
}

async function loadContinueWatching() {
  const section = $('continueSection');
  if (!state.user) { section?.classList.add('hidden'); return; }
  try {
    const items = await api('/api/continue-watching');
    if (!items.length) { section?.classList.add('hidden'); return; }
    section?.classList.remove('hidden');
    const mapped = items.map((i) => ({
      ...i, _id: i.content_id, _type: i.content_type, progress_percent: i.progress_percent, _continue: true,
    }));
    renderGrid($('continueGrid'), mapped, 'anime');
  } catch {
    section?.classList.add('hidden');
  }
}

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
  $('adminBtn')?.classList.toggle('hidden', u?.role !== 'admin');
  $('sideSignIn')?.classList.toggle('hidden', !!u);
  $('sideLogout')?.classList.toggle('hidden', !u);
  $('sideAdminBtn')?.classList.toggle('hidden', u?.role !== 'admin');
}

async function checkUser() {
  try {
    const res = await api('/api/auth/me');
    state.user = res.authenticated ? { email: res.email, role: res.role || 'user' } : null;
  } catch { state.user = null; }
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
    state.user = null;
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

async function loadProfile() {
  const info = $('profileInfo');
  const member = $('profileMember');

  if (!state.user) {
    info.innerHTML = '<div class="panel profile-panel"><p class="muted">Sign in to see your profile and watchlist.</p><button class="primary" type="button" id="profileSignIn">Sign In</button></div>';
    $('profileSignIn')?.addEventListener('click', () => openAuth('login'));
    member?.classList.add('hidden');
    return;
  }

  info.innerHTML = `
    <div class="panel profile-panel">
      <div class="profile-avatar">${esc(state.user.email.charAt(0).toUpperCase())}</div>
      <h3>${esc(state.user.email)}</h3>
      <p class="muted">Role: ${esc(state.user.role)}</p>
    </div>`;
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

function seasonThumb(episodes, season) {
  const hit = (episodes || []).find((e) => Number(e.season) === Number(season) && safeUrl(e.thumbnail));
  return hit ? safeUrl(hit.thumbnail) : '';
}

function episodesHtml(episodes, type, contentId) {
  if (!episodes?.length) return '';
  const sorted = [...episodes].sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
  const seasons = [...new Set(sorted.map((e) => e.season))];
  const epHtml = (ep) => {
    const thumb = safeUrl(ep.thumbnail) || '';
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

function reviewsHtml(reviews) {
  if (!reviews?.length) return '<p class="muted">No reviews yet.</p>';
  return reviews.map((r) => `
    <div class="review-card">
      <strong>${esc(r.username)}</strong>
      <span class="stars-display">${'★'.repeat(Math.round(r.rating))}${'☆'.repeat(10 - Math.round(r.rating))} ${r.rating}/10</span>
      <small class="muted"> · ${esc(fmtDate(r.updated_at || r.created_at))}</small>
      ${r.review ? `<p>${esc(r.review)}</p>` : ''}
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

function ratingWidget(item, type) {
  if (!state.user) return '<p class="muted small-muted">Sign in to rate this title.</p>';
  const current = item.my_rating?.rating || 0;
  let stars = '';
  for (let i = 1; i <= 10; i++) {
    stars += `<button type="button" data-val="${i}" class="${i <= current ? 'active' : ''}" aria-label="Rate ${i}">★</button>`;
  }
  return `
    <div class="rating-box">
      <div class="rating-box-title">Your Rating</div>
      <div class="stars stars-sm" id="ratingStars">${stars}</div>
      <textarea id="reviewText" class="review-sm" rows="2" maxlength="2000" placeholder="Optional short review...">${esc(item.my_rating?.review || '')}</textarea>
      <button type="button" class="outline small" id="saveRating">Save</button>
    </div>`;
}

function buildDetailHtml(type, item, comments, reviews) {
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
    ${episodesHtml(item.episodes, type, item._id)}
    <div class="detail-actions">
      <button class="primary ${item.in_watchlist ? 'saved' : ''}" id="wlBtn" type="button">${item.in_watchlist ? '♥ In Watchlist' : '♡ Add to Watchlist'}</button>
    </div>
    ${ratingWidget(item, type)}
    <h3>Reviews</h3>
    <div id="reviewList">${reviewsHtml(reviews)}</div>
    <h3>Comments</h3>
    ${state.user
      ? `<form id="commentForm"><textarea id="commentText" rows="2" maxlength="1000" placeholder="Write a comment..." required></textarea><button class="outline block" type="submit">Post Comment</button></form>`
      : '<p class="muted">Sign in to comment.</p>'}
    <div id="commentList">${comments ? commentsHtml(comments) : ''}</div>`;
}

function bindDetailEvents(type, item, container) {
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
      openVideo(type, item._id, item.title, item.episodes, s, e, item.banner || item.poster);
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
        loadContinueWatching();
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  const stars = container.querySelector('#ratingStars');
  let selected = item.my_rating?.rating || 0;
  stars?.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      selected = Number(b.dataset.val);
      stars.querySelectorAll('button').forEach((s) => {
        s.classList.toggle('active', Number(s.dataset.val) <= selected);
      });
    });
  });

  container.querySelector('#saveRating')?.addEventListener('click', async () => {
    if (!selected) return toast('Select a rating first', 'error');
    try {
      const res = await api('/api/ratings', {
        method: 'POST',
        body: JSON.stringify({
          content_type: type, content_id: item._id,
          rating: selected,
          review: container.querySelector('#reviewText')?.value || '',
        }),
      });
      toast('Rating saved!');
      const meta = container.querySelector('#dMeta');
      if (meta) meta.textContent = metaText({ ...item, avg_rating: res.avg_rating, rating_count: res.rating_count, views: item.views });
      const reviews = await api(`/api/ratings/${type}/${item._id}`);
      const list = container.querySelector('#reviewList');
      if (list) list.innerHTML = reviewsHtml(reviews.items);
    } catch (err) { toast(err.message, 'error'); }
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

async function openDetail(type, id, preview) {
  state.detailId = id;
  state.detailType = type;
  saveNavState();

  showPage('detail');
  const contentEl = $('detailPageContent');

  if (preview && contentEl) {
    contentEl.innerHTML = buildDetailHtml(type, preview, null, null);
    bindDetailEvents(type, preview, contentEl);
  } else if (contentEl) {
    contentEl.innerHTML = '<p class="muted">Loading…</p>';
  }

  try {
    const [item, comments, reviews] = await Promise.all([
      api(`/api/content/${type}/${id}`),
      api(`/api/comments/${type}/${id}`),
      api(`/api/ratings/${type}/${id}?limit=10`),
    ]);
    if (state.detailId !== id) return;
    contentEl.innerHTML = buildDetailHtml(type, item, comments, reviews.items);
    bindDetailEvents(type, item, contentEl);
  } catch (err) {
    if (state.detailId !== id) return;
    toast(err.message || 'Failed to load details.', 'error');
    showPage('home');
  }
}

$('detailBack')?.addEventListener('click', () => showPage('home'));

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

function normalizeEmbedUrl(url) {
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

function clearPlayer() {
  const wrap = $('playerWrap');
  if (!wrap) return;
  const video = wrap.querySelector('video');
  if (video) {
    try { video.pause(); } catch { /* noop */ }
    video.removeAttribute('src');
    try { video.load(); } catch { /* noop */ }
  }
  wrap.innerHTML = '';
}

async function mountPlayer(url, posterSrc = '') {
  const wrap = $('playerWrap');
  if (!wrap) return;

  clearPlayer();

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
    video.addEventListener('error', () => {
      fallback?.classList.remove('hidden');
    }, { once: true });

    if (isHls(url)) {
      try {
        const HlsLib = await ensureHls();
        if (HlsLib && HlsLib.isSupported()) {
          const hls = new HlsLib();
          hls.loadSource(url);
          hls.attachMedia(video);
          hls.on(HlsLib.Events.ERROR, (e, data) => {
            if (data?.fatal) fallback?.classList.remove('hidden');
          });
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
  } else {
    const mountIframe = () => {
      wrap.innerHTML = '';
      const iframe = document.createElement('iframe');
      iframe.allowFullscreen = true;
      iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write');
      iframe.setAttribute('referrerpolicy', 'origin');
      iframe.src = normalizeEmbedUrl(url);
      wrap.appendChild(iframe);
    };

    if (posterSrc) {
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

function openVideo(type, contentId, contentTitle, episodes, season, episode, poster) {
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
    const eps = [...(full.episodes || [])].sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
    if (!eps.length) { openDetail(type, id, item); return; }
    let idx = eps.findIndex((e) => Number(e.season) === Number(item.season) && Number(e.episode) === Number(item.episode));
    if (idx === -1) idx = 0;
    // Finished that episode? jump to the next one
    if (Number(item.progress_percent) >= 95 && idx < eps.length - 1) idx += 1;
    const ep = eps[idx];
    state.detailId = id;
    state.detailType = type;
    openVideo(type, id, full.title, eps, ep.season, ep.episode, full.banner || full.poster);
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
    const src = safeUrl(ep.thumbnail) || safeUrl(videoContext.poster) || '';
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
  mountPlayer(ep.video_url, posterSrc);
  updateVideoNav();
  saveWatchProgress(0);
}

function updateVideoNav() {
  const prevBtn = $('videoPrev');
  const nextBtn = $('videoNext');
  if (!prevBtn || !nextBtn) return;
  if (!videoContext) {
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }
  const { episodes, currentIndex } = videoContext;
  const prevEp = currentIndex > 0 ? episodes[currentIndex - 1] : null;
  const nextEp = currentIndex < episodes.length - 1 ? episodes[currentIndex + 1] : null;

  prevBtn.disabled = !prevEp;
  prevBtn.textContent = prevEp ? `← S${prevEp.season}E${prevEp.episode}` : '← Previous';

  nextBtn.disabled = !nextEp;
  nextBtn.textContent = nextEp ? `S${nextEp.season}E${nextEp.episode} →` : 'Next →';
}

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
async function loadLibrary(reset = false) {
  if (reset) libPage = 0;
  const type = $('libType').value;
  const q = $('libSearch').value.trim();
  const endpoint = type === 'anime' ? '/api/anime' : type === 'tv_show' ? '/api/tvshows' : '/api/movies';
  try {
    const data = await api(`${endpoint}?page=${libPage + 1}&limit=20&q=${encodeURIComponent(q)}`);
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
          <p>${esc(item.status || '')} · ${item.year || '—'} · ★ ${item.avg_rating || '—'}</p>
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
        $('adminFormTitle').textContent = 'Edit Content';
        $('aSubmit').textContent = 'Update';
        $('aCancel').classList.remove('hidden');
        $('adminForm').scrollIntoView({ behavior: 'smooth' });
      });
      row.querySelector('.del-btn').addEventListener('click', async () => {
        if (!confirm(`Delete "${item.title}"?`)) return;
        try {
          await api(`/api/admin/content/${type}/${item._id}`, { method: 'DELETE' });
          toast('Deleted');
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
  };

  const btn = $('aSubmit');
  btn.disabled = true;
  try {
    if (id) {
      await api(`/api/admin/content/${type}/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      toast('Updated');
    } else {
      const path = type === 'anime' ? '/api/admin/anime' : type === 'tv_show' ? '/api/admin/tvshows' : '/api/admin/movies';
      await api(path, { method: 'POST', body: JSON.stringify(payload) });
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
  currentEpisodeTarget = { type, id, title };
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
      $('epVideo').value = ep.video_url || '';
      $('epDesc').value = ep.description || '';
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
    video_url: rawVideo,
  };

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

// --- Theme buttons ---
$('themeToggle')?.addEventListener('click', toggleTheme);
$('themeToggleMobile')?.addEventListener('click', toggleTheme);

// --- Snow ---
(function snow() {
  const canvas = $('snow');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let w, h, flakes = [];
  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  function create() {
    flakes = Array.from({ length: Math.min(60, Math.floor(w / 20)) }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      r: Math.random() * 2 + 0.5, s: Math.random() * 1 + 0.3,
    }));
  }
  function draw() {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    flakes.forEach((f) => {
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();
      f.y += f.s;
      f.x += Math.sin(f.y * 0.01) * 0.3;
      if (f.y > h) { f.y = -5; f.x = Math.random() * w; }
    });
    requestAnimationFrame(draw);
  }
  resize();
  create();
  draw();
  window.addEventListener('resize', () => { resize(); create(); });
})();

// --- Init ---
wireSeriesPage();

// Background video
(function initBgVideo() {
  const v = document.getElementById("bgVideo");
  if (!v) return;
  v.muted = true;
  v.playsInline = true;
  const tryPlay = () => v.play().catch(() => {});
  tryPlay();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) tryPlay();
  });
})();

(async function init() {
  applyTheme(state.theme);
  applyAccent(state.accent);
  applyLanguage(state.language);
  if ($('yearNow')) $('yearNow').textContent = new Date().getFullYear();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      console.log('[sw] registered', reg.scope);
    }).catch((err) => {
      console.warn('[sw] registration failed', err);
    });
  }

  await checkUser();

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
  movePill(false);
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
    const params = new URLSearchParams({ q, sort, limit: "30" });
    if (type) params.set("type", type);
    if (genre) params.set("genre", genre);
    const data = await api("/api/search?" + params.toString());
    const items = data.items || [];
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
    searchTimer = setTimeout(runGlobalSearch, 280);
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
    if (prefs.theme) applyTheme(prefs.theme);
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

// PWA install prompt
function wirePWA() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    state.deferredInstall = e;
    if ($("installBanner")) return;
    const bar = document.createElement("div");
    bar.className = "install-banner";
    bar.id = "installBanner";
    bar.innerHTML = `
      <span>Install ANICORE app</span>
      <div>
        <button type="button" class="primary small" id="installBtn">Add to Home Screen</button>
        <button type="button" class="outline small" id="installDismiss">✕</button>
      </div>
    `;
    document.body.appendChild(bar);
    $("installBtn")?.addEventListener("click", async () => {
      if (!state.deferredInstall) return;
      state.deferredInstall.prompt();
      await state.deferredInstall.userChoice;
      state.deferredInstall = null;
      bar.remove();
    });
    $("installDismiss")?.addEventListener("click", () => bar.remove());
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}



// Pause the background video when the tab is hidden (saves battery, smoother scrolling)
document.addEventListener('visibilitychange', () => {
  const bgv = $('bgVideo');
  if (!bgv) return;
  if (document.hidden) bgv.pause();
  else bgv.play().catch(() => {});
});

