# Changelog

Wersje mamcarz.com numerujemy jako **ROK.TYDZIEŃ.KOLEJNE-WYDANIE** (tydzień ISO). To nie jest semver. Najnowsze wydanie jest na górze. Numer podbijamy tylko przy cięciu wydania; zwykłe PR-y nie ruszają tego pliku ani `version.js`. Ten sam tydzień ISO → tylko kolejny numer wydania. Nowy tydzień → `ROK.NOWY_TYDZIEŃ.1`.

Konkretny build wskazujemy skrótem commita w runbooku albo tutaj, nie w HTML strony.

## Wersja 2026.44.1 z dnia 27 października 2026

Wydanie wyrównuje repozytorium z produkcją. Wersja opublikowana na mamcarz.com 18 października 2026 (nowa strona główna i profil „O mnie”) nie miała źródeł w `main`. To wydanie odtwarza je z publicznej strony i łączy z poprawkami z PR #20.

### Strona

- Strona główna po polsku i angielsku ma układ z produkcji: obietnica marki z portretem, trzy obszary pracy (doradztwo, aplikacje operacyjne, lotnictwo) z jednym potwierdzonym przykładem każdy, krótkie „O mnie” i kontakt.
- Są osobne strony `/o-mnie/` i `/en/o-mnie/` z profilem, wybranym doświadczeniem, wykształceniem i licencjami lotniczymi. Link „O mnie” (EN: „About”) jest w menu i stopce wszystkich stron.
- W sekcji kontaktu jest zdjęcie z uniesionym kciukiem z PR #20.
- Zostają poprawki z PR #20: czytelniejsze kolory etykiet, tekst zastępczy czatu bez JavaScriptu pisany w pierwszej osobie i prostszy wstęp do listy aplikacji.

### Pod spodem

- Nowy token zasobów `20261027-flightplan-5`. Produkcja serwowała inny arkusz stylów pod starym tokenem, więc nowy token wymusza pobranie aktualnego CSS.
- Rejestr faktów opisuje, gdzie każdy fakt jest dziś publikowany. Fakty zdjęte ze strony głównej przy przebudowie mają datę `unpublished_since` zamiast fałszywej powierzchni publikacji.

To cięcie nie wdraża Cloudflare Pages ani Workera.

## Wersja 2026.39.1 z dnia 21 września 2026

Pierwsze wydanie w numeracji produktowej. Zbiera to, co weszło na `main` po redesignie Flight Plan, w tym warstwę Jev w czacie (PR #14).

### Czat na stronie

- Przed odpowiedzią modelu czat może raz przejść przez warstwę Jev (TypeSafe). Jev nie pisze treści dla odwiedzającego: ocenia intencję, spam, próby jailbreak oraz pytania wysokiego ryzyka (klienci, wyniki, liczby, licencje, bieżący status).
- Gdy Jev nie odpowie, przekroczy czas albo zwróci nieczytelny wynik, czat działa dalej jak dotychczas. Odwiedzający nadal dostaje odpowiedź modelu.

### Strona

- Są publiczne strony polityki prywatności po polsku i angielsku: bez ciasteczek, bez analityki, z opisem limitu czatu.
- Na stronie głównej potwierdzone relacje projektowe są pogrupowane według sektorów.
- Zdjęcie w hero jest czytelniejszym portretem.
- Stopka ma przezroczystą sygnaturę; w portfolio jest karta FilmoLot.pl.

To cięcie nie wdraża Cloudflare Pages ani Workera. Worker z Jev był już wdrażany osobno po scaleniu PR #14.
