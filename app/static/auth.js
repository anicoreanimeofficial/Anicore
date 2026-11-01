
const $ = id => document.getElementById(id);

let mode = location.pathname === "/signup" ? "register" : "login";

const params = new URLSearchParams(location.search);
const requestedNext = params.get("next") || "/";
const safeNext =
  requestedNext.startsWith("/") && !requestedNext.startsWith("//")
    ? requestedNext
    : "/";

function renderMode() {
  const login = mode === "login";

  $("auth-heading").innerHTML = login
    ? 'Sign in<span>.</span>'
    : 'Create account<span>.</span>';

  $("auth-intro").textContent = login
    ? "Sign in to continue your anime journey."
    : "Create your free Anicore account and build your watchlist.";

  $("auth-submit").textContent = login ? "Sign in" : "Create account";
  $("auth-switch-label").textContent = login
    ? "New to Anicore?"
    : "Already have an account?";

  $("auth-switch").textContent = login
    ? "Create an account"
    : "Sign in instead";

  $("auth-password").autocomplete = login
    ? "current-password"
    : "new-password";

  $("auth-message").textContent = "";
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: options.body
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.detail || `Request failed (${response.status})`);
  }

  return data;
}

$("auth-switch").addEventListener("click", () => {
  mode = mode === "login" ? "register" : "login";
  renderMode();
});

$("auth-form").addEventListener("submit", async event => {
  event.preventDefault();

  const button = $("auth-submit");
  const message = $("auth-message");

  button.disabled = true;
  button.textContent = "Please wait...";
  message.textContent = "";

  try {
    const data = await api(`/api/auth/${mode}`, {
      method: "POST",
      body: JSON.stringify({
        email: $("auth-email").value.trim(),
        password: $("auth-password").value
      })
    });

    // Admin and regular users use the same sign-in form.
    const destination =
      safeNext === "/" && data.user?.role === "admin"
        ? "/admin"
        : safeNext;

    location.replace(destination);

  } catch (error) {
    message.textContent = error.message;

  } finally {
    button.disabled = false;
    button.textContent =
      mode === "login" ? "Sign in" : "Create account";
  }
});

(async () => {
  renderMode();

  try {
    const data = await api("/api/auth/me");

    if (data.user) {
      location.replace(
        data.user.role === "admin" ? "/admin" : "/"
      );
    }
  } catch (error) {
    $("auth-message").textContent =
      "Could not check your session. You can still try signing in.";
  }
})();
