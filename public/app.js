'use strict';

const $ = (id) => document.getElementById(id);
const PLACEHOLDER = 'https://placehold.co/400x600/17101e/ffffff?text=ANICORE';
const PAGE_SIZE = 20;
const APP_JS_VERSION = 'v3';

console.log('[anicore] app.js loaded —', APP_JS_VERSION);

const state = {
  user: null,
  authMode: 'login',
  page: 'home',
  detailId: null,
  detailType: null,
  genres: [],
  theme: localStorage.getItem('anicore-theme') || 'dark',
};

const PAGE_ORDER = ['home', 'anime', 'tv', 'movies', 'profile', 'admin', 'detail'];

const LISTS = {
  anime: {
    endpoint: '/api/anime', grid: 'animeGrid', sentinel: 'animeSentinel', empty: 'animeEmpty',
    search: 'animeSearch', genre: 'animeGenre', status: 'animeStatus', sort: 'animeSort', chips: 'animeChips',
    page: 0, total: 0, loading: false, q: '', genreVal: '', statusVal: '', sortVal: 'newest',
  },
  tv_show: {
    endpoint: '/api/tvshows', grid: 'tvGrid', sentinel: 'tvSentinel', empty: 'tvEmpty',
    search: 'tvSearch', genre: 'tvGenre', status: 'tvStatus', sort: 'tvSort', chips: 'tvChips',
    page: 0, total: 0, loading: false, q: '', genreVal: '', statusVal: '', sortVal: 'newest',
  },
  movie: {
    endpoint: '/api/movies', grid: 'movieGrid', sentinel: 'movieSentinel', empty: 'movieEmpty',
    search: 'movieSearch', genre: 'movieGenre', status: 'movieStatus', sort: 'movieSort', chips: 'movieChips',
    page: 0, total: 0, loading: false, q: '', genreVal: '', statusVal: '', sortVal: 'newest',
  },
};

const PAGE_TYPES = { anime: 'anime', tv: 'tv_show', movies: 'movie' };

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

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : '');
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

function showPage(page) {
  if (page === 'admin' && state.user?.role !== 'admin') page = 'home';
  const target = $(`page-${page}`);
  if (!target) return;

  const dir = PAGE_ORDER.indexOf(page) >= PAGE_ORDER.indexOf(state.page) ? 'from-right' : 'from-left';
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p === target));
  target.classList.remove('from-left', 'from-right');
  void target.offsetWidth;
  if (page !== state.page) target.classList.add(dir);
  state.page = page;

  document.querySelectorAll('.bottom-nav button, .side-nav button').forEach((b) => {
    b.classList.toggle('active', b.dataset.page === page);
  });
  movePill();
  $('sidebar')?.classList.remove('open');

  const type = PAGE_TYPES[page];
  if (type && !LISTS[type].page) loadList(type, true);
  if (page === 'home') {
    loadHome();
    loadContinueWatching();
  }
  if (page === 'profile') loadProfile();
  if (page === 'admin') {
    loadAdminRequests();
    loadLibrary(true);
    loadAdminStats();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
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

    card.innerHTML = `
      <div class="poster-wrap">
        <img loading="lazy" alt="">
        ${progress}
      </div>
      <div class="media-info">
        <h3></h3>
        <p>${rating || (item.views ? `${item.views} views` : (item.year || ''))}</p>
      </div>`;

    const img = card.querySelector('img');
    img.src = safeUrl(item.poster) || PLACEHOLDER;
    img.alt = item.title || '';
    img.addEventListener('error', () => { img.src = PLACEHOLDER; }, { once: true });

    card.querySelector('h3').textContent = item.title || 'Untitled';

    const open = () => openDetail(item._type || type, item._id || item.content_id, item);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    frag.appendChild(card);
  });
  grid.appendChild(frag);
}

async function loadHome() {
  showSkeleton('homeAnimeGrid', 6);
  showSkeleton('homeTvGrid', 6);
  showSkeleton('homeMovieGrid', 6);

  const jobs = [
    ['anime', 'homeAnimeGrid', '/api/anime'],
    ['tv_show', 'homeTvGrid', '/api/tvshows'],
    ['movie', 'homeMovieGrid', '/api/movies'],
  ];
  await Promise.all(jobs.map(async ([type, gridId, endpoint]) => {
    try {
      const data = await api(`${endpoint}?page=1&limit=10&sort=views`);
      renderGrid($(gridId), data.items, type);
    } catch {
      $(gridId).innerHTML = '<p class="muted empty">Failed to load. Please refresh.</p>';
    }
  }));
}

async function loadContinueWatching() {
  const section = $('continueSection');
  if (!state.user) { section?.classList.add('hidden'); return; }
  try {
    const items = await api('/api/continue-watching');
    if (!items.length) { section?.classList.add('hidden'); return; }
    section?.classList.remove('hidden');
    const mapped = items.map((i) => ({
      ...i, _id: i.content_id, _type: i.content_type, progress_percent: i.progress_percent,
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
Object.entries(LISTS).forEach(([type, l]) => {
  const sentinel = $(l.sentinel);
  if (!sentinel) return;
  observers[type] = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && state.page === Object.keys(PAGE_TYPES).find((k) => PAGE_TYPES[k] === type)) {
      loadList(type);
    }
  }, { rootMargin: '200px' });
  observers[type].observe(sentinel);
});

Object.entries(LISTS).forEach(([type, l]) => {
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
            loadList(Object.keys(LISTS).find((k) => LISTS[k] === l), true);
          });
          chips.appendChild(btn);
        });
      }
    });
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

function episodesHtml(episodes, type, contentId) {
  if (!episodes?.length) return '';
  const sorted = [...episodes].sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
  return `<h3>Episodes</h3><div class="episodes">${sorted.map((ep) => `
    <div class="episode" data-season="${ep.season}" data-episode="${ep.episode}">
      <div class="ep-header">
        <strong>S${esc(ep.season)} · E${esc(ep.episode)}</strong>${ep.title ? ` — ${esc(ep.title)}` : ''}${ep.duration ? `<span class="muted"> · ${esc(ep.duration)}</span>` : ''}
      </div>
      <div class="ep-actions">
        ${ep.video_url ? `<button type="button" class="outline small ep-play"
          data-video="${esc(ep.video_url)}"
          data-title="S${esc(ep.season)}E${esc(ep.episode)}${ep.title ? ' — ' + esc(ep.title) : ''}">▶ Watch</button>` : ''}
        ${state.user ? `<button type="button" class="outline small mark-progress"
          data-season="${ep.season}" data-episode="${ep.episode}">Mark watched</button>` : ''}
      </div>
      ${linkList(ep.quality_links)}
    </div>`).join('')}</div>`;
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
    `👁 ${item.views || 0}`,
    item.avg_rating ? `★ ${item.avg_rating} (${item.rating_count || 0})` : null,
    item.rating ? `⭐ ${item.rating}` : null,
    item.year ? `📅 ${item.year}` : null,
    item.status || null,
  ].filter(Boolean);
  return parts.join(' · ');
}

function recapHtml(item) {
  return item.ai_recap ? `<div class="recap"><strong>🤖 AI Recap</strong>${esc(item.ai_recap)}</div>` : '';
}

function ratingWidget(item, type) {
  if (!state.user) return '<p class="muted">Sign in to rate this title.</p>';
  const current = item.my_rating?.rating || 0;
  let stars = '';
  for (let i = 1; i <= 10; i++) {
    stars += `<button type="button" data-val="${i}" class="${i <= current ? 'active' : ''}" aria-label="Rate ${i}">★</button>`;
  }
  return `
    <div class="panel" style="margin-top:16px">
      <h3>Your Rating</h3>
      <div class="stars" id="ratingStars">${stars}</div>
      <textarea id="reviewText" rows="2" maxlength="2000" placeholder="Optional review...">${esc(item.my_rating?.review || '')}</textarea>
      <button type="button" class="outline" id="saveRating">Save Rating</button>
    </div>`;
}

function buildDetailHtml(type, item, comments, reviews) {
  const banner = safeUrl(item.banner) || safeUrl(item.poster);
  const genres = Array.isArray(item.genres) && item.genres.length ? item.genres.join(', ') : '';

  return `
    ${banner ? `<img class="detail-banner" src="${esc(banner)}" alt="">` : ''}
    <h2>${esc(item.title)}</h2>
    <p class="muted meta" id="dMeta">${esc(metaText(item))}</p>
    <p class="desc">${'description' in item ? esc(item.description || 'No description available.') : ''}</p>
    ${genres ? `<p><span class="muted">Genres:</span> ${esc(genres)}</p>` : ''}
    <div id="dRecapSlot">${recapHtml(item)}</div>
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

  container.querySelectorAll('.ep-play').forEach((btn) => {
    btn.addEventListener('click', () => openPlayer(btn.dataset.video, btn.dataset.title));
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

function isDesktop() {
  return window.matchMedia('(min-width: 900px)').matches;
}

async function openDetail(type, id, preview) {
  state.detailId = id;
  state.detailType = type;

  const usePage = isDesktop();
  const contentEl = usePage ? $('detailPageContent') : $('detailContent');

  if (usePage) {
    showPage('detail');
  } else {
    clearTimeout(closeTimer);
    resetSheet();
    $('detailModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

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
    closeDetail();
    toast(err.message || 'Failed to load details.', 'error');
  }
}

let closeTimer;

function resetSheet() {
  const modal = $('detailModal');
  const sheet = $('detailSheet');
  if (!sheet) return;
  sheet.style.transition = '';
  sheet.style.transform = '';
  if (modal) {
    modal.style.transition = '';
    modal.style.background = '';
  }
}

function closeDetail() {
  const modal = $('detailModal');
  if (!modal || modal.classList.contains('hidden')) {
    if (state.page === 'detail') showPage('home');
    return;
  }
  state.detailId = null;
  const sheet = $('detailSheet');
  sheet.style.transition = 'transform .3s cubic-bezier(.32, .72, 0, 1)';
  sheet.style.transform = 'translateY(100%)';
  modal.style.transition = 'background .3s ease';
  modal.style.background = 'rgba(0, 0, 0, 0)';
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    modal.classList.add('hidden');
    resetSheet();
    document.body.style.overflow = '';
  }, 300);
}

$('detailClose')?.addEventListener('click', closeDetail);
$('detailBack')?.addEventListener('click', () => showPage('home'));
$('detailModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'detailModal') closeDetail();
});

function initSheet() {
  const sheet = $('detailSheet');
  if (!sheet) return;
  let startY = 0;
  let currentY = 0;
  sheet.addEventListener('touchstart', (e) => {
    if (sheet.scrollTop > 0) return;
    startY = e.touches[0].clientY;
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (!startY) return;
    currentY = e.touches[0].clientY - startY;
    if (currentY > 0) sheet.style.transform = `translateY(${currentY}px)`;
  }, { passive: true });
  sheet.addEventListener('touchend', () => {
    if (currentY > 120) closeDetail();
    else {
      sheet.style.transition = 'transform .25s ease';
      sheet.style.transform = '';
    }
    startY = 0;
    currentY = 0;
  });
}

// --- Video Player ---
function openPlayer(url, title = 'Now Playing') {
  const modal = $('playerModal');
  if (!modal || !url) return;
  $('playerTitle').textContent = title;
  $('playerOpenLink').href = url;
  $('playerFrame').src = url;
  $('playerFallback').classList.add('hidden');
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  let loaded = false;
  const onLoad = () => { loaded = true; };
  $('playerFrame').addEventListener('load', onLoad, { once: true });
  setTimeout(() => {
    if (!loaded) {
      $('playerFrame').removeEventListener('load', onLoad);
      $('playerFallback').classList.remove('hidden');
    }
  }, 4000);
}

function closePlayer() {
  const modal = $('playerModal');
  if (!modal) return;
  $('playerFrame').src = 'about:blank';
  modal.classList.add('hidden');
  document.body.style.overflow = '';
}

$('playerClose')?.addEventListener('click', closePlayer);
$('playerModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'playerModal') closePlayer();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('playerModal')?.classList.contains('hidden')) closePlayer();
    if (!$('episodesModal')?.classList.contains('hidden')) {
      $('episodesModal').classList.add('hidden');
      currentEpisodeTarget = null;
    }
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

      // Event delegation — attaches to libList, not each button
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

// Event delegation for "Eps" button — survives library re-renders
$('libList')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.ep-btn');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  const type = btn.dataset.type;
  const id = btn.dataset.id;
  const title = btn.dataset.title;
  console.log('[libList] Eps clicked:', { type, id, title });
  openEpisodesModal(type, id, title);
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
  console.log('[episodes] open:', { type, id, title });
  currentEpisodeTarget = { type, id, title };
  $('episodesTitle').textContent = `Episodes — ${title}`;
  $('episodeForm').reset();
  $('epId').value = '';
  $('epSeason').value = 1;
  $('epSubmit').textContent = 'Add Episode';
  $('epCancel').classList.add('hidden');
  $('episodesModal').classList.remove('hidden');
  console.log('[episodes] modal shown:', !$('episodesModal').classList.contains('hidden'));
  refreshEpisodeList();
}

async function refreshEpisodeList() {
  if (!currentEpisodeTarget) { console.log('[episodes] no target'); return; }
  const { type, id } = currentEpisodeTarget;
  console.log('[episodes] fetching content:', type, id);
  try {
    const doc = await api(`/api/content/${type}/${id}`);
    const eps = (doc.episodes || []).sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
    console.log('[episodes] fetched', eps.length, 'episodes');
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
    console.error('[episodes] fetch failed:', err);
    toast(err.message, 'error');
  }
}

// Event delegation on episodeList container — survives re-renders
$('episodeList')?.addEventListener('click', async (e) => {
  const editBtn = e.target.closest('.ep-edit');
  const delBtn = e.target.closest('.ep-del');

  if (editBtn) {
    e.preventDefault();
    const s = Number(editBtn.dataset.s);
    const en = Number(editBtn.dataset.e);
    console.log('[episodes] edit clicked:', { s, en });
    if (!currentEpisodeTarget) return;

    try {
      const doc = await api(`/api/content/${currentEpisodeTarget.type}/${currentEpisodeTarget.id}`);
      const eps = doc.episodes || [];
      const ep = eps.find((x) => Number(x.season) === s && Number(x.episode) === en);
      if (!ep) {
        toast('Episode not found — refresh and try again', 'error');
        console.error('[episodes] find failed. Available:', eps.map(x => ({ s: x.season, e: x.episode })));
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
      console.log('[episodes] form populated:', $('epVideo').value);
    } catch (err) {
      toast(err.message, 'error');
      console.error('[episodes] edit failed:', err);
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

$('episodeForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentEpisodeTarget) return toast('No content selected', 'error');
  const { type, id } = currentEpisodeTarget;

  const payload = {
    season: Number($('epSeason').value) || 1,
    episode: Number($('epNumber').value),
    title: $('epTitle').value.trim(),
    duration: $('epDuration').value.trim(),
    description: $('epDesc').value.trim(),
    video_url: $('epVideo').value.trim(),
  };

  if (!payload.episode) return toast('Episode number required', 'error');
  if (!payload.video_url) return toast('Video URL required', 'error');
  if (!payload.video_url.startsWith('https://')) return toast('Video URL must start with https://', 'error');

  const epId = $('epId').value;
  console.log('[episodes] submit:', { epId, payload });
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
  } catch (err) {
    toast(err.message, 'error');
    console.error('[episodes] submit failed:', err);
  }
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
(async function init() {
  applyTheme(state.theme);
  $('yearNow').textContent = new Date().getFullYear();
  initSheet();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      console.log('[sw] registered', reg.scope);
    }).catch((err) => {
      console.warn('[sw] registration failed', err);
    });
  }

  await checkUser();
  await loadGenres();
  loadHome();
  loadContinueWatching();
  movePill(false);
})();
