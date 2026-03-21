// Hamburger menu
const hamburger = document.getElementById('navHamburger');
const navLinks = document.getElementById('navLinks');

hamburger.addEventListener('click', () => {
  hamburger.classList.toggle('active');
  navLinks.classList.toggle('open');
});

navLinks.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    hamburger.classList.remove('active');
    navLinks.classList.remove('open');
  });
});

// Scroll animation for timeline items — unobserve after reveal
const timelineItems = document.querySelectorAll('.timeline-item');
if (timelineItems.length > 0) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const idx = Array.prototype.indexOf.call(timelineItems, entry.target);
        setTimeout(() => entry.target.classList.add('visible'), idx * 120);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });

  timelineItems.forEach(el => observer.observe(el));
}

// Smooth nav highlight — only on homepage (anchor-based nav)
const sections = document.querySelectorAll('section[id]');
const navAnchors = document.querySelectorAll('.nav-links a');

if (sections.length > 3) {
  let lastCurrent = '';
  let scrollTicking = false;

  window.addEventListener('scroll', () => {
    if (!scrollTicking) {
      requestAnimationFrame(() => {
        let current = '';
        sections.forEach(s => {
          if (window.scrollY >= s.offsetTop - 200) current = s.id;
        });
        if (current !== lastCurrent) {
          lastCurrent = current;
          navAnchors.forEach(a => {
            const href = a.getAttribute('href');
            a.style.color = (href === `#${current}` || href === `/#${current}`) ? 'var(--gold)' : '';
          });
        }
        scrollTicking = false;
      });
      scrollTicking = true;
    }
  }, { passive: true });
}

// Active nav link on subpages
const currentPath = window.location.pathname;
navAnchors.forEach(a => {
  const href = a.getAttribute('href');
  if (href !== '/' && currentPath.startsWith(href)) {
    a.style.color = 'var(--gold)';
  }
});

// AI Chat — Llama 3.3 via Cloudflare Worker
const chatMsgs = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");

if (chatMsgs && chatInput) {
  const CHAT_API = "https://mamcarz-chat-api.pawel-767.workers.dev";
  const chatHistory = [];

  function addMsg(text, isUser) {
    const el = document.createElement("div");
    el.className = isUser ? "chat-msg chat-msg--user" : "chat-msg chat-msg--bot";
    el.innerHTML = text;
    chatMsgs.appendChild(el);
    chatMsgs.scrollTop = chatMsgs.scrollHeight;
    return el;
  }

  window.sendMsg = async function() {
    const text = chatInput.value.trim();
    if (!text) return;
    addMsg(text, true);
    chatInput.value = "";

    chatHistory.push({ role: "user", content: text });
    if (chatHistory.length > 20) chatHistory.splice(0, chatHistory.length - 20);

    const thinking = addMsg('<span style="opacity:0.5">Myślę...</span>', false);

    try {
      const res = await fetch(CHAT_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: chatHistory }),
      });

      const data = await res.json();

      if (data.reply) {
        thinking.innerHTML = data.reply.replace(/\n/g, "<br>");
        chatHistory.push({ role: "assistant", content: data.reply });
      } else {
        thinking.innerHTML = "Przepraszam, coś poszło nie tak. Spróbuj ponownie lub napisz na <a href=\"mailto:pawel@mamcarz.com\" style=\"color:var(--gold)\">pawel@mamcarz.com</a>";
      }
    } catch (err) {
      thinking.innerHTML = "Nie udało się połączyć z AI. Napisz bezpośrednio: <a href=\"mailto:pawel@mamcarz.com\" style=\"color:var(--gold)\">pawel@mamcarz.com</a>";
    }
  };

  setTimeout(() => {
    addMsg("Cześć! Jestem asystentem AI Pawła Mamcarza 👋<br>Mogę odpowiedzieć na pytania o jego <strong>usługi</strong>, <strong>doświadczenie</strong> lub pomóc nawiązać <strong>kontakt</strong>. Czym mogę pomóc?", false);
  }, 300);

  chatInput.addEventListener("focus", function() { this.style.borderColor = "var(--gold)"; });
  chatInput.addEventListener("blur", function() { this.style.borderColor = "var(--border)"; });
}
