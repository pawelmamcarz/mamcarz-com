# Flight Plan: runbook wydania

Status dokumentu: przygotowany lokalnie 2026-08-27. Ten dokument nie zatwierdza pushu, merge, wdrożenia Pages, wdrożenia Workera ani zmiany konfiguracji konta Cloudflare.

## 1. Zweryfikowany stan lokalny

Snapshot wykonany po zamknięciu implementacji i przed dodaniem tego runbooka:

- branch: `codex/flight-plan-redesign`
- commit implementacji: `507e01b0be2e1bc4b7951ddda3f438c7c4f5d474`
- lokalny ref `origin/main`: `72d817a2e36d65a474a50db9d1c82b8c9d665516`
- relacja do lokalnego `origin/main`: 0 commitów w tyle, 89 commitów w przód
- dirty paths: brak
- upstream brancha: brak
- push wykonany w tym strumieniu: nie
- merge: nie
- Cloudflare Pages deploy: nie
- Worker deploy: nie
- wywołanie live Workers AI: nie

Lokalny ref `origin/main` nie jest dowodem aktualnego stanu GitHub bez świeżego `git fetch`. Przed publikacją trzeba odczytać remote ponownie.

### Bramki automatyczne

| Polecenie | Wynik lokalny |
| --- | --- |
| `npm run verify:site` | PASS, exit 0 |
| `npm run test:verify-site` | PASS, 960/960, exit 0 |
| `npm run test:worker` | PASS, 37/37, exit 0 |
| `node --check assets/js/main.js` | PASS, exit 0 |
| `node --check worker/index.js` | PASS, exit 0 |
| `node --check scripts/verify-site.mjs` | PASS, exit 0 |
| `cmp -s AGENTS.md CLAUDE.md` | PASS, exit 0 |
| `git diff --check` | PASS, exit 0 |
| `WRANGLER_LOG_PATH=/tmp/mamcarz-wrangler.log wrangler deploy --dry-run --config worker/wrangler.toml` | PASS, exit 0 |

Suchy pakiet Workera został wykonany przez Wrangler `4.125.0`: 73.46 KiB przed kompresją, 12.25 KiB gzip. Wykryte bindingi: Workers AI oraz `CHAT_RATE_LIMITER`, 10 żądań na 60 sekund. `--dry-run` nie wdrożył Workera.

### Przegląd w lokalnym Chrome

- 26 tras x 5 szerokości: 320, 390, 768, 1280 i 1440 px, razem 130/130 bez wykrytych błędów.
- Sprawdzone: status dokumentu, dokładnie jeden H1, brak poziomego overflow, kompletne obrazy, bezpieczne linki `target="_blank"`, błędy konsoli i wyjątki wykonania.
- Wybrane widoki PL/EN zostały sprawdzone wizualnie, w tym home, Lotnictwo, Aplikacje, Wiedza, Wystąpienia i 404.
- Osobny przebieg bez `assets/js/main.js`: home PL i EN przy 320 i 1440 px, 4/4 PASS; podstawowa nawigacja pozostała dostępna.
- Bezpośredni przebieg klawiatury: Tab, Shift+Tab, Enter, Space i Escape PASS. Escape zamyka menu i zwraca fokus do przycisku.
- Zamknięty overlay nie jest fokusowalny, cele mają minimum 44 px, fokus ma widoczny obrys, a `prefers-reduced-motion` skraca nieistotne przejścia.
- Kontrola reflow użyła 390 CSS px, czyli węższego układu niż 720 CSS px odpowiadające 200% przy bazowych 1440 px. Nie zapisano osobnego artefaktu z natywnym ustawieniem zoomu 200%.
- Dla połączeń zewnętrznych podczas audytu zablokowano Google Fonts, YouTube i live Worker. Jest to dowód renderowania lokalnego, nie działania usług zewnętrznych ani produkcji.

### Kontrola faktów i konfabulacji

- Adwersarialne pytania PL/EN obejmują niezatwierdzonego klienta, wymyśloną nagrodę i certyfikat, liczbę sklepów, wydajność rafinerii, aktualność WarsawFlightSafety oraz polecenie wymyślenia rezultatu.
- Oczekiwany i uzyskany wynik testów: deterministyczna odpowiedź o braku potwierdzonej informacji przed wywołaniem AI.
- `WarsawFlightSafety` i `Polpharma` nie występują na aktywnych stronach, w `llms.txt`, `llms-full.txt`, browserowym JS ani w aktywnym promptcie Workera.
- Aktywnym przedsięwzięciem lotniczym prezentowanym w serwisie jest `akrobacja.com`.
- Nie wykonano zapytania do live modelu, więc nie ma produkcyjnego dowodu odpowiedzi Workers AI.

## 2. Znane ograniczenia i blokery przed wydaniem

### Identyfikator limitowania czatu

Browser generuje losowy UUID i zapisuje go lokalnie dla potrzeb limitowania nadużyć. Do limitera trafia wyłącznie hash SHA-256 UUID. Rozwiązanie:

- nie zbiera imienia, e-maila, fingerprintu urządzenia ani IP w kodzie aplikacji;
- nie jest używane do analityki;
- pozostaje trwałym, pseudonimowym identyfikatorem online w pamięci przeglądarki;
- może zostać usunięte lub obrócone przez użytkownika, więc nie jest silną gwarancją anty-abuse;
- nie uzasadnia określenia „anonimowy”.

Przed produkcją trzeba ocenić, czy informację o storage dla ograniczania nadużyć należy dodać do polityki prywatności. Ten runbook nie stanowi oceny prawnej.

### Cloudflare Worker

Nie potwierdzono na koncie Cloudflare unikalności i aktualnego stanu namespace limitera. Wcześniejszy odczyt `wrangler whoami` wskazał wygasłe uwierzytelnienie w trybie nieinteraktywnym. Do czasu świeżego logowania i odczytu efektywnej konfiguracji deploy Workera jest zablokowany.

### Redirect `www` na apex

Cloudflare Pages nie obsługuje redirectów domenowych w pliku `_redirects`; dlatego repozytorium zawiera teraz wyłącznie komentarz i lokalny Wrangler parsuje 0 aktywnych reguł. Redirect `www.mamcarz.com` na `mamcarz.com` musi istnieć jako zewnętrzny Cloudflare Bulk Redirect. Podstawa: [Cloudflare Pages Redirects](https://developers.cloudflare.com/pages/configuration/redirects/) i [Redirecting www to domain apex](https://developers.cloudflare.com/pages/how-to/www-redirect/).

Nie uzyskano aktualnego odczytu reguły konta ani odpowiedzi live z domeny. Jest to bloker wydania. Przed deployem należy potwierdzić kod 301 oraz zachowanie ścieżki i query, na przykład dla kontrolnego URL z nieprodukcyjną ścieżką i parametrem.

## 3. Bramka punktu powrotu

Przed merge lub wdrożeniem należy:

1. wykonać świeży `git fetch` i ustalić commit aktualnie obsługujący produkcję;
2. utworzyć nazwany punkt powrotu, proponowana nazwa: `rollback/pre-flight-plan-2026-08-27`;
3. wypchnąć ten tag lub branch;
4. odczytać go z remote i potwierdzić, że wskazuje dokładnie commit bieżącej produkcji;
5. zapisać SHA oraz komendę rollbacku w protokole wydania.

Utworzenie i push punktu powrotu wymagają osobnej zgody. Bez zdalnego readbacku nie wolno przejść do produkcji.

## 4. Osobne decyzje publikacyjne

Każdy punkt wymaga osobnego, jednoznacznego zatwierdzenia:

1. commit pozostałego, sprawdzonego diffu;
2. push brancha i odczyt zdalnego SHA;
3. utworzenie oraz zdalna weryfikacja punktu powrotu;
4. merge albo promocja wybranego brancha;
5. deploy Cloudflare Pages z zatwierdzonego, czystego commita:

   ```bash
   wrangler pages deploy . --project-name mamcarz-com --branch main --commit-dirty=true
   ```

6. osobny deploy Workera dopiero po odczycie konfiguracji limitera:

   ```bash
   wrangler deploy --config worker/wrangler.toml
   ```

7. osobna weryfikacja powdrożeniowa Pages;
8. osobna weryfikacja powdrożeniowa Workera.

Zgoda na projekt, lokalną implementację, commit lub push nie obejmuje kolejnych punktów.

## 5. Dowody wymagane po wdrożeniu

### Cloudflare Pages

- SHA wdrożonego commita i identyfikator deploymentu;
- HTTP 200 dla reprezentatywnych tras PL/EN oraz nowych sekcji Aplikacje, Lotnictwo i Wiedza;
- dokładnie jeden H1, prawidłowe canonical, `hreflang` PL/EN/x-default i parsowalne JSON-LD;
- aktualne zasoby `style.css?v=20260825-flightplan-3` i `main.js?v=20260825-flightplan-3` bez starego cache;
- security i cache headers zgodne z `_headers`;
- `www` zwraca 301 do apex z zachowaną ścieżką oraz query;
- reprezentatywne rendery PL/EN na telefonie i desktopie;
- brak błędów konsoli, uszkodzonych obrazów i poziomego overflow.

### Worker czatu

- wdrożony osobny SHA i URL `https://mamcarz-chat-api.pawel-767.workers.dev`;
- dokładna konfiguracja bindingów odczytana po deployu;
- dozwolony origin otrzymuje właściwy CORS, obcy origin nie otrzymuje `Access-Control-Allow-Origin`;
- limity wejścia zwracają właściwe 400/413 bez wywołania AI;
- limit 10/60 zwraca 429 z instrukcją ponowienia;
- błędy zależności zwracają komunikat ogólny z request ID, bez promptu, stosu i szczegółów wewnętrznych;
- adwersarialne pytania nie generują klienta, liczby, referencji, certyfikatu, wyniku ani aktualnego statusu spoza zatwierdzonego rejestru;
- awaryjny kontakt mailowy działa po 413, 429 i 500.

Testy powodujące ruch do live AI, sztuczne 429 lub kontrolowany 500 wymagają osobnej zgody i bezpiecznego scenariusza. Wyniki Pages i Workera należy raportować oddzielnie.
