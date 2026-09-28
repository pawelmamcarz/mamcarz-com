// Build contact links from data attributes so the address is not plain text in
// visible homepage markup. This loop is safe on pages without email links.
document.querySelectorAll(".js-email").forEach((element) => {
  const user = element.dataset.user;
  const domain = element.dataset.domain;
  if (!user || !domain) return;
  const address = `${user}@${domain}`;
  element.href = `mailto:${address}`;
  const textSlot = element.querySelector(".js-email-text");
  if (textSlot) textSlot.textContent = address;
});

function initNavigation() {
  const toggle = document.getElementById("nav-toggle");
  const menu = document.getElementById("nav-menu");
  const overlay = document.getElementById("nav-overlay");
  if (!toggle || !menu) return;
  document.documentElement.classList.add("js");

  const close = () => {
    menu.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    overlay?.classList.remove("is-open");
  };

  toggle.addEventListener("click", () => {
    const open = !menu.classList.contains("is-open");
    menu.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    overlay?.classList.toggle("is-open", open);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.classList.contains("is-open")) {
      close();
      toggle.focus();
    }
  });

  menu.querySelectorAll("a").forEach((link) => link.addEventListener("click", close));
  overlay?.addEventListener("click", close);
  window.addEventListener("resize", () => {
    if (window.innerWidth >= 760) close();
  });

  const siteNav = document.querySelector(".site-nav");
  if (siteNav) {
    let navTicking = false;
    window.addEventListener("scroll", () => {
      if (navTicking) return;
      navTicking = true;
      requestAnimationFrame(() => {
        siteNav.classList.toggle("nav-scrolled", window.scrollY > 80);
        navTicking = false;
      });
    }, { passive: true });
  }

  const currentPath = window.location.pathname;
  menu.querySelectorAll("a").forEach((link) => {
    const href = link.getAttribute("href");
    if (href && href !== "/" && href !== "/en/" && !href.includes("#") && currentPath.startsWith(href)) {
      link.classList.add("active");
    }
  });
}

function initBackToTop() {
  const backToTop = document.getElementById("backToTop");
  if (!backToTop) return;

  let ticking = false;
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      backToTop.classList.toggle("visible", window.scrollY > 600);
      ticking = false;
    });
  }, { passive: true });

  backToTop.addEventListener("click", () => {
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  });
}

function getChatClientId() {
  const key = "mamcarz-chat-client-v1";
  try {
    const existing = localStorage.getItem(key);
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing ?? "")) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(key, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

function chatRequestHistory(history, text) {
  const messages = [...history, { role: "user", content: text }].slice(-20);
  const bytes = () => new TextEncoder().encode(JSON.stringify({ messages })).length;
  const points = () => messages.reduce((sum, item) => sum + [...item.content].length, 0);
  while (messages.length > 1 && (bytes() > 16000 || points() > 12000 || messages[0].role === "assistant")) messages.shift();
  return messages;
}

function safeChatLink(value) {
  if (value === "mailto:pawel@mamcarz.com") return true;
  try {
    const url = new URL(value);
    if (["https://www.linkedin.com/in/pawelmamcarz/", "https://linkedin.com/in/pawelmamcarz/"].includes(value)) return true;
    if (url.origin !== "https://mamcarz.com" || url.search || url.username || url.password) return false;
    const path = url.pathname.replace(/^\/en(?=\/)/, "");
    if (path === "/") return ["", "#about", "#contact"].includes(url.hash);
    return !url.hash && ["/aplikacje-operacyjne/", "/lotnictwo/", "/case-studies/", "/wiedza/", "/wystapienia/", "/prywatnosc/", "/uslugi/transformacja-zakupow/", "/uslugi/wdrozenie-sap-ariba/", "/uslugi/doradztwo-zamowienia-publiczne/"].includes(path);
  } catch { return false; }
}

function initChat() {
  const chatMessages = document.getElementById("chat-messages");
  const chatInput = document.getElementById("chat-input");
  const chatSendButton = document.getElementById("chat-send");
  if (!chatMessages || !chatInput || !chatSendButton) return;

  const CHAT_API = "https://mamcarz-chat-api.pawel-767.workers.dev";
  let chatHistory = [];
  let pendingRequest = null;
  let generation = 0;
  let retryText = "";
  const retryButton = document.getElementById("chat-retry");
  const resetButton = document.getElementById("chat-reset");
  let chatBusy = false;

  const language = (document.documentElement.lang || "pl").toLowerCase().startsWith("en") ? "en" : "pl";
  const copy = {
    pl: {
      thinking: "Sprawdzam…",
      httpErrorBefore: {
        400: "Nie mogę przetworzyć tej rozmowy. Skróć pytanie lub rozpocznij rozmowę od nowa. Możesz napisać do Pawła na",
        413: "Wiadomość lub historia rozmowy jest zbyt długa. Skróć ją albo napisz do Pawła na",
        429: "Limit zapytań został chwilowo wykorzystany. Spróbuj ponownie za minutę albo napisz do Pawła na",
        500: "Czat jest chwilowo niedostępny. Możesz napisać bezpośrednio do Pawła na"
      },
      fallbackAfter: ".",
      netErrorBefore: "Nie mogę połączyć się z czatem. Możesz napisać bezpośrednio do Pawła na",
      netErrorAfter: ".",
      greeting: "Cześć! Pomogę Ci znaleźć właściwą część serwisu.\nZapytaj o doradztwo, aplikacje operacyjne, lotnictwo albo kontakt."
    },
    en: {
      thinking: "Checking…",
      httpErrorBefore: {
        400: "I cannot process this conversation. Shorten the question or start again. You can email Paweł at",
        413: "The message or conversation history is too long. Shorten it or email Paweł at",
        429: "The request limit has been reached for now. Try again in one minute or email Paweł at",
        500: "The chat is temporarily unavailable. You can email Paweł directly at"
      },
      fallbackAfter: ".",
      netErrorBefore: "I cannot connect to the chat. You can email Paweł directly at",
      netErrorAfter: ".",
      greeting: "Hi! I can help you find the right part of the site.\nAsk about advisory, operational applications, aviation or contact."
    }
  }[language];

  function addChatMessage(text, role) {
    const message = document.createElement("div");
    message.className = `chat-msg chat-msg--${role}`;
    message.textContent = text;
    chatMessages.append(message);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return message;
  }

  function showFallback(message, before, after) {
    const contactLink = document.createElement("a");
    contactLink.href = "mailto:pawel@mamcarz.com";
    contactLink.className = "gold-link";
    contactLink.textContent = "pawel@mamcarz.com";
    message.replaceChildren(
      document.createTextNode(`${before} `),
      contactLink,
      document.createTextNode(after)
    );
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function setChatBusy(busy) {
    chatBusy = busy;
    chatSendButton.disabled = busy;
    chatInput.disabled = busy;
  }

  async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text || chatBusy) return;

    addChatMessage(text, "user");
    chatInput.value = "";
    setChatBusy(true);

    const messages = chatRequestHistory(chatHistory, text);
    const requestGeneration = generation;
    const controller = new AbortController();
    pendingRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 30000);
    retryText = text;
    if (retryButton) retryButton.hidden = true;

    const thinking = addChatMessage("", "bot");
    const status = document.createElement("span");
    status.setAttribute("role", "status");
    status.className = "chat-thinking";
    status.textContent = copy.thinking;
    thinking.append(status);

    try {
      const response = await fetch(CHAT_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept-Language": language,
          "X-Chat-Client": getChatClientId()
        },
        body: JSON.stringify({ messages }),
        signal: controller.signal
      });
      if (requestGeneration !== generation) return;
      if (!response.ok) {
        const before = copy.httpErrorBefore[response.status] ?? copy.httpErrorBefore[500];
        showFallback(thinking, before, copy.fallbackAfter);
        return;
      }
      const data = await response.json();
      if (requestGeneration !== generation) return;

      if (typeof data.reply === "string" && data.reply.trim()) {
        thinking.textContent = data.reply;
        const links = Array.isArray(data.links) ? data.links.slice(0, 4) : [];
        for (const link of links) {
          if (!link || typeof link.label !== "string" || !safeChatLink(link.url)) continue;
          const anchor = document.createElement("a");
          anchor.href = link.url;
          anchor.textContent = link.label;
          anchor.className = "chat-destination";
          thinking.append(anchor);
        }
        chatHistory = [...messages, { role: "assistant", content: [...data.reply].slice(0, 2000).join("") }];
        retryText = "";
        chatMessages.scrollTop = chatMessages.scrollHeight;
      } else {
        showFallback(thinking, copy.httpErrorBefore[500], copy.fallbackAfter);
      }
    } catch {
      if (requestGeneration === generation) showFallback(thinking, copy.netErrorBefore, copy.netErrorAfter);
    } finally {
      clearTimeout(timeout);
      if (requestGeneration === generation) {
        pendingRequest = null;
        setChatBusy(false);
        if (retryButton) retryButton.hidden = !retryText;
        chatInput.focus();
      }
    }
  }

  chatSendButton.addEventListener("click", sendMessage);
  chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") sendMessage();
  });

  retryButton?.addEventListener("click", () => {
    if (chatBusy || !retryText) return;
    chatInput.value = retryText;
    sendMessage();
  });
  resetButton?.addEventListener("click", () => {
    generation += 1;
    pendingRequest?.abort();
    pendingRequest = null;
    chatHistory = [];
    retryText = "";
    chatInput.value = "";
    chatMessages.replaceChildren();
    if (retryButton) retryButton.hidden = true;
    setChatBusy(false);
    addChatMessage(copy.greeting, "bot");
    chatInput.focus();
  });
  addChatMessage(copy.greeting, "bot");
  const widget = document.getElementById("ai-chat");
  if (widget) widget.hidden = false;
  document.querySelectorAll("[data-chat-fallback]").forEach(element => { element.hidden = true; });
}

initNavigation();
initBackToTop();
initChat();
