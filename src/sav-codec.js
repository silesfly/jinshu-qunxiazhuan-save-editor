(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.JinshuSavCodec = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var LAYOUT = {
    R_GRP_SIZE: 1211424,
    SAVE_IDENTITY_MAGIC: 7395211,
    SAVE_IDENTITY_WORDS: 68,
    SEGMENTS: {
      Base:   { offset: 0,       size: 4102, count: 1 },
      Person: { offset: 4102,    size: 1278, count: 758 },
      Thing:  { offset: 972826,  size: 206,  count: 661 },
      Scene:  { offset: 1108992, size: 54,   count: 169 },
      Wugong: { offset: 1118118, size: 190,  count: 471 },
      Shop:   { offset: 1207608, size: 36,   count: 5 },
      Teji:   { offset: 1207788, size: 36,   count: 101 }
    }
  };

  var _crcTable = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function toU8(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value == null) return new Uint8Array(0);
    return new Uint8Array(value);
  }

  function crc32(input) {
    var u8 = toU8(input);
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) {
      crc = (crc >>> 8) ^ _crcTable[(crc ^ u8[i]) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function readU16Raw(u8, off) {
    return u8[off] | (u8[off + 1] << 8);
  }

  function readU32Raw(u8, off) {
    return (u8[off] | (u8[off + 1] << 8) | (u8[off + 2] << 16) | (u8[off + 3] << 24)) >>> 0;
  }

  function writeU16Raw(u8, off, v) {
    u8[off] = v & 0xFF;
    u8[off + 1] = (v >>> 8) & 0xFF;
  }

  function writeU32Raw(u8, off, v) {
    u8[off] = v & 0xFF;
    u8[off + 1] = (v >>> 8) & 0xFF;
    u8[off + 2] = (v >>> 16) & 0xFF;
    u8[off + 3] = (v >>> 24) & 0xFF;
  }

  function hasSig(u8, off, sig) {
    return off >= 0 && off + 4 <= u8.length &&
      u8[off] === (sig & 0xFF) &&
      u8[off + 1] === ((sig >>> 8) & 0xFF) &&
      u8[off + 2] === ((sig >>> 16) & 0xFF) &&
      u8[off + 3] === ((sig >>> 24) & 0xFF);
  }

  function utf8Encode(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(str));
    var s = unescape(encodeURIComponent(String(str)));
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xFF;
    return out;
  }

  function utf8Decode(u8) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8', { fatal: false }).decode(u8);
    var s = '';
    for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
  }

  function parseZip(savBytes) {
    var bytes = toU8(savBytes);
    if (bytes.length < 22) throw new Error('SAV 파일이 너무 작습니다: ZIP EOCD를 찾을 수 없습니다.');

    var eocd = -1;
    var min = Math.max(0, bytes.length - 65557);
    for (var i = bytes.length - 22; i >= min; i--) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4B &&
          bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('ZIP EOCD(0x06054b50)를 찾을 수 없습니다.');

    var diskNo = readU16Raw(bytes, eocd + 4);
    var cdDiskNo = readU16Raw(bytes, eocd + 6);
    var entriesDisk = readU16Raw(bytes, eocd + 8);
    var totalEntries = readU16Raw(bytes, eocd + 10);
    var cdSize = readU32Raw(bytes, eocd + 12);
    var cdOffset = readU32Raw(bytes, eocd + 16);
    var commentLen = readU16Raw(bytes, eocd + 20);

    if (diskNo === 0xFFFF || cdDiskNo === 0xFFFF || entriesDisk === 0xFFFF ||
        totalEntries === 0xFFFF || cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF) {
      throw new Error('ZIP64 형식은 지원하지 않습니다.');
    }
    if (eocd + 22 + commentLen > bytes.length) {
      throw new Error('ZIP EOCD 주석 길이가 파일 범위를 초과합니다.');
    }
    if (cdOffset + cdSize > bytes.length) {
      throw new Error('ZIP Central Directory 범위가 파일 범위를 초과합니다.');
    }

    var entries = [];
    var p = cdOffset;
    for (var idx = 0; idx < totalEntries; idx++) {
      if (!hasSig(bytes, p, 0x02014b50)) {
        throw new Error('ZIP Central Directory 시그니처가 올바르지 않습니다. index=' + idx);
      }
      if (p + 46 > bytes.length) throw new Error('ZIP Central Directory 항목이 잘렸습니다.');
      var versionMadeBy = readU16Raw(bytes, p + 4);
      var versionNeeded = readU16Raw(bytes, p + 6);
      var flags = readU16Raw(bytes, p + 8);
      var method = readU16Raw(bytes, p + 10);
      var dosTime = readU16Raw(bytes, p + 12);
      var dosDate = readU16Raw(bytes, p + 14);
      var crcVal = readU32Raw(bytes, p + 16);
      var compSize = readU32Raw(bytes, p + 20);
      var uncompSize = readU32Raw(bytes, p + 24);
      var nameLen = readU16Raw(bytes, p + 28);
      var extraLen = readU16Raw(bytes, p + 30);
      var commentLen2 = readU16Raw(bytes, p + 32);
      var internalAttr = readU16Raw(bytes, p + 36);
      var externalAttr = readU32Raw(bytes, p + 38);
      var localHeaderOffset = readU32Raw(bytes, p + 42);
      var nameStart = p + 46;
      var extraStart = nameStart + nameLen;
      var commentStart = extraStart + extraLen;
      var next = commentStart + commentLen2;
      if (next > bytes.length) throw new Error('ZIP Central Directory 항목 데이터가 잘렸습니다.');

      var nameBytes = bytes.slice(nameStart, extraStart);
      var name = utf8Decode(nameBytes);
      var extraField = bytes.slice(extraStart, commentStart);
      var comment = bytes.slice(commentStart, next);

      if (localHeaderOffset + 30 > bytes.length || !hasSig(bytes, localHeaderOffset, 0x04034b50)) {
        throw new Error('ZIP Local File Header를 찾을 수 없습니다: ' + name);
      }
      var localNameLen = readU16Raw(bytes, localHeaderOffset + 26);
      var localExtraLen = readU16Raw(bytes, localHeaderOffset + 28);
      var dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      if (dataStart + compSize > bytes.length) {
        throw new Error('ZIP 압축 데이터 범위가 파일 범위를 초과합니다: ' + name);
      }
      var rawCompBytes = bytes.slice(dataStart, dataStart + compSize);

      entries.push({
        name: name,
        versionMadeBy: versionMadeBy,
        versionNeeded: versionNeeded,
        flags: flags,
        method: method,
        dosTime: dosTime,
        dosDate: dosDate,
        crc32: crcVal,
        compSize: compSize,
        uncompSize: uncompSize,
        internalAttr: internalAttr,
        externalAttr: externalAttr,
        extraField: extraField,
        comment: comment,
        rawCompBytes: rawCompBytes,
        dirty: false,
        uncompBytes: null
      });
      p = next;
    }
    return entries;
  }

  function buildZip(entries) {
    var list = entries || [];
    var count = list.length;
    if (count > 0xFFFF) throw new Error('ZIP 항목 수가 65535개를 초과합니다.');

    var localChunks = [];
    var centralChunks = [];
    var localOffset = 0;
    var centralSize = 0;

    for (var i = 0; i < count; i++) {
      var entry = list[i] || {};
      var nameBytes = entry.nameBytes ? toU8(entry.nameBytes) : utf8Encode(entry.name || '');
      var extra = entry.extraField ? toU8(entry.extraField) : new Uint8Array(0);
      var comment = entry.comment ? toU8(entry.comment) : new Uint8Array(0);
      var data = entry.rawCompBytes ? toU8(entry.rawCompBytes) : new Uint8Array(0);
      var method = (entry.method == null) ? (data.length ? 8 : 0) : (entry.method & 0xFFFF);
      var flags = (entry.flags == null ? 0 : entry.flags) & ~0x0008;
      var versionMadeBy = entry.versionMadeBy == null ? 20 : (entry.versionMadeBy & 0xFFFF);
      var versionNeeded = entry.versionNeeded == null ? 20 : (entry.versionNeeded & 0xFFFF);
      var dosTime = entry.dosTime == null ? 0 : (entry.dosTime & 0xFFFF);
      var dosDate = entry.dosDate == null ? 0 : (entry.dosDate & 0xFFFF);
      var compSize = entry.compSize == null ? data.length : (entry.compSize >>> 0);
      var uncompSize = entry.uncompSize == null ? (entry.uncompBytes ? entry.uncompBytes.length : compSize) : (entry.uncompSize >>> 0);
      var crcVal = entry.crc32 == null ? 0 : (entry.crc32 >>> 0);
      var internalAttr = entry.internalAttr == null ? 0 : (entry.internalAttr & 0xFFFF);
      var externalAttr = entry.externalAttr == null ? 0 : (entry.externalAttr >>> 0);

      if (data.length !== compSize) {
        throw new Error('ZIP 항목 압축 데이터 길이 불일치: ' + (entry.name || '') + ' (' + data.length + ' != ' + compSize + ')');
      }
      if (nameBytes.length > 0xFFFF || extra.length > 0xFFFF || comment.length > 0xFFFF) {
        throw new Error('ZIP 항목 이름/추가필드/주석 길이가 65535바이트를 초과합니다.');
      }
      if (localOffset + 30 + nameBytes.length + extra.length + data.length > 0xFFFFFFFF) {
        throw new Error('ZIP Local Header 오프셋이 32비트 범위를 초과합니다.');
      }

      var localHeader = new Uint8Array(30);
      writeU32Raw(localHeader, 0, 0x04034b50);
      writeU16Raw(localHeader, 4, versionNeeded);
      writeU16Raw(localHeader, 6, flags);
      writeU16Raw(localHeader, 8, method);
      writeU16Raw(localHeader, 10, dosTime);
      writeU16Raw(localHeader, 12, dosDate);
      writeU32Raw(localHeader, 14, crcVal);
      writeU32Raw(localHeader, 18, compSize);
      writeU32Raw(localHeader, 22, uncompSize);
      writeU16Raw(localHeader, 26, nameBytes.length);
      writeU16Raw(localHeader, 28, extra.length);

      localChunks.push(localHeader, nameBytes, extra, data);

      var centralHeader = new Uint8Array(46);
      writeU32Raw(centralHeader, 0, 0x02014b50);
      writeU16Raw(centralHeader, 4, versionMadeBy);
      writeU16Raw(centralHeader, 6, versionNeeded);
      writeU16Raw(centralHeader, 8, flags);
      writeU16Raw(centralHeader, 10, method);
      writeU16Raw(centralHeader, 12, dosTime);
      writeU16Raw(centralHeader, 14, dosDate);
      writeU32Raw(centralHeader, 16, crcVal);
      writeU32Raw(centralHeader, 20, compSize);
      writeU32Raw(centralHeader, 24, uncompSize);
      writeU16Raw(centralHeader, 28, nameBytes.length);
      writeU16Raw(centralHeader, 30, extra.length);
      writeU16Raw(centralHeader, 32, comment.length);
      writeU16Raw(centralHeader, 34, 0);
      writeU16Raw(centralHeader, 36, internalAttr);
      writeU32Raw(centralHeader, 38, externalAttr);
      writeU32Raw(centralHeader, 42, localOffset);

      centralChunks.push(centralHeader, nameBytes, extra, comment);
      centralSize += 46 + nameBytes.length + extra.length + comment.length;
      localOffset += 30 + nameBytes.length + extra.length + data.length;
    }

    if (centralSize > 0xFFFFFFFF || localOffset + centralSize > 0xFFFFFFFF) {
      throw new Error('ZIP 크기가 32비트 범위를 초과합니다.');
    }

    var eocd = new Uint8Array(22);
    writeU32Raw(eocd, 0, 0x06054b50);
    writeU16Raw(eocd, 4, 0);
    writeU16Raw(eocd, 6, 0);
    writeU16Raw(eocd, 8, count);
    writeU16Raw(eocd, 10, count);
    writeU32Raw(eocd, 12, centralSize);
    writeU32Raw(eocd, 16, localOffset);
    writeU16Raw(eocd, 20, 0);

    var chunks = localChunks.concat(centralChunks, [eocd]);
    var total = 0;
    for (var c = 0; c < chunks.length; c++) total += chunks[c].length;
    var out = new Uint8Array(total);
    var pos = 0;
    for (var d = 0; d < chunks.length; d++) {
      out.set(chunks[d], pos);
      pos += chunks[d].length;
    }
    return out;
  }

  var isNode = typeof process === 'object' && process !== null && process.versions && process.versions.node;
  var nodeZlib = null;
  if (isNode) {
    try {
      nodeZlib = require('zlib');
    } catch (e) {
      nodeZlib = null;
    }
  }

  function inflateRawSync(u8) {
    if (!isNode || !nodeZlib) throw new Error('동기 압축 해제는 Node.js zlib에서만 지원됩니다.');
    return new Uint8Array(nodeZlib.inflateRawSync(toU8(u8)));
  }

  function deflateRawSync(u8) {
    if (!isNode || !nodeZlib) throw new Error('동기 압축은 Node.js zlib에서만 지원됩니다.');
    return new Uint8Array(nodeZlib.deflateRawSync(toU8(u8)));
  }

  function streamRawTransform(u8, format, kind) {
    return new Promise(function (resolve, reject) {
      var StreamCtor = kind === 'inflate' ? (typeof DecompressionStream !== 'undefined' ? DecompressionStream : null)
                                           : (typeof CompressionStream !== 'undefined' ? CompressionStream : null);
      if (!StreamCtor) {
        reject(new Error((kind === 'inflate' ? 'DecompressionStream' : 'CompressionStream') + '를 사용할 수 없습니다.'));
        return;
      }
      var stream;
      try {
        stream = new StreamCtor(format);
      } catch (e) {
        reject(new Error('deflate-raw 스트림을 생성할 수 없습니다: ' + e.message));
        return;
      }
      var writer = stream.writable.getWriter();
      var reader = stream.readable.getReader();
      var chunks = [];
      var total = 0;
      var readDone = false;
      var readError = null;

      function pump() {
        return reader.read().then(function (result) {
          if (result.done) {
            readDone = true;
            return;
          }
          var chunk = result.value;
          chunks.push(chunk);
          total += chunk.length;
          return pump();
        });
      }

      var readPromise = pump();
      var src = toU8(u8);
      var writePromise;
      try {
        writePromise = writer.write(src).then(function () {
          return writer.close();
        });
      } catch (e) {
        readError = e;
        writePromise = Promise.reject(e);
      }

      Promise.all([readPromise, writePromise]).then(function () {
        if (readError) throw readError;
        var out = new Uint8Array(total);
        var pos = 0;
        for (var i = 0; i < chunks.length; i++) {
          out.set(chunks[i], pos);
          pos += chunks[i].length;
        }
        resolve(out);
      }).catch(function (err) {
        try { reader.cancel(); } catch (e1) {}
        try { writer.abort(); } catch (e2) {}
        reject(err);
      });
    });
  }

  function inflateRaw(u8) {
    if (isNode && nodeZlib) return Promise.resolve(inflateRawSync(u8));
    return streamRawTransform(u8, 'deflate-raw', 'inflate');
  }

  function deflateRaw(u8) {
    if (isNode && nodeZlib) return Promise.resolve(deflateRawSync(u8));
    return streamRawTransform(u8, 'deflate-raw', 'deflate');
  }

  function entryUncompressed(entry) {
    if (entry.uncompBytes) return toU8(entry.uncompBytes);
    if (entry.method === 0) return toU8(entry.rawCompBytes).slice();
    if (entry.method === 8) return inflateRaw(entry.rawCompBytes);
    throw new Error('지원하지 않는 ZIP 압축 방식입니다: ' + entry.method);
  }

  function entryUncompressedSync(entry) {
    if (entry.uncompBytes) return toU8(entry.uncompBytes);
    if (entry.method === 0) return toU8(entry.rawCompBytes).slice();
    if (entry.method === 8) return inflateRawSync(entry.rawCompBytes);
    throw new Error('지원하지 않는 ZIP 압축 방식입니다: ' + entry.method);
  }

  var _big5EncodeMap = null;

  function decodeBig5(input) {
    var bytes = toU8(input);
    var end = bytes.length;
    for (var i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0x00) {
        end = i;
        break;
      }
    }
    var slice = bytes.slice(0, end);
    var decoder = new TextDecoder('big5', { fatal: false });
    return decoder.decode(slice).replace(/\u0000+$/g, '');
  }

  function ensureBig5Map() {
    if (_big5EncodeMap) return _big5EncodeMap;
    var map = new Map();
    var pairs = [];
    for (var lead = 0x81; lead <= 0xFE; lead++) {
      for (var trail = 0x40; trail <= 0x7E; trail++) pairs.push([lead, trail]);
      for (var trail2 = 0xA1; trail2 <= 0xFE; trail2++) pairs.push([lead, trail2]);
    }
    var buf = new Uint8Array(pairs.length * 3);
    var o = 0;
    for (var i = 0; i < pairs.length; i++) {
      buf[o++] = pairs[i][0];
      buf[o++] = pairs[i][1];
      buf[o++] = 0x0A;
    }
    var decoded = new TextDecoder('big5', { fatal: false }).decode(buf);
    var parts = decoded.split('\n');
    for (var k = 0; k < pairs.length && k < parts.length; k++) {
      var ch = parts[k];
      if (ch && Array.from(ch).length === 1 && ch !== '\uFFFD' && !map.has(ch)) {
        map.set(ch, (pairs[k][0] << 8) | pairs[k][1]);
      }
    }
    _big5EncodeMap = map;
    return map;
  }

  function encodeBig5Fixed(str, byteLen) {
    var out = new Uint8Array(byteLen);
    var pos = 0;
    var text = String(str == null ? '' : str);
    for (var iter = text[Symbol.iterator](), step = iter.next(); !step.done; step = iter.next()) {
      var ch = step.value;
      var cp = ch.codePointAt(0);
      if (cp <= 0x7F) {
        if (pos + 1 > byteLen) throw new Error('Big5 고정 길이 필드가 1바이트 초과했습니다.');
        out[pos++] = cp & 0xFF;
      } else {
        var pair = ensureBig5Map().get(ch);
        if (pair == null) throw new Error('Big5 인코딩 불가 문자: "' + ch + '"');
        if (pos + 2 > byteLen) throw new Error('Big5 고정 길이 필드가 2바이트 초과했습니다.');
        out[pos++] = (pair >> 8) & 0xFF;
        out[pos++] = pair & 0xFF;
      }
    }
    return out;
  }

  function personOffset(personId) {
    if (!Number.isInteger(personId) || personId < 0 || personId >= 758) {
      throw new Error('Person ID 범위 오류: 0 이상 758 미만의 정수여야 합니다.');
    }
    return 4102 + personId * 1278;
  }

  function dataViewOf(u8) {
    var bytes = toU8(u8);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  function checkRange(u8, offset, size) {
    var bytes = toU8(u8);
    if (offset < 0 || offset + size > bytes.length) throw new Error('r.grp 바이너리 범위를 초과했습니다.');
  }

  function readInt16(u8, offset) {
    checkRange(u8, offset, 2);
    return dataViewOf(u8).getInt16(offset, true);
  }

  function writeInt16(u8, offset, value) {
    checkRange(u8, offset, 2);
    dataViewOf(u8).setInt16(offset, value, true);
  }

  function readUint16(u8, offset) {
    checkRange(u8, offset, 2);
    return dataViewOf(u8).getUint16(offset, true);
  }

  function writeUint16(u8, offset, value) {
    checkRange(u8, offset, 2);
    dataViewOf(u8).setUint16(offset, value, true);
  }

  function readInt32(u8, offset) {
    checkRange(u8, offset, 4);
    return dataViewOf(u8).getInt32(offset, true);
  }

  function writeInt32(u8, offset, value) {
    checkRange(u8, offset, 4);
    dataViewOf(u8).setInt32(offset, value, true);
  }

  function readBig5Field(u8, offset, byteLen) {
    checkRange(u8, offset, byteLen);
    return decodeBig5(toU8(u8).slice(offset, offset + byteLen));
  }

  function writeBig5Field(u8, offset, byteLen, str) {
    checkRange(u8, offset, byteLen);
    var bytes = toU8(u8);
    var encoded = encodeBig5Fixed(str, byteLen);
    bytes.set(encoded, offset);
  }

  function tjmEnsure(cond, msg) {
    if (!cond) throw new Error('TJM 형식 오류: ' + msg);
  }

  function numericKeysSorted(obj) {
    if (!obj || typeof obj !== 'object') return [];
    var arr = [];
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      var n = Number(k);
      if (Number.isFinite(n) && String(n) === String(k) && n >= 0 && Math.floor(n) === n) arr.push(n);
    }
    arr.sort(function (a, b) { return a - b; });
    return arr;
  }

  function scanRConfigTail(tailWords) {
    for (var i = 0; i < tailWords.length; i++) {
      var len = tailWords[i];
      if (!(len >= 20 && len <= 500000 && i + 1 + len <= tailWords.length)) continue;
      if (tailWords[i + 1] !== 0x7B || tailWords[i + 2] !== 0x22) continue;
      if (tailWords[i + len] !== 0x7D) continue;
      var okBytes = true;
      var bytes = new Uint8Array(len);
      for (var j = 0; j < len; j++) {
        var v = tailWords[i + 1 + j];
        if (!(v >= 0 && v <= 255)) { okBytes = false; break; }
        bytes[j] = v;
      }
      if (!okBytes) continue;
      var obj = null;
      try {
        obj = JSON.parse(utf8Decode(bytes));
      } catch (e) {
        continue;
      }
      if (!obj || typeof obj !== 'object') continue;
      if (!(obj.format === 1 || obj.extras || obj.appended)) continue;
      var itemIds = numericKeysSorted(obj.extras || {});
      var kungfuIds = numericKeysSorted((obj.appended && obj.appended.Wugong) || {});
      var mijiIds = numericKeysSorted((obj.appended && obj.appended.Teji) || {});
      var personIds = numericKeysSorted((obj.appended && obj.appended.Person) || {});
      var valuesObj = (obj.values && typeof obj.values === 'object') ? obj.values : null;
      return {
        found: true,
        format: obj.format || 1,
        lengthPrefixed: true,
        startOffset: i,
        endOffset: i + 1 + len,
        byteLength: len,
        streamByteSize: 4 * (1 + len),
        baseline: typeof obj.baseline === 'string' ? obj.baseline : '',
        valuesCount: valuesObj ? Object.keys(valuesObj).length : 0,
        itemIds: itemIds,
        kungfuIds: kungfuIds,
        mijiIds: mijiIds,
        personIds: personIds
      };
    }
    return {
      found: false,
      format: 0,
      lengthPrefixed: false,
      startOffset: -1,
      endOffset: -1,
      byteLength: 0,
      streamByteSize: 0,
      baseline: '',
      valuesCount: 0,
      itemIds: [],
      kungfuIds: [],
      mijiIds: [],
      personIds: []
    };
  }

  function emptyContainer() {
    return { present: false, byteSize: 0, wordCount: 0, summary: null };
  }

  function parseFullTailPrefixJs(body, rcStart, hasRConfig) {
    var NPC_PROFILE_MAGIC = 1313887047;
    var RECORD_FIELDS_COUNT = 61;
    var SKILL_SLOTS_TJM = 15;
    var out = {
      WuPinXiuLianHigh: emptyContainer(),
      CJApplied: emptyContainer(),
      '傀儡': emptyContainer()
    };
    var limit = hasRConfig ? rcStart : body.length;
    if (limit <= 0 || limit > body.length) return out;

    var p = 0;
    function need(k) { return p + k <= limit; }
    function rd() { return body[p++]; }

    // 1. saveEventData -> 끝부분 WuPinXiuLianHigh
    if (!need(4)) return out;
    p += 4;
    if (!need(1)) return out;
    var lmCnt = rd();
    if (lmCnt < 0 || !need(5 * lmCnt)) return out;
    p += 5 * lmCnt;

    if (!need(1)) return out;
    var neCnt = rd();
    if (neCnt < 0) return out;
    for (var ni = 0; ni < neCnt; ni++) {
      if (!need(11)) return out;
      p += 10;
      var talkCnt = rd();
      if (talkCnt < 0 || !need(talkCnt)) return out;
      p += talkCnt;
    }

    if (!need(1)) return out;
    var gnCnt = rd();
    if (gnCnt < 0 || !need(3 * gnCnt)) return out;
    p += 3 * gnCnt;

    if (!need(1)) return out;
    var ntCnt = rd();
    if (ntCnt < 0 || !need(2 * ntCnt)) return out;
    p += 2 * ntCnt;

    if (!need(1)) return out;
    var meCnt = rd();
    if (meCnt < 0) return out;
    for (var mi = 0; mi < meCnt; mi++) {
      if (!need(1)) return out;
      var nLen = rd();
      if (nLen < 0 || !need(nLen + 1)) return out;
      p += nLen;
      var sLen = rd();
      if (sLen < 0 || !need(sLen + 1)) return out;
      p += sLen + 1;
    }

    if (!need(1)) return out;
    var wpStart = p;
    var wpCnt = rd();
    if (wpCnt < 0 || !need(2 * wpCnt)) return out;
    var wpEntries = {};
    for (var wi = 0; wi < wpCnt; wi++) {
      var wPid = rd();
      var wHigh = rd();
      wpEntries[String(wPid)] = wHigh;
    }
    var wpWords = p - wpStart;
    var wpResult = {
      present: true,
      byteSize: 4 * wpWords,
      wordCount: wpWords,
      summary: { count: wpCnt, entries: wpEntries }
    };

    // 2. lastYouLiDay (1 or 3 words) + teammateInitialState + CJApplied + SaveNPCInitialState + 傀儡
    function tryFrom(posStart) {
      var q = posStart;
      function qNeed(k) { return q + k <= limit; }
      function qRd() { return body[q++]; }

      if (!qNeed(1)) return null;
      var tmCnt = qRd();
      if (tmCnt < 0 || tmCnt > 1000) return null;
      for (var ti = 0; ti < tmCnt; ti++) {
        if (!qNeed(1 + RECORD_FIELDS_COUNT)) return null;
        q += 1 + RECORD_FIELDS_COUNT;
        for (var si = 0; si < SKILL_SLOTS_TJM; si++) {
          if (!qNeed(3)) return null;
          q += 2;
          var nmLen = qRd();
          if (nmLen < 0 || !qNeed(nmLen)) return null;
          q += nmLen;
        }
        if (!qNeed(1)) return null;
        var qxCnt = qRd();
        if (qxCnt < 0 || !qNeed(qxCnt + 150 + 10 + 8 + 1)) return null;
        q += qxCnt + 150 + 10 + 8;
        var tfCnt = qRd();
        if (tfCnt < 0 || !qNeed(tfCnt)) return null;
        q += tfCnt;
      }

      if (!qNeed(5)) return null;
      var cjFlags = [qRd(), qRd(), qRd(), qRd(), qRd()];

      if (q < limit && body[q] === NPC_PROFILE_MAGIC) {
        q += 1;
        if (!qNeed(2)) return null;
        var ver = qRd();
        var fCnt = qRd();
        if (ver < 1 || ver > 3 || fCnt < 0 || fCnt > 2048) return null;
        for (var fi = 0; fi < fCnt; fi++) {
          if (!qNeed(1)) return null;
          var flen = qRd();
          if (flen < 0 || flen > 256 || !qNeed(flen)) return null;
          q += flen;
        }
        if (!qNeed(1)) return null;
        var npcCnt = qRd();
        if (npcCnt < 0 || npcCnt > 2048) return null;
        for (var npi = 0; npi < npcCnt; npi++) {
          if (!qNeed(1)) return null;
          q += 1;
          for (var ffi = 0; ffi < fCnt; ffi++) {
            if (!qNeed(1)) return null;
            var kind = qRd();
            if (kind === 1 || kind === 3) {
              if (!qNeed(1)) return null;
              q += 1;
            } else if (kind === 2) {
              if (!qNeed(1)) return null;
              var slen = qRd();
              if (slen < 0 || slen > 65535 || !qNeed(slen)) return null;
              q += slen;
            } else if (kind !== 0) {
              return null;
            }
          }
          if (!qNeed(1)) return null;
          var tCnt = qRd();
          if (tCnt < 0 || tCnt > 4096 || !qNeed(tCnt)) return null;
          q += tCnt;
          if (ver >= 2) {
            if (!qNeed(5)) return null;
            q += 5;
          }
          if (ver >= 3) {
            if (!qNeed(1)) return null;
            var svCnt = qRd();
            if (svCnt < 0 || svCnt > fCnt || !qNeed(2 * svCnt + 1)) return null;
            q += 2 * svCnt;
            var stCnt = qRd();
            if (stCnt < 0 || stCnt > 4096 || !qNeed(2 * stCnt)) return null;
            q += 2 * stCnt;
          }
        }
      }

      var rem = limit - q;
      if (rem !== 0 && rem !== 2) return null;
      var puppetRes = emptyContainer();
      if (rem === 2) {
        var pId = body[q] | 0;
        var pRank = body[q + 1] | 0;
        puppetRes = {
          present: true,
          byteSize: 8,
          wordCount: 2,
          summary: { personId: pId, rank: pRank, active: pId !== 0 }
        };
      }
      return {
        cj: {
          present: true,
          byteSize: 20,
          wordCount: 5,
          summary: {
            flags: cjFlags,
            fields: {
              attack: cjFlags[0],
              defense: cjFlags[1],
              qinggong: cjFlags[2],
              maxHp: cjFlags[3],
              maxMp: cjFlags[4]
            }
          }
        },
        puppet: puppetRes
      };
    }

    var steps = (p < limit && body[p] === 0) ? [1, 3] : [3, 1];
    for (var si2 = 0; si2 < steps.length; si2++) {
      var st = steps[si2];
      if (p + st <= limit) {
        var parsed = tryFrom(p + st);
        if (parsed) {
          out.WuPinXiuLianHigh = wpResult;
          out.CJApplied = parsed.cj;
          out['傀儡'] = parsed.puppet;
          return out;
        }
      }
    }
    return out;
  }

  function parseTjmContainers(tailWords, ptf, sptf, hasSaveIdentity, rconfigMeta) {
    var ptfWords = 0, ptfNonEmpty = 0, ptfTotal = 0;
    for (var i = 0; i < (ptf ? ptf.length : 0); i++) {
      var list1 = ptf[i] || [];
      ptfWords += 1 + list1.length;
      if (list1.length > 0) ptfNonEmpty++;
      ptfTotal += list1.length;
    }

    var sptfWords = 0, sptfNonEmpty = 0, sptfEquipped = 0, sptfStored = 0;
    for (var j = 0; j < (sptf ? sptf.length : 0); j++) {
      var list2 = sptf[j] || [];
      sptfWords += 1 + list2.length;
      if (list2.length > 0) sptfNonEmpty++;
      for (var k = 0; k < list2.length; k++) {
        if (list2[k] < 100000) sptfEquipped++;
        else sptfStored++;
      }
    }

    var body = hasSaveIdentity && tailWords.length >= 68
      ? tailWords.slice(0, tailWords.length - 68)
      : tailWords.slice();

    var rcFound = !!(rconfigMeta && rconfigMeta.found);
    var zmwp = emptyContainer();
    if (rcFound && rconfigMeta.lengthPrefixed && (body.length - rconfigMeta.endOffset === 2)) {
      var z0 = body[rconfigMeta.endOffset] | 0;
      var z1 = body[rconfigMeta.endOffset + 1] | 0;
      zmwp = {
        present: true,
        byteSize: 8,
        wordCount: 2,
        summary: { values: [z0, z1], itemId: z0, extra: z1 }
      };
    }

    var tailPrefix = parseFullTailPrefixJs(
      body,
      rcFound ? rconfigMeta.startOffset : body.length,
      rcFound
    );

    return {
      PTF: {
        present: true,
        byteSize: 4 * ptfWords,
        wordCount: ptfWords,
        summary: { slots: 1001, nonEmptyChars: ptfNonEmpty, totalEntries: ptfTotal }
      },
      SPTF: {
        present: true,
        byteSize: 4 * sptfWords,
        wordCount: sptfWords,
        summary: {
          slots: 1001,
          nonEmptyChars: sptfNonEmpty,
          equippedCount: sptfEquipped,
          storedCount: sptfStored,
          totalEntries: sptfEquipped + sptfStored
        }
      },
      RConfig: {
        present: rcFound,
        byteSize: rcFound ? rconfigMeta.byteLength : 0,
        wordCount: rcFound ? (rconfigMeta.streamByteSize / 4) : 0,
        summary: rcFound ? rconfigMeta : null
      },
      ZMWP: zmwp,
      '傀儡': tailPrefix['傀儡'],
      CJApplied: tailPrefix.CJApplied,
      WuPinXiuLianHigh: tailPrefix.WuPinXiuLianHigh
    };
  }

  function parseTjm(tjmBytes) {
    var bytes = toU8(tjmBytes);
    tjmEnsure(bytes.length >= 20, '헤더가 20바이트보다 작습니다.');
    tjmEnsure((bytes.length - 20) % 4 === 0, '본문 길이가 4바이트 배수가 아닙니다.');
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var wordCount = dv.getInt32(0, true);
    var miao = dv.getInt32(4, true);
    var saveWallTime = dv.getInt32(8, true);
    var saveCreateTime = dv.getInt32(12, true);
    var reservedZero = dv.getInt32(16, true);
    tjmEnsure(wordCount >= 0, 'wordCount가 음수입니다.');
    tjmEnsure(20 + 4 * wordCount === bytes.length, 'wordCount와 파일 길이가 일치하지 않습니다: ' + wordCount);

    var w = new Int32Array(wordCount);
    for (var wi = 0; wi < wordCount; wi++) w[wi] = dv.getInt32(20 + wi * 4, true);
    var p = 0;
    function ensure(cond, msg) {
      tjmEnsure(cond, msg + ' (p=' + p + ', N=' + wordCount + ')');
    }

    ensure(p < w.length, 'Section 1 tmCnt 누락');
    var tmCnt = w[p++];
    ensure(tmCnt >= 0 && tmCnt <= 2000, 'tmCnt 범위 오류');
    for (var t = 0; t < tmCnt; t++) {
      ensure(p + 1 < w.length, 'TM 키프레임 헤더 누락');
      var kfCnt = w[p + 1];
      ensure(kfCnt >= 0 && kfCnt <= 200, 'kfCnt 범위 오류');
      ensure(p + 2 + 2 * kfCnt <= w.length, 'TM 키프레임 데이터 범위 초과');
      p += 2 + 2 * kfCnt;
    }

    ensure(p < w.length, 'Section 2 txm 누락');
    var txm = w[p++];
    ensure(txm >= 0 && txm <= 10000, 'txm 범위 오류');
    ensure(p + txm <= w.length, 'txm 데이터 범위 초과');
    p += txm;

    ensure(p < w.length, 'Section 3 tg 누락');
    var tg = w[p++];
    ensure(tg >= 0 && tg <= 10000, 'tg 범위 오류');
    ensure(p + 2 * tg <= w.length, 'tg 데이터 범위 초과');
    p += 2 * tg;

    ensure(p < w.length, 'Section 4 jh 누락');
    var jh = w[p++];
    ensure(jh >= 0 && jh <= 10000, 'jh 범위 오류');
    ensure(p + 9 * jh <= w.length, 'jh 데이터 범위 초과');
    p += 9 * jh;

    ensure(p < w.length, 'Section 5 tgjl 누락');
    var tgjl = w[p++];
    ensure(tgjl >= 0 && tgjl <= 10000, 'tgjl 범위 오류');
    ensure(p + tgjl <= w.length, 'tgjl 데이터 범위 초과');
    p += tgjl;

    ensure(p < w.length, 'Section 6 jlwp 누락');
    var jlwp = w[p++];
    ensure(jlwp >= 0 && jlwp <= 20000, 'jlwp 범위 오류');
    ensure(p + 2 * jlwp <= w.length, 'jlwp 데이터 범위 초과');
    p += 2 * jlwp;

    var basicOffset = p;
    var prefixWords = w.slice(0, p);

    ensure(p + 10 <= w.length, 'Section 7 basicWords 10개 누락');
    var basicWords = w.slice(p, p + 10);
    p += 10;
    var basicData = {
      gold: basicWords[0],
      mjcz: basicWords[1],
      sp: basicWords[2],
      shichen: basicWords[3],
      day: basicWords[4],
      month: basicWords[5],
      year: basicWords[6],
      weather: basicWords[7],
      weatherCd: basicWords[8],
      staminaJl: basicWords[9]
    };

    var ptf = new Array(1001);
    for (var c1 = 0; c1 <= 1000; c1++) {
      ensure(p < w.length, 'Section 8 ptf count 누락 c=' + c1);
      var cnt1 = w[p++];
      ensure(cnt1 >= 0 && cnt1 <= 512, 'ptf count 범위 오류 c=' + c1);
      ensure(p + cnt1 <= w.length, 'ptf 데이터 범위 초과 c=' + c1);
      ptf[c1] = Array.from(w.subarray(p, p + cnt1));
      p += cnt1;
    }

    var sptf = new Array(1001);
    for (var c2 = 0; c2 <= 1000; c2++) {
      ensure(p < w.length, 'Section 9 sptf count 누락 c=' + c2);
      var cnt2 = w[p++];
      ensure(cnt2 >= 0 && cnt2 <= 512, 'sptf count 범위 오류 c=' + c2);
      ensure(p + cnt2 <= w.length, 'sptf 데이터 범위 초과 c=' + c2);
      sptf[c2] = Array.from(w.subarray(p, p + cnt2));
      p += cnt2;
    }

    var tailOffset = p;
    var tailWords = w.slice(p);
    var hasSaveIdentity = tailWords.length >= 68 &&
      tailWords[tailWords.length - 68] === 7395211 &&
      tailWords[tailWords.length - 1] === 7395211;
    var scanSrc = hasSaveIdentity ? tailWords.slice(0, tailWords.length - 68) : tailWords;
    var rconfigMeta = scanRConfigTail(scanSrc);
    var containers = parseTjmContainers(tailWords, ptf, sptf, hasSaveIdentity, rconfigMeta);

    return {
      wordCount: wordCount,
      miao: miao,
      saveWallTime: saveWallTime,
      saveCreateTime: saveCreateTime,
      reservedZero: reservedZero,
      tmCnt: tmCnt,
      txm: txm,
      tg: tg,
      jh: jh,
      tgjl: tgjl,
      jlwp: jlwp,
      prefixWords: Array.from(prefixWords),
      basicOffset: basicOffset,
      basicWords: Array.from(basicWords),
      basicData: basicData,
      ptf: ptf,
      sptf: sptf,
      tailOffset: tailOffset,
      tailWords: Array.from(tailWords),
      hasSaveIdentity: hasSaveIdentity,
      rconfigMeta: rconfigMeta,
      containers: containers
    };
  }

  function buildTjm(tjmState) {
    if (!tjmState) throw new Error('TJM 상태가 없습니다.');
    var prefix = Array.from(tjmState.prefixWords || []);
    var bd = tjmState.basicData || {};
    var basic = [
      bd.gold | 0,
      bd.mjcz | 0,
      bd.sp | 0,
      bd.shichen | 0,
      bd.day | 0,
      bd.month | 0,
      bd.year | 0,
      bd.weather | 0,
      bd.weatherCd | 0,
      bd.staminaJl | 0
    ];
    var ptf = tjmState.ptf || [];
    var sptf = tjmState.sptf || [];
    var tail = Array.from(tjmState.tailWords || []);
    var all = [];
    var i, c, arr;

    for (i = 0; i < prefix.length; i++) all.push(prefix[i] | 0);
    for (i = 0; i < 10; i++) all.push(basic[i] | 0);
    for (c = 0; c <= 1000; c++) {
      arr = ptf[c] || [];
      all.push(arr.length | 0);
      for (i = 0; i < arr.length; i++) all.push(arr[i] | 0);
    }
    for (c = 0; c <= 1000; c++) {
      arr = sptf[c] || [];
      all.push(arr.length | 0);
      for (i = 0; i < arr.length; i++) all.push(arr[i] | 0);
    }
    for (i = 0; i < tail.length; i++) all.push(tail[i] | 0);

    var N = all.length;
    var out = new Uint8Array(20 + N * 4);
    var dv = new DataView(out.buffer);
    dv.setInt32(0, N, true);
    dv.setInt32(4, tjmState.miao | 0, true);
    dv.setInt32(8, tjmState.saveWallTime | 0, true);
    dv.setInt32(12, tjmState.saveCreateTime | 0, true);
    dv.setInt32(16, tjmState.reservedZero | 0, true);
    for (i = 0; i < N; i++) dv.setInt32(20 + i * 4, all[i] | 0, true);
    return out;
  }

  function findEntryIndex(entries, nameLower) {
    for (var i = 0; i < entries.length; i++) {
      if (String(entries[i].name || '').toLowerCase() === nameLower) return i;
    }
    return -1;
  }

  function decodeSav(savBytes) {
    var entries = parseZip(savBytes);
    var rEntryIndex = findEntryIndex(entries, 'r.grp');
    var tjmEntryIndex = findEntryIndex(entries, 'tjm');
    if (rEntryIndex < 0) throw new Error('SAV 아카이브에서 r.grp 항목을 찾을 수 없습니다.');
    if (tjmEntryIndex < 0) throw new Error('SAV 아카이브에서 tjm 항목을 찾을 수 없습니다.');

    return Promise.all([
      entryUncompressed(entries[rEntryIndex]),
      entryUncompressed(entries[tjmEntryIndex])
    ]).then(function (arrs) {
      var rGrpBytes = arrs[0];
      var tjmBytes = arrs[1];
      if (rGrpBytes.length !== LAYOUT.R_GRP_SIZE) {
        throw new Error('r.grp 압축 해제 크기 오류: ' + rGrpBytes.length + ' != ' + LAYOUT.R_GRP_SIZE);
      }
      var tjm = parseTjm(tjmBytes);
      return {
        entries: entries,
        rEntryIndex: rEntryIndex,
        tjmEntryIndex: tjmEntryIndex,
        rGrpBytes: rGrpBytes,
        tjmBytes: tjmBytes,
        tjm: tjm
      };
    });
  }

  function decodeSavSync(savBytes) {
    var entries = parseZip(savBytes);
    var rEntryIndex = findEntryIndex(entries, 'r.grp');
    var tjmEntryIndex = findEntryIndex(entries, 'tjm');
    if (rEntryIndex < 0) throw new Error('SAV 아카이브에서 r.grp 항목을 찾을 수 없습니다.');
    if (tjmEntryIndex < 0) throw new Error('SAV 아카이브에서 tjm 항목을 찾을 수 없습니다.');
    var rGrpBytes = entryUncompressedSync(entries[rEntryIndex]);
    var tjmBytes = entryUncompressedSync(entries[tjmEntryIndex]);
    if (rGrpBytes.length !== LAYOUT.R_GRP_SIZE) {
      throw new Error('r.grp 압축 해제 크기 오류: ' + rGrpBytes.length + ' != ' + LAYOUT.R_GRP_SIZE);
    }
    var tjm = parseTjm(tjmBytes);
    return {
      entries: entries,
      rEntryIndex: rEntryIndex,
      tjmEntryIndex: tjmEntryIndex,
      rGrpBytes: rGrpBytes,
      tjmBytes: tjmBytes,
      tjm: tjm
    };
  }

  function encodeSav(savState, options) {
    options = options || {};
    if (!savState || !savState.entries) throw new Error('SAV 상태 entries가 없습니다.');
    var entries = savState.entries;
    var rEntryIndex = savState.rEntryIndex;
    var tjmEntryIndex = savState.tjmEntryIndex;
    if (rEntryIndex == null) rEntryIndex = findEntryIndex(entries, 'r.grp');
    if (tjmEntryIndex == null) tjmEntryIndex = findEntryIndex(entries, 'tjm');
    if (rEntryIndex < 0) throw new Error('SAV 아카이브에서 r.grp 항목을 찾을 수 없습니다.');
    if (tjmEntryIndex < 0) throw new Error('SAV 아카이브에서 tjm 항목을 찾을 수 없습니다.');
    if (!savState.tjm) throw new Error('TJM 상태가 없습니다.');
    if (!savState.rGrpBytes && options.rGrpBytes == null) throw new Error('rGrpBytes가 없습니다.');

    var newTjmBytes = buildTjm(savState.tjm);
    var rBytes = toU8(options.rGrpBytes != null ? options.rGrpBytes : savState.rGrpBytes);
    if (rBytes.length !== LAYOUT.R_GRP_SIZE) {
      throw new Error('r.grp 크기 오류: ' + rBytes.length + ' != ' + LAYOUT.R_GRP_SIZE);
    }

    return Promise.all([
      recompressEntry(entries[rEntryIndex], rBytes),
      recompressEntry(entries[tjmEntryIndex], newTjmBytes)
    ]).then(function () {
      return buildZip(entries);
    });
  }

  function encodeSavSync(savState, options) {
    options = options || {};
    if (!savState || !savState.entries) throw new Error('SAV 상태 entries가 없습니다.');
    var entries = savState.entries;
    var rEntryIndex = savState.rEntryIndex;
    var tjmEntryIndex = savState.tjmEntryIndex;
    if (rEntryIndex == null) rEntryIndex = findEntryIndex(entries, 'r.grp');
    if (tjmEntryIndex == null) tjmEntryIndex = findEntryIndex(entries, 'tjm');
    if (rEntryIndex < 0) throw new Error('SAV 아카이브에서 r.grp 항목을 찾을 수 없습니다.');
    if (tjmEntryIndex < 0) throw new Error('SAV 아카이브에서 tjm 항목을 찾을 수 없습니다.');
    if (!savState.tjm) throw new Error('TJM 상태가 없습니다.');
    if (!savState.rGrpBytes && options.rGrpBytes == null) throw new Error('rGrpBytes가 없습니다.');

    var newTjmBytes = buildTjm(savState.tjm);
    var rBytes = toU8(options.rGrpBytes != null ? options.rGrpBytes : savState.rGrpBytes);
    if (rBytes.length !== LAYOUT.R_GRP_SIZE) {
      throw new Error('r.grp 크기 오류: ' + rBytes.length + ' != ' + LAYOUT.R_GRP_SIZE);
    }

    recompressEntrySync(entries[rEntryIndex], rBytes);
    recompressEntrySync(entries[tjmEntryIndex], newTjmBytes);
    return buildZip(entries);
  }

  function recompressEntry(entry, uncompBytes) {
    var data = toU8(uncompBytes);
    if (entry.method === 0) {
      entry.dirty = true;
      entry.method = 0;
      entry.crc32 = crc32(data);
      entry.rawCompBytes = data.slice();
      entry.compSize = entry.rawCompBytes.length;
      entry.uncompSize = data.length;
      entry.uncompBytes = data;
      entry.flags = (entry.flags || 0) & ~0x0008;
      return Promise.resolve();
    }
    return deflateRaw(data).then(function (compressed) {
      entry.dirty = true;
      entry.method = 8;
      entry.crc32 = crc32(data);
      entry.rawCompBytes = compressed;
      entry.compSize = compressed.length;
      entry.uncompSize = data.length;
      entry.uncompBytes = data;
      entry.flags = (entry.flags || 0) & ~0x0008;
    });
  }

  function recompressEntrySync(entry, uncompBytes) {
    var data = toU8(uncompBytes);
    if (entry.method === 0) {
      entry.dirty = true;
      entry.method = 0;
      entry.crc32 = crc32(data);
      entry.rawCompBytes = data.slice();
      entry.compSize = entry.rawCompBytes.length;
      entry.uncompSize = data.length;
      entry.uncompBytes = data;
      entry.flags = (entry.flags || 0) & ~0x0008;
      return;
    }
    var compressed = deflateRawSync(data);
    entry.dirty = true;
    entry.method = 8;
    entry.crc32 = crc32(data);
    entry.rawCompBytes = compressed;
    entry.compSize = compressed.length;
    entry.uncompSize = data.length;
    entry.uncompBytes = data;
    entry.flags = (entry.flags || 0) & ~0x0008;
  }

  return {
    LAYOUT: LAYOUT,
    crc32: crc32,
    parseZip: parseZip,
    buildZip: buildZip,
    inflateRaw: inflateRaw,
    deflateRaw: deflateRaw,
    inflateRawSync: inflateRawSync,
    deflateRawSync: deflateRawSync,
    decodeBig5: decodeBig5,
    encodeBig5Fixed: encodeBig5Fixed,
    personOffset: personOffset,
    readInt16: readInt16,
    writeInt16: writeInt16,
    readUint16: readUint16,
    writeUint16: writeUint16,
    readInt32: readInt32,
    writeInt32: writeInt32,
    readBig5Field: readBig5Field,
    writeBig5Field: writeBig5Field,
    scanRConfigTail: scanRConfigTail,
    parseTjmContainers: parseTjmContainers,
    parseTjm: parseTjm,
    buildTjm: buildTjm,
    decodeSav: decodeSav,
    encodeSav: encodeSav,
    decodeSavSync: decodeSavSync,
    encodeSavSync: encodeSavSync
  };
});