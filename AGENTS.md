# AGENTS.md

Guidance for coding agents working in this repository. Same content as `CLAUDE.md` — kept in sync for tools that look for `AGENTS.md`.

## Projekt
Osobista strona profesjonalna Pawła Mamcarza — konsultant procurement / SAP Ariba w regionie CEE.
Statyczny HTML (bez frameworka), dwie wersje językowe: PL (root) i EN (`en/`).

## Hosting & Deploy
- **Cloudflare Pages** (NIE Vercel). Projekt: `mamcarz-com`.
- Strona: `wrangler pages deploy . --project-name mamcarz-com --branch main --commit-dirty=true`
  - lub `./deploy.sh` (najpierw `git push`, potem deploy do Pages)
- Worker czatowy w `worker/` deployuje się osobno: `cd worker && wrangler deploy` (osobny `wrangler.toml`, binding `AI` = Workers AI).
- CF Pages config: `_headers` (security headers + cache-control), `_redirects` (apex redirect z `www`).

## Struktura
```
index.html              # PL (strona główna)
en/index.html           # EN (strona główna)
uslugi/*/index.html     # PL podstrony usługowe (3)
en/uslugi/*/index.html  # EN podstrony usługowe (mirror)
case-studies/, en/case-studies/
wystapienia/, en/wystapienia/
assets/css/style.css    # Jeden arkusz dla całej strony
assets/js/main.js       # JS (chat widget + drobne interakcje)
assets/img/             # Zoptymalizowane obrazy (webp/jpg, multi-resolution)
worker/index.js         # Cloudflare Worker — chat API (Workers AI, Llama 3.3 70B)
scripts/optimize-images.js  # node scripts/optimize-images.js — generuje warianty 480/960/1920 webp+jpg
404.html, sitemap.xml, robots.txt, llms.txt, llms-full.txt
```

Brak frameworka, brak buildu — pliki HTML serwowane bezpośrednio. Jedyny krok offline to opcjonalna optymalizacja obrazów (`npm run optimize:images`, wymaga `sharp`).

## Bilingual rule (KRYTYCZNE)
Każda zmiana treściowa musi trafić do **obu wersji** — PL (`index.html`, `uslugi/*/`, `case-studies/`, `wystapienia/`) i EN (`en/...` z tą samą strukturą katalogów). Slug katalogów pozostaje polski również w EN (np. `en/uslugi/wdrozenie-sap-ariba/`).

## Konwencje CSS/UI
- Zmienne kolorów w `:root` w `assets/css/style.css` — `--bg`, `--bg2`, `--border`, `--gold`, `--muted`, `--text-secondary`.
- Fonty: Playfair Display (nagłówki), DM Sans (body), DM Mono (mono/etykiety).
- Sekcje HTML oznaczone komentarzami `<!-- SEKCJA -->`.
- Grid skills: 3 kolumny, ostatnia karta rozciąga się na pełną szerokość jeśli jest samotna.

## Sekcje strony głównej (kolejność — utrzymać)
1. Hero (liczby: 25+ lat, 20+ wdrożeń, 500M EUR, 50 mld PLN)
2. Trust Bar — "Pracowałem dla:" / "Worked for:"
3. Process — 4 kroki: Diagnoza → Strategia → Wdrożenie → Wartość
4. Case Studies — ORLEN, Żabka, KGHM (z metrykami)
5. About → 6. Education → 7. Resume
8. Skills — "W czym mogę Ci pomóc" / "How I can help you" (z outcome lines — złoty tekst z rezultatem)
9. Portfolio → 10. Clients → 11. Contact (availability signal)

Mid-page CTA po Process i po Cases. CTA ghost button prowadzi do "Rezultaty" (case studies), nie do CV. Hero benefit-oriented (nie self-focused).

## Fakty i ton (KRYTYCZNE)
- **Polpharma NIE jest klientem** — nie dodawać do trust bara (była w systemie prompcie workera; jeśli edytujesz `worker/index.js` zostaw na liście „inni" jeśli nie jesteś pewny, ale na stronie głównej — nigdy).
- Stat: **"25+ lat doświadczenia"** (nie 20+).
- Ton: premium, profesjonalny, wiarygodny — **nigdy prostacki ani nachalny**.
- Worker chat: model `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, system prompt zawiera kompletne CV — przy zmianach faktów na stronie zsynchronizuj `worker/index.js`.

## SEO / metadata
- Każda strona ma `<link rel="canonical">`, `hreflang` (pl / en / x-default), Open Graph i Schema.org (`Person` na home, `Service`/`Article` na podstronach gdzie ma sens).
- `sitemap.xml` i `llms.txt` / `llms-full.txt` aktualizować ręcznie przy dodawaniu nowych stron.
