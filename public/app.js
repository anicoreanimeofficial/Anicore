const API = "";
let currentPage = { anime: 1, movies: 1, tv: 1 };
let lastScrollY = window.scrollY;
let authMode = 'login';

// --- Navigation & UI ---

function showPage(page) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById(`page-${page}`).classList.add("active");
  
  document.querySelectorAll(".bottom-nav button").forEach(b => b.classList.remove("active"));
  const navButtons = document.querySelectorAll(".bottom-nav button");
  const pageIndex = { 'home': 0, 'anime': 1, 'tv': 2, 'movies': 3, 'profile': 4 };
  if (pageIndex[page] !== undefined) {
    navButtons[pageIndex[page]].classList.add("active");
  }
  
  if(page === 'profile') loadProfile();
  if(page === 'anime') {
    currentPage.anime = 1;
    loadAnime(1);
  }
  if(page === 'tv') loadTvShows();
  if(page === 'movies') {
    currentPage.movies = 1;
    loadMovies(1);
  }
  
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Smooth Nav Hide/Show
window.addEventListener('scroll', () => {
  const nav = document.getElementById('bottomNav');
  const currentScrollY = window.scrollY;
  
  if (currentScrollY > lastScrollY && currentScrollY > 100) {
    nav.classList.add('hidden-nav');
  } else {
    nav.classList.remove('hidden-nav');
  }
  lastScrollY = currentScrollY;
});

// --- API Helper with Better Error Handling ---

async function api(path, options = {}) {
  try {
    const res = await fetch(API + path, { 
      ...options, 
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    
    const contentType = res.headers.get('content-type');
    
    // Check if response is JSON
    if (contentType && contentType.includes('application/json')) {
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.detail || data.message || 'Request failed');
      }
      
      return data;
    } else {
      // Handle non-JSON responses (HTML error pages)
      const text = await res.text();
      console.error('Non-JSON response:', text.substring(0, 200));
      throw new Error('Server error. Please try again later.');
    }
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

// --- Auth Functions ---

function openAuth(mode = 'login') {
  authMode = mode;
  const modal = document.getElementById('authModal');
  const title = document.getElementById('authTitle');
  const subtitle = document.getElementById('authSubtitle');
  const btn = document.getElementById('authBtn');
  const toggleText = document.getElementById('toggleText');
  const toggleBtn = document.getElementById('toggleAuthBtn');
  const passInput = document.getElementById('authPass');

  // Clear previous errors
  const existingError = modal.querySelector('.error-message');
  if (existingError) existingError.remove();

  if (mode === 'login') {
    title.textContent = 'Welcome Back';
    subtitle.textContent = 'Sign in to continue your journey.';
    btn.textContent = 'Sign In';
    toggleText.textContent = "Don't have an account?";
    toggleBtn.textContent = 'Create Account';
    passInput.autocomplete = 'current-password';
  } else {
    title.textContent = 'Join ANICORE';
    subtitle.textContent = 'Create your free account and build your watchlist.';
    btn.textContent = 'Create Account';
    toggleText.textContent = 'Already have an account?';
    toggleBtn.textContent = 'Sign In Instead';
    passInput.autocomplete = 'new-password';
  }

  modal.classList.remove('hidden');
}

function closeAuth() {
  document.getElementById('authModal').classList.add('hidden');
  document.getElementById('authEmail').value = '';
  document.getElementById('authPass').value = '';
}

function showError(message) {
  const modal = document.getElementById('authModal');
  const existingError = modal.querySelector('.error-message');
  if (existingError) existingError.remove();
  
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-message';
  errorDiv.textContent = message;
  
  const form = modal.querySelector('form');
  form.insertBefore(errorDiv, form.firstChild);
  
  setTimeout(() => errorDiv.remove(), 5000);
}

// Toggle Button Event Listener
document.getElementById('toggleAuthBtn').addEventListener('click', () => {
  openAuth(authMode === 'login' ? 'register' : 'login');
});

// Form Submission
document.getElementById('authForm').onsubmit = async (e) => {
  e.preventDefault();
  
  const email = document.getElementById('authEmail').value.trim();
  const pass = document.getElementById('authPass').value;
  const btn = document.getElementById('authBtn');
  
  if (!email || !pass) {
    showError('Please fill in all fields');
    return;
  }
  
  if (pass.length < 6) {
    showError('Password must be at least 6 characters');
    return;
  }
  
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = authMode === 'login' ? 'Signing in...' : 'Creating account...';
  
  try {
    const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const res = await api(endpoint, { 
      method: 'POST', 
      body: JSON.stringify({ email, password: pass })
    });
    
    if (res.message) {
      closeAuth();
      await checkUser();
      
      const toast = document.createElement('div');
      toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:linear-gradient(110deg,#ff3f82,#9a5cff);color:white;padding:15px 30px;border-radius:12px;z-index:9999;box-shadow:0 10px 30px rgba(0,0,0,.3);';
      toast.textContent = authMode === 'login' ? 'Welcome back!' : 'Account created!';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
    }
  } catch (error) {
    showError(error.message || 'Failed to authenticate. Please try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
};

async function checkUser() {
  try {
    const user = await api('/api/auth/me');
    const authBtn = document.getElementById('authBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const profileInfo = document.getElementById('profileInfo');
    
    if (user.authenticated) {
      authBtn.classList.add('hidden');
      logoutBtn.classList.remove('hidden');
      
      if (profileInfo) {
        profileInfo.innerHTML = `
          <div style="background:rgba(255,255,255,.05);padding:15px;border-radius:12px;margin-bottom:15px;">
            <strong style="color:var(--pink)">${user.email}</strong><br>
            <span class="muted">Role: ${user.role}</span>
          </div>
        `;
      }
      
      if (user.role === 'admin') {
        document.getElementById('page-admin').style.display = 'block';
      }
      
      return user;
    } else {
      authBtn.classList.remove('hidden');
      logoutBtn.classList.add('hidden');
      if (profileInfo) {
        profileInfo.innerHTML = 'Sign in to see details.';
      }
      return null;
    }
  } catch (error) {
    console.error('Check user error:', error);
    return null;
  }
}

async function logout() {
  if (!confirm('Are you sure you want to sign out?')) return;
  
  try {
    await api('/api/auth/logout', { method: 'POST' });
    location.reload();
  } catch (error) {
    showError('Failed to logout');
  }
}

// --- Data Loading ---

async function loadAnime(page = 1) {
  try {
    const data = await api(`/api/anime?page=${page}&limit=20`);
    const gridId = page === 1 ? 'homeAnimeGrid' : 'animeGrid';
    const grid = document.getElementById(gridId);
    
    if (!grid) return;
    
    if (page === 1) grid.innerHTML = '';
    
    if (data.items && data.items.length > 0) {
      data.items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'media-card';
        card.onclick = () => openDetail('anime', item._id);
        card.innerHTML = `
          <div class="poster-wrap">
            <img src="${item.poster || 'https://placehold.co/400x600/17101e/ffffff?text=ANICORE'}" 
                 loading="lazy" 
                 onerror="this.src='https://placehold.co/400x600/17101e/ffffff?text=ANICORE'">
          </div>
          <div class="media-info">
            <h3>${item.title}</h3>
            <p>Views: ${item.views || 0}</p>
          </div>
        `;
        grid.appendChild(card);
      });
      
      if (page > 1) {
        const loadMoreBtn = document.getElementById('loadMoreAnime');
        if (loadMoreBtn) {
          loadMoreBtn.onclick = () => loadAnime(page + 1);
        }
      }
    } else if (page === 1) {
      grid.innerHTML = '<p class="muted" style="text-align:center;padding:40px;">No anime available yet.</p>';
    }
  } catch (error) {
    console.error('Load anime error:', error);
    const grid = document.getElementById(page === 1 ? 'homeAnimeGrid' : 'animeGrid');
    if (grid && page === 1) {
      grid.innerHTML = '<p class="muted" style="text-align:center;padding:40px;">Failed to load anime. Please refresh.</p>';
    }
  }
}

async function loadTvShows() {
  try {
    const data = await api(`/api/tvshows?page=1&limit=20`);
    const grid = document.getElementById('homeTvGrid') || document.getElementById('tvGrid');
    
    if (!grid) return;
    
    if (data.items && data.items.length > 0) {
      grid.innerHTML = data.items.map(item => `
        <div class="media-card" onclick="openDetail('tv_show', '${item._id}')">
          <div class="poster-wrap">
            <img src="${item.poster || 'https://placehold.co/400x600/17101e/ffffff?text=TV+Show'}" 
                 loading="lazy"
                 onerror="this.src='https://placehold.co/400x600/17101e/ffffff?text=TV+Show'">
          </div>
          <div class="media-info">
            <h3>${item.title}</h3>
          </div>
        </div>
      `).join('');
    } else {
      grid.innerHTML = '<p class="muted" style="text-align:center;padding:40px;">No TV shows available yet.</p>';
    }
  } catch (error) {
    console.error('Load TV shows error:', error);
  }
}

async function loadMovies(page = 1) {
  try {
    const data = await api(`/api/movies?page=${page}&limit=20`);
    const grid = document.getElementById('movieGrid');
    
    if (!grid) return;
    
    if (data.items && data.items.length > 0) {
      grid.innerHTML = data.items.map(item => `
        <div class="media-card" onclick="openDetail('movie', '${item._id}')">
          <div class="poster-wrap">
            <img src="${item.poster || 'https://placehold.co/400x600/17101e/ffffff?text=Movie'}" 
                 loading="lazy"
                 onerror="this.src='https://placehold.co/400x600/17101e/ffffff?text=Movie'">
          </div>
          <div class="media-info">
            <h3>${item.title}</h3>
          </div>
        </div>
      `).join('');
    } else {
      grid.innerHTML = '<p class="muted" style="text-align:center;padding:40px;">No movies available yet.</p>';
    }
  } catch (error) {
    console.error('Load movies error:', error);
  }
}

// --- Details & Features ---

async function openDetail(type, id) {
  try {
    const item = await api(`/api/content/${type}/${id}`);
    const modal = document.getElementById('detailModal');
    const content = document.getElementById('detailContent');
    
    content.innerHTML = `
      <img src="${item.banner || item.poster}" 
           style="width:100%;max-height:300px;object-fit:cover;border-radius:12px;margin-bottom:20px;"
           onerror="this.style.display='none'">
      <h2>${item.title}</h2>
      <p style="line-height:1.6;margin:15px 0;">${item.description || 'No description available.'}</p>
      <p class="muted">
        👁️ ${item.views || 0} views | 
        ⭐ ${item.rating || 'N/A'} | 
        📅 ${item.year || 'N/A'}
      </p>
      ${item.genres && item.genres.length ? `<p><span class="muted">Genres:</span> ${item.genres.join(', ')}</p>` : ''}
      ${item.ai_recap ? `
        <div style="background:linear-gradient(145deg,rgba(154,92,255,.15),rgba(255,63,130,.15));padding:15px;border-radius:12px;margin:15px 0;border:1px solid rgba(154,92,255,.3);">
          <strong style="color:var(--purple);display:block;margin-bottom:8px;">🤖 AI Recap:</strong>
          <span style="font-size:14px;line-height:1.5;">${item.ai_recap}</span>
        </div>
      ` : ''}
      <div style="display:flex;gap:10px;margin-top:20px;flex-wrap:wrap;">
        <button class="primary" onclick="addToWatchlist('${type}', '${id}')" style="flex:1;min-width:120px;">
          ♡ Add to Watchlist
        </button>
        <button class="outline" onclick="alert('AR Viewer coming soon!')" style="flex:1;min-width:120px;">
          📷 View in AR
        </button>
      </div>
    `;
    
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  } catch (error) {
    console.error('Open detail error:', error);
    alert('Failed to load details. Please try again.');
  }
}

function closeDetail() {
  const modal = document.getElementById('detailModal');
  modal.classList.add('hidden');
  document.body.style.overflow = '';
}

async function addToWatchlist(type, id) {
  try {
    const user = await checkUser();
    if (!user) {
      openAuth('login');
      return;
    }
    
    const result = await api(`/api/watchlist/${type}/${id}`, { method: 'POST' });
    
    const msg = document.createElement('div');
    msg.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:linear-gradient(110deg,#ff3f82,#9a5cff);color:white;padding:15px 30px;border-radius:12px;z-index:9999;box-shadow:0 10px 30px rgba(0,0,0,.3);';
    msg.textContent = result.saved ? 'Added to watchlist!' : 'Removed from watchlist';
    document.body.appendChild(msg);
    setTimeout(() => msg.remove(), 3000);
  } catch (error) {
    alert('Failed to update watchlist');
  }
}

async function loadProfile() {
  const user = await checkUser();
  if (!user) return;
  
  try {
    const watchlist = await api('/api/watchlist');
    const grid = document.getElementById('watchlistGrid');
    
    if (watchlist && watchlist.length > 0) {
      grid.innerHTML = watchlist.map(item => `
        <div class="media-card">
          <div class="media-info">
            <h3>${item.content_type}</h3>
            <p class="muted">Added: ${new Date(item.created_at).toLocaleDateString()}</p>
          </div>
        </div>
      `).join('');
    } else {
      grid.innerHTML = '<p class="muted" style="text-align:center;padding:20px;">Your watchlist is empty.</p>';
    }
  } catch (error) {
    console.error('Load profile error:', error);
  }
}

// Close modals on outside click
document.getElementById('authModal').addEventListener('click', (e) => {
  if (e.target.id === 'authModal') closeAuth();
});

document.getElementById('detailModal').addEventListener('click', (e) => {
  if (e.target.id === 'detailModal') closeDetail();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeAuth();
    closeDetail();
  }
});

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  checkUser();
  loadAnime(1);
  loadTvShows();
  
  const yearEl = document.getElementById('yearNow');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
});
