/* Graphics110 reading site: rail, progress, citations, figures, code, reader notes, keyboard. No dependencies. */
(function () {
  'use strict';
  var doc = document, root = doc.documentElement, body = doc.body;
  var CELLS = 28;
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  };
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var narrow = function () { return window.matchMedia && matchMedia('(max-width: 900px)').matches; };

  /* ── theme: system / light / dark ─────────────────── */
  var themeBtn = doc.querySelector('.theme-btn');
  var MODES = ['system', 'light', 'dark'];
  function applyTheme(mode) {
    if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode);
    else root.removeAttribute('data-theme');
    if (themeBtn) {
      var labels = {};
      try { labels = JSON.parse(themeBtn.getAttribute('data-labels')) || {}; } catch (e) { /* keep defaults */ }
      themeBtn.querySelector('.tx').textContent = labels[mode] || mode;
      themeBtn.setAttribute('aria-label', 'Theme: ' + mode);
    }
  }
  function currentTheme() { var m = store.get('g110-theme'); return MODES.indexOf(m) >= 0 ? m : 'system'; }
  function cycleTheme() {
    var next = MODES[(MODES.indexOf(currentTheme()) + 1) % MODES.length];
    store.set('g110-theme', next);
    applyTheme(next);
  }
  applyTheme(currentTheme());
  if (themeBtn) themeBtn.addEventListener('click', cycleTheme);

  /* ── rail: active part and progress ───────────────── */
  var treeLinks = [].slice.call(doc.querySelectorAll('.tree a[data-id]'));
  var targets = treeLinks.map(function (a) { return doc.getElementById(a.getAttribute('data-id')); });
  var parts = treeLinks.filter(function (a) { return a.classList.contains('d2'); })
    .map(function (a) { return doc.getElementById(a.getAttribute('data-id')); }).filter(Boolean);
  var progB = doc.querySelector('.prog b'), progRest = doc.querySelector('.prog .rest'), progPct = doc.querySelector('.prog .pct');
  var tbPct = doc.querySelector('.tb-pct');
  var activeId = null;
  function offset() { return narrow() ? 60 : 24; }
  function update() {
    var max = Math.max(1, root.scrollHeight - innerHeight);
    var f = Math.min(1, Math.max(0, scrollY / max));
    var filled = Math.round(f * CELLS);
    var pct = Math.round(f * 100) + '%';
    if (progB) { progB.textContent = new Array(filled + 1).join('▓'); progRest.textContent = new Array(CELLS - filled + 1).join('░'); progPct.textContent = pct; }
    if (tbPct) tbPct.textContent = pct;
    var line = offset() + 100, current = -1; // the heading nearest above this line is the active one
    for (var i = 0; i < targets.length; i++) {
      if (targets[i] && targets[i].getBoundingClientRect().top <= line) current = i;
    }
    if (f >= 0.999 && targets.length) {
      for (var j = targets.length - 1; j >= 0; j--) if (targets[j]) { var r = targets[j].getBoundingClientRect(); if (r.top < innerHeight) { current = Math.max(current, j); break; } }
    }
    var id = current >= 0 ? treeLinks[current].getAttribute('data-id') : null;
    if (id !== activeId) {
      activeId = id;
      treeLinks.forEach(function (a, k) { a.classList.toggle('on', k === current); if (k === current) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); });
      var on = treeLinks[current], tree = doc.querySelector('.tree');
      if (on && tree && tree.scrollHeight > tree.clientHeight) {
        var rt = tree.getBoundingClientRect(), ot = on.getBoundingClientRect();
        if (ot.top < rt.top + 24 || ot.bottom > rt.bottom - 24) tree.scrollTop += ot.top - rt.top - rt.height / 2;
      }
    }
  }
  var ticking = false;
  function onScroll() {
    if (!ticking) { ticking = true; requestAnimationFrame(function () { ticking = false; update(); }); }
    saveScrollSoon();
  }
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);

  /* ── drawer under 900px ───────────────────────────── */
  var toggle = doc.querySelector('.tb-toggle');
  function setDrawer(open) {
    body.classList.toggle('rail-open', open);
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  if (toggle) toggle.addEventListener('click', function (e) { e.stopPropagation(); setDrawer(!body.classList.contains('rail-open')); });
  doc.addEventListener('click', function (e) {
    if (!body.classList.contains('rail-open')) return;
    if (e.target.closest('.tree a, .topic-links a, .langs a, .notes-list a') || !e.target.closest('.rail')) setDrawer(false);
  });

  /* ── language switch keeps the place ──────────────── */
  var langLink = doc.querySelector('a[data-lang-switch]');
  function langHref() {
    var base = langLink.getAttribute('href').split('#')[0];
    var hash = activeId ? '#' + activeId : location.hash;
    return base + (hash || '');
  }
  if (langLink) langLink.addEventListener('click', function () { langLink.setAttribute('href', langHref()); });

  /* ── scroll memory ─────────────────────────────────── */
  var KEY = 'g110-scroll:' + location.pathname;
  var saveTimer = null;
  function saveScrollSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(function () { store.set(KEY, String(Math.round(scrollY))); }, 250); }
  if (!location.hash) {
    var saved = parseInt(store.get(KEY), 10);
    if (saved > 0) {
      if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
      var restore = function () { window.scrollTo({ top: saved, behavior: 'instant' in root.style ? 'instant' : 'auto' }); };
      restore();
      addEventListener('load', restore);
    }
  }

  /* ── citation popovers ─────────────────────────────── */
  var pop = null, popFor = null;
  function closePop() { if (pop) { pop.remove(); pop = null; } if (popFor) popFor.classList.remove('open'); popFor = null; }
  function openPop(a) {
    if (popFor === a) return;
    closePop();
    var ref = doc.getElementById('ref-' + a.getAttribute('data-ref'));
    if (!ref) return;
    pop = doc.createElement('div');
    pop.className = 'pop';
    pop.setAttribute('role', 'tooltip');
    pop.id = 'pop-current';
    var n = doc.createElement('span');
    n.className = 'pop-n';
    n.textContent = '[' + a.getAttribute('data-ref') + ']';
    pop.appendChild(n);
    var content = doc.createElement('div');
    content.innerHTML = ref.innerHTML;
    pop.appendChild(content);
    body.appendChild(pop);
    a.classList.add('open');
    a.setAttribute('aria-describedby', 'pop-current');
    popFor = a;
    var r = a.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    var left = Math.min(Math.max(12, r.left + scrollX - w / 2 + r.width / 2), scrollX + root.clientWidth - w - 12);
    var top = r.bottom + scrollY + 8;
    if (r.bottom + h + 16 > innerHeight && r.top - h - 8 > 0) top = r.top + scrollY - h - 8;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }
  var hoverTimer = null;
  doc.addEventListener('mouseover', function (e) {
    var a = e.target.closest && e.target.closest('a.cite');
    if (a) { clearTimeout(hoverTimer); openPop(a); return; }
    if (pop && (e.target.closest('.pop'))) { clearTimeout(hoverTimer); return; }
    if (pop) { clearTimeout(hoverTimer); hoverTimer = setTimeout(closePop, 250); }
  });
  doc.addEventListener('focusin', function (e) { var a = e.target.closest && e.target.closest('a.cite'); if (a) openPop(a); });
  doc.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a.cite');
    if (a) {
      // First tap shows the reference; a second tap (or a click after hover) follows the link.
      if (popFor !== a) { e.preventDefault(); openPop(a); }
      return;
    }
    if (pop && !e.target.closest('.pop')) closePop();
  });

  /* ── figure lightbox ───────────────────────────────── */
  var box = null;
  function openBox(img, caption) {
    if (!box) {
      box = doc.createElement('dialog');
      box.className = 'lightbox';
      box.innerHTML = '<button type="button" class="lb-close" aria-label="Close">Esc ✕</button><img alt=""><p></p>';
      box.addEventListener('click', function () { box.close(); });
      body.appendChild(box);
    }
    var big = box.querySelector('img');
    big.src = img.currentSrc || img.src;
    big.alt = img.alt;
    var p = box.querySelector('p');
    p.textContent = '';
    if (caption && caption.label) { var b = doc.createElement('b'); b.textContent = caption.label; p.appendChild(b); }
    p.appendChild(doc.createTextNode(caption ? caption.text : ''));
    if (box.showModal) box.showModal(); else box.setAttribute('open', '');
  }
  doc.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.fig-img');
    if (!btn) return;
    var fig = btn.closest('figure'), cap = fig && fig.querySelector('figcaption');
    var label = cap && cap.querySelector('.fig-n');
    var text = cap ? cap.textContent.slice(label ? label.textContent.length : 0).replace(/\s+/g, ' ').trim() : '';
    openBox(btn.querySelector('img'), { label: label ? label.textContent : '', text: text });
  });

  /* ── code blocks: copy and line numbers ────────────── */
  function copyText(text, done) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(text); done(); });
    } else { fallback(text); done(); }
  }
  function fallback(text) {
    var ta = doc.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    body.appendChild(ta); ta.select();
    try { doc.execCommand('copy'); } catch (e) { /* nothing more to try */ }
    ta.remove();
  }
  doc.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.c-btn');
    if (!btn) return;
    var block = btn.closest('.code');
    if (btn.getAttribute('data-act') === 'lines') {
      var on = !block.classList.contains('numbered');
      block.classList.toggle('numbered', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    } else {
      var lines = [].map.call(block.querySelectorAll('.line'), function (l) { return l.textContent; }); // one entry per source line
      var label = btn.textContent;
      copyText(lines.join('\n') + '\n', function () {
        btn.classList.add('done'); btn.textContent = '✓';
        setTimeout(function () { btn.classList.remove('done'); btn.textContent = label; }, 1200);
      });
    }
  });

  /* ── reader notes: questions and comments on a passage ──
     Records live in content/topics/<topic>/notes/<doc>.json (served by tooling/serve.py at /__notes/<topic>/<doc>);
     the build embeds the current set in #g110-notes. Without the server, new notes stay in localStorage and
     the rail offers Export. Anchor = section id + the quoted text with a short prefix and suffix. */
  var notes = (function () {
    var article = doc.querySelector('main article.prose');
    var metaOf = function (n) { var m = doc.querySelector('meta[name="' + n + '"]'); return m ? m.getAttribute('content') : ''; };
    var TOPIC = metaOf('g110-topic'), STEM = metaOf('g110-doc'), SOURCE = metaOf('g110-source');
    if (!article || !TOPIC || !STEM) return null;
    var LANG = root.lang === 'zh-CN' ? 'zh-CN' : 'en';
    var API = '/__notes/' + encodeURIComponent(TOPIC) + '/' + encodeURIComponent(STEM);
    var LKEY = 'g110-notes:' + TOPIC + '/' + STEM;
    var HTTP = /^https?:$/.test(location.protocol);
    var CONTEXT = 32, MAX_QUOTE = 1000;
    var T = {
      en: { question: 'Question', comment: 'Comment', on: 'on', submit: 'Submit', cancel: 'Cancel',
        placeholder: { question: 'What would you like to know about this passage?', comment: 'Your comment on this passage' },
        waiting: 'waiting for an answer', noted: 'noted', saved: 'saved', local: 'local only — export',
        changed: 'passage changed: shown at the end of its section', other: 'from the 中文 page',
        expand: 'expand', collapse: 'collapse', del: 'delete', confirmDelete: 'Delete this note?', answer: 'Answer', notes: 'NOTES',
        empty: 'Select text in the chapter to ask a question or add a comment.', copyMd: 'Copy as Markdown',
        json: 'Download .json', copied: '✓ Copied', failed: 'not saved: ',
        hint: 'To get answers, open a Claude session in this project and say', hintLocal: 'Export first, paste it into a Claude session and say', prompt: 'answer my notes', copyPrompt: 'copy', esc: 'Esc cancels · ⌘/Ctrl+Enter submits',
        status: { open: 'open', answered: 'answered', incorporated: 'incorporated' } },
      'zh-CN': { question: '问题', comment: '评论', on: '关于', submit: '提交', cancel: '取消',
        placeholder: { question: '关于这段内容，你想问什么？', comment: '你对这段内容的评论' },
        waiting: '等待回答', noted: '已记录', saved: '已保存', local: '仅在本地 — 请导出',
        changed: '原文已改动：显示在本节末尾', other: '来自英文页',
        expand: '展开', collapse: '收起', del: '删除', confirmDelete: '删除这条批注？', answer: '回答', notes: '批注',
        empty: '在正文中选中文字，即可提问或评论。', copyMd: '复制为 Markdown',
        hint: '想得到回答，在本项目中打开一个 Claude 会话并说', hintLocal: '先导出，粘贴到 Claude 会话中并说', prompt: '回答批注', copyPrompt: '复制',
        json: '下载 .json', copied: '✓ 已复制', failed: '未保存：', esc: 'Esc 取消 · ⌘/Ctrl+Enter 提交',
        status: { open: '未处理', answered: '已回答', incorporated: '已采纳' } }
    }[LANG];
    var BADGE = { question: '?', comment: '✎' };
    var SKIP = 'g110-note, .g110-form, button, script, style, .c-head';

    if (window.customElements && !customElements.get('g110-note')) {
      customElements.define('g110-note', class extends HTMLElement {
        get noteId() { return this.getAttribute('data-id'); }
        get kind() { return this.getAttribute('kind'); }
        get status() { return this.getAttribute('status'); }
      });
      customElements.define('g110-answer', class extends HTMLElement {
        get by() { return this.getAttribute('by'); }
      });
    }

    /* storage: records not yet on the server */
    function readLocal() {
      try { var v = JSON.parse(store.get(LKEY) || '[]'); return Array.isArray(v) ? v.filter(function (r) { return r && r.id && r.anchor; }) : []; }
      catch (e) { return []; }
    }
    function writeLocal(list) {
      try { if (list.length) localStorage.setItem(LKEY, JSON.stringify(list)); else localStorage.removeItem(LKEY); } catch (e) { /* private mode */ }
    }
    var server = false; // the notes API answered on this page
    var entries = [];   // { rec, local }
    function setItems(serverItems) {
      var on = {}, local = readLocal();
      serverItems.forEach(function (r) { on[r.id] = true; });
      if (server) { local = local.filter(function (r) { return !on[r.id]; }); writeLocal(local); }
      entries = serverItems.map(function (r) { return { rec: r, local: false }; })
        .concat(local.filter(function (r) { return !on[r.id]; }).map(function (r) { return { rec: r, local: true }; }));
      entries.sort(function (a, b) { return a.rec.created < b.rec.created ? -1 : a.rec.created > b.rec.created ? 1 : a.rec.id < b.rec.id ? -1 : 1; });
    }
    function embedded() {
      var el = doc.getElementById('g110-notes');
      try { var d = JSON.parse(el ? el.textContent : '{}'); return Array.isArray(d.items) ? d.items : []; } catch (e) { return []; }
    }
    function api(url, body) {
      var opts = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' };
      return fetch(url, opts).then(function (r) {
        return r.json().then(function (d) { if (!r.ok) throw new Error(d && d.error || ('HTTP ' + r.status)); return d; });
      });
    }

    /* text model: every text node of the article with the section it belongs to */
    function sectionIdOf(h) {
      if (h.id) return h.id;
      var holder = h.parentNode && h.parentNode.closest && h.parentNode.closest('[id]');
      return holder && holder !== article && article.contains(holder) ? holder.id : null;
    }
    function textIndex() {
      var out = [], current = 'top';
      var w = doc.createTreeWalker(article, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) { return n.nodeType === 1 && n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
      });
      var n;
      while ((n = w.nextNode())) {
        if (n.nodeType === 1) { if (/^H[23]$/.test(n.tagName)) current = sectionIdOf(n) || current; continue; }
        out.push({ node: n, section: current });
      }
      return out;
    }
    // Whitespace-collapsed text of one section, with a map from each character back to (node, offset).
    function sectionText(index, section) {
      var nodes = index.filter(function (e) { return e.section === section; }).map(function (e) { return e.node; });
      var norm = '', map = [], space = true;
      nodes.forEach(function (node, k) {
        var t = node.nodeValue;
        for (var i = 0; i < t.length; i++) {
          if (/\s/.test(t[i])) { if (space) continue; norm += ' '; space = true; }
          else { norm += t[i]; space = false; }
          map.push([k, i]);
        }
      });
      return { nodes: nodes, norm: norm, map: map };
    }
    function anchorFromRange(range) {
      var index = textIndex(), first = null;
      for (var i = 0; i < index.length && !first; i++) if (range.intersectsNode(index[i].node) && index[i].node.nodeValue.trim()) first = index[i];
      if (!first) return null;
      var st = sectionText(index, first.section), s = -1, e = -1;
      for (var k = 0; k < st.map.length; k++) {
        var node = st.nodes[st.map[k][0]], o = st.map[k][1];
        if (range.comparePoint(node, o) >= 0 && range.comparePoint(node, o + 1) <= 0) { if (s < 0) s = k; e = k; }
      }
      if (s < 0) return null;
      while (s <= e && st.norm[s] === ' ') s++;
      while (e >= s && st.norm[e] === ' ') e--;
      if (s > e) return null;
      e = Math.min(e, s + MAX_QUOTE - 1);
      return { section: first.section, quote: st.norm.slice(s, e + 1), prefix: st.norm.slice(Math.max(0, s - CONTEXT), s), suffix: st.norm.slice(e + 1, e + 1 + CONTEXT) };
    }
    function locate(index, a) {
      var st = sectionText(index, a.section);
      if (!st.nodes.length) return { st: null };
      var q = a.quote.replace(/\s+/g, ' ').trim(), best = -1, bestScore = -1, at = st.norm.indexOf(q);
      while (at >= 0 && q) {
        var score = 0, p = a.prefix || '', x = a.suffix || '';
        while (score < p.length && st.norm[at - 1 - score] === p[p.length - 1 - score]) score++;
        for (var j = 0; j < x.length && st.norm[at + q.length + j] === x[j]; j++) score++;
        if (score > bestScore) { best = at; bestScore = score; }
        at = st.norm.indexOf(q, at + 1);
      }
      return { st: st, s: best, e: best < 0 ? -1 : best + q.length - 1 };
    }
    function wrap(loc, rec) {
      var spans = [], marks = [];
      for (var k = loc.s; k <= loc.e; k++) {
        var m = loc.st.map[k], last = spans[spans.length - 1];
        if (last && last.k === m[0]) last.to = m[1] + 1; else spans.push({ k: m[0], from: m[1], to: m[1] + 1 });
      }
      spans.forEach(function (sp) {
        var node = loc.st.nodes[sp.k], text = node.nodeValue.slice(sp.from, sp.to);
        if (!text.trim()) return;
        var mid = sp.from ? node.splitText(sp.from) : node;
        if (sp.to - sp.from < mid.nodeValue.length) mid.splitText(sp.to - sp.from);
        var mark = doc.createElement('mark');
        mark.className = 'g110-mark';
        mark.setAttribute('data-note', rec.id);
        mark.setAttribute('data-kind', rec.kind);
        mid.parentNode.replaceChild(mark, mid);
        mark.appendChild(mid);
        marks.push(mark);
      });
      if (marks[0]) marks[0].id = 'mark-' + rec.id;
      return marks;
    }
    // The block a note goes after: the article child (or self-check answer child) that holds the node.
    function blockOf(node) {
      var el = node && (node.nodeType === 1 ? node : node.parentNode);
      if (!el || el === article || !article.contains(el)) return null;
      while (el.parentNode !== article && !el.parentNode.classList.contains('answers-body')) el = el.parentNode;
      return el;
    }
    function lastBlock(nodes) {
      for (var i = nodes.length - 1; i >= 0; i--) if (nodes[i].nodeValue.trim()) return blockOf(nodes[i]);
      return null;
    }
    function placeAfter(block, el) {
      if (!block) { article.appendChild(el); return; }
      var after = block;
      while (after.nextElementSibling && /^(G110-NOTE|FORM)$/.test(after.nextElementSibling.tagName)) after = after.nextElementSibling;
      after.parentNode.insertBefore(el, after.nextSibling);
    }
    function clearRendered() {
      [].slice.call(article.querySelectorAll('g110-note')).forEach(function (n) { n.remove(); });
      [].slice.call(article.querySelectorAll('mark.g110-mark')).forEach(function (m) {
        var p = m.parentNode;
        while (m.firstChild) p.insertBefore(m.firstChild, m);
        p.removeChild(m);
        p.normalize();
      });
    }

    /* small, safe Markdown for answers: paragraphs, lists, fenced code, `code`, **bold**, *em*, [links](url) */
    function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function inline(s) {
      var codes = [];
      s = escapeHtml(s).replace(/`([^`]+)`/g, function (all, c) { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
      s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (all, text, href) {
        var safe = /^(https?:|#|\.{0,2}\/|[\w.-]+(\/|#|$))/i.test(href) && !/^javascript:/i.test(href);
        return safe ? '<a href="' + href + '"' + (/^https?:/.test(href) ? ' target="_blank" rel="noopener"' : '') + '>' + text + '</a>' : text;
      });
      s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
      return s.replace(/\u0000(\d+)\u0000/g, function (all, k) { return '<code>' + codes[k] + '</code>'; });
    }
    function markdown(text) {
      var out = [], lines = String(text).replace(/\r\n?/g, '\n').split('\n'), i = 0;
      while (i < lines.length) {
        var line = lines[i];
        if (/^\s*```/.test(line)) {
          var code = [];
          for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
          i++;
          out.push('<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>');
        } else if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
          var ordered = /^\s*\d+\./.test(line), items = [];
          while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) { items.push('<li>' + inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '')) + '</li>'); i++; }
          out.push((ordered ? '<ol>' : '<ul>') + items.join('') + (ordered ? '</ol>' : '</ul>'));
        } else if (!line.trim()) { i++; }
        else {
          var para = [];
          while (i < lines.length && lines[i].trim() && !/^\s*(```|[-*]\s|\d+\.\s)/.test(lines[i])) para.push(lines[i++]);
          out.push('<p>' + inline(para.join(' ')) + '</p>');
        }
      }
      return out.join('');
    }

    /* the two elements */
    function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function day(iso) { return String(iso || '').slice(0, 10); }
    function short(s, n) { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trim() + '…' : s; }
    function evidenceChip(ev) {
      var m = /^(.+):(\d+)(?:-(\d+))?$/.exec(ev);
      var label = m ? m[1].split('/').pop() + ':' + m[2] + (m[3] ? '–' + m[3] : '') : ev;
      var a = el(SOURCE && m ? 'a' : 'span', 'src', label);
      a.title = ev;
      if (SOURCE && m) { a.href = SOURCE + m[1] + '#L' + m[2] + (m[3] ? '-L' + m[3] : ''); a.target = '_blank'; a.rel = 'noopener'; }
      return a;
    }
    function answerEl(ans) {
      var a = doc.createElement('g110-answer');
      a.setAttribute('by', ans.by || '');
      a.setAttribute('created', ans.created || '');
      a.appendChild(el('div', 'ga-head', T.answer.toUpperCase() + ' · ' + (ans.by || '') + ' · ' + day(ans.created)));
      var body = el('div', 'ga-body');
      body.innerHTML = markdown(ans.text || '');
      a.appendChild(body);
      if (ans.evidence && ans.evidence.length) {
        var chips = el('div', 'ga-ev');
        ans.evidence.forEach(function (ev) { chips.appendChild(evidenceChip(ev)); });
        a.appendChild(chips);
      }
      return a;
    }
    function noteEl(entry, flags) {
      var r = entry.rec, n = doc.createElement('g110-note');
      n.id = 'note-' + r.id;
      n.setAttribute('data-id', r.id);
      ['kind', 'status', 'lang', 'created'].forEach(function (k) { n.setAttribute(k, r[k]); });
      n.setAttribute('quote', r.anchor.quote);
      n.setAttribute('tabindex', '-1');
      if (entry.local) n.setAttribute('data-local', '');
      var head = el('div', 'gn-head');
      head.appendChild(el('span', 'gn-badge', BADGE[r.kind]));
      head.appendChild(el('span', 'gn-kind', (T[r.kind] || r.kind).toUpperCase() + ' · ' + day(r.created)));
      var pill = el('span', 'pill gn-status s-' + r.status, T.status[r.status] || r.status);
      head.appendChild(pill);
      var tog = el('button', 'gn-btn gn-toggle', T.expand); tog.type = 'button'; tog.setAttribute('data-toggle', r.id); tog.setAttribute('aria-expanded', 'false');
      head.appendChild(tog);
      n.appendChild(head);
      n.setAttribute('collapsed', '');   // folded by default; the toggle, the rail link or the mark opens it
      var q = el(flags.marked ? 'a' : 'span', 'gn-quote');
      q.appendChild(doc.createTextNode(T.on + ' “' + short(r.anchor.quote, 90) + '”'));
      if (flags.marked) { q.href = '#mark-' + r.id; q.setAttribute('data-goto', r.id); }
      n.appendChild(q);
      if (flags.changed) n.appendChild(el('p', 'gn-flag', '⚠ ' + T.changed));
      if (flags.other) n.appendChild(el('p', 'gn-flag other', T.other));
      n.appendChild(el('div', 'gn-text', r.text));
      (r.answers || []).forEach(function (ans) { n.appendChild(answerEl(ans)); });
      var foot = el('div', 'gn-foot');
      if (!(r.answers || []).length) foot.appendChild(el('span', 'gn-state', r.kind === 'question' ? T.waiting : T.noted));
      foot.appendChild(el('span', 'gn-sync' + (entry.local ? ' local' : ''), entry.local ? T.local : T.saved));
      if (r.status === 'open' && !(r.answers && r.answers.length)) {
        var next = el('span', 'gn-next'); next.appendChild(doc.createTextNode(T.hint + ' ')); next.appendChild(el('code', 'notes-prompt', T.prompt)); foot.appendChild(next);
      }
      foot.appendChild(el('span', 'gn-sp'));
      var canChange = entry.local || server;
      if (canChange) {
        var x = el('button', 'gn-btn', T.del); x.type = 'button'; x.setAttribute('data-act', 'delete'); foot.appendChild(x);
      }
      n.appendChild(foot);
      return n;
    }

    /* render all notes into the page and the rail */
    function render() {
      clearRendered();
      entries.forEach(function (entry) {
        var index = textIndex(), loc = locate(index, entry.rec.anchor), flags = {}, block = null;
        if (loc.st && loc.s >= 0) {
          var marks = wrap(loc, entry.rec);
          flags.marked = marks.length > 0;
          block = blockOf(marks[0] || loc.st.nodes[loc.st.map[loc.s][0]]);
        } else {
          if (entry.rec.lang !== LANG) flags.other = true; else flags.changed = true;
          block = loc.st ? lastBlock(loc.st.nodes) : null;
        }
        placeAfter(block, noteEl(entry, flags));
      });
      renderRail();
    }

    /* rail: NOTES · n, the list and Export */
    var rail = doc.querySelector('.rail'), railTh = null, railList = null, railEmpty = null;
    if (rail) {
      railTh = el('div', 'th notes-th');
      railList = el('nav', 'notes-list');
      railList.setAttribute('aria-label', T.notes);
      railEmpty = el('p', 'notes-empty', T.empty);
      var hint = el('p', 'notes-hint');
      var hintText = el('span', 'notes-hint-text', T.hint);
      var hintCode = el('code', 'notes-prompt', T.prompt);
      var hintCopy = el('button', 'notes-btn notes-prompt-copy', T.copyPrompt); hintCopy.type = 'button';
      hint.appendChild(hintText); hint.appendChild(doc.createTextNode(' ')); hint.appendChild(hintCode); hint.appendChild(doc.createTextNode(' ')); hint.appendChild(hintCopy);
      hintCopy.addEventListener('click', function () {
        copyText(T.prompt, function () { hintCopy.textContent = T.copied; setTimeout(function () { hintCopy.textContent = T.copyPrompt; }, 1400); });
      });
      var actions = el('div', 'notes-actions');
      var copyBtn = el('button', 'notes-btn', T.copyMd); copyBtn.type = 'button'; copyBtn.setAttribute('data-act', 'copy-md');
      var jsonBtn = el('button', 'notes-btn', T.json); jsonBtn.type = 'button'; jsonBtn.setAttribute('data-act', 'download-json');
      actions.appendChild(copyBtn); actions.appendChild(jsonBtn);
      var before = null;
      [].slice.call(rail.querySelectorAll('.th')).forEach(function (th) { if (!before && th.nextElementSibling && th.nextElementSibling.classList.contains('langs')) before = th; });
      [railTh, railList, railEmpty, hint, actions].forEach(function (x) { rail.insertBefore(x, before); });
      copyBtn.addEventListener('click', function () {
        copyText(digest(), function () { copyBtn.textContent = T.copied; setTimeout(function () { copyBtn.textContent = T.copyMd; }, 1400); });
      });
      jsonBtn.addEventListener('click', function () {
        var blob = new Blob([JSON.stringify(fileData(), null, 2) + '\n'], { type: 'application/json' });
        var a = el('a'); a.href = URL.createObjectURL(blob); a.download = STEM + '.json';
        body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      });
    }
    function renderRail() {
      if (!railList) return;
      railTh.textContent = T.notes + ' · ' + entries.length;
      railList.textContent = '';
      entries.forEach(function (entry) {
        var r = entry.rec, a = el('a', 'k-' + r.kind + ' s-' + r.status);
        a.href = doc.getElementById('mark-' + r.id) ? '#mark-' + r.id : '#note-' + r.id;
        a.setAttribute('data-goto', r.id);
        a.appendChild(el('span', 'br', BADGE[r.kind]));
        a.appendChild(el('span', 'tx', short(r.text, 40)));
        a.appendChild(el('span', 'st', entry.local ? T.local.split(' ')[0] : (T.status[r.status] || r.status)));
        railList.appendChild(a);
      });
      railEmpty.hidden = entries.length > 0;
      railList.hidden = entries.length === 0;
      // The prompt a later session needs, shown as soon as the page has a note (and kept there).
      var pending = entries.some(function (e) { return e.rec.status === 'open'; });
      var anyLocal = entries.some(function (e) { return e.local; });
      hint.hidden = !pending;
      hintText.textContent = anyLocal ? T.hintLocal : T.hint;
      railList.style.minHeight = '';
      railList.style.minHeight = Math.min(railList.scrollHeight, 72) + 'px'; // the tree shrinks first
    }
    function fileData() { return { schema_version: 1, document: STEM + '.md', items: entries.map(function (e) { return e.rec; }) }; }
    // The same digest as `node tooling/notes.mjs export`.
    function digest() {
      var lines = ['## ' + STEM + '.md', ''];
      entries.forEach(function (e) {
        var r = e.rec;
        lines.push('- [' + r.kind + '] #' + r.anchor.section + ' "' + short(r.anchor.quote, 120) + '" (' + r.id + ', ' + r.status + ', ' + r.lang + (e.local ? ', local only' : '') + ')');
        String(r.text).split('\n').forEach(function (l) { lines.push('  ' + l); });
        (r.answers || []).forEach(function (ans) {
          lines.push('  - Answer (' + ans.by + ', ' + day(ans.created) + '):');
          String(ans.text).split('\n').forEach(function (l) { lines.push('    ' + l); });
          if (ans.evidence && ans.evidence.length) lines.push('    Evidence: ' + ans.evidence.join(', '));
        });
      });
      return lines.join('\n') + '\n';
    }

    /* go to a note's passage */
    function flash(x) { if (!x) return; x.classList.remove('flash'); void x.offsetWidth; x.classList.add('flash'); }
    function goTo(id, toNote) {
      var mark = doc.getElementById('mark-' + id), note = doc.getElementById('note-' + id);
      var target = (!toNote && mark) || note;
      if (!target) return;
      var d = target.closest('details');
      if (d && !d.open) d.open = true;
      if (note) setFolded(note, false);
      target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
      [].slice.call(doc.querySelectorAll('mark.g110-mark[data-note="' + id + '"]')).forEach(flash);
      flash(note);
      if (note) note.focus({ preventScroll: true });
    }
    function setFolded(note, folded) {
      if (folded) note.setAttribute('collapsed', ''); else note.removeAttribute('collapsed');
      var t = note.querySelector('.gn-toggle');
      if (t) { t.textContent = folded ? T.expand : T.collapse; t.setAttribute('aria-expanded', folded ? 'false' : 'true'); }
    }
    doc.addEventListener('click', function (e) {
      var tg = e.target.closest && e.target.closest('[data-toggle]');
      if (tg) { var nt = tg.closest('g110-note'); setFolded(nt, !nt.hasAttribute('collapsed')); return; }
      var go = e.target.closest && e.target.closest('[data-goto]');
      if (go) { e.preventDefault(); goTo(go.getAttribute('data-goto'), false); if (narrow()) setDrawer(false); return; }
      var mark = e.target.closest && e.target.closest('mark.g110-mark');
      if (mark && getSelection().isCollapsed) { goTo(mark.getAttribute('data-note'), true); return; }
      var btn = e.target.closest && e.target.closest('g110-note .gn-btn');
      if (btn) act(btn.closest('g110-note').getAttribute('data-id'), btn.getAttribute('data-act'), btn);
    });

    /* create, change, delete */
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function stamp(d) { return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()); }
    function iso(d) {
      var off = -d.getTimezoneOffset(), sign = off >= 0 ? '+' : '-';
      off = Math.abs(off);
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
        + sign + pad(Math.floor(off / 60)) + ':' + pad(off % 60);
    }
    function newId(d) { return 'n-' + stamp(d) + '-' + Math.random().toString(16).slice(2, 6).padEnd(4, '0'); }
    function find(id) { for (var i = 0; i < entries.length; i++) if (entries[i].rec.id === id) return entries[i]; return null; }
    function showError(id, err) {
      var n = doc.getElementById('note-' + id), s = n && n.querySelector('.gn-sync');
      if (s) { s.textContent = T.failed + (err && err.message || err); s.classList.add('local'); }
    }
    function push(rec) {
      return api(API, rec).then(function (data) { server = true; setItems(data.items); render(); });
    }
    function add(rec) {
      var local = readLocal();
      local.push(rec);
      writeLocal(local);
      entries.push({ rec: rec, local: true });
      render();
      goTo(rec.id, true);
      if (HTTP) push(rec).catch(function () { /* stays local; Export offers it */ });
    }
    function act(id, what, btn) {
      var entry = find(id);
      if (!entry) return;
      if (what === 'delete' && !confirm(T.confirmDelete)) return;
      if (what !== 'delete') return;
      var change = { 'delete': true };
      if (entry.local) {
        var local = readLocal().filter(function (r) { return r.id !== id; });
        if (!change['delete']) { entry.rec.status = change.status; local.push(entry.rec); }
        writeLocal(local);
        if (change['delete']) entries.splice(entries.indexOf(entry), 1);
        render();
        return;
      }
      if (btn) btn.disabled = true;
      api(API + '/' + encodeURIComponent(id), change)
        .then(function (data) { setItems(data.items); render(); })
        .catch(function (err) { if (btn) btn.disabled = false; showError(id, err); });
    }

    /* selection bar and the inline form */
    var bar = el('div', 'g110-bar');
    bar.setAttribute('role', 'toolbar');
    bar.hidden = true;
    ['question', 'comment'].forEach(function (k) {
      var b = el('button', 'gb-' + k, BADGE[k] + ' ' + T[k]); b.type = 'button'; b.setAttribute('data-kind', k); bar.appendChild(b);
    });
    body.appendChild(bar);
    var pending = null, selTimer = null, form = null;
    function hideBar() { bar.hidden = true; pending = null; }
    function selectionRange() {
      var sel = getSelection();
      if (!sel || !sel.rangeCount || sel.isCollapsed || !sel.toString().trim()) return null;
      var range = sel.getRangeAt(0), c = range.commonAncestorContainer, at = c.nodeType === 1 ? c : c.parentNode;
      if (!article.contains(at) || at.closest(SKIP)) return null;
      return range;
    }
    function showBar() {
      var range = selectionRange();
      if (!range) { hideBar(); return; }
      pending = range.cloneRange();
      bar.hidden = false;
      var rects = range.getClientRects(), r = rects.length ? rects[0] : range.getBoundingClientRect();
      var top = r.top + scrollY - bar.offsetHeight - 8;
      if (r.top - bar.offsetHeight - 8 < (narrow() ? 60 : 8)) { var last = rects.length ? rects[rects.length - 1] : r; top = last.bottom + scrollY + 8; }
      var left = Math.min(Math.max(8, r.left + scrollX), scrollX + root.clientWidth - bar.offsetWidth - 8);
      bar.style.top = top + 'px';
      bar.style.left = left + 'px';
    }
    bar.addEventListener('mousedown', function (e) { e.preventDefault(); }); // keep the selection
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || !pending) return;
      var anchor = anchorFromRange(pending);
      hideBar();
      if (!anchor) return;
      var loc = locate(textIndex(), anchor);
      var block = loc.st && loc.s >= 0 ? blockOf(loc.st.nodes[loc.st.map[loc.s][0]]) : null;
      openForm(b.getAttribute('data-kind'), anchor, block);
      var sel = getSelection(); if (sel) sel.removeAllRanges();
    });
    doc.addEventListener('mouseup', function (e) { if (!bar.contains(e.target)) setTimeout(showBar, 0); });
    doc.addEventListener('selectionchange', function () {
      clearTimeout(selTimer);
      var sel = getSelection();
      if (!sel || sel.isCollapsed) { if (!bar.hidden) hideBar(); return; }
      selTimer = setTimeout(showBar, 350); // touch and keyboard selection
    });
    function closeForm() { if (form) { form.remove(); form = null; } }
    function openForm(kind, anchor, block) {
      closeForm();
      form = el('form', 'g110-form');
      form.setAttribute('data-kind', kind);
      var head = el('div', 'gf-head');
      head.appendChild(el('span', 'gn-badge', BADGE[kind]));
      head.appendChild(el('span', 'gn-kind', T[kind].toUpperCase()));
      head.appendChild(el('span', 'gf-on', T.on + ' “' + short(anchor.quote, 80) + '”'));
      form.appendChild(head);
      var ta = el('textarea');
      ta.rows = 3;
      ta.placeholder = T.placeholder[kind];
      ta.setAttribute('aria-label', T[kind]);
      form.appendChild(ta);
      var row = el('div', 'gf-row');
      row.appendChild(el('span', 'gf-hint', T.esc));
      var cancel = el('button', 'gn-btn', T.cancel); cancel.type = 'button';
      var submit = el('button', 'gn-btn primary', T.submit); submit.type = 'submit';
      row.appendChild(cancel); row.appendChild(submit);
      form.appendChild(row);
      placeAfter(block, form);
      cancel.addEventListener('click', closeForm);
      form.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.stopPropagation(); closeForm(); }
        else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit.click(); }
      });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var text = ta.value.trim();
        if (!text) { ta.focus(); return; }
        closeForm();
        var now = new Date();
        add({ id: newId(now), kind: kind, lang: LANG, anchor: anchor, text: text, created: iso(now), status: 'open', answers: [] });
      });
      ta.focus({ preventScroll: true });
      form.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
    }

    /* load: the embedded set now; the live set and any pending local notes when the server answers */
    setItems(embedded());
    render();
    if (HTTP) {
      api(API).then(function (data) {
        if (!data || !Array.isArray(data.items)) return;
        server = true;
        setItems(data.items);
        render();
        entries.filter(function (e) { return e.local; }).forEach(function (e) { push(e.rec).catch(function () { /* keep local */ }); });
      }).catch(function () { /* no notes server: local mode */ });
    }
    return {
      focusList: function () {
        if (narrow()) setDrawer(true);
        var first = railList && railList.querySelector('a');
        if (first) first.focus();
        else if (railEmpty) { railEmpty.setAttribute('tabindex', '-1'); railEmpty.focus(); }
      },
      escape: function () { hideBar(); }
    };
  })();

  /* ── keyboard ──────────────────────────────────────── */
  function goPart(dir) {
    var list = parts.length ? parts : targets.filter(Boolean), target = null;
    for (var i = 0; i < list.length; i++) {
      // scrollIntoView puts a heading at its scroll-margin-top; compare against that line.
      var line = parseFloat(getComputedStyle(list[i]).scrollMarginTop) || 0;
      var top = list[i].getBoundingClientRect().top;
      if (dir > 0 && top > line + 4) { target = list[i]; break; }
      if (dir < 0 && top < line - 4) target = list[i];
    }
    if (target) target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    else if (dir < 0) scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  }
  doc.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closePop(); setDrawer(false); if (notes) notes.escape(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (box && box.open) return;
    var behavior = reduced ? 'auto' : 'smooth';
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); scrollBy({ top: innerHeight * 0.85, behavior: behavior }); break;
      case 'ArrowUp': e.preventDefault(); scrollBy({ top: -innerHeight * 0.85, behavior: behavior }); break;
      case 'j': goPart(1); break;
      case 'k': goPart(-1); break;
      case 't': cycleTheme(); break;
      case 'l': if (langLink) location.href = langHref(); break;
      case 'n': if (notes) { e.preventDefault(); notes.focusList(); } break;
      default: return;
    }
  });

  update();
  addEventListener('load', function () { setTimeout(function () { root.classList.add('smooth'); }, 0); });
})();
