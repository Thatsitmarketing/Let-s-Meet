/* That's it. Tool Menü, liegt als Datei im jeweiligen Tool (Quelle: Repo thatsit-hub).
 * <script src="/thatsit-switcher.js" defer></script>
 * <thatsit-switcher app="seo"></thatsit-switcher>
 * Klick auf ein Tool ruft im eigenen Tool /auth/switch?to=<id> auf. Dort entsteht das Token für den Wechsel. */
(function () {
  if (customElements.get('thatsit-switcher')) return;
  var APPS = [{"id":"projekte","name":"Projekte","icon":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0OCA0OCIgd2lkdGg9Ijk2IiBoZWlnaHQ9Ijk2IiByb2xlPSJpbWciPjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgZmlsbD0iIzFCMUIxQiIvPjxyZWN0IHg9IjgiIHk9IjEwIiB3aWR0aD0iOCIgaGVpZ2h0PSIxMCIgZmlsbD0iI0M5QTIzQSIvPjxyZWN0IHg9IjgiIHk9IjI0IiB3aWR0aD0iOCIgaGVpZ2h0PSI2IiBmaWxsPSIjQzlBMjNBIi8+PHJlY3QgeD0iMjAiIHk9IjEwIiB3aWR0aD0iOCIgaGVpZ2h0PSI2IiBmaWxsPSIjQzlBMjNBIi8+PHJlY3QgeD0iMjAiIHk9IjIwIiB3aWR0aD0iOCIgaGVpZ2h0PSIxMCIgZmlsbD0iI0RDOTgzMyIvPjxyZWN0IHg9IjIwIiB5PSIzNCIgd2lkdGg9IjgiIGhlaWdodD0iNiIgZmlsbD0iI0M5QTIzQSIvPjxyZWN0IHg9IjMyIiB5PSIxMCIgd2lkdGg9IjgiIGhlaWdodD0iMTQiIGZpbGw9IiNDOUEyM0EiLz48cmVjdCB4PSIzMiIgeT0iMjgiIHdpZHRoPSI4IiBoZWlnaHQ9IjEwIiBmaWxsPSIjQzlBMjNBIi8+PC9zdmc+"},{"id":"meet","name":"Let's Meet","icon":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0OCA0OCIgd2lkdGg9Ijk2IiBoZWlnaHQ9Ijk2IiByb2xlPSJpbWciPjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgZmlsbD0iIzFCMUIxQiIvPjxyZWN0IHg9IjgiIHk9IjgiIHdpZHRoPSIzMiIgaGVpZ2h0PSI2IiBmaWxsPSIjQzlBMjNBIi8+PHJlY3QgeD0iMTAiIHk9IjE5IiB3aWR0aD0iNiIgaGVpZ2h0PSI2IiBmaWxsPSIjQzlBMjNBIi8+PHJlY3QgeD0iMjEiIHk9IjE5IiB3aWR0aD0iNiIgaGVpZ2h0PSI2IiBmaWxsPSIjQzlBMjNBIi8+PHJlY3QgeD0iMzIiIHk9IjE5IiB3aWR0aD0iNiIgaGVpZ2h0PSI2IiBmaWxsPSIjQzlBMjNBIi8+PHJlY3QgeD0iMTAiIHk9IjI4IiB3aWR0aD0iNiIgaGVpZ2h0PSI2IiBmaWxsPSIjQzlBMjNBIi8+PHJlY3QgeD0iMjEiIHk9IjI4IiB3aWR0aD0iNiIgaGVpZ2h0PSI2IiBmaWxsPSIjREM5ODMzIi8+PHJlY3QgeD0iMzIiIHk9IjI4IiB3aWR0aD0iNiIgaGVpZ2h0PSI2IiBmaWxsPSIjQzlBMjNBIi8+PHJlY3QgeD0iMTAiIHk9IjM3IiB3aWR0aD0iNiIgaGVpZ2h0PSI2IiBmaWxsPSIjQzlBMjNBIi8+PHJlY3QgeD0iMjEiIHk9IjM3IiB3aWR0aD0iNiIgaGVpZ2h0PSI2IiBmaWxsPSIjQzlBMjNBIi8+PHJlY3QgeD0iMzIiIHk9IjM3IiB3aWR0aD0iNiIgaGVpZ2h0PSI2IiBmaWxsPSIjQzlBMjNBIi8+PC9zdmc+"},{"id":"sales-helper","name":"Sales Helper","icon":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0OCA0OCIgd2lkdGg9Ijk2IiBoZWlnaHQ9Ijk2IiByb2xlPSJpbWciPjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgZmlsbD0iIzFCMUIxQiIvPjxyZWN0IHg9IjgiIHk9IjgiIHdpZHRoPSIzMiIgaGVpZ2h0PSIyNSIgZmlsbD0iI0M5QTIzQSIvPjxwb2x5Z29uIHBvaW50cz0iMTQsMzMgMTQsNDEgMjMsMzMiIGZpbGw9IiNDOUEyM0EiLz48cmVjdCB4PSIxNCIgeT0iMTgiIHdpZHRoPSI0IiBoZWlnaHQ9IjYiIGZpbGw9IiMxQjFCMUIiLz48cmVjdCB4PSIyMCIgeT0iMTMiIHdpZHRoPSI0IiBoZWlnaHQ9IjE2IiBmaWxsPSIjMUIxQjFCIi8+PHJlY3QgeD0iMjYiIHk9IjE2IiB3aWR0aD0iNCIgaGVpZ2h0PSIxMCIgZmlsbD0iI0RDOTgzMyIvPjxyZWN0IHg9IjMyIiB5PSIxOSIgd2lkdGg9IjQiIGhlaWdodD0iNCIgZmlsbD0iIzFCMUIxQiIvPjwvc3ZnPg=="},{"id":"seo","name":"SEO","icon":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0OCA0OCIgd2lkdGg9Ijk2IiBoZWlnaHQ9Ijk2IiByb2xlPSJpbWciPjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgZmlsbD0iIzFCMUIxQiIvPjxyZWN0IHg9IjgiIHk9IjgiIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgZmlsbD0iI0M5QTIzQSIvPjxyZWN0IHg9IjEzIiB5PSIxMyIgd2lkdGg9IjE0IiBoZWlnaHQ9IjE0IiBmaWxsPSIjMUIxQjFCIi8+PHJlY3QgeD0iMTYiIHk9IjIxIiB3aWR0aD0iMyIgaGVpZ2h0PSI2IiBmaWxsPSIjREM5ODMzIi8+PHJlY3QgeD0iMjEiIHk9IjE3IiB3aWR0aD0iMyIgaGVpZ2h0PSIxMCIgZmlsbD0iI0RDOTgzMyIvPjxwb2x5Z29uIHBvaW50cz0iMzAsMzQgMzQsMzAgNDIsMzggMzgsNDIiIGZpbGw9IiNDOUEyM0EiLz48L3N2Zz4="},{"id":"crm","name":"Close","icon":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0OCA0OCIgd2lkdGg9Ijk2IiBoZWlnaHQ9Ijk2IiByb2xlPSJpbWciPjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgZmlsbD0iIzFCMUIxQiIvPjxyZWN0IHg9IjgiIHk9IjgiIHdpZHRoPSIzMiIgaGVpZ2h0PSI3IiBmaWxsPSIjQzlBMjNBIi8+PHJlY3QgeD0iMTIiIHk9IjE4IiB3aWR0aD0iMjQiIGhlaWdodD0iNyIgZmlsbD0iI0M5QTIzQSIvPjxyZWN0IHg9IjE2IiB5PSIyOCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjciIGZpbGw9IiNDOUEyM0EiLz48cmVjdCB4PSIyMCIgeT0iMzgiIHdpZHRoPSI4IiBoZWlnaHQ9IjUiIGZpbGw9IiNEQzk4MzMiLz48L3N2Zz4="},{"id":"scraper","name":"Lead Scraper","icon":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0OCA0OCIgd2lkdGg9Ijk2IiBoZWlnaHQ9Ijk2IiByb2xlPSJpbWciPjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgZmlsbD0iIzFCMUIxQiIvPjxyZWN0IHg9IjkiIHk9IjkiIHdpZHRoPSIzMCIgaGVpZ2h0PSIzMCIgZmlsbD0iI0M5QTIzQSIvPjxyZWN0IHg9IjEzIiB5PSIxMyIgd2lkdGg9IjIyIiBoZWlnaHQ9IjIyIiBmaWxsPSIjMUIxQjFCIi8+PHJlY3QgeD0iMTciIHk9IjE3IiB3aWR0aD0iMTQiIGhlaWdodD0iMTQiIGZpbGw9IiNDOUEyM0EiLz48cmVjdCB4PSIyMSIgeT0iMjEiIHdpZHRoPSI2IiBoZWlnaHQ9IjYiIGZpbGw9IiMxQjFCMUIiLz48cmVjdCB4PSIyMiIgeT0iMjIiIHdpZHRoPSI0IiBoZWlnaHQ9IjQiIGZpbGw9IiNEQzk4MzMiLz48cmVjdCB4PSIyMiIgeT0iMiIgd2lkdGg9IjQiIGhlaWdodD0iNiIgZmlsbD0iI0RDOTgzMyIvPjxyZWN0IHg9IjIyIiB5PSI0MCIgd2lkdGg9IjQiIGhlaWdodD0iNiIgZmlsbD0iI0RDOTgzMyIvPjxyZWN0IHg9IjIiIHk9IjIyIiB3aWR0aD0iNiIgaGVpZ2h0PSI0IiBmaWxsPSIjREM5ODMzIi8+PHJlY3QgeD0iNDAiIHk9IjIyIiB3aWR0aD0iNiIgaGVpZ2h0PSI0IiBmaWxsPSIjREM5ODMzIi8+PC9zdmc+"},{"id":"mail","name":"Mail","icon":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0OCA0OCIgd2lkdGg9Ijk2IiBoZWlnaHQ9Ijk2IiByb2xlPSJpbWciPjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgZmlsbD0iIzFCMUIxQiIvPjxyZWN0IHg9IjgiIHk9IjEyIiB3aWR0aD0iMzIiIGhlaWdodD0iMjQiIGZpbGw9IiNDOUEyM0EiLz48cmVjdCB4PSIxMyIgeT0iMTciIHdpZHRoPSIyMiIgaGVpZ2h0PSIxNCIgZmlsbD0iIzFCMUIxQiIvPjxyZWN0IHg9IjE0IiB5PSIxOSIgd2lkdGg9IjUiIGhlaWdodD0iNSIgZmlsbD0iI0RDOTgzMyIvPjxyZWN0IHg9IjIxIiB5PSIyMiIgd2lkdGg9IjYiIGhlaWdodD0iNiIgZmlsbD0iI0RDOTgzMyIvPjxyZWN0IHg9IjI5IiB5PSIxOSIgd2lkdGg9IjUiIGhlaWdodD0iNSIgZmlsbD0iI0RDOTgzMyIvPjwvc3ZnPg=="}];
  var GRID = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22" width="22" height="22" aria-hidden="true"><rect x="0" y="0" width="6" height="6" fill="#DC9833"/><rect x="8" y="0" width="6" height="6" fill="#DC9833"/><rect x="16" y="0" width="6" height="6" fill="#DC9833"/><rect x="0" y="8" width="6" height="6" fill="#DC9833"/><rect x="8" y="8" width="6" height="6" fill="#DC9833"/><rect x="16" y="8" width="6" height="6" fill="#DC9833"/><rect x="0" y="16" width="6" height="6" fill="#DC9833"/><rect x="8" y="16" width="6" height="6" fill="#DC9833"/><rect x="16" y="16" width="6" height="6" fill="#DC9833"/></svg>';
  var CSS = [
    ':host{display:inline-block;position:relative;font:14px/1.4 system-ui,-apple-system,Segoe UI,sans-serif}',
    '*{box-sizing:border-box;border-radius:0}',
    'button.t{display:grid;place-items:center;width:40px;height:40px;padding:0;border:0;background:transparent;cursor:pointer}',
    'button.t:hover,button.t[aria-expanded=true]{background:rgba(220,152,51,.18)}',
    'button:focus-visible,a:focus-visible{outline:2px solid #C9A23A;outline-offset:2px}',
    '.p{position:absolute;right:0;top:46px;z-index:2147483000;width:312px;max-width:calc(100vw - 16px);background:#1B1B1B;color:#F2EFE8;padding:16px;box-shadow:0 8px 32px rgba(0,0,0,.5)}',
    '.p[hidden]{display:none}',
    ':host([align=left]) .p{left:0;right:auto}',
    '.h{margin:0 0 12px;color:#C9A23A;font-weight:700;display:flex;align-items:center;gap:8px}',
    '.h::before{content:"";width:8px;height:8px;background:#DC9833}',
    '.g{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}',
    'a.a{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 4px;color:inherit;text-decoration:none;background:#242424}',
    'a.a:hover{background:#2f2f2f}',
    'a.a img{width:44px;height:44px;display:block}',
    'a.a span{font-size:12px;text-align:center}',
    'a.a.cur{cursor:default}',
    'a.a.cur::after{content:"";position:absolute;top:6px;right:6px;width:7px;height:7px;background:#DC9833}'
  ].join('');
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function Switcher() { return Reflect.construct(HTMLElement, [], Switcher); }
  Switcher.prototype = Object.create(HTMLElement.prototype);
  Switcher.prototype.constructor = Switcher;
  Object.setPrototypeOf(Switcher, HTMLElement);

  Switcher.prototype.connectedCallback = function () {
    var self = this;
    var root = this.shadowRoot || this.attachShadow({ mode: 'open' });
    var current = this.getAttribute('app') || '';
    var base = this.getAttribute('base') || '/auth/switch';
    root.innerHTML =
      '<style>' + CSS + '</style>' +
      '<button class="t" type="button" aria-label="Tools wechseln" aria-haspopup="true" aria-expanded="false">' + GRID + '</button>' +
      '<div class="p" role="menu" hidden><p class="h">Meine Tools</p><div class="g">' +
      APPS.map(function (a) {
        var cur = a.id === current;
        return '<a class="a' + (cur ? ' cur' : '') + '" role="menuitem" href="' + (cur ? '#' : esc(base) + '?to=' + esc(a.id)) + '"' + (cur ? ' aria-current="page"' : '') + '><img src="' + a.icon + '" alt=""><span>' + esc(a.name) + '</span></a>';
      }).join('') + '</div></div>';
    var btn = root.querySelector('button.t');
    var panel = root.querySelector('.p');
    // Optional: align="left" öffnet das Fenster linksbündig (schmale Seitenleiste), popup="fixed" legt es über die Seite,
    // damit eine scrollende Seitenleiste (overflow) es nicht abschneidet. Ohne Attribute wie bisher.
    var fixedPopup = this.getAttribute('popup') === 'fixed';
    function place() {
      var r = btn.getBoundingClientRect(), w = panel.offsetWidth, h = panel.offsetHeight;
      var left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
      var top = r.bottom + 6 + h > window.innerHeight - 8 ? Math.max(8, r.top - 6 - h) : r.bottom + 6;
      panel.style.position = 'fixed'; panel.style.right = 'auto';
      panel.style.left = left + 'px'; panel.style.top = top + 'px';
    }
    function setOpen(open) { panel.hidden = !open; btn.setAttribute('aria-expanded', String(open)); if (open && fixedPopup) place(); }
    if (fixedPopup) window.addEventListener('resize', function () { if (!panel.hidden) place(); });
    btn.addEventListener('click', function (e) { e.stopPropagation(); setOpen(panel.hidden); });
    document.addEventListener('click', function (e) { if (!self.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) { setOpen(false); btn.focus(); } });
  };
  customElements.define('thatsit-switcher', Switcher);
})();
