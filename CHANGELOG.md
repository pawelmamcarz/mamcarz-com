# Changelog

Wersje mamcarz.com numerujemy jako **ROK.TYDZIEŃ.KOLEJNE-WYDANIE** (tydzień ISO). Najnowsze wydanie jest na górze. Numer podbijamy tylko przy cięciu wydania, nie przy każdym PR.

Konkretny build wskazujemy skrótem commita w runbooku albo tutaj, nie w HTML strony.

## 2026.39.1 — 21 września 2026

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
