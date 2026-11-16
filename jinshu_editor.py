#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""jinshu_editor.py -- 금서군협전 (金书群侠传 1.07 V2.5 FIX 234 + Korean patch) save editor.

Pure Python 3 standard library only. No network access, no external packages.

Provides:
  * Byte-exact PKZIP raw entry codec (untouched entries are re-emitted verbatim).
  * r.grp fixed-width segment codec (Base / Person / Thing / Scene / Wugong / Shop / Teji).
  * tjm int32 word-stream codec with verbatim prefix/tail preservation.
  * Big5 (cp950 / big5hkscs) fixed-width string fields.
  * Domain validation, 6 presets, atomic backup + SHA-256 verified writes.
  * CLI: inspect / validate / presets / edit / serve.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import copy
import datetime as _dt
import hashlib
import json
import math
import os
import re
import struct
import sys
import tempfile
import uuid
import zlib
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

SCRIPT_DIR = Path(__file__).resolve().parent

# ----------------------------------------------------------------------------
# Constants: archive layout
# ----------------------------------------------------------------------------
ZIP_LOCAL_SIG = 0x04034B50
ZIP_CENTRAL_SIG = 0x02014B50
ZIP_EOCD_SIG = 0x06054B50

R_GRP_NAME = "r.grp"
TJM_NAME = "tjm"
DEFLATE_ENTRIES = {R_GRP_NAME, TJM_NAME}

R_GRP_SIZE = 1211424

SEGMENTS: Tuple[Tuple[str, int, int, int], ...] = (
    ("Base", 0, 4102, 1),
    ("Person", 4102, 1278, 758),
    ("Thing", 972826, 206, 661),
    ("Scene", 1108992, 54, 169),
    ("Wugong", 1118118, 190, 471),
    ("Shop", 1207608, 36, 5),
    ("Teji", 1207788, 36, 101),
)

BASE_OFFSETS: Dict[str, int] = {
    "difficulty": 24, "standard": 26, "changxiang": 28, "special": 30,
    "solo": 32, "playthrough": 34, "bookCount": 36, "kungfuCount": 38,
    "spFragment": 40, "gameMode": 42, "tianguan": 44, "opening": 46,
    "storyFlag": 48, "partyStart": 72, "inventoryStart": 102,
}
PARTY_SLOTS = 15
INVENTORY_SLOTS = 1000
MAX_ACTIVE_INVENTORY = 900

PERSON_OFFSETS: Dict[str, int] = {
    "id": 0, "portrait": 2, "constitution": 4,
    "gender": 28, "level": 30, "exp": 32, "hp": 34, "maxHp": 36,
    "injury": 38, "poison": 40, "tili": 42, "itemPracticePts": 44,
    "weapon": 46, "armor": 48, "neiliType": 80, "mp": 82, "maxMp": 84,
    "attack": 86, "qinggong": 88, "defense": 90, "medical": 92,
    "usePoison": 94, "detox": 96, "antiPoison": 98, "fist": 100,
    "finger": 102, "sword": 104, "blade": 106, "specialWeapon": 108,
    "hiddenWeapon": 110, "wuxueKnowledge": 112, "morality": 114,
    "poisonAttack": 116, "zuoyouHubo": 118, "fame": 120, "aptitude": 122,
    "practiceItem": 124, "practicePts": 126,
    "kungfuIdStart": 128, "kungfuLevelStart": 158,
    "tianfuPts": 208, "wuxuePts": 210, "shizhan": 216, "hitRate": 220,
    "mainNeigongSlot": 222, "mainQinggongSlot": 224, "affection": 244,
    "dodge": 246, "zhenqi": 256, "parry": 258, "mount": 262,
    "sectContrib": 268, "sect": 270, "xinmo": 272,
    "fistGrowth": 274, "fingerGrowth": 276, "swordGrowth": 278,
    "bladeGrowth": 280, "specialGrowth": 282, "hiddenGrowth": 284,
    "sectRank": 308, "tianfuCap": 310, "subNeigongSlot": 312,
    "wuxueCap": 314, "baseHp": 508, "baseMp": 510,
    "mijiStart": 874, "meridianShunStart": 894, "meridianNiStart": 922,
    "acupointStart": 950,
}
PERSON_STRING_FIELDS: Dict[str, Tuple[int, int]] = {"name": (8, 10), "nick": (18, 10)}
PERSON_U16_FIELDS = frozenset({"exp", "itemPracticePts"})
KUNGFU_SLOTS = 15
MIJI_SLOTS = 10
MERIDIAN_SLOTS = 14
ACUPOINT_SLOTS = 164

STAT_RANGES: Dict[str, Tuple[int, int]] = {
    "portrait": (0, 32767), "constitution": (0, 100), "gender": (0, 2),
    "level": (0, 120), "hp": (0, 32767), "maxHp": (0, 32767),
    "injury": (0, 100), "poison": (0, 100), "tili": (0, 100),
    "neiliType": (0, 3), "mp": (0, 32767), "maxMp": (0, 32767),
    "attack": (0, 30000), "qinggong": (0, 30000), "defense": (0, 30000),
    "medical": (0, 30000), "usePoison": (0, 30000), "detox": (0, 30000),
    "antiPoison": (0, 30000), "fist": (0, 30000), "finger": (0, 30000),
    "sword": (0, 30000), "blade": (0, 30000), "specialWeapon": (0, 30000),
    "hiddenWeapon": (0, 30000), "wuxueKnowledge": (0, 30000),
    "morality": (0, 100), "poisonAttack": (0, 30000), "zuoyouHubo": (0, 1),
    "fame": (0, 30000), "aptitude": (0, 100), "practicePts": (0, 30000),
    "tianfuPts": (0, 32767), "wuxuePts": (0, 30000), "shizhan": (0, 500),
    "hitRate": (0, 30000), "mainNeigongSlot": (0, 999),
    "mainQinggongSlot": (0, 999), "affection": (0, 32767),
    "dodge": (0, 32767), "zhenqi": (0, 32767), "parry": (0, 30000),
    "sectContrib": (0, 30000), "sect": (0, 31), "xinmo": (0, 100),
    "fistGrowth": (0, 30000),
    "fingerGrowth": (0, 30000),
    "swordGrowth": (0, 30000), "bladeGrowth": (0, 30000),
    "specialGrowth": (0, 30000), "hiddenGrowth": (0, 30000),
    "sectRank": (0, 20), "tianfuCap": (0, 30000), "subNeigongSlot": (0, 999),
    "wuxueCap": (0, 30000), "baseHp": (0, 32767), "baseMp": (0, 32767),
    "exp": (0, 65535), "itemPracticePts": (0, 65535),
    "weapon": (-1, 65535), "armor": (-1, 65535), "mount": (-1, 65535),
    "practiceItem": (-1, 65535),
}

SAVE_IDENTITY = 7395211
GOLD_ITEM_ID = 174
MJ_CZ_ITEM_ID = 550
NPC_PROFILE_MAGIC = 1313887047
RECORD_FIELDS_COUNT = 61
SKILL_SLOTS_TJM = 15

TJM_BASIC_KEYS = ("gold", "mjcz", "sp", "shichen", "day", "month", "year",
                  "weather", "weatherCd", "staminaJl")


# ----------------------------------------------------------------------------
# Big5 fixed-width string codec
# ----------------------------------------------------------------------------
def _decode_bytes(raw: bytes) -> str:
    for enc in ("cp950", "big5hkscs"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin1")


def _encode_char(ch: str) -> Optional[bytes]:
    for enc in ("cp950", "big5hkscs"):
        try:
            return ch.encode(enc)
        except UnicodeEncodeError:
            continue
    return None


def read_big5_field(buf: bytearray, off: int, length: int) -> str:
    """Read a NUL-terminated Big5 fixed-width field."""
    raw = bytes(buf[off:off + length])
    nul = raw.find(b"\x00")
    if nul >= 0:
        raw = raw[:nul]
    return _decode_bytes(raw).rstrip(" ")


def write_big5_field(buf: bytearray, off: int, length: int, text: str) -> bool:
    """Encode text into a fixed-width Big5 field. Returns True when bytes changed."""
    text = (text or "").rstrip(" ")
    if read_big5_field(buf, off, length) == text:
        return False
    out = bytearray()
    for ch in text:
        enc = _encode_char(ch)
        if enc is None:
            raise ValueError(f"Big5로 인코딩할 수 없는 문자: {ch!r}")
        if len(out) + len(enc) > length:
            raise ValueError(f"Big5 필드 길이({length}) 초과")
        out += enc
    field = bytes(out) + b"\x00" * (length - len(out))
    buf[off:off + length] = field
    return True


# ----------------------------------------------------------------------------
# PKZIP raw entry codec
# ----------------------------------------------------------------------------
class ZipEntry:
    __slots__ = ("name", "raw_name", "version_made", "version_needed", "flags",
                 "method", "dos_time", "dos_date", "crc32", "comp_size",
                 "uncomp_size", "internal_attr", "external_attr", "local_extra",
                 "central_extra", "comment", "raw_comp_bytes", "dirty")

    def __init__(self) -> None:
        self.name = ""
        self.raw_name = b""
        self.version_made = 20
        self.version_needed = 20
        self.flags = 0
        self.method = 0
        self.dos_time = 0
        self.dos_date = 0
        self.crc32 = 0
        self.comp_size = 0
        self.uncomp_size = 0
        self.internal_attr = 0
        self.external_attr = 0
        self.local_extra = b""
        self.central_extra = b""
        self.comment = b""
        self.raw_comp_bytes = b""
        self.dirty = False

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<ZipEntry {self.name!r} method={self.method} size={self.uncomp_size}>"


def parse_zip_entries(sav_bytes: bytes) -> List[ZipEntry]:
    data = bytes(sav_bytes)
    eocd = data.rfind(b"PK\x05\x06", max(0, len(data) - 65557))
    if eocd < 0:
        raise ValueError("EOCD(0x06054b50)를 찾을 수 없습니다: 잘못된 .sav 파일")
    (_sig, _d1, _d2, _n_disk, _n_total, cd_size, cd_off,
     _clen) = struct.unpack_from("<IHHHHIIH", data, eocd)
    if cd_off + cd_size > len(data):
        raise ValueError("중앙 디렉터리 범위를 벗어났습니다")
    entries: List[ZipEntry] = []
    p = cd_off
    while p + 46 <= cd_off + cd_size and struct.unpack_from("<I", data, p)[0] == ZIP_CENTRAL_SIG:
        (version_made, version_needed, flags, method, dos_time, dos_date,
         crc, comp_size, uncomp_size, name_len, extra_len, comment_len,
         _disk, internal_attr, external_attr,
         local_off) = struct.unpack_from("<HHHHHHIIIHHHHHII", data, p + 4)
        raw_name = data[p + 46:p + 46 + name_len]
        central_extra = data[p + 46 + name_len:p + 46 + name_len + extra_len]
        comment = data[p + 46 + name_len + extra_len:
                       p + 46 + name_len + extra_len + comment_len]
        p += 46 + name_len + extra_len + comment_len
        if struct.unpack_from("<I", data, local_off)[0] != ZIP_LOCAL_SIG:
            raise ValueError("로컬 파일 헤더 서명이 올바르지 않습니다")
        (l_version_needed, l_flags, l_method, l_time, l_date, l_crc, l_comp,
         l_uncomp, l_name_len, l_extra_len) = struct.unpack_from(
            "<HHHHHIIIHH", data, local_off + 4)
        local_extra = data[local_off + 30 + l_name_len:
                           local_off + 30 + l_name_len + l_extra_len]
        body_start = local_off + 30 + l_name_len + l_extra_len
        use_comp = l_comp if (not (l_flags & 0x0008) and l_comp) else comp_size
        raw_comp = data[body_start:body_start + use_comp]
        if len(raw_comp) != use_comp:
            raise ValueError(f"압축 데이터가 잘렸습니다: {raw_name!r}")
        e = ZipEntry()
        e.raw_name = raw_name
        try:
            e.name = raw_name.decode("utf-8")
        except UnicodeDecodeError:
            e.name = raw_name.decode("latin1")
        e.version_made = version_made
        e.version_needed = version_needed if version_needed else l_version_needed
        e.flags = flags
        e.method = method if method else l_method
        e.dos_time = dos_time or l_time
        e.dos_date = dos_date or l_date
        e.crc32 = crc or l_crc
        e.comp_size = use_comp
        e.uncomp_size = uncomp_size or l_uncomp
        e.internal_attr = internal_attr
        e.external_attr = external_attr
        e.local_extra = bytes(local_extra)
        e.central_extra = bytes(central_extra)
        e.comment = bytes(comment)
        e.raw_comp_bytes = bytes(raw_comp)
        e.dirty = False
        entries.append(e)
    return entries


def build_zip_entries(entries: Sequence[ZipEntry]) -> bytes:
    out = bytearray()
    central: List[Tuple[ZipEntry, int]] = []
    for e in entries:
        local_off = len(out)
        name = e.raw_name
        out += struct.pack("<IHHHHHIIIHH", ZIP_LOCAL_SIG, e.version_needed,
                           e.flags, e.method, e.dos_time, e.dos_date, e.crc32,
                           len(e.raw_comp_bytes), e.uncomp_size, len(name),
                           len(e.local_extra))
        out += name + e.local_extra + e.raw_comp_bytes
        central.append((e, local_off))
    cd_start = len(out)
    for e, local_off in central:
        out += struct.pack("<IHHHHHHIIIHHHHHII", ZIP_CENTRAL_SIG, e.version_made,
                           e.version_needed, e.flags, e.method, e.dos_time,
                           e.dos_date, e.crc32, len(e.raw_comp_bytes),
                           e.uncomp_size, len(e.raw_name), len(e.central_extra),
                           len(e.comment), 0, e.internal_attr, e.external_attr,
                           local_off)
        out += e.raw_name + e.central_extra + e.comment
    cd_size = len(out) - cd_start
    out += struct.pack("<IHHHHIIH", ZIP_EOCD_SIG, 0, 0, len(entries),
                       len(entries), cd_size, cd_start, 0)
    return bytes(out)


def _decompress_entry(entry: ZipEntry) -> bytes:
    if entry.method == 8:
        return zlib.decompress(entry.raw_comp_bytes, -15)
    if entry.method == 0:
        return bytes(entry.raw_comp_bytes)
    raise ValueError(f"지원하지 않는 압축 방식입니다: {entry.method} ({entry.name})")


def _recompress_entry(entry: ZipEntry, data: bytes) -> None:
    comp = zlib.compressobj(6, zlib.DEFLATED, -15)
    raw = comp.compress(data) + comp.flush()
    entry.method = 8
    entry.flags &= ~0x0008
    entry.crc32 = zlib.crc32(data) & 0xFFFFFFFF
    entry.uncomp_size = len(data)
    entry.comp_size = len(raw)
    entry.raw_comp_bytes = raw
    entry.dirty = True


# ----------------------------------------------------------------------------
# Catalog
# ----------------------------------------------------------------------------
_CATALOG_CACHE: Optional[Dict[str, Any]] = None


def load_catalog() -> Dict[str, Any]:
    global _CATALOG_CACHE
    if _CATALOG_CACHE is not None:
        return _CATALOG_CACHE
    path = SCRIPT_DIR / "src" / "catalog-data.js"
    catalog: Dict[str, Any] = {}
    if path.is_file():
        text = path.read_text(encoding="utf-8")
        start = text.find("/*JINSHU_CATALOG_JSON_START*/")
        end = text.find("/*JINSHU_CATALOG_JSON_END*/")
        if start >= 0 and end > start:
            payload = text[start + len("/*JINSHU_CATALOG_JSON_START*/"):end]
            catalog = json.loads(payload)
    _CATALOG_CACHE = catalog
    return catalog


def _catalog_ids(catalog: Dict[str, Any], key: str) -> set:
    out = set()
    for item in catalog.get(key, []) or []:
        if isinstance(item, dict):
            val = item.get("id")
            if isinstance(val, int):
                out.add(val)
        elif isinstance(item, int):
            out.add(item)
    return out


# ----------------------------------------------------------------------------
# r.grp codec
# ----------------------------------------------------------------------------
class RGrp:
    """Mutable view over the r.grp segment layout."""

    def __init__(self, data: bytes) -> None:
        if len(data) != R_GRP_SIZE:
            raise ValueError(f"r.grp 크기가 잘못되었습니다: {len(data)} != {R_GRP_SIZE}")
        self.buf = bytearray(data)

    # -- raw accessors -------------------------------------------------------
    def get_i16(self, off: int) -> int:
        return struct.unpack_from("<h", self.buf, off)[0]

    def set_i16(self, off: int, val: int) -> None:
        struct.pack_into("<h", self.buf, off, int(val))

    def get_u16(self, off: int) -> int:
        return struct.unpack_from("<H", self.buf, off)[0]

    def set_u16(self, off: int, val: int) -> None:
        struct.pack_into("<H", self.buf, off, int(val))

    def get_base(self, key: str) -> int:
        return self.get_i16(BASE_OFFSETS[key])

    def set_base(self, key: str, val: int) -> None:
        self.set_i16(BASE_OFFSETS[key], val)

    # -- person --------------------------------------------------------------
    @staticmethod
    def person_offset(pid: int) -> int:
        return 4102 + 1278 * pid

    def get_person(self, pid: int, key: str) -> Any:
        if key in PERSON_STRING_FIELDS:
            rel_off, max_len = PERSON_STRING_FIELDS[key]
            off = self.person_offset(pid) + rel_off
            return read_big5_field(self.buf, off, max_len)
        off = self.person_offset(pid) + PERSON_OFFSETS[key]
        if key in PERSON_U16_FIELDS:
            return self.get_u16(off)
        return self.get_i16(off)

    def set_person(self, pid: int, key: str, val: Any) -> bool:
        if key in PERSON_STRING_FIELDS:
            rel_off, max_len = PERSON_STRING_FIELDS[key]
            off = self.person_offset(pid) + rel_off
            return write_big5_field(self.buf, off, max_len, str(val))
        off = self.person_offset(pid) + PERSON_OFFSETS[key]
        if key in PERSON_U16_FIELDS:
            self.set_u16(off, int(val))
        else:
            self.set_i16(off, int(val))
        return True

    # -- arrays --------------------------------------------------------------
    def get_person_array(self, pid: int, key: str, index: int) -> int:
        return self.get_i16(self.person_offset(pid) + PERSON_OFFSETS[key] + 2 * index)

    def set_person_array(self, pid: int, key: str, index: int, val: int) -> None:
        self.set_i16(self.person_offset(pid) + PERSON_OFFSETS[key] + 2 * index, val)

    @staticmethod
    def _arr_key(kind: str) -> str:
        return {"kungfu_id": "kungfuIdStart", "kungfu_level": "kungfuLevelStart",
                "miji": "mijiStart", "shun": "meridianShunStart",
                "ni": "meridianNiStart", "acupoint": "acupointStart"}[kind]

    @staticmethod
    def _arr_len(kind: str) -> int:
        return {"kungfu_id": KUNGFU_SLOTS, "kungfu_level": KUNGFU_SLOTS,
                "miji": MIJI_SLOTS, "shun": MERIDIAN_SLOTS,
                "ni": MERIDIAN_SLOTS, "acupoint": ACUPOINT_SLOTS}[kind]

    def get_person_list(self, pid: int, kind: str) -> List[int]:
        key, n = self._arr_key(kind), self._arr_len(kind)
        return [self.get_person_array(pid, key, i) for i in range(n)]

    def set_person_list(self, pid: int, kind: str, values: Sequence[int]) -> None:
        key, n = self._arr_key(kind), self._arr_len(kind)
        for i in range(n):
            self.set_person_array(pid, key, i, int(values[i]) if i < len(values) else 0)

    # -- party ---------------------------------------------------------------
    def get_party(self) -> List[int]:
        start = BASE_OFFSETS["partyStart"]
        return [self.get_i16(start + 2 * i) for i in range(PARTY_SLOTS)]

    def set_party_slot(self, slot: int, pid: int) -> None:
        self.set_i16(BASE_OFFSETS["partyStart"] + 2 * slot, pid)

    # -- inventory -----------------------------------------------------------
    def _inv_off(self, slot: int) -> int:
        return BASE_OFFSETS["inventoryStart"] + 4 * slot

    def get_inventory(self, limit: int = INVENTORY_SLOTS) -> List[Dict[str, int]]:
        out = []
        for i in range(min(limit, INVENTORY_SLOTS)):
            off = self._inv_off(i)
            out.append({"slot": i, "itemId": self.get_i16(off),
                        "count": self.get_i16(off + 2)})
        return out

    def _find_item(self, item_id: int) -> int:
        for i in range(INVENTORY_SLOTS):
            if self.get_i16(self._inv_off(i)) == item_id:
                return i
        return -1

    def _active_items(self) -> List[Tuple[int, int]]:
        active: List[Tuple[int, int]] = []
        for i in range(INVENTORY_SLOTS):
            off = self._inv_off(i)
            iid = self.get_i16(off)
            cnt = self.get_i16(off + 2)
            if iid < 0:
                continue
            if iid == 174:
                if cnt >= 0:
                    active.append((iid, cnt))
            elif cnt > 0:
                active.append((iid, cnt))
        return active

    def _write_inventory(self, active: List[Tuple[int, int]]) -> None:
        if len(active) > MAX_ACTIVE_INVENTORY:
            raise ValueError("인벤토리 활성 슬롯 수가 너무 많습니다")
        for i in range(INVENTORY_SLOTS):
            off = self._inv_off(i)
            if i < len(active):
                iid, cnt = active[i]
                self.set_i16(off, iid)
                self.set_i16(off + 2, cnt)
            else:
                self.set_i16(off, -1)
                self.set_i16(off + 2, 0)

    def set_item_count(self, item_id: int, count: int) -> None:
        count = max(0, min(30000, int(count)))
        active = self._active_items()
        if item_id == 174:
            if count >= 0:
                found = False
                for i, (iid, cnt) in enumerate(active):
                    if iid == item_id:
                        active[i] = (item_id, count)
                        found = True
                        break
                if not found:
                    active.append((item_id, count))
        else:
            if count <= 0:
                active = [(iid, cnt) for iid, cnt in active if iid != item_id]
            else:
                found = False
                for i, (iid, cnt) in enumerate(active):
                    if iid == item_id:
                        active[i] = (item_id, count)
                        found = True
                        break
                if not found:
                    active.append((item_id, count))
        self._write_inventory(active)

    def remove_item_slot(self, item_id: int) -> None:
        active = [(iid, cnt) for iid, cnt in self._active_items() if iid != item_id]
        self._write_inventory(active)


# ----------------------------------------------------------------------------
# tjm codec
# ----------------------------------------------------------------------------
def _extract_rconfig_id_lists(obj: Any) -> Dict[str, List[int]]:
    result: Dict[str, List[int]] = {"itemIds": [], "kungfuIds": [], "mijiIds": [], "personIds": []}
    if not isinstance(obj, dict):
        return result
    sources = (
        (obj.get("extras") or {}, "itemIds"),
        ((obj.get("appended") or {}).get("Wugong") or {}, "kungfuIds"),
        ((obj.get("appended") or {}).get("Teji") or {}, "mijiIds"),
        ((obj.get("appended") or {}).get("Person") or {}, "personIds"),
    )
    for node, target in sources:
        if not isinstance(node, dict):
            continue
        ids = []
        for k in node.keys():
            try:
                kid = int(k)
            except (TypeError, ValueError):
                continue
            if kid not in ids:
                ids.append(kid)
        ids.sort()
        result[target] = ids
    return result


def _json_object_is_rconfig(obj: Any) -> bool:
    return isinstance(obj, dict) and (
        obj.get("format") == 1 or "extras" in obj or "appended" in obj
    )


def scan_rconfig_tail_detail(words: Sequence[int]) -> Dict[str, Any]:
    empty: Dict[str, Any] = {
        "found": False,
        "format": 0,
        "startOffset": -1,
        "endOffset": -1,
        "lengthPrefixed": False,
        "byteSize": 0,
        "streamByteSize": 0,
        "baseline": "",
        "valuesCount": 0,
        "object": None,
        "itemIds": [],
        "kungfuIds": [],
        "mijiIds": [],
        "personIds": [],
    }
    n = len(words)

    def _build_res(obj: Dict[str, Any], start: int, end: int, prefixed: bool, blen: int) -> Dict[str, Any]:
        ids = _extract_rconfig_id_lists(obj)
        vals = obj.get("values")
        return {
            "found": True,
            "format": int(obj.get("format") or 1),
            "startOffset": start,
            "endOffset": end,
            "lengthPrefixed": prefixed,
            "byteSize": blen,
            "streamByteSize": 4 * (1 + blen) if prefixed else 4 * blen,
            "baseline": obj.get("baseline") if isinstance(obj.get("baseline"), str) else "",
            "valuesCount": len(vals) if isinstance(vals, dict) else 0,
            "object": obj,
            "itemIds": ids["itemIds"],
            "kungfuIds": ids["kungfuIds"],
            "mijiIds": ids["mijiIds"],
            "personIds": ids["personIds"],
        }

    # 1. 길이 프리픽스 [len, ...utf8_bytes] 탐색 (sav-codec.js와 동일 규칙)
    for i in range(n):
        length = int(words[i])
        if not (20 <= length <= 500000 and i + 1 + length <= n):
            continue
        if int(words[i + 1]) != 0x7B or int(words[i + 2]) != 0x22:
            continue
        if int(words[i + length]) != 0x7D:
            continue
        chunk = words[i + 1:i + 1 + length]
        if any(not (0 <= int(b) <= 255) for b in chunk):
            continue
        try:
            obj = json.loads(bytes(int(b) for b in chunk).decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            continue
        if _json_object_is_rconfig(obj):
            return _build_res(obj, i, i + 1 + length, True, length)

    # 2. 레거시 비프리픽스 fallback 탐색
    i = 0
    while i < n:
        if int(words[i]) != 0x7B:
            i += 1
            continue
        depth = 0
        in_string = False
        escape = False
        j = i
        while j < n and 0 <= int(words[j]) <= 255:
            ch = int(words[j])
            if in_string:
                if escape:
                    escape = False
                elif ch == 0x5C:
                    escape = True
                elif ch == 0x22:
                    in_string = False
            else:
                if ch == 0x22:
                    in_string = True
                elif ch == 0x7B:
                    depth += 1
                elif ch == 0x7D:
                    depth -= 1
                    if depth == 0:
                        break
            j += 1
        if j < n and int(words[j]) == 0x7D and depth == 0:
            raw = bytes(int(b) for b in words[i:j + 1])
            try:
                obj = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, ValueError):
                i = j + 1
                continue
            if _json_object_is_rconfig(obj):
                return _build_res(obj, i, j + 1, False, len(raw))
            i = j + 1
        else:
            i += 1

    return empty


def scan_rconfig_tail(words: Sequence[int]) -> Dict[str, List[int]]:
    detail = scan_rconfig_tail_detail(words)
    return {
        "itemIds": list(detail["itemIds"]),
        "kungfuIds": list(detail["kungfuIds"]),
        "mijiIds": list(detail["mijiIds"]),
        "personIds": list(detail["personIds"]),
    }


def _empty_container() -> Dict[str, Any]:
    return {"present": False, "byteSize": 0, "wordCount": 0, "summary": None}


def _try_parse_full_tail_prefix(body: Sequence[int], rc_start: int, has_rconfig: bool) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "WuPinXiuLianHigh": _empty_container(),
        "CJApplied": _empty_container(),
        "傀儡": _empty_container(),
    }
    limit = rc_start if has_rconfig else len(body)
    if limit <= 0 or limit > len(body):
        return out

    p = 0

    def need(k: int) -> bool:
        return p + k <= limit

    # 1. saveEventData -> 끝부분 WuPinXiuLianHigh
    if not need(5):
        return out
    p += 4
    lm_cnt = int(body[p])
    p += 1
    if lm_cnt < 0 or not need(5 * lm_cnt):
        return out
    p += 5 * lm_cnt

    if not need(1):
        return out
    ne_cnt = int(body[p])
    p += 1
    if ne_cnt < 0:
        return out
    for _ in range(ne_cnt):
        if not need(11):
            return out
        p += 10
        talk_cnt = int(body[p])
        p += 1
        if talk_cnt < 0 or not need(talk_cnt):
            return out
        p += talk_cnt

    if not need(1):
        return out
    gn_cnt = int(body[p])
    p += 1
    if gn_cnt < 0 or not need(3 * gn_cnt):
        return out
    p += 3 * gn_cnt

    if not need(1):
        return out
    nt_cnt = int(body[p])
    p += 1
    if nt_cnt < 0 or not need(2 * nt_cnt):
        return out
    p += 2 * nt_cnt

    if not need(1):
        return out
    me_cnt = int(body[p])
    p += 1
    if me_cnt < 0:
        return out
    for _ in range(me_cnt):
        if not need(1):
            return out
        nlen = int(body[p])
        p += 1
        if nlen < 0 or not need(nlen + 1):
            return out
        p += nlen
        slen = int(body[p])
        p += 1
        if slen < 0 or not need(slen + 1):
            return out
        p += slen + 1

    if not need(1):
        return out
    wp_start = p
    wp_cnt = int(body[p])
    p += 1
    if wp_cnt < 0 or not need(2 * wp_cnt):
        return out
    wp_entries: Dict[str, int] = {}
    for _ in range(wp_cnt):
        wp_pid = int(body[p])
        wp_high = int(body[p + 1])
        p += 2
        wp_entries[str(wp_pid)] = wp_high
    wp_words = p - wp_start
    wp_container = {
        "present": True,
        "byteSize": 4 * wp_words,
        "wordCount": wp_words,
        "summary": {"count": wp_cnt, "entries": wp_entries},
    }

    # 2. lastYouLiDay(1 or 3 words) -> teammateInitialState -> CJApplied -> SaveNPCInitialState -> 傀儡
    def _try_from(q_start: int) -> Optional[Tuple[Dict[str, Any], Dict[str, Any]]]:
        q = q_start

        def q_need(k: int) -> bool:
            return q + k <= limit

        if not q_need(1):
            return None
        tm_cnt = int(body[q])
        q += 1
        if tm_cnt < 0 or tm_cnt > 1000:
            return None
        for _ in range(tm_cnt):
            if not q_need(1 + RECORD_FIELDS_COUNT):
                return None
            q += 1 + RECORD_FIELDS_COUNT
            for _slot in range(SKILL_SLOTS_TJM):
                if not q_need(3):
                    return None
                nm_len = int(body[q + 2])
                q += 3
                if nm_len < 0 or not q_need(nm_len):
                    return None
                q += nm_len
            if not q_need(1):
                return None
            qx_cnt = int(body[q])
            q += 1
            if qx_cnt < 0 or not q_need(qx_cnt + 150 + 10 + 8 + 1):
                return None
            q += qx_cnt + 150 + 10 + 8
            tf_cnt = int(body[q])
            q += 1
            if tf_cnt < 0 or not q_need(tf_cnt):
                return None
            q += tf_cnt

        if not q_need(5):
            return None
        cj_flags = [int(body[q + k]) for k in range(5)]
        q += 5

        if q < limit and int(body[q]) == NPC_PROFILE_MAGIC:
            q += 1
            if not q_need(2):
                return None
            ver = int(body[q])
            f_cnt = int(body[q + 1])
            q += 2
            if ver < 1 or ver > 3 or f_cnt < 0 or f_cnt > 2048:
                return None
            for _ in range(f_cnt):
                if not q_need(1):
                    return None
                flen = int(body[q])
                q += 1
                if flen < 0 or flen > 256 or not q_need(flen):
                    return None
                q += flen
            if not q_need(1):
                return None
            npc_cnt = int(body[q])
            q += 1
            if npc_cnt < 0 or npc_cnt > 2048:
                return None
            for _ in range(npc_cnt):
                if not q_need(1):
                    return None
                q += 1
                for _f in range(f_cnt):
                    if not q_need(1):
                        return None
                    kind = int(body[q])
                    q += 1
                    if kind in (1, 3):
                        if not q_need(1):
                            return None
                        q += 1
                    elif kind == 2:
                        if not q_need(1):
                            return None
                        slen = int(body[q])
                        q += 1
                        if slen < 0 or slen > 65535 or not q_need(slen):
                            return None
                        q += slen
                    elif kind != 0:
                        return None
                if not q_need(1):
                    return None
                t_cnt = int(body[q])
                q += 1
                if t_cnt < 0 or t_cnt > 4096 or not q_need(t_cnt):
                    return None
                q += t_cnt
                if ver >= 2:
                    if not q_need(5):
                        return None
                    q += 5
                if ver >= 3:
                    if not q_need(1):
                        return None
                    sv_cnt = int(body[q])
                    q += 1
                    if sv_cnt < 0 or sv_cnt > f_cnt or not q_need(2 * sv_cnt + 1):
                        return None
                    q += 2 * sv_cnt
                    st_cnt = int(body[q])
                    q += 1
                    if st_cnt < 0 or st_cnt > 4096 or not q_need(2 * st_cnt):
                        return None
                    q += 2 * st_cnt

        rem = limit - q
        if rem not in (0, 2):
            return None
        puppet_c = _empty_container()
        if rem == 2:
            p_id, p_rank = int(body[q]), int(body[q + 1])
            puppet_c = {
                "present": True,
                "byteSize": 8,
                "wordCount": 2,
                "summary": {"personId": p_id, "rank": p_rank, "active": p_id != 0},
            }
        cj_c = {
            "present": True,
            "byteSize": 20,
            "wordCount": 5,
            "summary": {
                "flags": cj_flags,
                "fields": {
                    "attack": cj_flags[0],
                    "defense": cj_flags[1],
                    "qinggong": cj_flags[2],
                    "maxHp": cj_flags[3],
                    "maxMp": cj_flags[4],
                },
            },
        }
        return cj_c, puppet_c

    steps = (1, 3) if (p < limit and int(body[p]) == 0) else (3, 1)
    for st in steps:
        if p + st <= limit:
            res = _try_from(p + st)
            if res is not None:
                cj_c, puppet_c = res
                out["WuPinXiuLianHigh"] = wp_container
                out["CJApplied"] = cj_c
                out["傀儡"] = puppet_c
                return out
    return out


def parse_tjm_tail_containers(tjm: "TjmData") -> Tuple[Dict[str, Any], Dict[str, Any]]:
    ptf_words = sum(1 + len(lst) for lst in tjm.ptf)
    ptf_non_empty = sum(1 for lst in tjm.ptf if lst)
    ptf_total = sum(len(lst) for lst in tjm.ptf)

    sptf_words = sum(1 + len(lst) for lst in tjm.sptf)
    sptf_non_empty = sum(1 for lst in tjm.sptf if lst)
    sptf_equipped = sum(1 for lst in tjm.sptf for w in lst if int(w) < 100000)
    sptf_stored = sum(1 for lst in tjm.sptf for w in lst if int(w) >= 100000)

    has_id = (len(tjm.tail_words) >= 68
              and int(tjm.tail_words[-68]) == SAVE_IDENTITY
              and int(tjm.tail_words[-1]) == SAVE_IDENTITY)
    tjm.has_save_identity = has_id
    body = list(tjm.tail_words[:-68] if has_id else tjm.tail_words)
    detail = scan_rconfig_tail_detail(body)
    rc_found = bool(detail.get("found"))

    zmwp = _empty_container()
    if rc_found and detail.get("lengthPrefixed") and (len(body) - int(detail["endOffset"]) == 2):
        z0 = int(body[detail["endOffset"]])
        z1 = int(body[detail["endOffset"] + 1])
        zmwp = {
            "present": True,
            "byteSize": 8,
            "wordCount": 2,
            "summary": {"values": [z0, z1], "itemId": z0, "extra": z1},
        }

    tail_prefix = _try_parse_full_tail_prefix(
        body,
        int(detail["startOffset"]) if rc_found else len(body),
        rc_found,
    )

    rc_summary = {
        "found": rc_found,
        "format": detail["format"],
        "baseline": detail["baseline"],
        "valuesCount": detail["valuesCount"],
        "lengthPrefixed": detail["lengthPrefixed"],
        "itemIds": list(detail["itemIds"]),
        "kungfuIds": list(detail["kungfuIds"]),
        "mijiIds": list(detail["mijiIds"]),
        "personIds": list(detail["personIds"]),
    }

    containers: Dict[str, Any] = {
        "PTF": {
            "present": True,
            "byteSize": 4 * ptf_words,
            "wordCount": ptf_words,
            "summary": {"slots": 1001, "nonEmptyChars": ptf_non_empty, "totalEntries": ptf_total},
        },
        "SPTF": {
            "present": True,
            "byteSize": 4 * sptf_words,
            "wordCount": sptf_words,
            "summary": {
                "slots": 1001,
                "nonEmptyChars": sptf_non_empty,
                "equippedCount": sptf_equipped,
                "storedCount": sptf_stored,
                "totalEntries": sptf_equipped + sptf_stored,
            },
        },
        "RConfig": {
            "present": rc_found,
            "byteSize": int(detail["byteSize"]),
            "streamByteSize": int(detail["streamByteSize"]),
            "wordCount": int(detail["streamByteSize"]) // 4,
            "summary": rc_summary if rc_found else None,
        },
        "ZMWP": zmwp,
        "傀儡": tail_prefix["傀儡"],
        "CJApplied": tail_prefix["CJApplied"],
        "WuPinXiuLianHigh": tail_prefix["WuPinXiuLianHigh"],
    }
    tjm.rconfig_detail = detail
    tjm.containers = containers
    tjm.rconfig_meta = {
        "itemIds": list(detail["itemIds"]),
        "kungfuIds": list(detail["kungfuIds"]),
        "mijiIds": list(detail["mijiIds"]),
        "personIds": list(detail["personIds"]),
    }
    return detail, containers


class TjmData:
    """Parsed tjm word stream."""

    def __init__(self) -> None:
        self.miao = 0
        self.save_wall_time = 0
        self.save_create_time = 0
        self.reserved_zero = 0
        self.prefix_words: List[int] = []
        self.basic_data: List[int] = [0] * 10
        self.ptf: List[List[int]] = [[] for _ in range(1001)]
        self.sptf: List[List[int]] = [[] for _ in range(1001)]
        self.tail_words: List[int] = []
        self.rconfig_meta: Dict[str, List[int]] = {
            "itemIds": [], "kungfuIds": [], "mijiIds": [], "personIds": []}
        self.rconfig_detail: Dict[str, Any] = {}
        self.containers: Dict[str, Any] = {}
        self.has_save_identity = False

    def all_words(self) -> List[int]:
        words = [int(w) for w in self.prefix_words]
        words.extend(int(x) for x in self.basic_data[:10])
        for c in range(1001):
            lst = self.ptf[c]
            words.append(len(lst))
            words.extend(int(x) for x in lst)
        for c in range(1001):
            lst = self.sptf[c]
            words.append(len(lst))
            words.extend(int(x) for x in lst)
        words.extend(int(w) for w in self.tail_words)
        return words

    # -- talents -------------------------------------------------------------
    @staticmethod
    def decode_sptf(raw: int) -> Tuple[int, bool]:
        if raw < 100000:
            return raw, True
        return raw - 100000, False

    @staticmethod
    def encode_sptf(tid: int, equipped: bool) -> int:
        if equipped:
            return tid
        return tid + 100000


def parse_tjm(data: bytes) -> TjmData:
    if len(data) < 20:
        raise ValueError("tjm 헤더가 너무 짧습니다")
    word_count, miao, wall, create, reserved = struct.unpack_from("<5i", data, 0)
    if word_count < 0 or 20 + 4 * word_count > len(data):
        raise ValueError("tjm 워드 카운트가 잘못되었습니다")
    words = list(struct.unpack_from(f"<{word_count}i", data, 20)) if word_count else []
    t = TjmData()
    t.miao, t.save_wall_time = miao, wall
    t.save_create_time, t.reserved_zero = create, reserved

    p = 0
    n = len(words)
    for _sec in range(6):
        if p >= n:
            raise ValueError("tjm 섹션이 잘렸습니다")
        if _sec == 0:
            cnt = words[p]
            p += 1
            for _ in range(max(0, cnt)):
                if p + 1 >= n:
                    raise ValueError("tjm 섹션1이 잘렸습니다")
                p += 2 + 2 * max(0, words[p + 1])
        elif _sec == 1:
            p += 1 + max(0, words[p])
        elif _sec == 2:
            p += 1 + 2 * max(0, words[p])
        elif _sec == 3:
            p += 1 + 9 * max(0, words[p])
        elif _sec == 4:
            p += 1 + max(0, words[p])
        else:
            p += 1 + 2 * max(0, words[p])
    if p > n:
        raise ValueError("tjm 접두부가 잘렸습니다")
    t.prefix_words = words[:p]

    if p + 10 > n:
        raise ValueError("tjm 기본 데이터가 잘렸습니다")
    t.basic_data = words[p:p + 10]
    p += 10

    for store in (t.ptf, t.sptf):
        for c in range(1001):
            if p >= n:
                raise ValueError("tjm 인재(talent) 섹션이 잘렸습니다")
            cnt = max(0, words[p])
            if p + 1 + cnt > n:
                raise ValueError("tjm 인재 목록이 잘렸습니다")
            store[c] = words[p + 1:p + 1 + cnt]
            p += 1 + cnt

    t.tail_words = words[p:]
    parse_tjm_tail_containers(t)
    return t


def build_tjm(tjm: TjmData, update_timestamp: bool = False) -> bytes:
    words = tjm.all_words()
    wall = tjm.save_wall_time
    if update_timestamp:
        wall = int(_dt.datetime.now().timestamp())
    header = struct.pack("<5i", len(words), tjm.miao, wall,
                         tjm.save_create_time, tjm.reserved_zero)
    body = struct.pack(f"<{len(words)}i", *words) if words else b""
    return header + body


def verify_untouched_verbatim(
    before_bytes: bytes,
    after_bytes: bytes,
    editable_names: Sequence[str] = (R_GRP_NAME, TJM_NAME),
) -> Dict[str, Any]:
    """Verify non-editable PKZIP entries survived byte-for-byte verbatim."""
    editable = set(editable_names)
    before_entries = parse_zip_entries(before_bytes)
    after_entries = parse_zip_entries(after_bytes)
    before_untouched = [e for e in before_entries if e.name not in editable]
    after_untouched = [e for e in after_entries if e.name not in editable]
    if len(before_untouched) != len(after_untouched):
        raise ValueError(
            f"비편집 엔트리 개수가 일치하지 않습니다: {len(before_untouched)} != {len(after_untouched)}"
        )
    for idx, (a, b) in enumerate(zip(before_untouched, after_untouched)):
        if a.name != b.name:
            raise ValueError(f"비편집 엔트리 순서/이름 불일치[{idx}]: {a.name!r} != {b.name!r}")
        for attr in ("method", "crc32", "comp_size", "uncomp_size", "raw_comp_bytes"):
            if getattr(a, attr) != getattr(b, attr):
                raise ValueError(f"비편집 엔트리 {a.name!r}의 {attr}가 변경되었습니다")
    return {
        "ok": True,
        "untouched": [e.name for e in before_untouched],
        "sha256Before": hashlib.sha256(before_bytes).hexdigest(),
        "sha256After": hashlib.sha256(after_bytes).hexdigest(),
    }


# ----------------------------------------------------------------------------
# Session
# ----------------------------------------------------------------------------
class JinshuSaveSession:
    """High level read/write session for a single .sav file."""

    def __init__(self, sav_bytes: bytes) -> None:
        self._orig_sav_bytes = bytes(sav_bytes)
        self.entries = parse_zip_entries(sav_bytes)
        self._by_name = {e.name: e for e in self.entries}
        for required in (R_GRP_NAME, TJM_NAME):
            if required not in self._by_name:
                raise ValueError(f".sav 안에 {required} 항목이 없습니다")
        r_entry = self._by_name[R_GRP_NAME]
        tjm_entry = self._by_name[TJM_NAME]
        self._orig_r_bytes = _decompress_entry(r_entry)
        self._orig_tjm_bytes = _decompress_entry(tjm_entry)
        self.r = RGrp(self._orig_r_bytes)
        self.tjm = parse_tjm(self._orig_tjm_bytes)
        self.catalog = load_catalog()
        self._talent_ids = _catalog_ids(self.catalog, "talents")
        self._refresh_rconfig_ids()

    def _refresh_rconfig_ids(self) -> None:
        self._kf_ids = (set(range(1, 462)) | set(self.tjm.rconfig_meta.get("kungfuIds", []))) - set(range(462, 471))
        self._miji_ids = set(range(1, 101)) | set(self.tjm.rconfig_meta.get("mijiIds", []))
        self._item_ids = set(range(0, 661)) | set(self.tjm.rconfig_meta.get("itemIds", []))

    # -- persistence ---------------------------------------------------------
    def to_bytes(self, update_timestamp: bool = False) -> bytes:
        r_entry = self._by_name[R_GRP_NAME]
        if bytes(self.r.buf) != self._orig_r_bytes or r_entry.dirty:
            _recompress_entry(r_entry, bytes(self.r.buf))
        tjm_entry = self._by_name[TJM_NAME]
        new_tjm = build_tjm(self.tjm, update_timestamp)
        if new_tjm != self._orig_tjm_bytes or update_timestamp or tjm_entry.dirty:
            _recompress_entry(tjm_entry, new_tjm)
        return build_zip_entries(self.entries)

    # -- rconfig safe editing ------------------------------------------------
    def get_rconfig(self) -> Optional[Dict[str, Any]]:
        parse_tjm_tail_containers(self.tjm)
        detail = self.tjm.rconfig_detail or {}
        if not detail.get("found") or not isinstance(detail.get("object"), dict):
            return None
        return copy.deepcopy(detail["object"])

    def _apply_rconfig_obj(self, obj: Dict[str, Any]) -> None:
        parse_tjm_tail_containers(self.tjm)
        detail = self.tjm.rconfig_detail or {}
        if not detail.get("found"):
            raise ValueError("RConfig 블록이 없는 세이브입니다")
        if not detail.get("lengthPrefixed"):
            raise ValueError("길이 프리픽스 기반 RConfig 블록만 안전 편집을 지원합니다")
        if obj.get("format") != 1:
            raise ValueError(f"지원하지 않는 RConfig format입니다: {obj.get('format')!r}")
        if "baseline" in obj and not isinstance(obj.get("baseline"), str):
            raise ValueError("RConfig baseline은 문자열이어야 합니다")
        if not isinstance(obj.get("values"), dict):
            raise ValueError("RConfig values는 딕셔너리여야 합니다")
        encoded = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(encoded) > 8 * 1024 * 1024:
            raise ValueError("RConfig JSON 크기가 8MB를 초과합니다")
        start = int(detail["startOffset"])
        end = int(detail["endOffset"])
        words = list(self.tjm.tail_words)
        words[start:end] = [len(encoded), *encoded]
        self.tjm.tail_words = words
        parse_tjm_tail_containers(self.tjm)
        self._refresh_rconfig_ids()

    def set_rconfig_value(self, key: str, value: Any) -> None:
        if not isinstance(key, str) or not key:
            raise ValueError("RConfig 키는 비어 있지 않은 문자열이어야 합니다")
        if isinstance(value, bool) or not isinstance(value, (int, float, str)):
            raise ValueError("RConfig 값은 int, float 또는 str만 허용됩니다")
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError("RConfig float 값은 유한수여야 합니다")
        obj = self.get_rconfig()
        if obj is None:
            raise ValueError("RConfig 블록이 없는 세이브입니다")
        if "values" not in obj:
            obj["values"] = {}
        if not isinstance(obj["values"], dict):
            raise ValueError("RConfig values가 올바른 딕셔너리가 아닙니다")
        obj["values"][key] = value
        self._apply_rconfig_obj(obj)

    def remove_rconfig_value(self, key: str) -> bool:
        obj = self.get_rconfig()
        if obj is None:
            return False
        values = obj.get("values")
        if not isinstance(values, dict) or key not in values:
            return False
        del values[key]
        self._apply_rconfig_obj(obj)
        return True

    # -- convenience ---------------------------------------------------------
    @property
    def hero_id(self) -> int:
        party = self.r.get_party()
        return party[0] if party and party[0] >= 0 else 0

    def find_item_slot(self, item_id: int) -> int:
        return self.r._find_item(item_id)

    # -- validation ----------------------------------------------------------
    def validate(self) -> Dict[str, Any]:
        errors: List[str] = []
        warnings: List[str] = []
        parse_tjm_tail_containers(self.tjm)
        self._refresh_rconfig_ids()
        party = self.r.get_party()
        seen = set()
        for slot, pid in enumerate(party):
            if pid < -1 or pid > 757:
                errors.append(f"파티 슬롯 {slot}: 캐릭터 ID {pid} 범위 초과")
            elif pid >= 0:
                if pid in seen:
                    errors.append(f"파티 슬롯 {slot}: 캐릭터 {pid} 중복")
                seen.add(pid)
        if party and party[0] < 0:
            errors.append("파티 첫 슬롯에 주인공이 없습니다")
        for slot, pid in enumerate(party):
            if pid < 0:
                continue
            for key, (lo, hi) in STAT_RANGES.items():
                val = self.r.get_person(pid, key)
                if val is None:
                    continue
                if val < lo or val > hi:
                    errors.append(f"캐릭터 {pid} {key}={val} 범위({lo}..{hi}) 초과")
            for i, kid in enumerate(self.r.get_person_list(pid, "kungfu_id")):
                if kid == 0:
                    continue
                if 462 <= kid <= 470:
                    warnings.append(f"캐릭터 {pid} 무공슬롯 {i}: 자리표시자 무공 ID {kid}")
                elif kid not in self._kf_ids:
                    errors.append(f"캐릭터 {pid} 무공슬롯 {i}: 무효 ID {kid}")
            for i, mid in enumerate(self.r.get_person_list(pid, "miji")):
                if mid and mid not in self._miji_ids:
                    errors.append(f"캐릭터 {pid} 비급슬롯 {i}: 무효 ID {mid}")
        for c in range(1001):
            for i, tid in enumerate(self.tjm.ptf[c]):
                if self._talent_ids and tid not in self._talent_ids:
                    errors.append(f"캐릭터 {c} ptf {i}: 무효 인재 ID {tid}")
            for i, raw in enumerate(self.tjm.sptf[c]):
                tid, _ = TjmData.decode_sptf(raw)
                if self._talent_ids and tid not in self._talent_ids:
                    errors.append(f"캐릭터 {c} sptf {i}: 무효 인재 ID {tid}")
        inv_map: Dict[int, int] = {}
        for slot in range(INVENTORY_SLOTS):
            off = self.r._inv_off(slot)
            iid, cnt = self.r.get_i16(off), self.r.get_i16(off + 2)
            if iid < 0:
                if iid < -1:
                    errors.append(f"인벤토리 슬롯 {slot}: 잘못된 빈 슬롯 값 {iid}")
                continue
            if slot >= MAX_ACTIVE_INVENTORY:
                errors.append(f"인벤토리 슬롯 {slot}: 활성 슬롯 범위 초과")
            if iid not in self._item_ids:
                errors.append(f"인벤토리 슬롯 {slot}: 무효 아이템 ID {iid}")
            if cnt < 0:
                errors.append(f"인벤토리 슬롯 {slot}: 수량 {cnt} 음수")
            if iid != GOLD_ITEM_ID and cnt < 1:
                errors.append(f"인벤토리 슬롯 {slot}: 수량 {cnt} 범위 초과")
            inv_map[iid] = cnt
        gold = self.tjm.basic_data[0]
        if not (0 <= gold <= 2_000_000_000):
            errors.append(f"금액 {gold} 범위 초과")
        if gold == 0 and GOLD_ITEM_ID in inv_map:
            errors.append(f"금액 0 이지만 아이템 {GOLD_ITEM_ID} 슬롯 존재")
        if gold > 0 and GOLD_ITEM_ID not in inv_map:
            errors.append(f"금액 {gold} 이지만 아이템 {GOLD_ITEM_ID} 슬롯 없음")
        mjcz = self.tjm.basic_data[1]
        if mjcz < 0 or mjcz > 30000:
            errors.append(f"명중가치 {mjcz} 범위 초과")
        elif mjcz > 0:
            if inv_map.get(MJ_CZ_ITEM_ID) != mjcz:
                errors.append(f"명중가치 {mjcz} 와 아이템 {MJ_CZ_ITEM_ID} 수량 불일치")
        elif MJ_CZ_ITEM_ID in inv_map:
            errors.append(f"명중가치 0 이지만 아이템 {MJ_CZ_ITEM_ID} 슬롯 존재")
        sp = self.tjm.basic_data[2]
        if sp < 0 or sp > 30000:
            errors.append(f"SP 조각 {sp} 범위 초과")
        elif 0 <= sp <= 30000:
            base_sp = self.r.get_i16(BASE_OFFSETS["spFragment"])
            if sp != base_sp:
                errors.append(f"SP 조각 {sp} 와 기본값 {base_sp} 불일치")

        # RConfig & tail container validation
        rc_detail = self.tjm.rconfig_detail or {}
        if rc_detail.get("found"):
            rc_obj = rc_detail.get("object")
            if not isinstance(rc_obj, dict):
                errors.append("RConfig JSON 객체가 유효하지 않습니다")
            else:
                if rc_obj.get("format") != 1:
                    errors.append(f"RConfig format 값이 1이 아닙니다: {rc_obj.get('format')!r}")
                if "baseline" in rc_obj and not isinstance(rc_obj.get("baseline"), str):
                    errors.append("RConfig baseline이 문자열이 아닙니다")
                if "values" in rc_obj and not isinstance(rc_obj.get("values"), dict):
                    errors.append("RConfig values가 딕셔너리가 아닙니다")
        containers = self.tjm.containers or {}
        for cname in ("PTF", "SPTF", "RConfig", "ZMWP", "傀儡", "CJApplied", "WuPinXiuLianHigh"):
            cinfo = containers.get(cname)
            if not isinstance(cinfo, dict):
                errors.append(f"tjm 컨테이너 {cname} 요약이 누락되었습니다")
        return {
            "ok": not errors,
            "errors": errors,
            "warnings": warnings,
            "containers": containers,
        }

    # -- mutations -----------------------------------------------------------
    def _check_range(self, key: str, val: int) -> int:
        lo, hi = STAT_RANGES[key]
        if not (lo <= val <= hi):
            raise ValueError(f"{key}={val} 값이 허용 범위({lo}..{hi})를 벗어났습니다")
        return val

    def set_base_field(self, key: str, val: int) -> None:
        self.r.set_base(key, int(val))

    def set_basic(self, key: str, val: int) -> None:
        if key not in TJM_BASIC_KEYS:
            raise ValueError(f"알 수 없는 기본 필드: {key}")
        idx = TJM_BASIC_KEYS.index(key)
        self.tjm.basic_data[idx] = int(val)

    def set_gold(self, gold: int) -> None:
        if not (0 <= gold <= 2_000_000_000):
            raise ValueError("금액은 0..2000000000 범위여야 합니다")
        self.tjm.basic_data[0] = gold
        if gold > 0:
            self.r.set_item_count(GOLD_ITEM_ID, 0)
        else:
            self.r.remove_item_slot(GOLD_ITEM_ID)

    def set_mjcz(self, mjcz: int) -> None:
        if not (0 <= mjcz <= 30000):
            raise ValueError("명중가치(mjcz)는 0..30000 범위여야 합니다")
        self.tjm.basic_data[1] = mjcz
        if mjcz > 0:
            self.r.set_item_count(MJ_CZ_ITEM_ID, mjcz)
        else:
            self.r.remove_item_slot(MJ_CZ_ITEM_ID)

    def set_sp(self, sp: int) -> None:
        if not (0 <= sp <= 30000):
            raise ValueError("SP 조각은 0..30000 범위여야 합니다")
        self.tjm.basic_data[2] = sp
        self.r.set_i16(BASE_OFFSETS["spFragment"], sp)

    def set_item(self, item_id: int, count: int) -> None:
        if item_id not in self._item_ids:
            raise ValueError(f"무효 아이템 ID: {item_id}")
        count = max(0, min(30000, int(count)))
        if item_id == GOLD_ITEM_ID and count == 0:
            self.r.set_item_count(GOLD_ITEM_ID, 0)
            return
        if item_id == MJ_CZ_ITEM_ID:
            self.set_mjcz(count)
            return
        self.r.set_item_count(item_id, count)

    def remove_item(self, item_id: int) -> None:
        if item_id == GOLD_ITEM_ID:
            self.set_gold(0)
        elif item_id == MJ_CZ_ITEM_ID:
            self.set_mjcz(0)
        else:
            self.r.remove_item_slot(item_id)

    def set_person_stat(self, pid: int, key: str, val: Any) -> None:
        if key not in PERSON_OFFSETS:
            raise ValueError(f"알 수 없는 스탯: {key}")
        if key in STAT_RANGES and isinstance(val, int):
            self._check_range(key, val)
        lo, hi = STAT_RANGES.get(key, (None, None))
        self.r.set_person(pid, key, val)

    def set_kungfu(self, pid: int, slot: int, kungfu_id: int, level: int) -> None:
        if not (0 <= slot < KUNGFU_SLOTS):
            raise ValueError(f"무공 슬롯 범위 초과: {slot}")
        if kungfu_id == 0:
            level = 0
        else:
            if 462 <= kungfu_id <= 470:
                raise ValueError(f"무공 ID {kungfu_id} 는 자리표시자라 사용할 수 없습니다")
            if kungfu_id not in self._kf_ids:
                raise ValueError(f"무효 무공 ID: {kungfu_id}")
        if not (0 <= level <= 999):
            raise ValueError(f"무공 레벨 범위 초과: {level}")
        self.r.set_person_array(pid, "kungfuIdStart", slot, kungfu_id)
        self.r.set_person_array(pid, "kungfuLevelStart", slot, level)

    def set_miji(self, pid: int, slot: int, miji_id: int) -> None:
        if not (0 <= slot < MIJI_SLOTS):
            raise ValueError(f"비급 슬롯 범위 초과: {slot}")
        if miji_id and miji_id not in self._miji_ids:
            raise ValueError(f"무효 비급 ID: {miji_id}")
        self.r.set_person_array(pid, "mijiStart", slot, miji_id)

    def open_meridians(self, pid: int) -> None:
        self.r.set_person_list(pid, "shun", [1] * MERIDIAN_SLOTS)
        self.r.set_person_list(pid, "ni", [1] * MERIDIAN_SLOTS)
        self.r.set_person_list(pid, "acupoint", [1] * ACUPOINT_SLOTS)

    def set_party_slot(self, slot: int, pid: int) -> None:
        if not (0 <= slot < PARTY_SLOTS):
            raise ValueError(f"파티 슬롯 범위 초과: {slot}")
        if pid != -1 and not (0 <= pid <= 757):
            raise ValueError(f"캐릭터 ID 범위 초과: {pid}")
        if pid >= 0:
            for i, other in enumerate(self.r.get_party()):
                if i != slot and other == pid:
                    raise ValueError(f"캐릭터 {pid} 는 이미 파티 슬롯 {i} 에 있습니다")
        self.r.set_party_slot(slot, pid)

    def add_talent(self, pid: int, target: str, tid: int) -> None:
        if not (0 <= pid <= 1000):
            raise ValueError("캐릭터 ID 범위 초과")
        if self._talent_ids and tid not in self._talent_ids:
            raise ValueError(f"무효 인재 ID: {tid}")
        target = (target or "ptf").lower()
        if target == "ptf":
            if tid not in self.tjm.ptf[pid]:
                self.tjm.ptf[pid].append(tid)
            return
        equipped = target == "sptf"
        raw = TjmData.encode_sptf(tid, equipped)
        cur = self.tjm.sptf[pid]
        cleaned = [w for w in cur if TjmData.decode_sptf(w)[0] != tid]
        cleaned.append(raw)
        self.tjm.sptf[pid] = cleaned

    def remove_talent(self, pid: int, target: str, tid: int) -> None:
        if not (0 <= pid <= 1000):
            raise ValueError("캐릭터 ID 범위 초과")
        target = (target or "ptf").lower()
        if target == "ptf":
            self.tjm.ptf[pid] = [t for t in self.tjm.ptf[pid] if t != tid]
        elif target in ("sptf", "sptf-unequipped"):
            self.tjm.sptf[pid] = [w for w in self.tjm.sptf[pid]
                                  if TjmData.decode_sptf(w)[0] != tid]


# ----------------------------------------------------------------------------
# Presets
# ----------------------------------------------------------------------------
PRESETS: List[Dict[str, str]] = [
    {"id": "wealth_max", "ko": "최대 금액", "descKo": "금액/명중가치/SP 조각/스태미나를 최대치로 설정"},
    {"id": "hero_core_master", "ko": "주인공 코어 만렙", "descKo": "주인공 레벨/HP/MP/공방/경지 최대화"},
    {"id": "hero_weapons_master", "ko": "주인공 무기 숙련", "descKo": "모든 무기 숙련 및 성장치 최대화"},
    {"id": "party_full_recovery", "ko": "파티 전체 회복", "descKo": "파티 전원의 HP/MP/부상/중독/체력 회복"},
    {"id": "hero_meridians_open", "ko": "주인공 경락 개통", "descKo": "14 정맥/기경 및 164 혈도 개방"},
    {"id": "wuxue_talent_points", "ko": "무학/천부 포인트", "descKo": "무학 포인트와 천부 포인트 최대화"},
]


def apply_preset(session: JinshuSaveSession, preset_id: str) -> None:
    hero = session.hero_id
    if preset_id == "wealth_max":
        session.set_gold(500000)
        session.set_mjcz(999)
        session.set_sp(30000)
        session.set_basic("staminaJl", 500)
        session.set_person_stat(hero, "fame", 30000)
    elif preset_id == "hero_core_master":
        stats = {"level": 120, "maxHp": 32767, "hp": 32767, "maxMp": 32767,
                 "mp": 32767, "baseHp": 32767, "baseMp": 32767,
                 "attack": 30000, "defense": 30000, "qinggong": 30000,
                 "aptitude": 100, "zhenqi": 32767, "tili": 100, "injury": 0,
                 "poison": 0}
        for key, val in stats.items():
            session.set_person_stat(hero, key, val)
        for slot in range(KUNGFU_SLOTS):
            kid = session.r.get_person_array(hero, "kungfuIdStart", slot)
            if kid:
                session.set_kungfu(hero, slot, kid, 999)
    elif preset_id == "hero_weapons_master":
        for key in ("fist", "finger", "sword", "blade", "specialWeapon",
                    "hiddenWeapon", "wuxueKnowledge"):
            session.set_person_stat(hero, key, 30000)
        for key in ("fistGrowth", "fingerGrowth", "swordGrowth", "bladeGrowth",
                    "specialGrowth", "hiddenGrowth"):
            session.set_person_stat(hero, key, 30000)
    elif preset_id == "party_full_recovery":
        for pid in session.r.get_party():
            if pid < 0:
                continue
            max_hp = session.r.get_person(pid, "maxHp")
            max_mp = session.r.get_person(pid, "maxMp")
            session.set_person_stat(pid, "hp", max(max_hp, 1))
            session.set_person_stat(pid, "mp", max(max_mp, 0))
            session.set_person_stat(pid, "injury", 0)
            session.set_person_stat(pid, "poison", 0)
            session.set_person_stat(pid, "tili", 100)
    elif preset_id == "hero_meridians_open":
        session.open_meridians(hero)
    elif preset_id == "wuxue_talent_points":
        for key in ("wuxuePts", "wuxueCap", "tianfuPts", "tianfuCap"):
            session.set_person_stat(hero, key, 30000)
    else:
        raise ValueError(f"알 수 없는 프리셋: {preset_id}")


# ----------------------------------------------------------------------------
# Demo save generator
# ----------------------------------------------------------------------------
def _make_zip_entry(name: str, data: bytes, compress: bool) -> ZipEntry:
    e = ZipEntry()
    e.raw_name = name.encode("utf-8")
    e.name = name
    e.version_made = e.version_needed = 20
    e.method = 8 if compress else 0
    e.dos_time, e.dos_date = 0, 0x21
    e.crc32 = zlib.crc32(data) & 0xFFFFFFFF
    e.uncomp_size = len(data)
    if compress:
        comp = zlib.compressobj(6, zlib.DEFLATED, -15)
        e.raw_comp_bytes = comp.compress(data) + comp.flush()
    else:
        e.raw_comp_bytes = data
    e.comp_size = len(e.raw_comp_bytes)
    return e


def create_demo_sav_bytes(catalog: Optional[Dict[str, Any]] = None) -> bytes:
    r = RGrp(bytes(R_GRP_SIZE))
    for slot in range(INVENTORY_SLOTS):
        off = r._inv_off(slot)
        r.set_i16(off, -1)
        r.set_i16(off + 2, 0)

    for pid in (0, 1, 2):
        r.set_person(pid, "id", pid)
        r.set_person(pid, "portrait", 0)
        r.set_person(pid, "constitution", 6)
        r.set_person(pid, "gender", 1)
        r.set_person(pid, "aptitude", 60)
        r.set_person(pid, "level", 12)
        r.set_person(pid, "hp", 300)
        r.set_person(pid, "maxHp", 300)
        r.set_person(pid, "mp", 120)
        r.set_person(pid, "maxMp", 120)
        r.set_person(pid, "tili", 100)
        r.set_person(pid, "weapon", -1)
        r.set_person(pid, "armor", -1)
        r.set_person(pid, "mount", -1)
        r.set_person(pid, "practiceItem", -1)

    hero = 0
    write_big5_field(r.buf, r.person_offset(hero) + 8, 10, "小蝦米")
    write_big5_field(r.buf, r.person_offset(hero) + 18, 10, "")
    for key, val in (("fame", 100), ("baseHp", 300), ("baseMp", 120), ("zhenqi", 50)):
        r.set_person(hero, key, val)
    r.set_person_array(hero, "kungfuIdStart", 0, 1)
    r.set_person_array(hero, "kungfuLevelStart", 0, 100)
    r.set_person_array(hero, "kungfuIdStart", 1, 10)
    r.set_person_array(hero, "kungfuLevelStart", 1, 200)
    for slot, pid in enumerate([0, 1, 2] + [-1] * (PARTY_SLOTS - 3)):
        r.set_party_slot(slot, pid)
    r.set_base("difficulty", 1)
    r.set_base("playthrough", 1)
    r.set_base("spFragment", 150)
    r.set_item_count(GOLD_ITEM_ID, 0)
    r.set_item_count(MJ_CZ_ITEM_ID, 12)

    t = TjmData()
    t.miao = 1
    t.save_wall_time = int(_dt.datetime(2024, 1, 1).timestamp())
    t.save_create_time = t.save_wall_time
    t.prefix_words = [0, 0, 0, 0, 0, 0]
    t.basic_data = [5000, 12, 150, 1, 1, 1, 3, 0, 0, 0]
    t.ptf[0] = [9862, 0]
    t.sptf[0] = [TjmData.encode_sptf(2019, False), 9863]
    t.tail_words = [SAVE_IDENTITY] + [0] * 66 + [SAVE_IDENTITY]
    t.has_save_identity = True

    files = {
        R_GRP_NAME: bytes(r.buf),
        "s.grp": bytes(4102),
        "d.grp": bytes(4102),
        "a.grp": bytes(4102),
        "e.grp": bytes(4102),
        TJM_NAME: build_tjm(t),
    }
    entries = [_make_zip_entry(name, data, name in DEFLATE_ENTRIES)
               for name, data in files.items()]
    return build_zip_entries(entries)


# ----------------------------------------------------------------------------
# Safety guards & atomic writes
# ----------------------------------------------------------------------------
def assert_no_symlinks(path: Any) -> None:
    cur = Path(path)
    parts: List[Path] = []
    while True:
        parts.append(cur)
        if cur.parent == cur:
            break
        cur = cur.parent
    for node in reversed(parts):
        if os.path.islink(str(node)):
            raise PermissionError(f"심볼릭 링크 경로는 사용할 수 없습니다: {node}")


def is_game_running() -> List[str]:
    if os.environ.get("JSSE_SIMULATE_GAME_RUNNING") == "1":
        return ["jinshuqunxiazhuan.exe (simulated)"]
    found: List[str] = []
    targets = ("jinshuqunxiazhuan", "qunxia52")
    try:
        if os.name == "nt":
            import subprocess
            res = subprocess.run(["tasklist", "/FO", "CSV", "/NH"],
                                 capture_output=True, text=True, timeout=10)
            for line in res.stdout.splitlines():
                low = line.lower()
                if any(t in low for t in targets):
                    found.append(line.strip())
        else:
            import subprocess
            res = subprocess.run(["ps", "-eo", "comm="], capture_output=True,
                                 text=True, timeout=10)
            for line in res.stdout.splitlines():
                low = line.strip().lower()
                if any(t in low for t in targets):
                    found.append(line.strip())
    except Exception:
        return found
    return found


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _atomic_write(path: Path, data: bytes) -> None:
    tmp = path.with_name(f"{path.name}.tmp-{uuid.uuid4().hex}")
    try:
        with open(tmp, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        with open(tmp, "rb") as fh:
            if _sha256(fh.read()) != _sha256(data):
                raise IOError("임시 파일 무결성 검증에 실패했습니다")
        os.replace(str(tmp), str(path))
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def save_sav_safely(target_path: Any, new_bytes: bytes,
                    output_path: Optional[Any] = None,
                    force: bool = False) -> Dict[str, Any]:
    target = Path(target_path)
    assert_no_symlinks(target)
    if not _valid_save_name(target.name):
        raise ValueError(f"허용되지 않는 세이브 파일 이름입니다: {target.name}")
    if output_path is not None:
        out_candidate = Path(output_path)
        assert_no_symlinks(out_candidate)
        if not _valid_save_name(out_candidate.name):
            raise ValueError(f"허용되지 않는 세이브 파일 이름입니다: {out_candidate.name}")
    running = is_game_running()
    if running and not force:
        raise RuntimeError(
            "게임 실행 중이 감지되었습니다. 게임을 종료한 뒤 다시 시도하거나 --force 를 사용하세요."
            f" ({', '.join(running)})")
    session = JinshuSaveSession(new_bytes)
    report = session.validate()
    if not report["ok"]:
        raise ValueError("저장 파일 검증 실패: " + "; ".join(report["errors"][:5]))
    digest = _sha256(new_bytes)
    if output_path is None or os.path.abspath(str(output_path)) == os.path.abspath(str(target)):
        original = target.read_bytes()
        stamp = _dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        bak = target.with_name(f"{target.name}.backup-{stamp}-{uuid.uuid4().hex[:8]}.bak")
        _atomic_write(bak, original)
        if _sha256(bak.read_bytes()) != _sha256(original):
            raise IOError("백업 무결성 검증에 실패했습니다")
        _atomic_write(target, new_bytes)
        return {"target": str(target), "backup": str(bak),
                "bytes": len(new_bytes), "sha256": digest}
    out = Path(output_path)
    assert_no_symlinks(target)
    assert_no_symlinks(out)
    _atomic_write(out, new_bytes)
    return {"target": str(out), "backup": None,
            "bytes": len(new_bytes), "sha256": digest}


# ----------------------------------------------------------------------------
# CLI helpers
# ----------------------------------------------------------------------------
def _load_session(path: str) -> JinshuSaveSession:
    return JinshuSaveSession(Path(path).read_bytes())


def _print_json(obj: Any) -> None:
    print(json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True))


def _cmd_inspect(args: argparse.Namespace) -> int:
    session = _load_session(args.sav)
    party = session.r.get_party()
    basic = dict(zip(TJM_BASIC_KEYS, session.tjm.basic_data))
    report = {
        "file": str(args.sav),
        "entries": [e.name for e in session.entries],
        "entryDetails": [
            {
                "name": e.name,
                "method": e.method,
                "crc32": e.crc32,
                "compSize": e.comp_size,
                "uncompSize": e.uncomp_size,
            }
            for e in session.entries
        ],
        "basic": basic,
        "party": party,
        "spFragment": session.r.get_base("spFragment"),
        "rconfig": session.tjm.rconfig_meta,
        "containers": session.tjm.containers,
        "hasSaveIdentity": session.tjm.has_save_identity,
    }
    if args.char is not None:
        pid = int(args.char)
        stats = {k: session.r.get_person(pid, k) for k in PERSON_OFFSETS
                 if k not in ("kungfuIdStart", "kungfuLevelStart", "mijiStart",
                              "meridianShunStart", "meridianNiStart",
                              "acupointStart")}
        stats["kungfu"] = [
            {"slot": i, "id": kid,
             "level": session.r.get_person_array(pid, "kungfuLevelStart", i)}
            for i, kid in enumerate(session.r.get_person_list(pid, "kungfu_id"))]
        stats["miji"] = session.r.get_person_list(pid, "miji")
        report["character"] = stats
    if args.inventory:
        report["inventory"] = [s for s in session.r.get_inventory(MAX_ACTIVE_INVENTORY)
                               if s["itemId"] >= 0]
    if args.json:
        _print_json(report)
    else:
        print(f"== {report['file']} ==")
        print(f"엔트리: {', '.join(report['entries'])}")
        print(f"금액: {basic['gold']}  명중가치: {basic['mjcz']}  SP: {basic['sp']}")
        print(f"파티: {party}")
        c_summary = [
            f"{cname}:{'Y' if cinfo.get('present') else 'N'}({cinfo.get('byteSize', 0)}B)"
            for cname, cinfo in (report.get("containers") or {}).items()
        ]
        if c_summary:
            print(f"컨테이너: {', '.join(c_summary)}")
        if "character" in report:
            for k, v in report["character"].items():
                if k in ("kungfu", "miji"):
                    continue
                print(f"  {k}: {v}")
            for kf in report["character"]["kungfu"]:
                if kf["id"]:
                    print(f"  무공[{kf['slot']}]: {kf['id']} (Lv {kf['level']})")
        if "inventory" in report:
            for it in report["inventory"]:
                print(f"  아이템 {it['itemId']} x{it['count']}")
    return 0


def _parse_rconfig_cli_value(text: str) -> Any:
    raw = str(text)
    if raw.startswith('"') or (raw and raw[0] in "-0123456789"):
        try:
            parsed = json.loads(raw)
            if not isinstance(parsed, bool) and isinstance(parsed, (int, float, str)):
                if isinstance(parsed, float) and not math.isfinite(parsed):
                    raise ValueError("유한한 숫자만 허용됩니다")
                return parsed
        except ValueError:
            pass
    return raw


def _cmd_validate(args: argparse.Namespace) -> int:
    session = _load_session(args.sav)
    report = session.validate()
    if args.json:
        _print_json(report)
    else:
        print("검증 통과" if report["ok"] else "검증 실패")
        for err in report["errors"]:
            print(f"  [오류] {err}")
        for warn in report["warnings"]:
            print(f"  [경고] {warn}")
    return 0 if report["ok"] else 2


def _cmd_presets(args: argparse.Namespace) -> int:
    if args.json:
        _print_json(PRESETS)
    else:
        for p in PRESETS:
            print(f"{p['id']:24s} {p['ko']} - {p['descKo']}")
    return 0


def _cmd_edit(args: argparse.Namespace) -> int:
    session = _load_session(args.sav)
    hero = session.hero_id
    pid = int(args.char) if args.char is not None else hero
    for preset in args.preset or []:
        apply_preset(session, preset)
    if args.gold is not None:
        session.set_gold(int(args.gold))
    if args.mjcz is not None:
        session.set_mjcz(int(args.mjcz))
    if args.sp is not None:
        session.set_sp(int(args.sp))
    if args.stamina is not None:
        session.set_basic("staminaJl", int(args.stamina))
    if args.playthrough is not None:
        session.set_base_field("playthrough", int(args.playthrough))
    if args.difficulty is not None:
        session.set_base_field("difficulty", int(args.difficulty))
    if args.name is not None:
        session.r.set_person(pid, "name", args.name)
    if args.nick is not None:
        session.r.set_person(pid, "nick", args.nick)
    for spec in args.set_stat or []:
        key, _, val = spec.partition("=")
        session.set_person_stat(pid, key.strip(), int(val))
    for spec in args.set_kungfu or []:
        slot, kid, level = [int(x) for x in spec.split(":")]
        session.set_kungfu(pid, slot, kid, level)
    for spec in args.set_miji or []:
        slot, mid = [int(x) for x in spec.split(":")]
        session.set_miji(pid, slot, mid)
    for spec in args.add_talent or []:
        target, _, tid = spec.rpartition(":")
        if not tid:
            target, tid = "ptf", spec
        session.add_talent(pid, target.strip() or "ptf", int(tid))
    for spec in args.remove_talent or []:
        target, _, tid = spec.rpartition(":")
        if not tid:
            target, tid = "ptf", spec
        session.remove_talent(pid, target.strip() or "ptf", int(tid))
    if args.open_meridians:
        session.open_meridians(pid)
    for spec in args.set_item or []:
        iid, _, cnt = spec.partition(":")
        session.set_item(int(iid), int(cnt))
    for spec in args.remove_item or []:
        session.remove_item(int(spec))
    for spec in args.set_party or []:
        slot, cid = [int(x) for x in spec.split(":")]
        session.set_party_slot(slot, cid)
    for spec in getattr(args, "rconfig_set", None) or []:
        if "=" not in spec:
            raise ValueError(f"--rconfig-set 형식 오류(KEY=VALUE 필요): {spec!r}")
        r_key, _, r_val = spec.partition("=")
        session.set_rconfig_value(r_key.strip(), _parse_rconfig_cli_value(r_val))
    for r_key in getattr(args, "rconfig_del", None) or []:
        session.remove_rconfig_value(r_key.strip())
    new_bytes = session.to_bytes(update_timestamp=bool(args.update_timestamp))
    verify_untouched_verbatim(session._orig_sav_bytes, new_bytes)
    info = save_sav_safely(args.sav, new_bytes, output_path=args.output,
                           force=bool(args.force))
    if args.json:
        _print_json(info)
    else:
        print(f"저장 완료: {info['target']} ({info['bytes']} bytes)")
        if info["backup"]:
            print(f"백업: {info['backup']}")
        print(f"sha256: {info['sha256']}")
    return 0


# ----------------------------------------------------------------------------
# Serve
# ----------------------------------------------------------------------------
CSP = ("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
       "img-src data: blob:; connect-src 'self'; base-uri 'none'; "
       "form-action 'none'; frame-ancestors 'none'")

LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}


def _read_html(html_path: Optional[str]) -> bytes:
    if html_path:
        return Path(html_path).read_bytes()
    dist = SCRIPT_DIR / "dist" / "JinshuSaveEditor-v1.1.html"
    if dist.is_file():
        return dist.read_bytes()
    return _bundle_html()


def _bundle_html() -> bytes:
    src = SCRIPT_DIR / "src"
    page = (src / "editor-page.html").read_text(encoding="utf-8")
    parts = []
    for name in ("catalog-data.js", "sav-codec.js", "editor-core.js", "editor-ui.js"):
        path = src / name
        if path.is_file():
            parts.append(f"<script>\n{path.read_text(encoding='utf-8')}\n</script>")
    block = "\n".join(parts)
    block = re.sub(r"</(script)", lambda m: "<\\/" + m.group(1), block, flags=re.IGNORECASE)
    start = "<!-- BUNDLE_SCRIPTS_START -->"
    end = "<!-- BUNDLE_SCRIPTS_END -->"
    if start in page and end in page:
        head, _, rest = page.partition(start)
        _, _, tail = rest.partition(end)
        return (head + start + "\n" + block + "\n" + end + tail).encode("utf-8")
    return page.encode("utf-8")


_WINDOWS_RESERVED_STEMS = (
    {"CON", "PRN", "AUX", "NUL"}
    | {f"COM{i}" for i in range(1, 10)}
    | {f"LPT{i}" for i in range(1, 10)}
)
_SAVE_NAME_RE = re.compile(r"^[\w \-.()]+\.sav$", re.IGNORECASE)


def _valid_save_name(name: str) -> bool:
    if not isinstance(name, str) or not name:
        return False
    if name != name.strip(" ."):
        return False
    if os.path.basename(name) != name:
        return False
    if "/" in name or "\\" in name or ":" in name or ".." in name or "\x00" in name:
        return False
    if not _SAVE_NAME_RE.fullmatch(name):
        return False
    stem = name.split(".", 1)[0].rstrip(" .").upper()
    if not stem or stem in _WINDOWS_RESERVED_STEMS:
        return False
    return True


def create_http_server(save_dir: Optional[str] = None, host: str = "127.0.0.1",
                       port: int = 8765, html_path: Optional[str] = None,
                       allow_remote: bool = False):
    import http.server
    import secrets
    import socketserver
    import urllib.parse

    if host not in LOOPBACK_HOSTS and not allow_remote:
        raise ValueError(f"원격 접속은 --allow-remote 없이 허용되지 않습니다: {host}")
    root = Path(save_dir) if save_dir else Path.cwd()
    html_bytes = _read_html(html_path)
    csrf_token = secrets.token_hex(16)

    class Handler(http.server.BaseHTTPRequestHandler):
        server_version = "JinshuEditor/1.0"

        def log_message(self, fmt: str, *a: Any) -> None:
            sys.stderr.write("[serve] " + (fmt % a) + "\n")

        def _headers(self, ctype: str, length: int, status: int = 200) -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(length))
            self.send_header("Content-Security-Policy", CSP)
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")
            self.send_header(
                "Vary",
                "Sec-Fetch-Dest, Sec-Fetch-Mode, Sec-Fetch-Site, Origin, Host",
            )
            self.send_header("Cache-Control", "no-store")
            self.end_headers()

        def _json(self, status: int, obj: Dict[str, Any]) -> None:
            body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self._headers("application/json; charset=utf-8", len(body), status)
            self.wfile.write(body)

        def _check_guards(self, is_api: bool, is_post: bool) -> bool:
            actual_port = self.server.server_address[1]
            if not allow_remote:
                raw_host = (self.headers.get("Host") or "").strip().lower()
                allowed_hosts = {
                    "127.0.0.1",
                    f"127.0.0.1:{actual_port}",
                    "localhost",
                    f"localhost:{actual_port}",
                    "[::1]",
                    f"[::1]:{actual_port}",
                }
                if raw_host not in allowed_hosts:
                    self._json(403, {"ok": False, "error": "허용되지 않는 Host 헤더입니다"})
                    return False

                sec_site = (self.headers.get("Sec-Fetch-Site") or "").strip().lower()
                if sec_site:
                    if is_api or is_post:
                        if sec_site not in ("same-origin", "none"):
                            self._json(403, {"ok": False, "error": "교차 사이트 요청이 차단되었습니다"})
                            return False
                    else:
                        sec_mode = (self.headers.get("Sec-Fetch-Mode") or "").strip().lower()
                        if sec_site == "cross-site" and sec_mode != "navigate":
                            self._json(403, {"ok": False, "error": "교차 사이트 요청이 차단되었습니다"})
                            return False

            if is_post:
                ctype = (self.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
                if ctype != "application/json":
                    self._json(415, {"ok": False, "error": "Content-Type은 application/json이어야 합니다"})
                    return False

                if not allow_remote:
                    origin = (self.headers.get("Origin") or "").strip().lower()
                    if origin:
                        allowed_origins = {
                            f"http://127.0.0.1:{actual_port}",
                            f"http://localhost:{actual_port}",
                            f"http://[::1]:{actual_port}",
                        }
                        if origin not in allowed_origins:
                            self._json(403, {"ok": False, "error": "허용되지 않는 Origin 헤더입니다"})
                            return False

                supplied = (self.headers.get("X-Jinshu-Token") or "").strip()
                if not supplied or not secrets.compare_digest(supplied, csrf_token):
                    self._json(403, {"ok": False, "error": "유효하지 않은 보안 토큰입니다"})
                    return False

            return True

        def do_GET(self) -> None:  # noqa: N802
            parsed = urllib.parse.urlparse(self.path)
            if not self._check_guards(is_api=parsed.path.startswith("/api/"), is_post=False):
                return
            if parsed.path in ("/", "/index.html"):
                self._headers("text/html; charset=utf-8", len(html_bytes))
                self.wfile.write(html_bytes)
                return
            if parsed.path == "/api/saves":
                names = []
                if root.is_dir():
                    for p in sorted(root.glob("*.sav")):
                        if p.is_file() and not p.is_symlink() and _valid_save_name(p.name):
                            names.append(p.name)
                self._json(200, {"ok": True, "saves": names, "csrfToken": csrf_token})
                return
            if parsed.path == "/api/load":
                qs = urllib.parse.parse_qs(parsed.query)
                name = (qs.get("name") or [""])[0]
                if not _valid_save_name(name):
                    self._json(400, {"ok": False, "error": "잘못된 파일 이름"})
                    return
                target = root / name
                try:
                    assert_no_symlinks(target)
                except PermissionError as exc:
                    self._json(400, {"ok": False, "error": str(exc)})
                    return
                if not target.is_file():
                    self._json(404, {"ok": False, "error": "파일을 찾을 수 없습니다"})
                    return
                data = target.read_bytes()
                self._json(200, {"ok": True, "name": name,
                                 "base64": base64.b64encode(data).decode("ascii"),
                                 "sha256": _sha256(data)})
                return
            self._json(404, {"ok": False, "error": "알 수 없는 경로"})

        def do_POST(self) -> None:  # noqa: N802
            parsed = urllib.parse.urlparse(self.path)
            if not self._check_guards(is_api=True, is_post=True):
                return
            if parsed.path != "/api/save":
                self._json(404, {"ok": False, "error": "알 수 없는 경로"})
                return
            try:
                length = int(self.headers.get("Content-Length") or 0)
                if length < 0 or length > 64 * 1024 * 1024:
                    raise ValueError("invalid length")
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                self._json(400, {"ok": False, "error": "JSON 본문이 잘못되었습니다"})
                return
            if not isinstance(payload, dict):
                self._json(400, {"ok": False, "error": "JSON 본문이 잘못되었습니다"})
                return
            name = payload.get("name", "")
            if not _valid_save_name(name):
                self._json(400, {"ok": False, "error": "잘못된 파일 이름"})
                return
            try:
                raw = base64.b64decode(payload.get("base64", ""), validate=True)
            except (binascii.Error, ValueError):
                self._json(400, {"ok": False, "error": "base64 디코딩 실패"})
                return
            target = root / name
            try:
                info = save_sav_safely(target, raw, force=bool(payload.get("force")))
            except PermissionError as exc:
                self._json(400, {"ok": False, "error": str(exc)})
                return
            except RuntimeError as exc:
                self._json(409, {"ok": False, "error": str(exc)})
                return
            except (ValueError, IOError, OSError) as exc:
                self._json(400, {"ok": False, "error": str(exc)})
                return
            self._json(200, {"ok": True, "name": name, "backup": info["backup"],
                             "sha256": info["sha256"]})

    class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
        daemon_threads = True
        allow_reuse_address = True

    srv = Server((host, port), Handler)
    srv.csrf_token = csrf_token
    return srv


def _cmd_serve(args: argparse.Namespace) -> int:
    server = create_http_server(save_dir=args.save_dir, host=args.host,
                                port=int(args.port), html_path=args.html,
                                allow_remote=bool(args.allow_remote))
    host, port = server.server_address[0], server.server_address[1]
    print(f"로컬 서버 실행 중: {host}:{port} (종료: Ctrl+C)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n서버를 종료합니다.")
    finally:
        server.server_close()
    return 0


# ----------------------------------------------------------------------------
# Argument parsing
# ----------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="jinshu_editor",
        description="금서군협전 세이브 에디터 (r.grp / tjm)")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("inspect", help="세이브 파일 내용 조회")
    p.add_argument("sav")
    p.add_argument("--json", action="store_true")
    p.add_argument("--char", type=int, default=None)
    p.add_argument("--inventory", action="store_true")
    p.set_defaults(func=_cmd_inspect)

    p = sub.add_parser("validate", help="세이브 파일 검증")
    p.add_argument("sav")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=_cmd_validate)

    p = sub.add_parser("presets", help="프리셋 목록")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=_cmd_presets)

    p = sub.add_parser("edit", help="세이브 파일 편집")
    p.add_argument("sav")
    p.add_argument("-o", "--output", default=None)
    p.add_argument("--force", action="store_true")
    p.add_argument("--update-timestamp", action="store_true")
    p.add_argument("--json", action="store_true")
    p.add_argument("--preset", action="append", default=[])
    p.add_argument("--gold", type=int, default=None)
    p.add_argument("--mjcz", type=int, default=None)
    p.add_argument("--sp", type=int, default=None)
    p.add_argument("--stamina", type=int, default=None)
    p.add_argument("--playthrough", type=int, default=None)
    p.add_argument("--difficulty", type=int, default=None)
    p.add_argument("--char", type=int, default=None)
    p.add_argument("--name", default=None)
    p.add_argument("--nick", default=None)
    p.add_argument("--set-stat", action="append", default=[])
    p.add_argument("--set-kungfu", action="append", default=[])
    p.add_argument("--set-miji", action="append", default=[])
    p.add_argument("--add-talent", action="append", default=[])
    p.add_argument("--remove-talent", action="append", default=[])
    p.add_argument("--open-meridians", action="store_true")
    p.add_argument("--set-item", action="append", default=[])
    p.add_argument("--remove-item", action="append", default=[])
    p.add_argument("--set-party", action="append", default=[])
    p.add_argument("--rconfig-set", action="append", default=[],
                   help="RConfig values[KEY] 안전 설정 (KEY=VALUE)")
    p.add_argument("--rconfig-del", action="append", default=[],
                   help="RConfig values[KEY] 삭제 (KEY)")
    p.set_defaults(func=_cmd_edit)

    p = sub.add_parser("serve", help="로컬 웹 편집기 실행")
    p.add_argument("--save-dir", default=None)
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--html", default=None)
    p.add_argument("--allow-remote", action="store_true")
    p.set_defaults(func=_cmd_serve)
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        return int(args.func(args) or 0)
    except (ValueError, RuntimeError, PermissionError, IOError, OSError) as exc:
        sys.stderr.write(f"오류: {exc}\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
