// ... existing code before patch remains as-is

 const TYPE_SEG = { anime: 'anime', tv_show: 'tvshow', movie: 'movie' };
 const SEG_TYPE = { anime: 'anime', tvshow: 'tv_show', movie: 'movie' };
 const detailPath = (type, ref) => `/${TYPE_SEG[type] || type}/${ref}`;
+const detailSeasonPath = (type, ref, season) => {
+  const s = Number(season);
+  if (!Number.isFinite(s) || s == null) return detailPath(type, ref);
+  return `${detailPath(type, ref)}/season/${s}`;
+};
 const watchPath = (type, id, title, s, e) => `${detailPath(type, detailRef(id, title))}/s${s}e${e}`;
@@
 function parseLocation() {
-  const m = location.pathname.match(/^\/(anime|tvshow|movie)\/([A-Za-z0-9_-]+)(?:\/s(\d+)e(\d+))?\/?$/);
-  if (m) {
-    const detailType = SEG_TYPE[m[1]];
-    return m[3] != null ? { page: 'video', detailType, detailId: m[2], watchS: +m[3], watchE: +m[4] } : { page: 'detail', detailType, detailId: m[2] };
-  }
+  const m = location.pathname.match(/^\/(anime|tvshow|movie)\/([A-Za-z0-9_-]+)(?:\/season\/(\d+))?(?:\/s(\d+)e(\d+))?\/?$/);
+  if (m) {
+    const detailType = SEG_TYPE[m[1]];
+    const season = m[3] != null ? Number(m[3]) : null;
+    if (m[4] != null) return { page: 'video', detailType, detailId: m[2], watchS: +m[4], watchE: +m[5] };
+    return { page: 'detail', detailType, detailId: m[2], season };
+  }
   const pg = location.pathname.match(/^\/(series|movies|schedule|search|profile|admin)\/?$/);
   if (pg) return { page: pg[1] };
@@
 function saveNavState() {
   updatePageTitle();
@@
     let h = '';
     let path = PAGE_PATH[state.page] || '/';
     let ws = null, we = null;
     if (state.page === 'video' && videoContext && state.detailId && state.detailType) {
       const cur = videoContext.episodes[videoContext.currentIndex] || {};
       ws = cur.season; we = cur.episode;
       path = watchPath(state.detailType, state.detailId, state.detailTitle, ws, we); h = '';
     } else if ((state.page === 'detail' || state.page === 'video') && state.detailId && state.detailType) {
-      path = detailPath(state.detailType, detailRef(state.detailId, state.detailTitle)); h = '';
+      path = state.detailSeason != null
+        ? detailSeasonPath(state.detailType, detailRef(state.detailId, state.detailTitle), state.detailSeason)
+        : detailPath(state.detailType, detailRef(state.detailId, state.detailTitle));
+      h = '';
     }
     const entry = { key: state.page, page: state.page, detailType: state.detailType, detailId: state.detailId, watchS: ws, watchE: we };
     history.replaceState(entry, '', path + location.search + h);
   } catch (e) {}
 }
@@
 function detailSeasonScope(preview) {
   if (preview && preview._season != null) return Number(preview._season);
   try {
+    const m = location.pathname.match(/^\/(anime|tvshow|movie)\/([A-Za-z0-9_-]+)\/season\/(\d+)\/?$/);
+    if (m) return Number(m[3]);
     const v = new URLSearchParams(location.search).get('season');
     return v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
   } catch (e) { return null; }
 }
@@
   if (!swap) {
     const sq = preview && preview._season != null ? `?season=${encodeURIComponent(preview._season)}` : '';
-    gotoUrl(detailPath(type, detailRef(id, preview && preview.title)) + sq);
+    const ref = detailRef(id, preview && preview.title);
+    const season = preview && preview._season != null ? Number(preview._season) : null;
+    gotoUrl((season != null ? detailSeasonPath(type, ref, season) : detailPath(type, ref)) + (season == null ? sq : ''));
     return;
   }
@@
     try { // show the anime name in the address bar
-      const u = detailPath(type, detailRef(id, state.detailTitle)) + location.search;
+      const u = state.detailSeason != null
+        ? detailSeasonPath(type, detailRef(id, state.detailTitle), state.detailSeason)
+        : detailPath(type, detailRef(id, state.detailTitle));
       if (history.state && history.state.key) history.replaceState(history.state, '', u);
     } catch (e) {}
@@
   container.querySelector('.scope-all')?.addEventListener('click', () => {
     all.forEach((c) => c.classList.remove('hidden', 'sc-offscope'));
     container.querySelector('.season-scope')?.remove();
     state.detailSeason = null;
     try {
-      const u = new URL(location.href); u.searchParams.delete('season');
+      const u = new URL(location.href);
+      u.searchParams.delete('season');
+      const match = u.pathname.match(/^(\/\w+\/[^/]+)\/season\/\d+\/?$/);
+      if (match) u.pathname = match[1];
       history.replaceState(history.state, '', u.pathname + (u.search || '') + u.hash);
     } catch (e) { /* noop */ }
   });
@@
   if (visible.length === 1) setSeasonOpen(visible[0], true); // a single season is just shown open
   container.querySelector('.scope-all')?.addEventListener('click', () => {
@@
   all.forEach((cardEl) => {
     cardEl.querySelector('.sc-head')?.addEventListener('click', () => {
       const open = !cardEl.classList.contains('open');
       setSeasonOpen(cardEl, open);
+      if (open && state.detailSeason != null && Number(state.detailSeason) !== Number(cardEl.dataset.season)) {
+        state.detailSeason = Number(cardEl.dataset.season);
+        try {
+          const u = new URL(location.href);
+          u.pathname = `${detailSeasonPath(state.detailType, detailRef(state.detailId, state.detailTitle), state.detailSeason)}`;
+          u.searchParams.delete('season');
+          history.replaceState(history.state, '', u.pathname + (u.search || '') + u.hash);
+        } catch (e) {}
+      }
       if (open) setTimeout(() => cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60);
     });
   });
@@
 function contentShareUrl(type, id, title) {
   const base = (location.origin || "https://anicore-f6f4.onrender.com").replace(/\/$/, "");
-  return `${base}${detailPath(type, detailRef(id, title))}`;
+  const ref = detailRef(id, title);
+  return `${base}${(state.detailSeason != null ? detailSeasonPath(type, ref, state.detailSeason) : detailPath(type, ref))}`;
 }
***
