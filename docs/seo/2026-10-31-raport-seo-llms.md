# Przegląd SEO i llms mamcarz.com: 2026-10-31

Zakres: 27 dokumentów z `PUBLIC_PAGES` (PL i EN), `sitemap.xml`, `robots.txt`, `llms.txt`, `llms-full.txt` oraz rejestr `content/site-facts.json`. Przegląd jest zmianą funkcjonalną, nie wydaniem: `version.js`, `CHANGELOG.md` i token zasobów `20261027-flightplan-5` pozostają bez zmian, CSS i JS nie są modyfikowane.

## Pięć najważniejszych wniosków

1. **Fundament techniczny był poprawny, brakowało słów kluczowych.** Każda strona miała jeden canonical, komplet `hreflang`, Open Graph i minimalny Schema.org zgodny z manifestem. Tytuły i opisy były jednak ogólne („Projekty · Paweł Mamcarz”, „Wiedza · Paweł Mamcarz”) i nie zawierały fraz, których szukają klienci: SAP Ariba, model operacyjny zakupów, zamówienia publiczne, loty akrobacyjne, nazwy produktów i klientów. Zmieniono tytuły i opisy na 21 stronach, wyłącznie na podstawie zatwierdzonych faktów i treści już widocznej na stronach.
2. **`llms.txt` był indeksem tras bez opisów.** Asystent AI nie dostawał odpowiedzi na pytania „kim jest”, „co oferuje”, „jak się skontaktować” ani „jak cytować”. Nowa wersja ma podsumowanie, sekcję o osobie, kontakt, wszystkie 27 tras z jednozdaniowym opisem, aplikacje i portfolio, role zawodowe oraz politykę cytowania. `llms-full.txt` dostał te same role i politykę cytowania. Wszystkie linie z identyfikatorem faktu pochodzą 1:1 z wpisów `approved`.
3. **Linkowanie wewnętrzne jest najsłabszym elementem.** Usługi nie linkowały do siebie nawzajem, a aplikacje operacyjne, wystąpienia i lotnictwo dostają linki prawie wyłącznie z nawigacji. Dodano blok „Powiązane” na trzech stronach usług w obu językach. Dalsze linki (aplikacje, wystąpienia, projekty, wiedza) wymagają decyzji, bo zmieniają chronioną strukturę treści.
4. **Rozszerzenia Schema.org nie przynoszą dziś realnej korzyści.** FAQPage nie ma podstawy, bo na stronach nie ma sekcji pytań i odpowiedzi, a Google od 2023 roku pokazuje wyniki rozszerzone FAQ głównie stronom rządowym i medycznym. BreadcrumbList, ProfessionalService i rozbudowa `Person` (np. `jobTitle`, `sameAs`) są wykonalne, ale wymagają świadomej zmiany kontraktów schematu i decyzji o faktach. Zestawienie poniżej.
5. **Największy potencjał ruchu leży w treści, której jeszcze nie ma.** Serwis ma 13 par stron i jeden materiał merytoryczny (Procurement Process 2026). Zapytania informacyjne („jak wdrożyć SAP Ariba”, „model operacyjny zakupów”, „TCO w zakupach”, „lot akrobacyjny voucher”) nie mają strony docelowej. Lista 12 tematów jest poniżej; żaden nie został napisany ani nie dodaje faktów.

## Lista zmian

### Tytuły, opisy i metadane

Zmieniono `<title>`, `og:title`, `og:image:alt`, meta description, `og:description` i `description` w JSON-LD (zawsze razem, bo kontrakty wymagają ich równości). Bez zmian: `/prywatnosc/`, `/en/prywatnosc/` i cztery diagramy. Dla `/procurement-2026/` zmieniono tylko tytuł, a dla zamówień publicznych tylko opis.

| Trasa | Nowy tytuł PL | Nowy tytuł EN |
| --- | --- | --- |
| `/`, `/en/` | Paweł Mamcarz · Zakupy, SAP Ariba, aplikacje i lotnictwo | Paweł Mamcarz · Procurement, SAP Ariba, applications, aviation |
| `/uslugi/transformacja-zakupow/` | Transformacja zakupów i model operacyjny · Paweł Mamcarz | Procurement transformation and operating model · Paweł Mamcarz |
| `/uslugi/wdrozenie-sap-ariba/` | Wdrożenie i integracja SAP Ariba · Paweł Mamcarz | SAP Ariba implementation and integration · Paweł Mamcarz |
| `/uslugi/doradztwo-zamowienia-publiczne/` | bez zmian, nowy opis | bez zmian, nowy opis |
| `/aplikacje-operacyjne/` | Aplikacje operacyjne i produkty · Paweł Mamcarz | Operational applications and products · Paweł Mamcarz |
| `/lotnictwo/` | Lotnictwo i loty akrobacyjne · Paweł Mamcarz | Aviation and aerobatic flights · Paweł Mamcarz |
| `/case-studies/` | Projekty: wdrożenia SAP Ariba i produkty · Paweł Mamcarz | Projects: SAP Ariba implementations and products · Paweł Mamcarz |
| `/wiedza/` | Wiedza: proces zakupowy i SAP Ariba · Paweł Mamcarz | Insights: procurement process and SAP Ariba · Paweł Mamcarz |
| `/wystapienia/` | Wystąpienia i podcasty o zakupach · Paweł Mamcarz | Speaking and podcasts on procurement · Paweł Mamcarz |
| `/o-mnie/` | O mnie: Dyrektor Sprzedaży w All for One · Paweł Mamcarz | About: Sales Director at All for One · Paweł Mamcarz |
| `/procurement-2026/` | Procurement Process 2026: model procesu zakupowego · Paweł Mamcarz | brak pary EN |

Opisy wymieniają moduły SAP Ariba (Sourcing, Contracts, Buying, Supplier Risk, Fieldglass) i integrację z SAP S/4HANA, klientów z zatwierdzonych faktów (ORLEN, KGHM, Żabka Polska, PLL LOT, Motor Oil Hellas), produkty (czympojade.pl, Przypominamy.com, ProcuraCost, silence-tax.com), akrobacja.com i FilmoLot.pl oraz wykształcenie i licencje lotnicze z profilu. Pełne brzmienie każdego tytułu i opisu jest w `docs/seo/ARCHIWUM/2026-10-31-seo-report.md`.

### Linki wewnętrzne

Na każdej z sześciu stron usług, w sekcji kontaktu, dodano jeden akapit „Powiązane:” / „Related:” z linkami do dwóch pozostałych usług i do `/procurement-2026/` (w EN z dopiskiem, że wprowadzenie jest po polsku). Nie zmieniono CSS.

### llms.txt i llms-full.txt

- `llms.txt`: podsumowanie, sekcje „Who is Paweł Mamcarz”, „Contact”, „Key pages” (27 tras z jednozdaniowym opisem), „Applications and portfolio”, „Approved short facts”, „Roles”, „Citation policy”.
- `llms-full.txt`: podsumowanie, odwołanie do `llms.txt`, podział ról na bieżącą i wcześniejsze, polityka cytowania.
- Rejestr faktów: `contact.email`, `contact.scheduling_link` oraz `career.all_for_one.organization` i `career.all_for_one.dates` mają dopisane powierzchnie `llms.txt` (i `llms-full.txt` dla ról). Dla linku do kalendarza dodano `surface_rules` z dokładnym brzmieniem w `llms.txt`. Treść i status faktów nie zmieniły się.

### Sitemap

`lastmod` = `2026-10-31` dla 21 tras, których treść się zmieniła. Bez zmian: `/prywatnosc/`, `/en/prywatnosc/` (2026-10-27) i cztery diagramy (2026-09-04). `robots.txt` był poprawny i pozostał bez zmian.

### Weryfikacja i automatyzacja

- `npm run seo:report` (`scripts/seo-report.mjs`): raport offline z opcjonalnym `--online`, `--check` i `--write`. Opis i lista kontrolna w `docs/seo/README.md`.
- Kontrola offline wpięta w `npm run test:quality` (dwa nowe testy). Komendy `verify:*` pozostały bez zmian, bo ich brzmienie jest przypięte w `scripts/verify-site.test.mjs`.
- W `scripts/verify-site.mjs` zaktualizowano kontrakty opisów i tytułów (usługi, aplikacje, lotnictwo, projekty, wiedza, wystąpienia), digesty dokumentów, `PLAN3_VALIDATION_DATE` i mapę `lastmod`, a w testach odpowiadające im fixture i skróty treści chronionej. Każdą zmianę digestu poprzedziło sprawdzenie, że diff HTML obejmuje wyłącznie metadane w `<head>` i akapity „Powiązane”.

## Tematy do opracowania

Propozycje, nie treść. Każdy temat wymaga autora, źródeł i, jeśli pojawia się nowy fakt (klient, liczba, wynik), decyzji w rejestrze faktów. Adresy zakładają podstrony `/wiedza/` z polskim slugiem także pod `/en/`.

| # | Zapytanie docelowe (PL / EN) | Intencja | Proponowany URL | Proponowany tytuł PL / EN |
| --- | --- | --- | --- | --- |
| 1 | wdrożenie SAP Ariba krok po kroku / SAP Ariba implementation steps | informacyjna, wczesny etap zakupu | `/wiedza/wdrozenie-sap-ariba-etapy/` | Wdrożenie SAP Ariba: etapy i decyzje przed konfiguracją / SAP Ariba implementation: stages and decisions before configuration |
| 2 | SAP Ariba integracja z S/4HANA / SAP Ariba S/4HANA integration | informacyjna, techniczna | `/wiedza/integracja-sap-ariba-s4hana/` | Integracja SAP Ariba z SAP S/4HANA: dane, przepływy i testy / SAP Ariba and SAP S/4HANA integration: data, flows and testing |
| 3 | SAP Ariba moduły / SAP Ariba modules explained | informacyjna | `/wiedza/moduly-sap-ariba/` | Moduły SAP Ariba: Sourcing, Contracts, Buying, Supplier Risk i Fieldglass / SAP Ariba modules: Sourcing, Contracts, Buying, Supplier Risk and Fieldglass |
| 4 | model operacyjny zakupów / procurement operating model | informacyjna, porównawcza | `/wiedza/model-operacyjny-zakupow/` | Model operacyjny zakupów: decyzje, role i procesy / Procurement operating model: decisions, roles and processes |
| 5 | transformacja zakupów od czego zacząć / how to start procurement transformation | informacyjna, problemowa | `/wiedza/transformacja-zakupow-od-czego-zaczac/` | Transformacja zakupów: od czego zacząć / Procurement transformation: where to start |
| 6 | ocena dojrzałości zakupów / procurement maturity assessment | narzędziowa | `/wiedza/ocena-dojrzalosci-zakupow/` | Ocena dojrzałości funkcji zakupów: jak ją przeprowadzić / Procurement maturity assessment: how to run it |
| 7 | TCO w zakupach / total cost of ownership procurement | informacyjna | `/wiedza/tco-w-zakupach/` | TCO w zakupach: jak liczyć całkowity koszt posiadania / TCO in procurement: calculating total cost of ownership |
| 8 | strategia postępowania zamówienia publiczne / public procurement procedure strategy | informacyjna, sektor publiczny | `/wiedza/strategia-postepowania-zamowienia-publiczne/` | Strategia postępowania w zamówieniach publicznych na systemy IT / Procedure strategy for public IT procurement |
| 9 | zakup systemu ERP w trybie zamówień publicznych / buying ERP through public procurement | transakcyjna, sektor publiczny | `/wiedza/zakup-erp-zamowienia-publiczne/` | Zakup systemu ERP w zamówieniach publicznych: dokumenty i decyzje / Buying ERP through public procurement: documents and decisions |
| 10 | P2P procure-to-pay proces / procure-to-pay process | informacyjna | `/wiedza/proces-procure-to-pay/` | Proces procure-to-pay: od zapotrzebowania do płatności / The procure-to-pay process: from requisition to payment |
| 11 | aplikacja operacyjna na zamówienie / custom operational application | transakcyjna | `/wiedza/aplikacja-operacyjna-na-zamowienie/` | Aplikacja operacyjna na zamówienie: kiedy ma sens / Custom operational applications: when they make sense |
| 12 | lot akrobacyjny voucher prezent / aerobatic flight gift voucher | transakcyjna, konsumencka | strona na akrobacja.com, link z `/lotnictwo/` | Lot akrobacyjny jako prezent: jak wybrać voucher / Aerobatic flight as a gift: choosing a voucher |
| 13 | jak wybrać integratora SAP Ariba / choosing an SAP Ariba partner | komercyjna, porównawcza | `/wiedza/wybor-partnera-sap-ariba/` | Jak wybrać partnera wdrożeniowego SAP Ariba / How to choose an SAP Ariba implementation partner |

Kolejność proponowana według potencjału komercyjnego: 1, 13, 4, 2, 8, 7, 3, 5, 6, 9, 10, 11, 12. Każda nowa podstrona wymaga wpisu w `PUBLIC_PAGES`, sitemapie, obu plikach llms, pary PL/EN i nowego kontraktu rodziny stron.

## Do decyzji właściciela

1. **BreadcrumbList w JSON-LD.** Widoczne okruszki już istnieją na podstronach. Dodanie schematu wymaga zmiany kontraktów `plan3VerifyConservativeSchema` i digestów wszystkich podstron. Korzyść: okruszki w wynikach Google zamiast surowego URL. Rekomendacja: tak, w osobnym PR.
2. **FAQPage.** Brak treści FAQ na stronach, a wyniki rozszerzone FAQ są dziś ograniczone. Rekomendacja: nie dodawać, dopóki nie powstanie prawdziwa sekcja pytań i odpowiedzi.
3. **ProfessionalService.** Typ zakłada adres, obszar działania i ofertę; `areaServed` i `offers` są obecnie zakazane przez kontrakty. Rekomendacja: zostać przy `Service` bez dodatkowych właściwości.
4. **Rozbudowa `Person`.** `jobTitle` (Dyrektor Sprzedaży, zatwierdzony fakt) i `sameAs` z profilem LinkedIn widocznym na `/o-mnie/` poprawiłyby rozpoznanie encji w Google i asystentach AI. Wymaga decyzji, czy rola w All for One może trafić do schema strony głównej (`worksFor` jest dziś zakazane), oraz wpisu faktu dla adresu LinkedIn.
5. **Kolejne powierzchnie faktów.** Dopisanie `llms.txt` do wybranych faktów `portfolio.*` pozwoliłoby opisywać produkty w llms identycznie jak na stronach. Te powierzchnie są przypięte kontraktami projektów i lotnictwa, więc pozostawiono je bez zmian.
6. **Linki kontekstowe poza usługami.** Strony aplikacji, wystąpień, projektów i wiedzy nie mają linków „Powiązane”. Raport `seo:report` ostrzega też, że `/en/wiedza/` nie ma linku z treści żadnej innej strony. Dodanie wymaga zmiany chronionych kontraktów treści tych rodzin.
7. **Wystąpienia w nawigacji.** `/wystapienia/` jest osiągalne tylko z `/wiedza/`. Dodanie pozycji w menu zmienia wspólną powłokę wszystkich stron.
8. **Diagramy.** Tytuły czterech diagramów nie zawierają marki ani słów „SAP Ariba” czy „procurement maturity” w spójnym układzie, a opis `diagram2_ariba` ma 182 znaki. Zmiana wymaga przeglądu kontraktów diagramów.
9. **Różnica zasobów PL/EN na `/wiedza/`.** Wersja EN ma dodatkowy link do infografiki, której nie ma w PL. Do potwierdzenia, czy to celowe.
10. **Kontakt w llms.** Adres e-mail i link do Cal.com są teraz w `llms.txt`. Jeżeli właściciel woli, by asystenci AI kierowali wyłącznie do sekcji kontaktu, wystarczy usunąć dwie linie i powierzchnie w rejestrze.
11. **Tytuły stron prywatności.** „Prywatność · Paweł Mamcarz” i „Privacy · Paweł Mamcarz” są krótsze niż zalecane 30 znaków. Celowo bez zmian, bo to strony informacyjne bez wartości wyszukiwania.
12. **Weryfikacja zewnętrzna.** Po wdrożeniu należy zgłosić sitemapę w Google Search Console i Bing Webmaster Tools (IndexNow przez Cloudflare jest opcją) oraz potwierdzić przekierowanie `www` na apex. Te kroki są poza repozytorium.
