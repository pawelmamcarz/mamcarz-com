#!/usr/bin/env node
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT_DIR = path.join(ROOT, "assets", "img");

// Źródła podpina się tu ręcznie na czas optymalizacji albo podaje w wierszu poleceń:
//   npm run optimize:images -- <ścieżka-źródła> <nazwa> [--alpha]
// Oryginałów nie trzymamy w repozytorium: każdy plik w assets/img trafia do paczki publicznej.
// --alpha zachowuje przezroczystość: obok WebP powstaje PNG zamiast JPG.
const SOURCES = [];

const WIDTHS = [480, 960, 1920];
const WEBP_QUALITY = 78;
const JPEG_QUALITY = 82;
const PNG_QUALITY = 80;

async function ensureDir(dir) {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

async function processOne(src, name, { alpha = false } = {}) {
  const buf = await readFile(path.resolve(ROOT, src));
  const meta = await sharp(buf).metadata();
  const fallback = alpha ? "png" : "jpg";
  await Promise.all(
    WIDTHS
      .filter(w => !meta.width || w <= meta.width)
      .flatMap(w => {
        const base = path.join(OUT_DIR, `${name}-${w}`);
        const resized = () => sharp(buf).resize({ width: w });
        const encoded = alpha
          ? resized().png({ palette: true, quality: PNG_QUALITY, effort: 10, compressionLevel: 9 })
          : resized().jpeg({ quality: JPEG_QUALITY, mozjpeg: true });
        return [
          resized().webp({ quality: WEBP_QUALITY, alphaQuality: 90, effort: 6 }).toFile(`${base}.webp`)
            .then(() => console.log(`✓ ${name}-${w}.webp`)),
          encoded.toFile(`${base}.${fallback}`)
            .then(() => console.log(`✓ ${name}-${w}.${fallback}`)),
        ];
      })
  );
}

const args = process.argv.slice(2);
const cliSources = args.filter(a => !a.startsWith("--"));
if (cliSources.length) SOURCES.push({ file: cliSources[0], name: cliSources[1], alpha: args.includes("--alpha") });
if (SOURCES.some(s => !s.file || !s.name)) throw new Error("Usage: optimize:images -- <source> <name> [--alpha]");

await ensureDir(OUT_DIR);
for (const s of SOURCES) await processOne(s.file, s.name, { alpha: s.alpha });

console.log(`
Done. Generated files live in assets/img/.

Next: reference them with <picture>, explicit width/height, loading="lazy" and decoding="async", e.g.

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
