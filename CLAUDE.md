# Zasady pracy w repozytorium

`AGENTS.md` i `CLAUDE.md` są kopiami verbatim. Każdą zmianę trzeba wprowadzić do obu plików i potwierdzić `cmp -s AGENTS.md CLAUDE.md`.

## Projekt

mamcarz.com to osobista strona profesjonalna Pawła Mamcarza. Trzy równorzędne obszary działalności to:

1. doradztwo i transformacja zakupów,
2. aplikacje operacyjne,
3. lotnictwo.

Serwis jest statycznym HTML-em bez frameworka i bez kroku build. Wersja polska jest w root, a angielska pod `en/`. Jedynym opcjonalnym krokiem offline jest optymalizacja obrazów przez `npm run optimize:images` (wymaga `sharp`).

## Hosting i wydanie

- Hosting: Cloudflare Pages, projekt `mamcarz-com` (nie Vercel).
- Podgląd: `wrangler pages dev .` albo dowolny statyczny serwer.
- Wydanie strony: `wrangler pages deploy . --project-name mamcarz-com --branch main --commit-dirty=true`.
- Lokalny `./deploy.sh` najpierw wykonuje push, potem deploy; jest w `.gitignore` i może nie istnieć w świeżym klonie.
- Worker czatu w `worker/` jest osobnym wdrożeniem: `cd worker && wrangler deploy`.
- Push, merge, deploy Pages i deploy Workera są osobnymi bramkami. Nie wykonuj żadnej z nich bez odpowiedniego zatwierdzenia.
- `_headers` definiuje nagłówki bezpieczeństwa i cache. `_redirects` jest zarezerwowany dla reguł ścieżkowych Pages i obecnie nie zawiera aktywnych reguł. Redirect `www` na apex jest konfiguracją Cloudflare Bulk Redirect poza repozytorium; przed wydaniem trzeba osobno odczytać jego stan i potwierdzić `301` z zachowaniem ścieżki oraz query. Nie dodawaj spekulatywnego CSP bez audytu wszystkich zasobów.

## Struktura i manifest tras

- `index.html`, `en/index.html` — strony główne.
- `uslugi/*/index.html`, `en/uslugi/*/index.html` — trzy usługi doradcze.
- `aplikacje-operacyjne/`, `en/aplikacje-operacyjne/` — aplikacje operacyjne.
- `lotnictwo/`, `en/lotnictwo/` — działalność lotnicza.
- `case-studies/`, `wiedza/`, `wystapienia/` oraz ich odpowiedniki `en/` — projekty, wiedza i wystąpienia.
- `procurement-2026/`, `diagrams/`, `infographic_procurement_2026_EN.html` — samodzielne materiały pomocnicze; nie podlegają automatycznie regule par PL/EN.
- `assets/css/style.css` — wspólny arkusz; `assets/js/main.js` — nawigacja, chat i drobne interakcje; `assets/img/` i `assets/fonts/` — zasoby.
- `content/site-facts.json` — rejestr zatwierdzonych faktów i powierzchni publikacji.
- `scripts/verify-site.mjs` — manifest `PUBLIC_PAGES` i kontrakty weryfikacyjne dla 24 publicznych dokumentów.
- `sitemap.xml`, `llms.txt`, `llms-full.txt`, `robots.txt`, `404.html` — powierzchnie discovery i błędów.

`PUBLIC_PAGES` w `scripts/verify-site.mjs` jest normatywnym manifestem tras. Przy dodaniu lub usunięciu strony aktualizuj razem manifest, sitemapę, odpowiednią parę językową i kontrolowane indeksy llms.

## Reguła dwujęzyczna

Każda zmiana treściowa w parowanych stronach musi trafić do PL i EN w tej samej strukturze. Slugi pozostają polskie także pod `en/`, np. `en/uslugi/wdrozenie-sap-ariba/`. Zachowuj równoważność znaczenia, kolejności sekcji, nawigacji, CTA, faktów i metadanych; tłumaczenie nie musi być dosłowne.

## System wizualny i UI

- Kierunek: „Flight Plan” — redakcyjny, precyzyjny i profesjonalny; lotnictwo jest jednym z trzech równych obszarów, nie dekoracyjną opowieścią dla całego serwisu.
- Fonty: Barlow Semi Condensed dla nagłówków, DM Sans dla tekstu, DM Mono dla etykiet i danych.
- Główne tokeny w `:root`: `--runway-ink`, `--signal`, `--signal-dark`, `--sky-band`, `--ink-secondary`, `--line`, `--line-strong`.
- Wspólna wersja zasobów w publicznych dokumentach: `20260825-flightplan-3`.
- Nie przywracaj Playfair Display, generycznych kart, przypadkowych gradientów, dekoracyjnych wykresów ani narracji udającej fakty.
- Zachowuj semantyczny HTML, jeden `main`, jeden `h1`, widoczny focus, działanie bez JavaScriptu i obsługę `prefers-reduced-motion`.
- `404.html` jest jednym dokumentem PL/EN: PL działa domyślnie bez JS, ma `noindex`, nie ma canonicala, a wczesny skrypt może zmienić wyłącznie `lang`, `title` i istniejący opis.

## Fakty i ton

- Publikuj wyłącznie fakty oznaczone `status: approved` w `content/site-facts.json`, na wskazanych tam powierzchniach i dokładnie w zatwierdzonej formie. Wpisy `review` i `retired` nie są zgodą na publikację.
- Nie dopisuj ról, wyników, liczb, klientów, statusów bieżących ani opisów przedsięwzięć na podstawie domysłu. Nowy fakt wymaga źródła lub potwierdzenia właściciela, decyzji w rejestrze i testu.
- Polpharma nie jest klientem i nie może pojawić się jako klient ani w trust barze.
- Zatwierdzona statystyka to 25+ lat doświadczenia w zakupach.
- Dawna nazwa WarsawFlightSafety jest wycofana. Według potwierdzenia właściciela z 2026-08-26 aktualną marką przedsięwzięcia lotniczego jest `akrobacja.com`; nie przedstawiaj ich jako dwóch bieżących przedsięwzięć.
- Ton jest premium, rzeczowy i spokojny. Unikaj superlatywów bez dowodu, obietnic SLA, nachalnego języka, myślników używanych mechanicznie i stylistycznych „AI tells”.
- Przy zmianie faktów audytuj wszystkie powierzchnie z rejestru, w tym `worker/index.js`, `assets/js/main.js`, `llms.txt` i `llms-full.txt`. Worker nie jest „pełnym CV”; jego prompt ma używać tylko zatwierdzonego, potrzebnego zakresu.
- Worker używa modelu `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Frontend wywołuje `https://mamcarz-chat-api.pawel-767.workers.dev`; zmianę nazwy lub URL trzeba zsynchronizować i przetestować po obu stronach.

## SEO i metadata

- Każdy dokument z `PUBLIC_PAGES` ma dokładnie jeden canonical, komplet właściwych `hreflang`, Open Graph i minimalny Schema.org zgodny z manifestem. Nie wzbogacaj schema o niepotwierdzone stanowiska, firmy, wyniki lub profile.
- `404.html` jest celowym wyjątkiem: `noindex`, bez canonicala i bez wpisu w sitemapie.
- `sitemap.xml` musi odpowiadać dokładnie `PUBLIC_PAGES`; daty `lastmod` mają odzwierciedlać rzeczywistą zmianę treści, nie sam deploy.
- `llms.txt` jest kontrolowanym indeksem nawigacyjnym, a `llms-full.txt` indeksem faktów generowanym z zatwierdzonych wpisów. Nie dopisuj swobodnej biografii.

## Weryfikacja

Uruchamiaj testy proporcjonalnie do zmiany, a przed uznaniem całości za gotową:

```sh
npm run verify:home
npm run verify:pages -- --family=all
npm run verify:metadata
npm run verify:discovery
npm run verify:seo
npm run verify:foundation
npm run verify:facts
npm run verify:site
npm run test:verify-site
npm run test:worker
node --check assets/js/main.js
node --check worker/index.js
cmp -s AGENTS.md CLAUDE.md
```

Nie zmieniaj digestów chronionych artefaktów ani kontraktów tylko po to, by test przeszedł. Najpierw ustal przyczynę, potem aktualizuj implementację, testy i baseline wyłącznie po świadomym przeglądzie.
