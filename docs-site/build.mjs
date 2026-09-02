/**
 * Builds the PLXY EcoLume documentation site into docs-site/site/.
 *
 *   npm --prefix docs-site ci
 *   npm --prefix docs-site run build
 *
 * Environment:
 *   SITE_BASE     URL prefix the site is served from ("" locally,
 *                 "/PLXY_EcoLume" on GitHub Pages project sites).
 *   SITE_ORIGIN   Absolute origin used for canonical and social tags.
 *
 * Firmware for the web installer is expected in docs-site/site/firmware/
 * (manifest.json + merged image). The release workflow places it there; when it
 * is missing the installer page degrades to a "no release yet" notice.
 */
import { marked } from 'marked';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const out = path.join(here, 'site');

const BASE = (process.env.SITE_BASE ?? '').replace(/\/+$/, '');
const ORIGIN = (process.env.SITE_ORIGIN ?? 'https://sengphirum.github.io').replace(/\/+$/, '');
const REPO_URL = 'https://github.com/SengPhirum/PLXY_EcoLume';
const MERMAID = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs';

/* ------------------------------------------------------------------ pages */

const DOC_PAGES = [
  { slug: 'overview', source: 'README.md', title: 'Overview', group: 'Get started',
    description: 'What PLXY EcoLume is, what ships in the repository, and how to run it.' },
  { slug: 'architecture', source: 'docs/ARCHITECTURE.md', title: 'Architecture', group: 'Platform',
    description: 'Components, data flow, and the responsibilities of each service.' },
  { slug: 'api', source: 'docs/API.md', title: 'API & MQTT contract', group: 'Platform',
    description: 'Telemetry schema, command envelope, events, and the HTTPS fallback.' },
  { slug: 'security', source: 'docs/SECURITY.md', title: 'Security model', group: 'Platform',
    description: 'Credentials, transport security, access control, and auditing.' },
  { slug: 'deployment', source: 'docs/DEPLOYMENT.md', title: 'Deployment', group: 'Platform',
    description: 'Environment configuration, Compose deployment, migrations, and backups.' },
  { slug: 'rollout', source: 'docs/ROLLOUT.md', title: 'Field rollout', group: 'Platform',
    description: 'Pilot, controlled provincial rollout, and national operations.' },
  { slug: 'hardware', source: 'docs/HARDWARE.md', title: 'Reference hardware', group: 'Field hardware',
    description: 'Controller parts, product pictures, and purchasing guidance.' },
  { slug: 'firmware', source: 'firmware/README.md', title: 'ESP32 + SIM7600 firmware', group: 'Field hardware',
    description: 'Illustrated wiring, flashing, provisioning, and bench testing.' },
  { slug: 'lorawan', source: 'firmware-lorawan/README.md', title: 'LoRaWAN option', group: 'Field hardware',
    description: 'Low-cost LoRaWAN architecture, gateway setup, and rollout tutorial.' }
];

/** Repository paths that resolve to a page instead of a raw file. */
const SOURCE_TO_URL = new Map(DOC_PAGES.map((page) => [page.source, `${BASE}/docs/${page.slug}/`]));

/** Repository asset trees copied into the site. */
const ASSET_TREES = [
  { from: 'brand', to: 'assets/brand' },
  { from: 'docs/assets', to: 'assets/docs' },
  { from: 'firmware/docs/images', to: 'assets/firmware/images' }
];

/* ------------------------------------------------------------------ utils */

const NAV = [
  { href: `${BASE}/`, label: 'Overview', match: 'home' },
  { href: `${BASE}/docs/architecture/`, label: 'Architecture', match: 'architecture' },
  { href: `${BASE}/docs/hardware/`, label: 'Hardware', match: 'hardware' },
  { href: `${BASE}/docs/firmware/`, label: 'Firmware', match: 'firmware' },
  { href: `${BASE}/docs/api/`, label: 'API', match: 'api' },
  { href: `${BASE}/docs/security/`, label: 'Security', match: 'security' }
];

const escapeHtml = (value) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const slugify = (text) =>
  text.toLowerCase().trim()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

function write(relative, contents) {
  const target = path.join(out, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

/**
 * Rewrites a link that was written relative to `fromDir` in the repository so
 * it resolves on the site: pages become clean URLs, copied assets get their new
 * home, and anything else falls back to the file on GitHub.
 */
function rewriteUrl(url, fromDir) {
  if (!url || /^(https?:|mailto:|tel:|data:|#)/i.test(url)) return url;
  // Already a site path. The raw-HTML pass below runs over output this function
  // produced, so rewriting has to be idempotent or a resolved URL gets treated
  // as a repository path and falls through to the GitHub fallback.
  if (url.startsWith('/')) return url;
  const [rawPath, hash = ''] = url.split('#');
  if (!rawPath) return url;
  const repoPath = path.posix.normalize(path.posix.join(fromDir, rawPath)).replace(/^\.\//, '');
  const suffix = hash ? `#${hash}` : '';

  const page = SOURCE_TO_URL.get(repoPath);
  if (page) return page + suffix;

  for (const tree of ASSET_TREES) {
    if (repoPath.startsWith(`${tree.from}/`)) {
      return `${BASE}/${tree.to}/${repoPath.slice(tree.from.length + 1)}${suffix}`;
    }
  }
  return `${REPO_URL}/blob/main/${repoPath}${suffix}`;
}

/** Renderer that rewrites repository-relative URLs and collects a heading outline. */
class SiteRenderer extends marked.Renderer {
  constructor(fromDir) {
    super();
    this.fromDir = fromDir;
    this.toc = [];
    this.slugs = new Map();
  }

  heading({ tokens, depth }) {
    const text = this.parser.parseInline(tokens);
    const base = slugify(text) || `section-${this.toc.length + 1}`;
    const seen = this.slugs.get(base) ?? 0;
    this.slugs.set(base, seen + 1);
    const id = seen ? `${base}-${seen}` : base;
    if (depth === 2 || depth === 3) this.toc.push({ id, depth, text: text.replace(/<[^>]+>/g, '') });
    const anchor = depth > 1 ? `<a class="anchor" href="#${id}" aria-label="Link to this section">#</a>` : '';
    return `<h${depth} id="${id}">${text}${anchor}</h${depth}>\n`;
  }

  link({ href, title, tokens }) {
    const external = /^https?:/i.test(href);
    return `<a href="${escapeHtml(rewriteUrl(href, this.fromDir))}"` +
      `${title ? ` title="${escapeHtml(title)}"` : ''}` +
      `${external ? ' target="_blank" rel="noopener"' : ''}>${this.parser.parseInline(tokens)}</a>`;
  }

  image({ href, title, text }) {
    return `<img src="${escapeHtml(rewriteUrl(href, this.fromDir))}" alt="${escapeHtml(text ?? '')}"` +
      `${title ? ` title="${escapeHtml(title)}"` : ''} loading="lazy">`;
  }

  table(token) {
    return `<div class="table-scroll">${super.table(token)}</div>`;
  }

  code({ text, lang }) {
    return lang === 'mermaid'
      ? `<pre class="mermaid">${escapeHtml(text)}</pre>`
      : `<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${escapeHtml(text)}</code></pre>`;
  }
}

/** Converts one markdown document to HTML and collects its heading outline. */
function renderMarkdown(markdown, fromDir) {
  const renderer = new SiteRenderer(fromDir);
  let html = marked.parse(markdown, { renderer, gfm: true, async: false });
  // Raw <img>/<a> written directly in the markdown bypass the renderer hooks.
  html = html
    .replace(/(<img[^>]*\ssrc=")([^"]+)(")/g, (_m, a, url, b) => a + escapeHtml(rewriteUrl(url, fromDir)) + b)
    .replace(/(<a[^>]*\shref=")([^"]+)(")/g, (_m, a, url, b) =>
      a + (url.startsWith('#') ? url : escapeHtml(rewriteUrl(url, fromDir))) + b);
  return { html, toc: renderer.toc, hasMermaid: html.includes('class="mermaid"') };
}

/* ----------------------------------------------------------------- layout */

const ICON_MENU = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
const ICON_SUN = '<svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M19.1 4.9l-1.5 1.5M6.4 17.6l-1.5 1.5"/></svg>';
const ICON_MOON = '<svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/></svg>';
const ICON_GITHUB = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 1.5a10.5 10.5 0 0 0-3.32 20.47c.53.1.72-.23.72-.5v-1.8c-2.92.64-3.54-1.4-3.54-1.4-.48-1.22-1.17-1.54-1.17-1.54-.95-.65.07-.64.07-.64 1.06.07 1.61 1.09 1.61 1.09.94 1.6 2.46 1.14 3.06.87.1-.68.37-1.14.67-1.4-2.33-.27-4.79-1.17-4.79-5.2 0-1.15.41-2.09 1.09-2.83-.11-.27-.47-1.34.1-2.79 0 0 .88-.28 2.9 1.08a10 10 0 0 1 5.28 0c2-1.36 2.89-1.08 2.89-1.08.57 1.45.21 2.52.1 2.79.68.74 1.09 1.68 1.09 2.83 0 4.04-2.47 4.93-4.82 5.19.38.33.71.97.71 1.96v2.9c0 .28.19.61.73.5A10.5 10.5 0 0 0 12 1.5Z"/></svg>';

function layout({ title, description, body, active, extraHead = '', bodyClass = '', canonical }) {
  const navLinks = NAV.map((item) =>
    `<a href="${item.href}"${item.match === active ? ' class="current" aria-current="page"' : ''}>${item.label}</a>`
  ).join('');
  return `<!doctype html>
<html lang="en" data-theme-default="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#1E90FF">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${ORIGIN}${canonical}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${ORIGIN}${BASE}/assets/brand/og-image.png">
<meta property="og:url" content="${ORIGIN}${canonical}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${BASE}/assets/brand/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="${BASE}/assets/brand/favicon.ico" sizes="48x48">
<link rel="apple-touch-icon" href="${BASE}/assets/brand/apple-touch-icon.png">
<link rel="manifest" href="${BASE}/site.webmanifest">
<link rel="stylesheet" href="${BASE}/assets/site.css">
<script>
  // Applied before first paint so a stored theme never flashes the wrong palette.
  try { var t = localStorage.getItem('ecolume-theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
</script>
${extraHead}</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
<a class="skip-link" href="#main">Skip to content</a>
<header class="nav">
  <div class="wrap nav-inner">
    <a class="logo" href="${BASE}/">
      <img src="${BASE}/assets/brand/ecolume-mark.svg" width="32" height="32" alt="">
      <span style="display:block"><b>EcoLume</b><span>PLXY</span></span>
    </a>
    <nav class="nav-links" id="nav-links" aria-label="Primary">${navLinks}</nav>
    <div class="nav-actions">
      <a class="btn btn-primary btn-sm" href="${BASE}/install/">Install firmware</a>
      <button class="icon-btn theme-toggle" type="button" data-theme-toggle aria-label="Switch colour theme">${ICON_SUN}${ICON_MOON}</button>
      <a class="icon-btn" href="${REPO_URL}" aria-label="EcoLume on GitHub" target="_blank" rel="noopener">${ICON_GITHUB}</a>
      <button class="icon-btn nav-toggle" type="button" data-nav-toggle aria-controls="nav-links" aria-expanded="false" aria-label="Open navigation">${ICON_MENU}</button>
    </div>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="footer">
  <div class="wrap">
    <div class="footer-grid">
      <div>
        <a class="logo" href="${BASE}/" style="margin-bottom:14px">
          <img src="${BASE}/assets/brand/ecolume-mark.svg" width="32" height="32" alt="">
          <span style="display:block"><b>EcoLume</b><span>PLXY</span></span>
        </a>
        <p style="margin:0;max-width:320px">Secure-by-design smart street-light management for nationwide public lighting.</p>
      </div>
      <div><h5>Get started</h5><ul>
        <li><a href="${BASE}/install/">Install firmware</a></li>
        <li><a href="${BASE}/docs/overview/">Overview</a></li>
        <li><a href="${BASE}/docs/deployment/">Deployment</a></li>
      </ul></div>
      <div><h5>Platform</h5><ul>
        <li><a href="${BASE}/docs/architecture/">Architecture</a></li>
        <li><a href="${BASE}/docs/api/">API &amp; MQTT</a></li>
        <li><a href="${BASE}/docs/security/">Security</a></li>
      </ul></div>
      <div><h5>Field</h5><ul>
        <li><a href="${BASE}/docs/hardware/">Hardware</a></li>
        <li><a href="${BASE}/docs/firmware/">ESP32 firmware</a></li>
        <li><a href="${BASE}/docs/lorawan/">LoRaWAN option</a></li>
      </ul></div>
    </div>
    <div class="footer-note">
      <span>Reference implementation — complete electrical certification, RF testing, security review, and ministry acceptance before public-road deployment.</span>
      <a href="${REPO_URL}">Source on GitHub</a>
    </div>
  </div>
</footer>
<script src="${BASE}/assets/site.js" defer></script>
</body>
</html>
`;
}

const mermaidBoot = `<script type="module">
import mermaid from '${MERMAID}';
const dark = () => (document.documentElement.dataset.theme
  || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')) === 'dark';
const render = () => mermaid.initialize({
  startOnLoad: true,
  securityLevel: 'strict',
  theme: 'base',
  themeVariables: {
    fontFamily: 'Inter, Segoe UI, system-ui, sans-serif',
    primaryColor: dark() ? '#12263a' : '#e8f2fd',
    primaryTextColor: dark() ? '#eaf1fa' : '#0f1b2a',
    primaryBorderColor: '#1e90ff',
    lineColor: dark() ? '#4c81b5' : '#0b67c7',
    secondaryColor: dark() ? '#0e1b2a' : '#f3f8fd',
    tertiaryColor: dark() ? '#0b1622' : '#ffffff'
  }
});
render();
</script>`;

/* ------------------------------------------------------------------ build */

function copyTree(from, to) {
  const source = path.join(repo, from);
  if (!fs.existsSync(source)) return false;
  fs.mkdirSync(path.join(out, to), { recursive: true });
  fs.cpSync(source, path.join(out, to), { recursive: true });
  return true;
}

function readFirmwareRelease() {
  const manifestPath = path.join(out, 'firmware', 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const part = manifest.builds?.[0]?.parts?.[0]?.path;
  const image = part ? path.join(out, 'firmware', part) : null;
  const bytes = image && fs.existsSync(image) ? fs.statSync(image).size : 0;
  return {
    version: manifest.version ?? 'unknown',
    channel: manifest.ecolume?.channel ?? 'stable',
    built: manifest.ecolume?.built ?? '',
    releaseUrl: manifest.ecolume?.releaseUrl ?? `${REPO_URL}/releases`,
    size: bytes ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : 'unknown'
  };
}

function buildDocPage(page) {
  const source = path.join(repo, page.source);
  const markdown = fs.readFileSync(source, 'utf8');
  const { html, toc, hasMermaid } = renderMarkdown(markdown, path.posix.dirname(page.source));

  const groups = [...new Set(DOC_PAGES.map((entry) => entry.group))];
  const side = groups.map((group) => `<section><h4>${group}</h4>${
    // The installer is not a markdown page but belongs at the top of the list.
    group === 'Get started' ? `<a href="${BASE}/install/">Install firmware</a>` : ''
  }${
    DOC_PAGES.filter((entry) => entry.group === group).map((entry) =>
      `<a href="${BASE}/docs/${entry.slug}/"${entry.slug === page.slug ? ' class="current" aria-current="page"' : ''}>${entry.title}</a>`
    ).join('')
  }</section>`).join('');

  const tocHtml = toc.length
    ? `<nav class="doc-toc" aria-label="On this page"><h4>On this page</h4>${
        toc.map((item) => `<a class="lvl${item.depth}" href="#${item.id}">${item.text}</a>`).join('')
      }</nav>`
    : '<div></div>';

  const body = `<div class="wrap doc-shell">
  <nav class="doc-side" aria-label="Documentation">
    ${side}
  </nav>
  <article class="prose">
    ${html}
    <div class="doc-foot">
      <a href="${REPO_URL}/blob/main/${page.source}">Edit this page on GitHub</a>
      <a href="${BASE}/install/">Install the firmware →</a>
    </div>
  </article>
  ${tocHtml}
</div>`;

  write(`docs/${page.slug}/index.html`, layout({
    title: `${page.title} · PLXY EcoLume`,
    description: page.description,
    canonical: `${BASE}/docs/${page.slug}/`,
    active: page.slug,
    extraHead: hasMermaid ? mermaidBoot : '',
    body
  }));
}

function buildLanding(release) {
  const body = fs.readFileSync(path.join(here, 'pages/index.html'), 'utf8').replaceAll('{{BASE}}', BASE);
  write('index.html', layout({
    title: 'PLXY EcoLume — smart street-light management',
    description: 'Open, secure-by-design smart street-light platform: ESP32 field controllers, live telemetry, remote dimming, alerts and maintenance for nationwide public lighting.',
    canonical: `${BASE}/`,
    active: 'home',
    extraHead: body.includes('class="mermaid"') ? mermaidBoot : '',
    body
  }));
  return release;
}

function buildInstaller(release) {
  let body = fs.readFileSync(path.join(here, 'pages/install.html'), 'utf8');
  if (release) {
    body = body
      .replaceAll('{{MANIFEST_URL}}', `${BASE}/firmware/manifest.json`)
      .replaceAll('{{FIRMWARE_VERSION}}', release.version)
      .replaceAll('{{FIRMWARE_CHANNEL}}', release.channel)
      .replaceAll('{{FIRMWARE_SIZE}}', release.size)
      .replaceAll('{{FIRMWARE_BUILT}}', release.built)
      .replaceAll('{{RELEASE_URL}}', release.releaseUrl);
  } else {
    // No firmware bundled: keep the page useful and point at the local build.
    body = body.replace(
      /<div class="install-action">[\s\S]*?<\/div>\s*<div class="release-meta">[\s\S]*?<\/div>/,
      `<div class="unsupported">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
        <span>No firmware release has been published yet, so there is nothing to install from the browser. Tag a <code>firmware-v*</code> release to publish one, or <a href="${BASE}/docs/firmware/">build and flash locally with PlatformIO</a>.</span>
      </div>`
    ).replaceAll('{{FIRMWARE_VERSION}}', '');
  }
  body = body.replaceAll('{{BASE}}', BASE);

  write('install/index.html', layout({
    title: 'Install EcoLume on an ESP32 · PLXY EcoLume',
    description: 'Flash the latest stable EcoLume firmware onto an ESP32 straight from your browser over USB, then provision the controller from the serial console.',
    canonical: `${BASE}/install/`,
    active: 'install',
    extraHead: release ? `<script type="module" src="${BASE}/vendor/esp-web-tools/install-button.js"></script>` : '',
    body
  }));
}

/* -------------------------------------------------------------------- run */

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// Firmware staged by CI before the build (or by a developer for a local test).
const staged = process.env.FIRMWARE_DIR;
if (staged && fs.existsSync(staged)) {
  fs.mkdirSync(path.join(out, 'firmware'), { recursive: true });
  fs.cpSync(staged, path.join(out, 'firmware'), { recursive: true });
}

for (const tree of ASSET_TREES) {
  if (!copyTree(tree.from, tree.to)) console.warn(`! missing asset tree: ${tree.from}`);
}
fs.cpSync(path.join(here, 'assets/site.css'), path.join(out, 'assets/site.css'));
fs.cpSync(path.join(here, 'assets/site.js'), path.join(out, 'assets/site.js'));
fs.cpSync(
  path.join(here, 'node_modules/esp-web-tools/dist/web'),
  path.join(out, 'vendor/esp-web-tools'),
  { recursive: true }
);

// Tell GitHub Pages not to run the output through Jekyll.
write('.nojekyll', '');
write('site.webmanifest', JSON.stringify({
  name: 'PLXY EcoLume documentation',
  short_name: 'EcoLume',
  description: 'Smart street-light management for nationwide public lighting.',
  start_url: `${BASE}/`,
  scope: `${BASE}/`,
  display: 'standalone',
  background_color: '#060B14',
  theme_color: '#1E90FF',
  icons: [
    { src: `${BASE}/assets/brand/icon-192.png`, sizes: '192x192', type: 'image/png' },
    { src: `${BASE}/assets/brand/icon-512.png`, sizes: '512x512', type: 'image/png' },
    { src: `${BASE}/assets/brand/maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ]
}, null, 2));

const release = readFirmwareRelease();
buildLanding(release);
buildInstaller(release);
DOC_PAGES.forEach(buildDocPage);

write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}${BASE}/sitemap.xml\n`);
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[`${BASE}/`, `${BASE}/install/`, ...DOC_PAGES.map((page) => `${BASE}/docs/${page.slug}/`)]
  .map((loc) => `  <url><loc>${ORIGIN}${loc}</loc></url>`).join('\n')}
</urlset>
`);

console.log(
  `Built ${DOC_PAGES.length + 2} pages into ${path.relative(repo, out)}` +
  ` (base "${BASE || '/'}", firmware ${release ? `${release.version} ${release.size}` : 'not bundled'}).`
);
