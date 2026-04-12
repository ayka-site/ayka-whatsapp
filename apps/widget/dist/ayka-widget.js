/**
 * AyKa Chat Widget - Embeddable AI chatbot for any website
 *
 * Usage:
 *   <script src="https://your-api.com/widget/embed/ayka-widget.js"
 *           data-business-id="YOUR_BUSINESS_ID"
 *           data-api-url="https://your-api.com"></script>
 *
 * That's it. One script tag. The widget auto-initializes.
 */
(function() {
  'use strict';

  // ── Prevent double-init ──
  if (window.__AYKA_WIDGET_LOADED__) return;
  window.__AYKA_WIDGET_LOADED__ = true;

  // ── Read config from script tag ──
  const scriptTag = document.currentScript || Array.from(document.querySelectorAll('script[data-business-id]')).find(s => {
    const src = s.getAttribute('src') || '';
    return src.includes('ayka-widget.js') || src.includes('/widget/embed/');
  }) || document.querySelector('script[data-business-id]');
  const BUSINESS_ID = scriptTag?.getAttribute('data-business-id');
  const API_URL = scriptTag?.getAttribute('data-api-url') || scriptTag?.src?.replace(/\/widget\/embed\/.*$/, '') || '';

  if (!BUSINESS_ID) {
    console.error('[AyKa Widget] Missing data-business-id attribute');
    return;
  }

  function safeJsonParse(raw, fallback) {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  // ── State ──
  let config = null;
  let visitorId = localStorage.getItem(`ayka_visitor_id_${BUSINESS_ID}`) || null;
  let messages = safeJsonParse(localStorage.getItem(`ayka_msgs_${BUSINESS_ID}`) || '[]', []);
  let isOpen = false;
  let isLoading = false;
  let visitorInfo = safeJsonParse(localStorage.getItem(`ayka_vinfo_${BUSINESS_ID}`) || '{}', {});
  let infoCollected = !!visitorInfo.name;
  let pendingRetryMessage = '';

  // ── Styles (injected into page) ──
  function injectStyles(theme) {
    const t = theme || {};
    const primary = t.primaryColor || '#0ea5e9';
    const headerBg = t.headerBg || '#0f172a';
    const headerText = t.headerText || '#ffffff';
    const chatBg = t.chatBg || '#f8fafc';
    const userBubble = t.userBubble || primary;
    const userText = t.userText || '#ffffff';
    const botBubble = t.botBubble || '#ffffff';
    const botText = t.botText || '#1e293b';
    const font = t.fontFamily || 'system-ui, -apple-system, sans-serif';
    const radius = t.borderRadius || '16px';
    const btnSize = t.buttonSize || '60px';

    const css = `
      .ayka-widget-btn {
        position: fixed; bottom: 20px; z-index: 99999;
        width: ${btnSize}; height: ${btnSize}; border-radius: 50%;
        background: ${primary}; color: #fff; border: none; cursor: pointer;
        box-shadow: 0 4px 24px rgba(0,0,0,0.25); display: flex; align-items: center;
        justify-content: center; transition: transform 0.2s, box-shadow 0.2s;
        font-family: ${font};
      }
      .ayka-widget-btn:hover { transform: scale(1.08); box-shadow: 0 6px 32px rgba(0,0,0,0.35); }
      .ayka-widget-btn.right { right: 20px; }
      .ayka-widget-btn.left { left: 20px; }
      .ayka-widget-btn svg { width: 28px; height: 28px; fill: #fff; }
      .ayka-widget-btn .ayka-close { display: none; }
      .ayka-widget-btn.open .ayka-chat-icon { display: none; }
      .ayka-widget-btn.open .ayka-close { display: block; }

      .ayka-widget-panel {
        position: fixed; bottom: 90px; z-index: 99998;
        width: 380px; max-width: calc(100vw - 32px); height: 560px; max-height: calc(100vh - 120px);
        border-radius: ${radius}; overflow: hidden;
        box-shadow: 0 8px 48px rgba(0,0,0,0.2); display: none; flex-direction: column;
        font-family: ${font}; font-size: 14px; line-height: 1.5;
      }
      .ayka-widget-panel.right { right: 20px; }
      .ayka-widget-panel.left { left: 20px; }
      .ayka-widget-panel.open { display: flex; animation: aykaSlideUp 0.3s ease; }

      @keyframes aykaSlideUp {
        from { opacity: 0; transform: translateY(16px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .ayka-header {
        background: ${headerBg}; color: ${headerText}; padding: 16px;
        display: flex; align-items: center; gap: 12px; flex-shrink: 0;
      }
      .ayka-header-avatar {
        width: 40px; height: 40px; border-radius: 50%; background: ${primary};
        display: flex; align-items: center; justify-content: center;
        font-weight: 700; font-size: 16px; flex-shrink: 0; overflow: hidden;
      }
      .ayka-header-avatar img { width: 100%; height: 100%; object-fit: cover; }
      .ayka-header-info h3 { margin: 0; font-size: 15px; font-weight: 600; }
      .ayka-header-info p { margin: 0; font-size: 11px; opacity: 0.7; }

      .ayka-messages {
        flex: 1; overflow-y: auto; padding: 16px; background: ${chatBg};
        display: flex; flex-direction: column; gap: 8px;
      }
      .ayka-messages::-webkit-scrollbar { width: 4px; }
      .ayka-messages::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 4px; }

      .ayka-msg { max-width: 80%; padding: 10px 14px; border-radius: 12px; word-wrap: break-word; white-space: pre-wrap; }
      .ayka-msg.user { align-self: flex-end; background: ${userBubble}; color: ${userText}; border-bottom-right-radius: 4px; }
      .ayka-msg.bot { align-self: flex-start; background: ${botBubble}; color: ${botText}; border-bottom-left-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
      .ayka-msg.typing { opacity: 0.6; font-style: italic; }

      .ayka-input-area {
        padding: 12px; background: #fff; border-top: 1px solid #e5e7eb;
        display: flex; gap: 8px; flex-shrink: 0;
      }
      .ayka-input-area input {
        flex: 1; border: 1px solid #e5e7eb; border-radius: 24px; padding: 10px 16px;
        font-size: 14px; outline: none; font-family: ${font}; background: #f9fafb;
        transition: border-color 0.2s;
      }
      .ayka-input-area input:focus { border-color: ${primary}; }
      .ayka-input-area button {
        width: 40px; height: 40px; border-radius: 50%; border: none;
        background: ${primary}; color: #fff; cursor: pointer; display: flex;
        align-items: center; justify-content: center; flex-shrink: 0;
        transition: opacity 0.2s;
      }
      .ayka-input-area button:disabled { opacity: 0.5; cursor: not-allowed; }
      .ayka-input-area button svg { width: 18px; height: 18px; fill: #fff; }
      .ayka-input-area .ayka-retry-btn {
        width: auto; min-width: 64px; padding: 0 10px; border-radius: 20px;
        background: #f59e0b; color: #fff; font-size: 12px; display: none;
      }
      .ayka-input-area .ayka-retry-btn.show { display: inline-flex; }

      .ayka-powered {
        padding: 6px; text-align: center; font-size: 10px; color: #94a3b8;
        background: #fff; border-top: 1px solid #f1f5f9;
      }
      .ayka-powered a { color: #64748b; text-decoration: none; }
      .ayka-powered a:hover { text-decoration: underline; }

      .ayka-info-form { padding: 20px; background: ${chatBg}; flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 12px; }
      .ayka-info-form label { font-size: 12px; color: #64748b; font-weight: 500; }
      .ayka-info-form input {
        width: 100%; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 12px;
        font-size: 14px; outline: none; font-family: ${font}; box-sizing: border-box;
      }
      .ayka-info-form input:focus { border-color: ${primary}; }
      .ayka-info-form button {
        width: 100%; padding: 10px; border-radius: 8px; border: none;
        background: ${primary}; color: #fff; font-size: 14px; font-weight: 600;
        cursor: pointer; font-family: ${font};
      }
      .ayka-info-form .ayka-skip { background: transparent; color: #94a3b8; font-weight: 400; font-size: 12px; }

      @media (max-width: 440px) {
        .ayka-widget-panel { width: calc(100vw - 16px); right: 8px !important; left: 8px !important; bottom: 80px; height: calc(100vh - 100px); }
        .ayka-widget-btn { bottom: 12px; }
        .ayka-widget-btn.right { right: 12px; }
        .ayka-widget-btn.left { left: 12px; }
      }
    `;

    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ── Icons ──
  const CHAT_ICON = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/><path d="M7 9h10v2H7zm0-3h10v2H7z"/></svg>';
  const CLOSE_ICON = '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
  const SEND_ICON = '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';

  function getSafeText(value, fallback = '') {
    return String(value ?? fallback);
  }

  function escapeAttr(value) {
    return getSafeText(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Build DOM ──
  function buildWidget() {
    const pos = config?.position === 'bottom-left' ? 'left' : 'right';
    const safeAgentName = getSafeText(config?.agentName || 'AI Assistant');
    const safeBrandName = getSafeText(config?.brandName || 'Online');
    const safePlaceholder = getSafeText(config?.placeholder || 'Type a message…');
    const safeAgentAvatar = getSafeText(config?.agentAvatar || '');

    // Floating button
    const btn = document.createElement('button');
    btn.className = `ayka-widget-btn ${pos}`;
    btn.innerHTML = `<span class="ayka-chat-icon">${CHAT_ICON}</span><span class="ayka-close">${CLOSE_ICON}</span>`;
    btn.onclick = toggleWidget;
    btn.setAttribute('aria-label', 'Chat with us');
    document.body.appendChild(btn);

    // Chat panel
    const panel = document.createElement('div');
    panel.className = `ayka-widget-panel ${pos}`;
    panel.innerHTML = `
      <div class="ayka-header">
        <div class="ayka-header-avatar">
          ${safeAgentAvatar
            ? `<img src="${escapeAttr(safeAgentAvatar)}" alt="${escapeAttr(safeAgentName)}" />`
            : safeAgentName.charAt(0).toUpperCase()}
        </div>
        <div class="ayka-header-info">
          <h3>${escapeHtml(safeAgentName)}</h3>
          <p>${escapeHtml(safeBrandName)}</p>
        </div>
      </div>
      <div class="ayka-messages" id="ayka-messages"></div>
      <div class="ayka-input-area" id="ayka-input-area">
        <input type="text" placeholder="${escapeAttr(safePlaceholder)}" id="ayka-input" autocomplete="off" />
        <button id="ayka-send" aria-label="Send">${SEND_ICON}</button>
        <button id="ayka-retry" class="ayka-retry-btn" aria-label="Retry">Retry</button>
      </div>
      ${config?.poweredBy !== false ? '<div class="ayka-powered">Powered by <a href="https://ayka.in" target="_blank" rel="noopener">AyKa AI</a></div>' : ''}
    `;
    document.body.appendChild(panel);

    // Events
    document.getElementById('ayka-send').onclick = sendMessage;
    document.getElementById('ayka-retry').onclick = retryLastMessage;
    document.getElementById('ayka-input').onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    };

    // Render existing messages
    renderMessages();

    // Show info collection form if needed
    if (!infoCollected && (config?.collectName || config?.collectPhone || config?.collectEmail)) {
      showInfoForm();
    }

    // Auto-show welcome message
    if (messages.length === 0 && config?.welcomeMessage) {
      messages.push({ role: 'bot', text: config.welcomeMessage, time: Date.now() });
      saveMessages();
      renderMessages();
    }
  }

  function setRetryVisibility(show) {
    const retryBtn = document.getElementById('ayka-retry');
    if (!retryBtn) return;
    retryBtn.classList.toggle('show', !!show);
  }

  async function retryLastMessage() {
    if (!pendingRetryMessage || isLoading) return;
    const input = document.getElementById('ayka-input');
    if (input) input.value = pendingRetryMessage;
    await sendMessage();
  }

  function toggleWidget() {
    isOpen = !isOpen;
    const btn = document.querySelector('.ayka-widget-btn');
    const panel = document.querySelector('.ayka-widget-panel');
    if (isOpen) {
      btn.classList.add('open');
      panel.classList.add('open');
      document.getElementById('ayka-input')?.focus();
      scrollToBottom();
    } else {
      btn.classList.remove('open');
      panel.classList.remove('open');
    }
  }

  function renderMessages() {
    const container = document.getElementById('ayka-messages');
    if (!container) return;
    container.innerHTML = messages.map(m =>
      `<div class="ayka-msg ${m.role === 'user' ? 'user' : 'bot'}">${escapeHtml(m.text)}</div>`
    ).join('');
    scrollToBottom();
  }

  function scrollToBottom() {
    const container = document.getElementById('ayka-messages');
    if (container) setTimeout(() => { container.scrollTop = container.scrollHeight; }, 50);
  }

  function showInfoForm() {
    const container = document.getElementById('ayka-messages');
    if (!container) return;
    let fields = '';
    if (config?.collectName !== false) fields += '<label>Your Name</label><input type="text" id="ayka-info-name" placeholder="Enter your name" />';
    if (config?.collectPhone) fields += '<label>Phone Number</label><input type="tel" id="ayka-info-phone" placeholder="+91 XXXXX XXXXX" />';
    if (config?.collectEmail) fields += '<label>Email</label><input type="email" id="ayka-info-email" placeholder="your@email.com" />';

    container.innerHTML = `
      <div class="ayka-info-form">
        <div style="text-align:center;margin-bottom:8px;">
          <strong style="font-size:16px;">Welcome! 👋</strong>
          <p style="font-size:13px;color:#64748b;margin:4px 0 0;">Tell us a bit about yourself to get started</p>
        </div>
        ${fields}
        <button id="ayka-info-submit">Start Chat</button>
        <button class="ayka-skip" id="ayka-info-skip">Skip - chat anonymously</button>
      </div>
    `;

    document.getElementById('ayka-info-submit').onclick = () => {
      visitorInfo = {
        name:  document.getElementById('ayka-info-name')?.value?.trim() || '',
        phone: document.getElementById('ayka-info-phone')?.value?.trim() || '',
        email: document.getElementById('ayka-info-email')?.value?.trim() || '',
      };
      infoCollected = true;
      localStorage.setItem(`ayka_vinfo_${BUSINESS_ID}`, JSON.stringify(visitorInfo));
      renderMessages();
    };
    document.getElementById('ayka-info-skip').onclick = () => {
      infoCollected = true;
      renderMessages();
    };
  }

  async function sendMessage() {
    const input = document.getElementById('ayka-input');
    const text = input?.value?.trim();
    if (!text || isLoading) return;
    setRetryVisibility(false);

    input.value = '';
    messages.push({ role: 'user', text, time: Date.now() });
    saveMessages();
    renderMessages();

    // Show typing indicator
    isLoading = true;
    const container = document.getElementById('ayka-messages');
    const typing = document.createElement('div');
    typing.className = 'ayka-msg bot typing';
    typing.textContent = 'Typing…';
    container.appendChild(typing);
    scrollToBottom();
    document.getElementById('ayka-send').disabled = true;

    try {
      const resp = await fetch(`${API_URL}/widget/message`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: BUSINESS_ID,
          message: text,
          visitorInfo: infoCollected ? visitorInfo : {},
        }),
      });

      const data = await resp.json();

      if (resp.ok && data.response) {
        messages.push({ role: 'bot', text: data.response, time: Date.now() });
        pendingRetryMessage = '';
        setRetryVisibility(false);
      } else {
        pendingRetryMessage = text;
        setRetryVisibility(true);
        messages.push({ role: 'bot', text: data.error || 'Message failed. Please retry.', time: Date.now() });
      }
    } catch (err) {
      pendingRetryMessage = text;
      setRetryVisibility(true);
      messages.push({ role: 'bot', text: 'Unable to connect. Please check your internet and click Retry.', time: Date.now() });
    }

    isLoading = false;
    document.getElementById('ayka-send').disabled = false;
    saveMessages();
    renderMessages();
  }

  function saveMessages() {
    // Keep last 50 messages in localStorage
    const toSave = messages.slice(-50);
    try { localStorage.setItem(`ayka_msgs_${BUSINESS_ID}`, JSON.stringify(toSave)); } catch {}
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ── Initialize ──
  async function init() {
    try {
      // 1. Fetch widget config
      const configResp = await fetch(`${API_URL}/widget/config/${BUSINESS_ID}`, {
        credentials: 'include',
      });
      if (!configResp.ok) {
        console.error('[AyKa Widget] Failed to load config:', configResp.status);
        return;
      }
      config = await configResp.json();

      // 2. Get or create visitor ID
      if (!visitorId) {
        const initResp = await fetch(`${API_URL}/widget/init`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ businessId: BUSINESS_ID }),
        });
        if (!initResp.ok) {
          const initErr = await initResp.json().catch(() => ({}));
          throw new Error(initErr.error || 'Widget initialization failed');
        }
        const initData = await initResp.json();
        visitorId = initData?.visitorId || null;
        if (visitorId) localStorage.setItem(`ayka_visitor_id_${BUSINESS_ID}`, visitorId);
      }

      // 3. Inject styles and build DOM
      injectStyles(config.theme);
      buildWidget();

    } catch (err) {
      console.error('[AyKa Widget] Initialization failed:', err);
      messages.push({ role: 'bot', text: 'Chat is temporarily unavailable. Please refresh and try again.', time: Date.now() });
      saveMessages();
    }
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
