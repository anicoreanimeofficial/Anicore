# Anicore

FastAPI + MongoDB streaming-catalogue app (anime, TV shows, movies) with a vanilla-JS PWA frontend.

## v42 feature pack

### Browse filters (Series + Movies pages)
- "More filters" panel: year range, minimum rating, season, studio, multi-genre (title must match all picked genres).
- Active-filter pills, result count and "Clear all".
- New optional fields on content: `season` (Winter/Spring/Summer/Fall) and `studio`. Set them in the admin form; AniList import fills them automatically.
- API: `GET /api/anime|tvshows|movies` accept `genres` (comma list), `season`, `studio`, `year_min`, `year_max`, `min_rating`. `GET /api/filters/options?type=series|movie` returns the values for the panel.

### Notifications
- Bell in the header with unread badge, inbox, mark-all-read, dismiss and clear.
- Sent automatically: new episode of a watchlisted title, request status changes, moderation notices, admin announcements.
- Per-user opt-out for episode alerts (inside the bell panel). Optional browser notifications while the tab is in the background. Notifications expire after 90 days.
- API: `GET /api/notifications`, `GET /api/notifications/unread-count`, `POST /api/notifications/read`, `DELETE /api/notifications[/{id}]`.

### Admin tools (admin role)
- Users can report comments; admins get a reports queue (delete or dismiss).
- User list with search and filters: ban/unban (with reason shown at sign-in), mute for 1h/1d/7d/30d.
- Banned users are signed out everywhere; muted users can't comment. Admin accounts are protected.
- Announcements to all users and a moderation log of every action.
- API: `POST /api/comments/{id}/report`, `GET /api/admin/reports`, `POST /api/admin/comments/{id}/moderate`, `GET /api/admin/users`, `PUT /api/admin/users/{id}/ban`, `PUT /api/admin/users/{id}/mute`, `GET /api/admin/mod-log`, `POST /api/admin/announce`.

### Player upgrades (direct video / HLS sources)
- Playback speed (remembered), quality switcher (uses each episode's `quality_links`), subtitles with size control, Skip Intro / Next Episode buttons, +85s skip, auto-next with 8s countdown, Picture-in-Picture, theater mode.
- Keyboard: Space/K, ←/→ (5s), J/L (10s), F, M, N/P, `<` `>` speed, C captions, 0-9 jump.
- Per episode, admins can set intro start/end, outro start and subtitle tracks ("Player extras" in the episode form). Subtitle files must be HTTPS WebVTT served with CORS headers (`Access-Control-Allow-Origin`).
- Embedded iframe players (YouTube etc.) can't be controlled by the page, so they only get prev/next.
