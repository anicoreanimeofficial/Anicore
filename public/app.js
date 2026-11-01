const API = ""; // Relative path since served by same FastAPI app
let currentPage = { anime: 1, movies: 1 };
let lastScrollY = window.scrollY;

// --- Navigation & UI ---

function showPage(page) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById(`page-${page}`).classList.add("active");
  
  document.querySelectorAll(".bottom-nav button").forEach(b => b.classList.remove("active"));
  // Simple active state logic based on index for demo
  
  if(page === 'profile') loadProfile();
  if(page === 'anime') loadAnime(1);
  if(page === 'tv') loadTvShows();
  if(page === 'movies') loadMovies(1);
  
  window.scrollTo(0,0);
}

// Hide Nav on Scroll Down
window.addEventListener('scroll', () => {
  const nav = document.getElementById('bottomNav');
  if (window.scrollY > lastScrollY && window.scrollY > 100) {
    nav.classList.add('hidden-nav');
  } else {
    nav.classList.remove('hidden-nav');
  }
  lastScrollY = window.scrollY;
});

// --- API Helper ---

async function api(path, options = {}) {
  const res = await fetch(API + path, { ...options, credentials: 'include' });
  return res.json();
}

// --- Data Loading ---

async function loadAnime(page = 1) {
  const data = await api(`/api/anime?page=${page}`);
  const grid = document.getElementById(page === 1 ? 'homeAnimeGrid' : 'animeGrid');
  if(page === 1) grid.innerHTML = '';
  
  data.items.forEach(item => {
    grid.innerHTML += `
      <div class="media-card" onclick="openDetail('anime', '${item._id}')">
        <div class="poster-wrap"><img src="${item.poster}" loading="lazy"></div>
        <div class="media-info"><h3>${item.title}</h3><p>Views: ${item.views || 0}</p></div>
      </div>`;
  });
  
  if(page > 1) document.getElementById('loadMoreAnime').onclick = () => loadAnime(page + 1);
}

async function loadTvShows() {
  const data = await api(`/api/tvshows`);
  const grid = document.getElementById('homeTvGrid') || document.getElementById('tvGrid');
  grid.innerHTML = data.items.map(item => `
    <div class="media-card" onclick="openDetail('tv_show', '${item._id}')">
      <div class="poster-wrap"><img src="${item.poster}"></div>
      <div class="media-info"><h3>${item.title}</h3></div>
    </div>`).join('');
}

async function loadMovies(page = 1) {
  const data = await api(`/api/movies?page=${page}`);
  document.getElementById('movieGrid').innerHTML = data.items.map(item => `
    <div class="media-card" onclick="openDetail('movie', '${item._id}')">
      <div class="poster-wrap"><img src="${item.poster}"></div>
      <div class="media-info"><h3>${item.title}</h3></div>
    </div>`).join('');
}

// --- Details & Features ---

async function openDetail(type, id) {
  const item = await api(`/api/content/${type}/${id}`);
  const modal = document.getElementById('detailModal');
  const content = document.getElementById('detailContent');
  
  content.innerHTML = `
    <h2>${item.title}</h2>
    <p>${item.description}</p>
    <p class="muted">Views: ${item.views} | Rating: ${item.rating}</p>
    ${item.ai_recap ? `<div style="background:#222; padding:10px; border-radius:10px; margin:10px 0;"><strong>🤖 AI Recap:</strong> ${item.ai_recap}</div>` : ''}
    <button class="primary" onclick="addToWatchlist('${type}', '${id}')">Add to Watchlist</button>
  `;
  modal.classList.remove('hidden');
}

function closeDetail() {
  document.getElementById('detailModal').classList.add('hidden');
}

// --- Auth ---

function openAuth() { document.getElementById('authModal').classList.remove('hidden'); }
function closeAuth() { document.getElementById('authModal').classList.add('hidden'); }

document.getElementById('authForm').onsubmit = async (e) => {
  e.preventDefault();
  const email = document.getElementById('authEmail').value;
  const pass = document.getElementById('authPass').value;
  
  // Try login, if fails try register (simple UX for demo)
  let res = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({email, password: pass}), headers: {'Content-Type':'application/json'} });
  if(res.detail) {
     res = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({email, password: pass}), headers: {'Content-Type':'application/json'} });
  }
  
  if(res.message) {
    closeAuth();
    checkUser();
  } else {
    alert(res.detail);
  }
};

async function checkUser() {
  const user = await api('/api/auth/me');
  if(user.authenticated) {
    document.getElementById('authBtn').classList.add('hidden');
    document.getElementById('logoutBtn').classList.remove('hidden');
    document.getElementById('profileInfo').innerText = `Logged in as: ${user.email} (${user.role})`;
    if(user.role === 'admin') showPage('admin');
  }
}

async function logout() {
  await api('/api/auth/logout', {method: 'POST'});
  location.reload();
}

// --- Init ---
checkUser();
loadAnime(1);
loadTvShows();
