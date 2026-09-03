#!/usr/bin/env node
// Generates every SVG in assets/ from live GitHub data (private repos included when
// GH_TOKEN can see them). Run: GH_TOKEN=$(gh auth token) node profile/build.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { T, FONT, esc, prng } from "./theme.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = join(root, "assets");
mkdirSync(out, { recursive: true });

const cfg = JSON.parse(readFileSync(join(here, "config.json"), "utf8"));
const projects = JSON.parse(readFileSync(join(here, "projects.json"), "utf8"));
const cachePath = join(here, "data.json");

// ───────────────────────── data ─────────────────────────
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { authorization: `bearer ${token}`, "content-type": "application/json", "user-agent": "profile-build" },
    body: JSON.stringify({ query, variables }),
  });
  const j = await res.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors, null, 2));
  return j.data;
}

const CC = `totalCommitContributions totalPullRequestContributions totalIssueContributions
  totalPullRequestReviewContributions restrictedContributionsCount
  contributionCalendar { totalContributions }`;

async function fetchData(login) {
  const d1 = await gql(
    `query($login:String!){ user(login:$login){ id name login url createdAt
      contributionsCollection{ contributionYears }
      repositories(first:100, ownerAffiliations:OWNER, orderBy:{field:PUSHED_AT,direction:DESC}){
        totalCount nodes{ name isPrivate isFork stargazerCount
          languages(first:10, orderBy:{field:SIZE,direction:DESC}){ edges{ size node{ name color } } } } } } }`,
    { login },
  );
  const u = d1.user;
  const years = u.contributionsCollection.contributionYears;
  const yearQ = years
    .map((y) => `y${y}: contributionsCollection(from:"${y}-01-01T00:00:00Z", to:"${y}-12-31T23:59:59Z"){ ${CC} }`)
    .join("\n");
  const d2 = await gql(`query($login:String!){ user(login:$login){ ${yearQ} } }`, { login });
  const d3 = await gql(
    `query($login:String!){ user(login:$login){ contributionsCollection{ ${CC}
      contributionCalendar{ weeks{ contributionDays{ date contributionCount contributionLevel } } } } } }`,
    { login },
  );

  // per-type counters above exclude private activity, so count it directly:
  // commits = commits authored by the user on every owned repo's default branch,
  // prs / issues = search (sees private repos the token can read)
  const d4 = await gql(
    `query($login:String!,$id:ID!){ user(login:$login){ repositories(first:100, ownerAffiliations:OWNER){ nodes{ isFork
        defaultBranchRef{ target{ ... on Commit{ history(author:{id:$id}){ totalCount } } } } } } }
      prs: search(query:"author:${login} is:pr", type:ISSUE){ issueCount }
      issues: search(query:"author:${login} is:issue", type:ISSUE){ issueCount } }`,
    { login, id: u.id },
  );
  const all = { commits: 0, prs: d4.prs.issueCount, issues: d4.issues.issueCount, reviews: 0, private: 0, contributions: 0 };
  for (const r of d4.user.repositories.nodes) all.commits += r.defaultBranchRef?.target?.history?.totalCount || 0;
  for (const y of years) {
    const c = d2.user[`y${y}`];
    all.reviews += c.totalPullRequestReviewContributions;
    all.private += c.restrictedContributionsCount;
    all.contributions += c.contributionCalendar.totalContributions;
  }
  const year = d3.user.contributionsCollection;
  const weeks = year.contributionCalendar.weeks.map((w) =>
    w.contributionDays.map((d) => ({
      date: d.date,
      count: d.contributionCount,
      level: ["NONE", "FIRST_QUARTILE", "SECOND_QUARTILE", "THIRD_QUARTILE", "FOURTH_QUARTILE"].indexOf(d.contributionLevel),
    })),
  );

  // languages aggregated across every owned, non-fork repo
  const lang = new Map();
  let stars = 0;
  for (const r of u.repositories.nodes) {
    stars += r.stargazerCount;
    if (r.isFork) continue;
    for (const e of r.languages.edges) {
      const cur = lang.get(e.node.name) || { name: e.node.name, color: e.node.color || T.muted, size: 0 };
      cur.size += e.size;
      lang.set(e.node.name, cur);
    }
  }
  const langTotal = [...lang.values()].reduce((s, l) => s + l.size, 0) || 1;
  const languages = [...lang.values()]
    .sort((a, b) => b.size - a.size)
    .map((l) => ({ ...l, pct: (100 * l.size) / langTotal }));

  return {
    login: u.login,
    name: u.name,
    url: u.url,
    since: u.createdAt.slice(0, 4),
    fetchedAt: new Date().toISOString(),
    all,
    lastYear: {
      contributions: year.contributionCalendar.totalContributions,
      commits: year.totalCommitContributions,
      private: year.restrictedContributionsCount,
    },
    repos: { total: u.repositories.totalCount, private: u.repositories.nodes.filter((r) => r.isPrivate).length, stars },
    weeks,
    languages,
  };
}

function streaks(weeks) {
  const days = weeks.flat();
  let longest = 0, run = 0;
  for (const d of days) { run = d.count > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].count > 0) current++;
    else if (i === days.length - 1) continue; // today may still be empty
    else break;
  }
  return { current, longest };
}

let data;
if (token) {
  data = await fetchData(cfg.login);
  writeFileSync(cachePath, JSON.stringify(data, null, 2));
  console.log("fetched live data → profile/data.json");
} else if (existsSync(cachePath)) {
  data = JSON.parse(readFileSync(cachePath, "utf8"));
  console.log("no GH_TOKEN, using cached profile/data.json");
} else {
  throw new Error("Set GH_TOKEN (needs read access to your private repos) or provide profile/data.json");
}
data.streak = streaks(data.weeks);
const fmt = (n) => n.toLocaleString("en-US");
const syncDate = data.fetchedAt.slice(0, 10).replace(/-/g, ".");

// ───────────────────────── svg helpers ─────────────────────────
const svg = (w, h, body, defs = "", style = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}" role="img">
<defs>${defs}</defs>${style ? `<style>${style}</style>` : ""}
${body}
</svg>`;

const scanDef = `<pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="2" fill="#ffffff" opacity="0.028"/></pattern>`;
const scanOverlay = (w, h) => `<rect width="${w}" height="${h}" fill="url(#scan)" pointer-events="none"/>`;

const frame = (w, h, fill = T.panel) =>
  `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="8" fill="${fill}" stroke="${T.line}"/>`;

function corners(w, h, c = T.yellow, l = 14, inset = 8) {
  const i = inset;
  return `<g stroke="${c}" stroke-width="1.5" fill="none" opacity="0.9">
<path d="M${i} ${i + l}V${i}h${l}"/><path d="M${w - i - l} ${i}h${l}v${l}"/>
<path d="M${i} ${h - i - l}v${l}h${l}"/><path d="M${w - i - l} ${h - i}h${l}v-${l}"/></g>`;
}

const label = (x, y, txt, opts = {}) => {
  const { size = 11, fill = T.muted, weight = 500, anchor = "start", ls = 1.5, extra = "" } = opts;
  return `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}" text-anchor="${anchor}" letter-spacing="${ls}" ${extra}>${esc(txt)}</text>`;
};

const chip = (x, y, txt, color = T.cyan, size = 10) => {
  const w = txt.length * size * 0.62 + 16;
  return {
    w,
    svg: `<g><rect x="${x}" y="${y}" width="${w}" height="${size + 10}" rx="3" fill="${T.panel2}" stroke="${color}" stroke-opacity="0.55"/>
${label(x + w / 2, y + size + 2.5, txt, { size, fill: color, anchor: "middle", ls: 0.8 })}</g>`,
  };
};

// SMIL that holds at `from` for `delay`s, then eases to `to`. Put the FINAL value in the
// static attribute so a renderer without SMIL support still shows finished bars/numbers.
const grow = (attr, from, to, delay, dur) => {
  const total = delay + dur, k = Math.max(0.01, delay / total).toFixed(3);
  return `<animate attributeName="${attr}" values="${from};${from};${to}" keyTimes="0;${k};1" dur="${total.toFixed(2)}s" begin="0s" fill="freeze" calcMode="spline" keySplines="0 0 1 1;0.2 0.8 0.2 1"/>`;
};

// title row used on every card: "// NAME" + trailing hairline
function cardTitle(w, txt, right = "") {
  const tw = txt.length * 13 * 0.62;
  return `${label(20, 30, txt, { size: 13, fill: T.yellow, weight: 700, ls: 2.5 })}
<line x1="${28 + tw}" y1="26" x2="${right ? w - (right.length * 6.4 + 60) : w - 20}" y2="26" stroke="${T.line}"/>
${right ? label(w - 20, 30, right, { size: 9, fill: T.cyan, anchor: "end", ls: 1.5 }) : ""}`;
}

function wrap(text, maxChars, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars) { lines.push(cur.trim()); cur = w; }
    else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur.trim());
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/.{2}$/, "") + "…"; }
  return lines;
}

// ───────────────────────── banner ─────────────────────────
function banner() {
  const W = 1200, H = 500;
  const rnd = prng(2077);
  const dk = cfg.bannerDarken ?? 0.55; // 0 = untouched painting, 0.9 = heavy dark wash on the left
  let stars = "";
  for (let i = 0; i < 160; i++) {
    const x = (rnd() * W).toFixed(1), y = (rnd() * 300).toFixed(1), r = (rnd() * 1.1 + 0.3).toFixed(2);
    const dur = (2 + rnd() * 5).toFixed(2), beg = (-rnd() * 6).toFixed(2);
    const col = rnd() > 0.85 ? T.cyan : rnd() > 0.9 ? T.yellow : "#ffffff";
    stars += `<circle cx="${x}" cy="${y}" r="${r}" fill="${col}"><animate attributeName="opacity" values="0.15;0.95;0.15" dur="${dur}s" begin="${beg}s" repeatCount="indefinite"/></circle>`;
  }

  // planet
  const px = 930, py = 150, pr = 235;
  const planet = `
<circle cx="${px}" cy="${py}" r="${pr + 14}" fill="none" stroke="${T.cyan}" stroke-width="10" opacity="0.28" filter="url(#blur8)"/>
<circle cx="${px}" cy="${py}" r="${pr}" fill="url(#planet)"/>
<g clip-path="url(#planetClip)">
  <g fill="#2b6a4f" opacity="0.7">
    <path d="M${px - 190} ${py - 60} c 40 -50 120 -70 170 -30 c 30 25 10 70 -30 90 c -50 25 -110 10 -140 -20 c -15 -15 -15 -30 0 -40z"/>
    <path d="M${px + 20} ${py + 40} c 60 -30 130 0 150 50 c 15 40 -30 80 -80 70 c -60 -10 -100 -40 -90 -80 c 3 -15 10 -30 20 -40z"/>
    <path d="M${px - 120} ${py + 110} c 40 -20 90 -10 100 20 c 8 30 -30 55 -70 45 c -35 -8 -55 -35 -30 -65z"/>
  </g>
  <g fill="#cfe6ff" opacity="0.32" filter="url(#blur6)">
    <ellipse cx="${px - 60}" cy="${py - 120}" rx="180" ry="26"><animateTransform attributeName="transform" type="translate" values="-30 0;30 0;-30 0" dur="46s" repeatCount="indefinite"/></ellipse>
    <ellipse cx="${px + 40}" cy="${py + 10}" rx="230" ry="22"><animateTransform attributeName="transform" type="translate" values="25 0;-25 0;25 0" dur="58s" repeatCount="indefinite"/></ellipse>
    <ellipse cx="${px - 20}" cy="${py + 130}" rx="200" ry="24"><animateTransform attributeName="transform" type="translate" values="-20 0;20 0;-20 0" dur="52s" repeatCount="indefinite"/></ellipse>
  </g>
  <circle cx="${px}" cy="${py}" r="${pr}" fill="url(#terminator)"/>
</g>
<circle cx="${px}" cy="${py}" r="${pr}" fill="none" stroke="${T.cyan}" stroke-opacity="0.5"/>`;

  // moon ground + two figures
  const ground = `
<path d="M0 338 C 150 326, 300 346, 450 334 S 750 322, 900 336 S 1100 344, 1200 330 V420 H0z" fill="url(#ground)"/>
<g stroke="#3a3a48" stroke-width="1" fill="none" opacity="0.9">
  <path d="M60 372 l70 -10 l40 14 l90 -6"/><path d="M330 396 l60 -18 l50 6 l40 -14"/>
  <path d="M520 360 l40 12 l70 -4 l30 10"/><path d="M1000 372 l50 -12 l60 8 l50 -10"/>
  <path d="M760 400 l40 -10 l30 6"/><path d="M180 410 l60 -8"/>
  <ellipse cx="240" cy="380" rx="34" ry="8"/><ellipse cx="1080" cy="396" rx="40" ry="9"/><ellipse cx="620" cy="404" rx="24" ry="6"/>
</g>
<path d="M0 338 C 150 326, 300 346, 450 334 S 750 322, 900 336 S 1100 344, 1200 330" fill="none" stroke="#5b5b6c" stroke-width="1.2"/>
<!-- two figures, sitting on the regolith, watching the planet -->
<g id="figA" transform="translate(722 292)">
  <path d="M6 44 L2 12 Q2 2 12 0 H30 Q40 2 40 12 L36 44z" fill="${T.yellow}"/>
  <path d="M8 6 L-8 40 M34 6 L50 40" stroke="${T.yellow}" stroke-width="7" stroke-linecap="round"/>
  <circle cx="21" cy="-8" r="11" fill="#0a0a0e" stroke="${T.yellow}" stroke-width="1"/>
  <path d="M10 -10 q11 -14 22 0" fill="#0a0a0e"/>
</g>
<g id="figB" transform="translate(790 298)">
  <path d="M6 40 L3 12 Q3 2 12 0 H26 Q35 2 35 12 L32 40z" fill="#eef1f8"/>
  <path d="M8 6 L-4 36 M30 6 L42 36" stroke="#eef1f8" stroke-width="6" stroke-linecap="round"/>
  <circle cx="19" cy="-7" r="10" fill="#0a0a0e"/>
  <path d="M8 -6 q11 -20 22 0 v6 h-22z" fill="#bfefff"/>
  <path d="M28 -4 q6 10 2 22" stroke="#bfefff" stroke-width="3" stroke-linecap="round" fill="none"/>
</g>`;

  const name = cfg.name.toUpperCase();
  const tag = "// " + cfg.tagline;
  const tagW = tag.length * 12.1;
  const title = `
<g transform="translate(0 ${Math.round((H - 420) / 2)})">
<g class="glitch">
  <text class="gc" x="72" y="212">${esc(name)}</text>
  <text class="gm" x="72" y="212">${esc(name)}</text>
  <text class="gt" x="72" y="212">${esc(name)}</text>
  <g clip-path="url(#slice)"><text class="gs" x="72" y="212">${esc(name)}</text></g>
</g>
<g>
  <g clip-path="url(#typeClip)">
    <text x="72" y="258" font-size="20" fill="${T.cyan}" textLength="${tagW}" lengthAdjust="spacingAndGlyphs">${esc(tag)}</text>
  </g>
  <rect x="${74 + tagW}" y="240" width="11" height="22" fill="${T.cyan}">
    ${grow("x", 74, 74 + tagW, 0.5, 2.6)}
    <animate attributeName="opacity" values="1;1;0;0" dur="1s" repeatCount="indefinite"/>
  </rect>
</g>
<line x1="72" y1="292" x2="${72 + 56}" y2="292" stroke="${T.yellow}" stroke-width="2"/>
<line x1="${72 + 62}" y1="292" x2="${72 + 62 + 320}" y2="292" stroke="${T.line}" stroke-width="1"/>
</g>`;

  const hud = `
${label(72, 46, `SYS.PROFILE // ${data.login.toUpperCase()}`, { size: 11, fill: T.muted })}
${label(72, 64, cfg.location, { size: 11, fill: T.dim })}
<rect x="${1128 - Math.max(cfg.coords.length, 10) * 8.2 - 12}" y="34" width="${Math.max(cfg.coords.length, 10) * 8.2 + 22}" height="38" rx="4" fill="${T.bg}" fill-opacity="0.72"/>
${label(1128, 46, cfg.coords, { size: 11, fill: T.muted, anchor: "end" })}
${label(1128, 64, `SINCE ${data.since}`, { size: 11, fill: T.dim, anchor: "end" })}
<g transform="translate(72 ${H - 34})">
  <circle cx="0" cy="-4" r="4" fill="${T.green}"><animate attributeName="opacity" values="1;0.25;1" dur="1.8s" repeatCount="indefinite"/></circle>
  ${label(12, 0, "ONLINE", { size: 11, fill: T.green })}
  ${label(84, 0, `CONTRIBUTIONS ${fmt(data.all.contributions)}`, { size: 11, fill: T.muted })}
  ${label(84 + (`CONTRIBUTIONS ${fmt(data.all.contributions)}`.length + 3) * 8.2, 0, `REPOS ${data.repos.total}`, { size: 11, fill: T.muted })}
  ${label(84 + (`CONTRIBUTIONS ${fmt(data.all.contributions)}`.length + 3) * 8.2 + (`REPOS ${data.repos.total}`.length + 3) * 8.2, 0, `STREAK ${data.streak.current}D`, { size: 11, fill: T.muted })}
</g>
<rect x="${1128 - 20 * 8.2 - 12}" y="${H - 48}" width="${20 * 8.2 + 22}" height="22" rx="4" fill="${T.bg}" fill-opacity="0.72"/>
${label(1128, H - 34, `LAST SYNC ${syncDate}`, { size: 11, fill: T.muted, anchor: "end" })}`;

  const defs = `
${scanDef}
<filter id="blur8"><feGaussianBlur stdDeviation="8"/></filter>
<filter id="blur6"><feGaussianBlur stdDeviation="6"/></filter>
<radialGradient id="planet" cx="0.32" cy="0.28" r="0.85"><stop offset="0" stop-color="#2a63a8"/><stop offset="0.5" stop-color="#123059"/><stop offset="1" stop-color="#050a16"/></radialGradient>
<linearGradient id="terminator" x1="0" y1="0" x2="1" y2="0.4"><stop offset="0.45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.9"/></linearGradient>
<clipPath id="planetClip"><circle cx="${px}" cy="${py}" r="${pr}"/></clipPath>
<linearGradient id="ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c2c37"/><stop offset="1" stop-color="#0a0a0f"/></linearGradient>
<linearGradient id="beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.05"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<radialGradient id="vignette" cx="0.5" cy="0.5" r="0.75"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></radialGradient>
<linearGradient id="readable" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${T.wash}" stop-opacity="${dk}"/><stop offset="0.4" stop-color="${T.wash}" stop-opacity="${(dk * 0.55).toFixed(2)}"/><stop offset="0.62" stop-color="${T.wash}" stop-opacity="0"/></linearGradient>
<linearGradient id="bottomFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.72" stop-color="${T.wash}" stop-opacity="0"/><stop offset="1" stop-color="${T.wash}" stop-opacity="0.8"/></linearGradient>
<clipPath id="typeClip"><rect x="72" y="236" width="${tagW + 4}" height="30">${grow("width", 0, tagW + 4, 0.5, 2.6)}</rect></clipPath>
<clipPath id="slice"><rect x="60" y="150" width="600" height="18"/></clipPath>`;

  const style = `
.glitch text{font-size:104px;font-weight:800;letter-spacing:6px}
.gt{fill:${T.yellow}}
.gc{fill:${T.cyan};opacity:0;animation:gc 7s infinite steps(1,end)}
.gm{fill:${T.magenta};opacity:0;animation:gm 7s infinite steps(1,end)}
.gs{fill:${T.text};opacity:0;animation:gs 7s infinite steps(1,end)}
@keyframes gc{0%,88%{transform:translate(0,0);opacity:0}89%{transform:translate(-7px,2px);opacity:.9}91%{transform:translate(5px,-2px)}93%{transform:translate(-3px,1px)}95%{transform:translate(0,0);opacity:0}}
@keyframes gm{0%,88%{transform:translate(0,0);opacity:0}89%{transform:translate(7px,-2px);opacity:.9}91%{transform:translate(-5px,2px)}93%{transform:translate(3px,-1px)}95%{transform:translate(0,0);opacity:0}}
@keyframes gs{0%,89%{transform:translate(0,0);opacity:0}90%{transform:translate(14px,0);opacity:1}92%{transform:translate(-10px,0)}94%{transform:translate(0,0);opacity:0}}
@media (prefers-reduced-motion: reduce){.gc,.gm,.gs{animation:none}}`;

  const bgPath = join(here, "banner-bg.jpg");
  const scene = existsSync(bgPath)
    ? `<image href="data:image/jpeg;base64,${readFileSync(bgPath).toString("base64")}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>
<rect width="${W}" height="${H}" fill="url(#readable)"/>
<rect width="${W}" height="${H}" fill="url(#bottomFade)"/>`
    : `${stars}
${planet}
${ground}`;
  const body = `
<rect width="${W}" height="${H}" fill="${T.bg}"/>
${scene}
<rect width="${W}" height="${H}" fill="url(#vignette)"/>
${title}
${hud}
${corners(W, H, T.yellow, 18, 14)}
<rect x="0" y="-70" width="${W}" height="70" fill="url(#beam)"><animate attributeName="y" from="-70" to="${H}" dur="9s" repeatCount="indefinite"/></rect>
${scanOverlay(W, H)}`;
  return svg(W, H, body, defs, style);
}

// ───────────────────────── stats ─────────────────────────
function statsCard() {
  const W = 495, H = 230;
  const rows = [
    ["COMMITS", data.all.commits],
    ["PULL REQUESTS", data.all.prs],
    ["ISSUES", data.all.issues],
    ["REPOSITORIES", data.repos.total],
    ["PRIVATE REPOS", data.repos.private],
    ["STARS", data.repos.stars],
  ];
  const max = Math.max(...rows.map((r) => r[1]), 1);
  let list = "";
  rows.forEach(([k, v], i) => {
    const y = 132 + i * 16;
    const bw = Math.max(2, (v / max) * 110);
    list += `${label(20, y, k, { size: 10, fill: T.muted })}
<rect x="150" y="${y - 7}" width="110" height="3" fill="${T.line}"/>
<rect x="150" y="${y - 7}" width="${bw.toFixed(1)}" height="3" fill="${i % 2 ? T.cyan : T.yellow}">${grow("width", 0, bw.toFixed(1), 0.15 + i * 0.08, 0.9)}</rect>
${label(300, y, fmt(v), { size: 11, fill: T.text, anchor: "end", ls: 0.5 })}`;
  });

  const cx = 405, cy = 128, r = 46, C = (2 * Math.PI * r).toFixed(1);
  const frac = Math.min(1, data.streak.current / Math.max(data.streak.longest, 1));
  const ring = `
<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${T.line}" stroke-width="6"/>
<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${T.cyan}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${(C * (1 - frac)).toFixed(1)}" transform="rotate(-90 ${cx} ${cy})">
  ${grow("stroke-dashoffset", C, (C * (1 - frac)).toFixed(1), 0.3, 1.4)}
</circle>
<circle cx="${cx}" cy="${cy}" r="${r + 9}" fill="none" stroke="${T.cyan}" stroke-opacity="0.25" stroke-dasharray="2 6"><animateTransform attributeName="transform" type="rotate" from="0 ${cx} ${cy}" to="360 ${cx} ${cy}" dur="30s" repeatCount="indefinite"/></circle>
${label(cx, cy + 6, String(data.streak.current), { size: 28, fill: T.text, weight: 700, anchor: "middle", ls: 0 })}
${label(cx, cy + 22, "DAY STREAK", { size: 8, fill: T.muted, anchor: "middle" })}
${label(cx, cy + 74, `LONGEST ${data.streak.longest}D`, { size: 9, fill: T.dim, anchor: "middle" })}`;

  const body = `
${frame(W, H)}
${cardTitle(W, "// STATS", "INCL. PRIVATE")}
${label(20, 84, fmt(data.all.contributions), { size: 40, fill: T.yellow, weight: 800, ls: -1 })}
${label(20, 102, `CONTRIBUTIONS · ALL TIME · ${fmt(data.all.private)} PRIVATE`, { size: 9, fill: T.muted })}
${list}
${ring}
${corners(W, H, T.cyan, 10, 6)}
${scanOverlay(W, H)}`;
  return svg(W, H, body, scanDef);
}

// ───────────────────────── languages ─────────────────────────
function langsCard() {
  const W = 495, H = 230;
  const langs = data.languages.slice(0, 8);
  const barX = 20, barW = W - 40, barY = 52;
  let seg = "", x = barX, list = "";
  langs.forEach((l, i) => {
    const w = (l.pct / 100) * barW;
    seg += `<rect x="${x.toFixed(1)}" y="${barY}" width="${w.toFixed(1)}" height="8" fill="${l.color}">${grow("width", 0, w.toFixed(1), 0.2 + i * 0.1, 0.8)}</rect>`;
    x += w;
    const col = i % 2, row = Math.floor(i / 2);
    const lx = 20 + col * 232, ly = 96 + row * 30;
    list += `<rect x="${lx}" y="${ly - 9}" width="8" height="8" rx="2" fill="${l.color}"/>
${label(lx + 16, ly, l.name.toUpperCase(), { size: 11, fill: T.text, ls: 1 })}
${label(lx + 210, ly, `${l.pct.toFixed(1)}%`, { size: 11, fill: T.muted, anchor: "end", ls: 0.5 })}
<rect x="${lx + 16}" y="${ly + 6}" width="194" height="1" fill="${T.lineSoft}"/>
<rect x="${lx + 16}" y="${ly + 6}" width="${((l.pct / 100) * 194).toFixed(1)}" height="1" fill="${l.color}">${grow("width", 0, ((l.pct / 100) * 194).toFixed(1), 0.4 + i * 0.1, 0.8)}</rect>`;
  });
  const body = `
${frame(W, H)}
${cardTitle(W, "// LANGUAGES", `${data.repos.total} REPOS`)}
<rect x="${barX}" y="${barY}" width="${barW}" height="8" rx="4" fill="${T.line}"/>
<g clip-path="url(#barClip)">${seg}</g>
${list}
${corners(W, H, T.cyan, 10, 6)}
${scanOverlay(W, H)}`;
  return svg(W, H, body, `${scanDef}<clipPath id="barClip"><rect x="${barX}" y="${barY}" width="${barW}" height="8" rx="4"/></clipPath>`);
}

// ───────────────────────── heatmap ─────────────────────────
function heatmap() {
  const cell = 13, gap = 4, step = cell + gap;
  const weeks = data.weeks;
  const left = 48, top = 58;
  const W = left + weeks.length * step + 16, H = top + 7 * step + 34;
  const cols = [T.lineSoft, "#524F00", "#8E8A00", "#CBC500", T.yellow];
  let grid = "", months = "";
  // month labels: one per month change, dropped when the next change is < 3 columns away
  const marks = [];
  let lastMonth = "";
  weeks.forEach((w, wi) => {
    const m = new Date(w[0].date + "T00:00:00Z").toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();
    if (m !== lastMonth) { marks.push({ wi, m }); lastMonth = m; }
  });
  marks.forEach((mk, k) => {
    const next = marks[k + 1];
    if ((next && next.wi - mk.wi < 3) || mk.wi > weeks.length - 3) return;
    months += label(left + mk.wi * step, top - 12, mk.m, { size: 9, fill: T.muted });
  });
  weeks.forEach((w, wi) => {
    const x = left + wi * step;
    let col = "";
    w.forEach((d, di) => {
      const y = top + di * step;
      col += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2.5" fill="${cols[d.level]}"><title>${d.date}: ${d.count}</title></rect>`;
    });
    grid += `<g opacity="1">${col}${grow("opacity", 0, 1, wi * 0.035, 0.5)}</g>`;
  });
  const days = ["", "MON", "", "WED", "", "FRI", ""].map((d, i) => (d ? label(left - 10, top + i * step + 10, d, { size: 9, fill: T.dim, anchor: "end" }) : "")).join("");
  const legend = cols.map((c, i) => `<rect x="${W - 56 - (5 - i) * 17}" y="${H - 22}" width="${cell}" height="${cell}" rx="2.5" fill="${c}"/>`).join("");
  const body = `
${frame(W, H)}
${cardTitle(W, "// ACTIVITY · LAST 12 MONTHS", `${fmt(data.lastYear.contributions)} CONTRIBUTIONS · ${fmt(data.lastYear.private)} PRIVATE`)}
${months}${days}${grid}
${label(W - 56 - 5 * 17 - 8, H - 12, "LESS", { size: 9, fill: T.dim, anchor: "end" })}${legend}${label(W - 18, H - 12, "MORE", { size: 9, fill: T.dim, anchor: "end" })}
<rect x="${left}" y="${top - 4}" width="2" height="${7 * step}" fill="${T.cyan}" opacity="0"><animate attributeName="x" from="${left}" to="${left + weeks.length * step}" dur="2.2s" begin="0s" fill="freeze"/><animate attributeName="opacity" values="0.7;0.7;0" dur="2.2s" fill="freeze"/></rect>
${corners(W, H, T.cyan, 10, 6)}
${scanOverlay(W, H)}`;
  return svg(W, H, body, scanDef);
}

// ───────────────────────── project cards ─────────────────────────
function projectCard(p, i) {
  const W = 440, H = 176;
  const lines = wrap(p.desc, 52, 3);
  const desc = lines.map((l, k) => label(20, 80 + k * 17, l, { size: 12, fill: T.muted, ls: 0 })).join("");
  let x = 20, chips = "";
  for (const t of p.tags) { const c = chip(x, 128, t.toUpperCase()); chips += c.svg; x += c.w + 6; }
  const live = p.status === "live";
  const statusC = live ? T.green : T.magenta;
  const status = `
<g transform="translate(${W - 20} 30)">
  ${label(-14, 0, live ? "LIVE" : "PRIVATE", { size: 9, fill: statusC, anchor: "end" })}
  <circle cx="-4" cy="-3.5" r="3.5" fill="${statusC}">${live ? `<animate attributeName="opacity" values="1;0.2;1" dur="1.6s" repeatCount="indefinite"/>` : ""}</circle>
</g>`;
  const host = p.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const body = `
${frame(W, H)}
${label(20, 30, `0${i + 1}`, { size: 11, fill: T.dim, weight: 700 })}
<line x1="44" y1="26" x2="${W - 90}" y2="26" stroke="${T.line}"/>
${status}
${label(20, 58, p.name, { size: 19, fill: T.yellow, weight: 800, ls: 1 })}
${desc}
${chips}
${label(W - 20, H - 14, host, { size: 9, fill: T.dim, anchor: "end", ls: 0.5 })}
${label(20, H - 14, "OPEN ↗", { size: 9, fill: T.cyan })}
<rect x="0" y="0" width="0" height="2" fill="${T.cyan}" opacity="0.8"><animate attributeName="width" values="0;${W};${W}" dur="6s" begin="${(i * 0.6).toFixed(1)}s" repeatCount="indefinite" keyTimes="0;0.25;1"/><animate attributeName="opacity" values="0.8;0.8;0" dur="6s" begin="${(i * 0.6).toFixed(1)}s" repeatCount="indefinite" keyTimes="0;0.25;1"/></rect>
${corners(W, H, T.yellow, 10, 6)}
${scanOverlay(W, H)}`;
  return svg(W, H, body, scanDef);
}

// ───────────────────────── section headers + divider + footer ─────────────────────────
function header(idx, txt) {
  const W = 1000, H = 44;
  const body = `
<rect width="${W}" height="${H}" fill="${T.bg}"/>
${label(0, 30, `${idx}`, { size: 12, fill: T.dim, weight: 700 })}
${label(30, 30, `// ${txt}`, { size: 18, fill: T.yellow, weight: 800, ls: 4 })}
<line x1="${30 + (txt.length + 3) * 13.2}" y1="26" x2="${W}" y2="26" stroke="${T.line}"/>
<rect x="${30 + (txt.length + 3) * 13.2}" y="25" width="60" height="2" fill="${T.cyan}">${grow("width", 0, 60, 0.2, 0.8)}</rect>`;
  return svg(W, H, body);
}

function divider() {
  const W = 1000, H = 16;
  const body = `
<rect width="${W}" height="${H}" fill="${T.bg}"/>
<line x1="0" y1="8" x2="${W}" y2="8" stroke="${T.line}"/>
<rect x="0" y="7" width="120" height="2" fill="${T.yellow}"><animate attributeName="x" from="-120" to="${W}" dur="5s" repeatCount="indefinite"/></rect>
<rect x="0" y="7" width="40" height="2" fill="${T.cyan}"><animate attributeName="x" from="-40" to="${W}" dur="5s" begin="1.2s" repeatCount="indefinite"/></rect>`;
  return svg(W, H, body);
}

function footer() {
  const W = 1000, H = 64;
  const txt = "SEE YOU, CHOOM.";
  const body = `
<rect width="${W}" height="${H}" fill="${T.bg}"/>
<line x1="0" y1="0.5" x2="${W}" y2="0.5" stroke="${T.line}"/>
${label(W / 2, 34, txt, { size: 13, fill: T.muted, anchor: "middle", ls: 6 })}
${label(W / 2, 52, `${data.login.toUpperCase()} · SYNCED ${syncDate} · PRIVATE ACTIVITY INCLUDED`, { size: 9, fill: T.dim, anchor: "middle", ls: 2 })}
<rect x="${W / 2 + (txt.length * (13 * 0.62 + 6)) / 2 + 6}" y="22" width="8" height="14" fill="${T.yellow}"><animate attributeName="opacity" values="1;1;0;0" dur="1.1s" repeatCount="indefinite"/></rect>`;
  return svg(W, H, body);
}

// ───────────────────────── write ─────────────────────────
const files = {
  "banner.svg": banner(),
  "stats.svg": statsCard(),
  "langs.svg": langsCard(),
  "heatmap.svg": heatmap(),
  "divider.svg": divider(),
  "footer.svg": footer(),
  "h-projects.svg": header("01", "PROJECTS"),
  "h-stats.svg": header("02", "STATS"),
  "h-stack.svg": header("03", "STACK"),
  "h-contact.svg": header("04", "CONTACT"),
};
projects.forEach((p, i) => (files[`project-${p.slug}.svg`] = projectCard(p, i)));
for (const [name, content] of Object.entries(files)) writeFileSync(join(out, name), content);
console.log(`wrote ${Object.keys(files).length} svgs → assets/  (contributions ${data.all.contributions}, private ${data.all.private}, streak ${data.streak.current}/${data.streak.longest})`);
