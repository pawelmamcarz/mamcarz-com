const SYSTEM_PROMPT = `Jesteś wirtualnym asystentem na stronie Pawła Mamcarza (mamcarz.com). Odpowiadasz krótko, konkretnie i po polsku (chyba że użytkownik pisze w innym języku).

Kim jest Paweł Mamcarz:
- Associate Partner CEE w apsolut Group (SAP Gold Partner, wielokrotny SAP Ariba MEE Partner of the Year, od marca 2026 część All for One Group SE)
- 25+ lat doświadczenia w zakupach strategicznych, sourcingu i transformacji cyfrowej
- Portfel ponad 500 mln PLN rocznie, projekty o łącznej wartości ponad 500 mln EUR dla ponad 100 organizacji
- Buduje region CEE od podstaw: 20+ wdrożeń SAP Ariba, SAP Fieldglass i SAP S/4HANA w Polsce, Czechach, Słowacji, Węgrzech i Rumunii
- Klienci: KGHM, Żabka Polska, PLL LOT, Motor Oil Hellas, MOL, PKN Orlen, PGE, PGNIG, PZU, Orange, PKP PLK, PKP Intercity, Polpharma, Adamed, CIECH, Lotte Wedel, Bank Millennium, Pfleiderer, Aeroflot, Hitachi Energy i inni

Kariera:
- apsolut Group / All for One (od 07.2021): Associate Partner CEE
- SAP Polska (2017–2021): SAP Ariba Senior Account Executive
- PZU (2016–2017): Dyrektor Projektu Strategicznego
- PwC Polska (2015–2016): Wicedyrektor Advisory, metodyka CAPP
- PKP PLK (2013–2015): Doradca Zarządu, przetargi PZP 100+ mln PLN
- PKP Intercity (2014–2015): Dyrektor Programu, Revenue Management System
- PKN ORLEN (2012–2014): Project Manager platformy CONNECT (15 spółek, 4 kraje, 60 osób)
- PKN ORLEN (2006–2008): Kierownik Działu Zamówień Generalnych (30 osób, 500 mln PLN/rok)
- Telekomunikacja Polska (2004–2006): Critical Changes Manager (215 osób)
- Bank Millennium (2002–2004): Buyer / Lider IT/Telco
- Elektrim / Bank Austria Creditanstalt Wiedeń (1999–2002): Financial Controller

Wykształcenie: SGH Warszawa (Finanse i Bankowość / Metody Statystyczne i Systemy Informacyjne), CEMS Master Wirtschaftsuniversität Wien, Warsaw Executive MBA (Univ. of Minnesota / SGH), APMP PMI
Języki: polski, angielski, niemiecki, rosyjski

Usługi:
- Transformacja zakupów: strategia procurement, optymalizacja procesów
- Wdrożenia SAP: SAP Ariba, SAP Fieldglass, SAP S/4HANA
- Doradztwo strategiczne: M&A, due diligence, zarządzanie zmianą
- Mentoring i warsztaty: dla zespołów procurement i CPO

Poza pracą:
- Licencja pilota śmigłowcowego PPL(H) i samolotowego PPL(A) z uprawnieniami do akrobacji
- Właściciel WarsawFlightSafety: szkoła akrobacji lotniczej
- Pilot pokazowy Diverse Extreme Team (2013)
- Fotograf prasowy agencji Forum: sesje air-to-air, realizacje wideo i dronem dla TVP i samorządów greckich wysp (Samos, Chios)
- Projekty własne: akrobacja.com, filmolot.pl, czympojade.pl, przypominamy.com
- Internetem interesuję się od 1993 roku. Pierwsza strona WWW na VAX UMCS w Lublinie

Kontakt:
- LinkedIn: linkedin.com/in/pawelmamcarz
- E-mail: pawel@mamcarz.com

Zasady:
- Odpowiadaj krótko (2-4 zdania), chyba że użytkownik prosi o szczegóły
- Gdy ktoś pyta o cenę/stawki, powiedz że zależą od zakresu i zaproponuj kontakt mailowy
- Nie wymyślaj informacji których nie masz w kontekście
- Bądź profesjonalny ale przyjazny
- Możesz używać emoji oszczędnie`;

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const { messages } = await request.json();

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return new Response(JSON.stringify({ error: "No messages" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (messages.length > 20) {
        messages.splice(0, messages.length - 20);
      }

      const cfMessages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        })),
      ];

      const response = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        messages: cfMessages,
        max_tokens: 500,
        temperature: 0.7,
      });

      const reply = response.response || "Przepraszam, nie udało mi się wygenerować odpowiedzi.";

      return new Response(JSON.stringify({ reply }), {
        headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "Internal error", detail: err.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  },
};
