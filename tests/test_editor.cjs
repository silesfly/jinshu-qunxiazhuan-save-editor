'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const Catalog = require(path.join(ROOT, 'src', 'catalog-data.js'));
const Codec = require(path.join(ROOT, 'src', 'sav-codec.js'));
const Core = require(path.join(ROOT, 'src', 'editor-core.js'));

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function entry(decoded, name) {
  const e = decoded.entries.find(x => x.name === name);
  assert.ok(e, `entry ${name} missing`);
  return e;
}

function bufEq(a, b, msg) {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  assert.equal(ba.length, bb.length, msg + ' length');
  assert.ok(ba.equals(bb), msg + ' bytes');
}

// 1. Catalog
test('catalog counts & ids', () => {
  assert.equal(Catalog.sects.length, 32);
  assert.equal(Catalog.sects.find(x => x.id === 4).ko, '일월신교');
  assert.equal(Catalog.characters.length, 761);
  assert.equal(Catalog.characters.find(x => x.id === 0).zh, '小蝦米');
  assert.equal(Catalog.items.length, 675);
  for (const id of [0, 174, 550]) assert.ok(Catalog.items.find(x => x.id === id), `item ${id}`);
  assert.equal(Catalog.kungfu.length, 481);
  for (let i = 462; i <= 470; i++) assert.ok(Catalog.kungfu.find(x => x.id === i).placeholder, `kf ${i} placeholder`);
  for (let i = 471; i <= 480; i++) assert.ok(!Catalog.kungfu.find(x => x.id === i).placeholder, `kf ${i} not placeholder`);
  assert.equal(Catalog.miji.length, 104);
  assert.equal(Catalog.scenes.length, 169);
  assert.equal(Catalog.talents.length, 1335);
  for (const id of [0, 2019, 9862, 9863]) assert.ok(Catalog.talents.find(x => x.id === id), `talent ${id}`);
  assert.equal(Catalog.meridians.length, 14);
  assert.ok(Catalog.codeAtlas);
});

// 2. Codec basics
test('codec layout, crc32, deflate roundtrip', async () => {
  assert.equal(Codec.LAYOUT.R_GRP_SIZE, 1211424);
  assert.equal(Codec.LAYOUT.SAVE_IDENTITY_MAGIC, 7395211);
  assert.equal(Codec.LAYOUT.SAVE_IDENTITY_WORDS, 68);
  assert.equal(Codec.LAYOUT.SEGMENTS.Base.offset, 0);
  assert.equal(Codec.LAYOUT.SEGMENTS.Base.size, 4102);
  assert.equal(Codec.LAYOUT.SEGMENTS.Person.offset, 4102);
  assert.equal(Codec.LAYOUT.SEGMENTS.Person.size, 1278);
  assert.equal(Codec.LAYOUT.SEGMENTS.Person.count, 758);
  assert.equal(Codec.crc32(Buffer.from('123456789', 'ascii')), 0xCBF43926);

  const data = Buffer.from('jinshu '.repeat(500), 'utf8');
  const z = Codec.deflateRawSync(data);
  bufEq(Codec.inflateRawSync(z), data, 'sync roundtrip');
  const az = await Codec.deflateRaw(data);
  bufEq(await Codec.inflateRaw(az), data, 'async roundtrip');
});

// 3. Big5
test('big5 roundtrip, writeBig5Field, padding preserved', () => {
  for (const s of ['小蝦米', '胡斐', '張三豐']) {
    bufEq(Codec.decodeBig5(Codec.encodeBig5Fixed(s, 16)), s, 'big5 ' + s);
  }
  const field = new Uint8Array(10);
  Codec.writeBig5Field(field, 0, 10, '胡斐');
  assert.equal(Codec.readBig5Field(field, 0, 10), '胡斐');

  assert.throws(() => Codec.encodeBig5Fixed('A'.repeat(11), 10));
  assert.throws(() => Codec.encodeBig5Fixed('한글', 10));

  const buffer = new Uint8Array(Codec.LAYOUT.R_GRP_SIZE);
  const p1 = Codec.personOffset(1);
  Codec.writeBig5Field(buffer, p1, 10, 'A');
  buffer[p1 + 1] = 0x00;
  buffer[p1 + 2] = 0xAA;
  buffer[p1 + 3] = 0xBB;
  buffer[p1 + 4] = 0xCC;
  Codec.writeBig5Field(buffer, Codec.personOffset(0), 10, 'B');
  assert.equal(buffer[p1 + 2], 0xAA);
  assert.equal(buffer[p1 + 3], 0xBB);
  assert.equal(buffer[p1 + 4], 0xCC);

  // session-level: padding in person 1's name survives editing person 0
  const demo = Core.createDemoSavBytesSync(Catalog);
  const d0 = Codec.decodeSavSync(demo);
  Codec.writeBig5Field(d0.rGrpBytes, p1, 10, 'A');
  d0.rGrpBytes[p1 + 1] = 0x00;
  d0.rGrpBytes[p1 + 2] = 0xAA;
  d0.rGrpBytes[p1 + 3] = 0xBB;
  d0.rGrpBytes[p1 + 4] = 0xCC;
  const s = Core.createSession(Catalog);
  s.loadSavBytesSync(Codec.encodeSavSync(d0));
  const p0 = s.getParty()[0];
  s.setCharacterKungfuSlot(p0, 0, 1, 1);
  const d1 = Codec.decodeSavSync(s.exportSavBytesSync());
  assert.equal(d1.rGrpBytes[p1 + 1], 0x00);
  assert.equal(d1.rGrpBytes[p1 + 2], 0xAA);
  assert.equal(d1.rGrpBytes[p1 + 3], 0xBB);
  assert.equal(d1.rGrpBytes[p1 + 4], 0xCC);
});

// 4. TJM
test('tjm parse/build all sections + rconfig + identity', () => {
  const jsonBytes = Array.from(Buffer.from(JSON.stringify({
    format: 1,
    extras: { '661': { '0': 661 } },
    appended: {
      Wugong: { '471': { '0': 471 } },
      Teji: { '101': { '0': 101 } },
      Person: { '756': { '0': 756 } }
    }
  }), 'utf8'));
  const prefix = [1, 10, 2, 1, 2, 3, 4, 2, 11, 22, 1, 33, 44, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 55, 1, 66, 77];
  const ptf = Array.from({ length: 1001 }, () => []);
  const sptf = Array.from({ length: 1001 }, () => []);
  const basicData = {
    gold: 8888, mjcz: 15, sp: 250, shichen: 2, day: 5, month: 3,
    year: 2, weather: 1, weatherCd: 4, staminaJl: 90
  };
  const state = {
    wordCount: prefix.length, miao: 123, saveWallTime: 456789,
    saveCreateTime: 987654, reservedZero: 0,
    prefixWords: prefix, basicData,
    ptf, sptf,
    tailWords: [jsonBytes.length, ...jsonBytes, 7395211, ...new Array(66).fill(0), 7395211]
  };
  const tjm = Codec.buildTjm(state);
  const parsed = Codec.parseTjm(tjm);
  const keys = ['wordCount', 'miao', 'saveWallTime', 'saveCreateTime', 'reservedZero', 'prefixWords', 'basicData', 'ptf', 'sptf', 'tailWords'];
  for (const k of keys) assert.ok(k in parsed, 'missing ' + k);
  assert.equal(parsed.saveCreateTime, 987654);
  assert.equal(parsed.miao, 123);
  assert.equal(parsed.hasSaveIdentity, true);
  assert.equal(parsed.rconfigMeta.found, true);
  assert.deepEqual(parsed.rconfigMeta.itemIds, [661]);
  assert.deepEqual(parsed.rconfigMeta.kungfuIds, [471]);
  assert.deepEqual(parsed.rconfigMeta.mijiIds, [101]);
  assert.deepEqual(parsed.rconfigMeta.personIds, [756]);
  assert.deepEqual(parsed.prefixWords, prefix);
  assert.equal(parsed.basicData.gold, 8888);
  assert.equal(parsed.basicData.sp, 250);
});

// 5. SAV sync/async roundtrip preserves segments
test('sav decode/encode preserves segment bytes sync & async', async () => {
  const src = Core.createDemoSavBytesSync(Catalog);
  const d1 = Codec.decodeSavSync(src);
  const enc1 = Codec.encodeSavSync(d1);
  const d2 = Codec.decodeSavSync(enc1);

  for (const n of ['s.grp', 'd.grp', 'a.grp', 'e.grp']) {
    const e1 = entry(d1, n), e2 = entry(d2, n);
    bufEq(e1.rawCompBytes, e2.rawCompBytes, 'sync ' + n);
    assert.equal(e1.crc32, e2.crc32, 'sync crc ' + n);
    assert.equal(e1.compSize, e2.compSize, 'sync size ' + n);
  }
  bufEq(d1.rGrpBytes, d2.rGrpBytes, 'rGrpBytes sync');

  const src2 = Core.createDemoSavBytesSync(Catalog);
  const ad1 = await Codec.decodeSav(src2);
  const aenc = await Codec.encodeSav(ad1);
  const ad2 = await Codec.decodeSav(aenc);
  for (const n of ['s.grp', 'd.grp', 'a.grp', 'e.grp']) {
    const e1 = entry(ad1, n), e2 = entry(ad2, n);
    bufEq(e1.rawCompBytes, e2.rawCompBytes, 'async ' + n);
    assert.equal(e1.crc32, e2.crc32, 'async crc ' + n);
    assert.equal(e1.compSize, e2.compSize, 'async size ' + n);
  }
});

// 6. Party
test('party 15 slots, dup & oob rejection', () => {
  const s = Core.createSession(Catalog);
  s.loadSavBytesSync(Core.createDemoSavBytesSync(Catalog));
  const party = s.getParty();
  assert.equal(party.length, 15);
  const first = party[0];
  s.setPartySlot(14, 10);
  assert.equal(s.getParty()[14], 10);
  s.setPartySlot(14, -1);
  assert.equal(s.getParty()[14], -1);
  assert.throws(() => s.setPartySlot(1, first));
  assert.throws(() => s.setPartySlot(4, -2));
  assert.throws(() => s.setPartySlot(4, 758));
});

// 7. Presets
test('all presets apply, dirty, validate, export, reload', () => {
  const presetIds = Core.PRESETS.map(p => p.id);
  assert.equal(presetIds.length, 6);
  for (const pid of presetIds) {
    const s = Core.createSession(Catalog);
    s.loadSavBytesSync(Core.createDemoSavBytesSync(Catalog));
    s.resetChanges();
    s.applyPreset(pid);
    assert.equal(s.isDirty(), true, 'dirty after ' + pid);
    assert.ok(s.getChanges().count > 0, 'changes after ' + pid);
    assert.equal(s.validate().ok, true, 'valid ' + pid);
    const bytes = s.exportSavBytesSync();
    const s2 = Core.createSession(Catalog);
    s2.loadSavBytesSync(bytes);
    assert.equal(s2.isDirty(), false, 'clean after reload ' + pid);
  }
});

// 8. Currency & inventory sync
test('currency & inventory bidirectional sync', () => {
  const s = Core.createSession(Catalog);
  s.loadSavBytesSync(Core.createDemoSavBytesSync(Catalog));
  s.setCurrency('gold', 12345);
  assert.equal(s.getCurrencyState().gold, 12345);
  s.setCurrency('mjcz', 77);
  assert.equal(s.getCurrencyState().mjcz, 77);
  s.setCurrency('sp', 3);
  assert.equal(s.getCurrencyState().sp, 3);
  assert.ok(Core.OFFSETS.Base.spFragment >= 0);
  assert.ok(Core.OFFSETS.Base.inventoryStart >= 0);

  const findSlot = (inv, itemId) => inv.find(e => e.itemId === itemId);

  // gold > 0 keeps item 174 visible with count 0
  s.setCurrency('gold', 5000);
  let e174 = findSlot(s.getInventory(), 174);
  assert.ok(e174, 'item 174 present while gold > 0');
  assert.equal(e174.count, 0, 'item 174 count 0 when gold > 0');

  // setInventoryItem(550, 44) drives mjcz
  s.setInventoryItem(550, 44);
  assert.equal(s.getCurrencyState().mjcz, 44);

  // setCurrency('sp', 7777) syncs tjm.basicData.sp and the raw sav field
  s.setCurrency('sp', 7777);
  assert.equal(s.getCurrencyState().sp, 7777);
  const decoded = Codec.decodeSavSync(s.exportSavBytesSync());
  assert.equal(Codec.readInt16(decoded.rGrpBytes, Core.OFFSETS.Base.spFragment), 7777);

  // item 0 stored with count, survives compaction, unused slots are -1/0
  s.setInventoryItem(0, 25);
  const e0 = findSlot(s.getInventory(), 0);
  assert.ok(e0, 'item 0 present');
  assert.equal(e0.itemId, 0);
  assert.equal(e0.count, 25);
  s.removeInventoryItem(550);
  const afterCompaction = findSlot(s.getInventory(), 0);
  assert.ok(afterCompaction, 'item 0 survives compaction');
  assert.equal(afterCompaction.count, 25);

  s.setCurrency('gold', 0);
  e174 = findSlot(s.getInventory(), 174);
  assert.ok(!e174, 'item 174 gone when gold == 0');

  s.removeInventoryItem(174);
  assert.equal(s.getCurrencyState().gold, 0);

  // reload round-trip for a real item
  s.setInventoryItem(550, 4);
  const s2 = Core.createSession(Catalog);
  s2.loadSavBytesSync(s.exportSavBytesSync());
  const e550 = findSlot(s2.getInventory(), 550);
  assert.ok(e550, 'item 550 after reload');
  assert.equal(e550.count, 4);

  const emptySlot = s2.getInventory().find(e => e.slot === 14);
  if (emptySlot) {
    assert.equal(emptySlot.itemId, -1);
    assert.equal(emptySlot.count, 0);
  }
});

// 9. Stat clamping
test('stat clamp & unsigned 16-bit', () => {
  const s = Core.createSession(Catalog);
  s.loadSavBytesSync(Core.createDemoSavBytesSync(Catalog));
  const pid = s.getParty()[0];
  s.setCharacterStat(pid, 'hp', 40000);
  assert.equal(s.getCharacter(pid).hp, 32767);
  s.setCharacterStat(pid, 'exp', 65535);
  assert.equal(s.getCharacter(pid).exp, 65535);
  s.setCharacterStat(pid, 'itemPracticePts', 60000);
  assert.equal(s.getCharacter(pid).itemPracticePts, 60000);
});

// 10. Kungfu placeholders + dynamic RConfig
test('kungfu placeholder & dynamic rconfig', () => {
  const src = Core.createDemoSavBytesSync(Catalog);
  const s = Core.createSession(Catalog);
  s.loadSavBytesSync(src);
  const p = s.getParty()[0];
  for (let id = 462; id <= 470; id++) {
    assert.throws(() => s.setCharacterKungfuSlot(p, 0, id, 1), 'placeholder ' + id);
  }

  const d0 = Codec.decodeSavSync(src);
  d0.tjm.tailWords = [7395211, ...new Array(66).fill(0), 7395211];
  const stripped = Codec.encodeSavSync(d0);
  const sNo = Core.createSession(Catalog);
  sNo.loadSavBytesSync(stripped);
  const pNo = sNo.getParty()[0];
  for (let id = 462; id <= 470; id++) {
    assert.throws(() => sNo.setCharacterKungfuSlot(pNo, 0, id, 1), 'placeholder ' + id);
  }
  assert.throws(() => sNo.setCharacterKungfuSlot(pNo, 0, 471, 1), 'no rconfig');
  assert.throws(() => sNo.setCharacterMijiSlot(pNo, 0, 101), 'no rconfig');
  assert.throws(() => sNo.setInventoryItem(661, 1), 'no rconfig');

  const d = Codec.decodeSavSync(src);
  const jsonBytes = Array.from(Buffer.from(JSON.stringify({
    format: 1,
    extras: { '661': { '0': 661 } },
    appended: {
      Wugong: { '471': { '0': 471 } },
      Teji: { '101': { '0': 101 } },
      Person: { '756': { '0': 756 } }
    }
  }), 'utf8'));
  d.tjm.tailWords = [jsonBytes.length, ...jsonBytes, 7395211, ...new Array(66).fill(0), 7395211];
  const patched = Codec.encodeSavSync(d);

  const s2 = Core.createSession(Catalog);
  s2.loadSavBytesSync(patched);
  for (let id = 462; id <= 470; id++) {
    assert.throws(() => s2.setCharacterKungfuSlot(p, 0, id, 1), 'placeholder ' + id);
  }
  s2.setCharacterKungfuSlot(p, 0, 471, 500);
  s2.setCharacterMijiSlot(p, 0, 101);
  s2.setInventoryItem(661, 3);
  assert.equal(s2.validate().ok, true);
});

// 11. Talents + reset + async session
test('talents ptf/sptf, toggle, remove, reset, async', async () => {
  const s = Core.createSession(Catalog);
  await s.loadSavBytes(Core.createDemoSavBytesSync(Catalog));
  const p = s.getParty()[0];
  const t0 = s.getCharacterTalents(p);
  assert.ok(Array.isArray(t0.ptf));
  assert.ok(Array.isArray(t0.sptf));

  assert.ok(t0.ptf.some(x => x.id === 2019 && x.equipped === true));
  assert.ok(t0.sptf.some(x => x.id === 2019 && x.rawValue === 102019 && x.equipped === false));
  assert.ok(!t0.sptf.some(x => x.id === 0));

  s.addTalent(p, 0, { list: 'sptf', equipped: false });
  const added = s.getCharacterTalents(p).sptf.find(x => x.id === 0);
  assert.ok(added);
  assert.equal(added.rawValue, 100000);
  assert.equal(added.equipped, false);
  s.toggleSptfEquipped(p, 0, true);
  const toggled = s.getCharacterTalents(p).sptf.find(x => x.id === 0);
  assert.ok(toggled);
  assert.equal(toggled.rawValue, 0);
  assert.equal(toggled.equipped, true);

  s.removeTalent(p, 2019, { list: 'ptf' });
  const t1 = s.getCharacterTalents(p);
  assert.ok(!t1.ptf.some(x => x.id === 2019));
  s.addTalent(p, 2019, { list: 'ptf' });
  const t2 = s.getCharacterTalents(p);
  assert.ok(t2.ptf.some(x => x.id === 2019));
  assert.throws(() => s.addTalent(p, 999999, { list: 'ptf', equipped: false }));

  s.resetChanges();
  assert.equal(s.isDirty(), false);
  assert.equal(s.getChanges().count, 0);

  const bytes = await s.exportSavBytes();
  const s2 = Core.createSession(Catalog);
  await s2.loadSavBytes(bytes);
  assert.equal(s2.isDirty(), false);
});

// 12. Dist bundle
test('dist html bundle offline', () => {
  const file = path.join(ROOT, 'dist', 'JinshuSaveEditor-v1.1.html');
  assert.ok(fs.existsSync(file), 'dist bundle exists');
  const html = fs.readFileSync(file, 'utf8');
  assert.ok(html.length > 400000, 'bundle size');
  for (const marker of ['JINSHU_CATALOG', 'JinshuSavCodec', 'JinshuEditorCore', 'JinshuEditorUI', 'atlas-combat-cards']) {
    assert.ok(html.includes(marker), 'missing ' + marker);
  }
  assert.equal(html.split('http://').length - 1, 0, 'no http');
  assert.equal(html.split('https://').length - 1, 0, 'no https');
});

// 13. REA combat formulas & bridge in codeAtlas + HTML
test('rea combat formulas & native bridge in codeAtlas & html', () => {
  const combat = Catalog.codeAtlas && Catalog.codeAtlas.combatFormulas;
  assert.ok(Array.isArray(combat) && combat.length >= 5, 'combatFormulas array missing');
  const joined = JSON.stringify(combat);
  for (const id of [
    'War_DamageDefenseRatio',
    'SkillHitRate',
    'WAR_HurtAct_attack',
    'WAR_HurtDef_dmgprot',
    'NativeBridgeSymbols'
  ]) {
    assert.ok(joined.includes(id), 'missing formula ' + id);
  }
  assert.match(joined, /atk\s*\/\s*\(\s*atk\s*\+\s*def\s*\)/);
  assert.match(joined, /70/);
  assert.match(joined, /90/);
  assert.match(joined, /\+200%/);
  assert.match(joined, /-20%/);
  assert.match(joined, /80%/);
  assert.match(joined, /SaveSMap/);
  assert.match(joined, /SaveMMap/);
  assert.match(joined, /ZipAES/);

  const techKeys = new Set((Catalog.codeAtlas.technical || []).map(x => x.key));
  for (const k of [
    'LUA_COMBAT_DEF_RATIO',
    'LUA_SKILL_HIT_RATE',
    'LUA_HURT_ACT_ATTACK',
    'LUA_HURT_DEF_DMGPROT',
    'EXE_LUA_BRIDGE',
    'TJM_TAIL_CONTAINERS'
  ]) {
    assert.ok(techKeys.has(k), 'missing technical key ' + k);
  }

  const pageHtml = fs.readFileSync(path.join(ROOT, 'src', 'editor-page.html'), 'utf8');
  assert.ok(pageHtml.includes('atlas-combat-cards'), 'src/editor-page.html missing atlas-combat-cards');
});

// 14. TJM 7 containers (full tail & truncated demo tail)
test('tjm full tail containers & demo safe parsing', () => {
  const ptf = Array.from({ length: 1001 }, () => []);
  const sptf = Array.from({ length: 1001 }, () => []);
  ptf[0] = [9862, 0];
  sptf[0] = [9862, 102019, 102020];

  const rcObj = {
    format: 1,
    baseline: 'base-sha',
    values: { testKey: 7 },
    extras: { '661': { '0': 661 } },
    appended: { Wugong: { '471': { '0': 471 } } }
  };
  const rcBytes = Array.from(Buffer.from(JSON.stringify(rcObj), 'utf8'));

  // saveEventData(4 ints + 5 empty lists + WuPinXiuLianHigh{3:4})
  // + lastYouLiDay(3 ints) + teammateInitialState(0) + CJApplied(5 ints)
  // + SaveNPCInitialState(magic, ver=3, fCnt=0, npcCnt=0) + Puppet(5, 2)
  // + RConfig + ZMWP(120, 1) + SaveIdentity(68 words)
  const fullTail = [
    1, 2, 0, 1,
    0, 0, 0, 0, 0,
    1, 3, 4,
    3, 4, 15,
    0,
    1, 0, 1, 0, 1,
    1313887047, 3, 0, 0,
    5, 2,
    rcBytes.length, ...rcBytes,
    120, 1,
    7395211, ...new Array(66).fill(0), 7395211
  ];

  const tjmBytes = Codec.buildTjm({
    wordCount: 0,
    miao: 100,
    saveWallTime: 1700000100,
    saveCreateTime: 1700000000,
    reservedZero: 0,
    prefixWords: [0, 0, 0, 0, 0, 0],
    basicData: { gold: 5000, mjcz: 10, sp: 100, shichen: 1, day: 2, month: 3, year: 4, weather: 0, weatherCd: 0, staminaJl: 80 },
    ptf,
    sptf,
    tailWords: fullTail
  });

  const parsed = Codec.parseTjm(tjmBytes);
  const c = parsed.containers;
  assert.ok(c, 'containers missing');
  for (const name of ['PTF', 'SPTF', 'RConfig', 'ZMWP', '傀儡', 'CJApplied', 'WuPinXiuLianHigh']) {
    assert.equal(c[name].present, true, name + ' present');
    assert.ok(c[name].byteSize > 0, name + ' byteSize');
    assert.ok(c[name].wordCount > 0, name + ' wordCount');
  }
  assert.deepEqual(c.ZMWP.summary.values, [120, 1]);
  assert.equal(c['傀儡'].summary.personId, 5);
  assert.equal(c['傀儡'].summary.rank, 2);
  assert.equal(c.CJApplied.summary.fields.attack, 1);
  assert.equal(c.WuPinXiuLianHigh.summary.entries['3'], 4);
  assert.equal(c.SPTF.summary.equippedCount, 1);
  assert.equal(c.SPTF.summary.storedCount, 2);

  // Demo truncated tail must not throw and should mark absent tail containers false
  const demoSav = Core.createDemoSavBytesSync(Catalog);
  const dec = Codec.decodeSavSync(demoSav);
  const dc = dec.tjm.containers;
  assert.equal(dc.PTF.present, true);
  assert.equal(dc.SPTF.present, true);
  assert.equal(dc.RConfig.present, true);
  for (const name of ['ZMWP', '傀儡', 'CJApplied', 'WuPinXiuLianHigh']) {
    assert.equal(dc[name].present, false, 'demo ' + name + ' absent');
  }
});

(async () => {
  let pass = 0, fail = 0;
  for (const t of tests) {
    try {
      await t.fn();
      pass++;
      console.log('PASS ' + t.name);
    } catch (e) {
      fail++;
      console.error('FAIL ' + t.name + '\n' + (e && e.stack || e));
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
