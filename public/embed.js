/*!
 * Let's Meet Widget von That's it. Marketing
 * Einbinden: <script src="https://letsmeet.thatsit.marketing/embed.js" async></script>
 *
 * Inline:      <div class="letsmeet-inline-widget" data-url="https://letsmeet.thatsit.marketing/erstgespraech"></div>
 * Popup Link:  <a href="#" data-letsmeet-popup="https://letsmeet.thatsit.marketing/erstgespraech">Termin buchen</a>
 * Per Code:    LetsMeet.initBadgeWidget({ url, text: 'Termin buchen', farbe: 'orange' })
 *              LetsMeet.showPopupWidget(url) / LetsMeet.closePopupWidget()
 * Ereignis:    window.addEventListener('letsmeet:gebucht', (e) => console.log(e.detail))
 */
(function () {
  'use strict';
  if (window.LetsMeet && window.LetsMeet.__geladen) return;

  var skript = document.currentScript;
  var HERKUNFT = (function () {
    try {
      return new URL(skript && skript.src ? skript.src : location.href).origin;
    } catch (e) {
      return location.origin;
    }
  })();

  var CSS =
    '.lm-inline{position:relative;width:100%;min-height:320px}' +
    '.lm-inline iframe,.lm-popup iframe{display:block;width:100%;border:0;background:transparent}' +
    '.lm-laden{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:10px;font:500 13px/1 "Barlow Condensed",Arial,sans-serif;letter-spacing:.25em;text-transform:uppercase;color:#4A4A4A;pointer-events:none}' +
    '.lm-laden::before{content:"";width:10px;height:10px;background:#DC9832;animation:lm-puls 1s ease-in-out infinite}' +
    '@keyframes lm-puls{50%{opacity:.25}}' +
    '.lm-overlay{position:fixed;inset:0;z-index:2147483646;background:rgba(14,14,14,.72);display:flex;align-items:center;justify-content:center;padding:24px;opacity:0;transition:opacity .2s cubic-bezier(.2,.7,.2,1)}' +
    '.lm-overlay.lm-offen{opacity:1}' +
    '.lm-popup{position:relative;width:100%;max-width:1060px;height:min(90vh,760px);background:#fff;box-shadow:0 12px 32px rgba(14,14,14,.24);overflow:auto;-webkit-overflow-scrolling:touch}' +
    '.lm-popup iframe{height:100%;min-height:100%}' +
    '.lm-zu{position:absolute;top:0;right:0;z-index:2;width:44px;height:44px;border:0;background:#0E0E0E;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center}' +
    '.lm-zu:hover{opacity:.88}.lm-zu:focus-visible{outline:2px solid #DC9832;outline-offset:2px}' +
    '.lm-badge{position:fixed;right:20px;bottom:20px;z-index:2147483645;display:inline-flex;align-items:center;gap:10px;min-height:48px;padding:12px 20px;border:2px solid #DC9832;background:#DC9832;color:#0E0E0E;font:500 13px/1.1 "Barlow Condensed","Helvetica Neue",Arial,sans-serif;letter-spacing:.25em;text-transform:uppercase;cursor:pointer;box-shadow:0 6px 18px rgba(220,152,50,.32)}' +
    '.lm-badge.lm-schwarz{background:#0E0E0E;border-color:#0E0E0E;color:#fff;box-shadow:0 4px 12px rgba(14,14,14,.2)}' +
    '.lm-badge:hover{opacity:.88}.lm-badge:focus-visible{outline:2px solid #0E0E0E;outline-offset:3px}' +
    '.lm-badge::before{content:"";width:8px;height:8px;background:currentColor}' +
    '.lm-badge.lm-schwarz::before{background:#DC9832}' +
    '@media (max-width:640px){.lm-overlay{padding:0}.lm-popup{height:100%;max-width:none}.lm-badge{right:12px;bottom:12px}}' +
    '@media (prefers-reduced-motion:reduce){.lm-overlay{transition:none}.lm-laden::before{animation:none}}';

  function stile() {
    if (document.getElementById('lm-stile')) return;
    var s = document.createElement('style');
    s.id = 'lm-stile';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function adresse(url, prefill) {
    var u = new URL(url, HERKUNFT);
    u.searchParams.set('embed', '1');
    if (prefill) {
      if (prefill.name) u.searchParams.set('name', prefill.name);
      if (prefill.email) u.searchParams.set('email', prefill.email);
    }
    return u.toString();
  }

  function rahmen(url, titel) {
    var f = document.createElement('iframe');
    f.src = url;
    f.title = titel || 'Termin buchen';
    f.setAttribute('loading', 'lazy');
    f.setAttribute('allow', 'payment');
    return f;
  }

  function initInlineWidget(o) {
    if (!o || !o.url || !o.parentElement) return;
    stile();
    var el = o.parentElement;
    if (el.__lm) return;
    el.__lm = true;
    el.classList.add('lm-inline');
    var laden = document.createElement('div');
    laden.className = 'lm-laden';
    laden.textContent = 'Lädt';
    var f = rahmen(adresse(o.url, o.prefill), 'Termin buchen');
    f.style.height = (o.hoehe || el.getAttribute('data-hoehe') || 700) + 'px';
    f.addEventListener('load', function () {
      laden.remove();
    });
    el.appendChild(laden);
    el.appendChild(f);
  }

  var overlay = null;
  var vorherFokus = null;

  function closePopupWidget() {
    if (!overlay) return;
    var o = overlay;
    overlay = null;
    o.classList.remove('lm-offen');
    document.documentElement.style.overflow = '';
    document.removeEventListener('keydown', taste);
    setTimeout(function () {
      o.remove();
    }, 200);
    if (vorherFokus && vorherFokus.focus) vorherFokus.focus();
  }

  function taste(e) {
    if (e.key === 'Escape') closePopupWidget();
  }

  function showPopupWidget(url, prefill) {
    if (!url) return;
    stile();
    closePopupWidget();
    vorherFokus = document.activeElement;
    overlay = document.createElement('div');
    overlay.className = 'lm-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Termin buchen');
    var box = document.createElement('div');
    box.className = 'lm-popup';
    var zu = document.createElement('button');
    zu.type = 'button';
    zu.className = 'lm-zu';
    zu.setAttribute('aria-label', 'Schließen');
    zu.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
    zu.addEventListener('click', closePopupWidget);
    var laden = document.createElement('div');
    laden.className = 'lm-laden';
    laden.textContent = 'Lädt';
    var f = rahmen(adresse(url, prefill), 'Termin buchen');
    f.addEventListener('load', function () {
      laden.remove();
    });
    box.appendChild(zu);
    box.appendChild(laden);
    box.appendChild(f);
    overlay.appendChild(box);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closePopupWidget();
    });
    document.body.appendChild(overlay);
    document.documentElement.style.overflow = 'hidden';
    document.addEventListener('keydown', taste);
    requestAnimationFrame(function () {
      if (overlay) overlay.classList.add('lm-offen');
    });
    zu.focus();
  }

  function initPopupWidget(o) {
    if (o && o.url) showPopupWidget(o.url, o.prefill);
  }

  function initBadgeWidget(o) {
    if (!o || !o.url) return;
    stile();
    var alt = document.querySelector('.lm-badge');
    if (alt) alt.remove();
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'lm-badge' + (o.farbe === 'schwarz' ? ' lm-schwarz' : '');
    b.textContent = o.text || 'Termin buchen';
    b.addEventListener('click', function () {
      showPopupWidget(o.url, o.prefill);
    });
    document.body.appendChild(b);
  }

  // Nachrichten aus dem iframe: Höhe anpassen und Buchung melden
  window.addEventListener('message', function (e) {
    if (e.origin !== HERKUNFT || !e.data || typeof e.data.typ !== 'string') return;
    if (e.data.typ === 'letsmeet:hoehe') {
      var frames = document.querySelectorAll('.lm-inline iframe');
      for (var i = 0; i < frames.length; i++) {
        if (frames[i].contentWindow === e.source) frames[i].style.height = Math.max(320, Number(e.data.hoehe) || 0) + 'px';
      }
    }
    if (e.data.typ === 'letsmeet:gebucht') {
      var detail = { buchung: e.data.buchung, start: e.data.start };
      window.dispatchEvent(new CustomEvent('letsmeet:gebucht', { detail: detail }));
      if (Array.isArray(window.dataLayer)) window.dataLayer.push({ event: 'letsmeet_gebucht', letsmeet_buchung: detail.buchung });
    }
  });

  function autoStart() {
    var inline = document.querySelectorAll('.letsmeet-inline-widget[data-url]');
    for (var i = 0; i < inline.length; i++) {
      initInlineWidget({ url: inline[i].getAttribute('data-url'), parentElement: inline[i] });
    }
  }

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('[data-letsmeet-popup]') : null;
    if (!a) return;
    e.preventDefault();
    showPopupWidget(a.getAttribute('data-letsmeet-popup'));
  });

  window.LetsMeet = {
    __geladen: true,
    initInlineWidget: initInlineWidget,
    initPopupWidget: initPopupWidget,
    showPopupWidget: showPopupWidget,
    closePopupWidget: closePopupWidget,
    initBadgeWidget: initBadgeWidget,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoStart);
  else autoStart();
})();
