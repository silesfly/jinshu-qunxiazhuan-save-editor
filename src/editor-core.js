/* src/editor-core.js — Jinshu Qunxiazhuan 1.07 V2.5 FIX 234 editor core (UMD) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      function () { return require('./sav-codec.js'); },
      function () {
        try { return require('./catalog-data.js'); }
        catch (e) { return null; }
      }
    );
  } else {
    root.JinshuEditorCore = factory(
      function () {
        if (!root.JinshuSavCodec) throw new Error('JinshuSavCodec가 로드되지 않았습니다.');
        return root.JinshuSavCodec;
      },
      function () { return root.JinshuCatalog || null; }
    );
  }
})(typeof self !== 'undefined' ? self : this, function (resolveCodec, resolveCatalog) {
  'use strict';

  var _codec = null;
  function C() { if (!_codec) _codec = resolveCodec(); return _codec; }

  var PERSON_COUNT = 758;
  var PARTY_SLOTS = 15;
  var MAX_ACTIVE_INVENTORY = 900;
  var INVENTORY_SLOTS = 1000;

  var OFFSETS = {
    Base: {
      difficulty: 24, standard: 26, changxiang: 28, special: 30, solo: 32,
      playthrough: 34, bookCount: 36, kungfuCount: 38, spFragment: 40,
      gameMode: 42, tianguan: 44, opening: 46, storyFlag: 48,
      partyStart: 72, inventoryStart: 102
    },
    Person: {
      id: 0, portrait: 2, constitution: 4, name: 8, nick: 18, gender: 28,
      level: 30, exp: 32, hp: 34, maxHp: 36, injury: 38, poison: 40, tili: 42,
      itemPracticePts: 44, weapon: 46, armor: 48,
      neiliType: 80, mp: 82, maxMp: 84, attack: 86, qinggong: 88, defense: 90,
      medical: 92, usePoison: 94, detox: 96, antiPoison: 98,
      fist: 100, finger: 102, sword: 104, blade: 106, specialWeapon: 108,
      hiddenWeapon: 110, wuxueKnowledge: 112, morality: 114, poisonAttack: 116,
      zuoyouHubo: 118, fame: 120, aptitude: 122, practiceItem: 124, practicePts: 126,
      kungfuIdStart: 128, kungfuLevelStart: 158,
      tianfuPts: 208, wuxuePts: 210, shizhan: 216, hitRate: 220,
      mainNeigongSlot: 222, mainQinggongSlot: 224, affection: 244, dodge: 246,
      zhenqi: 256, parry: 258, mount: 262, sectContrib: 268, sect: 270, xinmo: 272,
      fistGrowth: 274, fingerGrowth: 276, swordGrowth: 278, bladeGrowth: 280,
      specialGrowth: 282, hiddenGrowth: 284, sectRank: 308, tianfuCap: 310,
      subNeigongSlot: 312, wuxueCap: 314, baseHp: 508, baseMp: 510,
      mijiStart: 874, meridianShunStart: 894, meridianNiStart: 922, acupointStart: 950
    }
  };

  var PRESETS = [
    { id: 'wealth_max', ko: '만재(재물 MAX)', descKo: '은량 500,000 · 비급잔장 999 · 수련 파편 30,000 · 정력 500 · 동료 명성 30,000' },
    { id: 'hero_core_master', ko: '핵심 무공 달인', descKo: '주인공 내공/체력/공격력 최대, 모든 무공 레벨 999' },
    { id: 'hero_weapons_master', ko: '병기 달인', descKo: '권/지/검/도/특수/암기 30000, 성장치 30000' },
    { id: 'party_full_recovery', ko: '동료 전원 회복', descKo: '파티 전원 HP/MP 만땅, 부상/중독/체력 회복' },
    { id: 'hero_meridians_open', ko: '경락 전개', descKo: '주인공 순/역경락 및 모든 혈도 개통' },
    { id: 'wuxue_talent_points', ko: '무학/재능 포인트', descKo: '주인공 무학 포인트 및 재능 포인트 최대' }
  ];

  var STAT_RANGES = {
    portrait: [0, 32767], constitution: [0, 100], gender: [0, 2], level: [0, 120],
    hp: [0, 32767], maxHp: [0, 32767], injury: [0, 100], poison: [0, 100], tili: [0, 100],
    neiliType: [0, 3], mp: [0, 32767], maxMp: [0, 32767],
    attack: [0, 30000], qinggong: [0, 30000], defense: [0, 30000], medical: [0, 30000],
    usePoison: [0, 30000], detox: [0, 30000], antiPoison: [0, 30000],
    fist: [0, 30000], finger: [0, 30000], sword: [0, 30000], blade: [0, 30000],
    specialWeapon: [0, 30000], hiddenWeapon: [0, 30000], wuxueKnowledge: [0, 30000],
    morality: [0, 100], poisonAttack: [0, 30000], zuoyouHubo: [0, 1], fame: [0, 30000],
    aptitude: [0, 100], practicePoints: [0, 30000], practicePts: [0, 30000],
    tianfuPts: [0, 32767], wuxuePts: [0, 30000], shizhan: [0, 500], hitRate: [0, 30000],
    mainNeigongSlot: [0, 999], mainQinggongSlot: [0, 999], affection: [0, 32767],
    dodge: [0, 32767], zhenqi: [0, 32767], parry: [0, 30000],
    sectContrib: [0, 30000], sect: [0, 31], xinmo: [0, 100],
    fistGrowth: [0, 30000], fingerGrowth: [0, 30000], swordGrowth: [0, 30000],
    bladeGrowth: [0, 30000], specialGrowth: [0, 30000], hiddenGrowth: [0, 30000],
    sectRank: [0, 20], tianfuCap: [0, 30000], subNeigongSlot: [0, 999], wuxueCap: [0, 30000],
    baseHp: [0, 32767], baseMp: [0, 32767],
    exp: [0, 65535], itemPracticePts: [0, 65535],
    weapon: [-1, 65535], armor: [-1, 65535], mount: [-1, 65535], practiceItem: [-1, 65535]
  };

  function rdI16(u8, off) { return C().readInt16(u8, off); }
  function wrI16(u8, off, v) { C().writeInt16(u8, off, v); }
  function rdU16(u8, off) { return C().readUint16(u8, off); }
  function wrU16(u8, off, v) { C().writeUint16(u8, off, v); }
  function rdBig5(u8, off, n) { return C().readBig5Field(u8, off, n); }
  function wrBig5(u8, off, n, s) { C().writeBig5Field(u8, off, n, s); }

  function clampInt(v, lo, hi) {
    v = parseInt(v, 10); if (!isFinite(v)) v = 0;
    if (v < lo) v = lo; if (v > hi) v = hi; return v;
  }
  function isInt(v) { return typeof v === 'number' && Number.isInteger(v); }

  function personOff(pid) { return C().personOffset(pid); }
  function inventoryOff(slot) { return OFFSETS.Base.inventoryStart + slot * 4; }
  function partyOff(slot) { return OFFSETS.Base.partyStart + slot * 2; }

  function cloneEntries(entries) {
    return entries.map(function (e) { return Object.assign({}, e); });
  }

  function toU8(x) {
    if (x instanceof Uint8Array) return x;
    if (x && x.buffer) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    if (Array.isArray(x)) return Uint8Array.from(x);
    throw new Error('바이트 배열이 아닙니다.');
  }

  function normalizeLookup(list) {
    var map = {};
    if (!list || !list.length) return map;
    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      if (!entry) continue;
      if (entry.id != null) map[entry.id] = entry;
    }
    return map;
  }

  function buildCatalogMaps(catalog) {
    var cat = catalog || {};
    var maps = {
      charById: normalizeLookup(cat.characters),
      itemById: normalizeLookup(cat.items),
      kungfuById: normalizeLookup(cat.kungfu),
      mijiById: normalizeLookup(cat.miji),
      talentById: normalizeLookup(cat.talents),
      sectById: normalizeLookup(cat.sects),
      meridianById: normalizeLookup(cat.meridians),
      catalog: cat
    };
    return maps;
  }

  function validateTalentId(tid, talentMap) {
    if (!isInt(tid) || tid < 0) throw new Error('재능 ID가 유효하지 않습니다: ' + tid);
    if (talentMap && Object.keys(talentMap).length > 0) {
      if (!Object.prototype.hasOwnProperty.call(talentMap, tid)) {
        throw new Error('알 수 없는 재능 ID입니다: ' + tid);
      }
    }
  }

  function readInventory(rGrp) {
    var out = [];
    for (var i = 0; i < INVENTORY_SLOTS; i++) {
      var v = rdI16(rGrp, inventoryOff(i));
      if (v >= 0) {
        out.push({
          slot: i,
          itemId: v,
          count: rdI16(rGrp, inventoryOff(i) + 2)
        });
      }
    }
    return out;
  }

  function writeInventory(rGrp, list) {
    var active = [];
    for (var i = 0; i < list.length && active.length < MAX_ACTIVE_INVENTORY; i++) {
      var it = list[i];
      if (!it) continue;
      var id = parseInt(it.itemId, 10);
      var cnt = parseInt(it.count, 10);
      if (!isFinite(id)) id = -1;
      if (!isFinite(cnt)) cnt = 0;
      if (id < 0) continue;
      if (id !== 174 && cnt <= 0) continue;
      if (id === 174 && cnt < 0) continue;
      active.push({ itemId: id, count: cnt });
    }
    for (var j = 0; j < INVENTORY_SLOTS; j++) {
      var o = inventoryOff(j);
      if (j < active.length) {
        wrI16(rGrp, o, active[j].itemId);
        wrI16(rGrp, o + 2, active[j].count);
      } else {
        wrI16(rGrp, o, -1);
        wrI16(rGrp, o + 2, 0);
      }
    }
  }

  function validInventoryItemId(itemId, tjm) {
    var meta = (tjm && tjm.rconfigMeta) || {};
    if (isInt(itemId) && itemId >= 0 && itemId <= 660) return true;
    if (isInt(itemId) && meta.itemIds && meta.itemIds.indexOf(itemId) >= 0) return true;
    return false;
  }

  function validateItemId(itemId, tjm) {
    if (!validInventoryItemId(itemId, tjm)) {
      throw new Error('유효하지 않은 아이템 ID: ' + itemId);
    }
  }

  function validateKungfuId(kfId, tjm) {
    if (kfId === 0) return;
    var meta = (tjm && tjm.rconfigMeta) || {};
    if (isInt(kfId) && kfId >= 1 && kfId <= 461) return;
    if (isInt(kfId) && meta.kungfuIds && meta.kungfuIds.indexOf(kfId) >= 0) return;
    if (kfId >= 462 && kfId <= 470) throw new Error('무공 ID ' + kfId + '은(는) 자리표시자입니다.');
    throw new Error('무공 ID ' + kfId + '은(는) 유효하지 않습니다.');
  }

  function validateMijiId(mijiId, tjm) {
    if (mijiId === 0) return;
    var meta = (tjm && tjm.rconfigMeta) || {};
    if (isInt(mijiId) && mijiId >= 1 && mijiId <= 100) return;
    if (isInt(mijiId) && meta.mijiIds && meta.mijiIds.indexOf(mijiId) >= 0) return;
    throw new Error('비급 ID ' + mijiId + '은(는) 유효하지 않습니다.');
  }

  function compactInventory(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) if (list[i]) out.push(list[i]);
    return out;
  }

  function decodeTalentRaw(raw, isSptf) {
    if (!isSptf) return { rawValue: raw, id: raw, equipped: true };
    if (raw >= 100000) return { rawValue: raw, id: raw - 100000, equipped: false };
    return { rawValue: raw, id: raw, equipped: true };
  }

  function encodeTalentRaw(t) {
    if (t.equipped) return t.id;
    return t.id + 100000;
  }

  function readParty(rGrp) {
    var out = [];
    for (var i = 0; i < PARTY_SLOTS; i++) out.push(rdI16(rGrp, partyOff(i)));
    return out;
  }

  function writeParty(rGrp, list) {
    for (var i = 0; i < PARTY_SLOTS; i++) {
      wrI16(rGrp, partyOff(i), list && list[i] != null ? list[i] : -1);
    }
  }

  function readCurrency(rGrp, tjm) {
    var bd = (tjm && tjm.basicData) || {};
    return {
      gold: bd.gold || 0,
      mjcz: bd.mjcz || 0,
      sp: bd.sp != null ? bd.sp : rdI16(rGrp, OFFSETS.Base.spFragment),
      spBase: rdI16(rGrp, OFFSETS.Base.spFragment),
      staminaJl: bd.staminaJl || 0,
      playthrough: rdI16(rGrp, OFFSETS.Base.playthrough),
      difficulty: rdI16(rGrp, OFFSETS.Base.difficulty),
      bookCount: rdI16(rGrp, OFFSETS.Base.bookCount),
      year: bd.year || 0,
      month: bd.month || 0,
      day: bd.day || 0,
      shichen: bd.shichen || 0
    };
  }

  function applyCurrencyToInventory(rGrp, tjm) {
    var inv = readInventory(rGrp);
    var gold = (tjm.basicData && tjm.basicData.gold) || 0;
    var mjcz = (tjm.basicData && tjm.basicData.mjcz) || 0;
    var gi = -1;
    var mi = -1;
    var find = function (id) {
      for (var i = 0; i < inv.length; i++) if (inv[i].itemId === id) return i;
      return -1;
    };
    gi = find(174);
    if (gold > 0) {
      if (gi < 0) inv.push({ slot: inv.length, itemId: 174, count: 0 });
      else inv[gi].count = 0;
    } else {
      if (gi >= 0) inv.splice(gi, 1);
    }
    mi = find(550);
    if (mjcz > 0) {
      if (mi >= 0) inv[mi].count = clampInt(mjcz, 1, 30000);
      else inv.push({ slot: inv.length, itemId: 550, count: clampInt(mjcz, 1, 30000) });
    } else {
      if (mi >= 0) inv.splice(mi, 1);
    }
    writeInventory(rGrp, compactInventory(inv));
  }

  function itemKo(itemMap, id) {
    if (id == null || id < 0) return '';
    var it = itemMap && itemMap[id];
    return it ? (it.ko || it.zh || '') : '';
  }

  function itemZh(itemMap, id) {
    if (id == null || id < 0) return '';
    var it = itemMap && itemMap[id];
    return it ? (it.zh || it.ko || '') : '';
  }

  function queryMatches(item, query) {
    if (!query) return true;
    var q = String(query).toLowerCase();
    var fields = [item.ko, item.zh, item.descKo, item.itemId, item.slot, item.type, item.equipSlot];
    for (var i = 0; i < fields.length; i++) {
      if (fields[i] == null) continue;
      if (String(fields[i]).toLowerCase().indexOf(q) >= 0) return true;
    }
    return false;
  }

  function createSession(customCatalog) {
    var catalog = customCatalog || (resolveCatalog ? resolveCatalog() : null);
    var maps = buildCatalogMaps(catalog);

    var state = {
      loaded: false,
      entries: null,
      rEntryIndex: -1,
      tjmEntryIndex: -1,
      rGrpBytes: null,
      tjmBytes: null,
      tjm: null,
      dirty: false,
      _origRGrp: null,
      _origTjm: null,
      catalog: catalog,
      charById: maps.charById,
      itemById: maps.itemById,
      kungfuById: maps.kungfuById,
      mijiById: maps.mijiById,
      talentById: maps.talentById,
      sectById: maps.sectById,
      meridianById: maps.meridianById,
      changeLog: []
    };

    function markDirty() { state.dirty = true; }

    function ensureLoaded() {
      if (!state.loaded) throw new Error('세이브가 로드되지 않았습니다.');
    }

    function recordChange(target, field, before, after, dirtyTarget) {
      if (!state.loaded) return;
      state.changeLog.push({
        target: target,
        field: field,
        before: before,
        after: after,
        dirtyTarget: dirtyTarget || 'both'
      });
      if (dirtyTarget === 'r' || dirtyTarget === 'both' || !dirtyTarget) {
        if (state.rEntryIndex >= 0 && state.entries[state.rEntryIndex]) {
          state.entries[state.rEntryIndex].dirty = true;
        }
      }
      if (dirtyTarget === 'tjm' || dirtyTarget === 'both' || !dirtyTarget) {
        if (state.tjmEntryIndex >= 0 && state.entries[state.tjmEntryIndex]) {
          state.entries[state.tjmEntryIndex].dirty = true;
        }
      }
      state.dirty = true;
    }

    function applyDecoded(decoded) {
      state.loaded = true;
      state.entries = decoded.entries;
      state.rEntryIndex = decoded.rEntryIndex;
      state.tjmEntryIndex = decoded.tjmEntryIndex;
      state.rGrpBytes = decoded.rGrpBytes;
      state.tjmBytes = decoded.tjmBytes;
      state.tjm = decoded.tjm;
      state.dirty = false;
      state.changeLog = [];
      state._origRGrp = new Uint8Array(decoded.rGrpBytes);
      state._origTjm = JSON.parse(JSON.stringify({
        wordCount: decoded.tjm.wordCount,
        miao: decoded.tjm.miao,
        saveWallTime: decoded.tjm.saveWallTime,
        saveCreateTime: decoded.tjm.saveCreateTime,
        reservedZero: decoded.tjm.reservedZero,
        prefixWords: decoded.tjm.prefixWords,
        basicOffset: decoded.tjm.basicOffset,
        basicWords: decoded.tjm.basicWords,
        basicData: decoded.tjm.basicData,
        ptf: decoded.tjm.ptf,
        sptf: decoded.tjm.sptf,
        tailOffset: decoded.tjm.tailOffset,
        tailWords: decoded.tjm.tailWords,
        hasSaveIdentity: decoded.tjm.hasSaveIdentity,
        rconfigMeta: decoded.tjm.rconfigMeta
      }));
    }

    function loadSavBytes(bytes) {
      return C().decodeSav(toU8(bytes)).then(function (decoded) {
        applyDecoded(decoded);
        return state;
      });
    }

    function loadSavBytesSync(bytes) {
      applyDecoded(C().decodeSavSync(toU8(bytes)));
      return state;
    }

    function exportSavBytes() {
      ensureLoaded();
      var savState = {
        entries: cloneEntries(state.entries),
        rGrpBytes: state.rGrpBytes,
        tjm: state.tjm
      };
      return C().encodeSav(savState);
    }

    function exportSavBytesSync() {
      ensureLoaded();
      var savState = {
        entries: cloneEntries(state.entries),
        rGrpBytes: state.rGrpBytes,
        tjm: state.tjm
      };
      return C().encodeSavSync(savState);
    }

    function isLoaded() { return state.loaded; }
    function isDirty() { return state.dirty; }

    function getChanges() {
      if (!state.loaded) {
        return { loaded: false, dirty: false, entries: [], count: 0, items: [] };
      }
      var changed = [];
      for (var i = 0; i < state.entries.length; i++) {
        if (state.entries[i] && state.entries[i].dirty) changed.push(state.entries[i].name || i);
      }
      return {
        loaded: true,
        dirty: state.dirty,
        entries: changed,
        count: state.changeLog.length,
        items: state.changeLog.slice()
      };
    }

    function resetChanges() {
      if (!state.loaded) return;
      state.rGrpBytes = new Uint8Array(state._origRGrp);
      var ot = state._origTjm;
      state.tjm = {
        wordCount: ot.wordCount,
        miao: ot.miao,
        saveWallTime: ot.saveWallTime,
        saveCreateTime: ot.saveCreateTime,
        reservedZero: ot.reservedZero,
        prefixWords: ot.prefixWords.slice(),
        basicOffset: ot.basicOffset,
        basicWords: ot.basicWords,
        basicData: JSON.parse(JSON.stringify(ot.basicData)),
        ptf: ot.ptf.map(function (x) { return x.slice(); }),
        sptf: ot.sptf.map(function (x) { return x.slice(); }),
        tailOffset: ot.tailOffset,
        tailWords: ot.tailWords.slice(),
        hasSaveIdentity: ot.hasSaveIdentity,
        rconfigMeta: JSON.parse(JSON.stringify(ot.rconfigMeta))
      };
      for (var i = 0; i < state.entries.length; i++) {
        if (state.entries[i]) state.entries[i].dirty = false;
      }
      state.changeLog = [];
      state.dirty = false;
    }

    function getSummary() {
      ensureLoaded();
      var party = readParty(state.rGrpBytes);
      var heroId = party[0];
      if (heroId == null || heroId < 0) heroId = 0;
      heroId = clampInt(heroId, 0, PERSON_COUNT - 1);
      var heroOff = personOff(heroId);
      var heroName = rdBig5(state.rGrpBytes, heroOff + OFFSETS.Person.name, 10);
      var catChar = state.charById[heroId] || state.charById[rdI16(state.rGrpBytes, heroOff + OFFSETS.Person.id)];
      var heroKo = catChar && (heroName === catChar.zh || !heroName) ? (catChar.ko || heroName) : heroName;
      var bd = (state.tjm && state.tjm.basicData) || {};
      var inventory = readInventory(state.rGrpBytes);
      var partyCount = 0;
      for (var i = 0; i < party.length; i++) if (party[i] >= 0) partyCount++;

      return {
        heroId: heroId,
        heroName: heroName,
        heroKo: heroKo,
        heroLevel: rdI16(state.rGrpBytes, heroOff + OFFSETS.Person.level),
        partyCount: partyCount,
        inventoryCount: inventory.length,
        difficulty: rdI16(state.rGrpBytes, OFFSETS.Base.difficulty),
        playthrough: rdI16(state.rGrpBytes, OFFSETS.Base.playthrough),
        bookCount: rdI16(state.rGrpBytes, OFFSETS.Base.bookCount),
        sp: bd.sp != null ? bd.sp : rdI16(state.rGrpBytes, OFFSETS.Base.spFragment),
        gold: bd.gold || 0,
        mjcz: bd.mjcz || 0,
        staminaJl: bd.staminaJl || 0,
        shichen: bd.shichen || 0,
        day: bd.day || 0,
        month: bd.month || 0,
        year: bd.year || 0,
        wordCount: state.tjm.wordCount,
        miao: state.tjm.miao,
        saveWallTime: state.tjm.saveWallTime,
        saveCreateTime: state.tjm.saveCreateTime,
        hasSaveIdentity: !!(state.tjm && state.tjm.hasSaveIdentity),
        rconfigMeta: state.tjm.rconfigMeta
      };
    }

    function getParty() {
      ensureLoaded();
      return readParty(state.rGrpBytes);
    }

    function setPartySlot(idx, personId) {
      ensureLoaded();
      idx = clampInt(idx, 0, PARTY_SLOTS - 1);
      if (personId !== null && personId !== undefined && personId !== -1) {
        if (!isInt(personId) || personId < 0 || personId >= PERSON_COUNT) {
          throw new Error('파티원 ID가 유효하지 않습니다: ' + personId);
        }
        var party = readParty(state.rGrpBytes);
        for (var k = 0; k < PARTY_SLOTS; k++) {
          if (k !== idx && party[k] === personId) {
            throw new Error('이미 파티에 편성된 캐릭터입니다: ' + personId);
          }
        }
      } else {
        personId = -1;
      }
      var before = rdI16(state.rGrpBytes, partyOff(idx));
      wrI16(state.rGrpBytes, partyOff(idx), personId);
      recordChange('party', 'slot' + idx, before, personId, 'r');
    }

    function characterDisplay(personId) {
      var o = personOff(personId);
      var id = rdI16(state.rGrpBytes, o + OFFSETS.Person.id);
      var name = rdBig5(state.rGrpBytes, o + OFFSETS.Person.name, 10);
      var nick = rdBig5(state.rGrpBytes, o + OFFSETS.Person.nick, 10);
      var catChar = state.charById[personId] || state.charById[id];
      var ko = catChar && (name === catChar.zh || !name) ? (catChar.ko || name) : name;
      var zh = catChar ? (catChar.zh || name) : name;
      var nickKo = catChar ? (catChar.nickKo || nick) : nick;
      var sectId = rdI16(state.rGrpBytes, o + OFFSETS.Person.sect);
      var sect = state.sectById[sectId];
      return {
        id: id,
        name: name,
        nick: nick,
        ko: ko,
        zh: zh,
        nickKo: nickKo,
        sectKo: sect ? (sect.ko || sect.zh || '') : '',
        catChar: catChar
      };
    }

    function listCharacters(opts) {
      ensureLoaded();
      opts = opts || {};
      var party = readParty(state.rGrpBytes);
      var partyMap = {};
      for (var ps = 0; ps < party.length; ps++) {
        if (party[ps] >= 0) partyMap[party[ps]] = ps;
      }
      var out = [];
      for (var i = 0; i < PERSON_COUNT; i++) {
        var o = personOff(i);
        var id = rdI16(state.rGrpBytes, o + OFFSETS.Person.id);
        if (id < 0) continue;
        var disp = characterDisplay(i);
        var sectId = rdI16(state.rGrpBytes, o + OFFSETS.Person.sect);
        if (opts.partyOnly && partyMap[i] === undefined) continue;
        if (opts.sectFilter != null && opts.sectFilter !== '' && opts.sectFilter !== 'all') {
          var sectFilterId = parseInt(opts.sectFilter, 10);
          if (isFinite(sectFilterId) && sectId !== sectFilterId) continue;
        }
        var item = {
          personId: i,
          id: id,
          name: disp.name,
          nick: disp.nick,
          ko: disp.ko,
          zh: disp.zh,
          nickKo: disp.nickKo,
          gender: rdI16(state.rGrpBytes, o + OFFSETS.Person.gender),
          level: rdI16(state.rGrpBytes, o + OFFSETS.Person.level),
          sect: sectId,
          sectKo: disp.sectKo,
          hp: rdI16(state.rGrpBytes, o + OFFSETS.Person.hp),
          maxHp: rdI16(state.rGrpBytes, o + OFFSETS.Person.maxHp),
          mp: rdI16(state.rGrpBytes, o + OFFSETS.Person.mp),
          maxMp: rdI16(state.rGrpBytes, o + OFFSETS.Person.maxMp),
          aptitude: rdI16(state.rGrpBytes, o + OFFSETS.Person.aptitude),
          inParty: partyMap[i] !== undefined,
          partySlot: partyMap[i] !== undefined ? partyMap[i] : -1
        };
        if (opts.query && !queryMatches({
          ko: item.ko, zh: item.zh, descKo: '', itemId: item.id + ' ' + item.personId,
          slot: item.personId, type: item.sect, equipSlot: item.sectKo
        }, opts.query)) continue;
        out.push(item);
      }
      return out;
    }

    function readKungfu(o) {
      var ids = [], lvls = [];
      for (var i = 0; i < 15; i++) {
        ids.push(rdI16(state.rGrpBytes, o + OFFSETS.Person.kungfuIdStart + i * 2));
        lvls.push(rdI16(state.rGrpBytes, o + OFFSETS.Person.kungfuLevelStart + i * 2));
      }
      return { ids: ids, levels: lvls };
    }

    function readMiji(o) {
      var out = [];
      for (var i = 0; i < 10; i++) out.push(rdI16(state.rGrpBytes, o + OFFSETS.Person.mijiStart + i * 2));
      return out;
    }

    function readMeridian(o, start, count) {
      var out = [];
      for (var i = 0; i < count; i++) out.push(rdI16(state.rGrpBytes, o + start + i * 2));
      return out;
    }

    function readAcupoints(o) {
      var out = [];
      for (var i = 0; i < 164; i++) out.push(rdI16(state.rGrpBytes, o + OFFSETS.Person.acupointStart + i * 2));
      return out;
    }

    function kungfuSlotsFor(o) {
      var kf = readKungfu(o);
      var out = [];
      for (var i = 0; i < 15; i++) {
        var id = kf.ids[i];
        var meta = id > 0 ? state.kungfuById[id] : null;
        out.push({
          slot: i,
          id: id,
          level: kf.levels[i],
          ko: meta ? (meta.ko || meta.zh || '') : '',
          zh: meta ? (meta.zh || meta.ko || '') : '',
          type: meta ? meta.type : null
        });
      }
      return out;
    }

    function mijiSlotsFor(o) {
      var ids = readMiji(o);
      var out = [];
      for (var i = 0; i < 10; i++) {
        var id = ids[i];
        var meta = id > 0 ? state.mijiById[id] : null;
        out.push({
          slot: i,
          id: id,
          ko: meta ? (meta.ko || meta.zh || '') : '',
          zh: meta ? (meta.zh || meta.ko || '') : ''
        });
      }
      return out;
    }

    function meridiansFor(o) {
      var shun = readMeridian(o, OFFSETS.Person.meridianShunStart, 14);
      var ni = readMeridian(o, OFFSETS.Person.meridianNiStart, 14);
      var out = [];
      var catalogMeridians = (state.catalog && state.catalog.meridians) || [];
      for (var i = 0; i < 14; i++) {
        var meta = state.meridianById[i + 1] || catalogMeridians[i];
        out.push({
          index: i,
          id: meta && meta.id != null ? meta.id : i + 1,
          ko: meta ? (meta.ko || meta.zh || '') : '',
          zh: meta ? (meta.zh || meta.ko || '') : '',
          shun: shun[i],
          ni: ni[i]
        });
      }
      return out;
    }

    function getCharacter(personId) {
      ensureLoaded();
      personId = clampInt(personId, 0, PERSON_COUNT - 1);
      var o = personOff(personId);
      var P = OFFSETS.Person;
      var it = function (k) { return rdI16(state.rGrpBytes, o + P[k]); };
      var exp = rdU16(state.rGrpBytes, o + P.exp);
      var ipp = rdU16(state.rGrpBytes, o + P.itemPracticePts);
      var disp = characterDisplay(personId);
      var acupoints = readAcupoints(o);
      var acupointsOpenCount = 0;
      for (var ai = 0; ai < acupoints.length; ai++) if (acupoints[ai]) acupointsOpenCount++;

      return {
        personId: personId,
        id: it('id'),
        portrait: it('portrait'),
        constitution: it('constitution'),
        name: rdBig5(state.rGrpBytes, o + P.name, 10),
        nick: rdBig5(state.rGrpBytes, o + P.nick, 10),
        ko: disp.ko,
        zh: disp.zh,
        sectKo: disp.sectKo,
        gender: it('gender'),
        level: it('level'),
        exp: exp,
        hp: it('hp'),
        maxHp: it('maxHp'),
        injury: it('injury'),
        poison: it('poison'),
        tili: it('tili'),
        itemPracticePts: ipp,
        weapon: it('weapon'),
        armor: it('armor'),
        weaponKo: itemKo(state.itemById, it('weapon')),
        armorKo: itemKo(state.itemById, it('armor')),
        mountKo: itemKo(state.itemById, it('mount')),
        practiceItemKo: itemKo(state.itemById, it('practiceItem')),
        neiliType: it('neiliType'),
        mp: it('mp'),
        maxMp: it('maxMp'),
        attack: it('attack'),
        qinggong: it('qinggong'),
        defense: it('defense'),
        medical: it('medical'),
        usePoison: it('usePoison'),
        detox: it('detox'),
        antiPoison: it('antiPoison'),
        fist: it('fist'),
        finger: it('finger'),
        sword: it('sword'),
        blade: it('blade'),
        specialWeapon: it('specialWeapon'),
        hiddenWeapon: it('hiddenWeapon'),
        wuxueKnowledge: it('wuxueKnowledge'),
        morality: it('morality'),
        poisonAttack: it('poisonAttack'),
        zuoyouHubo: it('zuoyouHubo'),
        fame: it('fame'),
        aptitude: it('aptitude'),
        practiceItem: it('practiceItem'),
        practicePts: it('practicePts'),
        tianfuPts: it('tianfuPts'),
        wuxuePts: it('wuxuePts'),
        shizhan: it('shizhan'),
        hitRate: it('hitRate'),
        mainNeigongSlot: it('mainNeigongSlot'),
        mainQinggongSlot: it('mainQinggongSlot'),
        affection: it('affection'),
        dodge: it('dodge'),
        zhenqi: it('zhenqi'),
        parry: it('parry'),
        mount: it('mount'),
        sectContrib: it('sectContrib'),
        sect: it('sect'),
        xinmo: it('xinmo'),
        fistGrowth: it('fistGrowth'),
        fingerGrowth: it('fingerGrowth'),
        swordGrowth: it('swordGrowth'),
        bladeGrowth: it('bladeGrowth'),
        specialGrowth: it('specialGrowth'),
        hiddenGrowth: it('hiddenGrowth'),
        sectRank: it('sectRank'),
        tianfuCap: it('tianfuCap'),
        subNeigongSlot: it('subNeigongSlot'),
        wuxueCap: it('wuxueCap'),
        baseHp: it('baseHp'),
        baseMp: it('baseMp'),
        kungfu: readKungfu(o),
        miji: readMiji(o),
        meridianShun: readMeridian(o, P.meridianShunStart, 14),
        meridianNi: readMeridian(o, P.meridianNiStart, 14),
        acupoints: acupoints,
        kungfuSlots: kungfuSlotsFor(o),
        mijiSlots: mijiSlotsFor(o),
        meridians: meridiansFor(o),
        acupointsOpenCount: acupointsOpenCount,
        talents: getCharacterTalents(personId)
      };
    }

    function setCharacterStat(personId, field, value) {
      ensureLoaded();
      personId = clampInt(personId, 0, PERSON_COUNT - 1);
      var P = OFFSETS.Person;
      if (!(field in P)) throw new Error('알 수 없는 필드: ' + field);
      var o = personOff(personId) + P[field];
      var equipmentFields = { weapon: true, armor: true, mount: true, practiceItem: true };

      if (equipmentFields[field]) {
        if (value === -1) {
          var beforeEq = rdI16(state.rGrpBytes, o);
          wrI16(state.rGrpBytes, o, -1);
          recordChange('character:' + personId, field, beforeEq, -1, 'r');
          return;
        }
        if (!isInt(value)) throw new Error(field + ' 값은 정수여야 합니다.');
        validateItemId(value, state.tjm);
        var beforeEq2 = rdI16(state.rGrpBytes, o);
        wrI16(state.rGrpBytes, o, value);
        recordChange('character:' + personId, field, beforeEq2, value, 'r');
        return;
      }

      if (field === 'exp' || field === 'itemPracticePts') {
        var beforeU = rdU16(state.rGrpBytes, o);
        var vU = clampInt(value, 0, 65535);
        wrU16(state.rGrpBytes, o, vU);
        recordChange('character:' + personId, field, beforeU, vU, 'r');
      } else {
        var before = rdI16(state.rGrpBytes, o);
        var r = STAT_RANGES[field];
        var v;
        if (r) v = clampInt(value, r[0], r[1]);
        else v = clampInt(value, -32768, 32767);
        wrI16(state.rGrpBytes, o, v);
        recordChange('character:' + personId, field, before, v, 'r');
      }
    }

    function setCharacterName(personId, nameOrObj) {
      ensureLoaded();
      personId = clampInt(personId, 0, PERSON_COUNT - 1);
      var o = personOff(personId);
      var hasName = false;
      var hasNick = false;
      var newName;
      var newNick;

      if (nameOrObj && typeof nameOrObj === 'object') {
        if (Object.prototype.hasOwnProperty.call(nameOrObj, 'name')) {
          hasName = true;
          newName = String(nameOrObj.name == null ? '' : nameOrObj.name);
        }
        if (Object.prototype.hasOwnProperty.call(nameOrObj, 'nick')) {
          hasNick = true;
          newNick = String(nameOrObj.nick == null ? '' : nameOrObj.nick);
        }
      } else {
        hasName = true;
        newName = String(nameOrObj == null ? '' : nameOrObj);
      }

      if (hasName) {
        var oldName = rdBig5(state.rGrpBytes, o + OFFSETS.Person.name, 10);
        if (oldName !== newName) {
          wrBig5(state.rGrpBytes, o + OFFSETS.Person.name, 10, newName);
          recordChange('character:' + personId, 'name', oldName, newName, 'r');
        }
      }
      if (hasNick) {
        var oldNick = rdBig5(state.rGrpBytes, o + OFFSETS.Person.nick, 10);
        if (oldNick !== newNick) {
          wrBig5(state.rGrpBytes, o + OFFSETS.Person.nick, 10, newNick);
          recordChange('character:' + personId, 'nick', oldNick, newNick, 'r');
        }
      }
    }

    function setCharacterKungfuSlot(personId, slot, kfId, level) {
      ensureLoaded();
      personId = clampInt(personId, 0, PERSON_COUNT - 1);
      slot = clampInt(slot, 0, 14);
      kfId = clampInt(kfId, 0, 32767);
      validateKungfuId(kfId, state.tjm);
      var o = personOff(personId);
      var idOff = o + OFFSETS.Person.kungfuIdStart + slot * 2;
      var lvOff = o + OFFSETS.Person.kungfuLevelStart + slot * 2;
      var beforeId = rdI16(state.rGrpBytes, idOff);
      wrI16(state.rGrpBytes, idOff, kfId);
      recordChange('character:' + personId, 'kungfu.' + slot + '.id', beforeId, kfId, 'r');
      if (level !== undefined) {
        var beforeLv = rdI16(state.rGrpBytes, lvOff);
        var lv = clampInt(level, 0, 999);
        wrI16(state.rGrpBytes, lvOff, lv);
        recordChange('character:' + personId, 'kungfu.' + slot + '.level', beforeLv, lv, 'r');
      }
    }

    function setCharacterMijiSlot(personId, slot, mijiId) {
      ensureLoaded();
      personId = clampInt(personId, 0, PERSON_COUNT - 1);
      slot = clampInt(slot, 0, 9);
      mijiId = clampInt(mijiId, 0, 32767);
      validateMijiId(mijiId, state.tjm);
      var off = personOff(personId) + OFFSETS.Person.mijiStart + slot * 2;
      var before = rdI16(state.rGrpBytes, off);
      wrI16(state.rGrpBytes, off, mijiId);
      recordChange('character:' + personId, 'miji.' + slot, before, mijiId, 'r');
    }

    function setCharacterMeridian(personId, meridianId, direction, value) {
      ensureLoaded();
      personId = clampInt(personId, 0, PERSON_COUNT - 1);
      meridianId = clampInt(meridianId, 0, 13);
      value = clampInt(value, 0, 1);
      var start = (direction === 'ni' || direction === 'reverse')
        ? OFFSETS.Person.meridianNiStart
        : OFFSETS.Person.meridianShunStart;
      var off = personOff(personId) + start + meridianId * 2;
      var before = rdI16(state.rGrpBytes, off);
      wrI16(state.rGrpBytes, off, value);
      recordChange('character:' + personId, 'meridian.' + (direction === 'ni' || direction === 'reverse' ? 'ni' : 'shun') + '.' + meridianId, before, value, 'r');
    }

    function setAllMeridians(personId, direction, value) {
      ensureLoaded();
      for (var i = 0; i < 14; i++) setCharacterMeridian(personId, i, direction, value);
    }

    function setCharacterAcupoint(personId, acupointId, value) {
      ensureLoaded();
      personId = clampInt(personId, 0, PERSON_COUNT - 1);
      acupointId = clampInt(acupointId, 0, 163);
      value = clampInt(value, 0, 1);
      var off = personOff(personId) + OFFSETS.Person.acupointStart + acupointId * 2;
      var before = rdI16(state.rGrpBytes, off);
      wrI16(state.rGrpBytes, off, value);
      recordChange('character:' + personId, 'acupoint.' + acupointId, before, value, 'r');
    }

    function setAllAcupoints(personId, value) {
      ensureLoaded();
      value = clampInt(value, 0, 1);
      for (var i = 0; i < 164; i++) setCharacterAcupoint(personId, i, value);
    }

    function getCharacterTalents(personId) {
      ensureLoaded();
      personId = clampInt(personId, 0, PERSON_COUNT - 1);
      var ptfRaw = (state.tjm.ptf[personId] || []).slice();
      var sptfRaw = (state.tjm.sptf[personId] || []).slice();
      function enrich(raw, isSptf) {
        var dec = decodeTalentRaw(raw, isSptf);
        var meta = state.talentById[dec.id] || null;
        return {
          rawValue: dec.rawValue,
          id: dec.id,
          equipped: dec.equipped,
          ko: meta ? (meta.ko || meta.zh || '') : '',
          zh: meta ? (meta.zh || meta.ko || '') : '',
          descKo: meta ? (meta.descKo || '') : '',
          tier: meta ? meta.tier : null,
          cost: meta ? meta.cost : null
        };
      }
      return {
        ptf: ptfRaw.map(function (r) { return enrich(r, false); }),
        sptf: sptfRaw.map(function (r) { return enrich(r, true); })
      };
    }

    function normalizeTalentArgs(personId, a, b, c, d) {
      personId = clampInt(personId, 0, PERSON_COUNT - 1);
      if (a === 'ptf' || a === 'sptf') {
        return {
          personId: personId,
          talentId: b,
          opts: { list: a, equipped: typeof c === 'boolean' ? c : (d == null ? true : !!d) }
        };
      }
      return {
        personId: personId,
        talentId: a,
        opts: b || {}
      };
    }

    function addTalent(personId, talentId, opts) {
      ensureLoaded();
      var args = normalizeTalentArgs(personId, talentId, opts, arguments[3], arguments[4]);
      personId = args.personId;
      talentId = args.talentId;
      opts = args.opts || {};
      validateTalentId(talentId, state.talentById);
      var listName = opts.list === 'sptf' ? 'sptf' : 'ptf';
      var list = state.tjm[listName][personId] || (state.tjm[listName][personId] = []);
      for (var i = 0; i < list.length; i++) {
        var dec = decodeTalentRaw(list[i], listName === 'sptf');
        if (dec.id === talentId) throw new Error('이미 보유한 재능입니다: ' + talentId);
      }
      var raw;
      if (listName === 'sptf') {
        raw = opts.equipped === false ? (talentId + 100000) : talentId;
      } else {
        raw = talentId;
      }
      list.push(raw);
      state.tjm[listName][personId] = list;
      recordChange('character:' + personId, listName + '.add', null, raw, 'tjm');
    }

    function removeTalent(personId, talentId, opts) {
      ensureLoaded();
      var args;
      if (talentId === 'ptf' || talentId === 'sptf') {
        args = normalizeTalentArgs(personId, talentId, opts, arguments[3], arguments[4]);
      } else {
        args = normalizeTalentArgs(personId, talentId, opts, arguments[3], arguments[4]);
      }
      personId = args.personId;
      talentId = args.talentId;
      opts = args.opts || {};
      validateTalentId(talentId, state.talentById);
      var listName = opts.list === 'sptf' ? 'sptf' : 'ptf';
      var list = state.tjm[listName][personId] || [];
      var out = [];
      var removed = [];
      for (var i = 0; i < list.length; i++) {
        var dec = decodeTalentRaw(list[i], listName === 'sptf');
        if (dec.id !== talentId) out.push(list[i]);
        else removed.push(list[i]);
      }
      state.tjm[listName][personId] = out;
      if (removed.length) recordChange('character:' + personId, listName + '.remove', removed, null, 'tjm');
    }

    function toggleSptfEquipped(personId, talentId, forceEquipped) {
      ensureLoaded();
      personId = clampInt(personId, 0, PERSON_COUNT - 1);
      validateTalentId(talentId, state.talentById);
      var list = state.tjm.sptf[personId] || [];
      for (var i = 0; i < list.length; i++) {
        var dec = decodeTalentRaw(list[i], true);
        if (dec.id === talentId) {
          var before = list[i];
          var equipped;
          if (typeof forceEquipped === 'boolean') equipped = forceEquipped;
          else equipped = !dec.equipped;
          list[i] = equipped ? talentId : (talentId + 100000);
          state.tjm.sptf[personId] = list;
          recordChange('character:' + personId, 'sptf.toggle', before, list[i], 'tjm');
          return;
        }
      }
      addTalent(personId, talentId, { list: 'sptf', equipped: typeof forceEquipped === 'boolean' ? forceEquipped : true });
    }

    function getCurrencyState() {
      ensureLoaded();
      return readCurrency(state.rGrpBytes, state.tjm);
    }

    function setCurrency(kind, value) {
      ensureLoaded();
      kind = String(kind);
      var bd = state.tjm.basicData;
      var before;
      if (kind === 'gold') {
        before = bd.gold || 0;
        bd.gold = clampInt(value, 0, 999999999);
        applyCurrencyToInventory(state.rGrpBytes, state.tjm);
        recordChange('currency', 'gold', before, bd.gold, 'both');
      } else if (kind === 'mjcz') {
        before = bd.mjcz || 0;
        bd.mjcz = clampInt(value, 0, 30000);
        applyCurrencyToInventory(state.rGrpBytes, state.tjm);
        recordChange('currency', 'mjcz', before, bd.mjcz, 'both');
      } else if (kind === 'sp') {
        before = bd.sp != null ? bd.sp : rdI16(state.rGrpBytes, OFFSETS.Base.spFragment);
        var v = clampInt(value, 0, 32767);
        bd.sp = v;
        wrI16(state.rGrpBytes, OFFSETS.Base.spFragment, v);
        recordChange('currency', 'sp', before, v, 'both');
      } else if (kind === 'staminaJl') {
        before = bd.staminaJl || 0;
        bd.staminaJl = clampInt(value, 0, 9999);
        recordChange('currency', 'staminaJl', before, bd.staminaJl, 'tjm');
      } else if (kind === 'playthrough') {
        before = rdI16(state.rGrpBytes, OFFSETS.Base.playthrough);
        var pv = clampInt(value, 1, 99);
        wrI16(state.rGrpBytes, OFFSETS.Base.playthrough, pv);
        recordChange('base', 'playthrough', before, pv, 'r');
      } else if (kind === 'difficulty') {
        before = rdI16(state.rGrpBytes, OFFSETS.Base.difficulty);
        var dv = clampInt(value, 1, 10);
        wrI16(state.rGrpBytes, OFFSETS.Base.difficulty, dv);
        recordChange('base', 'difficulty', before, dv, 'r');
      } else if (kind === 'bookCount') {
        before = rdI16(state.rGrpBytes, OFFSETS.Base.bookCount);
        var bv = clampInt(value, 0, 14);
        wrI16(state.rGrpBytes, OFFSETS.Base.bookCount, bv);
        recordChange('base', 'bookCount', before, bv, 'r');
      } else if (kind === 'year') {
        before = bd.year || 0;
        bd.year = clampInt(value, 1, 999);
        recordChange('time', 'year', before, bd.year, 'tjm');
      } else if (kind === 'month') {
        before = bd.month || 0;
        bd.month = clampInt(value, 1, 12);
        recordChange('time', 'month', before, bd.month, 'tjm');
      } else if (kind === 'day') {
        before = bd.day || 0;
        bd.day = clampInt(value, 1, 31);
        recordChange('time', 'day', before, bd.day, 'tjm');
      } else if (kind === 'shichen') {
        before = bd.shichen || 0;
        bd.shichen = clampInt(value, 0, 11);
        recordChange('time', 'shichen', before, bd.shichen, 'tjm');
      } else {
        throw new Error('알 수 없는 재화 종류: ' + kind);
      }
      markDirty();
    }

    function getInventory(opts) {
      ensureLoaded();
      opts = opts || {};
      var inv = readInventory(state.rGrpBytes);
      var out = [];
      for (var i = 0; i < inv.length; i++) {
        var it = state.itemById[inv[i].itemId] || null;
        var enriched = {
          slot: inv[i].slot,
          itemId: inv[i].itemId,
          count: inv[i].count,
          ko: it ? (it.ko || it.zh || '') : '',
          zh: it ? (it.zh || it.ko || '') : '',
          descKo: it ? (it.descKo || '') : '',
          type: it ? it.type : null,
          equipSlot: it ? it.slot : null,
          rconfig: it ? it.rconfig : null
        };
        const tf = opts.typeFilter;
        if (tf != null && tf !== '' && tf !== 'all') {
          const n = parseInt(tf, 10);
          if (Number.isFinite(n) && enriched.type !== n) continue;
        }
        if (opts.query && !queryMatches(enriched, opts.query)) continue;
        out.push(enriched);
      }
      return out;
    }

    function setInventoryItem(itemId, count) {
      ensureLoaded();
      itemId = parseInt(itemId, 10);
      if (!isFinite(itemId) || itemId < 0) throw new Error('유효하지 않은 아이템 ID: ' + itemId);
      validateItemId(itemId, state.tjm);
      var isGoldItem = (itemId === 174);
      count = isGoldItem ? clampInt(count, 0, 30000) : clampInt(count, 1, 30000);
      var inv = readInventory(state.rGrpBytes);
      var found = false;
      var before = null;
      for (var i = 0; i < inv.length; i++) {
        if (inv[i].itemId === itemId) {
          before = inv[i].count;
          inv[i].count = count;
          found = true;
          break;
        }
      }
      if (!found) {
        if (inv.length >= MAX_ACTIVE_INVENTORY) {
          throw new Error('활성 인벤토리 한도를 초과했습니다: ' + MAX_ACTIVE_INVENTORY);
        }
        inv.push({ slot: inv.length, itemId: itemId, count: count });
      }
      if (itemId === 550) state.tjm.basicData.mjcz = count;
      writeInventory(state.rGrpBytes, compactInventory(inv));
      recordChange('inventory', String(itemId), before, count, itemId === 550 ? 'both' : 'r');
    }

    function removeInventoryItem(itemId) {
      ensureLoaded();
      itemId = clampInt(itemId, 0, 65535);
      var inv = readInventory(state.rGrpBytes);
      var out = [];
      var removed = null;
      for (var i = 0; i < inv.length; i++) {
        if (inv[i].itemId !== itemId) out.push(inv[i]);
        else removed = inv[i];
      }
      if (itemId === 550) state.tjm.basicData.mjcz = 0;
      if (itemId === 174) state.tjm.basicData.gold = 0;
      writeInventory(state.rGrpBytes, out);
      recordChange('inventory', String(itemId), removed ? removed.count : null, null, (itemId === 550 || itemId === 174) ? 'both' : 'r');
    }

    function applyPreset(presetId) {
      ensureLoaded();
      var heroId = getParty()[0];
      if (heroId < 0) heroId = 0;
      if (presetId === 'wealth_max') {
        setCurrency('gold', 500000);
        setCurrency('mjcz', 999);
        setCurrency('sp', 30000);
        setCurrency('staminaJl', 500);
        var party = readParty(state.rGrpBytes);
        for (var p = 0; p < PARTY_SLOTS; p++) {
          var pid = party[p];
          if (pid >= 0) setCharacterStat(pid, 'fame', 30000);
        }
      } else if (presetId === 'hero_core_master') {
        setCharacterStat(heroId, 'level', 120);
        setCharacterStat(heroId, 'exp', 65535);
        setCharacterStat(heroId, 'maxHp', 32767);
        setCharacterStat(heroId, 'hp', 32767);
        setCharacterStat(heroId, 'maxMp', 32767);
        setCharacterStat(heroId, 'mp', 32767);
        setCharacterStat(heroId, 'attack', 30000);
        setCharacterStat(heroId, 'defense', 30000);
        setCharacterStat(heroId, 'qinggong', 30000);
        for (var s = 0; s < 15; s++) {
          var kf = rdI16(state.rGrpBytes, personOff(heroId) + OFFSETS.Person.kungfuIdStart + s * 2);
          if (kf > 0) {
            var lvOff = personOff(heroId) + OFFSETS.Person.kungfuLevelStart + s * 2;
            var before = rdI16(state.rGrpBytes, lvOff);
            wrI16(state.rGrpBytes, lvOff, 999);
            recordChange('character:' + heroId, 'kungfu.' + s + '.level', before, 999, 'r');
          }
        }
      } else if (presetId === 'hero_weapons_master') {
        var flds = ['fist', 'finger', 'sword', 'blade', 'specialWeapon', 'hiddenWeapon',
          'fistGrowth', 'fingerGrowth', 'swordGrowth', 'bladeGrowth', 'specialGrowth', 'hiddenGrowth'];
        for (var f = 0; f < flds.length; f++) setCharacterStat(heroId, flds[f], 30000);
      } else if (presetId === 'party_full_recovery') {
        var party2 = readParty(state.rGrpBytes);
        for (var q = 0; q < party2.length; q++) {
          if (party2[q] < 0) continue;
          var pp = party2[q];
          var mh = rdI16(state.rGrpBytes, personOff(pp) + OFFSETS.Person.maxHp);
          var mm = rdI16(state.rGrpBytes, personOff(pp) + OFFSETS.Person.maxMp);
          setCharacterStat(pp, 'hp', mh);
          setCharacterStat(pp, 'mp', mm);
          setCharacterStat(pp, 'injury', 0);
          setCharacterStat(pp, 'poison', 0);
          setCharacterStat(pp, 'tili', 100);
        }
      } else if (presetId === 'hero_meridians_open') {
        setAllMeridians(heroId, 'shun', 1);
        setAllMeridians(heroId, 'ni', 1);
        setAllAcupoints(heroId, 1);
      } else if (presetId === 'wuxue_talent_points') {
        setCharacterStat(heroId, 'wuxuePts', 30000);
        setCharacterStat(heroId, 'tianfuPts', 30000);
        setCharacterStat(heroId, 'wuxueCap', 30000);
        setCharacterStat(heroId, 'tianfuCap', 30000);
      } else {
        throw new Error('알 수 없는 프리셋: ' + presetId);
      }
      markDirty();
    }

    function validate() {
      if (!state.loaded) {
        return { valid: false, ok: false, errors: ['세이브가 로드되지 않았습니다.'] };
      }
      var errors = [];
      var Codec = C();
      if (!state.rGrpBytes || state.rGrpBytes.length !== Codec.LAYOUT.R_GRP_SIZE) {
        errors.push('r.grp 길이가 올바르지 않습니다: ' + (state.rGrpBytes ? state.rGrpBytes.length : 0));
      }

      var party = readParty(state.rGrpBytes);
      var seenParty = {};
      for (var i = 0; i < party.length; i++) {
        var pid = party[i];
        if (pid === -1) continue;
        if (pid < 0 || pid >= PERSON_COUNT) {
          errors.push('파티 슬롯 ' + i + ' 값이 유효하지 않습니다: ' + pid);
        } else if (seenParty[pid]) {
          errors.push('파티 슬롯 ' + i + ' 중복 캐릭터: ' + pid);
        } else {
          seenParty[pid] = true;
        }
      }

      var inv = readInventory(state.rGrpBytes);
      if (inv.length > MAX_ACTIVE_INVENTORY) {
        errors.push('활성 인벤토리 수가 한도를 초과했습니다: ' + inv.length);
      }
      var has174 = false;
      var has550 = false;
      var count174 = null;
      var count550 = null;
      for (var j = 0; j < inv.length; j++) {
        if (!validInventoryItemId(inv[j].itemId, state.tjm)) {
          errors.push('인벤토리 아이템 ID가 유효하지 않습니다: ' + inv[j].itemId);
        }
        if (inv[j].itemId === 174) {
          has174 = true;
          count174 = inv[j].count;
        }
        if (inv[j].itemId === 550) {
          has550 = true;
          count550 = inv[j].count;
        }
        if (inv[j].itemId === 174) {
          if (inv[j].count !== 0) errors.push('아이템 174의 수량은 0이어야 합니다: ' + inv[j].count);
        } else if (inv[j].itemId === 0) {
          if (inv[j].count < 1) errors.push('아이템 0의 수량이 유효하지 않습니다: ' + inv[j].count);
        } else {
          if (inv[j].count < 1 || inv[j].count > 30000) {
            errors.push('인벤토리 수량이 유효하지 않습니다: ' + inv[j].itemId + ' x ' + inv[j].count);
          }
        }
      }

      var gold = (state.tjm.basicData && state.tjm.basicData.gold) || 0;
      var mjcz = (state.tjm.basicData && state.tjm.basicData.mjcz) || 0;
      if (gold > 0) {
        if (!has174) errors.push('은량이 있지만 아이템 174가 없습니다.');
        else if (count174 !== 0) errors.push('은량이 있을 때 아이템 174 수량은 0이어야 합니다.');
      } else if (has174) {
        errors.push('은량이 0인데 아이템 174가 존재합니다.');
      }
      if (mjcz > 0) {
        if (!has550) errors.push('비급잔장이 있지만 아이템 550이 없습니다.');
        else if (count550 !== mjcz) errors.push('아이템 550 수량과 mjcz가 일치하지 않습니다.');
      } else if (has550) {
        errors.push('비급잔장이 0인데 아이템 550이 존재합니다.');
      }

      var spFragment = rdI16(state.rGrpBytes, OFFSETS.Base.spFragment);
      var spData = state.tjm.basicData && state.tjm.basicData.sp != null ? state.tjm.basicData.sp : spFragment;
      if (spFragment !== spData) errors.push('sp와 spFragment가 일치하지 않습니다: ' + spData + ' / ' + spFragment);

      for (var c = 0; c < PERSON_COUNT; c++) {
        var o = personOff(c);
        var cid = rdI16(state.rGrpBytes, o + OFFSETS.Person.id);
        if (cid < 0) continue;
        for (var ks = 0; ks < 15; ks++) {
          var kfId = rdI16(state.rGrpBytes, o + OFFSETS.Person.kungfuIdStart + ks * 2);
          if (kfId >= 462 && kfId <= 470) continue;
          try { validateKungfuId(kfId, state.tjm); }
          catch (e) { errors.push('캐릭터 ' + c + ' 무공 슬롯 ' + ks + ': ' + e.message); }
        }
        for (var ms = 0; ms < 10; ms++) {
          var mijiId = rdI16(state.rGrpBytes, o + OFFSETS.Person.mijiStart + ms * 2);
          try { validateMijiId(mijiId, state.tjm); }
          catch (e2) { errors.push('캐릭터 ' + c + ' 비급 슬롯 ' + ms + ': ' + e2.message); }
        }
        var eqFields = ['weapon', 'armor', 'mount', 'practiceItem'];
        for (var ei = 0; ei < eqFields.length; ei++) {
          var eq = rdI16(state.rGrpBytes, o + OFFSETS.Person[eqFields[ei]]);
          if (eq >= 0 && !validInventoryItemId(eq, state.tjm)) {
            errors.push('캐릭터 ' + c + ' 장비 ' + eqFields[ei] + ' ID가 유효하지 않습니다: ' + eq);
          }
        }
      }

      for (var tp = 0; tp < PERSON_COUNT; tp++) {
        var plist = state.tjm.ptf[tp] || [];
        for (var pi = 0; pi < plist.length; pi++) {
          var pdec = decodeTalentRaw(plist[pi], false);
          try { validateTalentId(pdec.id, state.talentById); }
          catch (e3) { errors.push('캐릭터 ' + tp + ' ptf 재능: ' + e3.message); }
        }
        var slist = state.tjm.sptf[tp] || [];
        for (var si = 0; si < slist.length; si++) {
          var sdec = decodeTalentRaw(slist[si], true);
          try { validateTalentId(sdec.id, state.talentById); }
          catch (e4) { errors.push('캐릭터 ' + tp + ' sptf 재능: ' + e4.message); }
        }
      }

      var ok = errors.length === 0;
      return { valid: ok, ok: ok, errors: errors };
    }

    return {
      loadSavBytes: loadSavBytes,
      loadSavBytesSync: loadSavBytesSync,
      exportSavBytes: exportSavBytes,
      exportSavBytesSync: exportSavBytesSync,
      isLoaded: isLoaded,
      isDirty: isDirty,
      getChanges: getChanges,
      resetChanges: resetChanges,
      getSummary: getSummary,
      getParty: getParty,
      setPartySlot: setPartySlot,
      listCharacters: listCharacters,
      getCharacter: getCharacter,
      setCharacterStat: setCharacterStat,
      setCharacterName: setCharacterName,
      setCharacterKungfuSlot: setCharacterKungfuSlot,
      setCharacterMijiSlot: setCharacterMijiSlot,
      setCharacterMeridian: setCharacterMeridian,
      setAllMeridians: setAllMeridians,
      setCharacterAcupoint: setCharacterAcupoint,
      setAllAcupoints: setAllAcupoints,
      getCharacterTalents: getCharacterTalents,
      addTalent: addTalent,
      removeTalent: removeTalent,
      toggleSptfEquipped: toggleSptfEquipped,
      getCurrencyState: getCurrencyState,
      setCurrency: setCurrency,
      getInventory: getInventory,
      setInventoryItem: setInventoryItem,
      removeInventoryItem: removeInventoryItem,
      applyPreset: applyPreset,
      validate: validate
    };
  }

  function utf8Encode(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
      else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
    }
    return Uint8Array.from(out);
  }

  function buildDemoTjm() {
    var ptf = new Array(1001);
    var sptf = new Array(1001);
    for (var i = 0; i < 1001; i++) { ptf[i] = []; sptf[i] = []; }
    ptf[0] = [9862, 0, 9863, 2019];
    sptf[0] = [9862, 102019];

    var metaJson = '{"format":1,"extras":{"756":{}},"appended":{"Wugong":{"471":{}},"Teji":{"101":{}}}}';
    var metaBytes = utf8Encode(metaJson);
    var tailWords = [metaBytes.length].concat(Array.prototype.slice.call(metaBytes));
    for (var w = 0; w < 68; w++) tailWords.push(w === 0 ? 7395211 : (w === 67 ? 7395211 : 0));

    return {
      wordCount: 0,
      miao: 3600,
      saveWallTime: 1700003600,
      saveCreateTime: 1700000000,
      reservedZero: 0,
      prefixWords: [1, 0, 1, 25, 900, 0, 0, 0, 0, 0],
      basicOffset: 0,
      basicWords: 0,
      basicData: {
        gold: 6205, mjcz: 38, sp: 16515, shichen: 3,
        day: 12, month: 4, year: 1, weather: 0, weatherCd: 5, staminaJl: 100
      },
      ptf: ptf,
      sptf: sptf,
      tailOffset: 0,
      tailWords: tailWords,
      hasSaveIdentity: true,
      rconfigMeta: { found: true, format: 1, itemIds: [756], kungfuIds: [471], mijiIds: [101], personIds: [] }
    };
  }

  function buildDemoRGrp(cat) {
    var LAYOUT = C().LAYOUT;
    var r = new Uint8Array(LAYOUT.R_GRP_SIZE);
    var B = OFFSETS.Base;
    var P = OFFSETS.Person;
    var maps = buildCatalogMaps(cat);
    wrI16(r, B.difficulty, 3);
    wrI16(r, B.playthrough, 2);
    wrI16(r, B.bookCount, 3);
    wrI16(r, B.spFragment, 16515);
    var party = [0, 1, 2, 5, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1];
    writeParty(r, party);

    var fallbackNames = {
      0: { name: '小蝦米', nick: '蝦米' },
      1: { name: '胡斐', nick: '胡斐' },
      2: { name: '程靈素', nick: '靈素' },
      5: { name: '張三豐', nick: '三豐' }
    };

    for (var pid = 0; pid < PERSON_COUNT; pid++) {
      var o = personOff(pid);
      var catChar = maps.charById[pid] || null;
      var fallback = fallbackNames[pid] || null;
      var name = '';
      var nick = '';
      if (catChar) {
        name = catChar.zh || catChar.ko || '';
        nick = catChar.nickZh || catChar.nickKo || '';
      } else if (fallback) {
        name = fallback.name;
        nick = fallback.nick;
      }

      wrI16(r, o + P.id, pid);
      wrI16(r, o + P.portrait, pid);
      wrI16(r, o + P.weapon, -1);
      wrI16(r, o + P.armor, -1);
      wrI16(r, o + P.mount, -1);
      wrI16(r, o + P.practiceItem, -1);
      wrI16(r, o + P.level, 1);
      wrU16(r, o + P.exp, 0);
      wrI16(r, o + P.hp, 100);
      wrI16(r, o + P.maxHp, 100);
      wrI16(r, o + P.mp, 100);
      wrI16(r, o + P.maxMp, 100);
      wrI16(r, o + P.tili, 100);
      wrI16(r, o + P.aptitude, catChar && catChar.aptitude != null ? catChar.aptitude : 50);
      wrI16(r, o + P.constitution, catChar && catChar.constitution != null ? catChar.constitution : 5);
      wrI16(r, o + P.gender, catChar && catChar.gender != null ? catChar.gender : 0);
      wrI16(r, o + P.sect, catChar && catChar.sect != null ? catChar.sect : 0);
      wrBig5(r, o + P.name, 10, name);
      wrBig5(r, o + P.nick, 10, nick);
    }

    var hero = personOff(0);
    wrI16(r, hero + P.kungfuIdStart + 0 * 2, 1);
    wrI16(r, hero + P.kungfuLevelStart + 0 * 2, 100);
    wrI16(r, hero + P.kungfuIdStart + 1 * 2, 25);
    wrI16(r, hero + P.kungfuLevelStart + 1 * 2, 200);
    wrI16(r, hero + P.mijiStart + 0 * 2, 1);

    writeInventory(r, [
      { itemId: 0, count: 10 },
      { itemId: 174, count: 0 },
      { itemId: 550, count: 38 }
    ]);
    return r;
  }

  function buildDemoEntries(rGrp) {
    var Codec = C();
    var entries = [];
    var rComp = Codec.deflateRawSync(rGrp);
    entries.push({
      name: 'r.grp',
      method: 8,
      crc32: Codec.crc32(rGrp),
      compSize: rComp.length,
      uncompSize: rGrp.length,
      rawCompBytes: rComp
    });

    var dummyNames = ['s.grp', 'd.grp', 'a.grp', 'e.grp'];
    for (var idx = 0; idx < dummyNames.length; idx++) {
      var dummy = new Uint8Array(64);
      for (var k = 0; k < dummy.length; k++) dummy[k] = (idx * 37 + k) & 0xff;
      var comp = Codec.deflateRawSync(dummy);
      entries.push({
        name: dummyNames[idx],
        method: 8,
        crc32: Codec.crc32(dummy),
        compSize: comp.length,
        uncompSize: dummy.length,
        rawCompBytes: comp
      });
    }
    return entries;
  }

  async function buildDemoEntriesAsync(rGrp) {
    var Codec = C();
    var entries = [];
    var rComp = await Codec.deflateRaw(rGrp);
    entries.push({
      name: 'r.grp',
      method: 8,
      crc32: Codec.crc32(rGrp),
      compSize: rComp.length,
      uncompSize: rGrp.length,
      rawCompBytes: rComp
    });

    var dummyNames = ['s.grp', 'd.grp', 'a.grp', 'e.grp'];
    for (var idx = 0; idx < dummyNames.length; idx++) {
      var dummy = new Uint8Array(64);
      for (var k = 0; k < dummy.length; k++) dummy[k] = (idx * 37 + k) & 0xff;
      var comp = await Codec.deflateRaw(dummy);
      entries.push({
        name: dummyNames[idx],
        method: 8,
        crc32: Codec.crc32(dummy),
        compSize: comp.length,
        uncompSize: dummy.length,
        rawCompBytes: comp
      });
    }
    return entries;
  }

  function createDemoSavBytesSync(catalog) {
    var Codec = C();
    var cat = catalog || (resolveCatalog ? resolveCatalog() : null);
    var tjm = buildDemoTjm();
    var tjmBytes = Codec.buildTjm(tjm);
    var rGrp = buildDemoRGrp(cat);
    var entries = buildDemoEntries(rGrp);
    var tjmComp = Codec.deflateRawSync(tjmBytes);
    entries.push({
      name: 'tjm',
      method: 8,
      crc32: Codec.crc32(tjmBytes),
      compSize: tjmComp.length,
      uncompSize: tjmBytes.length,
      rawCompBytes: tjmComp
    });
    return Codec.buildZip(entries);
  }

  async function createDemoSavBytes(catalog) {
    var Codec = C();
    var cat = catalog || (resolveCatalog ? resolveCatalog() : null);
    var tjm = buildDemoTjm();
    var tjmBytes = Codec.buildTjm(tjm);
    var rGrp = buildDemoRGrp(cat);
    var entries = await buildDemoEntriesAsync(rGrp);
    var tjmComp = await Codec.deflateRaw(tjmBytes);
    entries.push({
      name: 'tjm',
      method: 8,
      crc32: Codec.crc32(tjmBytes),
      compSize: tjmComp.length,
      uncompSize: tjmBytes.length,
      rawCompBytes: tjmComp
    });
    return Codec.buildZip(entries);
  }

  return {
    OFFSETS: OFFSETS,
    STAT_RANGES: STAT_RANGES,
    PRESETS: PRESETS,
    PARTY_SLOTS: PARTY_SLOTS,
    MAX_ACTIVE_INVENTORY: MAX_ACTIVE_INVENTORY,
    INVENTORY_SLOTS: INVENTORY_SLOTS,
    PERSON_COUNT: PERSON_COUNT,
    createSession: createSession,
    createDemoSavBytes: createDemoSavBytes,
    createDemoSavBytesSync: createDemoSavBytesSync
  };
});
