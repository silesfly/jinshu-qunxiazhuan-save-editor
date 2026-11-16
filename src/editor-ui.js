/* 금서군협전 세이브 에디터 v1.1 — UI 레이어
 * src/editor-ui.js
 *
 * 의존성(먼저 로드됨):
 *   global.JinshuCatalog
 *   global.JinshuEditorCore
 */
(function (global) {
  'use strict';

  var Catalog = global.JinshuCatalog || {};
  var Core = global.JinshuEditorCore || {};

  /* ------------------------------------------------------------------ *
   * 상수 / 상태
   * ------------------------------------------------------------------ */

  var PERSON_COUNT = typeof Core.PERSON_COUNT === 'number' ? Core.PERSON_COUNT : 758;
  var PARTY_SLOTS = typeof Core.PARTY_SLOTS === 'number' ? Core.PARTY_SLOTS : 15;
  var MAX_ACTIVE_INVENTORY = typeof Core.MAX_ACTIVE_INVENTORY === 'number' ? Core.MAX_ACTIVE_INVENTORY : 900;
  var INVENTORY_SLOTS = typeof Core.INVENTORY_SLOTS === 'number' ? Core.INVENTORY_SLOTS : 1000;

  var TABS = [
    { id: 'overview', tab: 'tab-overview', panel: 'panel-overview', search: null },
    { id: 'characters', tab: 'tab-characters', panel: 'panel-characters', search: 'char-search-input' },
    { id: 'martial', tab: 'tab-martial', panel: 'panel-martial', search: 'talent-search-input' },
    { id: 'inventory', tab: 'tab-inventory', panel: 'panel-inventory', search: 'inv-search-input' },
    { id: 'atlas', tab: 'tab-atlas', panel: 'panel-atlas', search: 'atlas-search-input' }
  ];

  var state = {
    session: null,
    nativeSession: null,
    currentFileName: '',
    selectedCharId: -1,
    activeTab: 'overview',
    busy: false,
    nativeMode: false,
    serverMode: false,
    invAddCount: 1,
    serverSlotName: '',
    serverToken: '',
    lastBackupPath: ''
  };

  var pendingNative = new Map();
  var nativeSeq = 1;

  var charById = new Map();
  var itemById = new Map();
  var kungfuById = new Map();
  var mijiById = new Map();
  var talentById = new Map();
  var sectById = new Map();

  var kungfuOptionCache = null;
  var charOptionCache = null;

  /* ------------------------------------------------------------------ *
   * DOM 유틸 (안전한 생성만 사용)
   * ------------------------------------------------------------------ */

  function $(id) {
    return document.getElementById(id);
  }

  function appendChildren(node, children) {
    if (children === null || children === undefined) return;
    if (Array.isArray(children)) {
      for (var i = 0; i < children.length; i++) appendChildren(node, children[i]);
      return;
    }
    if (typeof children === 'string' || typeof children === 'number') {
      node.appendChild(document.createTextNode(String(children)));
      return;
    }
    if (children && typeof children === 'object' && typeof children.nodeType === 'number') {
      node.appendChild(children);
    }
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      var keys = Object.keys(attrs);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class' || k === 'className') {
          node.className = String(v);
        } else if (k === 'text') {
          node.textContent = String(v);
        } else if (k === 'dataset' && typeof v === 'object') {
          Object.keys(v).forEach(function (dk) {
            node.dataset[dk] = String(v[dk]);
          });
        } else if (k === 'style' && typeof v === 'object') {
          Object.keys(v).forEach(function (sk) {
            node.style[sk] = v[sk];
          });
        } else if (k.length > 2 && k.slice(0, 2) === 'on' && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === 'value') {
          node.value = String(v);
        } else if (k === 'checked' || k === 'disabled' || k === 'selected') {
          node[k] = !!v;
        } else {
          node.setAttribute(k, v === true ? '' : String(v));
        }
      }
    }
    appendChildren(node, children);
    return node;
  }

  function clearNode(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function setText(node, text) {
    if (node) node.textContent = text === null || text === undefined ? '' : String(text);
  }

  function setStatus(message) {
    var bar = $('status-bar');
    if (bar) bar.textContent = String(message || '');
  }

  function num(v, fallback) {
    var n = parseInt(v, 10);
    return isNaN(n) ? (fallback === undefined ? 0 : fallback) : n;
  }

  function clamp(v, lo, hi) {
    if (lo !== undefined && v < lo) v = lo;
    if (hi !== undefined && v > hi) v = hi;
    return v;
  }

  function textOf(v) {
    return v === null || v === undefined ? '' : String(v);
  }

  /* ------------------------------------------------------------------ *
   * 카탈로그 헬퍼
   * ------------------------------------------------------------------ */

  function catalogList(key) {
    var c = state.catalogRef || Catalog || {};
    var list = c[key];
    return Array.isArray(list) ? list : [];
  }

  function buildMaps() {
    charById = new Map();
    itemById = new Map();
    kungfuById = new Map();
    mijiById = new Map();
    talentById = new Map();
    sectById = new Map();

    catalogList('characters').forEach(function (c) {
      charById.set(Number(c.id), c);
    });
    catalogList('items').forEach(function (c) {
      itemById.set(Number(c.id), c);
    });
    catalogList('kungfu').forEach(function (c) {
      kungfuById.set(Number(c.id), c);
    });
    catalogList('miji').forEach(function (c) {
      mijiById.set(Number(c.id), c);
    });
    catalogList('talents').forEach(function (c) {
      talentById.set(Number(c.id), c);
    });
    catalogList('sects').forEach(function (c) {
      sectById.set(Number(c.id), c);
    });
  }

  function sectLabel(sectId) {
    var s = sectById.get(Number(sectId));
    if (!s) return '문파 ' + sectId;
    return textOf(s.ko) + (s.zh ? ' (' + s.zh + ')' : '');
  }

  function charLabel(personId) {
    var c = charById.get(Number(personId));
    if (!c) return '[' + personId + '] ???';
    var label = '[' + c.id + '] ' + textOf(c.ko);
    if (c.zh) label += ' (' + c.zh + ')';
    return label;
  }

  function itemLabel(itemId) {
    var it = itemById.get(Number(itemId));
    if (!it) return '[' + itemId + '] ???';
    var label = '[' + it.id + '] ' + textOf(it.ko);
    if (it.zh) label += ' (' + it.zh + ')';
    return label;
  }

  function buildCharOptions() {
    if (charOptionCache) return charOptionCache;
    var out = [];
    for (var i = 0; i < PERSON_COUNT; i++) {
      var c = charById.get(i);
      if (c) {
        out.push({ value: i, label: charLabel(i) });
      } else {
        out.push({ value: i, label: '[' + i + '] ???' });
      }
    }
    charOptionCache = out;
    return out;
  }

  function fillSelectWithCharacters(select, includeEmpty, emptyLabel) {
    clearNode(select);
    if (includeEmpty) {
      select.appendChild(el('option', { value: '-1', text: emptyLabel || '-1: 없음' }));
    }
    var opts = buildCharOptions();
    var frag = document.createDocumentFragment();
    for (var i = 0; i < opts.length; i++) {
      frag.appendChild(el('option', { value: String(opts[i].value), text: opts[i].label }));
    }
    select.appendChild(frag);
  }

  function catalogPairs(key) {
    var raw = Catalog ? Catalog[key] : null;
    var out = [];
    if (!raw) return out;

    function pushPair(id, value, fallbackId) {
      var ko;
      var zh;
      if (value && typeof value === 'object') {
        ko = textOf(value.ko);
        zh = textOf(value.zh);
      } else {
        ko = String(value);
        zh = '';
      }
      out.push({
        id: id === undefined || id === null || isNaN(Number(id)) ? fallbackId : Number(id),
        label: ko + (zh ? ' (' + zh + ')' : ''),
        ko: ko,
        zh: zh,
        raw: value
      });
    }

    if (Array.isArray(raw)) {
      raw.forEach(function (g, i) {
        var id = g && typeof g === 'object' && g.id !== undefined ? g.id : i;
        pushPair(id, g, i);
      });
    } else if (typeof raw === 'object') {
      Object.keys(raw).forEach(function (k) {
        pushPair(Number(k), raw[k], k);
      });
    }

    out.sort(function (a, b) {
      var an = Number(a.id);
      var bn = Number(b.id);
      if (!isNaN(an) && !isNaN(bn)) return an - bn;
      return String(a.id) < String(b.id) ? -1 : (String(a.id) > String(b.id) ? 1 : 0);
    });
    return out;
  }

  function genderLabel(v) {
    var pairs = catalogPairs('genders');
    var n = Number(v);
    for (var i = 0; i < pairs.length; i++) {
      if (Number(pairs[i].id) === n) {
        return pairs[i].ko + (pairs[i].zh ? ' (' + pairs[i].zh + ')' : '');
      }
    }
    return String(v);
  }

  function neiliLabel(v) {
    var pairs = catalogPairs('neiliTypes');
    var n = Number(v);
    for (var i = 0; i < pairs.length; i++) {
      if (Number(pairs[i].id) === n) {
        return pairs[i].ko + (pairs[i].zh ? ' (' + pairs[i].zh + ')' : '');
      }
    }
    return String(v);
  }

  function kungfuTypeLabel(v) {
    var pairs = catalogPairs('kungfuTypes');
    var n = Number(v);
    for (var i = 0; i < pairs.length; i++) {
      if (Number(pairs[i].id) === n) return pairs[i].ko;
    }
    return v === null || v === undefined || v === '' ? '-' : String(v);
  }

  function itemTypeLabel(v) {
    var pairs = catalogPairs('itemTypes');
    var n = Number(v);
    for (var i = 0; i < pairs.length; i++) {
      if (Number(pairs[i].id) === n) return pairs[i].ko;
    }
    return v === null || v === undefined || v === '' ? '-' : String(v);
  }

  function equipSlotLabel(v) {
    var idx = Number(v);
    if (idx === -1) return '비장비';
    var pairs = catalogPairs('equipSlots');
    for (var i = 0; i < pairs.length; i++) {
      if (Number(pairs[i].id) === idx) return pairs[i].ko;
    }
    return v === null || v === undefined ? '-' : String(v);
  }

  function isValidKungfuId(id) {
    var n = Number(id);
    if (!n) return false;
    if (n >= 462 && n <= 470) return false;
    return true;
  }

  function knownKungfuIds() {
    var ids = [];
    catalogList('kungfu').forEach(function (k) {
      if (isValidKungfuId(k.id)) ids.push(Number(k.id));
    });
    return ids;
  }

  function buildKungfuOptions(extraIds) {
    var base;
    if (!kungfuOptionCache) {
      kungfuOptionCache = knownKungfuIds();
      kungfuOptionCache.sort(function (a, b) { return a - b; });
    }
    base = kungfuOptionCache.slice();
    if (Array.isArray(extraIds)) {
      extraIds.forEach(function (id) {
        var n = Number(id);
        if (!isNaN(n) && n > 0 && base.indexOf(n) === -1) base.push(n);
      });
      base.sort(function (a, b) { return a - b; });
    }
    return base;
  }

  function knownMijiIds(extraIds) {
    var set = {};
    for (var i = 1; i <= 100; i++) set[i] = true;
    catalogList('miji').forEach(function (m) {
      var n = Number(m.id);
      if (n > 0) set[n] = true;
    });
    if (Array.isArray(extraIds)) {
      extraIds.forEach(function (id) {
        var n = Number(id);
        if (n > 0) set[n] = true;
      });
    }
    return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
  }

  /* ------------------------------------------------------------------ *
   * Base64
   * ------------------------------------------------------------------ */

  function base64ToBytes(b64) {
    if (!b64 || typeof b64 !== 'string') return new Uint8Array(0);
    var clean = b64.replace(/^data:[^,]*,/, '');
    var bin = '';
    if (typeof global.atob === 'function') {
      bin = global.atob(clean);
    } else if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(clean, 'base64'));
    } else {
      return new Uint8Array(0);
    }
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
    return out;
  }

  function bytesToBase64(bytes) {
    if (!bytes || !bytes.length) return '';
    var bin = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      var slice = bytes.subarray ? bytes.subarray(i, i + chunk) : bytes.slice(i, i + chunk);
      bin += String.fromCharCode.apply(null, Array.prototype.slice.call(slice));
    }
    if (typeof global.btoa === 'function') return global.btoa(bin);
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    return '';
  }

  /* ------------------------------------------------------------------ *
   * 세션 / 로드 / 저장
   * ------------------------------------------------------------------ */

  function getSession() {
    return state.session;
  }

  function isBusy() {
    return state.busy;
  }

  function isLoaded() {
    return !!(state.session && typeof state.session.isLoaded === 'function' && state.session.isLoaded());
  }

  function normalizeBytes(u8) {
    if (!u8) return new Uint8Array(0);
    if (u8 instanceof Uint8Array) return u8;
    if (u8 instanceof ArrayBuffer) return new Uint8Array(u8);
    if (Array.isArray(u8)) return new Uint8Array(u8);
    if (u8.buffer && u8.byteLength !== undefined) return new Uint8Array(u8.buffer);
    return new Uint8Array(0);
  }

  async function loadBytes(bytes, name) {
    if (!state.session) {
      setStatus('에디터 코어가 초기화되지 않았습니다.');
      return false;
    }
    state.busy = true;
    setStatus('세이브를 불러오는 중…');
    try {
      await state.session.loadSavBytes(normalizeBytes(bytes));
      if (name) state.currentFileName = name;
      else if (!state.currentFileName) state.currentFileName = 'Save_1.sav';
      state.selectedCharId = pickInitialCharacter();
      renderAll();
      setStatus('불러옴: ' + state.currentFileName);
      return true;
    } catch (err) {
      var msg = err && err.message ? err.message : String(err);
      setStatus('세이브 로드 실패: ' + msg);
      return false;
    } finally {
      state.busy = false;
      renderHeaderBadges();
    }
  }

  function pickInitialCharacter() {
    if (!state.session || !isLoaded()) return -1;
    try {
      var party = state.session.getParty();
      if (Array.isArray(party)) {
        for (var i = 0; i < party.length; i++) {
          var id = Number(party[i]);
          if (id >= 0) return id;
        }
      }
      var summary = state.session.getSummary();
      if (summary && Number(summary.heroId) >= 0) return Number(summary.heroId);
    } catch (e) {
      /* noop */
    }
    return -1;
  }

  async function openDemoSave() {
    if (!Core) return;
    state.busy = true;
    setStatus('데모 세이브를 생성하는 중…');
    try {
      var bytes;
      if (typeof Core.createDemoSavBytes === 'function') {
        bytes = await Core.createDemoSavBytes(Catalog);
      } else if (typeof Core.createDemoSavBytesSync === 'function') {
        bytes = Core.createDemoSavBytesSync(Catalog);
      }
      state.currentFileName = 'demo-save.sav';
      await loadBytes(bytes, 'demo-save.sav');
    } catch (err) {
      setStatus('데모 세이브 생성 실패: ' + (err && err.message ? err.message : String(err)));
    } finally {
      state.busy = false;
      renderHeaderBadges();
    }
  }

  function downloadBytes(bytes, fileName) {
    try {
      var blob = new Blob([bytes], { type: 'application/octet-stream' });
      var url = global.URL.createObjectURL(blob);
      var a = el('a', { href: url, download: fileName || 'Save_1.sav' });
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        if (a.parentNode) a.parentNode.removeChild(a);
        global.URL.revokeObjectURL(url);
      }, 1200);
      setStatus('다운로드: ' + (fileName || 'Save_1.sav'));
    } catch (err) {
      setStatus('다운로드 실패: ' + (err && err.message ? err.message : String(err)));
    }
  }

  async function handleDownload() {
    if (!isLoaded()) {
      setStatus('먼저 세이브를 불러오세요.');
      return;
    }
    state.busy = true;
    try {
      var bytes = await state.session.exportSavBytes();
      var name = state.currentFileName || 'Save_1.sav';
      downloadBytes(bytes, name);
      await state.session.loadSavBytes(bytes);
      renderAll();
    } catch (err) {
      setStatus('내보내기 실패: ' + (err && err.message ? err.message : String(err)));
    } finally {
      state.busy = false;
    }
  }

  function readFileAsBytes(file) {
    return new Promise(function (resolve, reject) {
      if (!file) {
        reject(new Error('파일이 없습니다'));
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        resolve(new Uint8Array(reader.result));
      };
      reader.onerror = function () {
        reject(reader.error || new Error('파일 읽기 실패'));
      };
      reader.readAsArrayBuffer(file);
    });
  }

  async function handleFile(file) {
    if (!file) return;
    if (!/\.sav$/i.test(file.name || '')) {
      setStatus('확장자가 .sav 인 파일만 지원합니다.');
      return;
    }
    try {
      var bytes = await readFileAsBytes(file);
      await loadBytes(bytes, file.name);
    } catch (err) {
      setStatus('파일 읽기 실패: ' + (err && err.message ? err.message : String(err)));
    }
  }

  /* ------------------------------------------------------------------ *
   * 네이티브 WebView2 브리지
   * ------------------------------------------------------------------ */

  function isNativeWebView() {
    return !!(global.chrome && global.chrome.webview && typeof global.chrome.webview.postMessage === 'function');
  }

  function nativeRequest(payload) {
    return new Promise(function (resolve, reject) {
      var seq = nativeSeq++;
      pendingNative.set(seq, { resolve: resolve, reject: reject });
      try {
        var msg = {};
        Object.keys(payload || {}).forEach(function (k) { msg[k] = payload[k]; });
        msg.seq = seq;
        msg.id = seq;
        global.chrome.webview.postMessage(msg);
      } catch (err) {
        pendingNative.delete(seq);
        reject(err);
      }
    });
  }

  function handleNativeMessage(ev) {
    var data = ev && ev.data;
    if (!data || typeof data !== 'object') return;

    if (data.kind === 'auto-loaded' && typeof data.base64 === 'string') {
      loadBytes(base64ToBytes(data.base64), data.name || 'Save_1.sav').then(function () {
        state.nativeSession = data.session || null;
        renderAll();
      });
      return;
    }

    var key = data.seq !== undefined && data.seq !== null ? data.seq : data.id;
    if (key !== undefined && key !== null && pendingNative.has(key)) {
      var pending = pendingNative.get(key);
      pendingNative.delete(key);
      if (data.ok === false || data.error) {
        pending.reject(new Error(data.error || 'native request failed'));
      } else {
        pending.resolve(data);
      }
    }
  }

  async function initNative() {
    if (!isNativeWebView()) return false;
    state.nativeMode = true;
    var toolbar = $('native-toolbar');
    if (toolbar) toolbar.hidden = false;
    var noticeText = $('mode-notice-text');
    if (noticeText) {
      noticeText.textContent = '데스크톱 앱 모드 · 원본 덮어쓰기 전 SHA-256 검증 백업(.bak) 자동 생성';
    }

    try {
      global.chrome.webview.addEventListener('message', handleNativeMessage);
    } catch (e) {
      /* noop */
    }

    try {
      var res = await nativeRequest({ kind: 'ready' });
      if (res && res.ok && typeof res.base64 === 'string' && res.base64) {
        state.nativeSession = res.session || null;
        await loadBytes(base64ToBytes(res.base64), res.name || 'Save_1.sav');
      }
    } catch (e) {
      /* ready는 호스트가 무시할 수 있음 */
    }
    return true;
  }

  async function nativeOpen() {
    if (!state.nativeMode) return;
    try {
      var res = await nativeRequest({ kind: 'open' });
      if (!res || res.cancelled) return;
      if (typeof res.base64 === 'string' && res.base64) {
        state.nativeSession = res.session || null;
        await loadBytes(base64ToBytes(res.base64), res.name || 'Save_1.sav');
      }
    } catch (err) {
      setStatus('데스크톱 열기 실패: ' + (err && err.message ? err.message : String(err)));
    }
  }

  async function nativeSave() {
    if (!isLoaded()) {
      setStatus('먼저 세이브를 불러오세요.');
      return;
    }
    if (!state.nativeSession) {
      setStatus('데스크톱 세션 정보가 없습니다. 파일을 다시 여세요.');
      return;
    }
    state.busy = true;
    try {
      var bytes = await state.session.exportSavBytes();
      var res = await nativeRequest({
        kind: 'save',
        session: state.nativeSession,
        base64: bytesToBase64(bytes)
      });
      if (res && res.ok === false) throw new Error(res.error || '저장 실패');
      state.nativeSession = (res && res.session) || state.nativeSession;
      if (res && (res.backup || res.path)) state.lastBackupPath = String(res.backup || res.path);
      await state.session.loadSavBytes(bytes);
      renderAll();
      setStatus('저장 완료' + (state.lastBackupPath ? (' · 백업: ' + state.lastBackupPath) : ''));
    } catch (err) {
      setStatus('데스크톱 저장 실패: ' + (err && err.message ? err.message : String(err)));
    } finally {
      state.busy = false;
      renderHeaderBadges();
    }
  }

  async function nativeSaveCopy() {
    if (!isLoaded()) {
      setStatus('먼저 세이브를 불러오세요.');
      return;
    }
    state.busy = true;
    try {
      var bytes = await state.session.exportSavBytes();
      var res = await nativeRequest({
        kind: 'save-copy',
        name: state.currentFileName || 'Save_1.sav',
        base64: bytesToBase64(bytes)
      });
      if (res && res.ok === false) throw new Error(res.error || '복사 저장 실패');
      setStatus('복사 저장 완료' + (res && res.path ? (': ' + res.path) : ''));
    } catch (err) {
      setStatus('복사 저장 실패: ' + (err && err.message ? err.message : String(err)));
    } finally {
      state.busy = false;
    }
  }

  /* ------------------------------------------------------------------ *
   * 로컬 서버 브리지
   * ------------------------------------------------------------------ */

  async function initServer() {
    if (typeof global.fetch !== 'function') return false;
    if (!global.location || typeof global.location.protocol !== 'string') return false;
    if (global.location.protocol.indexOf('http') !== 0) return false;
    try {
      var res = await global.fetch('/api/saves', { cache: 'no-store' });
      if (!res || !res.ok) return false;
      var data = await res.json();
      if (!data || data.ok !== true || !Array.isArray(data.saves)) return false;

      state.serverMode = true;
      state.serverToken = typeof data.csrfToken === 'string' ? data.csrfToken : '';
      var toolbar = $('server-toolbar');
      if (toolbar) toolbar.hidden = false;
      var sel = $('server-slot-select');
      if (sel) {
        clearNode(sel);
        if (!data.saves.length) {
          sel.appendChild(el('option', { value: '', text: '(서버에 세이브가 없습니다)' }));
        } else {
          data.saves.forEach(function (s) {
            var name = typeof s === 'string' ? s : (s.name || s.file || '');
            if (!name) return;
            sel.appendChild(el('option', { value: name, text: name }));
          });
          state.serverSlotName = sel.value;
          sel.addEventListener('change', function () {
            state.serverSlotName = sel.value;
          });
        }
      }
      var noticeText = $('mode-notice-text');
      if (noticeText) {
        noticeText.textContent = '로컬 서버 모드 (127.0.0.1) · 서버 경로 세이브 열기 및 자동 백업(.bak) 지원';
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  async function serverOpen() {
    if (!state.serverMode) return;
    var sel = $('server-slot-select');
    var name = (sel && sel.value) || state.serverSlotName;
    if (!name) {
      setStatus('서버 세이브 슬롯을 선택하세요.');
      return;
    }
    state.busy = true;
    try {
      var res = await global.fetch('/api/load?name=' + encodeURIComponent(name), { cache: 'no-store' });
      if (!res || !res.ok) throw new Error('서버 응답 오류 ' + (res ? res.status : ''));
      var data = await res.json();
      if (!data || data.ok === false) throw new Error((data && data.error) || '불러오기 실패');
      state.serverSlotName = name;
      await loadBytes(base64ToBytes(data.base64), name);
    } catch (err) {
      setStatus('서버 열기 실패: ' + (err && err.message ? err.message : String(err)));
    } finally {
      state.busy = false;
    }
  }

  async function serverSave() {
    if (!isLoaded()) {
      setStatus('먼저 세이브를 불러오세요.');
      return;
    }
    if (!state.serverMode) return;
    var sel = $('server-slot-select');
    var name = (sel && sel.value) || state.serverSlotName;
    if (!name) {
      setStatus('서버 세이브 슬롯을 선택하세요.');
      return;
    }
    state.busy = true;
    try {
      var bytes = await state.session.exportSavBytes();
      var res = await global.fetch('/api/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Jinshu-Token': state.serverToken || ''
        },
        body: JSON.stringify({ name: name, base64: bytesToBase64(bytes) })
      });
      if (!res || !res.ok) throw new Error('서버 응답 오류 ' + (res ? res.status : ''));
      var data = await res.json();
      if (!data || data.ok === false) throw new Error((data && data.error) || '저장 실패');
      await state.session.loadSavBytes(bytes);
      renderAll();
      setStatus('서버 저장 완료: ' + name);
    } catch (err) {
      setStatus('서버 저장 실패: ' + (err && err.message ? err.message : String(err)));
    } finally {
      state.busy = false;
      renderHeaderBadges();
    }
  }

  /* ------------------------------------------------------------------ *
   * 탭
   * ------------------------------------------------------------------ */

  function tabMeta(id) {
    for (var i = 0; i < TABS.length; i++) {
      if (TABS[i].id === id) return TABS[i];
    }
    return TABS[0];
  }

  function activateTab(id, opts) {
    var meta = tabMeta(id);
    state.activeTab = meta.id;

    TABS.forEach(function (t) {
      var tabEl = $(t.tab);
      var panelEl = $(t.panel);
      var active = t.id === meta.id;
      if (tabEl) {
        tabEl.setAttribute('aria-selected', active ? 'true' : 'false');
        tabEl.tabIndex = active ? 0 : -1;
        tabEl.classList.toggle('active', active);
      }
      if (panelEl) {
        if (active) {
          panelEl.removeAttribute('hidden');
        } else {
          panelEl.setAttribute('hidden', 'until-found');
        }
      }
    });

    if (opts && opts.focus) {
      var tabEl2 = $(meta.tab);
      if (tabEl2) tabEl2.focus();
    }

    if (meta.id === 'atlas') renderAtlas();
    if (meta.id === 'inventory') renderInventory();
    if (meta.id === 'martial') renderMartial();
    if (meta.id === 'characters') renderCharacterList();
  }

  function focusTabSearch(tabId) {
    var meta = tabMeta(tabId);
    if (!meta.search) return false;
    var target = $(meta.search);
    if (target) {
      target.focus();
      if (typeof target.select === 'function') target.select();
      return true;
    }
    return false;
  }

  function setupTabs() {
    var tablist = $('main-tablist');
    if (tablist) {
      tablist.addEventListener('keydown', function (e) {
        var idx = -1;
        for (var i = 0; i < TABS.length; i++) {
          if (TABS[i].id === state.activeTab) { idx = i; break; }
        }
        if (idx < 0) idx = 0;
        var next = -1;
        if (e.key === 'ArrowRight') next = (idx + 1) % TABS.length;
        else if (e.key === 'ArrowLeft') next = (idx - 1 + TABS.length) % TABS.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = TABS.length - 1;
        if (next >= 0) {
          e.preventDefault();
          activateTab(TABS[next].id, { focus: true });
        }
      });
    }

    TABS.forEach(function (t) {
      var tabEl = $(t.tab);
      if (tabEl) {
        tabEl.addEventListener('click', function () {
          activateTab(t.id);
        });
      }
      var panelEl = $(t.panel);
      if (panelEl) {
        panelEl.addEventListener('beforematch', function () {
          activateTab(t.id);
        });
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== '/') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var target = e.target;
      if (target && target.nodeType === 1) {
        var tag = (target.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
      }
      e.preventDefault();
      if (state.activeTab === 'overview') {
        activateTab('characters');
        focusTabSearch('characters');
      } else if (!focusTabSearch(state.activeTab)) {
        activateTab('characters');
        focusTabSearch('characters');
      }
    });

    activateTab('overview');
  }

  /* ------------------------------------------------------------------ *
   * 테마 / 헤더
   * ------------------------------------------------------------------ */

  function setupTheme() {
    var btn = $('btn-theme-toggle');
    if (!btn) return;
    var root = document.documentElement;
    var current = root.dataset.theme === 'light' ? 'light' : 'dark';
    root.dataset.theme = current;
    btn.setAttribute('aria-pressed', current === 'dark' ? 'true' : 'false');
    btn.addEventListener('click', function () {
      var now = root.dataset.theme === 'light' ? 'dark' : 'light';
      root.dataset.theme = now;
      btn.setAttribute('aria-pressed', now === 'dark' ? 'true' : 'false');
      btn.textContent = now === 'dark' ? '테마: 어두움' : '테마: 밝음';
    });
    btn.textContent = current === 'dark' ? '테마: 어두움' : '테마: 밝음';
  }

  function renderHeaderBadges() {
    var fileBadge = $('loaded-file-badge');
    if (fileBadge) {
      fileBadge.textContent = isLoaded() ? ('파일: ' + (state.currentFileName || 'Save_1.sav')) : '파일: 없음';
    }

    var valBadge = $('validation-badge');
    if (valBadge) {
      if (!isLoaded()) {
        valBadge.textContent = '검증: 대기';
        valBadge.classList.remove('badge-ok', 'badge-danger');
      } else {
        var v = null;
        try { v = state.session.validate(); } catch (e) { v = null; }
        if (v && v.valid) {
          valBadge.textContent = '검증: 정상';
          valBadge.classList.remove('badge-danger');
          valBadge.classList.add('badge-ok');
        } else {
          var count = v && Array.isArray(v.errors) ? v.errors.length : 0;
          valBadge.textContent = '검증: 오류 ' + count;
          valBadge.classList.remove('badge-ok');
          valBadge.classList.add('badge-danger');
        }
      }
    }

    var changesBadge = $('changes-badge');
    var changes = null;
    try { changes = state.session ? state.session.getChanges() : null; } catch (e) { changes = null; }
    var n = changes && typeof changes.count === 'number' ? changes.count : 0;
    if (changesBadge) changesBadge.textContent = String(n);
    var reviewBtn = $('btn-review-changes');
    if (reviewBtn) reviewBtn.disabled = !isLoaded();
  }

  /* ------------------------------------------------------------------ *
   * 패널 1: 개요
   * ------------------------------------------------------------------ */

  function renderOverview() {
    var summary = null;
    if (isLoaded()) {
      try { summary = state.session.getSummary(); } catch (e) { summary = null; }
    }

    var hero = $('kpi-hero');
    var heroSub = $('kpi-hero-sub');
    var run = $('kpi-run');
    var runSub = $('kpi-run-sub');
    var cur = $('kpi-currency');
    var curSub = $('kpi-currency-sub');
    var ident = $('kpi-identity');
    var identSub = $('kpi-identity-sub');

    if (!summary) {
      setText(hero, '불러온 세이브 없음');
      setText(heroSub, '파일을 열거나 데모 세이브를 생성하세요.');
      setText(run, '-');
      setText(runSub, '-');
      setText(cur, '-');
      setText(curSub, '-');
      setText(ident, '-');
      setText(identSub, '-');
    } else {
      var heroName = summary.heroName || summary.heroKo || '???';
      setText(hero, heroName + ' (Lv ' + textOf(summary.heroLevel) + ')');
      setText(heroSub, '동료 ' + textOf(summary.partyCount) + '명 · 소지품 ' + textOf(summary.inventoryCount) + '종');

      setText(run, '난이도 ' + textOf(summary.difficulty) + ' · ' + textOf(summary.playthrough) + '회차');
      setText(runSub, textOf(summary.year) + '년 ' + textOf(summary.month) + '월 ' + textOf(summary.day) + '일 · ' + textOf(summary.shichen) + '시');

      setText(cur, '금 ' + textOf(summary.gold) + ' · 비급 ' + textOf(summary.mjcz));
      setText(curSub, 'SP ' + textOf(summary.sp) + ' · 체력 ' + textOf(summary.staminaJl));

      setText(ident, summary.hasSaveIdentity ? '세이브 식별 정보 있음' : '세이브 식별 정보 없음');
      setText(identSub, textOf(summary.saveWallTime || summary.saveCreateTime || '-'));
    }

    renderPresets();
    renderCurrencyForm(summary);
    renderPartyGrid();
  }

  function renderPresets() {
    var grid = $('presets-grid');
    if (!grid) return;
    clearNode(grid);
    var presets = Array.isArray(Core.PRESETS) ? Core.PRESETS : [];
    if (!presets.length) {
      grid.appendChild(el('div', { class: 'muted', text: '프리셋이 없습니다.' }));
      return;
    }
    presets.forEach(function (p) {
      var id = p && p.id !== undefined ? p.id : p;
      var label = p && (p.ko || p.name || p.zh) ? (p.ko || p.name || p.zh) : String(id);
      var btn = el('button', {
        type: 'button',
        class: 'preset-btn',
        'data-preset': String(id),
        text: label,
        title: p && p.descKo ? String(p.descKo) : label
      });
      btn.addEventListener('click', function () {
        if (!isLoaded()) {
          setStatus('먼저 세이브를 불러오세요.');
          return;
        }
        try {
          state.session.applyPreset(id);
          renderAll();
          setStatus('프리셋 적용: ' + label);
        } catch (err) {
          setStatus('프리셋 적용 실패: ' + (err && err.message ? err.message : String(err)));
        }
      });
      grid.appendChild(btn);
    });
  }

  function currencyField(id, summaryKey) {
    return { id: id, key: summaryKey };
  }

  var CURRENCY_FIELDS = [
    currencyField('cur-gold', 'gold'),
    currencyField('cur-mjcz', 'mjcz'),
    currencyField('cur-sp', 'sp'),
    currencyField('cur-stamina', 'staminaJl'),
    currencyField('cur-playthrough', 'playthrough'),
    currencyField('cur-difficulty', 'difficulty'),
    currencyField('cur-books', 'bookCount'),
    currencyField('cur-year', 'year'),
    currencyField('cur-month', 'month'),
    currencyField('cur-day', 'day'),
    currencyField('cur-shichen', 'shichen')
  ];

  function renderCurrencyForm(summary) {
    CURRENCY_FIELDS.forEach(function (f) {
      var input = $(f.id);
      if (!input) return;
      input.disabled = !summary;
      if (summary) input.value = summary[f.key] === undefined || summary[f.key] === null ? '' : String(summary[f.key]);
      else input.value = '';
    });
    var apply = $('btn-apply-currency');
    if (apply) apply.disabled = !summary;
  }

  function applyCurrency() {
    if (!isLoaded()) {
      setStatus('먼저 세이브를 불러오세요.');
      return;
    }
    try {
      CURRENCY_FIELDS.forEach(function (f) {
        var input = $(f.id);
        if (!input) return;
        var raw = input.value;
        if (raw === '' || raw === null || raw === undefined) return;
        var v = parseInt(raw, 10);
        if (isNaN(v)) return;
        state.session.setCurrency(f.key, v);
      });
      renderAll();
      setStatus('통화/진행 정보를 적용했습니다.');
    } catch (err) {
      setStatus('적용 실패: ' + (err && err.message ? err.message : String(err)));
    }
  }

  function renderPartyGrid() {
    var grid = $('party-grid');
    if (!grid) return;
    clearNode(grid);

    var party = [];
    if (isLoaded()) {
      try { party = state.session.getParty() || []; } catch (e) { party = []; }
    }

    for (var i = 0; i < PARTY_SLOTS; i++) {
      (function (slotIndex) {
        var card = el('div', { class: 'party-card' });
        var selectId = 'party-slot-select-' + slotIndex;
        var label = el('label', { for: selectId, text: '슬롯 ' + (slotIndex + 1) });
        var select = el('select', { id: selectId });
        fillSelectWithCharacters(select, true, '-1: 없음');
        var current = party && party[slotIndex] !== undefined ? Number(party[slotIndex]) : -1;
        if (isNaN(current)) current = -1;
        select.value = String(current);
        select.disabled = !isLoaded();
        select.addEventListener('change', function () {
          if (!isLoaded()) return;
          try {
            state.session.setPartySlot(slotIndex, Number(select.value));
            renderHeaderBadges();
            renderOverview();
            setStatus('동료 슬롯 ' + (slotIndex + 1) + ' 변경');
          } catch (err) {
            setStatus('동료 변경 실패: ' + (err && err.message ? err.message : String(err)));
          }
        });

        var editBtn = el('button', {
          type: 'button',
          class: 'mini-btn',
          text: '편집',
          disabled: !isLoaded() || current < 0
        });
        editBtn.addEventListener('click', function () {
          if (current < 0) return;
          state.selectedCharId = current;
          activateTab('characters');
          renderCharacters();
          var search = $('char-search-input');
          if (search) search.value = '';
          renderCharacterList();
          renderCharacterDetail();
        });

        card.appendChild(label);
        card.appendChild(select);
        card.appendChild(editBtn);
        grid.appendChild(card);
      })(i);
    }
  }

  /* ------------------------------------------------------------------ *
   * 패널 2: 캐릭터
   * ------------------------------------------------------------------ */

  function setupCharacterControls() {
    var search = $('char-search-input');
    if (search) {
      search.addEventListener('input', function () { renderCharacterList(); });
    }

    var sect = $('char-sect-filter');
    if (sect) {
      clearNode(sect);
      sect.appendChild(el('option', { value: 'all', text: '전체 문파' }));
      catalogList('sects').forEach(function (s) {
        sect.appendChild(el('option', { value: String(s.id), text: charSectOptionText(s) }));
      });
      sect.addEventListener('change', function () { renderCharacterList(); });
    }

    var partyOnly = $('char-party-only');
    if (partyOnly) partyOnly.addEventListener('change', function () { renderCharacterList(); });

    function applyCharacterName() {
      if (state.selectedCharId < 0) return;
      try {
        var nameInput = $('char-name-input');
        var nickInput = $('char-nick-input');
        state.session.setCharacterName(state.selectedCharId, {
          name: nameInput ? nameInput.value : '',
          nick: nickInput ? nickInput.value : ''
        });
        renderAll();
        setStatus('이름을 적용했습니다.');
      } catch (err) {
        setStatus('이름 적용 실패: ' + (err && err.message ? err.message : String(err)));
      }
    }

    var applyName = $('btn-apply-char-name');
    if (applyName) applyName.addEventListener('click', applyCharacterName);

    var charNameForm = $('char-name-form');
    if (charNameForm) {
      charNameForm.addEventListener('submit', function (e) {
        e.preventDefault();
        applyCharacterName();
      });
    }

    var applyEquip = $('btn-apply-equip');
    if (applyEquip) {
      applyEquip.addEventListener('click', function () {
        if (state.selectedCharId < 0) return;
        try {
          var ids = [
            ['weapon', 'eq-weapon'],
            ['armor', 'eq-armor'],
            ['mount', 'eq-mount'],
            ['practiceItem', 'eq-practice-item']
          ];
          ids.forEach(function (pair) {
            var sel = $(pair[1]);
            if (!sel) return;
            var v = parseInt(sel.value, 10);
            if (isNaN(v)) return;
            state.session.setCharacterStat(state.selectedCharId, pair[0], v);
          });
          renderAll();
          setStatus('장비를 적용했습니다.');
        } catch (err) {
          setStatus('장비 적용 실패: ' + (err && err.message ? err.message : String(err)));
        }
      });
    }

    var applyStats = $('btn-apply-char-stats');
    if (applyStats) {
      applyStats.addEventListener('click', function () {
        if (state.selectedCharId < 0) return;
        var container = $('char-stats-container');
        if (!container) return;
        var fields = container.querySelectorAll('[data-stat-field]');
        var applied = 0;
        var failed = 0;
        for (var i = 0; i < fields.length; i++) {
          var input = fields[i];
          var field = input.getAttribute('data-stat-field');
          if (!field) continue;
          var v = parseInt(input.value, 10);
          if (isNaN(v)) { failed++; continue; }
          try {
            state.session.setCharacterStat(state.selectedCharId, field, v);
            applied++;
          } catch (e) {
            failed++;
          }
        }
        renderAll();
        setStatus('스탯 적용: ' + applied + '개' + (failed ? (' · 실패/무시 ' + failed + '개') : ''));
      });
    }

    var maxCombat = $('btn-char-max-combat');
    if (maxCombat) {
      maxCombat.addEventListener('click', function () {
        if (state.selectedCharId < 0) return;
        var pid = state.selectedCharId;
        var statFields = ['attack', 'defense', 'qinggong', 'hitRate', 'dodge', 'parry', 'shizhan',
          'fist', 'finger', 'sword', 'blade', 'specialWeapon', 'hiddenWeapon',
          'fistGrowth', 'fingerGrowth', 'swordGrowth', 'bladeGrowth', 'specialGrowth', 'hiddenGrowth',
          'maxHp', 'maxMp', 'hp', 'mp', 'zhenqi', 'wuxueKnowledge'];
        statFields.forEach(function (f) {
          var range = statRange(f);
          var v = range.max !== undefined ? range.max : 9999;
          try { state.session.setCharacterStat(pid, f, v); } catch (e) { /* noop */ }
        });
        renderAll();
        setStatus('전투 스탯을 최대로 설정했습니다.');
      });
    }

    var recover = $('btn-char-recover');
    if (recover) {
      recover.addEventListener('click', function () {
        if (state.selectedCharId < 0) return;
        var pid = state.selectedCharId;
        try {
          var ch = state.session.getCharacter(pid);
          state.session.setCharacterStat(pid, 'hp', num(ch.maxHp));
          state.session.setCharacterStat(pid, 'mp', num(ch.maxMp));
          state.session.setCharacterStat(pid, 'injury', 0);
          state.session.setCharacterStat(pid, 'poison', 0);
          state.session.setCharacterStat(pid, 'tili', 100);
          renderAll();
          setStatus('회복했습니다.');
        } catch (err) {
          setStatus('회복 실패: ' + (err && err.message ? err.message : String(err)));
        }
      });
    }

    var jumpMartial = $('btn-jump-martial');
    if (jumpMartial) {
      jumpMartial.addEventListener('click', function () {
        activateTab('martial');
        renderMartial();
      });
    }
  }

  function charSectOptionText(s) {
    var t = '[' + s.id + '] ' + textOf(s.ko);
    if (s.zh) t += ' (' + s.zh + ')';
    return t;
  }

  function statRange(field) {
    var ranges = Core.STAT_RANGES || {};
    var r = ranges[field];
    if (Array.isArray(r)) {
      return {
        min: r.length > 0 && !isNaN(Number(r[0])) ? Number(r[0]) : 0,
        max: r.length > 1 && !isNaN(Number(r[1])) ? Number(r[1]) : 9999
      };
    }
    if (r && typeof r === 'object') {
      return {
        min: typeof r.min === 'number' ? r.min : 0,
        max: typeof r.max === 'number' ? r.max : 9999
      };
    }
    return { min: 0, max: 9999 };
  }

  function renderCharacterList() {
    var list = $('char-list');
    var countEl = $('char-list-count');
    if (!list) return;
    clearNode(list);

    if (!isLoaded()) {
      if (countEl) countEl.textContent = '0명';
      list.appendChild(el('div', { class: 'muted', text: '세이브를 불러오면 캐릭터 목록이 표시됩니다.' }));
      return;
    }

    var queryEl = $('char-search-input');
    var sectEl = $('char-sect-filter');
    var partyEl = $('char-party-only');

    var query = queryEl ? queryEl.value : '';
    var sectFilter = sectEl ? sectEl.value : 'all';
    var partyOnly = partyEl ? !!partyEl.checked : false;

    var rows = [];
    try {
      rows = state.session.listCharacters({ query: query, partyOnly: partyOnly, sectFilter: sectFilter }) || [];
    } catch (e) {
      rows = [];
    }

    if (countEl) countEl.textContent = rows.length + '명';

    if (!rows.length) {
      list.appendChild(el('div', { class: 'muted', text: '조건에 맞는 캐릭터가 없습니다.' }));
      return;
    }

    var frag = document.createDocumentFragment();
    rows.forEach(function (r) {
      var pid = Number(r.personId);
      var label = '[' + r.id + '] ' + textOf(r.ko || r.zh || r.name);
      if (r.nickKo) label += ' · ' + r.nickKo;
      if (r.inParty) label += ' · 동료';
      var btn = el('button', {
        type: 'button',
        class: 'list-option',
        role: 'option',
        'aria-selected': pid === state.selectedCharId ? 'true' : 'false',
        'data-person-id': String(pid),
        text: label
      });
      if (pid === state.selectedCharId) btn.classList.add('selected');
      btn.addEventListener('click', function () {
        state.selectedCharId = pid;
        renderCharacters();
      });
      frag.appendChild(btn);
    });
    list.appendChild(frag);
  }

  function renderCharacters() {
    renderCharacterList();
    renderCharacterDetail();
    renderMartialCharSelect();
  }

  function renderCharacterDetail() {
    var header = $('char-detail-header');
    var container = $('char-stats-container');
    var nameInput = $('char-name-input');
    var nickInput = $('char-nick-input');

    var pid = state.selectedCharId;
    var ch = null;
    if (isLoaded() && pid >= 0) {
      try { ch = state.session.getCharacter(pid); } catch (e) { ch = null; }
    }

    if (!ch) {
      if (header) {
        var emptyName = header.querySelector('.char-name');
        var emptyMeta = header.querySelector('.char-meta');
        if (emptyName) emptyName.textContent = '캐릭터를 선택하세요';
        if (emptyMeta) emptyMeta.textContent = '';
      }
      if (container) {
        clearNode(container);
        container.appendChild(el('div', { class: 'muted', text: '왼쪽 목록에서 캐릭터를 선택하세요.' }));
      }
      if (nameInput) { nameInput.value = ''; nameInput.disabled = true; }
      if (nickInput) { nickInput.value = ''; nickInput.disabled = true; }
      ['eq-weapon', 'eq-armor', 'eq-mount', 'eq-practice-item'].forEach(function (id) {
        var sel = $(id);
        if (sel) { clearNode(sel); sel.disabled = true; }
      });
      var jumpBtn0 = $('btn-jump-martial');
      if (jumpBtn0) jumpBtn0.disabled = true;
      return;
    }

    if (header) {
      var nameEl = header.querySelector('.char-name');
      var metaEl = header.querySelector('.char-meta');
      if (nameEl) nameEl.textContent = '[' + ch.id + '] ' + textOf(ch.name || ch.ko);
      if (metaEl) metaEl.textContent = (ch.nick ? (' · ' + ch.nick) : '');
    }
    if (nameInput) { nameInput.disabled = false; nameInput.value = textOf(ch.name); }
    if (nickInput) { nickInput.disabled = false; nickInput.value = textOf(ch.nick); }

    var jumpBtn = $('btn-jump-martial');
    if (jumpBtn) jumpBtn.disabled = false;

    renderEquipSelects(ch);
    renderStatGroups(ch);
  }

  function buildEquipSelect(selectId, currentId, filterFn) {
    var sel = $(selectId);
    if (!sel) return;
    clearNode(sel);
    sel.appendChild(el('option', { value: '-1', text: '-1: 장착 안 함' }));

    var ids = [];
    catalogList('items').forEach(function (it) {
      if (filterFn && !filterFn(it)) return;
      ids.push(Number(it.id));
    });
    if (currentId !== undefined && currentId !== null) {
      var cid = Number(currentId);
      if (cid >= 0 && ids.indexOf(cid) === -1) ids.push(cid);
    }
    ids.sort(function (a, b) { return a - b; });

    ids.forEach(function (id) {
      var it = itemById.get(id);
      var label;
      if (it) {
        label = '[' + it.id + '] ' + textOf(it.ko);
        if (it.zh) label += ' (' + it.zh + ')';
        label += ' [' + equipSlotLabel(it.slot) + ']';
      } else {
        label = '[' + id + '] ???';
      }
      sel.appendChild(el('option', { value: String(id), text: label }));
    });

    var v = currentId === undefined || currentId === null ? -1 : Number(currentId);
    sel.value = String(v);
    sel.disabled = false;
  }

  function renderEquipSelects(ch) {
    buildEquipSelect('eq-weapon', ch.weapon, function (it) {
      return Number(it.slot) === 0;
    });
    buildEquipSelect('eq-armor', ch.armor, function (it) {
      return Number(it.slot) === 1;
    });
    buildEquipSelect('eq-mount', ch.mount, function (it) {
      return Number(it.slot) === 2;
    });
    buildEquipSelect('eq-practice-item', ch.practiceItem, function (it) {
      return Number(it.type) === 2;
    });
  }

  var STAT_GROUPS = [
    {
      title: '생명·상태',
      fields: ['level', 'exp', 'hp', 'maxHp', 'mp', 'maxMp', 'baseHp', 'baseMp', 'injury', 'poison', 'tili', 'zhenqi']
    },
    {
      title: '전투·보조',
      fields: ['attack', 'defense', 'qinggong', 'hitRate', 'dodge', 'parry', 'shizhan', 'aptitude',
        'constitution', 'zuoyouHubo', 'morality', 'fame', 'affection', 'xinmo']
    },
    {
      title: '병기 계수·성장',
      fields: ['fist', 'finger', 'sword', 'blade', 'specialWeapon', 'hiddenWeapon',
        'fistGrowth', 'fingerGrowth', 'swordGrowth', 'bladeGrowth', 'specialGrowth', 'hiddenGrowth']
    },
    {
      title: '의술·독·문파·포인트',
      fields: ['medical', 'usePoison', 'detox', 'antiPoison', 'poisonAttack', 'wuxueKnowledge',
        'wuxuePts', 'wuxueCap', 'tianfuPts', 'tianfuCap', 'sect', 'sectRank', 'sectContrib',
        'neiliType', 'gender', 'mainNeigongSlot', 'subNeigongSlot', 'mainQinggongSlot',
        'practicePts', 'itemPracticePts']
    }
  ];

  var FIELD_LABELS = {
    level: '레벨', exp: '경험치', hp: '체력', maxHp: '최대 체력', mp: '내력', maxMp: '최대 내력',
    baseHp: '기본 체력', baseMp: '기본 내력', injury: '부상', poison: '중독', tili: '기력', zhenqi: '진기',
    attack: '공격', defense: '방어', qinggong: '경공', hitRate: '명중', dodge: '회피', parry: '격수',
    shizhan: '실전', aptitude: '자질', constitution: '체질', zuoyouHubo: '좌우호박', morality: '도덕',
    fame: '명성', affection: '호감도', xinmo: '심마',
    fist: '권법', finger: '지법', sword: '검법', blade: '도법', specialWeapon: '특수병기', hiddenWeapon: '암기',
    fistGrowth: '권법 성장', fingerGrowth: '지법 성장', swordGrowth: '검법 성장', bladeGrowth: '도법 성장',
    specialGrowth: '특수 성장', hiddenGrowth: '암기 성장',
    medical: '의술', usePoison: '용독', detox: '해독', antiPoison: '항독', poisonAttack: '독공',
    wuxueKnowledge: '무학 지식', wuxuePts: '무학 포인트', wuxueCap: '무학 상한',
    tianfuPts: '천부 포인트', tianfuCap: '천부 상한', sect: '문파', sectRank: '문파 직위',
    sectContrib: '문파 공헌', neiliType: '내력 타입', gender: '성별',
    mainNeigongSlot: '주운 내공 ID', subNeigongSlot: '부운 내공 ID', mainQinggongSlot: '주운 경공 ID',
    practicePts: '연공 포인트', itemPracticePts: '아이템 연공 포인트'
  };

  function fieldLabel(field) {
    return FIELD_LABELS[field] || field;
  }

  function renderStatGroups(ch) {
    var container = $('char-stats-container');
    if (!container) return;
    clearNode(container);

    STAT_GROUPS.forEach(function (group) {
      var card = el('div', { class: 'stat-group' });
      card.appendChild(el('h3', { class: 'stat-group-title', text: group.title }));

      group.fields.forEach(function (field) {
        var row = el('div', { class: 'stat-row' });
        var inputId = 'stat-' + field;
        row.appendChild(el('label', { for: inputId, text: fieldLabel(field) }));

        var value = ch[field];
        var control;

        if (field === 'gender') {
          control = renderChoiceSelect(inputId, 'gender', value, catalogPairs('genders'));
        } else if (field === 'neiliType') {
          control = renderChoiceSelect(inputId, 'neiliType', value, catalogPairs('neiliTypes'));
        } else if (field === 'sect') {
          control = renderChoiceSelect(inputId, 'sect', value, catalogPairs('sects'));
        } else if (field === 'zuoyouHubo') {
          control = el('select', { id: inputId, 'data-stat-field': 'zuoyouHubo' });
          control.appendChild(el('option', { value: '0', text: '0: 없음' }));
          control.appendChild(el('option', { value: '1', text: '1: 있음' }));
          control.value = Number(value) ? '1' : '0';
        } else {
          var r = statRange(field);
          control = el('input', {
            id: inputId,
            type: 'number',
            'data-stat-field': field,
            min: String(r.min),
            max: String(r.max)
          });
          control.value = value === undefined || value === null ? '0' : String(value);
        }

        row.appendChild(control);
        card.appendChild(row);
      });

      container.appendChild(card);
    });
  }

  function renderChoiceSelect(inputId, field, value, list) {
    var sel = el('select', { id: inputId, 'data-stat-field': field });
    for (var i = 0; i < list.length; i++) {
      var g = list[i];
      var id;
      var label;
      if (g && typeof g === 'object') {
        id = g.id !== undefined ? g.id : i;
        label = g.ko !== undefined ? textOf(g.ko) : String(g.label !== undefined ? g.label : '');
        if (g.zh) label += ' (' + g.zh + ')';
      } else {
        id = i;
        label = String(g);
      }
      sel.appendChild(el('option', { value: String(id), text: label }));
    }
    sel.value = String(value === undefined || value === null ? 0 : value);
    return sel;
  }

  /* ------------------------------------------------------------------ *
   * 패널 3: 무공
   * ------------------------------------------------------------------ */

  function renderMartialCharSelect() {
    var sel = $('martial-char-select');
    if (!sel) return;
    var current = state.selectedCharId;
    clearNode(sel);
    sel.appendChild(el('option', { value: '-1', text: '-1: 선택 안 함' }));

    var opts = buildCharOptions();
    var frag = document.createDocumentFragment();
    for (var i = 0; i < opts.length; i++) {
      frag.appendChild(el('option', { value: String(opts[i].value), text: opts[i].label }));
    }
    sel.appendChild(frag);
    sel.value = String(current);
    if (!sel.__bound) {
      sel.__bound = true;
      sel.addEventListener('change', function () {
        state.selectedCharId = Number(sel.value);
        renderCharacters();
        renderMartial();
      });
    }
  }

  function currentCharacter() {
    if (!isLoaded() || state.selectedCharId < 0) return null;
    try { return state.session.getCharacter(state.selectedCharId); } catch (e) { return null; }
  }

  function renderMartial() {
    renderMartialCharSelect();

    var ch = currentCharacter();
    var summaryEl = $('martial-char-summary');
    var pid = state.selectedCharId;

    if (summaryEl) {
      if (!ch) summaryEl.textContent = '캐릭터를 선택하세요.';
      else summaryEl.textContent = '[' + ch.id + '] ' + textOf(ch.name || ch.ko) + ' · Lv ' + textOf(ch.level);
    }

    renderKungfuSlots(ch);
    renderMijiSlots(ch);
    renderTalents(ch);
    renderTalentCatalog();
    renderMeridians(ch);
    renderAcupoints(ch);

    var maxKfBtn = $('btn-martial-max-kf-levels');
    if (maxKfBtn) maxKfBtn.disabled = !ch;
    var openAll = $('btn-meridian-open-all');
    if (openAll) openAll.disabled = !ch;
    var resetAll = $('btn-meridian-reset-all');
    if (resetAll) resetAll.disabled = !ch;
  }

  function renderKungfuSlots(ch) {
    var tbody = $('kungfu-slots-tbody');
    if (!tbody) return;
    clearNode(tbody);

    var meta = {};
    try {
      var sum = isLoaded() ? state.session.getSummary() : null;
      if (sum && sum.rconfigMeta) meta = sum.rconfigMeta;
    } catch (e) { meta = {}; }

    var extraIds = Array.isArray(meta.kungfuIds) ? meta.kungfuIds : [];
    var ids = buildKungfuOptions(extraIds);

    var slots = ch && Array.isArray(ch.kungfuSlots) ? ch.kungfuSlots : [];
    var bySlot = {};
    slots.forEach(function (s) { bySlot[Number(s.slot)] = s; });

    for (var slot = 0; slot < 15; slot++) {
      (function (slotIndex) {
        var s = bySlot[slotIndex] || { id: 0, level: 0, ko: '', zh: '', type: '' };
        var tr = el('tr');

        tr.appendChild(el('td', { text: String(slotIndex) }));

        var sel = el('select', { class: 'kf-select', 'data-slot': String(slotIndex) });
        sel.appendChild(el('option', { value: '0', text: '0: 없음' }));
        ids.forEach(function (id) {
          var k = kungfuById.get(id);
          var label = '[' + id + '] ' + (k ? textOf(k.ko) : '???');
          sel.appendChild(el('option', { value: String(id), text: label }));
        });
        sel.value = String(Number(s.id) || 0);
        tr.appendChild(el('td', null, sel));

        tr.appendChild(el('td', { text: s.ko || (s.id ? (kungfuById.get(Number(s.id)) ? kungfuById.get(Number(s.id)).ko : '') : '-') }));

        var lv = el('input', {
          type: 'number',
          min: '0',
          max: '999',
          class: 'kf-level',
          'data-slot': String(slotIndex)
        });
        lv.value = String(Number(s.level) || 0);
        tr.appendChild(el('td', null, lv));

        var kf = kungfuById.get(Number(s.id));
        var typeText = '-';
        if (kf) {
          typeText = kungfuTypeLabel(kf.type) + ' / ' + neiliLabel(kf.neili);
        }
        tr.appendChild(el('td', { text: typeText }));

        var applyBtn = el('button', { type: 'button', class: 'mini-btn', text: '적용', disabled: !ch });
        applyBtn.addEventListener('click', function () {
          if (!ch) return;
          try {
            var kfId = parseInt(sel.value, 10);
            var level = parseInt(lv.value, 10);
            if (isNaN(kfId)) kfId = 0;
            if (isNaN(level)) level = 0;
            state.session.setCharacterKungfuSlot(pidOf(ch), slotIndex, kfId, clamp(level, 0, 999));
            renderAll();
            setStatus('무공 슬롯 ' + slotIndex + ' 적용');
          } catch (err) {
            setStatus('무공 적용 실패: ' + (err && err.message ? err.message : String(err)));
          }
        });

        var clearBtn = el('button', { type: 'button', class: 'mini-btn', text: '비우기', disabled: !ch });
        clearBtn.addEventListener('click', function () {
          if (!ch) return;
          try {
            state.session.setCharacterKungfuSlot(pidOf(ch), slotIndex, 0, 0);
            renderAll();
            setStatus('무공 슬롯 ' + slotIndex + ' 비움');
          } catch (err) {
            setStatus('무공 비우기 실패: ' + (err && err.message ? err.message : String(err)));
          }
        });

        tr.appendChild(el('td', null, [applyBtn, document.createTextNode(' '), clearBtn]));
        tbody.appendChild(tr);
      })(slot);
    }

    var maxBtn = $('btn-martial-max-kf-levels');
    if (maxBtn && !maxBtn.__bound) {
      maxBtn.__bound = true;
      maxBtn.addEventListener('click', function () {
        var c = currentCharacter();
        if (!c) return;
        var pid = pidOf(c);
        var list = Array.isArray(c.kungfuSlots) ? c.kungfuSlots : [];
        list.forEach(function (s) {
          if (Number(s.id) > 0) {
            try { state.session.setCharacterKungfuSlot(pid, Number(s.slot), Number(s.id), 999); } catch (e) { /* noop */ }
          }
        });
        renderAll();
        setStatus('모든 무공 레벨을 999로 설정했습니다.');
      });
    }
  }

  function pidOf(ch) {
    return Number(ch.personId !== undefined ? ch.personId : ch.id);
  }

  function renderMijiSlots(ch) {
    var tbody = $('miji-slots-tbody');
    if (!tbody) return;
    clearNode(tbody);

    var meta = {};
    try {
      var sum = isLoaded() ? state.session.getSummary() : null;
      if (sum && sum.rconfigMeta) meta = sum.rconfigMeta;
    } catch (e) { meta = {}; }

    var extra = Array.isArray(meta.mijiIds) ? meta.mijiIds : [];
    var ids = knownMijiIds(extra);

    var slots = ch && Array.isArray(ch.mijiSlots) ? ch.mijiSlots : [];
    var bySlot = {};
    slots.forEach(function (s) { bySlot[Number(s.slot)] = s; });

    for (var slot = 0; slot < 10; slot++) {
      (function (slotIndex) {
        var s = bySlot[slotIndex] || { id: 0, ko: '', zh: '' };
        var tr = el('tr');

        tr.appendChild(el('td', { text: String(slotIndex) }));

        var sel = el('select', { class: 'miji-select', 'data-slot': String(slotIndex) });
        sel.appendChild(el('option', { value: '0', text: '0: 없음' }));
        ids.forEach(function (id) {
          var m = mijiById.get(id);
          var label = '[' + id + '] ' + (m ? textOf(m.ko) : '???');
          sel.appendChild(el('option', { value: String(id), text: label }));
        });
        sel.value = String(Number(s.id) || 0);
        tr.appendChild(el('td', null, sel));

        var miji = mijiById.get(Number(s.id));
        tr.appendChild(el('td', { text: s.ko || (miji ? miji.ko : '-') }));

        var countText = '-';
        if (miji && Number(miji.skillCount) > 0) countText = '연계 ' + miji.skillCount;
        tr.appendChild(el('td', { text: countText }));

        var applyBtn = el('button', { type: 'button', class: 'mini-btn', text: '적용', disabled: !ch });
        applyBtn.addEventListener('click', function () {
          if (!ch) return;
          try {
            var mid = parseInt(sel.value, 10);
            if (isNaN(mid)) mid = 0;
            state.session.setCharacterMijiSlot(pidOf(ch), slotIndex, mid);
            renderAll();
            setStatus('비기 슬롯 ' + slotIndex + ' 적용');
          } catch (err) {
            setStatus('비기 적용 실패: ' + (err && err.message ? err.message : String(err)));
          }
        });

        var clearBtn = el('button', { type: 'button', class: 'mini-btn', text: '비우기', disabled: !ch });
        clearBtn.addEventListener('click', function () {
          if (!ch) return;
          try {
            state.session.setCharacterMijiSlot(pidOf(ch), slotIndex, 0);
            renderAll();
            setStatus('비기 슬롯 ' + slotIndex + ' 비움');
          } catch (err) {
            setStatus('비기 비우기 실패: ' + (err && err.message ? err.message : String(err)));
          }
        });

        tr.appendChild(el('td', null, [applyBtn, document.createTextNode(' '), clearBtn]));
        tbody.appendChild(tr);
      })(slot);
    }
  }

  function talentChip(t, equipped, listName) {
    var label = '[' + t.id + '] ' + textOf(t.ko);
    if (t.zh) label += ' (' + t.zh + ')';
    var metaBits = [];
    if (t.tier !== undefined) metaBits.push(String(t.tier) + '성');
    if (t.cost !== undefined) metaBits.push('비용 ' + t.cost);
    if (metaBits.length) label += ' · ' + metaBits.join(' / ');

    var chip = el('div', { class: 'talent-chip', 'data-talent-id': String(t.id) });
    chip.appendChild(el('span', { class: 'talent-chip-label', text: label }));

    if (listName === 'sptf') {
      var toggle = el('button', {
        type: 'button',
        class: 'mini-btn',
        text: equipped ? '장착됨' : '미장착'
      });
      toggle.setAttribute('aria-pressed', equipped ? 'true' : 'false');
      toggle.addEventListener('click', function () {
        var c = currentCharacter();
        if (!c) return;
        try {
          state.session.toggleSptfEquipped(pidOf(c), Number(t.id));
          renderMartial();
          renderHeaderBadges();
        } catch (err) {
          setStatus('천부 토글 실패: ' + (err && err.message ? err.message : String(err)));
        }
      });
      chip.appendChild(toggle);
    }

    var remove = el('button', { type: 'button', class: 'mini-btn', text: '삭제' });
    remove.addEventListener('click', function () {
      var c = currentCharacter();
      if (!c) return;
      try {
        state.session.removeTalent(pidOf(c), Number(t.id), { list: listName });
        renderMartial();
        renderHeaderBadges();
      } catch (err) {
        setStatus('천부 삭제 실패: ' + (err && err.message ? err.message : String(err)));
      }
    });
    chip.appendChild(remove);
    return chip;
  }

  function renderTalents(ch) {
    var ptfList = $('ptf-list');
    var sptfList = $('sptf-list');
    var target = $('talent-target-list');

    if (target) {
      var targetText = ch ? ('대상: [' + ch.id + '] ' + textOf(ch.name || ch.ko)) : '대상: 없음';
      if (target.tagName && String(target.tagName).toLowerCase() === 'select') {
        var changed = false;
        for (var ti = 0; ti < target.options.length; ti++) {
          var opt = target.options[ti];
          var ov = String(opt.value || '');
          if (ov === 'ptf') opt.textContent = targetText + ' · 일반 천부';
          else if (ov === 'sptf') opt.textContent = targetText + ' · 특수 천부';
          else if (ov === 'sptf-unequipped') opt.textContent = targetText + ' · 미장착 특수';
          if (opt.selected) changed = true;
        }
        if (!changed && target.options.length) target.selectedIndex = 0;
      } else {
        target.textContent = targetText;
      }
    }

    if (!ptfList || !sptfList) return;
    clearNode(ptfList);
    clearNode(sptfList);

    if (!ch) {
      ptfList.appendChild(el('div', { class: 'muted', text: '캐릭터를 선택하세요.' }));
      sptfList.appendChild(el('div', { class: 'muted', text: '캐릭터를 선택하세요.' }));
      return;
    }

    var talents = null;
    try { talents = state.session.getCharacterTalents(pidOf(ch)); } catch (e) { talents = null; }
    var ptf = talents && Array.isArray(talents.ptf) ? talents.ptf : [];
    var sptf = talents && Array.isArray(talents.sptf) ? talents.sptf : [];

    if (!ptf.length) ptfList.appendChild(el('div', { class: 'muted', text: '없음' }));
    else {
      ptf.forEach(function (t) {
        var info = talentById.get(Number(t.id)) || t;
        ptfList.appendChild(talentChip(info, false, 'ptf'));
      });
    }

    if (!sptf.length) sptfList.appendChild(el('div', { class: 'muted', text: '없음' }));
    else {
      sptf.forEach(function (t) {
        var info = talentById.get(Number(t.id)) || t;
        sptfList.appendChild(talentChip(info, !!t.equipped, 'sptf'));
      });
    }
  }

  function renderTalentCatalog() {
    var tbody = $('talent-catalog-tbody');
    if (!tbody) return;
    clearNode(tbody);

    var q = ($('talent-search-input') || {}).value || '';
    var query = String(q).trim().toLowerCase();

    var list = catalogList('talents').filter(function (t) {
      if (!query) return true;
      var hay = (textOf(t.ko) + ' ' + textOf(t.zh) + ' ' + textOf(t.descKo) + ' ' + t.id).toLowerCase();
      return hay.indexOf(query) !== -1;
    }).slice(0, 100);

    if (!list.length) {
      tbody.appendChild(el('tr', null, el('td', { colspan: '5', class: 'muted', text: '검색 결과 없음' })));
      return;
    }

    list.forEach(function (t) {
      var tr = el('tr');
      tr.appendChild(el('td', { text: String(t.id) }));
      tr.appendChild(el('td', { text: textOf(t.ko) + (t.zh ? ' (' + t.zh + ')' : '') }));
      tr.appendChild(el('td', { text: (t.tier !== undefined ? (t.tier + '성') : '-') + ' / ' + (t.cost !== undefined ? ('비용 ' + t.cost) : '-') }));
      tr.appendChild(el('td', { text: textOf(t.descKo) }));

      var addBtn = el('button', { type: 'button', class: 'mini-btn', text: '추가', disabled: !currentCharacter() });
      addBtn.addEventListener('click', function () {
        var c = currentCharacter();
        if (!c) {
          setStatus('캐릭터를 먼저 선택하세요.');
          return;
        }
        try {
          var targetSel = $('talent-target-list');
          var targetList = targetSel && targetSel.value ? String(targetSel.value) : '';
          var listName = targetList || ((String(t.kind || '').toLowerCase().indexOf('s') === 0) ? 'sptf' : 'ptf');
          if (listName !== 'ptf' && listName !== 'sptf') listName = 'ptf';
          state.session.addTalent(pidOf(c), Number(t.id), { list: listName, equipped: false });
          renderMartial();
          renderHeaderBadges();
          setStatus('천부 추가: ' + textOf(t.ko));
        } catch (err) {
          setStatus('천부 추가 실패: ' + (err && err.message ? err.message : String(err)));
        }
      });
      tr.appendChild(el('td', null, addBtn));
      tbody.appendChild(tr);
    });
  }

  function renderMeridians(ch) {
    var grid = $('meridians-grid');
    if (!grid) return;
    clearNode(grid);

    var list = catalogList('meridians');
    var byIndex = {};
    if (ch && Array.isArray(ch.meridians)) {
      ch.meridians.forEach(function (m) { byIndex[Number(m.index)] = m; });
    }

    list.forEach(function (m) {
      var idx = Number(m.id) - 1;
      if (idx < 0) idx = Number(m.id);
      var cur = byIndex[idx] || {};
      var card = el('div', { class: 'meridian-card' });
      card.appendChild(el('div', { class: 'meridian-title', text: textOf(m.ko) + (m.zh ? ' (' + m.zh + ')' : '') }));

      var shun = el('input', { type: 'checkbox', id: 'meridian-shun-' + idx, disabled: !ch });
      shun.checked = !!cur.shun;
      shun.addEventListener('change', function () {
        var c = currentCharacter();
        if (!c) return;
        try {
          state.session.setCharacterMeridian(pidOf(c), idx, 'shun', shun.checked ? 1 : 0);
          renderHeaderBadges();
          renderAcupoints(currentCharacter());
        } catch (err) {
          setStatus('순통 변경 실패: ' + (err && err.message ? err.message : String(err)));
        }
      });

      var ni = el('input', { type: 'checkbox', id: 'meridian-ni-' + idx, disabled: !ch });
      ni.checked = !!cur.ni;
      ni.addEventListener('change', function () {
        var c = currentCharacter();
        if (!c) return;
        try {
          state.session.setCharacterMeridian(pidOf(c), idx, 'ni', ni.checked ? 1 : 0);
          renderHeaderBadges();
        } catch (err) {
          setStatus('역통 변경 실패: ' + (err && err.message ? err.message : String(err)));
        }
      });

      card.appendChild(el('label', { for: 'meridian-shun-' + idx }, ['순통 ', shun]));
      card.appendChild(el('label', { for: 'meridian-ni-' + idx }, ['역통 ', ni]));
      grid.appendChild(card);
    });

    var openAll = $('btn-meridian-open-all');
    if (openAll && !openAll.__bound) {
      openAll.__bound = true;
      openAll.addEventListener('click', function () {
        var c = currentCharacter();
        if (!c) return;
        try {
          state.session.setAllMeridians(pidOf(c), 'shun', 1);
          state.session.setAllMeridians(pidOf(c), 'ni', 1);
          state.session.setAllAcupoints(pidOf(c), 1);
          renderAll();
          setStatus('경락/혈도를 모두 개방했습니다.');
        } catch (err) {
          setStatus('경락 개방 실패: ' + (err && err.message ? err.message : String(err)));
        }
      });
    }

    var resetAll = $('btn-meridian-reset-all');
    if (resetAll && !resetAll.__bound) {
      resetAll.__bound = true;
      resetAll.addEventListener('click', function () {
        var c = currentCharacter();
        if (!c) return;
        try {
          state.session.setAllMeridians(pidOf(c), 'shun', 0);
          state.session.setAllMeridians(pidOf(c), 'ni', 0);
          state.session.setAllAcupoints(pidOf(c), 0);
          renderAll();
          setStatus('경락/혈도를 초기화했습니다.');
        } catch (err) {
          setStatus('경락 초기화 실패: ' + (err && err.message ? err.message : String(err)));
        }
      });
    }
  }

  function renderAcupoints(ch) {
    var grid = $('acupoints-grid');
    var summary = $('acupoints-summary');
    if (!grid) return;
    clearNode(grid);

    var open = 0;
    var flags = ch && Array.isArray(ch.acupoints) ? ch.acupoints : [];
    if (ch && typeof ch.acupointsOpenCount === 'number') open = ch.acupointsOpenCount;
    else {
      for (var i = 0; i < flags.length; i++) if (Number(flags[i])) open++;
    }

    if (summary) summary.textContent = '개방 ' + open + ' / 164';

    for (var idx = 0; idx < 164; idx++) {
      (function (i2) {
        var on = !!Number(flags[i2]);
        var btn = el('button', {
          type: 'button',
          class: 'acupoint-pill',
          'aria-pressed': on ? 'true' : 'false',
          'data-idx': String(i2),
          text: String(i2 + 1),
          disabled: !ch
        });
        if (on) btn.classList.add('open');
        btn.addEventListener('click', function () {
          var c = currentCharacter();
          if (!c) return;
          var next = btn.getAttribute('aria-pressed') === 'true' ? 0 : 1;
          try {
            state.session.setCharacterAcupoint(pidOf(c), i2, next);
            renderAcupoints(currentCharacter());
            renderHeaderBadges();
          } catch (err) {
            setStatus('혈도 변경 실패: ' + (err && err.message ? err.message : String(err)));
          }
        });
        grid.appendChild(btn);
      })(idx);
    }
  }

  function setupMartialControls() {
    var search = $('talent-search-input');
    if (search) search.addEventListener('input', function () { renderTalentCatalog(); });
  }

  /* ------------------------------------------------------------------ *
   * 패널 4: 소지품
   * ------------------------------------------------------------------ */

  function invUsageText() {
    var count = 0;
    try {
      if (isLoaded()) {
        var rows = state.session.getInventory({ query: '', typeFilter: 'all' });
        count = Array.isArray(rows) ? rows.length : 0;
      }
    } catch (e) { count = 0; }
    return count + ' / ' + MAX_ACTIVE_INVENTORY + '칸';
  }

  function renderInventory() {
    var badge = $('inv-usage-badge');
    if (badge) badge.textContent = invUsageText();

    renderInventoryOwned();
    renderInventoryCatalog();
  }

  function currentInventoryMap() {
    var map = new Map();
    if (!isLoaded()) return map;
    try {
      var rows = state.session.getInventory({ query: '', typeFilter: 'all' }) || [];
      rows.forEach(function (r) {
        map.set(Number(r.itemId), Number(r.count));
      });
    } catch (e) { /* noop */ }
    return map;
  }

  function renderInventoryOwned() {
    var tbody = $('inv-owned-tbody');
    if (!tbody) return;
    clearNode(tbody);

    if (!isLoaded()) {
      tbody.appendChild(el('tr', null, el('td', { colspan: '6', class: 'muted', text: '세이브를 불러오면 소지품이 표시됩니다.' })));
      return;
    }

    var q = ($('inv-search-input') || {}).value || '';
    var typeSel = $('inv-type-filter');
    var typeFilter = typeSel ? typeSel.value : 'all';

    var rows = [];
    try {
      rows = state.session.getInventory({ query: q, typeFilter: typeFilter }) || [];
    } catch (e) {
      rows = [];
    }

    if (!rows.length) {
      tbody.appendChild(el('tr', null, el('td', { colspan: '6', class: 'muted', text: '소지품이 없습니다.' })));
      return;
    }

    rows.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', { text: String(r.slot) }));
      tr.appendChild(el('td', { text: String(r.itemId) }));
      tr.appendChild(el('td', { text: textOf(r.ko) + (r.zh ? ' (' + r.zh + ')' : '') }));
      tr.appendChild(el('td', { text: itemTypeLabel(r.type) + (r.equipSlot !== undefined && r.equipSlot >= 0 ? (' / ' + equipSlotLabel(r.equipSlot)) : '') }));

      var countInput = el('input', {
        type: 'number',
        min: '0',
        max: '30000',
        class: 'inv-count-input',
        'data-item-id': String(r.itemId)
      });
      countInput.value = String(r.count);
      if (Number(r.itemId) === 174) {
        countInput.disabled = true;
        countInput.title = '은량은 통화(CC.Gold) 필드와 동기화됩니다.';
      }
      tr.appendChild(el('td', null, countInput));

      var applyBtn = el('button', { type: 'button', class: 'mini-btn', text: '적용', disabled: Number(r.itemId) === 174 });
      applyBtn.addEventListener('click', function () {
        try {
          var v = parseInt(countInput.value, 10);
          if (isNaN(v)) v = 0;
          state.session.setInventoryItem(Number(r.itemId), clamp(v, 0, 30000));
          renderAll();
          setStatus('아이템 ' + r.itemId + ' 수량 적용');
        } catch (err) {
          setStatus('수량 적용 실패: ' + (err && err.message ? err.message : String(err)));
        }
      });

      var removeBtn = el('button', { type: 'button', class: 'mini-btn', text: '삭제' });
      removeBtn.addEventListener('click', function () {
        try {
          state.session.removeInventoryItem(Number(r.itemId));
          renderAll();
          setStatus('아이템 ' + r.itemId + ' 삭제');
        } catch (err) {
          setStatus('삭제 실패: ' + (err && err.message ? err.message : String(err)));
        }
      });

      tr.appendChild(el('td', null, [applyBtn, document.createTextNode(' '), removeBtn]));
      tbody.appendChild(tr);
    });
  }

  function renderInventoryCatalog() {
    var tbody = $('cat-items-tbody');
    if (!tbody) return;
    clearNode(tbody);

    var q = ($('cat-item-search') || {}).value || '';
    var typeSel = $('cat-item-type');
    var typeFilter = typeSel ? typeSel.value : 'all';
    var query = String(q).trim().toLowerCase();

    var owned = currentInventoryMap();

    var list = catalogList('items').filter(function (it) {
      if (typeFilter !== 'all' && String(it.type) !== String(typeFilter)) return false;
      if (!query) return true;
      var hay = (textOf(it.ko) + ' ' + textOf(it.zh) + ' ' + textOf(it.descKo) + ' ' + it.id).toLowerCase();
      return hay.indexOf(query) !== -1;
    }).slice(0, 120);

    var countEl = $('cat-item-count');
    if (countEl && countEl.tagName && String(countEl.tagName).toLowerCase() === 'input') {
      countEl.value = String(state.invAddCount || countEl.value || 1);
    } else if (countEl) {
      countEl.textContent = list.length + '개 표시';
    }

    if (!list.length) {
      tbody.appendChild(el('tr', null, el('td', { colspan: '5', class: 'muted', text: '검색 결과 없음' })));
      return;
    }

    list.forEach(function (it) {
      var tr = el('tr');
      tr.appendChild(el('td', { text: String(it.id) }));
      tr.appendChild(el('td', { text: textOf(it.ko) + (it.zh ? ' (' + it.zh + ')' : '') }));
      tr.appendChild(el('td', { text: itemTypeLabel(it.type) }));
      tr.appendChild(el('td', { text: it.slot !== undefined && Number(it.slot) >= 0 ? equipSlotLabel(it.slot) : '30,000' }));

      var addBtn = el('button', { type: 'button', class: 'mini-btn', text: '추가', disabled: !isLoaded() });
      addBtn.addEventListener('click', function () {
        if (!isLoaded()) {
          setStatus('먼저 세이브를 불러오세요.');
          return;
        }
        try {
          var countInput = $('cat-item-count');
          var addCount = 1;
          if (countInput) {
            if (countInput.tagName && String(countInput.tagName).toLowerCase() === 'input') {
              addCount = Math.max(1, Number(countInput.value) || 1);
            } else {
              addCount = Math.max(1, Number(state.invAddCount) || 1);
            }
          }
          state.invAddCount = addCount;
          var current = owned.has(Number(it.id)) ? owned.get(Number(it.id)) : 0;
          if (Number(it.id) === 174) {
            state.session.setInventoryItem(174, 0);
            var curGold = 0;
            try {
              var inv = state.session.getInventory ? state.session.getInventory() : null;
              curGold = inv && inv.gold !== undefined ? Number(inv.gold) : 0;
            } catch (eg) { curGold = 0; }
            state.session.setCurrency('gold', curGold + addCount);
          } else {
            state.session.setInventoryItem(Number(it.id), clamp(current + addCount, 0, 30000));
          }
          renderAll();
          setStatus('아이템 추가: ' + textOf(it.ko));
        } catch (err) {
          setStatus('아이템 추가 실패: ' + (err && err.message ? err.message : String(err)));
        }
      });

      tr.appendChild(el('td', null, addBtn));
      tbody.appendChild(tr);
    });
  }

  function setupInventoryControls() {
    var search = $('inv-search-input');
    if (search) search.addEventListener('input', function () { renderInventoryOwned(); });

    var typeFilter = $('inv-type-filter');
    if (typeFilter) {
      clearNode(typeFilter);
      typeFilter.appendChild(el('option', { value: 'all', text: '전체 분류' }));
      catalogPairs('itemTypes').forEach(function (t) {
        typeFilter.appendChild(el('option', { value: String(t.id), text: t.label }));
      });
      typeFilter.addEventListener('change', function () { renderInventoryOwned(); });
    }

    var catSearch = $('cat-item-search');
    if (catSearch) catSearch.addEventListener('input', function () { renderInventoryCatalog(); });

    var catType = $('cat-item-type');
    if (catType) {
      clearNode(catType);
      catType.appendChild(el('option', { value: 'all', text: '전체 분류' }));
      catalogPairs('itemTypes').forEach(function (t) {
        catType.appendChild(el('option', { value: String(t.id), text: t.label }));
      });
      catType.addEventListener('change', function () { renderInventoryCatalog(); });
    }
  }

  /* ------------------------------------------------------------------ *
   * 패널 5: 도감 (세이브 없이도 동작)
   * ------------------------------------------------------------------ */

  function renderAtlas() {
    renderAtlasTechnical();
    renderAtlasCombatFormulas();
    renderAtlasSurvival();
    renderAtlasRecords();
  }

  function atlasSearchQuery() {
    var input = $('atlas-search-input');
    return input ? String(input.value || '').trim().toLowerCase() : '';
  }

  function renderAtlasTechnical() {
    var host = $('atlas-technical-cards');
    if (!host) return;
    clearNode(host);

    var atlas = Catalog.codeAtlas || {};
    var technical = Array.isArray(atlas.technical) ? atlas.technical : [];
    var q = atlasSearchQuery();

    var items = technical.filter(function (t) {
      if (!q) return true;
      return (textOf(t.key) + ' ' + textOf(t.summary)).toLowerCase().indexOf(q) !== -1;
    });

    if (!items.length) {
      host.appendChild(el('div', { class: 'muted', text: '기술 문서가 없습니다.' }));
      return;
    }

    items.forEach(function (t) {
      var card = el('div', { class: 'atlas-card' });
      card.appendChild(el('h3', { text: textOf(t.key) }));
      card.appendChild(el('p', { text: textOf(t.summary) }));
      host.appendChild(card);
    });
  }

  function renderAtlasCombatFormulas() {
    var host = $('atlas-combat-cards');
    if (!host) return;
    clearNode(host);

    var atlas = Catalog.codeAtlas || {};
    var formulas = Array.isArray(atlas.combatFormulas) ? atlas.combatFormulas : [];
    var q = atlasSearchQuery();

    var items = formulas.filter(function (f) {
      if (!q) return true;
      var hay = (textOf(f.id) + ' ' + textOf(f.source) + ' ' + textOf(f.title) + ' ' + textOf(f.formula) + ' ' + textOf(f.clamp) + ' ' + textOf(f.notes)).toLowerCase();
      return hay.indexOf(q) !== -1;
    });

    if (!items.length) {
      host.appendChild(el('div', { class: 'muted', text: '일치하는 전투 공식이 없습니다.' }));
      return;
    }

    items.forEach(function (f) {
      var card = el('div', { class: 'atlas-card' });
      var titleEl = el('h3', null, [
        el('span', { text: textOf(f.title || f.id) }),
        el('span', { class: 'code', text: textOf(f.id) })
      ]);
      var dl = el('dl');
      dl.appendChild(el('dt', { text: '출처' }));
      dl.appendChild(el('dd', { class: 'mono', text: textOf(f.source) }));
      dl.appendChild(el('dt', { text: '공식' }));
      dl.appendChild(el('dd', { class: 'mono', text: textOf(f.formula) }));
      if (f.clamp) {
        dl.appendChild(el('dt', { text: '상한/클램프' }));
        dl.appendChild(el('dd', { text: textOf(f.clamp) }));
      }
      if (f.notes) {
        dl.appendChild(el('dt', { text: '비고' }));
        dl.appendChild(el('dd', { text: textOf(f.notes) }));
      }
      card.appendChild(titleEl);
      card.appendChild(dl);
      host.appendChild(card);
    });
  }

  function renderAtlasSurvival() {
    var tbody = $('atlas-survival-tbody');
    if (!tbody) return;
    clearNode(tbody);

    var atlas = Catalog.codeAtlas || {};
    var list = Array.isArray(atlas.survivalChecklist) ? atlas.survivalChecklist : [];
    var q = atlasSearchQuery();

    var rows = list.filter(function (r) {
      if (!q) return true;
      return (textOf(r.targetKo) + ' ' + textOf(r.deadline) + ' ' + textOf(r.requirement)).toLowerCase().indexOf(q) !== -1;
    });

    if (!rows.length) {
      tbody.appendChild(el('tr', null, el('td', { colspan: '4', class: 'muted', text: '항목 없음' })));
      return;
    }

    rows.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', { text: textOf(r.id) }));
      tr.appendChild(el('td', { text: textOf(r.targetKo) }));
      tr.appendChild(el('td', { text: textOf(r.deadline) }));
      tr.appendChild(el('td', { text: textOf(r.requirement) }));
      tbody.appendChild(tr);
    });
  }

  function renderAtlasRecords() {
    var tbody = $('atlas-records-tbody');
    if (!tbody) return;
    clearNode(tbody);

    var atlas = Catalog.codeAtlas || {};
    var records = Array.isArray(atlas.records) ? atlas.records.slice() : [];
    var q = atlasSearchQuery();

    function pushRows(list, kind) {
      list.forEach(function (r) {
        records.push({ code: r.id, kind: kind, name: r.ko, desc: r.descKo || r.zh || '' });
      });
    }

    if (records.length === 0) {
      pushRows(catalogList('kungfu'), '무공');
      pushRows(catalogList('items'), '아이템');
      pushRows(catalogList('talents'), '천부');
      catalogList('characters').forEach(function (c) {
        records.push({ code: c.id, kind: '캐릭터', name: c.ko, desc: c.nickKo || c.zh || '' });
      });
    }

    var filtered = records.filter(function (r) {
      if (!q) return true;
      var rName = r.name || r.ko || '';
      var rDesc = r.desc || r.summary || '';
      return (textOf(r.code) + ' ' + textOf(r.kind) + ' ' + textOf(rName) + ' ' + textOf(rDesc)).toLowerCase().indexOf(q) !== -1;
    }).slice(0, 120);

    if (!filtered.length) {
      tbody.appendChild(el('tr', null, el('td', { colspan: '4', class: 'muted', text: '검색 결과 없음' })));
      return;
    }

    filtered.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', { text: textOf(r.code) }));
      tr.appendChild(el('td', { text: textOf(r.kind) }));
      tr.appendChild(el('td', { text: textOf(r.name || r.ko) }));
      tr.appendChild(el('td', { text: textOf(r.desc || r.summary) }));
      tbody.appendChild(tr);
    });
  }

  function setupAtlasControls() {
    var input = $('atlas-search-input');
    if (input) input.addEventListener('input', function () { renderAtlas(); });
  }

  /* ------------------------------------------------------------------ *
   * 변경 내역 다이얼로그
   * ------------------------------------------------------------------ */

  function openChangesDialog() {
    var dialog = $('changes-dialog');
    if (!dialog) return;
    renderChangesTable();
    try {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } catch (e) {
      dialog.setAttribute('open', '');
    }
  }

  function closeChangesDialog() {
    var dialog = $('changes-dialog');
    if (!dialog) return;
    try {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    } catch (e) {
      dialog.removeAttribute('open');
    }
  }

  function renderChangesTable() {
    var tbody = $('changes-tbody');
    if (!tbody) return;
    clearNode(tbody);

    var changes = null;
    try { changes = state.session ? state.session.getChanges() : null; } catch (e) { changes = null; }
    var items = changes && Array.isArray(changes.items) ? changes.items : [];

    if (!items.length) {
      tbody.appendChild(el('tr', null, el('td', { colspan: '6', class: 'muted', text: '변경 내역이 없습니다.' })));
      return;
    }

    items.forEach(function (c, i) {
      var tr = el('tr');
      tr.appendChild(el('td', { text: String(i + 1) }));
      tr.appendChild(el('td', { text: textOf(c.target) }));
      tr.appendChild(el('td', { text: textOf(c.field) }));
      tr.appendChild(el('td', { text: textOf(c.before) }));
      tr.appendChild(el('td', { text: textOf(c.after) }));
      tr.appendChild(el('td', { text: textOf(c.dirtyTarget) }));
      tbody.appendChild(tr);
    });
  }

  function setupChangesDialog() {
    var review = $('btn-review-changes');
    if (review) review.addEventListener('click', openChangesDialog);

    var closeBtn = $('btn-close-changes-dialog');
    if (closeBtn) closeBtn.addEventListener('click', closeChangesDialog);

    var dialog = $('changes-dialog');
    if (dialog) {
      dialog.addEventListener('click', function (e) {
        if (e.target === dialog) closeChangesDialog();
      });
    }

    var resetBtn = $('btn-reset-changes');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        try {
          if (state.session && typeof state.session.resetChanges === 'function') state.session.resetChanges();
          renderAll();
          renderChangesTable();
          setStatus('변경 내역을 초기화했습니다.');
        } catch (err) {
          setStatus('초기화 실패: ' + (err && err.message ? err.message : String(err)));
        }
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * 파일 입력 / 드래그 앤 드롭 / 툴바
   * ------------------------------------------------------------------ */

  function setupFileControls() {
    var fileInput = $('file-input');
    var openBtn = $('btn-open-file');
    if (openBtn && fileInput) {
      openBtn.addEventListener('click', function () { fileInput.click(); });
    }
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        var f = fileInput.files && fileInput.files[0];
        if (f) handleFile(f);
        try { fileInput.value = ''; } catch (e) { /* noop */ }
      });
    }

    var demoBtn = $('btn-load-demo');
    if (demoBtn) demoBtn.addEventListener('click', function () { openDemoSave(); });

    var downloadBtn = $('btn-download-sav');
    if (downloadBtn) downloadBtn.addEventListener('click', function () { handleDownload(); });

    document.addEventListener('dragover', function (e) {
      if (e.dataTransfer && e.dataTransfer.types && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1) {
        e.preventDefault();
      }
    });
    document.addEventListener('drop', function (e) {
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      e.preventDefault();
      var f = e.dataTransfer.files[0];
      handleFile(f);
    });

    var nativeOpenBtn = $('btn-native-open');
    if (nativeOpenBtn) nativeOpenBtn.addEventListener('click', function () { nativeOpen(); });
    var nativeSaveBtn = $('btn-native-save');
    if (nativeSaveBtn) nativeSaveBtn.addEventListener('click', function () { nativeSave(); });
    var nativeCopy = $('btn-native-save-copy');
    if (nativeCopy) nativeCopy.addEventListener('click', function () { nativeSaveCopy(); });

    var serverOpenBtn = $('btn-server-open');
    if (serverOpenBtn) serverOpenBtn.addEventListener('click', function () { serverOpen(); });
    var serverSaveBtn = $('btn-server-save');
    if (serverSaveBtn) serverSaveBtn.addEventListener('click', function () { serverSave(); });

    var applyCurrencyBtn = $('btn-apply-currency');
    if (applyCurrencyBtn) applyCurrencyBtn.addEventListener('click', function () { applyCurrency(); });
    var currencyForm = $('currency-form');
    if (currencyForm) {
      currencyForm.addEventListener('submit', function (e) {
        e.preventDefault();
        applyCurrency();
      });
    }
  }

  function setupUnloadGuard() {
    global.addEventListener('beforeunload', function (e) {
      var dirty = false;
      try {
        dirty = !!(state.session && state.session.isLoaded() && state.session.isDirty());
      } catch (err) {
        dirty = false;
      }
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
      return undefined;
    });

    global.hasUnsavedChanges = function () {
      try {
        return !!(state.session && state.session.isLoaded() && state.session.isDirty());
      } catch (err) {
        return false;
      }
    };
  }

  /* ------------------------------------------------------------------ *
   * 전체 렌더
   * ------------------------------------------------------------------ */

  function renderAll() {
    buildMaps();
    renderHeaderBadges();
    renderOverview();
    renderCharacters();
    renderMartial();
    renderInventory();
    renderAtlas();
    renderChangesTable();
  }

  /* ------------------------------------------------------------------ *
   * 초기화
   * ------------------------------------------------------------------ */

  function initSession() {
    try {
      if (Core && typeof Core.createSession === 'function') {
        state.session = Core.createSession(Catalog);
      }
    } catch (err) {
      state.session = null;
      setStatus('세션 초기화 실패: ' + (err && err.message ? err.message : String(err)));
    }
  }

  function setupModeNotice() {
    if (state.nativeMode || state.serverMode) return;
    var notice = $('mode-notice-text');
    if (notice) {
      notice.textContent = '오프라인 브라우저 모드 · 로컬 .sav 열기 및 수정본 다운로드 지원 (원본 백업 권장)';
    }
  }

  async function initBridges() {
    var nativeOk = false;
    if (isNativeWebView()) {
      nativeOk = await initNative();
    }
    if (!nativeOk) {
      var serverOk = await initServer();
      if (!serverOk) setupModeNotice();
    }
  }

  function boot() {
    initSession();
    buildMaps();
    setupFileControls();
    setupCharacterControls();
    setupMartialControls();
    setupInventoryControls();
    setupAtlasControls();
    setupChangesDialog();
    setupTheme();
    setupTabs();
    setupUnloadGuard();

    renderAll();

    initBridges().then(function () {
      renderHeaderBadges();
    }, function () {
      setupModeNotice();
    });
  }

  global.JinshuEditorUI = {
    getSession: getSession,
    getNativeSession: function () { return state.nativeSession; },
    isBusy: isBusy,
    loadBytes: loadBytes,
    openDemoSave: openDemoSave,
    activateTab: activateTab,
    renderAll: renderAll
  };

  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { boot(); });
  } else {
    boot();
  }

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
