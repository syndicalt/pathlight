# Pathlight landing page

Zero-build static site for <https://syndicalt.github.io/pathlight/>.

## Structure

```
site/
├── index.html      # Single-page landing
├── style.css       # All styles; dark theme, type-forward
├── README.md       # This file
└── assets/         # Screenshots + social preview image
    ├── og-cover.png        # 1200x630 social preview
    ├── replay.png          # Replay editor feature shot
    ├── breakpoint.png      # Breakpoint panel feature shot
    ├── diff.png            # Trace compare feature shot
    ├── fix.png             # Fix dialog / unified diff feature shot
    ├── byok.png            # /settings/keys BYOK feature shot
    └── openclaw.png        # OpenClaw-generated trace feature shot
```

## Screenshots to capture

Each `<img>` in `index.html` has a matching `<!-- SCREENSHOT: name — … -->`
comment directly above it with the expected filename and a one-line
shot description. Drop the PNGs into `assets/` with the names below and
GitHub Pages will redeploy on push.

| File | What to capture |
| --- | --- |
| `assets/og-cover.png` | Social preview (1200×630). Dashboard with trace list + open waterfall, dark theme, a few span bars visible. |
| `assets/replay.png` | Trace detail with an LLM span selected, replay editor open showing editable system prompt + message + API key input + "Run replay" button. Bonus: a result panel populated underneath. |
| `assets/breakpoint.png` | Dashboard with the floating amber "N paused" badge and the breakpoint editor panel visible, JSON state in the textarea, Resume buttons at the bottom. |
| `assets/diff.png` | Trace compare view with two trace headers at top, the red-highlighted delta bar in the middle, and aligned spans rows with at least one expanded showing the line-level JSON diff. |
| `assets/fix.png` | Fix dialog open on a failed span, provider picker + BYOK key picker visible, streaming progress, rendered unified diff with add/remove colorization; bisect banner if available. |
| `assets/byok.png` | `/settings/keys` page with the per-project key list, values masked as `••••••••<last-4>`, Add / Rotate / Revoke actions visible. |
| `assets/openclaw.png` | Trace detail with an OpenClaw-generated trace showing nested agent / llm / tool / subagent spans in the waterfall, git commit badge on the trace header. |

Dimensions don't have to be exact — the CSS fits whatever aspect ratio
you give it. Aim for retina-crisp widescreen shots (at least 1600px
wide).

## Local preview

The site is pure static — no build step.

```bash
cd site
python3 -m http.server 8000
# → http://localhost:8000
```

## Deploy

Pushes to `master` that touch `site/**` run the `Deploy landing page`
workflow and publish via GitHub Pages. First-time setup: in repo
Settings → Pages, set **Source** to "GitHub Actions".

The OG preview URL is baked into `index.html` as
`https://syndicalt.github.io/pathlight/`. If you move to a custom
domain later, update that meta tag.
