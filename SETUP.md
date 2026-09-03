# Profile repo setup

This repo must be named exactly `Alfais1/Alfais1` and be **public** for GitHub to show the README on your profile.

## First push
```bash
git init -b main && git add -A && git commit -m "profile: edgerunners build"
gh repo create Alfais1/Alfais1 --public --source=. --push
```

## Nightly refresh with private activity
1. Create a classic personal access token with `repo` + `read:user` (https://github.com/settings/tokens/new).
2. Add it as a repository secret named `PROFILE_TOKEN`:
   ```bash
   gh secret set PROFILE_TOKEN --repo Alfais1/Alfais1
   ```
3. Run the workflow once: `gh workflow run build-profile.yml --repo Alfais1/Alfais1`.

Without the secret the workflow still runs, but it only sees public data.

## Editing
- Copy, links, location, tagline → `profile/config.json`
- Project cards → `profile/projects.json` (each entry becomes `assets/project-<slug>.svg`; also add the `<img>` to `README.md`)
- Colours / font → `profile/theme.mjs`
- Rebuild locally: `GH_TOKEN=$(gh auth token) node profile/build.mjs`
- Preview like github.com: `./scripts/preview.sh` then open `preview/index.html` over a local server

## Banner artwork
The banner embeds `profile/banner-bg.jpg` (1600×667, base64 inside the SVG so GitHub loads nothing external).
To swap it, drop any image in as `profile/banner-bg.jpg`, keep the left third dark so the title stays readable, and rebuild.
Two runner-up paintings live in `profile/alternatives/` (`night-city-rooftop`, `moon-closeup`), full-resolution sources included.
Delete `banner-bg.jpg` to fall back to the hand-drawn vector scene.
`profile/alternatives/abstract-globe.jpg` is rendered from `scripts/abstract-scene.html` (three.js, deterministic seed):
open it in a browser, and it POSTs the frame to a tiny receiver on port 4174 (or just save the canvas).
