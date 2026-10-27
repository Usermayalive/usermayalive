// Fetches live GitHub data and renders the profile cards into cards/*.svg.
// Usage: GITHUB_TOKEN=... node scripts/generate.mjs   (token optional locally)
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const ROOT = new URL("..", import.meta.url);
const config = JSON.parse(await readFile(new URL("profile.config.json", ROOT), "utf8"));
const USER = config.username;
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

// ---------- theme ----------
const T = {
  bg: "#eef1f7",
  grid: "#dfe4ee",
  ink: "#1f2430",
  muted: "#5b6475",
  faint: "#9aa3b5",
  accent: "#f2d94e",
  violet: "#8e86c9",
  mono: "'JetBrains Mono','SFMono-Regular',Menlo,Consolas,'Liberation Mono',monospace",
  serifMono: "'Courier Prime','Courier New',Courier,monospace",
};

// Linguist colors + short badge text for common languages.
const LANG = {
  JavaScript: ["#f1e05a", "JS", "#3b3200"],
  TypeScript: ["#3178c6", "TS", "#fff"],
  Python: ["#3572A5", "Py", "#fff"],
  Java: ["#b07219", "J", "#fff"],
  CSS: ["#663399", "CSS", "#fff"],
  HTML: ["#e34c26", "5", "#fff"],
  Shell: ["#89e051", "$_", "#1d3300"],
  PLpgSQL: ["#336790", "SQL", "#fff"],
  "Jupyter Notebook": ["#DA5B0B", "Nb", "#fff"],
  C: ["#555555", "C", "#fff"],
  "C++": ["#f34b7d", "C++", "#fff"],
  "C#": ["#178600", "C#", "#fff"],
  Go: ["#00ADD8", "Go", "#fff"],
  Rust: ["#dea584", "Rs", "#3a1d00"],
  Kotlin: ["#A97BFF", "Kt", "#fff"],
  Swift: ["#F05138", "Sw", "#fff"],
  Dart: ["#00B4AB", "Dt", "#fff"],
  Ruby: ["#701516", "Rb", "#fff"],
  PHP: ["#4F5D95", "php", "#fff"],
  Vue: ["#41b883", "V", "#fff"],
  SCSS: ["#c6538c", "S", "#fff"],
};
const lang = (name) => {
  const [color, badge, fg] = LANG[name] || ["#8b93a7", (name || "?").slice(0, 2), "#fff"];
  return { color, badge, fg };
};

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
const fmt = (n) => (n == null ? "—" : n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// ---------- data ----------
async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "profile-cards",
      ...(TOKEN && { Authorization: `Bearer ${TOKEN}` }),
    },
  });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function contributionsLastYear() {
  if (TOKEN) {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "User-Agent": "profile-cards" },
      body: JSON.stringify({
        query: `query($l:String!){user(login:$l){contributionsCollection{contributionCalendar{totalContributions}}}}`,
        variables: { l: USER },
      }),
    });
    const json = await res.json();
    const n = json?.data?.user?.contributionsCollection?.contributionCalendar?.totalContributions;
    if (typeof n === "number") return n;
  }
  // Fallback: the public contributions fragment shown on the profile page.
  const res = await fetch(`https://github.com/users/${USER}/contributions`, { headers: { "User-Agent": "profile-cards" } });
  const m = (await res.text()).match(/([\d,]+)\s+contributions?\s+in the last year/i);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

async function loadData() {
  const user = await gh(`/users/${USER}`);
  const repos = [];
  for (let page = 1; ; page++) {
    const batch = await gh(`/users/${USER}/repos?per_page=100&type=owner&sort=pushed&page=${page}`);
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  const own = repos.filter((r) => !r.fork && !r.archived && !config.excludeRepos.includes(r.name));

  const bytes = {};
  await Promise.all(
    own.map(async (r) => {
      const langs = await gh(`/repos/${USER}/${r.name}/languages`);
      for (const [k, v] of Object.entries(langs)) {
        if (!config.excludeLanguages.includes(k)) bytes[k] = (bytes[k] || 0) + v;
      }
    }),
  );
  const total = Object.values(bytes).reduce((a, b) => a + b, 0) || 1;
  const languages = Object.entries(bytes)
    .sort((a, b) => b[1] - a[1])
    .map(([name, b]) => ({ name, pct: (100 * b) / total }));

  // Featured repos (in config order) first, then the rest by stars / recent activity.
  const featured = Object.keys(config.featuredRepos || {}).map((k) => k.toLowerCase());
  const rank = (r) => {
    const i = featured.indexOf(r.name.toLowerCase());
    return i === -1 ? Infinity : i;
  };
  const tagFor = (r) => Object.entries(config.featuredRepos || {}).find(([k]) => k.toLowerCase() === r.name.toLowerCase())?.[1];
  const projects = [...own]
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        b.stargazers_count - a.stargazers_count ||
        new Date(b.pushed_at) - new Date(a.pushed_at),
    )
    .slice(0, config.maxProjects)
    .map((r) => ({ name: r.name, language: r.language, stars: r.stargazers_count, size: r.size, tag: tagFor(r) }));

  return {
    name: config.displayName || user.name || USER,
    repos: user.public_repos,
    followers: user.followers,
    stars: repos.filter((r) => !r.fork).reduce((a, r) => a + r.stargazers_count, 0),
    contributions: await contributionsLastYear(),
    languages,
    projects,
  };
}

// ---------- shared svg bits ----------
const defs = `
  <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
    <path d="M24 0H0V24" fill="none" stroke="${T.grid}" stroke-width="1"/>
  </pattern>
  <pattern id="dots" width="4" height="4" patternUnits="userSpaceOnUse">
    <rect width="4" height="4" fill="#f4f6fb"/>
    <circle cx="1.5" cy="1.5" r="1.1" fill="#7d86a8"/>
  </pattern>
  <radialGradient id="glow" cx="50%" cy="45%" r="55%">
    <stop offset="0" stop-color="#fbf8d9" stop-opacity=".9"/>
    <stop offset="1" stop-color="${T.bg}" stop-opacity="0"/>
  </radialGradient>`;

const frame = (w, h, body, extraDefs = "", extraStyle = "") => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">
  <defs>${defs}${extraDefs}</defs>
  <style>
    text { font-family: ${T.mono}; fill: ${T.ink} }
    .label { font-family: ${T.serifMono}; font-size: 11px; letter-spacing: 4px; fill: ${T.muted} }
    .small { font-size: 11px; fill: ${T.muted} }
    .foot { font-family: ${T.serifMono}; font-size: 10px; fill: ${T.muted} }
    .in { opacity: 0; animation: in .8s ease-out forwards }
    @keyframes in { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; opacity: 1 !important } }
    ${extraStyle}
  </style>
  <rect width="${w}" height="${h}" rx="26" fill="${T.bg}"/>
  <rect width="${w}" height="${h}" rx="26" fill="url(#grid)" opacity=".7"/>
  ${body}
  <text x="${w - 44}" y="${h - 22}" text-anchor="end" class="foot">github.com/${esc(USER)}</text>
</svg>
`;

// 5x5 mirrored identicon derived from the username, like GitHub's default avatar.
function identicon(cx, cy, cell) {
  const h = createHash("md5").update(USER).digest();
  const cells = [];
  for (let y = 0; y < 5; y++)
    for (let x = 0; x < 3; x++) {
      if ((h[y * 3 + x] & 1) === 0) continue;
      for (const xx of x === 2 ? [2] : [x, 4 - x]) cells.push([xx, y]);
    }
  if (cells.length < 6) cells.push([0, 1], [4, 1], [2, 2], [1, 4], [3, 4], [2, 0]);
  const ox = cx - (5 * cell) / 2, oy = cy - (5 * cell) / 2;
  return cells
    .map(([x, y]) => `<rect x="${ox + x * cell + 3}" y="${oy + y * cell + 3}" width="${cell - 6}" height="${cell - 6}" fill="url(#dots)"/>`)
    .join("");
}

// ---------- cards ----------
function heroCard(d) {
  const W = 1080, H = 620;
  const focus = (config.focus.length ? config.focus : d.languages.slice(0, 3).map((l) => l.name)).join(" / ");
  const stats = [
    ["REPOSITORIES", d.repos],
    ["STARS", d.stars],
    ["CONTRIBUTIONS", d.contributions],
    ["FOLLOWERS", d.followers],
  ];
  const colW = (W - 88) / 4;
  const statSvg = stats
    .map(([k, v], i) => {
      const x = 44 + i * colW;
      return `<g class="in" style="animation-delay:${1.2 + i * 0.15}s">
        <text x="${x}" y="548" class="label" style="font-size:10px">${k}</text>
        <circle cx="${x + colW - 40}" cy="544" r="3" fill="${T.accent}" class="pulse" style="animation-delay:${i * 0.4}s"/>
        <text x="${x}" y="588" style="font-size:28px;letter-spacing:2px">${fmt(v)}</text>
      </g>`;
    })
    .join("");

  const cx = 820, cy = 270;
  const body = `
  <text x="44" y="52" class="label">README / LIVING IDENTITY</text>
  <text x="${W - 44}" y="52" text-anchor="end" style="font-family:${T.serifMono};font-size:12px;fill:${T.muted}">@${esc(USER)}</text>

  <circle cx="${cx}" cy="${cy}" r="210" fill="url(#glow)"/>
  <g class="spin" style="transform-origin:${cx}px ${cy}px">
    <circle cx="${cx}" cy="${cy}" r="196" fill="none" stroke="${T.accent}" stroke-width="1.2" stroke-dasharray="220 1012" stroke-linecap="round" opacity=".8"/>
    <circle cx="${cx}" cy="${cy}" r="196" fill="none" stroke="${T.violet}" stroke-width="1.2" stroke-dasharray="160 1072" stroke-dashoffset="-600" stroke-linecap="round" opacity=".7"/>
  </g>
  <g class="spin rev" style="transform-origin:${cx}px ${cy}px">
    <circle cx="${cx}" cy="${cy}" r="176" fill="none" stroke="${T.faint}" stroke-width=".8" stroke-dasharray="2 8" opacity=".6"/>
  </g>
  <g class="float">${identicon(cx, cy, 58)}</g>

  <text x="44" y="138" class="label in" style="fill:${T.accent};font-size:12px;animation-delay:.1s">${esc(config.greeting)}</text>
  <text x="40" y="238" class="in" style="font-family:${T.serifMono};font-size:104px;font-weight:700;fill:url(#dots);stroke:#9aa1bd;stroke-width:1.2;letter-spacing:2px;animation-delay:.3s">${esc(d.name)}</text>
  <text x="44" y="396" class="in" style="font-family:${T.serifMono};font-size:19px;animation-delay:.6s">${esc(focus)}</text>
  <text x="44" y="428" class="in small" style="font-family:${T.serifMono};font-size:13px;animation-delay:.75s">${esc(config.tagline)}</text>
  <rect x="44" y="370" width="2" height="0" fill="${T.ink}"/>

  <line x1="44" y1="496" x2="${W - 44}" y2="496" stroke="#c9cfdc"/>
  ${statSvg}`;

  const style = `
    .spin { animation: spin 40s linear infinite } .rev { animation-duration: 70s; animation-direction: reverse }
    @keyframes spin { to { transform: rotate(360deg) } }
    .float { animation: float 6s ease-in-out infinite }
    @keyframes float { 50% { transform: translateY(-8px) } }
    .pulse { animation: pulse 2.4s ease-in-out infinite }
    @keyframes pulse { 50% { opacity: .25 } }`;
  return frame(W, H, body, "", style);
}

function languagesCard(d) {
  const langs = d.languages.slice(0, config.maxLanguages);
  const W = 1080, cols = 4, colW = (W - 88) / cols, rowH = 150;
  const rows = Math.max(1, Math.ceil(langs.length / cols));
  const H = 180 + rows * rowH + 40;
  const items = langs
    .map((l, i) => {
      const { color, badge, fg } = lang(l.name);
      const x = 52 + (i % cols) * colW, y = 175 + Math.floor(i / cols) * rowH;
      const barW = colW - 40, fill = Math.max(3, (barW * l.pct) / 100);
      return `<g class="in" style="animation-delay:${0.1 + i * 0.08}s">
        <rect x="${x}" y="${y}" width="32" height="32" rx="5" fill="${color}"/>
        <text x="${x + 16}" y="${y + 21}" text-anchor="middle" style="font-size:${badge.length > 2 ? 10 : 13}px;font-weight:700;fill:${fg}">${esc(badge)}</text>
        <text x="${x}" y="${y + 62}" style="font-family:${T.serifMono};font-size:16px">${esc(l.name)}</text>
        <text x="${x}" y="${y + 86}" style="font-family:${T.serifMono};font-size:11px;fill:${T.muted}">${l.pct < 1 ? "&lt;1" : Math.round(l.pct)}% of public code</text>
        <rect x="${x}" y="${y + 104}" width="${barW}" height="2" fill="#d5dae5"/>
        <rect x="${x}" y="${y + 103}" width="${fill}" height="4" rx="1" fill="${color}" class="grow" style="animation-delay:${0.4 + i * 0.08}s"/>
      </g>`;
    })
    .join("");
  const body = `
  <text x="44" y="52" class="label">TECHNOLOGY SPECTRUM</text>
  <text x="44" y="98" style="font-family:${T.serifMono};font-size:28px;font-weight:700">The tools behind the work</text>
  <line x1="44" y1="132" x2="${W - 44}" y2="132" stroke="#c9cfdc" stroke-dasharray="6 10"/>
  ${items || `<text x="52" y="200" class="small">No public code yet.</text>`}`;
  const style = `.grow { transform-box: fill-box; transform-origin: left; animation: grow 1.2s cubic-bezier(.2,.7,.2,1) both }
    @keyframes grow { from { transform: scaleX(0) } }`;
  return frame(W, H, body, "", style);
}

function projectsCard(d) {
  const W = 1080, H = 740;
  const ps = d.projects;
  // Hub in the middle, satellites spread around it.
  const center = { x: W / 2, y: 340 };
  const slots = [
    [0, 0], [-350, -70], [350, -70], [-250, 170], [250, 170], [0, 260],
  ];
  const maxScore = Math.max(...ps.map((p) => Math.log2(2 + p.size + 50 * p.stars)), 1);
  const nodes = ps.map((p, i) => {
    const [dx, dy] = slots[i] || [0, 0];
    const r = i === 0 ? 72 : 30 + 22 * (Math.log2(2 + p.size + 50 * p.stars) / maxScore);
    return { ...p, x: center.x + dx, y: center.y + dy, r, ...lang(p.language) };
  });
  const links = nodes
    .slice(1)
    .map((n) => `<line x1="${center.x}" y1="${center.y}" x2="${n.x}" y2="${n.y}" stroke="${T.faint}" stroke-width="1" stroke-dasharray="3 6" class="flow"/>`)
    .join("");
  const circles = nodes
    .map((n, i) => {
      const labelY = i === 0 ? n.y + n.r + 34 : n.y + n.r + 28;
      return `<g class="in" style="animation-delay:${0.2 + i * 0.12}s"><g class="bob" style="animation-delay:${-i * 1.1}s">
        <circle cx="${n.x}" cy="${n.y}" r="${n.r + 12}" fill="none" stroke="${n.color}" stroke-opacity=".35" stroke-dasharray="10 6"/>
        <circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="${T.bg}"/>
        <circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="${n.color}" fill-opacity=".28" stroke="${n.color}" stroke-opacity=".5"/>
        <rect x="${n.x - 16}" y="${n.y - 16}" width="32" height="32" rx="6" fill="${n.color}"/>
        <text x="${n.x}" y="${n.y + 5}" text-anchor="middle" style="font-size:${n.badge.length > 2 ? 10 : 13}px;font-weight:700;fill:${n.fg}">${esc(n.badge)}</text>
        <text x="${n.x}" y="${labelY}" text-anchor="middle" style="font-family:${T.serifMono};font-size:17px">${esc(trunc(n.name, 24))}</text>
        <text x="${n.x}" y="${labelY + 20}" text-anchor="middle" style="font-family:${T.serifMono};font-size:11px;fill:${T.muted}">${esc(n.tag || n.language || "—")}${n.stars ? ` · ★ ${n.stars}` : ""}</text>
      </g></g>`;
    })
    .join("");
  const body = `
  <text x="44" y="52" class="label">PROJECT CONSTELLATION</text>
  <text x="44" y="98" style="font-family:${T.serifMono};font-size:28px;font-weight:700">A universe of work</text>
  <line x1="44" y1="132" x2="${W - 44}" y2="132" stroke="#c9cfdc" stroke-dasharray="6 10"/>
  ${links}${circles}`;
  const style = `.bob { animation: bob 7s ease-in-out infinite }
    @keyframes bob { 50% { transform: translateY(-6px) } }
    .flow { animation: flow 3s linear infinite } @keyframes flow { to { stroke-dashoffset: -36 } }`;
  return frame(W, H, body, "", style);
}

// Text comes from config.domains so it can be edited without touching code.
function domainsCard() {
  const ds = config.domains || [];
  const W = 1080, H = 520, colW = (W - 88) / Math.max(ds.length, 1);
  const cols = ds
    .map((d, i) => {
      const x = 44 + i * colW + (i ? 24 : 0), w = colW - 24;
      const pts = d.points
        .map((p, j) => `<text x="${x + 16}" y="${352 + j * 26}" style="font-family:${T.serifMono};font-size:13px">${esc(p)}</text>
          <rect x="${x}" y="${344 + j * 26}" width="6" height="6" fill="${d.color}"/>`)
        .join("");
      return `<g class="in" style="animation-delay:${0.15 + i * 0.15}s">
        ${i ? `<line x1="${x - 24}" y1="170" x2="${x - 24}" y2="${H - 60}" stroke="#d5dae5"/>` : ""}
        <text x="${x}" y="178" class="label" style="font-size:10px">0${i + 1} / ${esc(d.key)}</text>
        <circle cx="${x + w - 12}" cy="174" r="3" fill="${d.color}" class="pulse" style="animation-delay:${i * 0.5}s"/>
        <text x="${x}" y="214" style="font-family:${T.serifMono};font-size:19px;font-weight:700">${esc(d.title)}</text>
        <text x="${x}" y="284" style="font-size:44px;letter-spacing:1px;fill:${d.color}">${esc(d.metric[0])}</text>
        <text x="${x}" y="308" class="small" style="font-family:${T.serifMono}">${esc(d.metric[1])}</text>
        ${pts}
      </g>`;
    })
    .join("");
  const body = `
  <text x="44" y="52" class="label">DOMAINS</text>
  <text x="44" y="98" style="font-family:${T.serifMono};font-size:28px;font-weight:700">Where the work lives</text>
  <line x1="44" y1="132" x2="${W - 44}" y2="132" stroke="#c9cfdc" stroke-dasharray="6 10"/>
  ${cols}`;
  const style = `.pulse { animation: pulse 2.4s ease-in-out infinite } @keyframes pulse { 50% { opacity: .25 } }`;
  return frame(W, H, body, "", style);
}

// ---------- main ----------
const data = await loadData();
await mkdir(new URL("cards/", ROOT), { recursive: true });
await Promise.all([
  writeFile(new URL("cards/hero.svg", ROOT), heroCard(data)),
  writeFile(new URL("cards/languages.svg", ROOT), languagesCard(data)),
  writeFile(new URL("cards/projects.svg", ROOT), projectsCard(data)),
  writeFile(new URL("cards/domains.svg", ROOT), domainsCard()),
  writeFile(new URL("cards/stats.json", ROOT), JSON.stringify(data, null, 2) + "\n"),
]);
console.log(`cards written: ${data.repos} repos, ${data.stars} stars, ${data.contributions} contributions, ${data.languages.length} languages`);
