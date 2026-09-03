#!/usr/bin/env bash
# usage: scripts/set-banner.sh <image> [vertical-anchor 0..1, default 0.5]
# Crops the image to the banner band (2.4:1 → 1600x667), writes profile/banner-bg.jpg, rebuilds every SVG.
set -euo pipefail
cd "$(dirname "$0")/.."
src="${1:?image path}"; anchor="${2:-0.5}"
w=$(sips -g pixelWidth "$src" | awk '/pixelWidth/{print $2}'); h=$(sips -g pixelHeight "$src" | awk '/pixelHeight/{print $2}')
tmp=$(mktemp -d)
if awk "BEGIN{exit !($w/$h > 2.4)}"; then   # too wide → crop sides, centred
  cw=$(awk "BEGIN{printf \"%d\", $h*2.4}"); off=$(( (w - cw) / 2 ))
  sips --cropOffset 0 "$off" -c "$h" "$cw" "$src" --out "$tmp/crop.png" >/dev/null
else                                         # too tall → crop top/bottom at the anchor
  ch=$(awk "BEGIN{printf \"%d\", $w/2.4}"); off=$(awk "BEGIN{printf \"%d\", ($h-$ch)*$anchor}")
  sips --cropOffset "$off" 0 -c "$ch" "$w" "$src" --out "$tmp/crop.png" >/dev/null
fi
sips -Z 1600 "$tmp/crop.png" -s format jpeg -s formatOptions 84 --out profile/banner-bg.jpg >/dev/null
echo "banner-bg.jpg ← $src ($(du -h profile/banner-bg.jpg | cut -f1))"
GH_TOKEN="${GH_TOKEN:-$(gh auth token)}" node profile/build.mjs
[ -x scripts/preview.sh ] && ./scripts/preview.sh || true
