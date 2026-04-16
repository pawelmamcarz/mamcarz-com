#!/usr/bin/env node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT_DIR = path.join(ROOT, "assets", "img");

const SOURCES = [
  { file: "IMG_3284.jpeg", name: "IMG_3284" },
];

const WIDTHS = [480, 960, 1920];
const WEBP_QUALITY = 78;
const JPEG_QUALITY = 82;

async function ensureDir(dir) {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

async function processOne(src, name) {
  const buf = await readFile(path.join(ROOT, src));
  const meta = await sharp(buf).metadata();
  for (const w of WIDTHS) {
    if (meta.width && w > meta.width) continue;
    const base = path.join(OUT_DIR, `${name}-${w}`);
    await sharp(buf).resize({ width: w }).webp({ quality: WEBP_QUALITY }).toFile(`${base}.webp`);
    await sharp(buf).resize({ width: w }).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toFile(`${base}.jpg`);
    console.log(`✓ ${name}-${w}.webp / .jpg`);
  }
}

await ensureDir(OUT_DIR);
for (const s of SOURCES) await processOne(s.file, s.name);

console.log(`
Done. Generated files live in assets/img/.

Next: replace the <img> tag in index.html and en/index.html with:

  <picture>
    <source type="image/webp"
            srcset="/assets/img/IMG_3284-480.webp 480w,
                    /assets/img/IMG_3284-960.webp 960w,
                    /assets/img/IMG_3284-1920.webp 1920w"
            sizes="(max-width: 768px) 90vw, 480px">
    <img src="/assets/img/IMG_3284-960.jpg"
         srcset="/assets/img/IMG_3284-480.jpg 480w,
                 /assets/img/IMG_3284-960.jpg 960w,
                 /assets/img/IMG_3284-1920.jpg 1920w"
         sizes="(max-width: 768px) 90vw, 480px"
         alt="Paweł Mamcarz" loading="lazy" decoding="async"
         width="960" height="720">
  </picture>
`);
