/**
 * Checks the built site before it is published.
 *
 *   npm --prefix docs-site run verify
 *
 * Fails on missing pages, broken internal links, missing local assets, and an
 * installer manifest that does not match the firmware image beside it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'site');
const BASE = (process.env.SITE_BASE ?? '').replace(/\/+$/, '');
const problems = [];
const check = (condition, message) => { if (!condition) problems.push(message); };

if (!fs.existsSync(out)) {
  console.error('No site/ directory. Run `npm --prefix docs-site run build` first.');
  process.exit(1);
}

const pages = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.html')) pages.push(full);
  }
})(out);

check(pages.length >= 11, `expected at least 11 pages, found ${pages.length}`);
for (const required of ['index.html', 'install/index.html', 'docs/architecture/index.html',
  'docs/firmware/index.html', 'docs/hardware/index.html', 'site.webmanifest', '.nojekyll',
  'assets/site.css', 'assets/site.js', 'assets/brand/ecolume-mark.svg', 'assets/brand/favicon.ico',
  'vendor/esp-web-tools/install-button.js']) {
  check(fs.existsSync(path.join(out, required)), `missing from the build: ${required}`);
}

/** Resolves a site URL to the file that should serve it. */
function resolveTarget(url) {
  let rel = url.slice(BASE.length) || '/';
  if (!rel.startsWith('/')) return null;
  rel = decodeURIComponent(rel.split('#')[0].split('?')[0]);
  const target = path.join(out, rel);
  if (fs.existsSync(target)) {
    return fs.statSync(target).isDirectory() ? fs.existsSync(path.join(target, 'index.html')) : true;
  }
  return fs.existsSync(`${target}.html`);
}

for (const page of pages) {
  const html = fs.readFileSync(page, 'utf8');
  const label = path.relative(out, page);
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));

  for (const [, attribute, url] of html.matchAll(/\s(href|src)="([^"]+)"/g)) {
    if (/^(https?:|mailto:|tel:|data:|\/\/)/i.test(url)) continue;
    if (url.startsWith('#')) {
      check(ids.has(url.slice(1)), `${label}: anchor ${url} has no matching element`);
      continue;
    }
    check(url.startsWith(BASE ? `${BASE}/` : '/'),
      `${label}: ${attribute}="${url}" is not rooted at the site base "${BASE || '/'}"`);
    check(resolveTarget(url) === true, `${label}: ${attribute}="${url}" does not resolve to a file`);
  }

  // A resolved page or asset must never end up as a github.com/blob link: that
  // is the signature of a URL being rewritten twice, and a blob URL is an HTML
  // page, so an <img> pointing at one silently renders nothing.
  for (const [, url] of html.matchAll(/<img[^>]*\ssrc="(https:\/\/github\.com\/[^"]*)"/g)) {
    problems.push(`${label}: image points at a GitHub page, not an image: ${url}`);
  }
  for (const [, url] of html.matchAll(/"https:\/\/github\.com\/[^"]*\/blob\/main\/([^"]*)"/g)) {
    check(!/^(assets|docs)\//.test(url) || url.endsWith('.md'),
      `${label}: link escaped to GitHub for a path the site serves: ${url}`);
  }

  check(/<title>[^<]+<\/title>/.test(html), `${label}: missing a title`);
  check(/<meta name="description" content="[^"]+"/.test(html), `${label}: missing a description`);
}

// The installer is only useful if the manifest and the image agree.
const manifestPath = path.join(out, 'firmware/manifest.json');
const installer = fs.readFileSync(path.join(out, 'install/index.html'), 'utf8');
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  check(typeof manifest.version === 'string' && manifest.version.length > 0,
    'firmware manifest has no version');
  check(Array.isArray(manifest.builds) && manifest.builds.length > 0,
    'firmware manifest has no builds');
  for (const build of manifest.builds ?? []) {
    check(build.chipFamily === 'ESP32', `unexpected chipFamily: ${build.chipFamily}`);
    for (const part of build.parts ?? []) {
      const image = path.join(out, 'firmware', part.path);
      check(fs.existsSync(image), `firmware image referenced by the manifest is missing: ${part.path}`);
      if (fs.existsSync(image)) {
        check(fs.statSync(image).size > 256 * 1024,
          `firmware image looks truncated: ${part.path} (${fs.statSync(image).size} bytes)`);
      }
      check(part.offset === 0, `merged image must be flashed at offset 0, got ${part.offset}`);
    }
  }
  check(installer.includes(`manifest="${BASE}/firmware/manifest.json"`),
    'the installer page does not point at the bundled manifest');
  check(installer.includes('esp-web-install-button'),
    'the installer page is missing the install button');
} else {
  check(installer.includes('No firmware release has been published yet'),
    'no firmware bundled, but the installer page does not explain that');
  console.log('note: no firmware bundled; verified the installer fallback instead.');
}

if (problems.length) {
  console.error(`Site verification failed with ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`Site verification passed: ${pages.length} pages, all internal links and assets resolve.`);
