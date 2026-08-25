# Mamcarz.com: „Flight Plan” platform redesign

## Status dokumentu

- Status: zatwierdzona koncepcja projektowa
- Data zatwierdzenia: 2026-08-25
- Zakres: architektura informacji, kierunek wizualny, zasady treści, spójność techniczna, SEO, dostępność i walidacja
- Następny etap po akceptacji tego dokumentu: szczegółowy plan wdrożenia
- Poza tym etapem: zmiany w kodzie produktu, publikacja gałęzi, deploy Cloudflare Pages i deploy Workera

## 1. Decyzja projektowa

Mamcarz.com staje się jedną ekspercką platformą Pawła Mamcarza, która łączy trzy równorzędne obszary działalności:

1. doradztwo procurement i SAP Ariba,
2. projektowanie oraz rozwój aplikacji operacyjnych,
3. przedsięwzięcia lotnicze.

Lotnictwo jest działalnością biznesową i jednym z rdzeni marki. Nie może być prezentowane jako hobby, poboczna pasja ani element biografii bez związku z ofertą.

Główna obietnica marki brzmi:

> Od decyzji do działającego systemu.

Zdanie ma otwierać stronę główną w obu wersjach językowych. Wersja angielska ma oddawać sens, a nie kopiować składnię: **From decision to an operational system.**

Witryna zachowuje statyczną architekturę HTML, wspólny arkusz CSS i mały skrypt JavaScript. Nie zostanie wprowadzony framework ani obowiązkowy krok budowania strony.

## 2. Problem do rozwiązania

Obecna witryna zawiera wartościowe fakty, projekty i materiały, ale nie tworzy jednej czytelnej opowieści o działalności. Audyt wykazał następujące problemy:

- pozycjonowanie jest zdominowane przez procurement i SAP, a aplikacje oraz lotnictwo nie mają własnych, równorzędnych wejść,
- kilka nakładających się generacji CSS tworzy sprzeczne reguły i utrudnia dalszy rozwój,
- ciepła paleta, Playfair Display, duże kursywy, dekoracyjne linie i powtarzalne karty przypominają gotowy szablon editorial/AI,
- komponenty, nagłówki, CTA i linie z rezultatami są powtarzane bez jasnej hierarchii funkcjonalnej,
- część treści miesza język polski i angielski albo tłumaczy tekst zbyt dosłownie,
- część precyzyjnych danych jest dynamiczna, nie ma widocznej daty albo źródła i szybko się dezaktualizuje,
- warstwa SEO i metadanych nie jest jednakowo kompletna na wszystkich stronach,
- istniejące strony pomocnicze mają odrębny język wizualny i nie zawsze jasno należą do wspólnego systemu,
- Worker czatowy ma zbyt szerokie CORS i niewystarczająco precyzyjne limity wejścia,
- dokumenty `AGENTS.md` i `CLAUDE.md` nie są verbatim mimo deklarowanego wymogu synchronizacji.

Redesign ma usunąć te rozbieżności u źródła, a nie przykrywać ich kolejną warstwą stylów.

## 3. Cele i mierniki powodzenia

### Cele

- Pokazać trzy obszary działalności jako elementy jednej marki i jednego sposobu pracy.
- Doprowadzać właściwego odbiorcę do odpowiedniej oferty w jednym wyborze z poziomu strony głównej.
- Budować wiarygodność przez konkretną rolę, zakres i dowód, a nie przez marketingowe superlatywy.
- Nadać stronie własny, rozpoznawalny język wizualny „Flight Plan / Operations Map”.
- Ujednolicić PL i EN pod względem znaczenia, struktury, metadanych i jakości.
- Ułatwić bezpieczny rozwój statycznej witryny przez jedno źródło faktów i automatyczną walidację.

### Mierniki powodzenia

- Każdy z trzech głównych obszarów ma widoczne wejście w nawigacji i własną stronę docelową.
- Użytkownik bez znajomości Pawła potrafi po hero wyjaśnić, co łączy procurement, aplikacje i lotnictwo.
- Każda sekcja strony głównej ma jedno zadanie i nie powtarza treści z poprzedniej sekcji.
- Każda publiczna strona ma jeden `h1`, poprawny canonical, komplet hreflang, Open Graph i właściwy typ Schema.org.
- Automatyczny walidator przechodzi bez błędów dla wszystkich publicznych stron PL i EN.
- Główna treść, nawigacja i kontakt pozostają użyteczne bez JavaScript.
- Żadne publiczne twierdzenie nie przedstawia Polpharmy jako klienta.
- Wszystkie zaakceptowane stałe liczbowe pozostają zgodne na stronie, w metadanych, plikach LLM i prompcie Workera.

## 4. Poza zakresem redesignu

- Migracja do frameworka, CMS lub systemu komponentowego wymagającego kompilacji.
- Rebranding osobisty niezwiązany z obecną nazwą i domeną.
- Dodawanie logo klientów bez osobnej zgody i praw do publikacji.
- Wymyślanie rezultatów finansowych, referencji, klientów lub metryk.
- Tworzenie fikcyjnej angielskiej wersji raportu `procurement-2026`.
- Zmiana modelu Workers AI bez osobnej decyzji.
- Push, merge, migracje, deploy strony i deploy Workera. Każda z tych czynności pozostaje osobną bramką wydania.

## 5. Pozycjonowanie i ścieżki odbiorców

Wspólnym mianownikiem działalności jest przeprowadzanie złożonej decyzji przez projekt, wdrożenie i operacyjne użycie. Marka nie jest katalogiem niepowiązanych usług. Pokazuje jedną kompetencję realizowaną w różnych środowiskach.

### Główne grupy odbiorców

| Odbiorca | Potrzeba | Pierwsza ścieżka | Oczekiwany dowód |
|---|---|---|---|
| Zarząd, procurement, transformacja | strategia zakupowa, SAP Ariba, zamówienia publiczne | Doradztwo | zakres odpowiedzialności, skala i studia przypadków |
| Właściciel procesu lub organizacji | działająca aplikacja operacyjna, przepływ danych, automatyzacja | Aplikacje | realne produkty, sposób wdrażania i rezultat operacyjny |
| Partner, klient lub uczestnik rynku lotniczego | szkolenia, bezpieczeństwo, sprzedaż, media, operacje i software | Lotnictwo | aktywne przedsięwzięcia i ich konkretne role |
| Organizator wydarzenia, media, czytelnik | wystąpienie, komentarz ekspercki, analiza | Wiedza | publikacje, tematy i wystąpienia |

Każda ścieżka kończy się kontekstowym kontaktem. CTA ma mówić, czego dotyczy rozmowa, zamiast wszędzie powtarzać „Skontaktuj się”.

## 6. Architektura informacji

### Nawigacja główna

Nawigacja PL:

1. Doradztwo
2. Aplikacje
3. Lotnictwo
4. Projekty
5. Wiedza
6. O mnie
7. Kontakt

Nawigacja EN:

1. Advisory
2. Applications
3. Aviation
4. Projects
5. Insights
6. About
7. Contact

Na małych ekranach menu zachowuje tę kolejność. Przełącznik języka wskazuje odpowiadającą stronę, a nie zawsze stronę główną.

„Doradztwo/Advisory” jest dostępną grupą nawigacyjną z trzema istniejącymi stronami usług, a nie odnośnikiem do nieistniejącego huba. Ma działać bez JavaScript, na przykład jako semantyczne `details/summary`. Aplikacje, Lotnictwo, Projekty i Wiedza prowadzą do własnych tras. „O mnie/About” i „Kontakt/Contact” prowadzą do lokalnych kotwic strony głównej danego języka, także wtedy, gdy użytkownik jest na podstronie.

Na materiale bez prawdziwej pary językowej nie pokazujemy przełącznika udającego tłumaczenie. Można podać jawnie opisany link do huba drugiego języka, ale nie oznacza się go jako odpowiadającego hreflang.

### Mapa tras

| Rola | PL | EN | Decyzja |
|---|---|---|---|
| Strona główna | `/` | `/en/` | przebudowa treści i prezentacji |
| Transformacja zakupów | `/uslugi/transformacja-zakupow/` | `/en/uslugi/transformacja-zakupow/` | zachowanie tras, nowy system i redakcja |
| Wdrożenie SAP Ariba | `/uslugi/wdrozenie-sap-ariba/` | `/en/uslugi/wdrozenie-sap-ariba/` | zachowanie tras, nowy system i redakcja |
| Zamówienia publiczne | `/uslugi/doradztwo-zamowienia-publiczne/` | `/en/uslugi/doradztwo-zamowienia-publiczne/` | zachowanie tras, nowy system i redakcja |
| Aplikacje operacyjne | `/aplikacje-operacyjne/` | `/en/aplikacje-operacyjne/` | nowe strony lustrzane |
| Lotnictwo | `/lotnictwo/` | `/en/lotnictwo/` | nowe strony lustrzane, obszar core |
| Projekty | `/case-studies/` | `/en/case-studies/` | zachowanie canonical URL, etykieta nawigacji „Projekty/Projects”, rozszerzenie o własne przedsięwzięcia |
| Wiedza | `/wiedza/` | `/en/wiedza/` | nowe strony lustrzane i hub treści |
| Wystąpienia | `/wystapienia/` | `/en/wystapienia/` | zachowanie tras, wejście z Wiedzy |
| Procurement 2026 | `/procurement-2026/` | brak sztucznego odpowiednika | materiał PL-only; wersja EN huba oznacza link jako treść po polsku |
| Strony pomocnicze | `/diagrams/`, `/infographic_procurement_2026_EN.html` | zgodnie z ich językiem | włączenie do wspólnej nawigacji i metadanych bez udawanej pary językowej |

`/case-studies/` pozostaje adresem kanonicznym, aby nie wprowadzać zbędnej migracji URL. W interfejsie użytkownik widzi nazwę „Projekty”, ponieważ sekcja obejmie zarówno case studies klientów, jak i własne przedsięwzięcia.

## 7. Strona główna

Kolejność jedenastu istniejących sekcji zostaje zachowana w PL i EN. Nie dodajemy pomiędzy nimi nowych pełnych sekcji. Zmieniają się rola, redakcja i sposób wizualizacji.

### 1. Hero

Zadanie: wyjaśnić wspólną wartość i otworzyć trzy ścieżki działalności.

- Główny nagłówek: „Od decyzji do działającego systemu.”
- Krótkie rozwinięcie łączy procurement, aplikacje operacyjne i lotnictwo bez tworzenia listy przypadkowych aktywności.
- Cztery zatwierdzone liczby: 25+ lat doświadczenia, 20+ wdrożeń, 500M EUR, 50 mld PLN.
- Główne CTA prowadzi do kontaktu w sprawie konkretnego wyzwania.
- CTA ghost prowadzi do „Rezultatów”, czyli `/case-studies/`, a nie do CV.
- Trzy krótkie wejścia tematyczne prowadzą do Doradztwa, Aplikacji i Lotnictwa. Nie są stylizowane jako trzy identyczne karty.
- Fotografia jest autentycznym zdjęciem Pawła lub zatwierdzonym materiałem z działalności. Nie używamy zdjęcia stockowego ani generowanego portretu.

### 2. Trust Bar

Zadanie: natychmiastowy dowód doświadczenia.

- Etykieta: „Pracowałem dla:” / „Worked for:”.
- Wyłącznie zatwierdzone nazwy tekstowe, bez nowych logo.
- Polpharma nie może znaleźć się na liście klientów.
- Pasek nie zawiera ocen, pozycji rankingowych ani dynamicznych liczb.

### 3. Process

Zadanie: pokazać powtarzalny sposób pracy.

- Cztery kroki: Diagnoza → Strategia → Wdrożenie → Wartość.
- To główne zastosowanie motywu trasy. Każdy krok ma czasownik, krótki opis decyzji i konkretny artefakt/rezultat.
- Po sekcji znajduje się pierwsze śródstronicowe CTA dopasowane do rozpoczęcia diagnozy.

### 4. Case Studies

Zadanie: udowodnić skuteczność przez rolę, zakres i wynik.

- ORLEN, Żabka i KGHM pozostają głównymi przypadkami, jeśli fakty przejdą audyt źródłowy.
- Każdy przypadek ma dokładnie: kontekst, rolę Pawła, zakres, dowód i link do pełniejszego opisu.
- Dane dynamiczne otrzymują datę oraz źródło albo znikają z evergreen copy.
- Po sekcji znajduje się drugie śródstronicowe CTA prowadzące do pełnej listy projektów.

### 5. About

Zadanie: wyjaśnić sposób podejmowania decyzji i połączyć trzy domeny.

- Tekst w pierwszej osobie.
- Procurement, technologia i lotnictwo są opisane jako środowiska wymagające odpowiedzialności, procedur i dowożenia działania.
- Sekcja nie powtarza chronologii z Resume.

### 6. Education

Zadanie: zwięzłe potwierdzenie przygotowania formalnego.

- Nazwa programu, instytucja i rok tylko tam, gdzie są potwierdzone.
- Bez komentarzy marketingowych i bez dekoracyjnych ocen.

### 7. Resume

Zadanie: dać skanowalną chronologię doświadczenia.

- Jedna oś czasu, od najnowszych ról.
- Daty, organizacja, rola i jednozdaniowy zakres.
- Link do CV jest dostępny tutaj, nie jako główne CTA hero.

### 8. Skills

Zadanie: odpowiedzieć „W czym mogę Ci pomóc” / „How I can help you”.

- Oferta jest grupowana według problemów odbiorcy, nie według abstrakcyjnych cech.
- Każdy blok zawiera problem, działanie i możliwy wynik.
- Rezygnujemy z powtarzanej złotej linii outcome oraz siatki identycznych kart.
- Aplikacje operacyjne i lotnictwo są widoczne obok procurement.

### 9. Portfolio

Zadanie: pokazać aktywne przedsięwzięcia i produkty.

- Akrobacja.com, WarsawFlightSafety i FilmoLot są przedstawione jako przedsięwzięcia biznesowe.
- Dla każdego projektu podajemy rolę, odbiorcę, aktualny stan i link.
- Projekty aplikacyjne otrzymują tę samą strukturę dowodu.
- Sekcja nie kopiuje opisów z huba `/case-studies/`; pokazuje skrót i kieruje do szczegółu.

### 10. Clients

Zadanie: potwierdzić szerokość doświadczenia bez udawania rekomendacji.

- Nazwy klientów wyłącznie po potwierdzeniu relacji i prawa do publikacji.
- Bez logo, cytatów i przypisanych wyników bez osobnej zgody.
- Polpharma nie jest klientem i nie pojawia się w tej sekcji.

### 11. Contact

Zadanie: zamienić zainteresowanie w konkretną rozmowę.

- Widoczny sygnał dostępności oparty na potwierdzonym stanie, bez automatycznego twierdzenia o wolnym terminie.
- Trzy intencje kontaktu: doradztwo, aplikacje, lotnictwo.
- E-mail i inne istniejące kanały działają bez JavaScript.
- Czat jest kanałem pomocniczym, nie jedyną drogą kontaktu.

## 8. Rola pozostałych stron

### Strony usług doradczych

Każda z trzech stron odpowiada na jedno konkretne zapotrzebowanie. Struktura:

1. problem i oczekiwany rezultat,
2. sytuacje, w których usługa ma sens,
3. zakres współpracy,
4. sposób pracy,
5. dowody i powiązane projekty,
6. kontekstowe CTA.

### Aplikacje operacyjne

Strona opisuje zdolność przełożenia realnego procesu na używane narzędzie. Nie jest ofertą generycznego software house'u. Pokazuje:

- jakie problemy operacyjne Paweł bierze na siebie,
- jak łączy właściciela procesu, dane, UX i wdrożenie,
- wybrane działające produkty oraz zakres jego odpowiedzialności,
- warunki dobrego dopasowania projektu,
- drogę od diagnozy do uruchomienia.

### Lotnictwo

Strona jest pełnoprawnym wejściem biznesowym. Obejmuje:

- operacje i doświadczenia lotnicze,
- sprzedaż i ofertę,
- szkolenia oraz bezpieczeństwo,
- air-to-air i media,
- software wspierający operacje,
- Akrobacja.com, WarsawFlightSafety i FilmoLot jako konkretne przedsięwzięcia.

Treść unika romantyzowania lotnictwa. Akcentuje odpowiedzialność, procedury, bezpieczeństwo, jakość realizacji i użyteczność biznesową.

### Projekty

`/case-studies/` jest rejestrem dowodów. Filtry lub grupy mogą rozdzielić procurement, aplikacje i lotnictwo, ale wszystkie wpisy używają tej samej struktury: sytuacja, odpowiedzialność, działanie, wynik, źródło/status danych.

### Wiedza

Hub prowadzi do analiz, wystąpień i materiałów eksperckich. Nie duplikuje pełnych treści. Każdy element pokazuje typ materiału, temat, język, datę oraz stan aktualności. Materiały PL-only są jednoznacznie oznaczone na stronie EN.

## 9. System wizualny „Flight Plan / Operations Map”

### Charakter

System czerpie z planowania operacji, map tras, odpraw i dokumentacji lotniczej. Ma wyglądać precyzyjnie, współcześnie i autorsko, ale nie jak panel kokpitu. Motywy lotnicze są językiem porządku i odpowiedzialności, nie dekoracją.

### Kolory

| Token | Wartość | Zastosowanie |
|---|---:|---|
| `--sky-paper` | `#E9EDEF` | główne jasne tło |
| `--runway-ink` | `#102831` | tekst, linie i ciemne powierzchnie |
| `--signal` | `#D94B2B` | pojedynczy akcent, aktywny punkt trasy, główne CTA |
| `--panel` | `#193D49` | sekcje o zwiększonym ciężarze i stopka |
| `--boundary` | `#8E9CA1` | linie podziału i dane pomocnicze |
| `--white` | `#F7F9F8` | tekst na ciemnym tle i powierzchnie kontrastowe |
| `--muted` | `#52707A` | tekst drugorzędny po potwierdzeniu kontrastu |

`--signal` nie jest używany do małego tekstu na jasnym tle, dopóki zestawienie nie spełni WCAG AA. Kolor akcentowy ma znaczenie funkcjonalne i nie pojawia się na każdym elemencie.

### Typografia

- Barlow Semi Condensed, self-hosted WOFF2: nagłówki, liczby i komunikaty operacyjne.
- DM Sans, self-hosted WOFF2: tekst główny i nawigacja.
- DM Mono, self-hosted WOFF2: etykiety, daty, statusy, krótkie metadane.
- Playfair Display zostaje wycofany.

Zmiana fontu nagłówkowego jest świadomym odstępstwem od dotychczasowej konwencji repozytorium i wynika z zatwierdzonego kierunku Flight Plan. Fonty są dostarczane lokalnie, aby strona nie zależała od zewnętrznego żądania fontów.

### Siatka i rytm

- Kontener desktop: maksymalnie 1280 px, z bezpiecznymi marginesami minimum 32 px.
- Desktop: 12 kolumn; tablet: 8 kolumn; mobile: 4 kolumny i margines 20 px.
- Główny breakpoint układu: 760 px; drugi breakpoint dla szerokiego desktopu: 1180 px.
- Pionowy rytm bazuje na wielokrotnościach 8 px.
- Długie akapity mają maksymalnie 68 znaków na linię.
- Twarde linie podziału porządkują dane. Cień nie jest podstawowym sposobem budowania hierarchii.

### Element sygnaturowy

Linia trasy z węzłami występuje tylko tam, gdzie istnieje prawdziwa sekwencja: proces, chronologia lub droga projektu. Nie łączymy nią niezależnych kart i nie dodajemy przypadkowych współrzędnych, numerów lotu ani pozornie technicznych oznaczeń.

### Komponenty

- **Nagłówek:** zwarta belka, czytelny stan bieżącej strony, pełny przełącznik PL/EN i proste menu mobilne.
- **Stat board:** liczby hero w jednym uporządkowanym pasie danych, bez osobnych kart.
- **Route sequence:** sekwencja procesu z jednym aktywnym akcentem i logicznym przebiegiem na mobile.
- **Evidence row:** projekt jako poziomy zapis rola → zakres → dowód; na mobile składa się w pionie.
- **Section index:** mała etykieta mono pomaga orientacji, lecz nie zastępuje nagłówka.
- **CTA:** dwa poziomy, primary i text/ghost. W obrębie jednego widoku jest tylko jedno CTA primary.
- **Status tag:** tylko dla realnego stanu, daty lub języka. Nie służy jako dekoracyjna plakietka.

Nie stosujemy długich siatek identycznych zaokrąglonych kart, szkła, gradientowych poświat, wielkich kursyw ani ozdobnych mikroetykiet generujących wrażenie szablonu AI.

### Fotografia i media

- Priorytet mają istniejące, zatwierdzone oryginały Pawła i autentyczne materiały z projektów.
- Nie zmieniamy portretu ani nie generujemy jego zamiennika bez osobnej zgody.
- Każdy obraz ma wariant WebP oraz JPG, prawidłowe `srcset`, wymiary i adekwatny `alt`.
- Fotografia lotnicza nie może sugerować roli, uprawnienia ani usługi, których nie potwierdza treść.

### Ruch

- Tylko krótkie przejścia funkcjonalne 160–220 ms.
- Brak dekoracyjnego parallaxu, animowanych liczników i automatycznie rysowanych tras.
- `prefers-reduced-motion: reduce` wyłącza wszystkie niekonieczne przejścia i przewijanie płynne.

## 10. Zasady treści i usuwanie AI-tells

### Głos marki

- Pierwsza osoba, krótkie aktywne zdania i konkretna odpowiedzialność.
- Jeden akapit ma jedną tezę i jeden adekwatny dowód.
- Najpierw problem lub decyzja odbiorcy, potem metoda i rezultat.
- Angielska wersja jest naturalną redakcją o tym samym znaczeniu, a nie tłumaczeniem słowo w słowo.
- Termin angielski pozostaje w PL tylko wtedy, gdy jest standardem branżowym i zwiększa precyzję.

### Formy do usunięcia

- puste określenia: „kompleksowy”, „innowacyjny”, „realnie” bez dowodu,
- konstrukcje „nie tylko…, ale też…”, mechaniczne trójki i powtarzane podsumowania,
- dekoracyjne pauzy em dash,
- identyczne CTA w wielu sekcjach,
- strzałki i złote linie outcome doklejane do każdej karty,
- superlatywy „największy”, „numer 1”, „wiodący” bez aktualnego źródła,
- teksty o „łączeniu strategii z technologią” bez wskazania decyzji, działania lub rezultatu.

### Odpowiedzialność sekcji

- Hero: teza i skala.
- Process: metoda.
- Cases: rola, zakres i dowód.
- About: sposób myślenia oraz połączenie domen.
- Education: formalne przygotowanie.
- Resume: chronologia.
- Skills: oferta wobec problemów.
- Portfolio: działające przedsięwzięcia.
- Clients: potwierdzone relacje.
- Contact: intencja i następny krok.

Treść przypisana jednej roli nie jest ponownie opowiadana w kolejnej sekcji.

## 11. Fakty i jedno źródło prawdy

Powstaje publicznie bezpieczny rejestr `content/site-facts.json`. Nie jest bazą treści ani krokiem budowania. Służy jako kontrolowany wykaz twierdzeń, które występują na wielu powierzchniach.

Każdy rekord zawiera:

- `id`: stabilny identyfikator,
- `value`: wartość kanoniczną,
- `display_pl` i `display_en`: zatwierdzone formy publikacji,
- `kind`: `constant` albo `dated`,
- `as_of`: data dla faktu dynamicznego, `null` tylko dla faktu stałego,
- `source_type`: `owner_verified`, `public_source` albo `internal_evidence`,
- `source_label`: opis pozwalający wykonać audyt,
- `source_url`: publiczny adres albo `null`, gdy dowód nie jest publiczny,
- `surfaces`: lista plików, w których fakt ma występować,
- `status`: `approved`, `review` albo `retired`.

Rejestr nie zawiera sekretów, danych osobowych klientów, wewnętrznych dokumentów ani poufnych adresów. Walidator porównuje zatwierdzone formy z HTML, metadanymi, `llms.txt`, `llms-full.txt` i `worker/index.js`.

### Reguły publikacji

- Stałe fakty CV mogą mieć `owner_verified` albo `internal_evidence`.
- Fakt dynamiczny musi mieć `as_of` i źródło; bez nich nie trafia do evergreen copy.
- Twierdzenie „największy” lub „numer 1” wymaga aktualnego źródła publicznego i daty.
- Metryka rezultatu musi oddzielać wkład Pawła od wyniku całej organizacji.
- Brak publicznego źródła nie jest zastępowany wymyślonym przypisem.
- Polpharma ma jawny test negatywny w powierzchniach klientów.
- Zmiana zatwierdzonego faktu na stronie wymaga synchronizacji promptu Workera, jeśli prompt używa tego faktu.

### Pierwsza kolejka audytu

- Cztery liczby hero: 25+ lat, 20+ wdrożeń, 500M EUR i 50 mld PLN. Trzeba potwierdzić dokładne znaczenie każdej wartości oraz identyczny zapis PL/EN.
- Liczba sklepów Żabki z oznaczeniem „czerwiec 2026” jest faktem datowanym i wymaga źródła albo usunięcia.
- Informacja o skali Motor Oil wyrażona w baryłkach dziennie jest faktem datowanym i wymaga źródła albo usunięcia.
- Każde istniejące „#1”, „największy” i „wiodący” trafia do ponownej weryfikacji przed publikacją.
- Nazwy w Trust Bar i Clients są porównywane z zatwierdzoną listą relacji; Polpharma jest testem negatywnym.
- Statusy Akrobacja.com, WarsawFlightSafety i FilmoLot są sprawdzane przed użyciem określeń „aktywny”, „działający” lub przed pokazaniem dostępności oferty.

## 12. Technika i zachowanie bez JavaScript

- HTML pozostaje statyczny i semantyczny.
- `assets/css/style.css` zostaje uporządkowany jako jeden system. Stare warstwy, martwe selektory i nadpisania redesignu są usuwane po potwierdzeniu, że nie obsługują strony pomocniczej.
- `assets/js/main.js` pozostaje mały, defensywny i null-safe. Nie służy do tworzenia podstawowej treści ani dekoracyjnych animacji.
- Nawigacja, odnośniki do ofert, treść, kontakt i przełączanie języka są dostępne bez JavaScript.
- Menu mobilne z JavaScript ma poprawne `aria-expanded`, fokus i możliwość zamknięcia klawiszem Escape.
- Cache-busting CSS i JS ma tę samą wersję na wszystkich stronach PL i EN.
- Każdy komponent opcjonalny przerywa inicjalizację bez błędu, jeśli jego elementu nie ma w danym dokumencie.

## 13. Czat i Worker

Model pozostaje `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Zmiana dotyczy granic wejścia, błędów i zgodności faktów.

### Kontrakt żądania

- Akceptowana metoda: `POST`; `OPTIONS` tylko dla preflight.
- `Content-Type`: `application/json`; inne typy otrzymują 415.
- Body przekraczające 16 KB otrzymuje 413 przed wywołaniem modelu.
- `messages` musi być tablicą od 1 do 20 elementów.
- Dozwolone role: wyłącznie `user` i `assistant`.
- `content` musi być stringiem od 1 do 2000 znaków po `trim()`.
- Łączna długość treści wiadomości nie może przekroczyć 12 000 znaków.
- Nieznane pola nie wpływają na prompt i nie są zwracane w odpowiedzi.

### CORS i nadużycia

- Produkcyjna allowlista originów: `https://mamcarz.com` i `https://www.mamcarz.com`.
- Brak lub obcy `Origin` nie otrzymuje produkcyjnego nagłówka `Access-Control-Allow-Origin`.
- Lokalne originy są dopuszczane wyłącznie w środowisku developerskim.
- CORS nie jest mechanizmem ochrony przed nadużyciami. Przed osobnym wydaniem Workera trzeba zweryfikować i udokumentować działającą regułę Cloudflare rate limiting albo równoważny limit na poziomie infrastruktury.

### Błędy i fallback

- 400, 405, 413, 415 i 429 zwracają krótki bezpieczny komunikat bez treści promptu, stack trace i szczegółów dostawcy.
- Nieoczekiwany błąd zwraca 500 z ogólnym komunikatem i identyfikatorem żądania.
- Frontend pokazuje zrozumiały fallback oraz zawsze pozostawia bezpośredni link kontaktowy.
- Fakty system promptu podlegają temu samemu rejestrowi i audytowi co publiczna strona.

Worker i strona są wdrażane oddzielnie. Zmiana kodu Workera nie może zostać uznana za opublikowaną na podstawie deployu Pages.

## 14. SEO, metadane i semantyka

Każda strona publiczna otrzymuje:

- jeden widoczny i semantyczny `h1`,
- absolutny canonical do właściwego URL,
- hreflang `pl`, `en` i `x-default` dla prawdziwych par,
- spójne `title`, description i Open Graph,
- właściwy `og:locale` oraz alternatywny locale dla par,
- prawidłowy, parsowalny JSON-LD,
- jeden logiczny `main` i prawidłową hierarchię nagłówków.

### Typy Schema.org

- Home: `Person` połączony z `WebSite`.
- Strony doradztwa, aplikacji i lotnictwa: `Service`.
- `/case-studies/`: `CollectionPage` z `ItemList` projektów.
- `/wiedza/`: `CollectionPage` z listą materiałów.
- Wystąpienia i artykuły: `Article` lub `Event` tylko wtedy, gdy strona zawiera wymagane, prawdziwe dane.

`/procurement-2026/` pozostaje PL-only. Ma canonical, hreflang `pl` i `x-default` wskazujące ten sam materiał, bez linku do nieistniejącej pary EN.

`sitemap.xml` zawiera wyłącznie adresy kanoniczne. `lastmod` oznacza rzeczywistą zmianę treści danej strony, a nie datę globalnego deployu. `llms.txt` i `llms-full.txt` odzwierciedlają nową architekturę oraz zatwierdzone fakty.

404 ma jeden `h1`; wybór języka jest rozwiązany w treści, a nie przez dwa konkurencyjne nagłówki pierwszego poziomu.

## 15. Dostępność i responsywność

- WCAG 2.2 AA dla kontrastu tekstu, stanów fokusu i kluczowych interakcji.
- Pełna obsługa klawiatury, widoczny `:focus-visible` i logiczna kolejność tabulatora.
- Link pomijający nawigację kieruje do `main`.
- Nawigacja mobilna nie blokuje fokusu po zamknięciu.
- Cele dotykowe mają co najmniej 44 × 44 px.
- Tekst może zostać powiększony do 200% bez utraty treści lub funkcji.
- Układ nie tworzy poziomego przewijania przy 320 px.
- Informacja nie jest kodowana wyłącznie kolorem ani pozycją na linii trasy.
- Obrazy dekoracyjne mają pusty `alt`; obrazy informacyjne opisują cel, nie wygląd.
- Wideo lub ruchomy materiał nie startuje z dźwiękiem i ma dostępne sterowanie.

## 16. Wydajność

- Fonty WOFF2 są lokalne, ograniczone do używanych odmian i preloadowane tylko wtedy, gdy wpływają na LCP.
- Obraz LCP ma jawne wymiary, `fetchpriority="high"` i wariant dopasowany do viewportu.
- Obrazy poza pierwszym widokiem używają lazy loading.
- JavaScript nie blokuje renderowania i jest ładowany przez `defer`.
- CSS nie zachowuje martwych generacji systemu wizualnego.
- Budżet po kompresji: CSS do 75 KB, JavaScript strony do 25 KB, mobilny obraz LCP do 220 KB.
- Weryfikacja obejmuje LCP, CLS i INP w lokalnym renderze oraz po ewentualnym deployu preview. Wynik lokalny nie jest przedstawiany jako wynik produkcji.

## 17. Automatyczna walidacja

Powstaje bez-zależnościowy skrypt `scripts/verify-site.mjs`, uruchamiany przez Node. Skrypt kończy się niezerowym kodem przy błędzie i sprawdza:

1. istnienie wszystkich wymaganych par PL/EN,
2. poprawność lokalnych linków i zasobów,
3. dokładnie jeden `h1` na publicznej stronie,
4. canonical i hreflang zgodne z mapą tras,
5. obecność wymaganych pól Open Graph,
6. parsowalność JSON-LD i oczekiwany typ schema,
7. jednolitą wersję cache-busting dla CSS i JS,
8. zgodność zatwierdzonych faktów z `content/site-facts.json`,
9. brak Polpharmy na listach klientów,
10. brak uzgodnionych AI-tells w publicznym copy,
11. aktualność wpisów `sitemap.xml`, `llms.txt` i `llms-full.txt` wobec mapy publicznych stron,
12. identyczność `AGENTS.md` i `CLAUDE.md`.

Lista AI-tells w walidatorze jest ograniczona do jednoznacznie odrzuconych sformułowań. Nie blokuje poprawnych branżowych zastosowań słów na podstawie samego fragmentu tekstu.

## 18. Weryfikacja manualna

Przed uznaniem implementacji za gotową trzeba przejść:

- render strony głównej i każdej rodziny podstron w PL i EN,
- szerokości 320, 390, 768, 1280 i 1440 px,
- nawigację wyłącznie klawiaturą,
- tryb `prefers-reduced-motion`,
- kontrast wszystkich tokenów i stanów interaktywnych,
- działanie linków językowych na odpowiadających trasach,
- fallback JPG i układ bez JavaScript,
- scenariusz udanej rozmowy z czatem, walidację złych danych, limit i błąd Workera,
- kontrolę, że Worker nie ujawnia szczegółów błędów,
- `git diff --check` oraz przegląd wszystkich zmian przed commitem.

Po deployu, jeśli zostanie osobno zatwierdzony, trzeba zweryfikować publiczne canonicale, redirect `www`, nagłówki bezpieczeństwa, cache, działanie zasobów i faktyczny URL Workera. Push nie jest dowodem deployu, a deploy Pages nie jest dowodem deployu Workera.

## 19. Podział przyszłego wdrożenia

Szczegółowy plan powstanie dopiero po akceptacji niniejszej specyfikacji. Implementacja ma zostać podzielona na trzy niezależnie przeglądalne strumienie:

### Strumień 1: fundament i strona główna

- tokeny, fonty, siatka, wspólne komponenty,
- konsolidacja CSS i zachowanie stron jeszcze nieprzeniesionych,
- przebudowa strony głównej PL i EN z wymaganą kolejnością sekcji,
- podstawowa dostępność i zachowanie bez JS.

### Strumień 2: architektura treści i wszystkie strony

- nowe huby Aplikacje, Lotnictwo i Wiedza w PL/EN,
- migracja usług, projektów, wystąpień i stron pomocniczych do Flight Plan,
- redakcja PL/EN, usunięcie duplikacji i audyt praw do zasobów,
- kompletna nawigacja i kontekstowe CTA.

### Strumień 3: fakty, SEO, walidacja i Worker

- `content/site-facts.json` i synchronizacja powierzchni,
- metadata, schema, sitemap, pliki LLM i 404,
- `scripts/verify-site.mjs` oraz testy regresji,
- hardening wejścia i błędów Workera,
- pełna weryfikacja przed decyzją o wydaniu.

Każdy strumień ma własny przegląd różnic i bramkę jakości. Żaden nie obejmuje automatycznego wdrożenia produkcyjnego.

## 20. Kryteria akceptacji implementacji

Implementacja jest zgodna ze specyfikacją, gdy jednocześnie:

- trzy obszary core są równorzędne w nawigacji, hero i ścieżkach kontaktu,
- lotnictwo jest przedstawione biznesowo i ma własną stronę PL/EN,
- strona główna zachowuje dokładną kolejność 11 sekcji i dwa wymagane śródstronicowe CTA,
- hero zawiera właściwe cztery liczby, a ghost CTA prowadzi do projektów,
- nie ma niezatwierdzonych logo, fikcyjnych dowodów ani Polpharmy wśród klientów,
- Playfair i stary editorial preset nie są aktywną warstwą wizualną,
- jeden spójny CSS obsługuje wszystkie strony objęte redesignem,
- PL i EN mają równoważne znaczenie oraz odpowiadające sobie trasy,
- strony działają bez JavaScript w zakresie podstawowej treści, nawigacji i kontaktu,
- walidator automatyczny przechodzi bez błędów,
- kontrola dostępności, responsywności i kluczowych ścieżek nie wykazuje błędu blokującego,
- prompt Workera i publiczne powierzchnie używają tych samych zatwierdzonych faktów,
- `AGENTS.md` i `CLAUDE.md` są identyczne,
- stan repozytorium i zakres zmian zostały jawnie przedstawione przed każdym commitem, pushem i wdrożeniem.

## 21. Bramki wydania

1. Akceptacja tej specyfikacji.
2. Akceptacja szczegółowego planu wdrożenia.
3. Implementacja i przegląd lokalny.
4. Zielona walidacja automatyczna i manualna.
5. Osobna decyzja o commicie lub publikacji gałęzi, jeśli nie została wcześniej udzielona dla danego etapu.
6. Osobna decyzja o deployu Cloudflare Pages.
7. Osobna decyzja o deployu Workera, jeśli jego kod się zmienia.
8. Weryfikacja publicznej wersji po każdym zatwierdzonym deployu.

Żadna wcześniejsza akceptacja układu lub dokumentacji nie zastępuje późniejszej zgody na deploy produkcyjny.
