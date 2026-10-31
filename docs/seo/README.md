# SEO i llms: narzędzia i cotygodniowa lista kontrolna

Ten katalog zbiera raporty SEO i llms dla mamcarz.com. Źródłem prawdy o trasach jest `PUBLIC_PAGES` w `scripts/verify-site.mjs`, a o faktach `content/site-facts.json`. Raporty niczego nie zmieniają w serwisie.

## Raport automatyczny

```sh
npm run seo:report                                     # raport Markdown na stdout, bez sieci
npm run seo:report -- --check                          # tylko błędy i ostrzeżenia; kod wyjścia 1 przy błędzie
npm run seo:report -- --write                          # zapis do docs/seo/ARCHIWUM/RRRR-MM-DD-seo-report.md
npm run seo:report -- --write --date=2026-10-31        # zapis z jawną datą
npm run seo:report -- --check --online                 # dodatkowo GET na produkcję (status 200 dla tras, robots, sitemap, llms)
```

Tryb domyślny działa offline. Sieć jest używana wyłącznie z flagą `--online`.

Raport sprawdza dla każdego dokumentu z `PUBLIC_PAGES`:

- dokładnie jeden niepusty `<title>` i opis, unikalne w całym serwisie, z ostrzeżeniem poza zakresem 30–65 (tytuł) i 70–165 (opis) znaków;
- canonical równy adresowi trasy oraz komplet `hreflang` zgodny z parą językową i `x-default`;
- `og:title`, `og:description` i `og:url` równe odpowiednio tytułowi, opisowi i canonicalowi, jeden `og:image`;
- poprawnie parsujący się JSON-LD z typami z manifestu i opisem zgodnym z meta description;
- jeden `h1`, atrybut `alt` na każdym `img`, brak znaku em dash;
- linki kontekstowe w `<main>` do innych tras (ostrzeżenie, gdy trasa nie ma żadnego linku przychodzącego z treści).

Poza stronami raport sprawdza zgodność `sitemap.xml` z `PUBLIC_PAGES` (lokalizacje, `lastmod`, alternatywy), pokrycie tras i opisy w `llms.txt`, brak tras spoza manifestu w `llms.txt` i `llms-full.txt` oraz odwołania w `robots.txt`.

Kontrola offline jest wpięta w `npm run test:quality`. Komendy `verify:*` i ich kontrakty pozostają bez zmian; dokładne kontrakty treści, faktów i digestów nadal egzekwuje `scripts/verify-site.mjs`.

## Cotygodniowa lista kontrolna

1. `npm run seo:report -- --check` i `npm run verify:seo`. Błąd naprawiamy przed jakąkolwiek inną zmianą.
2. `npm run seo:report -- --check --online`: wszystkie trasy, `robots.txt`, `sitemap.xml`, `llms.txt` i `llms-full.txt` odpowiadają `200` na produkcji.
3. Google Search Console i Bing Webmaster Tools: stan indeksowania 27 adresów z sitemapy, nowe wykluczenia, błędy `hreflang`, zapytania z wyświetleniami bez kliknięć. Wnioski zapisujemy w raporcie tygodnia, bez danych osobowych.
4. Ręcznie: przekierowanie `www` na apex zwraca `301` z zachowaniem ścieżki i query (konfiguracja Cloudflare poza repozytorium).
5. Asystenci AI: zadajemy dwa lub trzy pytania kontrolne (np. „Kim jest Paweł Mamcarz?”, „Kto wdraża SAP Ariba w Polsce?”) i notujemy, czy odpowiedź cytuje mamcarz.com oraz czy fakty są zgodne z `llms-full.txt`. Rozbieżności nie poprawiamy dopisywaniem faktów; nowy fakt wymaga decyzji w rejestrze.
6. Po każdej zmianie treści: `lastmod` w `sitemap.xml` tylko dla stron, które faktycznie się zmieniły, i aktualne opisy tras w `llms.txt`.
7. Raz w miesiącu: `npm run seo:report -- --write` i commit raportu do `docs/seo/ARCHIWUM/` w osobnym PR.

## Pliki

- `ARCHIWUM/`: raporty generowane przez `seo:report -- --write`.
- `2026-10-31-raport-seo-llms.md`: przegląd SEO i llms z 2026-10-31, z wnioskami, listą tematów i decyzjami do podjęcia.
