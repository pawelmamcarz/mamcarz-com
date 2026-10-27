# Audyt mamcarz.com, 27.10.2026

Zakres: serwis produkcyjny https://mamcarz.com (PL i EN), repozytorium `main` (stan z gałęzi `cursor/zdjecie-i-audyt-mamcarz-4f2a`), Worker czatu `mamcarz-chat-api`, powiązane serwisy portfolio. Perspektywy: klient C-level, rekruter, wyszukiwarka i modele językowe.

Metoda: przegląd treści w HTML i w `content/site-facts.json`, pomiary w Chrome (Playwright) dla szerokości 320, 375, 768, 1024 i 1440 px (overflow, CLS, kontrast liczony z wyrenderowanych kolorów, rozmiary fontów, obrazy bez wymiarów, lazy loading), nagłówki HTTP produkcji, `sitemap.xml`, `robots.txt`, `llms.txt`, `llms-full.txt`, kod Workera i polityka prywatności. Nie dodawano nowych faktów.

## 5 najważniejszych wniosków

1. **Produkcja nie odpowiada żadnej gałęzi repozytorium (krytyczne).** Live ma przebudowaną stronę główną, nowe strony `/o-mnie/` i `/en/o-mnie/` (w sitemapie i w `llms.txt`), inne portrety, inny tytuł i inny CSS (87,6 KB wobec 76,5 KB w repo) przy tym samym tokenie `?v=20260921-flightplan-4`. Deploy z `main` usunie `/o-mnie/` (adresy z sitemapy zwrócą 404) i cofnie redesign. Zanim cokolwiek z tego PR trafi na produkcję, źródło wersji live musi wrócić do repozytorium.
2. **Model komercyjny jest niejasny.** Od 09.2026 Paweł jest Dyrektorem Sprzedaży w All for One (etat), a serwis sprzedaje niezależne doradztwo („Opisz wyzwanie”, Cal.com, trzy tematy mailowe). Klient C-level nie wie, czy kupuje u All for One, czy od osoby prywatnej; rekruter widzi na LinkedIn nadal „apsolut Group”. Potrzebna jest jedna decyzja właściciela i jedno zdanie w hero.
3. **Strona główna w `main` jest za długa i rozmywa przekaz.** 11 sekcji, około 15 400 px przy 1440 px szerokości (live: około 4 900 px), dwa takie same portrety, zdublowane umiejętności, siedem dróg kontaktu. Test 5 sekund nie przechodzi: hasło hero nie mówi, kim jest autor i co oferuje.
4. **CLS na mobile jest wysoki (0,36–0,50) na live i w repo.** Przyczyną jest nawigacja „bez JS”, widoczna do czasu, aż odroczony `main.js` doda klasę `.js`. Naprawa jest prosta technicznie, ale zmienia zachowanie bez JS na wszystkich stronach, więc wymaga decyzji.
5. **Polityka prywatności nie opisuje aktualnego działania czatu.** Od 21.09.2026 prawie każde pytanie trafia do modelu Jev w Workers AI, a polityka (aktualizacja z 4.09.2026) mówi, że do modelu trafiają tylko pytania spoza mapy serwisu. Brakuje też Cal.com jako odbiorcy danych, podstawy prawnej i prawa skargi do PUODO. Brak HSTS w nagłówkach.

## Ocena ogólna

**6/10.** Inżynieria repozytorium jest bardzo dobra: rejestr faktów, kontrakty `verify-site`, brak poziomego overflow w całym zakresie 320–1440 px, jeden `h1` na stronę, poprawne `hreflang`, canonical, 404 ze statusem 404, nagłówki bezpieczeństwa (poza HSTS), Worker z limitami i ograniczonym CORS, zero em dashy w publicznym HTML. Ocenę obniżają rozjazd produkcji z repo, niejasna oferta przy nowym etacie, długość strony głównej, CLS na mobile i nieaktualna polityka prywatności.

## Co naprawiono w tym PR

| Zmiana | Commit |
| --- | --- |
| Portret z uniesionym kciukiem w `#contact` (PL i EN), WebP i PNG w szerokościach 480 i 960, kontrakt `home-contact-portrait` | zdjęcie |
| apsolut w czasie przeszłym w rejestrze i na stronach głównych (okres zamknięty w 08.2026) | poprawki z audytu |
| Intro produktów w „Aplikacjach operacyjnych” bez języka rejestru; EN „03 / Evidence” zamienione na „03 / Products” jak w PL; „separate brand” zamiast „third brand” | poprawki z audytu |
| Jawne `width` i `height` dla siedmiu obrazów kart portfolio na stronach głównych | poprawki z audytu |
| Komunikat czatu bez JS w pierwszej osobie i bez odwołania do układu („obok”), które na mobile było nieprawdziwe | poprawki z audytu |
| AGENTS.md i CLAUDE.md bez em dashy i z jawną regułą właściciela (pliki byte-identyczne) | poprawki z audytu |
| Kontrast AA: etykieta „04 / Metoda” na ciemnym panelu usług (1,81:1, teraz powyżej 4,5:1), etykieta i akapit w czerwonym bloku kontaktu usług (3,93:1 i 4,35:1, teraz powyżej 4,5:1), znak wywoławczy w hero lotnictwa (3,26:1, teraz `--signal-dark`, powyżej 4,5:1) | kontrast |
| `scripts/optimize-images.js` z CLI i trybem `--alpha` (WebP i PNG z przezroczystością) | zdjęcie |

Token `?v=` nie został zmieniony: zgodnie z AGENTS.md PR funkcjonalny nie rusza `version.js` ani `CHANGELOG.md`, a podbicie należy do PR wydania.

## Znaleziska

Legenda statusu: **naprawione w PR** albo **do decyzji**.

### Krytyczne

**K1. Rozjazd produkcji z repozytorium.**
Dowód: https://mamcarz.com/ (tytuł „Paweł Mamcarz · Zakupy, aplikacje operacyjne i lotnictwo”, sekcje hero/work/about/contact, nagłówek „Porozmawiajmy o konkretnym wyzwaniu”, `og:image` `/assets/img/portrait-og.jpg`, portrety `home-portrait` i `about-portrait` z podpisem „Robakowski studio”, `data-fact-id="portrait.credit"`, którego nie ma w `content/site-facts.json` w `main`), https://mamcarz.com/o-mnie/ i https://mamcarz.com/en/o-mnie/ (w live `sitemap.xml` i `llms.txt`, brak w repo), link „O mnie” w nawigacji i stopce na wszystkich stronach live, `style.css` 87,6 KB na live wobec 76,5 KB w repo przy tym samym `?v=`. Skrypt `deploy:pages` używa `--commit-dirty=true`, więc produkcja mogła powstać z niezacommitowanego drzewa.
Skutek: deploy z `main` cofnie redesign, usunie dwie strony z sitemapy (404) i zostawi przeglądarki z nowym HTML i starym CSS w cache pod tym samym tokenem. Nagłówek z briefu („Przejdźmy do konkretnej decyzji”) istnieje tylko na starych gałęziach; w `main` jest „Porozmawiajmy o współpracy”.
Rekomendacja: odtworzyć źródło wersji live w repozytorium (osobny PR), potem przenieść portret z tego PR do nowej sekcji kontaktu, a dopiero potem wydawać. Rozważyć usunięcie `--commit-dirty=true`.
Status: **do decyzji**.

**K2. Niejasny model komercyjny przy etacie w All for One.**
Dowód: `content/site-facts.json` (All for One, Dyrektor Sprzedaży od 09.2026), strona główna `#contact` („Opisz wyzwanie”, Cal.com, tematy mailowe), schema na akrobacja.com z `seller` „Doradztwo Paweł Mamcarz”, czego nie ma na mamcarz.com.
Skutek: klient nie wie, z kim zawiera umowę; rekruter i pracodawca mogą odczytać serwis jako równoległą działalność konkurencyjną.
Rekomendacja: właściciel decyduje, czy serwis jest wizytówką osoby (kontakt zawodowy, prelekcje, projekty własne), czy kanałem sprzedaży doradztwa; jedno zdanie w hero i w kontakcie to wyjaśnia. Bez tej decyzji nie zmieniano tekstów oferty.
Status: **do decyzji**.

### Ważne

**W1. Test 5 sekund: hero nie mówi, kim jest autor i co oferuje.**
Dowód: `index.html`, `en/index.html` (hero), bieżąca rola widoczna dopiero w osi czasu.
Rekomendacja: w hero imię, aktualna rola i trzy filary w jednym zdaniu; CTA zgodne z decyzją z K2.
Status: **do decyzji** (zależne od K2).

**W2. Strona główna w `main` jest za długa i powtarza treści.**
Dowód: `index.html`: 11 sekcji, około 15 400 px przy 1440 px; zdjęcie w sekcji „O mnie” to ten sam IMG_3284 co w hero (alt tylko „Paweł Mamcarz”); „Doradztwo zakupowe” i „Transformacja zakupów” w umiejętnościach prowadzą pod ten sam adres; nagłówki środkowych CTA powtarzają tekst przycisku; intro portfolio „mamcarz.com odpowiada za wdrożenie” jest niejasne; Resort Komedii nie należy do żadnego z trzech filarów.
Rekomendacja: skrócić do hero, trzech filarów, wybranych dowodów, kariery skrótowo i kontaktu; drugi portret zastąpić innym zdjęciem lub usunąć. Live już idzie w tę stronę (K1).
Status: **do decyzji**.

**W3. Siedem dróg kontaktu (przeciążenie wyboru).**
Dowód: `#contact` w `index.html`: Cal.com, trzy linki mailowe z tematem (wyglądają jak nawigacja), adres e-mail, LinkedIn, czat.
Rekomendacja: jedna główna akcja (rozmowa w Cal.com albo e-mail), jedna drugorzędna (czat); tematy mailowe połączyć w jeden link.
Status: **do decyzji**.

**W4. Case studies bez wyników.**
Dowód: `/case-studies/`, `/en/case-studies/`: pole „Dowód” powtarza zakres, PLL LOT i Motor Oil mają po jednym zdaniu.
Rekomendacja: dodać wyniki tylko po zatwierdzeniu przez właściciela (liczby, skala, czas); do tego czasu nie wolno ich dopisywać.
Status: **do decyzji** (nowe fakty wymagają zatwierdzenia).

**W5. CLS 0,36–0,50 na mobile.**
Dowód: pomiar na live i lokalnie (np. `/en/` przy 320 px: 0,44). Reguły `html:not(.js)` pokazują nawigację bez JS do czasu wykonania odroczonego `assets/js/main.js`.
Rekomendacja: mały skrypt inline w `<head>` ustawiający klasę `.js` albo `@media (scripting: enabled)`. Zmiana dotyczy 25 dokumentów i zachowania bez JS, więc wymaga decyzji i przeglądu kontraktów nawigacji.
Status: **do decyzji**.

**W6. Polityka prywatności nieaktualna wobec czatu i Cal.com.**
Dowód: `/polityka-prywatnosci/` (ostatnia aktualizacja 4.09.2026) mówi, że pytania nawigacyjne obsługuje mapa serwisu, a „pozostałe mogą trafić” do Workers AI; `worker/index.js` wywołuje model Jev (Workers AI) dla prawie każdej wiadomości niebędącej wysokiego ryzyka, zanim sprawdzi odpowiedź nawigacyjną (od 21.09.2026). Brak Cal.com jako odbiorcy danych, brak podstawy prawnej i informacji o prawie skargi do PUODO.
Rekomendacja: zaktualizować opis przepływu czatu, dopisać Cal.com, podstawę prawną (art. 6 ust. 1 lit. f RODO dla czatu i kontaktu) i prawo skargi do Prezesa UODO. Tekst prawny zatwierdza właściciel.
Status: **do decyzji**.

**W7. Brak HSTS.**
Dowód: nagłówki odpowiedzi https://mamcarz.com/ (są `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy`; brak `Strict-Transport-Security`).
Rekomendacja: `Strict-Transport-Security: max-age=31536000; includeSubDomains` w `_headers`, po potwierdzeniu, że wszystkie subdomeny działają po HTTPS; `preload` dopiero po decyzji.
Status: **do decyzji**.

**W8. Brak CSP.**
Dowód: nagłówki produkcji, `_headers`.
Rekomendacja: zgodnie z zasadą nie dodawano spekulatywnej polityki. Najpierw audyt zasobów (skrypty własne, Worker czatu, Cal.com jako link, fonty lokalne), potem `Content-Security-Policy-Report-Only`, dopiero potem tryb wymuszający.
Status: **do decyzji**.

**W9. LinkedIn niespójny z serwisem.**
Dowód: tytuł profilu LinkedIn „Pawel Mamcarz - apsolut Group”, serwis: All for One od 09.2026.
Rekomendacja: aktualizacja profilu przez właściciela.
Status: **do decyzji** (poza repozytorium).

**W10. Strona `/o-mnie/` na live bez zatwierdzonego opisu kontynuacji po przejęciu.**
Dowód: https://mamcarz.com/o-mnie/ pokazuje dwie pozycje kariery i All for One bez opisu odpowiedzialności z rejestru faktów.
Rekomendacja: uwzględnić przy odtwarzaniu źródła live (K1).
Status: **do decyzji**.

**W11. Kontrast etykiet na ciemnych sekcjach usług i w hero lotnictwa.**
Dowód: `/uslugi/transformacja-zakupow/`, `/en/uslugi/wdrozenie-sap-ariba/` i pozostałe strony usług: „04 / Metoda” 1,81:1, „06 / Kontakt” 3,93:1, akapit kontaktu 4,35:1; `/lotnictwo/`: znak wywoławczy 3,26:1.
Rekomendacja i wykonanie: kolory oparte na bieli jak w `#contact` strony głównej oraz `--signal-dark` dla znaku wywoławczego. Po zmianie zero naruszeń AA na tych stronach przy 375 i 1440 px.
Status: **naprawione w PR**.

**W12. Czas teraźniejszy w opisie zamkniętego okresu apsolut.**
Dowód: `content/site-facts.json` (`career.apsolut.responsibility`), `index.html`, `en/index.html`.
Status: **naprawione w PR** (czas przeszły, bez nowych faktów).

### Drobne

**D1. Kontrast drobnych etykiet mono (`--muted`) 4,12:1.**
Dowód: `/lotnictwo/` (`.aviation-log dt`, `.aviation-sector__index strong`), `/case-studies/` (`.project-row__facts dt`), tekst 10,9 px. Token `--muted: #52707A` jest przypięty kontraktem design systemu (`flight-token`).
Rekomendacja: przyciemnić token do około `#46636D` (5,9:1 na `--white`); zmiana tokenu to decyzja projektowa.
Status: **do decyzji**.

**D2. Bardzo małe fonty.** Linki w stopce 10,56 px, nawigacja 0,62rem poniżej 1180 px, etykiety mono 10,6–11,5 px.
Rekomendacja: minimum 12 px dla tekstu interaktywnego. Status: **do decyzji**.

**D3. Wszystkie strony mają ten sam `og:image`.**
Dowód: `og:image` `/assets/img/og.jpg` na wszystkich stronach w repo.
Rekomendacja: osobne obrazy OG dla trzech filarów. Status: **do decyzji**.

**D4. `llms.txt` wymienia role bez dat.** Dyrektor Sprzedaży i Associate Partner wyglądają na równoległe i bieżące.
Rekomendacja: dodać zakresy dat z rejestru faktów. Status: **do decyzji** (plik jest pod kontraktem discovery).

**D5. `lastmod` w sitemapie.** 21 adresów z 2026-09-04, 2 z 2026-09-07, 2 z 2026-09-28.
Rekomendacja: aktualizować `lastmod` stron głównych w PR wydania, nie w PR funkcjonalnym. Status: **do decyzji**.

**D6. Słowa kluczowe spoza zatwierdzonych faktów.** `meta keywords` zawiera m.in. „field service management” i „aviation software”.
Rekomendacja: usunąć `meta keywords` (Google ich nie używa) albo ograniczyć do filarów. Status: **do decyzji**.

**D7. Strona Wiedza jest cienka.** Około 72 słów, etykieta „Status: Zasób w serwisie” brzmi jak rejestr.
Rekomendacja: połączyć z case studies albo rozbudować po decyzji o treściach. Status: **do decyzji**.

**D8. Lotnictwo: język rejestru i kody po angielsku.** Na stronie PL „Stan na 2026-08-26”, kody OPS/SAFE/MEDIA/DATA/LOG/COMMS, dekoracyjny schemat WEJŚCIE/PRZEPŁYW/WYJŚCIE.
Rekomendacja: usunąć datę rejestru z widoku, przetłumaczyć lub usunąć kody. Status: **do decyzji** (treści pod kontraktem stron).

**D9. Niespójności PL/EN.** PL „Współpraca” wobec EN „Route to delivery” w etykiecie procesu; EN „Press photographer…” z inną wielkością liter niż sąsiednie pozycje.
Status: **do decyzji** (teksty pod kontraktem; łatwe po akceptacji brzmienia).

**D10. Opublikowane zbędne pliki.**
Dowód: `.public/assets/fonts/` zawiera pliki Playfair (AGENTS.md zabrania Playfair, żadna strona ich nie ładuje); `assets/img/speaking/procurement-beyond-episode-8.png` (1,7 MB, źródło bez odwołań, chronione digestem jako dostarczony zasób).
Rekomendacja: wykluczyć oba z `scripts/package-site.mjs`; zmienia granicę publikacji, więc wymaga świadomej aktualizacji kontraktu wydania. Status: **do decyzji**.

**D11. Ciężkie obrazy w małych rozmiarach.**
Dowód: `assets/img/signature.png` 2132×662 px (54 KB) wyświetlany w 160×50 px; gotowa poprawka na niescalonej gałęzi `claude/fervent-lovelace-ewed69` (commit `3c216ba`, 320×99 px, 4,3 KB). `assets/img/logo.png` 3267×1275 px (82 KB) jako favicon `sizes="any"`. `IMG_3284-1920.jpg` 620 KB.
Rekomendacja: przenieść poprawkę podpisu, kwadratowe ikony 32/180/512 px, mocniejsza kompresja wariantu 1920. Status: **do decyzji**.

**D12. Fonty około 114 KB na stronę** (6 plików woff2, 2 preloadowane). Akceptowalne; ewentualnie subset latin-ext. Status: **do decyzji**.

**D13. Worker: brak egzekwowania Origin po stronie serwera.**
Dowód: `worker/index.js`: CORS ogranicza przeglądarki do domen produkcyjnych, ale żądanie bez nagłówka Origin jest obsługiwane; limiter per klient opiera się na UUID z żądania (można go rotować), limit IP 30/min pozostaje.
Rekomendacja: 403 dla żądań bez dozwolonego Origin. Zmiana zachowania produkcyjnego API i osobna bramka deployu Workera. Status: **do decyzji**.

**D14. `access-control-allow-origin: *` na stronach statycznych.** Domyślne zachowanie Cloudflare Pages, bez danych prywatnych; niskie ryzyko. Status: **do decyzji**.

**D15. Portfolio: brak linków zwrotnych i niespójne nazwy.**
Dowód: tylko akrobacja.com linkuje do mamcarz.com; czympojade.pl ma jedynie `founder.url` w schema; procuracost, silence-tax.com, fnp.silence-tax.com, przypominamy.com i filmolot.pl bez linku. czympojade.pl ma tytuł „Kalkulator TCO samochodu”, a mamcarz.com opisuje go jako „Kalkulator TCO floty”. filmolot.pl używa 21 em dashy (np. tytuł „Filmolot — Fotografia…”).
Rekomendacja: link „Autor: Paweł Mamcarz” w stopkach serwisów, ujednolicenie opisu czympojade, usunięcie em dashy na filmolot.pl (inne repozytoria). Status: **do decyzji**.

**D16. Obrazy kart portfolio bez wymiarów.** Status: **naprawione w PR**.

**D17. Intro produktów w „Aplikacjach operacyjnych” językiem rejestru; EN „03 / Evidence” zamiast „03 / Products”.** Status: **naprawione w PR**.

**D18. Komunikat czatu bez JS odwoływał się do linków „obok”, które na mobile są nad czatem.** Status: **naprawione w PR**.

**D19. Em dash w dokumentacji agentów.** AGENTS.md i CLAUDE.md miały 15 em dashy. Status: **naprawione w PR**; publiczny HTML (repo i live) ma zero em dashy. Pozostałe wystąpienia znaku w `scripts/verify-site.mjs` i w dokumentach są wzorcami wykrywania i zostały celowo.

## Co działa dobrze

- Brak poziomego overflow na wszystkich sprawdzonych stronach przy 320–1440 px (live i repo).
- Jeden `h1` na stronę, logiczna hierarchia nagłówków, widoczny focus.
- Canonical, `hreflang` PL/EN/x-default, `robots.txt` z regułami dla modeli językowych, 404 ze statusem 404.
- Przekierowanie www na domenę główną 301 z zachowaniem ścieżki i parametrów.
- Pliki niepubliczne (`AGENTS.md`, `package.json`, `worker/`, `content/site-facts.json`, `.git`) zwracają 404.
- Worker: CORS ograniczony do domen produkcyjnych, limit IP, logi tylko z klasą błędu.
- Obrazy w `_headers` z cache `immutable` na rok; CSS i JS z rewalidacją.

## Kolejność działań (propozycja)

1. Odtworzyć źródło live w repo (K1) i dopiero potem planować wydanie.
2. Decyzja o modelu komercyjnym i hero (K2, W1), potem skrócenie strony głównej i kontaktu (W2, W3).
3. Polityka prywatności i HSTS (W6, W7), CLS (W5).
4. Drobne poprawki z listy D w jednym PR porządkowym.
