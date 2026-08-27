import factRegistry from "../content/site-facts.json" with { type: "json" };

export const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const MAX_BODY_BYTES = 16_384;
const MAX_MESSAGES = 20;
const MAX_MESSAGE_CODE_POINTS = 2_000;
const MAX_TOTAL_CODE_POINTS = 12_000;
const PRODUCTION_ORIGINS = new Set(["https://mamcarz.com", "https://www.mamcarz.com"]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const WORKER_FACT_IDS = new Set([
  "brand.promise",
  "core.advisory",
  "core.applications",
  "core.aviation",
  "contact.email"
]);

const registryFacts = Array.isArray(factRegistry.facts) ? factRegistry.facts : [];
const workerFacts = registryFacts.filter((fact) => WORKER_FACT_IDS.has(fact.id)
  && fact.status === "approved"
  && Array.isArray(fact.surfaces)
  && fact.surfaces.includes("worker/index.js"));
const approvedFactLines = workerFacts.map(
  (fact) => `- ${fact.id}: ${fact.display_pl} / ${fact.display_en}`
);

const SYSTEM_PROMPT = `Jesteś krótkim nawigatorem serwisu mamcarz.com. Odpowiadaj w języku użytkownika i pomagaj wybrać właściwy obszar lub stronę.

Zasady bezpieczeństwa faktów:
- Używaj wyłącznie zatwierdzonych faktów z listy poniżej; nie wymyślaj i nie wnioskuj brakujących informacji.
- Nie potwierdzaj klientów, wyników, liczb, ról, stanowisk, licencji, kwalifikacji, nagród ani bieżącego statusu.
- Gdy lista nie potwierdza odpowiedzi, powiedz wprost, że informacja nie jest potwierdzona, i podaj kontakt.
- Odpowiadaj krótko, rzeczowo i bez marketingowych superlatywów.
- Dozwolone kierunki to mamcarz.com, linkedin.com/in/pawelmamcarz oraz mailto:pawel@mamcarz.com.

Zatwierdzone fakty nawigacyjne:
${approvedFactLines.join("\n")}

Kontakt bezpośredni: mailto:pawel@mamcarz.com`;

const HIGH_RISK_PL = /\b(klient|wynik|rezultat|licencj|uprawnien|certyfikat|nagrod|wyróżnien|ile|liczb|wartość|pracował|stanowisk|rola|aktywn|działa obecnie|aktualn)\w*/iu;
const HIGH_RISK_EN = /\b(client|result|licen[cs]e|qualification|certificate|award|how many|number|value|worked|position|role|active|currently|current status)\w*/iu;
const HIGH_RISK_ID_PREFIXES = [
  "client.", "career.", "project.", "education.", "aviation.credential.", "award.", "availability."
];
const highRiskInputDisplays = registryFacts
  .filter((fact) => HIGH_RISK_ID_PREFIXES.some((prefix) => String(fact.id ?? "").startsWith(prefix)))
  .flatMap((fact) => [fact.display_pl, fact.display_en])
  .filter((display) => typeof display === "string" && display.trim().length > 0)
  .map((display) => normalizeForComparison(display));
const disallowedStatusDisplays = registryFacts
  .filter((fact) => fact.status === "review" || fact.status === "retired")
  .flatMap((fact) => [
    fact.value,
    fact.display_pl,
    fact.display_en,
    ...(Array.isArray(fact.forbidden_variants) ? fact.forbidden_variants : []),
    ...(Array.isArray(fact.aliases?.pl) ? fact.aliases.pl : []),
    ...(Array.isArray(fact.aliases?.en) ? fact.aliases.en : [])
  ])
  .filter((display) => typeof display === "string" && display.trim().length > 0)
  .map((display) => normalizeForComparison(display));
const blockedPatterns = (Array.isArray(factRegistry.blocked_claims) ? factRegistry.blocked_claims : [])
  .map((claim) => claim?.pattern)
  .filter((pattern) => typeof pattern === "string" && pattern.trim().length > 0)
  .map((pattern) => normalizeForComparison(pattern));
const approvedNumberTokens = new Set(workerFacts
  .flatMap((fact) => [fact.display_pl, fact.display_en])
  .flatMap((display) => numericTokens(String(display ?? ""))));

class RequestBoundaryError extends Error {
  constructor(status) {
    super(`request boundary ${status}`);
    this.name = "RequestBoundaryError";
    this.status = status;
  }
}

function normalizeForComparison(value) {
  return String(value).normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("pl");
}

function numericTokens(value) {
  return value.match(/\p{N}+(?:[.,]\p{N}+)?/gu) ?? [];
}

export function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    throw new RequestBoundaryError(400);
  }
  let totalCodePoints = 0;
  return messages.map((message) => {
    if (!message || typeof message !== "object" || !["user", "assistant"].includes(message.role)
      || typeof message.content !== "string") {
      throw new RequestBoundaryError(400);
    }
    const content = message.content.trim();
    const codePoints = [...content].length;
    if (codePoints === 0 || codePoints > MAX_MESSAGE_CODE_POINTS) throw new RequestBoundaryError(400);
    totalCodePoints += codePoints;
    if (totalCodePoints > MAX_TOTAL_CODE_POINTS) throw new RequestBoundaryError(400);
    return { role: message.role, content };
  });
}

export async function readBodyWithinLimit(request) {
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null && /^\d+$/u.test(declaredLength) && Number(declaredLength) > MAX_BODY_BYTES) {
    throw new RequestBoundaryError(413);
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RequestBoundaryError(413);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function requestLanguage(request, content = "") {
  if (HIGH_RISK_EN.test(content) && !HIGH_RISK_PL.test(content)) return "en";
  if (/[ąćęłńóśźż]/iu.test(content)) return "pl";
  if (/\b(?:please|where|what|which|find|show|help|about|services?|contact|information|ignore|invent)\b/iu.test(content)) return "en";
  return request.headers.get("Accept-Language")?.toLowerCase().startsWith("en") ? "en" : "pl";
}

function noConfirmation(language) {
  return language === "en"
    ? "I do not have confirmed information in this area. See Projects: https://mamcarz.com/en/case-studies/ or About: https://mamcarz.com/en/#about. Contact: mailto:pawel@mamcarz.com."
    : "Nie mam potwierdzonej informacji w tym zakresie. Sprawdź Projekty: https://mamcarz.com/case-studies/ lub O mnie: https://mamcarz.com/#about. Kontakt: mailto:pawel@mamcarz.com.";
}

function genericError(status, language) {
  const messages = language === "en" ? {
    400: "Invalid request.",
    405: "Method not allowed.",
    413: "The request is too large.",
    415: "JSON content type is required.",
    429: "Too many requests. Try again in one minute.",
    500: "The chat is temporarily unavailable."
  } : {
    400: "Nieprawidłowe żądanie.",
    405: "Metoda jest niedozwolona.",
    413: "Żądanie jest zbyt duże.",
    415: "Wymagany jest format JSON.",
    429: "Zbyt wiele zapytań. Spróbuj ponownie za minutę.",
    500: "Czat jest chwilowo niedostępny."
  };
  return messages[status] ?? messages[500];
}

function allowedOrigins(env) {
  const allowed = new Set(PRODUCTION_ORIGINS);
  if (typeof env?.DEV_ALLOWED_ORIGINS === "string") {
    for (const origin of env.DEV_ALLOWED_ORIGINS.split(",").map((item) => item.trim()).filter(Boolean)) allowed.add(origin);
  }
  return allowed;
}

function corsHeaders(request, env) {
  const headers = new Headers({ Vary: "Origin" });
  const origin = request.headers.get("Origin");
  if (origin && allowedOrigins(env).has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function json(body, status, cors, requestId, extraHeaders = {}) {
  const headers = new Headers(cors);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Request-Id", requestId);
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  return new Response(JSON.stringify({ ...body, requestId }), { status, headers });
}

function isHighRiskInput(content) {
  const normalized = normalizeForComparison(content);
  return HIGH_RISK_PL.test(content)
    || HIGH_RISK_EN.test(content)
    || highRiskInputDisplays.some((display) => normalized.includes(display));
}

function hasApprovedUrl(value) {
  if (value.toLowerCase().startsWith("mailto:")) return value.toLowerCase() === "mailto:pawel@mamcarz.com";
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (host === "mamcarz.com" || host.endsWith(".mamcarz.com")) return true;
    return (host === "linkedin.com" || host === "www.linkedin.com")
      && (url.pathname === "/in/pawelmamcarz" || url.pathname.startsWith("/in/pawelmamcarz/"));
  } catch {
    return false;
  }
}

function unsafeAiReply(reply) {
  const normalized = normalizeForComparison(reply);
  if (numericTokens(reply).some((token) => !approvedNumberTokens.has(token))) return true;
  if (disallowedStatusDisplays.some((display) => normalized.includes(display))) return true;
  if (blockedPatterns.some((pattern) => normalized.includes(pattern))) return true;
  if (/\b(?:pracowałem|prowadziłem|wdrożyłem|mam licencj\w*|worked for|i led|i delivered|i hold a licen[cs]e)\b/iu.test(reply)) return true;
  const urls = reply.match(/(?:https?:\/\/|mailto:)[^\s<>"']+/giu) ?? [];
  return urls.some((url) => !hasApprovedUrl(url.replace(/[),.;!?]+$/u, "")));
}

async function rateKeyFor(clientId) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clientId));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function logUnexpected(error, requestId, pathname) {
  console.error(JSON.stringify({
    event: "chat_request_failed",
    requestId,
    path: pathname,
    errorClass: error instanceof Error ? error.name : "UnknownError"
  }));
}

export default {
  async fetch(request, env = {}) {
    const requestId = crypto.randomUUID();
    const cors = corsHeaders(request, env);
    const pathname = new URL(request.url).pathname;

    if (request.method === "OPTIONS") {
      cors.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      cors.set("Access-Control-Allow-Headers", "Content-Type, X-Chat-Client");
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "POST") {
      return json({ error: genericError(405, requestLanguage(request)) }, 405, cors, requestId, { Allow: "POST, OPTIONS" });
    }

    let language = requestLanguage(request);
    try {
      const mediaType = (request.headers.get("Content-Type") ?? "").split(";", 1)[0].trim().toLowerCase();
      if (mediaType !== "application/json") throw new RequestBoundaryError(415);

      const rawBody = await readBodyWithinLimit(request);
      let body;
      try {
        body = JSON.parse(rawBody);
      } catch {
        throw new RequestBoundaryError(400);
      }
      const messages = validateMessages(body?.messages);
      const finalUserContent = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
      language = requestLanguage(request, finalUserContent);

      const clientId = request.headers.get("X-Chat-Client") ?? "";
      if (!UUID_V4.test(clientId)) throw new RequestBoundaryError(400);
      if (typeof env.CHAT_RATE_LIMITER?.limit !== "function") throw new Error("rate limiter binding unavailable");
      const rateResult = await env.CHAT_RATE_LIMITER.limit({ key: await rateKeyFor(clientId) });
      if (!rateResult || typeof rateResult.success !== "boolean") throw new Error("invalid rate limiter result");
      if (!rateResult.success) {
        return json({ error: genericError(429, language) }, 429, cors, requestId, { "Retry-After": "60" });
      }

      if (isHighRiskInput(finalUserContent)) {
        return json({ reply: noConfirmation(language) }, 200, cors, requestId);
      }
      if (typeof env.AI?.run !== "function") throw new Error("AI binding unavailable");
      const response = await env.AI.run(MODEL, {
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        max_tokens: 500,
        temperature: 0.2
      });
      if (!response || typeof response.response !== "string" || response.response.trim().length === 0) {
        throw new Error("invalid AI response");
      }
      const reply = response.response.trim();
      return json({ reply: unsafeAiReply(reply) ? noConfirmation(language) : reply }, 200, cors, requestId);
    } catch (error) {
      if (error instanceof RequestBoundaryError) {
        return json({ error: genericError(error.status, language) }, error.status, cors, requestId);
      }
      logUnexpected(error, requestId, pathname);
      return json({ error: genericError(500, language) }, 500, cors, requestId);
    }
  }
};
