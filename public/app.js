// ============================================================
// ANICORE - FRONTEND APPLICATION
// This file controls navigation, API calls and page rendering.
// ============================================================

const API = "https://anicore-f6f4.onrender.com";

let animeList = [];
let movieList = [];
let currentUser = null;
let authMode = "login";
let activeContent = null;


// ============================================================
// GENERAL HELPERS
// ============================================================

// Short helper for finding HTML elements by their ID.
const $ = id => document.getElementById(id);

// Escape text before inserting it into HTML.
function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

// Use a placeholder when no poster is available.
function imageURL(url) {
  return url || "https://placehold.co/400x600/17101e/ffffff?text=ANICORE";
}

// Display a simple message.
function notify(message) {
  alert(message);
}

// Split comma-separated values into a clean list.
function splitList(value) {
  return value.split(",").map(item => item.trim()).filter(Boolean);
}

// Format a date for comments and requests.
function formatDate(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleDateString();
}


// ============================================================
// API HELPER
// All requests use credentials so the login cookie is sent.
// ============================================================

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

  try {
    data = await response.json();
  } catch {
    // Some responses may not contain JSON.
  }

  if (!response.ok) {
    throw new Error(data.detail || "Something went wrong.");
  }

  return data;
}


// ============================================================
// PAGE NAVIGATION
// The website uses app-style screens without page reloads.
// ============================================================

function showPage(page) {
  // Only admins can open the admin screen.
  if (page === "admin" && currentUser?.role !== "admin") {
    notify("Admin access required.");
    return;
  }

  // Show the selected screen and hide the others.
  document.querySelectorAll(".page").forEach(section => {
    section.classList.toggle("active", section.id === `page-${page}`);
  });

  // Highlight the selected bottom navigation button.
  document.querySelectorAll(".bottom-nav button").forEach(button => {
    button.classList.toggle("active", button.dataset.page === page);
  });

  // Update profile and requests when opening Profile.
  if (page === "profile") {
    renderProfile();
    loadMyRequests();
  }

  // Refresh watchlist when opening Watchlist.
  if (page === "watchlist") {
    loadWatchlist();
  }

  // Load admin data when opening Admin.
  if (page === "admin") {
    loadAdminData();
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}


// Connect each bottom navigation button to its screen.
$("bottomNav").querySelectorAll("button").forEach(button => {
  button.addEventListener("click", () => {
    const page = button.dataset.page;

    if (page === "profile" && !currentUser) {
      openAuth();
      return;
    }

    if (page === "watchlist" && !currentUser) {
      openAuth();
      return;
    }

    showPage(page);
  });
});


// ============================================================
// AUTHENTICATION
// ============================================================

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
    ? "Sign in to your ANICORE account."
    : "Join ANICORE and build your collection.";

  $("authSubmit").textContent = login ? "Sign in" : "Create account";

  $("switchText").textContent = login
    ? "Don't have an account?"
    : "Already have an account?";

  $("switchAuth").textContent = login ? "Create account" : "Sign in";
}

$("authOpen").onclick = openAuth;
$("profileAuthButton").onclick = openAuth;
$("authClose").onclick = closeAuth;

$("switchAuth").onclick = () => {
  setAuthMode(authMode === "login" ? "register" : "login");
};

$("authModal").addEventListener("click", event => {
  if (event.target === $("authModal")) closeAuth();
});

$("authForm").onsubmit = async event => {
  event.preventDefault();

  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;

  try {
    const result = await api(
      authMode === "login"
        ? "/api/auth/login"
        : "/api/auth/register",
      {
        method: "POST",
        body: JSON.stringify({ email, password })
      }
    );

    await loadUser();

    closeAuth();
    $("authForm").reset();

    notify(result.message || "Welcome to ANICORE!");

  } catch (error) {
    $("authMessage").textContent = error.message;
  }
};


// Sign out the current account.
$("logoutBtn").onclick = async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });

    currentUser = null;

    updateHeader();
    renderProfile();

    notify("You have signed out.");

    showPage("home");

  } catch (error) {
    notify(error.message);
  }
};


// Load the current login session.
async function loadUser() {
  try {
    const data = await api("/api/auth/me");
    currentUser = data.authenticated ? data : null;
  } catch {
    currentUser = null;
  }

  updateHeader();
}


// Update buttons based on the signed-in account.
function updateHeader() {
  $("authOpen").classList.toggle("hidden", !!currentUser);
  $("logoutBtn").classList.toggle("hidden", !currentUser);

  renderProfile();
}


// ============================================================
// PROFILE
// ============================================================

function renderProfile() {
  if (!currentUser) {
    $("profileEmail").textContent = "Not signed in";
    $("profileRole").textContent = "Sign in to access your profile.";
    $("profileAuthButton").classList.remove("hidden");
    return;
  }

  $("profileEmail").textContent = currentUser.email;
  $("profileRole").textContent =
    currentUser.role === "admin" ? "ANICORE Administrator" : "ANICORE Member";

  $("profileAuthButton").classList.add("hidden");
}


// ============================================================
// POSTER CARD GENERATOR
// Shared by Anime, Movies, Home and Watchlist.
// ============================================================

function mediaCard(item, type) {
  const id = escapeHTML(item._id);
  const title = escapeHTML(item.title || "Untitled");
  const tag = item.poster_tag
    ? `<span class="poster-tag">${escapeHTML(item.poster_tag)}</span>`
    : "";

  const dubbed = (item.dubbed_on || []).join(", ");

  const dubLabel = dubbed
    ? `<span class="dub-label">Dub: ${escapeHTML(dubbed)}</span>`
    : "";

  return `
    <article class="media-card" onclick="openDetails('${id}', '${type}')">
      <div class="poster-wrap">
        <img
          src="${escapeHTML(imageURL(item.poster))}"
          alt="${title}"
          loading="lazy"
          onerror="this.src='https://placehold.co/400x600/17101e/ffffff?text=ANICORE'"
        >
        ${tag}
        ${dubLabel}
      </div>

      <div class="media-info">
        <h3>${title}</h3>
        <p>
          ${escapeHTML(item.status || (type === "movie" ? "Movie" : "Anime"))}
          ${item.year ? " · " + escapeHTML(item.year) : ""}
        </p>
      </div>
    </article>
  `;
}


// ============================================================
// ANIME CATALOGUE
// ============================================================

async function loadAnime() {
  try {
    animeList = await api("/api/anime");

    renderAnime();
    renderHomeAnime();
    populateAnimeSelect();
    renderAdminAnime();

  } catch (error) {
    $("animeGrid").innerHTML =
      `<p class="muted">${escapeHTML(error.message)}</p>`;
  }
}

function renderAnime(list = animeList) {
  $("animeCount").textContent = `${list.length} titles`;

  $("animeGrid").innerHTML = list.length
    ? list.map(item => mediaCard(item, "anime")).join("")
    : `<p class="muted">No anime found.</p>`;
}

function renderHomeAnime() {
  $("homeAnimeGrid").innerHTML = animeList.length
    ? animeList.slice(0, 6).map(item => mediaCard(item, "anime")).join("")
    : `<p class="muted">No anime available yet.</p>`;
}

function filterAnime() {
  const search = $("search").value.toLowerCase().trim();
  const genre = $("genreFilter").value.toLowerCase();

  const filtered = animeList.filter(item => {
    const title = (item.title || "").toLowerCase();
    const genres = (item.genres || []).map(value => value.toLowerCase());

    return title.includes(search) && (!genre || genres.includes(genre));
  });

  renderAnime(filtered);
}

$("search").addEventListener("input", filterAnime);
$("genreFilter").addEventListener("change", filterAnime);


// ============================================================
// MOVIES
// ============================================================

async function loadMovies() {
  try {
    movieList = await api("/api/movies");

    renderMovies();
    renderHomeMovies();
    renderAdminMovies();

  } catch (error) {
    $("movieGrid").innerHTML =
      `<p class="muted">${escapeHTML(error.message)}</p>`;
  }
}

function renderMovies(list = movieList) {
  $("movieCount").textContent = `${list.length} movies`;

  $("movieGrid").innerHTML = list.length
    ? list.map(item => mediaCard(item, "movie")).join("")
    : `<p class="muted">No movies available yet.</p>`;
}

function renderHomeMovies() {
  $("homeMovieGrid").innerHTML = movieList.length
    ? movieList.slice(0, 6).map(item => mediaCard(item, "movie")).join("")
    : `<p class="muted">No movies available yet.</p>`;
}

$("movieSearch").addEventListener("input", () => {
  const search = $("movieSearch").value.toLowerCase().trim();

  const filtered = movieList.filter(item =>
    (item.title || "").toLowerCase().includes(search)
  );

  renderMovies(filtered);
});


// ============================================================
// DETAIL SCREEN AND VIDEO QUALITY LINKS
// ============================================================

async function openDetails(id, type) {
  const collection = type === "anime" ? animeList : movieList;
  const item = collection.find(entry => entry._id === id);

  if (!item) return;

  activeContent = { id, type };

  const dubbed = item.dubbed_on || [];
  const episodes = item.episodes || [];

  const qualityLinks = linksHTML(item.quality_links || {});

  let episodeHTML = "";

  if (type === "anime") {
    episodeHTML = episodes.length
      ? episodes.map((episode, index) => `
          <div class="episode-row">
            <div>
              <strong>
                Season ${Number(episode.season || 1)}
                · Episode ${Number(episode.episode || index + 1)}
              </strong>
              <small>
                ${escapeHTML(episode.title || "Episode " + episode.episode)}
                ${episode.duration ? " · " + escapeHTML(episode.duration) : ""}
              </small>
              ${episode.description
                ? `<small>${escapeHTML(episode.description)}</small>`
                : ""}
              ${linksHTML(episode.quality_links || {})}
            </div>
          </div>
        `).join("")
      : `<p class="muted">Episodes coming soon.</p>`;
  }

  $("detailContent").innerHTML = `
    ${item.banner
      ? `<img class="detail-banner" src="${escapeHTML(item.banner)}" alt="">`
      : ""}

    <img class="detail-poster"
         src="${escapeHTML(imageURL(item.poster))}"
         alt="${escapeHTML(item.title)}">

    <h2>${escapeHTML(item.title)}</h2>

    <p class="muted">
      ${(item.genres || []).map(escapeHTML).join(" · ")}
    </p>

    <p>${escapeHTML(item.description || "No description available.")}</p>

    <p class="muted">
      ${escapeHTML(item.status || (type === "movie" ? "Movie" : ""))}
      ${item.year ? " · " + escapeHTML(item.year) : ""}
      · Rating: ${escapeHTML(item.rating || "N/A")}
    </p>

    ${dubbed.length
      ? `<p><strong>Dubbed on:</strong> ${dubbed.map(escapeHTML).join(", ")}</p>`
      : ""}

    <button class="outline"
            onclick="toggleWatchlist('${id}', '${type}')">
      ♡ Add / Remove Watchlist
    </button>

    ${type === "movie"
      ? `<h3>Available Qualities</h3>${qualityLinks}`
      : `<h3>Episodes (${episodes.length})</h3>${episodeHTML}`}

    <div class="comments-area">
      <h3>Comments</h3>
      <div id="commentsList"><p class="muted">Loading comments...</p></div>

      <form id="commentForm" class="comment-form">
        <textarea id="commentText" maxlength="1000"
          placeholder="${currentUser ? "Write a comment..." : "Sign in to write a comment."}"
          ${currentUser ? "" : "disabled"}></textarea>

        <button class="primary" type="submit" ${currentUser ? "" : "disabled"}>
          Post Comment
        </button>
      </form>

      ${!currentUser
        ? `<p class="hint">You must sign in to post a comment.</p>
           <button class="outline" onclick="openAuth()">Sign in</button>`
        : ""}
    </div>
  `;

  $("detailModal").classList.remove("hidden");

  $("commentForm").onsubmit = event => {
    event.preventDefault();
    submitComment();
  };

  await loadComments(id, type);
}


// Turn quality URLs into safe external links.
function linksHTML(links = {}) {
  const qualities = [
    ["480p", "480p"],
    ["720p", "720p"],
    ["1080p", "1080p"],
    ["4k", "4K"]
  ];

  const available = qualities.filter(([key]) => links[key]);

  if (!available.length) {
    return `<p class="muted">No quality links available.</p>`;
  }

  return `
    <div class="quality-list">
      ${available.map(([key, label]) => {
        const url = safeExternalURL(links[key]);

        return url
          ? `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`
          : "";
      }).join("")}
    </div>
  `;
}


// Only open HTTPS links with a valid hostname.
function safeExternalURL(value) {
  try {
    const parsed = new URL(value);

    if (parsed.protocol !== "https:") return "";

    return parsed.href;
  } catch {
    return "";
  }
}


// ============================================================
// COMMENTS
// ============================================================

async function loadComments(id, type) {
  try {
    const list = await api(
      `/api/comments/${type}/${encodeURIComponent(id)}`
    );

    const container = $("commentsList");

    if (!list.length) {
      container.innerHTML = `<p class="muted">No comments yet. Be the first!</p>`;
      return;
    }

    container.innerHTML = list.map(comment => {
      const canDelete = currentUser &&
        (currentUser.role === "admin" ||
         comment.username === currentUser.email.split("@")[0]);

      return `
        <div class="comment-item">
          <div class="comment-meta">
            <strong>${escapeHTML(comment.username)}</strong>
            <span>${escapeHTML(formatDate(comment.created_at))}</span>
          </div>

          <p>${escapeHTML(comment.text)}</p>

          ${canDelete
            ? `<button class="outline"
                       onclick="deleteComment('${escapeHTML(comment._id)}')">
                 Delete
               </button>`
            : ""}
        </div>
      `;
    }).join("");

  } catch (error) {
    $("commentsList").innerHTML =
      `<p class="muted">${escapeHTML(error.message)}</p>`;
  }
}

async function submitComment() {
  if (!currentUser) {
    openAuth();
    return;
  }

  if (!activeContent) return;

  const text = $("commentText").value.trim();

  if (!text) {
    notify("Write a comment first.");
    return;
  }

  try {
    await api("/api/comments", {
      method: "POST",
      body: JSON.stringify({
        content_type: activeContent.type,
        content_id: activeContent.id,
        text
      })
    });

    await loadComments(activeContent.id, activeContent.type);

  } catch (error) {
    notify(error.message);
  }
}

async function deleteComment(id) {
  if (!confirm("Delete this comment?")) return;

  try {
    await api(`/api/comments/${id}`, { method: "DELETE" });

    if (activeContent) {
      await loadComments(activeContent.id, activeContent.type);
    }

  } catch (error) {
    notify(error.message);
  }
}


// ============================================================
// WATCHLIST
// ============================================================

async function toggleWatchlist(id, type) {
  if (!currentUser) {
    openAuth();
    return;
  }

  try {
    const result = await api(
      `/api/watchlist/${type}/${id}`,
      { method: "POST" }
    );

    notify(result.saved ? "Added to watchlist." : "Removed from watchlist.");

    await loadWatchlist();

  } catch (error) {
    notify(error.message);
  }
}

async function loadWatchlist() {
  if (!currentUser) {
    $("watchlistGrid").innerHTML =
      `<p class="muted">Sign in to use your watchlist.</p>`;
    return;
  }

  try {
    const saved = await api("/api/watchlist");

    const cards = saved.map(entry => {
      const collection = entry.content_type === "anime"
        ? animeList
        : movieList;

      const item = collection.find(value => value._id === entry.content_id);

      return item ? mediaCard(item, entry.content_type) : "";
    }).filter(Boolean);

    $("watchlistGrid").innerHTML = cards.length
      ? cards.join("")
      : `<p class="muted">Your watchlist is empty.</p>`;

  } catch (error) {
    $("watchlistGrid").innerHTML =
      `<p class="muted">${escapeHTML(error.message)}</p>`;
  }
}


// ============================================================
// ANIME REQUESTS
// ============================================================

$("requestOpen").onclick = () => {
  if (!currentUser) {
    openAuth();
    return;
  }

  $("requestModal").classList.remove("hidden");
  $("requestMessage").textContent = "";
};

$("requestClose").onclick = () => {
  $("requestModal").classList.add("hidden");
};

$("requestModal").addEventListener("click", event => {
  if (event.target === $("requestModal")) {
    $("requestModal").classList.add("hidden");
  }
});

$("requestForm").onsubmit = async event => {
  event.preventDefault();

  if (!currentUser) {
    openAuth();
    return;
  }

  const data = {
    title: $("requestTitle").value.trim(),
    language: $("requestLanguage").value,
    notes: $("requestNotes").value.trim()
  };

  try {
    const result = await api("/api/requests", {
      method: "POST",
      body: JSON.stringify(data)
    });

    $("requestMessage").textContent = result.message;
    $("requestForm").reset();

    await loadMyRequests();

  } catch (error) {
    $("requestMessage").textContent = error.message;
  }
};


// Display the signed-in user's requests.
async function loadMyRequests() {
  if (!currentUser) {
    $("myRequests").innerHTML =
      `<p class="muted">Sign in to see your requests.</p>`;
    return;
  }

  try {
    const items = await api("/api/requests/mine");

    $("myRequests").innerHTML = items.length
      ? items.map(item => `
          <div class="manager-item">
            <strong>${escapeHTML(item.title)}</strong>
            <p class="muted">
              ${escapeHTML(item.language)}
              · ${escapeHTML(item.status)}
              · ${escapeHTML(formatDate(item.created_at))}
            </p>
          </div>
        `).join("")
      : `<p class="muted">You have not requested any anime yet.</p>`;

  } catch (error) {
    $("myRequests").innerHTML =
      `<p class="muted">${escapeHTML(error.message)}</p>`;
  }
}


// ============================================================
// ADMIN ACCESS AND DATA
// ============================================================

function requireAdmin() {
  if (currentUser?.role !== "admin") {
    notify("Admin login required.");
    return false;
  }

  return true;
}

$("refreshAdmin").onclick = loadAdminData;

async function loadAdminData() {
  if (!requireAdmin()) return;

  await Promise.all([
    loadAnime(),
    loadMovies(),
    loadAdminRequests()
  ]);
}


// ============================================================
// ADMIN - ANIME FORM
// ============================================================

function populateAnimeSelect() {
  $("episodeAnime").innerHTML =
    `<option value="">Choose anime</option>` +
    animeList.map(item => `
      <option value="${escapeHTML(item._id)}">
        ${escapeHTML(item.title)}
      </option>
    `).join("");
}

$("animeForm").onsubmit = async event => {
  event.preventDefault();

  if (!requireAdmin()) return;

  const id = $("animeId").value;

  const data = {
    title: $("animeTitle").value.trim(),
    description: $("animeDescription").value,
    genres: splitList($("animeGenres").value),
    year: $("animeYear").value ? Number($("animeYear").value) : null,
    rating: $("animeRating").value.trim(),
    poster: $("animePoster").value.trim(),
    banner: $("animeBanner").value.trim(),
    status: $("animeStatus").value,
    poster_tag: $("animeTag").value,
    dubbed_on: splitList($("animeDubbedOn").value)
  };

  try {
    await api(
      id ? `/api/admin/anime/${id}` : "/api/admin/anime",
      {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(data)
      }
    );

    clearAnimeForm();
    await loadAnime();

    notify("Anime saved successfully.");

  } catch (error) {
    notify(error.message);
  }
};

function editAnime(id) {
  if (!requireAdmin()) return;

  const item = animeList.find(value => value._id === id);

  if (!item) return;

  $("animeId").value = item._id;
  $("animeTitle").value = item.title || "";
  $("animeDescription").value = item.description || "";
  $("animeGenres").value = (item.genres || []).join(", ");
  $("animeYear").value = item.year || "";
  $("animeRating").value = item.rating || "";
  $("animePoster").value = item.poster || "";
  $("animeBanner").value = item.banner || "";
  $("animeStatus").value = item.status || "Ongoing";
  $("animeTag").value = item.poster_tag || "";
  $("animeDubbedOn").value = (item.dubbed_on || []).join(", ");

  $("animeForm").scrollIntoView({ behavior: "smooth" });
}

async function deleteAnime(id) {
  if (!requireAdmin()) return;

  if (!confirm("Delete this anime and all its episodes?")) return;

  try {
    await api(`/api/admin/anime/${id}`, { method: "DELETE" });
    await loadAnime();

    notify("Anime deleted.");

  } catch (error) {
    notify(error.message);
  }
}

function clearAnimeForm() {
  $("animeForm").reset();
  $("animeId").value = "";
}

$("clearAnime").onclick = clearAnimeForm;


// Display admin anime controls.
function renderAdminAnime() {
  if (currentUser?.role !== "admin") return;

  $("adminAnimeList").innerHTML = animeList.length
    ? animeList.map(item => `
        <div class="manager-item">
          <h4>${escapeHTML(item.title)}</h4>
          <p class="muted">${(item.episodes || []).length} episodes</p>

          <div class="manager-actions">
            <button class="outline" onclick="editAnime('${item._id}')">Edit</button>
            <button class="outline" onclick="deleteAnime('${item._id}')">Delete</button>
            <button class="outline" onclick="prepareEpisode('${item._id}')">Add Episode</button>

            ${(item.episodes || []).map((ep, index) => `
              <button class="outline"
                      onclick="editEpisode('${item._id}', ${index})">
                Edit E${Number(ep.episode)}
              </button>
              <button class="outline"
                      onclick="deleteEpisode('${item._id}', ${index})">
                Delete E${Number(ep.episode)}
              </button>
            `).join("")}
          </div>
        </div>
      `).join("")
    : `<p class="muted">No anime added yet.</p>`;
}


// ============================================================
// ADMIN - EPISODE FORM
// ============================================================

function prepareEpisode(animeId) {
  if (!requireAdmin()) return;

  clearEpisodeForm();
  $("episodeAnime").value = animeId;

  $("episodeForm").scrollIntoView({ behavior: "smooth" });
}

$("episodeForm").onsubmit = async event => {
  event.preventDefault();

  if (!requireAdmin()) return;

  const animeId = $("episodeAnime").value;
  const index = $("episodeIndex").value;

  if (!animeId) {
    notify("Choose an anime.");
    return;
  }

  const data = {
    season: Number($("episodeSeason").value || 1),
    episode: Number($("episodeNumber").value),
    title: $("episodeTitle").value.trim(),
    description: $("episodeDescription").value,
    thumbnail: $("episodeThumbnail").value.trim(),
    duration: $("episodeDuration").value.trim(),
    quality_links: {
      "480p": $("ep480").value.trim(),
      "720p": $("ep720").value.trim(),
      "1080p": $("ep1080").value.trim(),
      "4k": $("ep4k").value.trim()
    }
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

    notify("Episode saved successfully.");

  } catch (error) {
    notify(error.message);
  }
};

function editEpisode(animeId, index) {
  if (!requireAdmin()) return;

  const item = animeList.find(value => value._id === animeId);
  const episode = item?.episodes?.[index];

  if (!episode) return;

  const links = episode.quality_links || {};

  $("episodeAnime").value = animeId;
  $("episodeIndex").value = index;
  $("episodeSeason").value = episode.season || 1;
  $("episodeNumber").value = episode.episode || "";
  $("episodeTitle").value = episode.title || "";
  $("episodeDescription").value = episode.description || "";
  $("episodeThumbnail").value = episode.thumbnail || "";
  $("episodeDuration").value = episode.duration || "";

  $("ep480").value = links["480p"] || "";
  $("ep720").value = links["720p"] || "";
  $("ep1080").value = links["1080p"] || "";
  $("ep4k").value = links["4k"] || "";

  $("episodeForm").scrollIntoView({ behavior: "smooth" });
}

async function deleteEpisode(animeId, index) {
  if (!requireAdmin()) return;

  if (!confirm("Delete this episode?")) return;

  try {
    await api(`/api/admin/anime/${animeId}/episodes/${index}`, {
      method: "DELETE"
    });

    await loadAnime();

    notify("Episode deleted.");

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


// ============================================================
// ADMIN - MOVIE FORM
// ============================================================

$("movieForm").onsubmit = async event => {
  event.preventDefault();

  if (!requireAdmin()) return;

  const id = $("movieId").value;

  const data = {
    title: $("movieTitle").value.trim(),
    description: $("movieDescription").value,
    genres: splitList($("movieGenres").value),
    year: $("movieYear").value ? Number($("movieYear").value) : null,
    rating: $("movieRating").value.trim(),
    poster: $("moviePoster").value.trim(),
    banner: $("movieBanner").value.trim(),
    poster_tag: $("movieTag").value,
    dubbed_on: splitList($("movieDubbedOn").value),
    quality_links: {
      "480p": $("movie480").value.trim(),
      "720p": $("movie720").value.trim(),
      "1080p": $("movie1080").value.trim(),
      "4k": $("movie4k").value.trim()
    }
  };

  try {
    await api(
      id ? `/api/admin/movies/${id}` : "/api/admin/movies",
      {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(data)
      }
    );

    clearMovieForm();
    await loadMovies();

    notify("Movie saved successfully.");

  } catch (error) {
    notify(error.message);
  }
};

function editMovie(id) {
  if (!requireAdmin()) return;

  const item = movieList.find(value => value._id === id);

  if (!item) return;

  const links = item.quality_links || {};

  $("movieId").value = item._id;
  $("movieTitle").value = item.title || "";
  $("movieDescription").value = item.description || "";
  $("movieGenres").value = (item.genres || []).join(", ");
  $("movieYear").value = item.year || "";
  $("movieRating").value = item.rating || "";
  $("moviePoster").value = item.poster || "";
  $("movieBanner").value = item.banner || "";
  $("movieTag").value = item.poster_tag || "";
  $("movieDubbedOn").value = (item.dubbed_on || []).join(", ");

  $("movie480").value = links["480p"] || "";
  $("movie720").value = links["720p"] || "";
  $("movie1080").value = links["1080p"] || "";
  $("movie4k").value = links["4k"] || "";

  $("movieForm").scrollIntoView({ behavior: "smooth" });
}

async function deleteMovie(id) {
  if (!requireAdmin()) return;

  if (!confirm("Delete this movie?")) return;

  try {
    await api(`/api/admin/movies/${id}`, { method: "DELETE" });
    await loadMovies();

    notify("Movie deleted.");

  } catch (error) {
    notify(error.message);
  }
}

function clearMovieForm() {
  $("movieForm").reset();
  $("movieId").value = "";
}

$("clearMovie").onclick = clearMovieForm;


function renderAdminMovies() {
  if (currentUser?.role !== "admin") return;

  $("adminMovieList").innerHTML = movieList.length
    ? movieList.map(item => `
        <div class="manager-item">
          <h4>${escapeHTML(item.title)}</h4>

          <div class="manager-actions">
            <button class="outline" onclick="editMovie('${item._id}')">Edit</button>
            <button class="outline" onclick="deleteMovie('${item._id}')">Delete</button>
          </div>
        </div>
      `).join("")
    : `<p class="muted">No movies added yet.</p>`;
}


// ============================================================
// ADMIN - ANIME REQUEST MANAGEMENT
// ============================================================

async function loadAdminRequests() {
  if (!requireAdmin()) return;

  try {
    const items = await api("/api/admin/requests");

    $("adminRequests").innerHTML = items.length
      ? items.map(item => `
          <div class="request-admin-row">
            <div>
              <strong>${escapeHTML(item.title)}</strong>
              <p class="muted">
                ${escapeHTML(item.language)}
                · ${escapeHTML(item.email)}
                · ${escapeHTML(formatDate(item.created_at))}
              </p>
              <p class="muted">${escapeHTML(item.notes || "")}</p>
            </div>

            <div>
              <select id="status-${escapeHTML(item._id)}">
                ${["Pending", "Approved", "Rejected", "Completed"].map(status => `
                  <option value="${status}"
                    ${item.status === status ? "selected" : ""}>
                    ${status}
                  </option>
                `).join("")}
              </select>

              <button class="outline"
                      onclick="updateRequest('${item._id}')">
                Save
              </button>

              <button class="outline"
                      onclick="deleteRequest('${item._id}')">
                Delete
              </button>
            </div>
          </div>
        `).join("")
      : `<p class="muted">No requests yet.</p>`;

  } catch (error) {
    $("adminRequests").innerHTML =
      `<p class="muted">${escapeHTML(error.message)}</p>`;
  }
}

async function updateRequest(id) {
  if (!requireAdmin()) return;

  const status = $(`status-${id}`).value;

  try {
    await api(`/api/admin/requests/${id}`, {
      method: "PUT",
      body: JSON.stringify({ status })
    });

    await loadAdminRequests();

    notify("Request status updated.");

  } catch (error) {
    notify(error.message);
  }
}

async function deleteRequest(id) {
  if (!requireAdmin()) return;

  if (!confirm("Delete this request?")) return;

  try {
    await api(`/api/admin/requests/${id}`, {
      method: "DELETE"
    });

    await loadAdminRequests();

    notify("Request deleted.");

  } catch (error) {
    notify(error.message);
  }
}


// ============================================================
// MODAL CLOSE CONTROLS
// ============================================================

$("detailClose").onclick = () => {
  $("detailModal").classList.add("hidden");
  activeContent = null;
};

$("detailModal").addEventListener("click", event => {
  if (event.target === $("detailModal")) {
    $("detailModal").classList.add("hidden");
    activeContent = null;
  }
});


// ============================================================
// START APPLICATION
// ============================================================

$("yearNow").textContent = new Date().getFullYear();

async function startApp() {
  setAuthMode("login");

  // Load the account before loading personal data.
  await loadUser();

  // Load catalogue data.
  await Promise.all([
    loadAnime(),
    loadMovies()
  ]);

  // Show the default Home screen.
  showPage("home");
}

startApp();
