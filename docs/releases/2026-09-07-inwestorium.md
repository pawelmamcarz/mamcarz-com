# Podcast Inwestorium

Na prośbę właściciela dodano film `https://www.youtube.com/watch?v=PNcy5YZgnWE` do stron wystąpień PL i EN, po istniejącym nagraniu Procurement&Beyond. Sekcja nosi teraz tytuł „Podcasty i rozmowy” / „Podcasts and interviews”. Wpis ma kotwicę `#inwestorium`.

Oficjalny endpoint YouTube oEmbed odczytany 2026-09-07 zwrócił tytuł „PAWEŁ MAMCARZ: DLA MNIE PIENIĄDZE SĄ FUNKCJĄ CZASU | INWESTORIUM #020” oraz autora kanału „Kuba Karliński”. Na stronie zachowano słowa tytułu i numer odcinka, normalizując wielkość liter. Oryginalny tytuł jest oznaczony `lang="pl"` także w EN. Nie dodano streszczenia ani daty nagrania, których nie potwierdzono w tym odczycie.

Nowy zatwierdzony fakt `speaking.inwestorium.title` obejmuje wyłącznie obie strony wystąpień. Audyt pozostałych powierzchni nie wymaga zmian: indeks llms nadal prowadzi do istniejących stron wystąpień, a zakres faktów llms-full, frontendu i Workera pozostaje bez zmian. Data `lastmod` zmienia się na 2026-09-07 tylko dla dwóch zmienionych stron.

Wpis używa istniejącego HTML/CSS nagrań, natywnego odnośnika i `noopener noreferrer`. Nie dodaje odtwarzacza, zewnętrznej miniatury, skryptu ani zasobów. Pakiet publikacji nadal zawiera 79 plików.

Po przeglądzie HTML PL/EN rozszerzono kontrakt nagrań i rejestr faktów o wskazany odcinek. Zachowano kontrole wcześniejszego nagrania i zasobów; odnośniki są dopuszczane wyłącznie dla dwóch konkretnych adresów YouTube. Zaktualizowano dwa digesty dokumentów i kontekst numeracji zmienionych nagłówków. Nowe testy obejmują tożsamość nagrania oraz odrzucenie błędnego URL, tytułu, ukrycia wpisu, usunięcia ochrony linku i cofnięcia zatwierdzenia faktu.

Kontrole stron, metadanych, discovery, SEO, foundation, faktów, pełnego serwisu, Workera (42 testy), jakości (6 testów), składni frontendu i paczki przeszły. Pełna regresja weryfikatora: 960/962 przed aktualizacją dodatkowych historycznych wzorców treści. Jedynymi niezgodnościami były digesty chronionej treści PL/EN i digest inwentarza numeracji po zmianie nagłówka sekcji. Po świadomym przeglądzie i aktualizacji tych wzorców ponownie uruchomiono oba testy wraz z pięcioma testami nagrań: 7/7. Inwentarz nadal zawiera 145 wystąpień; nowy numer odcinka pozostaje własnością zatwierdzonego faktu. Nie zmieniano kodu produktu po pełnym przebiegu regresji.

Podgląd wizualny był niedostępny: CUA nie uruchomiło połączenia, a Chrome DevTools zgłosił zajęty profil. CSS nie był zmieniany. Porównanie AGENTS.md/CLAUDE.md i `git diff --check`: OK. Odczyt HTTP potwierdził 301 z www oraz dokładne zachowanie `/en/lotnictwo/?release=inwestorium`.

Po osobnym zatwierdzeniu właściciela („tak” na pytanie o publikację wersji z podcastem) wykonano `npm run deploy:pages` przez Wrangler 4.129.0. Wydanie: https://2870c18c.mamcarz-com.pages.dev. Paczka zawiera 79 dozwolonych plików; Cloudflare wysłał trzy zmienione zasoby. Nie wykonywano push ani wdrożenia Workera.

Pełny `verify:release -- --live=https://2870c18c.mamcarz-com.pages.dev`: OK. Na mamcarz.com obie strony wystąpień zwracają 200, zawierają jeden odnośnik do nowego podcastu i kotwicę `#inwestorium`. Produkcyjny HTML jest zgodny ze źródłem po pominięciu komentarzy `email_off`, które Cloudflare zużywa podczas przetwarzania. E-maile pozostają natywnymi odnośnikami. Przekierowanie www nadal zwraca 301 z zachowaniem ścieżki i query.

Problem starych kopii źródeł na domenie głównej pozostaje osobną nierozwiązaną kwestią: po tej publikacji `/AGENTS.md` i `/worker/index.js` nadal zwracają 200 na mamcarz.com, podczas gdy kontrola źródeł na bezpośrednim adresie nowego wydania przechodzi.
