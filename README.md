# R34Browser

R34Browser is a mobile-first Rule34 client built with React, TypeScript, and Vite. It keeps credentials and library data on-device, supports saved posts and muted tags, and now includes swipe navigation in the fullscreen viewer.

## Features

- Personalized home feed built from saved posts
- Search with include and exclude tags plus autocomplete
- Double-tap media viewer with swipe navigation between posts
- Saved posts, history, downloads, hidden posts, and muted tags stored locally
- PWA install support with a service worker and install banner

## Development

```bash
npm install
npm run dev
```

## Validation

```bash
npm run lint
npm run build
npm run check
```

`npm run check` runs the release gate locally by executing lint and build back to back.

## GitHub Pages

This app is configured for GitHub Pages deployment through [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml).

1. Push the repository to GitHub on the `main` branch.
2. In the repository settings, ensure GitHub Pages is set to use GitHub Actions.
3. After the deploy workflow completes, the site will be available at `https://<owner>.github.io/r34browser/`.

## Release Checklist

1. Run `npm run check`.
2. Verify home, search, saved, settings, shared post links, and `/tag/<tag>` redirects.
3. Double-tap a post, then swipe left and right in the viewer to confirm post-to-post navigation.
4. Save, unsave, mute, hide, and download a post, then confirm the home feed and settings counts update without a refresh.
5. Confirm install prompt behavior and offline shell loading in a production build.

## Notes

- Rule34 credentials are required for feed and detail API requests.
- Preferences and library data are stored in `localStorage` and IndexedDB in the current browser profile.
