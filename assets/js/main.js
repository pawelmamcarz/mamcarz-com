// Hamburger menu + overlay
const hamburger = document.getElementById('navHamburger');
const navLinks = document.getElementById('navLinks');
const navOverlay = document.getElementById('navOverlay');

function closeMenu() {
  hamburger.classList.remove('active');
  navLinks.classList.remove('open');
  if (navOverlay) navOverlay.classList.remove('open');
}

hamburger.addEventListener('click', () => {
  const isOpen = navLinks.classList.toggle('open');
  hamburger.classList.toggle('active');
  if (navOverlay) navOverlay.classList.toggle('open', isOpen);
});

navLinks.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', closeMenu);
});

if (navOverlay) {
  navOverlay.addEventListener('click', closeMenu);
}

// Nav scroll state
const nav = document.querySelector('nav');
let navTicking = false;

window.addEventListener('scroll', () => {
  if (!navTicking) {
    requestAnimationFrame(() => {
      nav.classList.toggle('nav-scrolled', window.scrollY > 80);
      navTicking = false;
    });
    navTicking = true;
  }
}, { passive: true });

// Back to top button
const backToTop = document.getElementById('backToTop');
if (backToTop) {
  let bttTicking = false;
  window.addEventListener('scroll', () => {
    if (!bttTicking) {
      requestAnimationFrame(() => {
        backToTop.classList.toggle('visible', window.scrollY > 600);
        bttTicking = false;
      });
      bttTicking = true;
    }
  }, { passive: true });

  backToTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// Scroll reveal for .reveal elements
const revealEls = document.querySelectorAll('.reveal');
if (revealEls.length > 0) {
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  revealEls.forEach(el => revealObserver.observe(el));
}

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
const chatSendBtn = document.querySelector("#ai-chat button[onclick]");

if (chatMsgs && chatInput) {
  const CHAT_API = "https://mamcarz-chat-api.pawel-767.workers.dev";
  const chatHistory = [];
  let chatBusy = false;

  function addMsg(text, isUser) {
    const el = document.createElement("div");
    el.className = isUser ? "chat-msg chat-msg--user" : "chat-msg chat-msg--bot";
    el.innerHTML = text;
    chatMsgs.appendChild(el);
    chatMsgs.scrollTop = chatMsgs.scrollHeight;
    return el;
  }

  function setChatBusy(busy) {
    chatBusy = busy;
    if (chatSendBtn) {
      chatSendBtn.style.opacity = busy ? '0.5' : '1';
      chatSendBtn.style.pointerEvents = busy ? 'none' : 'auto';
    }
    chatInput.disabled = busy;
  }

  window.sendMsg = async function() {
    const text = chatInput.value.trim();
    if (!text || chatBusy) return;
    addMsg(text, true);
    chatInput.value = "";
    setChatBusy(true);

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
    } finally {
      setChatBusy(false);
      chatInput.focus();
    }
  };

  setTimeout(() => {
    addMsg("Cześć! Jestem asystentem AI Pawła Mamcarza 👋<br>Mogę odpowiedzieć na pytania o jego <strong>usługi</strong>, <strong>doświadczenie</strong> lub pomóc nawiązać <strong>kontakt</strong>. Czym mogę pomóc?", false);
  }, 300);

  chatInput.addEventListener("focus", function() { this.style.borderColor = "var(--gold)"; });
  chatInput.addEventListener("blur", function() { this.style.borderColor = "var(--border)"; });
}


