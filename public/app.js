'use strict';

const $ = (id) => document.getElementById(id);
const PLACEHOLDER = 'https://placehold.co/400x600/17101e/ffffff?text=ANICORE';
const PAGE_SIZE = 20;

const state = { user: null, authMode: 'login', page: 'home', detailId: null };
const PAGE_ORDER = ['home', 'anime', 'tv', 'movies', 'profile', 'admin'];

// One config per browsable list (anime / tv_show / movie)
const LISTS = {
  anime:   { endpoint: '/api/anime',   grid: 'animeGrid', more: 'loadMoreAnime',  search: 'animeSearch', empty: 'No anime found.',    page: 0, q: '' },
  tv_show: { endpoint: '/api/tvshows', grid: 'tvGrid',    more: 'loadMoreTv',     search: 'tvSearch',    empty: 'No TV shows found.', page: 0, q: '' },
  movie:   { endpoint: '/api/movies',  grid: 'movieGrid', more: 'loadMoreMovies', search: 'movieSearch', empty: 'No movies found.',   page: 0, q: '' },
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
  try { data = await res.json(); } catch { /* non-JSON response */ }
  if (!res.ok) throw new Error(errorText(data) || `Request failed (${res.status})`);
  return data;
}

// --- Navigation ---

// Slide the highlight behind the active tab
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
  void target.offsetWidth; // restart the animation
  if (page !== state.page) target.classList.add(dir);
  state.page = page;

  document.querySelectorAll('.bottom-nav button').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  movePill();

  const type = PAGE_TYPES[page];
  if (type && !LISTS[type].page) loadList(type, true);
  if (page === 'profile') loadProfile();
  if (page === 'admin') { loadAdminRequests(); loadLibrary(true); }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-page]');
  if (el) {
    e.preventDefault();
    showPage(el.dataset.page);
  }
});

// Hide the bottom nav while scrolling down
let lastScrollY = window.scrollY;
window.addEventListener('scroll', () => {
  const y = window.scrollY;
  if (Math.abs(y - lastScrollY) < 8) return;
  $('bottomNav').classList.toggle('hidden-nav', y > lastScrollY && y > 100);
  lastScrollY = y;
}, { passive: true });

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
    card.innerHTML = '<div class="poster-wrap"><img loading="lazy" alt=""></div><div class="media-info"><h3></h3><p></p></div>';

    const img = card.querySelector('img');
    img.src = safeUrl(item.poster) || PLACEHOLDER;
    img.alt = item.title || '';
    img.addEventListener('error', () => { img.src = PLACEHOLDER; }, { once: true });

    card.querySelector('h3').textContent = item.title || 'Untitled';
    card.querySelector('p').textContent = item.views ? `${item.views} views` : (item.year || '');

    const open = () => openDetail(item._type || type, item._id, item);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    frag.appendChild(card);
  });
  grid.appendChild(frag);
}

async function loadHome() {
  const jobs = [
    ['anime', 'homeAnimeGrid', '/api/anime'],
    ['tv_show', 'homeTvGrid', '/api/tvshows'],
    ['movie', 'homeMovieGrid', '/api/movies'],
  ];
  await Promise.all(jobs.map(async ([type, gridId, endpoint]) => {
    try {
      const data = await api(`${endpoint}?page=1&limit=10`);
      renderGrid($(gridId), data.items, type);
    } catch {
      $(gridId).innerHTML = '<p class="muted empty">Failed to load. Please refresh.</p>';
    }
  }));
}

async function loadList(type, reset = false) {
  const l = LISTS[type];
  if (reset) l.page = 0;
  const next = l.page + 1;
  const params = new URLSearchParams({ page: next, limit: PAGE_SIZE });
  if (l.q) params.set('q', l.q);

  const btn = $(l.more);
  btn.disabled = true;
  try {
    const data = await api(`${l.endpoint}?${params}`);
    l.page = next;
    renderGrid($(l.grid), data.items, type, { append: next > 1, empty: l.empty });
    btn.classList.toggle('hidden', next * PAGE_SIZE >= data.total);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

Object.entries(LISTS).forEach(([type, l]) => {
  let timer;
  $(l.search).addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { l.q = e.target.value.trim(); loadList(type, true); }, 300);
  });
  $(l.more).addEventListener('click', () => loadList(type));
});

// --- Auth ---

function updateAuthUI() {
  const u = state.user;
  $('signInBtn').classList.toggle('hidden', !!u);
  $('logoutBtn').classList.toggle('hidden', !u);
  $('adminBtn').classList.toggle('hidden', u?.role !== 'admin');
}

async function checkUser() {
  try {
    const res = await api('/api/auth/me');
    state.user = res.authenticated ? { email: res.email, role: res.role || 'user' } : null;
  } catch {
    state.user = null;
  }
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

$('signInBtn').addEventListener('click', () => openAuth('login'));
$('authClose').addEventListener('click', closeAuth);
$('toggleAuthBtn').addEventListener('click', () => openAuth(state.authMode === 'login' ? 'register' : 'login'));
$('authModal').addEventListener('click', (e) => { if (e.target.id === 'authModal') closeAuth(); });

$('authForm').addEventListener('submit', async (e) => {
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
    if ($('page-profile').classList.contains('active')) loadProfile();
  } catch (err) {
    showAuthError(err.message || 'Failed to authenticate. Please try again.');
  } finally {
    btn.disabled = false;
    setAuthMode(state.authMode);
  }
});

$('logoutBtn').addEventListener('click', async () => {
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
});

// --- Profile ---

async function loadProfile() {
  const info = $('profileInfo');
  const member = $('profileMember');

  if (!state.user) {
    info.innerHTML = '<div class="panel profile-panel"><p class="muted">Sign in to see your profile and watchlist.</p><button class="primary" type="button" id="profileSignIn">Sign In</button></div>';
    $('profileSignIn').addEventListener('click', () => openAuth('login'));
    member.classList.add('hidden');
    return;
  }

  info.innerHTML = `
    <div class="panel profile-panel">
      <div class="profile-avatar">${esc(state.user.email.charAt(0).toUpperCase())}</div>
      <h3>${esc(state.user.email)}</h3>
      <p class="muted">Role: ${esc(state.user.role)}</p>
    </div>`;
  member.classList.remove('hidden');

  try {
    const list = await api('/api/watchlist');
    const items = list.map((w) => ({ _id: w.content_id, _type: w.content_type, title: w.title, poster: w.poster }));
    renderGrid($('watchlistGrid'), items, 'anime', { empty: 'Your watchlist is empty.' });
  } catch (err) {
    toast(err.message, 'error');
  }
}

$('requestForm').addEventListener('submit', async (e) => {
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

// --- Detail modal ---

function linkList(links) {
  const entries = Object.entries(links || {}).filter(([, url]) => safeUrl(url));
  if (!entries.length) return '';
  return `<div class="links">${entries.map(([quality, url]) =>
    `<a class="chip" href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${esc(quality)}</a>`
  ).join('')}</div>`;
}

function episodesHtml(episodes) {
  if (!episodes?.length) return '';
  const sorted = [...episodes].sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
  return `<h3>Episodes</h3><div class="episodes">${sorted.map((ep) => `
    <div class="episode">
      <strong>S${esc(ep.season)} · E${esc(ep.episode)}</strong>${ep.title ? ` — ${esc(ep.title)}` : ''}${ep.duration ? `<span class="muted"> · ${esc(ep.duration)}</span>` : ''}
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

function metaText(item) {
  if (!('description' in item)) return '';
  return `👁 ${item.views || 0} · ⭐ ${item.rating || 'N/A'} · 📅 ${item.year || 'N/A'}${item.status ? ` · ${item.status}` : ''}`;
}

function recapHtml(item) {
  return item.ai_recap ? `<div class="recap"><strong>🤖 AI Recap</strong>${esc(item.ai_recap)}</div>` : '';
}

// Fills in the live details (views, watchlist state, recap, comments)
// without redrawing the sheet, so nothing flickers.
function updateDetail(item, comments) {
  $('dMeta').textContent = metaText(item);
  $('dRecapSlot').innerHTML = recapHtml(item);
  const wl = $('wlBtn');
  wl.textContent = item.in_watchlist ? '♥ In Watchlist' : '♡ Add to Watchlist';
  wl.classList.toggle('saved', !!item.in_watchlist);
  $('commentList').innerHTML = commentsHtml(comments);
}

async function openDetail(type, id, preview) {
  const modal = $('detailModal');
  clearTimeout(closeTimer);
  resetSheet();
  state.detailId = id;
  const complete = !!preview && 'description' in preview;

  const show = () => {
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  };

  if (preview) {
    // Draw instantly from the card's own data: the sheet slides up with content, no loading state.
    renderDetail(type, preview, null);
    show();
  }

  try {
    const [item, comments] = await Promise.all([
      api(`/api/content/${type}/${id}`),
      api(`/api/comments/${type}/${id}`),
    ]);
    if (state.detailId !== id) return; // closed or switched while loading
    if (complete) {
      updateDetail(item, comments);
    } else {
      renderDetail(type, item, comments);
      if (!preview) show();
    }
  } catch (err) {
    if (state.detailId !== id) return;
    closeDetail();
    toast(err.message || 'Failed to load details.', 'error');
  }
}

function renderDetail(type, item, comments) {
  const banner = safeUrl(item.banner) || safeUrl(item.poster);
  const genres = Array.isArray(item.genres) && item.genres.length ? item.genres.join(', ') : '';

  $('detailContent').innerHTML = `
    ${banner ? `<img class="detail-banner" src="${esc(banner)}" alt="">` : ''}
    <h2>${esc(item.title)}</h2>
    <p class="muted meta" id="dMeta">${esc(metaText(item))}</p>
    <p class="desc">${'description' in item ? esc(item.description || 'No description available.') : ''}</p>
    ${genres ? `<p><span class="muted">Genres:</span> ${esc(genres)}</p>` : ''}
    <div id="dRecapSlot">${recapHtml(item)}</div>
    ${type === 'movie' ? linkList(item.quality_links) : ''}
    ${episodesHtml(item.episodes)}
    <div class="detail-actions">
      <button class="primary ${item.in_watchlist ? 'saved' : ''}" id="wlBtn" type="button">${item.in_watchlist ? '♥ In Watchlist' : '♡ Add to Watchlist'}</button>
      <button class="outline" id="arBtn" type="button">📷 View in AR</button>
      <button class="outline" id="widgetBtn" type="button">🔗 Get Widget</button>
    </div>
    <h3>Comments</h3>
    ${state.user
      ? `<form id="commentForm"><textarea id="commentText" rows="2" maxlength="1000" placeholder="Write a comment..." required></textarea><button class="outline block" type="submit">Post Comment</button></form>`
      : '<p class="muted">Sign in to comment.</p>'}
    <div id="commentList">${comments ? commentsHtml(comments) : ''}</div>`;

  $('detailContent').querySelector('.detail-banner')?.addEventListener('error', (e) => e.target.remove(), { once: true });

  $('wlBtn').addEventListener('click', async (e) => {
    if (!state.user) return openAuth('login');
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const res = await api(`/api/watchlist/${type}/${item._id}`, { method: 'POST' });
      btn.textContent = res.saved ? '♥ In Watchlist' : '♡ Add to Watchlist';
      btn.classList.toggle('saved', res.saved);
      toast(res.saved ? 'Added to watchlist' : 'Removed from watchlist');
      if ($('page-profile').classList.contains('active')) loadProfile();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  $('arBtn').addEventListener('click', () => toast('AR viewer coming soon!'));
  $('widgetBtn').addEventListener('click', () => toast('Widget coming soon!'));

  $('commentForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('commentText').value.trim();
    if (!text) return;
    try {
      await api('/api/comments', {
        method: 'POST',
        body: JSON.stringify({ content_type: type, content_id: item._id, text }),
      });
      $('commentText').value = '';
      $('commentList').innerHTML = commentsHtml(await api(`/api/comments/${type}/${item._id}`));
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

let closeTimer;

function resetSheet() {
  const modal = $('detailModal');
  const sheet = $('detailSheet');
  sheet.style.transition = '';
  sheet.style.transform = '';
  modal.style.transition = '';
  modal.style.background = '';
}

// Slides the sheet down off the screen, then hides it
function closeDetail() {
  const modal = $('detailModal');
  if (modal.classList.contains('hidden')) return;
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

// Swipe the sheet down to dismiss it (when scrolled to the top)
function initSheet() {
  const modal = $('detailModal');
  const sheet = $('detailSheet');
  let startY = 0;
  let dy = 0;
  let dragging = false;

  sheet.addEventListener('touchstart', (e) => {
    if (sheet.scrollTop > 0 || e.touches.length !== 1) return;
    startY = e.touches[0].clientY;
    dy = 0;
    dragging = true;
  }, { passive: true });

  sheet.addEventListener('touchmove', (e) => {
    if (!dragging || sheet.scrollTop > 0) return;
    dy = e.touches[0].clientY - startY;
    if (dy <= 0) { dy = 0; return; }
    sheet.style.transition = 'none';
    sheet.style.transform = `translateY(${dy}px)`;
    modal.style.background = `rgba(0, 0, 0, ${0.85 * (1 - Math.min(dy / 400, 1))})`;
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  sheet.addEventListener('touchend', () => {
    if (!dragging) return;
    dragging = false;
    if (dy > 110) {
      closeDetail();
    } else {
      sheet.style.transition = '';
      sheet.style.transform = '';
      modal.style.background = '';
    }
    dy = 0;
  });
}

$('detailClose').addEventListener('click', closeDetail);
$('detailModal').addEventListener('click', (e) => { if (e.target.id === 'detailModal') closeDetail(); });

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('authModal').classList.contains('hidden')) closeAuth();
  else closeDetail();
});

// --- Admin ---

const ADMIN_ENDPOINTS = { anime: '/api/admin/anime', tv_show: '/api/admin/tvshows', movie: '/api/admin/movies' };
const REQUEST_STATUSES = ['Pending', 'Approved', 'Rejected', 'Completed'];

$('adminForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const type = $('aType').value;
  const year = $('aYear').value;
  const body = {
    title: $('aTitle').value.trim(),
    description: $('aDesc').value.trim(),
    genres: $('aGenres').value.split(',').map((s) => s.trim()).filter(Boolean),
    year: year ? Number(year) : null,
    rating: $('aRating').value.trim(),
    status: $('aStatus').value,
    poster: $('aPoster').value.trim(),
    banner: $('aBanner').value.trim(),
  };

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const id = $('aId').value;
    if (id) {
      await api(`/api/admin/content/${type}/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      exitEdit();
      toast('Updated!');
    } else {
      await api(ADMIN_ENDPOINTS[type], { method: 'POST', body: JSON.stringify(body) });
      e.target.reset();
      toast('Saved!');
    }
    LISTS[type].page = 0; // force a refresh next time that list is opened
    loadHome();
    loadLibrary(true);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

async function loadAdminRequests() {
  const box = $('adminRequests');
  try {
    const rows = await api('/api/admin/requests');
    if (!rows.length) {
      box.innerHTML = '<p class="muted">No requests yet.</p>';
      return;
    }
    box.innerHTML = '';
    rows.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'request-row';
      row.innerHTML = `
        <div>
          <strong>${esc(r.title)}</strong>
          <p class="muted">${esc(r.email)} · ${esc(r.language)} · ${esc(fmtDate(r.created_at))}</p>
          ${r.notes ? `<p>${esc(r.notes)}</p>` : ''}
        </div>
        <select aria-label="Request status">
          ${REQUEST_STATUSES.map((s) => `<option${s === r.status ? ' selected' : ''}>${s}</option>`).join('')}
        </select>`;
      row.querySelector('select').addEventListener('change', async (e) => {
        try {
          await api(`/api/admin/requests/${r._id}`, { method: 'PATCH', body: JSON.stringify({ status: e.target.value }) });
          toast('Request updated');
        } catch (err) {
          toast(err.message, 'error');
          loadAdminRequests();
        }
      });
      box.appendChild(row);
    });
  } catch (err) {
    box.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

// --- Admin library: edit & delete posted content ---

const lib = { page: 0 };

function setAdminStatus(value) {
  const sel = $('aStatus');
  if (value && ![...sel.options].some((o) => o.value === value)) sel.add(new Option(value, value));
  sel.value = value || 'Ongoing';
}

function startEdit(type, item) {
  $('aId').value = item._id;
  $('aType').value = type;
  $('aType').disabled = true; // content type can't change once posted
  $('aTitle').value = item.title || '';
  $('aDesc').value = item.description || '';
  $('aGenres').value = (item.genres || []).join(', ');
  $('aYear').value = item.year ?? '';
  $('aRating').value = item.rating || '';
  setAdminStatus(item.status);
  $('aPoster').value = item.poster || '';
  $('aBanner').value = item.banner || '';
  $('adminFormTitle').textContent = `Edit: ${item.title}`;
  $('aSubmit').textContent = 'Update';
  $('aCancel').classList.remove('hidden');
  $('adminForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function exitEdit() {
  $('adminForm').reset();
  $('aId').value = '';
  $('aType').disabled = false;
  $('adminFormTitle').textContent = 'Add Content';
  $('aSubmit').textContent = 'Save';
  $('aCancel').classList.add('hidden');
}

function libRow(type, item) {
  const row = document.createElement('div');
  row.className = 'lib-row';
  row.innerHTML = `
    <img alt="" loading="lazy">
    <div><h4></h4><p></p></div>
    <div class="lib-actions">
      <button class="outline" type="button" data-act="edit">Edit</button>
      <button class="outline danger" type="button" data-act="delete">Delete</button>
    </div>`;

  const img = row.querySelector('img');
  img.src = safeUrl(item.poster) || PLACEHOLDER;
  img.addEventListener('error', () => { img.src = PLACEHOLDER; }, { once: true });
  row.querySelector('h4').textContent = item.title || 'Untitled';
  row.querySelector('p').textContent = [item.year, item.status, `${item.views || 0} views`].filter(Boolean).join(' · ');

  row.querySelector('[data-act="edit"]').addEventListener('click', () => startEdit(type, item));
  row.querySelector('[data-act="delete"]').addEventListener('click', async (e) => {
    if (!confirm(`Delete "${item.title}"? Its comments and watchlist entries are removed too.`)) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await api(`/api/admin/content/${type}/${item._id}`, { method: 'DELETE' });
      row.remove();
      if ($('aId').value === item._id) exitEdit();
      LISTS[type].page = 0;
      loadHome();
      toast('Deleted');
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  });
  return row;
}

async function loadLibrary(reset = false) {
  const type = $('libType').value;
  const q = $('libSearch').value.trim();
  if (reset) lib.page = 0;
  const next = lib.page + 1;
  const params = new URLSearchParams({ page: next, limit: PAGE_SIZE });
  if (q) params.set('q', q);

  const list = $('libList');
  const more = $('libMore');
  more.disabled = true;
  try {
    const data = await api(`${LISTS[type].endpoint}?${params}`);
    lib.page = next;
    if (next === 1) list.innerHTML = '';
    if (next === 1 && !data.items.length) list.innerHTML = '<p class="muted">Nothing here yet.</p>';
    data.items.forEach((item) => list.appendChild(libRow(type, item)));
    more.classList.toggle('hidden', next * PAGE_SIZE >= data.total);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    more.disabled = false;
  }
}

$('aCancel').addEventListener('click', exitEdit);
$('libType').addEventListener('change', () => loadLibrary(true));
$('libMore').addEventListener('click', () => loadLibrary());
let libTimer;
$('libSearch').addEventListener('input', () => {
  clearTimeout(libTimer);
  libTimer = setTimeout(() => loadLibrary(true), 300);
});

// --- Falling snow background ---

function initSnow() {
  const canvas = $('snow');
  if (!canvas || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = canvas.getContext('2d');
  let w = 0;
  let h = 0;
  let last = 0;
  let raf = 0;
  const flakes = [];

  const makeFlake = (anywhere) => ({
    x: Math.random() * w,
    y: anywhere ? Math.random() * h : -10,
    r: Math.random() * 2.2 + 0.8,   // size
    s: Math.random() * 0.8 + 0.4,   // fall speed
    a: Math.random() * Math.PI * 2, // sway phase
    sway: Math.random() * 0.6 + 0.2,
    o: Math.random() * 0.5 + 0.3,   // opacity
  });

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.max(40, Math.min(110, Math.round((w * h) / 16000)));
    while (flakes.length < count) flakes.push(makeFlake(true));
    flakes.length = count;
  }

  function frame(t) {
    const dt = Math.min((t - last) / 16.67, 3) || 1;
    last = t;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f4eeff';
    for (const f of flakes) {
      f.y += f.s * dt * (0.6 + f.r * 0.35);
      f.a += 0.01 * dt;
      f.x += Math.sin(f.a) * f.sway * dt;
      if (f.y > h + 10) Object.assign(f, makeFlake(false));
      if (f.x > w + 10) f.x = -10;
      if (f.x < -10) f.x = w + 10;
      ctx.globalAlpha = f.o;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();
    }
    raf = requestAnimationFrame(frame);
  }

  const start = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  const stop = () => { cancelAnimationFrame(raf); raf = 0; };

  resize();
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  start();
}

// --- Init ---

(async () => {
  $('yearNow').textContent = new Date().getFullYear();
  initSnow();
  initSheet();
  movePill(false);
  await checkUser();
  loadHome();
})();
