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

function initChat() {
  const chatMessages = document.getElementById("chat-messages");
  const chatInput = document.getElementById("chat-input");
  const chatSendButton = document.getElementById("chat-send");
  if (!chatMessages || !chatInput || !chatSendButton) return;

  const CHAT_API = "https://mamcarz-chat-api.pawel-767.workers.dev";
  const chatHistory = [];
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

    chatHistory.push({ role: "user", content: text });
    if (chatHistory.length > 20) chatHistory.splice(0, chatHistory.length - 20);

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
          "X-Chat-Client": getChatClientId()
        },
        body: JSON.stringify({ messages: chatHistory })
      });
      if (!response.ok) {
        const before = copy.httpErrorBefore[response.status] ?? copy.httpErrorBefore[500];
        showFallback(thinking, before, copy.fallbackAfter);
        return;
      }
      const data = await response.json();

      if (typeof data.reply === "string" && data.reply.trim()) {
        thinking.textContent = data.reply;
        chatHistory.push({ role: "assistant", content: data.reply });
      } else {
        showFallback(thinking, copy.httpErrorBefore[500], copy.fallbackAfter);
      }
    } catch {
      showFallback(thinking, copy.netErrorBefore, copy.netErrorAfter);
    } finally {
      setChatBusy(false);
      chatInput.focus();
    }
  }

  chatSendButton.addEventListener("click", sendMessage);
  chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") sendMessage();
  });

  setTimeout(() => addChatMessage(copy.greeting, "bot"), 300);
}

initNavigation();
initBackToTop();
initChat();
