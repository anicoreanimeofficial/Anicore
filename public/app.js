const API = "https://anicore-f6f4.onrender.com";

let animeList = [];
let currentUser = null;
let authMode = "login";
let editingEpisodeAnime = null;

const $ = id => document.getElementById(id);

async function api(path, options = {}) {
  const response = await fetch(API + path, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  let data = {};
  try { data = await response.json(); } catch {}

  if (!response.ok) {
    throw new Error(data.detail || "Something went wrong");
  }

  return data;
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function imageURL(url) {
  return url || "https://placehold.co/400x600/17101e/ffffff?text=ANICORE";
}

function notify(message) {
  alert(message);
}

// ---------------- AUTH ----------------

function openAuth() {
  $("authModal").classList.remove("hidden");
  $("authMessage").textContent = "";
}

function closeAuth() {
  $("authModal").classList.add("hidden");
}

function setAuthMode(mode) {
  authMode = mode;
  const login = mode === "login";

  $("authTitle").textContent = login ? "Welcome back" : "Create account";
  $("authSubtitle").textContent = login
    ? "Sign in to your Anicore account."
    : "Join Anicore and build your anime collection.";
  $("authSubmit").textContent = login ? "Sign in" : "Create account";
  $("switchText").textContent = login
    ? "Don't have an account?"
    : "Already have an account?";
  $("switchAuth").textContent = login ? "Create account" : "Sign in";
}

$("authOpen").onclick = openAuth;
$("authClose").onclick = closeAuth;

$("switchAuth").onclick = () => {
  setAuthMode(authMode === "login" ? "register" : "login");
};

$("authForm").onsubmit = async event => {
  event.preventDefault();

  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;

  try {
    const result = await api(
      authMode === "login" ? "/api/auth/login" : "/api/auth/register",
      {
        method: "POST",
        body: JSON.stringify({ email, password })
      }
    );

    $("authMessage").textContent = result.message || "Success!";
    closeAuth();
    await loadUser();
    notify("Welcome to Anicore!");

  } catch (error) {
    $("authMessage").textContent = error.message;
  }
};

$("logoutBtn").onclick = async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
    currentUser = null;
    updateHeader();
    renderWatchlist();
    notify("Signed out");
  } catch (error) {
    notify(error.message);
  }
};

async function loadUser() {
  try {
    const data = await api("/api/auth/me");
    currentUser = data.authenticated ? data : null;
  } catch {
    currentUser = null;
  }

  updateHeader();
  renderWatchlist();
}

function updateHeader() {
  $("authOpen").classList.toggle("hidden", !!currentUser);
  $("logoutBtn").classList.toggle("hidden", !currentUser);

  const isAdmin = currentUser?.role === "admin";
  $("adminOpen").classList.toggle("hidden", !isAdmin);
  $("adminPanel").classList.toggle("hidden", !isAdmin);
}

// ---------------- ANIME ----------------

async function loadAnime() {
  try {
    animeList = await api("/api/anime");
    renderAnime();
    renderWatchlist();
    populateAnimeSelect();
    renderAdminList();
  } catch (error) {
    $("animeGrid").innerHTML =
      `<p class="muted">${escapeHTML(error.message)}. Check the API connection.</p>`;
  }
}

function renderAnime(list = animeList) {
  $("animeCount").textContent = `${list.length} titles`;

  if (!list.length) {
    $("animeGrid").innerHTML = `<p class="muted">No anime found yet.</p>`;
    return;
  }

  $("animeGrid").innerHTML = list.map(anime => `
    <article class="anime-card" onclick="openAnime('${anime._id}')">
      <img src="${escapeHTML(imageURL(anime.poster))}"
           alt="${escapeHTML(anime.title)}"
           loading="lazy"
           onerror="this.src='https://placehold.co/400x600/17101e/ffffff?text=ANICORE'">
      <div class="anime-info">
        <h3>${escapeHTML(anime.title)}</h3>
        <p>${escapeHTML(anime.status || "Anime")} · ${escapeHTML(anime.year || "")}</p>
      </div>
    </article>
  `).join("");
}

function filterAnime() {
  const search = $("search").value.toLowerCase().trim();
  const genre = $("genreFilter").value.toLowerCase();

  const filtered = animeList.filter(anime => {
    const matchesName = anime.title.toLowerCase().includes(search);
    const genres = (anime.genres || []).map(g => g.toLowerCase());
    const matchesGenre = !genre || genres.includes(genre);

    return matchesName && matchesGenre;
  });

  renderAnime(filtered);
}

$("search").addEventListener("input", filterAnime);
$("genreFilter").addEventListener("change", filterAnime);

// ---------------- ANIME DETAILS ----------------

async function openAnime(id) {
  const anime = animeList.find(item => item._id === id);
  if (!anime) return;

  const episodes = anime.episodes || [];

  $("detailContent").innerHTML = `
    ${anime.banner ? `<img class="detail-banner" src="${escapeHTML(anime.banner)}" alt="">` : ""}
    <h2>${escapeHTML(anime.title)}</h2>
    <p class="muted">${escapeHTML((anime.genres || []).join(" · "))}</p>
    <p>${escapeHTML(anime.description || "No description available.")}</p>
    <p class="muted">${escapeHTML(anime.status || "")} · ${escapeHTML(anime.year || "")} · Rating: ${escapeHTML(anime.rating || "N/A")}</p>
    <button class="outline" onclick="toggleWatchlist('${anime._id}')">♡ Add / Remove Watchlist</button>
    <h3>Episodes (${episodes.length})</h3>
    <div>
      ${episodes.length ? episodes.map((ep, index) => `
        <div class="episode-row">
          <div>
            <strong>Season ${Number(ep.season || 1)} · Episode ${Number(ep.episode)}</strong>
            <small>${escapeHTML(ep.title || "Episode " + ep.episode)} ${ep.duration ? "· " + escapeHTML(ep.duration) : ""}</small>
          </div>
          <button class="primary" onclick="watchTelegram('${encodeURIComponent(ep.telegram_url)}')">Watch Now</button>
        </div>
      `).join("") : `<p class="muted">Episodes coming soon.</p>`}
    </div>
  `;

  $("detailModal").classList.remove("hidden");
}

function watchTelegram(encodedURL) {
  const url = decodeURIComponent(encodedURL);
  window.open(url, "_blank", "noopener,noreferrer");
}

$("detailClose").onclick = () => {
  $("detailModal").classList.add("hidden");
};

$("detailModal").onclick = event => {
  if (event.target === $("detailModal")) {
    $("detailModal").classList.add("hidden");
  }
};

// ---------------- WATCHLIST ----------------

function renderWatchlist() {
  if (!currentUser) {
    $("watchlistGrid").innerHTML =
      `<p class="muted">Sign in to use your watchlist.</p>`;
    return;
  }

  const saved = currentUser.watchlist || [];
  const list = animeList.filter(anime => saved.includes(anime._id));

  if (!list.length) {
    $("watchlistGrid").innerHTML =
      `<p class="muted">Your watchlist is empty.</p>`;
    return;
  }

  $("watchlistGrid").innerHTML = list.map(anime => `
    <article class="anime-card" onclick="openAnime('${anime._id}')">
      <img src="${escapeHTML(imageURL(anime.poster))}" alt="">
      <div class="anime-info">
        <h3>${escapeHTML(anime.title)}</h3>
      </div>
    </article>
  `).join("");
}

async function toggleWatchlist(id) {
  if (!currentUser) {
    openAuth();
    return;
  }

  try {
    await api(`/api/watchlist/${id}`, { method: "POST" });
    await loadUser();
    notify("Watchlist updated");
  } catch (error) {
    notify(error.message);
  }
}

// ---------------- ADMIN ----------------

$("adminOpen").onclick = () => {
  $("adminPanel").scrollIntoView({ behavior: "smooth" });
};

$("refreshAdmin").onclick = loadAnime;

function populateAnimeSelect() {
  $("episodeAnime").innerHTML =
    `<option value="">Choose anime</option>` +
    animeList.map(anime =>
      `<option value="${anime._id}">${escapeHTML(anime.title)}</option>`
    ).join("");
}

function renderAdminList() {
  if (currentUser?.role !== "admin") return;

  if (!animeList.length) {
    $("adminAnimeList").innerHTML = `<p class="muted">No anime added yet.</p>`;
    return;
  }

  $("adminAnimeList").innerHTML = animeList.map(anime => `
    <div class="manager-item">
      <h4>${escapeHTML(anime.title)}</h4>
      <p class="muted">${(anime.episodes || []).length} episodes</p>
      <div class="manager-actions">
        <button class="outline" onclick="editAnime('${anime._id}')">Edit Anime</button>
        <button class="outline" onclick="deleteAnime('${anime._id}')">Delete Anime</button>
        <button class="outline" onclick="prepareEpisode('${anime._id}')">Add Episode</button>
        ${(anime.episodes || []).map((ep, index) => `
          <button class="outline" onclick="editEpisode('${anime._id}', ${index})">
            Edit E${Number(ep.episode)}
          </button>
          <button class="outline" onclick="deleteEpisode('${anime._id}', ${index})">
            Delete E${Number(ep.episode)}
          </button>
        `).join("")}
      </div>
    </div>
  `).join("");
}

function requireAdmin() {
  if (currentUser?.role !== "admin") {
    notify("Admin login required");
    return false;
  }
  return true;
}

$("animeForm").onsubmit = async event => {
  event.preventDefault();
  if (!requireAdmin()) return;

  const id = $("animeId").value;

  const data = {
    title: $("animeTitle").value.trim(),
    description: $("animeDescription").value,
    genres: $("animeGenres").value.split(",").map(x => x.trim()).filter(Boolean),
    year: $("animeYear").value ? Number($("animeYear").value) : null,
    rating: $("animeRating").value,
    poster: $("animePoster").value,
    banner: $("animeBanner").value,
    status: $("animeStatus").value
  };

  try {
    await api(id ? `/api/admin/anime/${id}` : "/api/admin/anime", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(data)
    });

    clearAnimeForm();
    await loadAnime();
    notify("Anime saved successfully!");
  } catch (error) {
    notify(error.message);
  }
};

function editAnime(id) {
  if (!requireAdmin()) return;

  const anime = animeList.find(a => a._id === id);
  if (!anime) return;

  $("animeId").value = anime._id;
  $("animeTitle").value = anime.title || "";
  $("animeDescription").value = anime.description || "";
  $("animeGenres").value = (anime.genres || []).join(", ");
  $("animeYear").value = anime.year || "";
  $("animeRating").value = anime.rating || "";
  $("animePoster").value = anime.poster || "";
  $("animeBanner").value = anime.banner || "";
  $("animeStatus").value = anime.status || "Ongoing";

  $("animeForm").scrollIntoView({ behavior: "smooth" });
}

async function deleteAnime(id) {
  if (!requireAdmin() || !confirm("Delete this anime and its episodes?")) return;

  try {
    await api(`/api/admin/anime/${id}`, { method: "DELETE" });
    await loadAnime();
    notify("Anime deleted");
  } catch (error) {
    notify(error.message);
  }
}

function clearAnimeForm() {
  $("animeForm").reset();
  $("animeId").value = "";
}

$("clearAnime").onclick = clearAnimeForm;

function prepareEpisode(animeId) {
  if (!requireAdmin()) return;

  $("episodeForm").reset();
  $("episodeIndex").value = "";
  $("episodeSeason").value = "1";
  $("episodeAnime").value = animeId;
  $("episodeForm").scrollIntoView({ behavior: "smooth" });
}

$("episodeForm").onsubmit = async event => {
  event.preventDefault();
  if (!requireAdmin()) return;

  const animeId = $("episodeAnime").value;
  const index = $("episodeIndex").value;

  if (!animeId) {
    notify("Choose an anime");
    return;
  }

  const data = {
    season: Number($("episodeSeason").value || 1),
    episode: Number($("episodeNumber").value),
    title: $("episodeTitle").value,
    telegram_url: $("telegramUrl").value.trim(),
    description: $("episodeDescription").value,
    thumbnail: $("episodeThumbnail").value,
    duration: $("episodeDuration").value
  };

  try {
    const path = index === ""
      ? `/api/admin/anime/${animeId}/episodes`
      : `/api/admin/anime/${animeId}/episodes/${index}`;

    await api(path, {
      method: index === "" ? "POST" : "PUT",
      body: JSON.stringify(data)
    });

    clearEpisodeForm();
    await loadAnime();
    notify("Episode saved successfully!");
  } catch (error) {
    notify(error.message);
  }
};

function editEpisode(animeId, index) {
  if (!requireAdmin()) return;

  const anime = animeList.find(a => a._id === animeId);
  const ep = anime?.episodes?.[index];
  if (!ep) return;

  $("episodeAnime").value = animeId;
  $("episodeIndex").value = index;
  $("episodeSeason").value = ep.season || 1;
  $("episodeNumber").value = ep.episode || "";
  $("episodeTitle").value = ep.title || "";
  $("telegramUrl").value = ep.telegram_url || "";
  $("episodeDescription").value = ep.description || "";
  $("episodeThumbnail").value = ep.thumbnail || "";
  $("episodeDuration").value = ep.duration || "";

  $("episodeForm").scrollIntoView({ behavior: "smooth" });
}

async function deleteEpisode(animeId, index) {
  if (!requireAdmin() || !confirm("Delete this episode?")) return;

  try {
    await api(`/api/admin/anime/${animeId}/episodes/${index}`, {
      method: "DELETE"
    });
    await loadAnime();
    notify("Episode deleted");
  } catch (error) {
    notify(error.message);
  }
}

function clearEpisodeForm() {
  $("episodeForm").reset();
  $("episodeIndex").value = "";
  $("episodeSeason").value = "1";
}

$("clearEpisode").onclick = clearEpisodeForm;

// ---------------- START ----------------

$("yearNow").textContent = new Date().getFullYear();

async function startApp() {
  await loadUser();
  await loadAnime();
}

startApp();
