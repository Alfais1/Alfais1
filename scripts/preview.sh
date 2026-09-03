#!/usr/bin/env bash
# Renders README.md the way github.com does (via the Markdown API) into preview/index.html
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p preview
body=$(gh api -X POST /markdown -f mode=gfm -f context=Alfais1/Alfais1 -f text="$(cat README.md)")
# GitHub rewrites relative paths to the repo; point them back at local assets for the preview
body=${body//https:\/\/github.com\/Alfais1\/Alfais1\/raw\/main\//}
body=${body//https:\/\/github.com\/Alfais1\/Alfais1\/blob\/main\//}
cat > preview/index.html <<HTML
<!doctype html><html data-color-mode="dark" data-dark-theme="dark"><head><meta charset="utf-8"><base href="/"><title>Alfais1 · preview</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.5.1/github-markdown-dark.min.css">
<style>body{margin:0;background:#0d1117;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
.wrap{max-width:896px;margin:0 auto;padding:32px 16px}.markdown-body{background:transparent}
.markdown-body img{max-width:100%}.markdown-body table{width:100%;display:table}.markdown-body table td,.markdown-body table tr{background:transparent!important;border:0!important}
.hdr{display:flex;align-items:center;gap:8px;color:#8b949e;font-size:14px;margin-bottom:12px}</style></head>
<body><div class="wrap"><div class="hdr"><svg width="16" height="16" viewBox="0 0 16 16" fill="#8b949e"><path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z"/></svg>Alfais1 / README.md</div>
<article class="markdown-body">$body</article></div></body></html>
HTML
echo "preview/index.html written"
