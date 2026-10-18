// Vite build plugin: responsive WebP for every JPG the built pages use.
//
// Runs in `closeBundle` (after the i18n plugin has written the EN + BG pages
// and Vite has written the CSS), and only touches files inside outDir — the
// source tree keeps plain JPGs, so adding or replacing a photo stays "drop a
// .jpg into assets/img".
//
// For each fingerprinted JPG under <base>assets/ it writes WebP siblings at
// several widths (never upscaled) and then rewrites the emitted files:
//   - <img src="x.jpg">            → + srcset of the WebP widths (src stays the
//                                    JPG fallback) + decoding="async". The
//                                    `sizes` attribute comes from the source
//                                    HTML; without one the browser assumes 100vw.
//   - background-image: url(x.jpg) → keep the JPG declaration and add a second
//                                    `image-set()` one preferring the WebP; a
//                                    browser without image-set() keeps the JPG.
//   - <link rel=preload as=image href=x.jpg> → preload the WebP instead, so a
//                                    background that resolves to WebP isn't
//                                    fetched twice.
//
// Variants are cached in node_modules/.cache (keyed by the content-hashed
// file name + width), so rebuilds only encode new or changed photos.

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import sharp from 'sharp';

const WIDTHS = [480, 800, 1200, 1600, 1920];
const QUALITY = 78;

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

export function imageOptimizePlugin({ cacheDir } = {}) {
  let outDir;
  let base;
  return {
    name: 'vayana-image-optimize',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      outDir = config.build.outDir.startsWith('/') || /^[A-Za-z]:/.test(config.build.outDir)
        ? config.build.outDir
        : join(config.root, config.build.outDir);
      base = config.base;
      cacheDir = cacheDir || join(config.root, 'node_modules', '.cache', 'vayana-images');
    },
    async closeBundle() {
      const assetsDir = join(outDir, 'assets');
      if (!existsSync(assetsDir)) return;
      mkdirSync(cacheDir, { recursive: true });

      // name.jpg → { widths: [..], full: 'name-<w>w.webp' }
      const variants = new Map();
      async function ensure(name) {
        if (variants.has(name)) return variants.get(name);
        const src = join(assetsDir, name);
        if (!existsSync(src)) return null;
        const { width } = await sharp(src).metadata();
        const widths = WIDTHS.filter((w) => w < width);
        widths.push(Math.min(width, WIDTHS[WIDTHS.length - 1]));
        const stem = name.slice(0, -extname(name).length);
        for (const w of widths) {
          const file = `${stem}-${w}w.webp`;
          const cached = join(cacheDir, file);
          if (!existsSync(cached)) {
            await sharp(src).resize({ width: w, withoutEnlargement: true }).webp({ quality: QUALITY }).toFile(cached);
          }
          copyFileSync(cached, join(assetsDir, file));
        }
        const v = { widths, stem, full: `${stem}-${widths[widths.length - 1]}w.webp` };
        variants.set(name, v);
        return v;
      }

      const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const assetRe = new RegExp(`${esc}assets/([\\w.-]+\\.jpe?g)`, 'g');
      const url = (f) => `${base}assets/${f}`;
      const srcsetOf = (v) => v.widths.map((w) => `${url(`${v.stem}-${w}w.webp`)} ${w}w`).join(', ');

      const files = walk(outDir).filter((f) => /\.(html|css)$/.test(f));
      // Encode every referenced JPG first (sequential keeps memory flat).
      for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(assetRe)) await ensure(m[1]);

      // q = quote char: single quotes inside HTML style="" attributes (a double
      // quote would end the attribute), double quotes in .css files.
      const imageSet = (jpgUrl, name, q) => {
        const v = variants.get(name);
        return v ? `image-set(url(${q}${url(v.full)}${q}) type(${q}image/webp${q}), url(${q}${jpgUrl}${q}) type(${q}image/jpeg${q}))` : null;
      };
      // background-image: url(...jpg) — keep it, then add an image-set() override.
      const bgRe = new RegExp(`background-image:\\s*url\\((['"]?)(${esc}assets/([\\w.-]+\\.jpe?g))\\1\\)`, 'g');

      let imgs = 0, bgs = 0, preloads = 0;
      for (const f of files) {
        const before = readFileSync(f, 'utf8');
        const quote = f.endsWith('.html') ? "'" : '"';
        let t = before.replace(bgRe, (m, q, jpgUrl, name) => {
          const set = imageSet(jpgUrl, name, quote);
          if (!set) return m;
          bgs++;
          return `${m};background-image:${set}`;
        });
        if (f.endsWith('.html')) {
          t = t.replace(/<img\b[^>]*>/g, (tag) => {
            const m = tag.match(new RegExp(`\\ssrc="(${esc}assets/([\\w.-]+\\.jpe?g))"`));
            if (!m || /\ssrcset=/.test(tag)) return tag;
            const v = variants.get(m[2]);
            if (!v) return tag;
            imgs++;
            let out = tag.replace(/\s*\/?>$/, '');
            out += ` srcset="${srcsetOf(v)}"`;
            if (!/\sdecoding=/.test(tag)) out += ' decoding="async"';
            return `${out}${tag.endsWith('/>') ? ' />' : '>'}`;
          });
          t = t.replace(/<link\b[^>]*rel="preload"[^>]*>/g, (tag) => {
            const m = tag.match(new RegExp(`href="(${esc}assets/([\\w.-]+\\.jpe?g))"`));
            const v = m && /as="image"/.test(tag) ? variants.get(m[2]) : null;
            if (!v) return tag;
            preloads++;
            return tag.replace(m[1], url(v.full)).replace(/\s*\/?>$/, ' type="image/webp" />');
          });
        }
        if (t !== before) writeFileSync(f, t);
      }

      let jpgBytes = 0, webpBytes = 0;
      for (const [name, v] of variants) {
        jpgBytes += statSync(join(assetsDir, name)).size;
        webpBytes += statSync(join(assetsDir, v.full)).size;
      }
      console.log(
        `[images] ${variants.size} photos → WebP (${WIDTHS.join('/')}px); ` +
        `${imgs} <img> srcset, ${bgs} backgrounds, ${preloads} preloads. ` +
        `Full-size: JPG ${(jpgBytes / 1048576).toFixed(1)} MB → WebP ${(webpBytes / 1048576).toFixed(1)} MB`,
      );
    },
  };
}
