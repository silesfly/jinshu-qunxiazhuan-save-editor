#!/usr/bin/env python3
"""Extract Jinshu Qunxiazhuan catalog data into src/catalog-data.js."""
import argparse
import json
import os
import re
import sqlite3
from pathlib import Path

GAME = "금서군협전"
VERSION = "1.07 V2.5 FIX 234"
REPO_ROOT = Path(__file__).resolve().parents[1]
DEF_DATA = os.environ.get("JINSHU_DATA_DIR", str(REPO_ROOT / "data" / "jinshu-data"))
DEF_CORPUS = os.environ.get("JINSHU_CORPUS_DIR", str(REPO_ROOT / "data" / "corpus"))
DEF_OUT = REPO_ROOT / "src/catalog-data.js"

SECTS = [
    ("강호", "江湖", "강호", "江湖"),
    ("소림사", "少林寺", "소림", "少林"),
    ("무당파", "武当派", "무당", "武当"),
    ("소요파", "逍遥派", "소요", "逍遥"),
    ("일월신교", "日月神教", "일월", "日月"),
    ("명교", "明教", "명교", "明教"),
    ("천기궁", "天机宫", "천기", "天机"),
    ("전진교", "全真教", "전진", "全真"),
    ("개방", "丐帮", "개방", "丐帮"),
    ("화산파", "华山派", "화산", "华山"),
    ("숭산파", "嵩山派", "숭산", "嵩山"),
    ("청성파", "青城派", "청성", "青城"),
    ("형산파", "衡山派", "형산", "衡山"),
    ("항산파", "恒山派", "항산", "恒山"),
    ("태산파", "泰山派", "태산", "泰山"),
    ("오독교", "五毒教", "오독", "五毒"),
    ("고묘파", "古墓派", "고묘", "古墓"),
    ("혈도문", "血刀门", "혈도", "血刀"),
    ("영소성", "灵霄城", "영소", "灵霄"),
    ("아미파", "峨眉派", "아미", "峨眉"),
    ("공동파", "崆峒派", "공동", "崆峒"),
    ("곤륜파", "昆仑派", "곤륜", "昆仑"),
    ("도화도", "桃花岛", "도화", "桃花"),
    ("백타산장", "白驼山庄", "백타", "白驼"),
    ("육선문", "六扇门", "육선", "六扇"),
    ("팔괘문", "八卦门", "팔괘", "八卦"),
    ("모용세가", "慕容世家", "모용", "慕容"),
    ("천룡사", "天龙寺", "천룡", "天龙"),
    ("성수파", "星宿派", "성수", "星宿"),
    ("밀종", "密宗", "밀종", "밀종"),
    ("장검산장", "藏剑山庄", "장검", "藏剑"),
    ("천하회", "天下会", "천하", "天下"),
]
MP_SHORT_KO = [s[2] for s in SECTS]
MP_SHORT_ZH = [s[3] for s in SECTS]
RANKS_KO = ["제자", "정예", "당주", "호법", "장로", "장문"]
RANKS_ZH = ["弟子", "精英", "堂主", "护法", "长老", "掌门"]
RANK_OVERRIDES = {
    (1, 6): ("방장", "方丈"),
    (4, 6): ("교주", "教主"),
    (5, 3): ("타주", "舵主"),
    (5, 4): ("법왕", "法王"),
    (5, 6): ("교주", "教主"),
    (6, 6): ("궁주", "宫主"),
    (7, 6): ("장교", "掌教"),
    (8, 6): ("방주", "帮主"),
    (14, 6): ("조사", "祖师"),
    (15, 6): ("교주", "教主"),
    (22, 6): ("도주", "岛主"),
    (23, 6): ("장주", "庄主"),
    (24, 6): ("총포두", "总捕头"),
    (26, 6): ("가주", "家主"),
    (27, 6): ("방장", "方丈"),
    (28, 6): ("노선", "老仙"),
    (29, 6): ("상사", "上师"),
    (30, 6): ("장주", "庄主"),
    (31, 6): ("회주", "会主"),
}

MP_T1_CHAIN = {1: 516, 2: 517, 3: 524, 4: 526, 5: 527, 6: 522, 7: 528,
               8: 519, 9: 525, 17: 518, 27: 520, 28: 521, 29: 523}
MP_STAR = [2, 2, 2, 2, 3, 3]
MP_COST = [10, 20, 30, 40, 50, 60]
ITEM_TYPES = {0: "스토리·특수", 1: "장비·신병", 2: "무공 비급", 3: "영단묘약", 4: "암기"}
EQUIP_SLOTS = {-1: "비장비", 0: "무기", 1: "방어구", 2: "탈것"}
KUNGFU_TYPES = {1: "권장", 2: "지법", 3: "검법", 4: "도법", 5: "기문", 6: "내공", 7: "경공"}
NEILI_TYPES = {0: "음(阴)", 1: "양(阳)", 2: "조화(调和)", 3: "천강(天罡)"}
GENDERS = {0: "남", 1: "여", 2: "내시"}
MERIDIAN_KO = ["수소음경", "수태음경", "수궐음경", "수소양경", "수태양경", "수양명경",
               "족소음경", "족태음경", "족궐음경", "족소양경", "족태양경", "족양명경", "임맥", "독맥"]
MERIDIAN_ZH = ["手少阴经", "手太阴经", "手厥阴经", "手少阳经", "手太阳经", "手阳明经",
               "足少阴经", "足太阴经", "足厥阴经", "足少阳经", "足太阳经", "足阳明经", "任脉", "督脉"]


def read_json(path, default=None):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default if default is not None else {}


def as_int(v, default=0):
    try:
        return int(v)
    except Exception:
        return default


def build_tr_map(data_dir):
    tr = {}
    lua_dir = data_dir / "script_decoded"
    names = ["kotrans_auto.lua", "kotrans_lines.lua", "kotrans_patch.lua",
             "kotrans_fix144.lua", "kotrans_user.lua", "kotrans.lua", "kotrans_terms.lua"]
    pair_re = re.compile(r'\[\s*"((?:\\.|[^"\\])*)"\s*\]\s*=\s*"((?:\\.|[^"\\])*)"')
    for name in names:
        p = lua_dir / name
        if not p.exists():
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for k, v in pair_re.findall(text):
            tr[k] = v
    state = data_dir / "state"
    for name in ["translations.json", "manual_translations.json", "fix233_manual_updates.json"]:
        obj = read_json(state / name, {})
        if isinstance(obj, dict):
            tr.update({str(k): str(v) for k, v in obj.items() if isinstance(v, (str, int, float))})
        elif isinstance(obj, list):
            for row in obj:
                if isinstance(row, dict):
                    k = row.get("zh") or row.get("source") or row.get("key") or row.get("original")
                    v = row.get("ko") or row.get("target") or row.get("value") or row.get("translation")
                    if k is not None and v is not None:
                        tr[str(k)] = str(v)
    return tr


def make_tr(tr_map):
    def tr(s):
        if s is None:
            return ""
        s = str(s)
        return tr_map.get(s, tr_map.get(s.replace("*", ""), s))
    return tr


def read_meta(con):
    cur = con.execute('SELECT * FROM "配置元数据"')
    rows = [dict(r) for r in cur.fetchall()]
    meta = {}
    for r in rows:
        if any(k in r for k in ("baseline_sha256", "source_sha256", "index_sha256")):
            meta.update(r)
        else:
            k = r.get("key") or r.get("name") or r.get("配置项")
            v = r.get("value") or r.get("值")
            if k is not None:
                meta[str(k)] = v
    return meta


def get_rows(con, table, cols):
    q = "SELECT " + ",".join('"%s"' % c for c in cols) + ' FROM "%s" ORDER BY "_编号"' % table
    return [dict(r) for r in con.execute(q).fetchall()]


def trim(s, n=120):
    s = "" if s is None else str(s)
    return s if len(s) <= n else s[: n - 1] + "…"


def parse_talents(data_dir, tr):
    talents = {}
    p = data_dir / "script_decoded" / "gameinfo.lua"
    if p.exists():
        text = p.read_text(encoding="utf-8", errors="ignore")
        pat = r'CC\.PTFSM\[(\d+)\]\s*=\s*\{\s*"((?:\\.|[^"\\])*)"\s*,\s*"((?:\\.|[^"\\])*)"\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)'
        for m in re.finditer(pat, text):
            tid = int(m.group(1))
            zh, desc = m.group(2), m.group(3)
            ko = tr(zh)
            talents[tid] = {"id": tid, "ko": ko, "zh": zh, "descKo": trim(tr(desc)),
                            "kind": int(m.group(4)), "ownerType": int(m.group(5)),
                            "tier": int(m.group(6)), "cost": int(m.group(7))}
    talents.setdefault(0, {"id": 0, "ko": "기본 천부 슬롯", "zh": "基础槽",
                           "descKo": "기본 주인공 초기 천부 슬롯", "kind": 0,
                           "ownerType": 1, "tier": 1, "cost": 0})
    for mp in range(1, 32):
        for lv in range(1, 7):
            if lv == 1 and mp in MP_T1_CHAIN:
                tid = MP_T1_CHAIN[mp]
            else:
                off = (lv - 2) if mp in MP_T1_CHAIN else (lv - 1)
                tid = 2001 + 6 * (mp - 1) + off
            if tid in talents:
                continue
            rank_ko, rank_zh = RANK_OVERRIDES.get((mp, lv), (RANKS_KO[lv - 1], RANKS_ZH[lv - 1]))
            ko = MP_SHORT_KO[mp] + " " + rank_ko
            zh = MP_SHORT_ZH[mp] + rank_zh
            talents[tid] = {"id": tid, "ko": ko, "zh": zh,
                            "descKo": trim(f"{ko} 천부 슬롯"), "kind": MP_STAR[lv - 1],
                            "ownerType": 1, "tier": lv, "cost": MP_COST[lv - 1]}
    return [talents[k] for k in sorted(talents)]


def read_corpus(corpus):
    ent = read_json(corpus / "ingame-entities-ko.json", {})
    atlas = read_json(corpus / "codex-atlas.json", {})
    codes = read_json(corpus / "entity-code-atlas.json", {})
    dash = read_json(corpus / "companion-dashboard.json", {})
    return ent, atlas, codes, dash


def build_code_atlas(corpus, atlas, codes, dash):
    technical = [
        {
            "key": "RGRP_7SEG",
            "summary": "Base=0/4102, Person=4102/1278x758, Thing=972826/206x661, Scene=1108992/54x169, Wugong=1118118/190x471, Shop=1207608/36x5, Teji=1207788/36x101",
        },
        {
            "key": "GOLD_174",
            "summary": 'CC.Gold in tjm BasicData[0] synced with item 174 count 0 in Base inventory when >0 and removed when ==0',
        },
        {
            "key": "MJCZ_550",
            "summary": "CC.MJCZ in tjm BasicData[1] synced with item 550 stack in Base inventory",
        },
        {
            "key": "SP_FRAGMENT",
            "summary": 'CC.Sp in tjm BasicData[2] synced with Base["碎片"] at r.grp offset 40, 0..32767',
        },
    ]

    records = []
    for rec in (codes.get("records") or [])[:24]:
        records.append(rec)

    survival = []
    for item in (dash.get("survival_checklist_6") or [])[:24]:
        if not isinstance(item, dict):
            survival.append(item)
            continue
        survival.append({
            "id": item.get("id", item.get("key")),
            "targetKo": item.get("target_ko") or item.get("targetKo") or item.get("target") or item.get("name") or "",
            "deadline": item.get("deadline"),
            "requirement": item.get("requirement"),
        })

    return {
        "technical": technical,
        "records": records,
        "survivalChecklist": survival,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--jinshu-data", default=DEF_DATA)
    ap.add_argument("--corpus-dir", default=DEF_CORPUS)
    ap.add_argument("--output", default=str(DEF_OUT))
    args = ap.parse_args()
    data_dir = Path(args.jinshu_data)
    corpus = Path(args.corpus_dir)
    db_path = data_dir / "data" / "game-config.db"
    tr_map = build_tr_map(data_dir)
    tr = make_tr(tr_map)
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    meta_cfg = read_meta(con)

    people = get_rows(con, "人物", ["_编号", "姓名", "外号", "性别", "门派", "资质", "体质"])
    items_raw = get_rows(con, "物品", ["_编号", "名称", "物品说明", "类型", "装备位置", "练出武功"])
    kf_raw = get_rows(con, "武功", ["_编号", "名称", "武功类型", "内力性质", "伤害类型"])
    mj_raw = get_rows(con, "秘技", ["_编号", "名称", "武功数量"])
    sc_raw = get_rows(con, "场景", ["_编号", "名称"])
    con.close()

    characters = []
    for r in people:
        cid = as_int(r["_编号"])
        zh = "" if r["姓名"] is None else str(r["姓名"])
        nick = "" if r["外号"] is None else str(r["外号"])
        ko = tr(zh)
        nko = tr(nick)
        if cid == 0:
            ko, zh = "소하미 (주인공)", "小蝦米"
        characters.append({
            "id": cid, "ko": ko, "zh": zh, "nickKo": nko, "nickZh": nick,
            "gender": as_int(r["性别"]), "sect": r["门派"],
            "aptitude": r["资质"], "constitution": r["体质"],
            "rconfig": cid >= 758,
        })

    items = []
    for r in items_raw:
        iid = as_int(r["_编号"])
        zh = "" if r["名称"] is None else str(r["名称"])
        desc = "" if r["物品说明"] is None else str(r["物品说明"])
        skill = "" if r["练出武功"] is None else str(r["练出武功"])
        items.append({
            "id": iid, "ko": tr(zh), "zh": zh, "descKo": trim(tr(desc)),
            "descZh": trim(desc), "type": as_int(r["类型"]),
            "slot": as_int(r["装备位置"], -1), "skillKo": tr(skill), "skillZh": skill,
            "rconfig": iid >= 756,
        })

    kungfu = []
    for r in kf_raw:
        kid = as_int(r["_编号"])
        zh = "" if r["名称"] is None else str(r["名称"])
        kungfu.append({
            "id": kid, "ko": tr(zh), "zh": zh, "type": as_int(r["武功类型"]),
            "neili": as_int(r["内力性质"]), "damageType": as_int(r["伤害类型"]),
            "placeholder": 462 <= kid <= 470, "rconfig": kid >= 471,
        })

    miji = []
    for r in mj_raw:
        mid = as_int(r["_编号"])
        zh = "" if r["名称"] is None else str(r["名称"])
        miji.append({"id": mid, "ko": tr(zh), "zh": zh,
                     "skillCount": as_int(r["武功数量"]), "rconfig": mid >= 101})

    scenes = []
    for r in sc_raw:
        sid = as_int(r["_编号"])
        if 0 <= sid <= 168:
            zh = "" if r["名称"] is None else str(r["名称"])
            scenes.append({"id": sid, "ko": tr(zh), "zh": zh})

    ent, atlas, code_atlas, dash = read_corpus(corpus)
    meridians = []
    for i in range(14):
        meridians.append({
            "id": i + 1, "ko": MERIDIAN_KO[i], "zh": MERIDIAN_ZH[i],
            "shunField": MERIDIAN_ZH[i] + "顺通", "shunOffset": 894 + i * 2,
            "niField": MERIDIAN_ZH[i] + "逆通", "niOffset": 922 + i * 2,
        })

    payload = {
        "meta": {
            "game": GAME, "version": VERSION,
            "format": meta_cfg.get("format", "sqlite"),
            "baselineSha256": meta_cfg.get("baseline_sha256", ""),
            "sourceSha256": meta_cfg.get("source_sha256", ""),
            "indexSha256": meta_cfg.get("index_sha256", ""),
            "rGrpSize": 1211424,
        },
        "sects": [{"id": i, "ko": ko, "zh": zh, "shortKo": sko, "shortZh": szh} for i, (ko, zh, sko, szh) in enumerate(SECTS)],
        "itemTypes": {str(k): v for k, v in ITEM_TYPES.items()},
        "equipSlots": {str(k): v for k, v in EQUIP_SLOTS.items()},
        "kungfuTypes": {str(k): v for k, v in KUNGFU_TYPES.items()},
        "neiliTypes": {str(k): v for k, v in NEILI_TYPES.items()},
        "genders": {str(k): v for k, v in GENDERS.items()},
        "meridians": meridians,
        "characters": characters,
        "items": items,
        "kungfu": kungfu,
        "miji": miji,
        "scenes": scenes,
        "talents": parse_talents(data_dir, tr),
        "codeAtlas": build_code_atlas(corpus, atlas, code_atlas, dash),
    }

    if isinstance(ent, dict):
        for key, rows in ent.items():
            target = payload.get("kungfu" if key == "skills" else key)
            if not isinstance(target, list) or not isinstance(rows, list):
                continue
            for i, v in enumerate(rows):
                if i < len(target) and isinstance(v, str) and v.strip():
                    if key == "characters" and isinstance(target[i], dict) and target[i].get("id") == 0:
                        continue
                    if isinstance(target[i], dict):
                        target[i]["ko"] = v.strip()

    for row in payload["items"]:
        if not isinstance(row, dict):
            continue
        if row.get("id") == 174:
            row["ko"] = "은량 (은자)"
        elif row.get("id") == 550:
            row["ko"] = "비급잔장"

    tier_by_code = {}
    for entry in (atlas.get("entries") or []):
        if not isinstance(entry, dict):
            continue
        code = entry.get("code") or entry.get("id") or entry.get("key")
        tier = entry.get("tier")
        if code is not None and tier is not None:
            tier_by_code[str(code)] = tier

    for row in payload["kungfu"]:
        if isinstance(row, dict):
            code = f"kf-{as_int(row.get('id')):03d}"
            if code in tier_by_code:
                row["tier"] = tier_by_code[code]

    for row in payload["items"]:
        if isinstance(row, dict):
            code = f"item-{as_int(row.get('id')):03d}"
            if code in tier_by_code:
                row["tier"] = tier_by_code[code]

    js = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out = (
        "(function(root,factory){"
        "if(typeof module==='object'&&module.exports){module.exports=factory();}"
        "else{root.JinshuCatalog=factory();}"
        "})(typeof self!=='undefined'?self:this,function(){"
        "return /*JINSHU_CATALOG_JSON_START*/" + js + "/*JINSHU_CATALOG_JSON_END*/;"
        "});\n"
    )
    out_path.write_text(out, encoding="utf-8")
    print(f"Wrote {out_path} ({len(out)} bytes)")


if __name__ == "__main__":
    main()