/**
 * Regenerates the raster EcoLume icons from the SVG sources in this folder.
 *
 * Development-only helper: it is not part of any build or CI job, and the
 * generated files are committed so no runtime dependency is required.
 *
 *   npx playwright@1 install chromium   # once
 *   node brand/generate-icons.mjs
 *
 * Set CHROMIUM_NO_SANDBOX=1 when running inside a container as root.
 */
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFile(path.join(dir, file), 'utf8');

// Full-bleed variants: platform launchers apply their own corner mask, so the
// tile must not carry rounded corners of its own.
const squared = (svg) => svg.replaceAll(/ rx="1[0-9]"/g, ' rx="0"');
const inset = (svg, pad) =>
  svg.replace('</defs>', `</defs><rect width="64" height="64" fill="#1E90FF"/>`)
     .replaceAll(/(<rect width="64" height="64" rx="0")/g, `$1 transform="translate(${pad} ${pad}) scale(${(64 - 2 * pad) / 64})"`)
     .replaceAll(/(<(?:rect|path)[^>]*mask="[^"]*")/g, `$1`);

const png = async (page, svg, size) => {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`
  );
  return page.screenshot({ omitBackground: true });
};

function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

const browser = await chromium.launch({
  args: process.env.CHROMIUM_NO_SANDBOX ? ['--no-sandbox'] : []
});
const page = await browser.newPage({ deviceScaleFactor: 1 });

const mark = await read('ecolume-mark.svg');
const favicon = await read('favicon.svg');
const written = [];

for (const size of [192, 512]) {
  await fs.writeFile(path.join(dir, `icon-${size}.png`), await png(page, mark, size));
  written.push(`icon-${size}.png`);
}
await fs.writeFile(path.join(dir, 'apple-touch-icon.png'), await png(page, squared(mark), 180));
written.push('apple-touch-icon.png');

// Maskable icons keep artwork inside the safe zone (80% of the canvas).
const maskable = squared(mark).replace(
  '<rect width="64" height="64" rx="0" fill="#fff" mask="url(#ecolumeGlyph)"/>',
  '<g transform="translate(6.4 6.4) scale(0.8)"><rect width="64" height="64" rx="0" fill="#fff" mask="url(#ecolumeGlyph)"/></g>'
);
await fs.writeFile(path.join(dir, 'maskable-512.png'), await png(page, maskable, 512));
written.push('maskable-512.png');

const icoParts = [];
for (const size of [16, 32, 48]) {
  const data = await png(page, favicon, size);
  await fs.writeFile(path.join(dir, `favicon-${size}.png`), data);
  written.push(`favicon-${size}.png`);
  icoParts.push({ size, data });
}
await fs.writeFile(path.join(dir, 'favicon.ico'), ico(icoParts));
written.push('favicon.ico');

// Social preview card used by the documentation site.
const logo = await read('ecolume-logo.svg');
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<style>
  html,body{margin:0;height:100%}
  body{display:grid;place-items:center;background:
    radial-gradient(900px 520px at 78% 12%, rgba(30,144,255,.34), transparent 62%),
    radial-gradient(700px 460px at 10% 96%, rgba(11,103,199,.28), transparent 60%),
    #060B14;
    font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:#EAF1FA}
  .wrap{display:grid;gap:30px;justify-items:center;text-align:center;padding:0 90px}
  svg{width:560px;height:126px}
  p{margin:0;font-size:31px;line-height:1.45;color:#A9BFD8;max-width:900px}
  .grid{position:fixed;inset:0;opacity:.16;background-image:
    linear-gradient(rgba(30,144,255,.35) 1px,transparent 1px),
    linear-gradient(90deg,rgba(30,144,255,.35) 1px,transparent 1px);background-size:76px 76px;
    -webkit-mask-image:radial-gradient(closest-side,#000,transparent)}
</style><div class="grid"></div><div class="wrap">${logo}<p>Secure-by-design smart street-light management for nationwide public lighting — ESP32 field controllers, live telemetry, remote dimming and fleet maintenance.</p></div>`);
await fs.writeFile(path.join(dir, 'og-image.png'), await page.screenshot());
written.push('og-image.png');

await browser.close();
console.log(`Generated ${written.length} files:\n  ${written.join('\n  ')}`);
