
const $ = id => document.getElementById(id);

let currentUser = null;
let toastTimer;
let searchTimer;

function toast(message) {
  const el = $("toast");
  if (!el) return;

  el.textContent = message;
  el.classList.add("show");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.detail || `Request failed (${response.status})`);
  }

  return data;
}

function safeImage(url) {
  return url || "https://placehold.co/400x600/171519/ed2437?text=ANICORE";
}

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function card(anime) {
  const el = document.createElement("article");
  el.className = "anime-card";

  const wrap = document.createElement("div");
  wrap.className = "poster-wrap";

  const img = document.createElement("img");
  img.src = safeImage(anime.poster_url);
  img.alt = anime.title || "Anime poster";
  img.loading = "lazy";

  img.onerror = () => {
    img.onerror = null;
    img.src = "https://placehold.co/400x600/171519/ed2437?text=ANICORE";
  };

  const rating = document.createElement("span");
  rating.className = "rating-pill";
  rating.textContent = `★ ${Number(anime.rating || 0).toFixed(1)}`;

  wrap.append(img, rating);

  const title = document.createElement("h3");
  title.className = "card-title";
  title.textContent = anime.title || "Untitled";

  const meta = document.createElement("p");
  meta.className = "card-meta";
  meta.textContent =
    `${anime.year || "—"} · ${(anime.genres || []).slice(0, 2).join(", ")}`;

  el.append(wrap, title, meta);
  el.addEventListener("click", () => openAnime(anime.id));

  return el;
}

async function loadAnime() {
  const grid = $("anime-grid");
  if (!grid) return;

  const params = new URLSearchParams();
  const search = $("search")?.value.trim();
  const genre = $("genre")?.value;

  if (search) params.set("search", search);
  if (genre) params.set("genre", genre);

  grid.replaceChildren();

  try {
    const items = await api(`/api/anime?${params.toString()}`);

    if (!Array.isArray(items) || !items.length) {
      grid.innerHTML =
        '<div class="empty">No anime found. Check back later!</div>';
      return;
    }

    items.forEach(item => grid.append(card(item)));

  } catch (error) {
    grid.innerHTML =
      `<div class="empty">${escapeText(error.message)}</div>`;
  }
}

async function openAnime(id) {
  try {
    const anime = await api(`/api/anime/${encodeURIComponent(id)}`);
    const box = $("anime-detail");

    box.replaceChildren();

    const banner = document.createElement("img");
    banner.className = "detail-hero";
    banner.src = safeImage(anime.banner_url || anime.poster_url);
    banner.alt = anime.title || "Anime banner";

    const title = document.createElement("h2");
    title.textContent = anime.title || "Untitled";

    const meta = document.createElement("p");
    meta.textContent =
      `${anime.year || "Year unknown"} · ★ ${anime.rating || 0}/10 · ` +
      `${(anime.genres || []).join(", ")} · ${anime.status || ""}`;

    const desc = document.createElement("p");
    desc.textContent = anime.description || "No description available.";

    const actions = document.createElement("div");
    actions.className = "detail-actions";

    if (currentUser) {
      const save = document.createElement("button");
      save.className = "btn btn-red";
      save.textContent = "＋ Add to watchlist";

      save.onclick = async () => {
        try {
          await api(`/api/me/watchlist/${encodeURIComponent(id)}`, {
            method: "POST"
          });

          toast("Added to your watchlist");
          await loadWatchlist();

        } catch (error) {
          toast(error.message);
        }
      };

      actions.append(save);
    } else {
      const signIn = document.createElement("a");
      signIn.className = "btn btn-outline";
      signIn.href = "/login";
      signIn.textContent = "Sign in to save";
      actions.append(signIn);
    }

    const heading = document.createElement("h3");
    heading.textContent = "Episodes";

    const episodes = document.createElement("div");

    if (!Array.isArray(anime.episodes) || !anime.episodes.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "Episodes have not been added yet.";
      episodes.append(empty);

    } else {
      anime.episodes.forEach(ep => {
        const row = document.createElement("div");
        row.className = "episode-row";

        const label = document.createElement("span");
        label.textContent =
          `S${ep.season} · E${ep.episode_number} — ${ep.title || "Episode"}`;

        const play = document.createElement("button");
        play.className = "btn btn-outline";
        play.textContent = "Play";
        play.disabled = !ep.video_url;
        play.onclick = () => playEpisode(ep, episodes);

        row.append(label, play);
        episodes.append(row);
      });
    }

    box.append(banner, title, meta, desc, actions, heading, episodes);
    $("anime-modal").classList.add("open");

  } catch (error) {
    toast(error.message);
  }
}

function playEpisode(ep, container) {
  if (!ep.video_url) {
    toast("No video source added.");
    return;
  }

  try {
    const url = new URL(ep.video_url);

    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("Invalid URL");
    }

  } catch {
    toast("Invalid video URL.");
    return;
  }

  container.querySelector(".video-player")?.remove();

  const video = document.createElement("video");
  video.className = "video-player";
  video.controls = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.src = ep.video_url;

  let lastSaved = -1;

  video.addEventListener("timeupdate", () => {
    if (!currentUser) return;

    const position = Math.floor(video.currentTime);

    if (position < 1 || position % 15 !== 0 || position === lastSaved) {
      return;
    }

    lastSaved = position;

    api("/api/me/progress", {
      method: "POST",
      body: JSON.stringify({
        episode_id: ep.id,
        position_seconds: position,
        duration_seconds: Math.floor(video.duration || 0)
      })
    }).catch(() => {});
  });

  container.prepend(video);
  video.play().catch(() => toast("Press play to start the video."));
}

async function refreshUser() {
  try {
    const data = await api("/api/auth/me");
    currentUser = data.user || null;
  } catch {
    currentUser = null;
  }

  const area = $("account-area");
  if (!area) return;

  area.replaceChildren();

  if (!currentUser) {
    const link = document.createElement("a");
    link.className = "btn btn-outline";
    link.href = "/login";
    link.textContent = "Sign in / Sign up";
    area.append(link);
    return;
  }

  const label = document.createElement("span");
  label.className = "muted";
  label.textContent = currentUser.email.split("@")[0];

  if (currentUser.role === "admin") {
    const adminLink = document.createElement("a");
    adminLink.className = "btn btn-outline";
    adminLink.href = "/admin";
    adminLink.textContent = "Admin Studio";
    area.append(adminLink);
  }

  const out = document.createElement("button");
  out.className = "btn btn-outline";
  out.textContent = "Sign out";

  out.onclick = async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
      currentUser = null;
      await refreshUser();
      await loadWatchlist();
      toast("Signed out");
    } catch (error) {
      toast(error.message);
    }
  };

  area.append(label, out);
}

async function loadWatchlist() {
  const grid = $("watchlist-grid");
  if (!grid) return;

  grid.replaceChildren();

  if (!currentUser) {
    grid.innerHTML =
      '<div class="empty">Sign in to save anime to your watchlist.</div>';
    return;
  }

  try {
    const items = await api("/api/me/watchlist");

    if (!Array.isArray(items) || !items.length) {
      grid.innerHTML =
        '<div class="empty">Your watchlist is empty. Explore the catalogue above.</div>';
      return;
    }

    items.forEach(item => grid.append(card(item)));

  } catch (error) {
    grid.innerHTML =
      `<div class="empty">${escapeText(error.message)}</div>`;
  }
}

// Modal close buttons
document.querySelectorAll("[data-close]").forEach(button => {
  button.addEventListener("click", () => {
    $(button.dataset.close)?.classList.remove("open");
  });
});

document.querySelectorAll(".modal").forEach(modal => {
  modal.addEventListener("click", event => {
    if (event.target === modal) modal.classList.remove("open");
  });
});

// Search and genre filters
$("search")?.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadAnime, 250);
});

$("genre")?.addEventListener("change", loadAnime);

// Initial page load
(async () => {
  await refreshUser();
  await loadAnime();
  await loadWatchlist();
})();
