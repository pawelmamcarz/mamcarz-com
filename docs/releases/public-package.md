# Publikacja paczki statycznej

Strona pozostaje statycznym HTML-em. Aktualna procedura zastępuje publikowanie katalogu repozytorium opisywane w historycznych notatkach wydań.

## Przygotowanie lokalne

1. Uruchom `npm run verify:ci` (Node.js 22 lub nowszy). Weryfikacja i pakowanie nie wymagają instalacji zależności npm; `sharp` jest potrzebny tylko do opcjonalnej optymalizacji obrazów.
2. Wynik w `dist/` zawiera strony z `PUBLIC_PAGES` oraz pliki z `scripts/public-assets.json`. Kopiowanie zachowuje zawartość plików. Dokumentacja, rejestr faktów, testy, kod Workera i konfiguracja narzędzi nie są częścią paczki.
3. Nowe obrazy, fonty i pliki do pobrania dopisz do `scripts/public-assets.json`. Nowe strony dodaj do normatywnego `PUBLIC_PAGES` i pozostałych wymaganych indeksów.
4. Opcjonalny podgląd: `wrangler pages dev dist`. Podgląd nie wdraża strony ani Workera.

`npm run package:site` samodzielnie wykonuje weryfikację strony i przygotowuje paczkę. Odtwarza `dist/`; nie przechowuj tam ręcznych zmian. Brak pliku źródłowego i dowiązania symboliczne przerywają pakowanie przed usunięciem poprzedniego wyniku.

## Zatwierdzone wydanie

Przed wydaniem potwierdź docelowy commit i projekt, przygotuj zdalnie zweryfikowany punkt powrotu oraz odczytaj konfigurację domenowej Redirect Rule dla www (`www to apex 301 preserving path and query`; stan potwierdzony 2026-09-13). Sprawdź odpowiedź 301 z zachowaniem ścieżki i query. Push, merge, Pages i Worker wymagają właściwych osobnych zatwierdzeń.

Po zatwierdzeniu Pages i ponownym przygotowaniu paczki:

```sh
wrangler pages deploy dist --project-name mamcarz-com --branch main --commit-dirty=true
```

Po wydaniu zweryfikuj identyfikator deploymentu, publiczne strony i zasoby, przekierowania oraz brak dostępności plików pomocniczych pod ich dawnymi ścieżkami. Lokalna zawartość `dist/` nie dowodzi stanu produkcji. Worker nadal ma oddzielną procedurę wdrożenia.

## Automatyczne kontrole

Workflow `Site verification` uruchamia `npm run verify:ci` dla pull requestów, push do main i ręcznie. Ma wyłącznie uprawnienie `contents: read`, nie utrwala poświadczeń checkoutu i nie korzysta z sekretów Cloudflare. Nie wykonuje publikacji, push ani merge.

Uruchomienie lokalne nie potwierdza zielonego GitHub Actions. Włączenie wymaganej kontroli w ochronie gałęzi jest osobną zmianą ustawień repozytorium.
