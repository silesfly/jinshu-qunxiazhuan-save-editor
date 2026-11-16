import base64
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import jinshu_editor as je


class JinshuEditorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.sav = self.dir / "Save_1.sav"
        self.sav.write_bytes(je.create_demo_sav_bytes())
        self.session = je.JinshuSaveSession(self.sav.read_bytes())

    def tearDown(self):
        self.tmp.cleanup()

    def _fresh(self):
        return je.JinshuSaveSession(je.create_demo_sav_bytes())

    def test_demo_entries_and_rgrp(self):
        names = {e.name for e in self.session.entries}
        for name in ("r.grp", "s.grp", "d.grp", "a.grp", "e.grp", "tjm"):
            self.assertIn(name, names)
        self.assertEqual(len(self.session.r.buf), 1211424)
        self.assertIsInstance(self.session.r.person_offset(0), int)
        self.assertIsInstance(self.session.r.get_party(), list)
        inv = self.session.r.get_inventory()
        self.assertIsInstance(inv, list)
        for row in inv[:5]:
            self.assertIn("slot", row)
            self.assertIn("itemId", row)
            self.assertIn("count", row)

    def test_tjm_layout_and_sptf_codec(self):
        t = self.session.tjm
        self.assertEqual(len(t.basic_data), 10)
        self.assertEqual(len(t.ptf), 1001)
        self.assertEqual(len(t.sptf), 1001)
        self.assertIsInstance(t.tail_words, list)
        self.assertIsInstance(t.has_save_identity, bool)
        for key in ("itemIds", "kungfuIds", "mijiIds", "personIds"):
            self.assertIn(key, t.rconfig_meta)
            self.assertIsInstance(t.rconfig_meta[key], list)
        self.assertIsInstance(t.save_wall_time, int)
        self.assertIsInstance(t.save_create_time, int)
        raw = je.TjmData.encode_sptf(12, True)
        self.assertEqual(je.TjmData.decode_sptf(raw), (12, True))
        raw = je.TjmData.encode_sptf(7, False)
        self.assertEqual(je.TjmData.decode_sptf(raw), (7, False))

    def test_validate_and_to_bytes_roundtrip(self):
        result = self.session.validate()
        self.assertTrue(result["ok"], result["errors"])
        self.assertIsInstance(result["errors"], list)
        self.assertIsInstance(result["warnings"], list)
        data = self.session.to_bytes()
        self.assertIsInstance(data, bytes)
        other = je.JinshuSaveSession(data)
        self.assertTrue(other.validate()["ok"])

    def test_currency_setters(self):
        s = self._fresh()
        s.set_gold(123456)
        s.set_mjcz(789)
        s.set_sp(321)
        self.assertEqual(s.tjm.basic_data[0], 123456)
        self.assertEqual(s.tjm.basic_data[1], 789)
        self.assertEqual(s.tjm.basic_data[2], 321)
        self.assertTrue(s.validate()["ok"])

    def test_inventory_set_and_remove(self):
        s = self._fresh()
        inv = s.r.get_inventory()
        item_id = inv[0]["itemId"] if inv else 10001
        s.set_item(item_id, 7)
        self.assertTrue(any(
            row["itemId"] == item_id and row["count"] == 7
            for row in s.r.get_inventory()
        ))
        s.remove_item(item_id)
        self.assertFalse(any(row["itemId"] == item_id for row in s.r.get_inventory()))

    def test_person_stat_setter(self):
        s = self._fresh()
        s.set_person_stat(0, "level", 42)
        self.assertEqual(s.r.get_person(0, "level"), 42)
        self.assertTrue(s.validate()["ok"])

    def test_kungfu_miji_meridians(self):
        s = self._fresh()
        kids = s.tjm.rconfig_meta["kungfuIds"]
        mids = s.tjm.rconfig_meta["mijiIds"]
        kid = kids[0] if kids else 1
        mid = mids[0] if mids else 1
        s.set_kungfu(0, 0, kid, 5)
        s.set_miji(0, 0, mid)
        s.open_meridians(0)
        self.assertTrue(s.validate()["ok"])

    def test_party_and_talents(self):
        s = self._fresh()
        self.assertEqual(s.r.get_party()[:4], [0, 1, 2, -1])
        s.set_party_slot(3, 5)
        self.assertEqual(s.r.get_party()[3], 5)
        with self.assertRaises(ValueError):
            s.set_party_slot(4, 5)
        s.set_person_stat(5, "constitution", 5)
        s.set_person_stat(5, "level", 10)
        s.set_person_stat(5, "aptitude", 50)
        self.assertTrue(s.validate()["ok"])
        s.set_party_slot(3, -1)
        self.assertEqual(s.r.get_party()[3], -1)
        self.assertIn(102019, s.tjm.sptf[0])
        s.add_talent(0, "sptf-unequipped", 0)
        self.assertIn(100000, s.tjm.sptf[0])
        s.add_talent(0, "sptf", 0)
        self.assertIn(0, s.tjm.sptf[0])
        self.assertNotIn(100000, s.tjm.sptf[0])
        s.remove_talent(0, "sptf", 0)
        self.assertNotIn(0, s.tjm.sptf[0])
        with self.assertRaises(ValueError):
            s.add_talent(0, "ptf", 999999)
        self.assertTrue(s.validate()["ok"])

    def test_big5_field_roundtrip(self):
        buf = bytearray(16)
        self.assertTrue(je.write_big5_field(buf, 0, 8, "測試"))
        self.assertEqual(je.read_big5_field(buf, 0, 8), "測試")
        with self.assertRaises(ValueError):
            je.write_big5_field(bytearray(8), 0, 8, "測試測試A")
        with self.assertRaises(ValueError):
            je.write_big5_field(bytearray(8), 0, 8, "한글")
        s = self._fresh()
        off = s.r.person_offset(1) + je.PERSON_STRING_FIELDS["name"][0]
        je.write_big5_field(s.r.buf, off, 10, "胡斐")
        s.r.buf[off + 7:off + 10] = b"\xAA\xBB\xCC"
        s.r.set_person(0, "name", "張三豐")
        s2 = je.JinshuSaveSession(s.to_bytes())
        self.assertEqual(bytes(s2.r.buf[off + 7:off + 10]), b"\xAA\xBB\xCC")
        out = self.dir / "big5.sav"
        je.save_sav_safely(self.sav, s.to_bytes(), output_path=out, force=True)
        s3 = je.JinshuSaveSession(out.read_bytes())
        self.assertEqual(bytes(s3.r.buf[off + 7:off + 10]), b"\xAA\xBB\xCC")
        self.assertTrue(s3.validate()["ok"])

    def test_untouched_zip_rconfig_placeholders_and_remote_guard(self):
        s = self._fresh()
        before = {e.name: (e.raw_comp_bytes, e.crc32) for e in s.entries if e.name in ("s.grp", "d.grp", "a.grp", "e.grp")}
        s.set_gold(99999)
        s_reload = je.JinshuSaveSession(s.to_bytes())
        after = {e.name: (e.raw_comp_bytes, e.crc32) for e in s_reload.entries if e.name in ("s.grp", "d.grp", "a.grp", "e.grp")}
        self.assertEqual(after, before)

        jb = json.dumps({"format": 1, "extras": {"661": {"0": 661, "meta": {"nested": True}}}, "appended": {"Wugong": {"471": {"0": 471}}, "Teji": {"101": {"0": 101}}, "Person": {"756": {"0": 756}}}}, separators=(",", ":")).encode("utf-8")
        s.tjm.tail_words = [len(jb), *jb, *s.tjm.tail_words[-68:]]
        s_rc = je.JinshuSaveSession(s.to_bytes())
        self.assertEqual(s_rc.tjm.rconfig_meta, {"itemIds": [661], "kungfuIds": [471], "mijiIds": [101], "personIds": [756]})
        for kid in range(462, 471):
            with self.assertRaises(ValueError):
                s_rc.set_kungfu(0, 0, kid, 1)
        s_rc.set_kungfu(0, 2, 471, 500)
        s_rc.set_miji(0, 1, 101)
        s_rc.set_item(661, 3)
        self.assertTrue(s_rc.validate()["ok"])

        c0 = s.tjm.save_create_time
        s_ts = je.JinshuSaveSession(s.to_bytes(update_timestamp=True))
        self.assertEqual(s_ts.tjm.save_create_time, c0)

        with self.assertRaises(ValueError):
            je.create_http_server(save_dir=str(self.dir), host="0.0.0.0", port=0, allow_remote=False)

    def test_presets_apply(self):
        expected = {p["id"] for p in je.PRESETS}
        self.assertEqual(len(expected), 6)
        for preset_id in expected:
            s = self._fresh()
            je.apply_preset(s, preset_id)
            self.assertTrue(s.validate()["ok"], preset_id)
            s2 = je.JinshuSaveSession(s.to_bytes(update_timestamp=True))
            self.assertTrue(s2.validate()["ok"], preset_id)

    def test_assert_no_symlinks(self):
        self.assertIsNone(je.assert_no_symlinks(self.sav))
        link = self.dir / "link.sav"
        try:
            os.symlink(self.sav, link)
        except (OSError, NotImplementedError):
            self.skipTest("symlink unavailable")
        with self.assertRaises(PermissionError):
            je.assert_no_symlinks(link)

    def test_save_sav_safely_backup_sha(self):
        original = self.sav.read_bytes()
        original_sha = hashlib.sha256(original).hexdigest()
        new_bytes = self.session.to_bytes()
        result = je.save_sav_safely(self.sav, new_bytes, output_path=None, force=True)
        self.assertIsInstance(result, dict)
        self.assertEqual(self.sav.read_bytes(), new_bytes)
        backups = list(self.dir.glob("*.backup-*.bak"))
        self.assertTrue(backups)
        self.assertTrue(any(hashlib.sha256(p.read_bytes()).hexdigest() == original_sha
                            for p in backups))

    def test_save_sav_safely_symlink_rejected(self):
        link = self.dir / "link.sav"
        try:
            os.symlink(self.sav, link)
        except (OSError, NotImplementedError):
            self.skipTest("symlink unavailable")
        with self.assertRaises(PermissionError):
            je.save_sav_safely(link, b"x", force=True)
        parent = self.dir / "parent_link"
        try:
            os.symlink(self.dir, parent)
        except (OSError, NotImplementedError):
            self.skipTest("symlink unavailable")
        with self.assertRaises(PermissionError):
            je.save_sav_safely(parent / "new.sav", b"x", force=True)

    def test_save_sav_safely_game_running(self):
        old = os.environ.get("JSSE_SIMULATE_GAME_RUNNING")
        os.environ["JSSE_SIMULATE_GAME_RUNNING"] = "1"
        try:
            with self.assertRaises(RuntimeError):
                je.save_sav_safely(self.sav, b"x", force=False)
            je.save_sav_safely(self.sav, self.session.to_bytes(), force=True)
        finally:
            if old is None:
                os.environ.pop("JSSE_SIMULATE_GAME_RUNNING", None)
            else:
                os.environ["JSSE_SIMULATE_GAME_RUNNING"] = old

    def _start_server(self):
        server = je.create_http_server(save_dir=str(self.dir), host="127.0.0.1", port=0)
        t = threading.Thread(target=server.serve_forever, daemon=True)
        t.start()
        host, port = server.server_address[:2]
        return server, t, f"http://{host}:{port}"

    def _stop_server(self, server, t):
        server.shutdown()
        server.server_close()
        t.join(timeout=2)

    def test_http_get_root_and_saves(self):
        server, t, base = self._start_server()
        try:
            with urllib.request.urlopen(base + "/") as r:
                body = r.read()
                headers = r.headers
                self.assertEqual(r.status, 200)
                self.assertIn(b"JinshuEditorUI", body)
                self.assertTrue(headers.get("Content-Security-Policy"))
                self.assertEqual(headers.get("X-Content-Type-Options"), "nosniff")
                self.assertEqual(headers.get("X-Frame-Options"), "DENY")
                self.assertEqual(headers.get("Cross-Origin-Resource-Policy"), "same-origin")
                self.assertTrue(headers.get("Vary"))
                self.assertEqual(headers.get("Cache-Control"), "no-store")
            with urllib.request.urlopen(base + "/api/saves") as r:
                data = json.loads(r.read().decode("utf-8"))
                self.assertTrue(data["ok"])
                self.assertIn("Save_1.sav", data["saves"])
                self.assertIsInstance(data.get("csrfToken"), str)
                self.assertTrue(data["csrfToken"])
            with self.assertRaises(ValueError):
                je.create_http_server(save_dir=str(self.dir), host="0.0.0.0", port=0, allow_remote=False)
        finally:
            self._stop_server(server, t)

    def test_http_load_validation(self):
        server, t, base = self._start_server()
        try:
            with urllib.request.urlopen(base + "/api/load?name=Save_1.sav") as r:
                data = json.loads(r.read().decode("utf-8"))
                self.assertTrue(data["ok"])
                self.assertEqual(data["name"], "Save_1.sav")
                raw = base64.b64decode(data["base64"])
                self.assertEqual(hashlib.sha256(raw).hexdigest(), data["sha256"])
            for bad in (
                "../Save_1.sav",
                "sub/Save_1.sav",
                "notes.txt",
                "Save_1.sav:evil.sav",
                "CON.sav",
                "NUL.sav",
                "COM1.sav",
            ):
                try:
                    urllib.request.urlopen(base + "/api/load?name=" + urllib.parse.quote(bad)).close()
                    self.fail("expected HTTPError for " + bad)
                except urllib.error.HTTPError as e:
                    try:
                        self.assertEqual(e.code, 400)
                    finally:
                        e.close()
        finally:
            self._stop_server(server, t)

    def test_http_load_symlink_excluded(self):
        link = self.dir / "Link.sav"
        try:
            os.symlink(self.sav, link)
        except (OSError, NotImplementedError):
            self.skipTest("symlink unavailable")
        server, t, base = self._start_server()
        try:
            with urllib.request.urlopen(base + "/api/saves") as r:
                data = json.loads(r.read().decode("utf-8"))
                self.assertNotIn("Link.sav", data["saves"])
            try:
                urllib.request.urlopen(base + "/api/load?name=Link.sav").close()
                self.fail("expected HTTPError for symlink")
            except urllib.error.HTTPError as e:
                try:
                    self.assertEqual(e.code, 400)
                finally:
                    e.close()
        finally:
            self._stop_server(server, t)

    def test_http_post_save_and_backup(self):
        server, t, base = self._start_server()
        try:
            original_sha = hashlib.sha256(self.sav.read_bytes()).hexdigest()
            payload = base64.b64encode(self.session.to_bytes()).decode("ascii")
            body = json.dumps({"name": "Save_1.sav", "base64": payload, "force": False}).encode()
            req = urllib.request.Request(
                base + "/api/save",
                data=body,
                headers={"Content-Type": "application/json", "X-Jinshu-Token": server.csrf_token},
                method="POST",
            )
            with urllib.request.urlopen(req) as r:
                self.assertEqual(r.status, 200)
            backups = list(self.dir.glob("*.backup-*.bak"))
            self.assertTrue(any(hashlib.sha256(p.read_bytes()).hexdigest() == original_sha
                                for p in backups))
        finally:
            self._stop_server(server, t)

    def test_http_post_save_game_running_409(self):
        server, t, base = self._start_server()
        old = os.environ.get("JSSE_SIMULATE_GAME_RUNNING")
        os.environ["JSSE_SIMULATE_GAME_RUNNING"] = "1"
        try:
            payload = base64.b64encode(self.session.to_bytes()).decode("ascii")
            body = json.dumps({"name": "Save_1.sav", "base64": payload, "force": False}).encode()
            req = urllib.request.Request(
                base + "/api/save",
                data=body,
                headers={"Content-Type": "application/json", "X-Jinshu-Token": server.csrf_token},
                method="POST",
            )
            try:
                urllib.request.urlopen(req).close()
                self.fail("expected HTTPError 409")
            except urllib.error.HTTPError as e:
                try:
                    self.assertEqual(e.code, 409)
                finally:
                    e.close()
        finally:
            if old is None:
                os.environ.pop("JSSE_SIMULATE_GAME_RUNNING", None)
            else:
                os.environ["JSSE_SIMULATE_GAME_RUNNING"] = old
            self._stop_server(server, t)

    def test_http_security_guards(self):
        server, t, base = self._start_server()
        try:
            payload = base64.b64encode(self.session.to_bytes()).decode("ascii")
            body = json.dumps({"name": "Save_1.sav", "base64": payload, "force": False}).encode()

            def expect_status(req, code):
                try:
                    urllib.request.urlopen(req).close()
                    self.fail(f"expected HTTPError {code}")
                except urllib.error.HTTPError as e:
                    try:
                        self.assertEqual(e.code, code)
                    finally:
                        e.close()

            # 1) DNS rebinding Host rejection
            expect_status(
                urllib.request.Request(base + "/api/saves", headers={"Host": "evil.example:8765"}),
                403,
            )
            # 2) Sec-Fetch-Site cross-site rejection
            expect_status(
                urllib.request.Request(base + "/api/saves", headers={"Sec-Fetch-Site": "cross-site"}),
                403,
            )
            # 3) Content-Type enforcement (415)
            expect_status(
                urllib.request.Request(
                    base + "/api/save",
                    data=body,
                    headers={"Content-Type": "text/plain", "X-Jinshu-Token": server.csrf_token},
                    method="POST",
                ),
                415,
            )
            # 4) Missing CSRF token (403)
            expect_status(
                urllib.request.Request(
                    base + "/api/save",
                    data=body,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                ),
                403,
            )
            # 5) Wrong CSRF token (403)
            expect_status(
                urllib.request.Request(
                    base + "/api/save",
                    data=body,
                    headers={"Content-Type": "application/json", "X-Jinshu-Token": "wrong-token"},
                    method="POST",
                ),
                403,
            )
            # 6) Cross-origin Origin header (403)
            expect_status(
                urllib.request.Request(
                    base + "/api/save",
                    data=body,
                    headers={
                        "Content-Type": "application/json",
                        "Origin": "http://evil.example",
                        "X-Jinshu-Token": server.csrf_token,
                    },
                    method="POST",
                ),
                403,
            )
        finally:
            self._stop_server(server, t)

    def test_filename_and_build_url_guards(self):
        spec = importlib.util.spec_from_file_location(
            "jinshu_build_guard", Path(__file__).resolve().parents[1] / "build.py"
        )
        build = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(build)

        for bad in ("../Save_1.sav", "sub/Save_1.sav", "notes.txt", "CON.sav", "CON.foo.sav", "Lpt1.sav", "Save_1.sav:ads.sav"):
            self.assertFalse(je._valid_save_name(bad))
        self.assertTrue(je._valid_save_name("Save_1.sav"))
        self.assertTrue(je._valid_save_name("Save_1_copy.sav"))

        raw = self.session.to_bytes()
        for bad in ("notes.txt", "CON.sav", "Save_1.sav:ads.sav"):
            with self.assertRaises(ValueError):
                je.save_sav_safely(self.dir / bad, raw, force=True)

        self.assertTrue(build.has_external_url_ref("HTTPS://example.com"))
        self.assertTrue(build.has_external_url_ref("wss://x.example"))
        self.assertTrue(build.has_external_url_ref('<script src="//cdn.example/a.js"></script>'))
        self.assertTrue(build.has_external_url_ref("background:url(//cdn.example/a.png)"))
        self.assertFalse(build.has_external_url_ref("// normal JS comment"))
        self.assertFalse(build.has_external_url_ref("dist/JinshuSaveEditor-v1.0.html"))

    def test_cli_commands(self):
        presets_out = self.dir / "presets.json"
        self.assertEqual(je.main(["presets", "--json"]), 0)
        self.assertTrue(presets_out.parent.exists())
        validate_out = self.dir / "validate.json"
        self.assertEqual(je.main(["validate", str(self.sav), "--json"]), 0)
        self.assertTrue(validate_out.parent.exists())
        inspect_out = self.dir / "inspect.json"
        self.assertEqual(
            je.main(["inspect", str(self.sav), "--char", "0", "--inventory", "--json"]),
            0,
        )
        out_sav = self.dir / "edited.sav"
        self.assertEqual(
            je.main([
                "edit", str(self.sav), "--gold", "222222",
                "--output", str(out_sav), "--json",
            ]),
            0,
        )
        self.assertTrue(out_sav.exists())
        self.assertEqual(je.JinshuSaveSession(out_sav.read_bytes()).tjm.basic_data[0],
                         222222)

    def _build_full_tail_sav_bytes(self, rconfig_override=None):
        s = self._fresh()
        s.tjm.ptf[0] = [9862, 0]
        s.tjm.sptf[0] = [9862, 102019, 102020]
        rc_obj = rconfig_override if rconfig_override is not None else {
            "format": 1,
            "baseline": "6e2c2ef4f984637864ccb028d49d2629abfdbc771fcd7625bcff62851a763b88",
            "values": {"existingKey": 10},
            "extras": {"661": {"0": 661}},
            "appended": {"Wugong": {"471": {"0": 471}}, "Teji": {"101": {"0": 101}}},
        }
        rc_bytes = json.dumps(rc_obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        s.tjm.tail_words = [
            1, 2, 0, 1,
            0, 0, 0, 0, 0,
            1, 3, 4,
            3, 4, 15,
            0,
            1, 0, 1, 0, 1,
            je.NPC_PROFILE_MAGIC, 3, 0, 0,
            5, 2,
            len(rc_bytes), *rc_bytes,
            120, 1,
            je.SAVE_IDENTITY, *([0] * 66), je.SAVE_IDENTITY,
        ]
        entries = list(s.entries)
        entries.append(je._make_zip_entry("custom.bin", b"CUSTOM\x00\xffVERBATIM", compress=True))
        for e in entries:
            if e.name == je.TJM_NAME:
                je._recompress_entry(e, je.build_tjm(s.tjm))
        return je.build_zip_entries(entries)

    def test_inspect_json_7_containers_and_entry_details(self):
        full_sav = self.dir / "Save_2.sav"
        full_sav.write_bytes(self._build_full_tail_sav_bytes())
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = je.main(["inspect", str(full_sav), "--json"])
        self.assertEqual(rc, 0)
        report = json.loads(buf.getvalue())

        self.assertIn("entryDetails", report)
        detail_map = {d["name"]: d for d in report["entryDetails"]}
        for name in ("r.grp", "s.grp", "d.grp", "a.grp", "e.grp", "tjm", "custom.bin"):
            self.assertIn(name, detail_map)
            self.assertIsInstance(detail_map[name]["crc32"], int)
            self.assertGreater(detail_map[name]["uncompSize"], 0)

        c = report["containers"]
        for cname in ("PTF", "SPTF", "RConfig", "ZMWP", "傀儡", "CJApplied", "WuPinXiuLianHigh"):
            self.assertIn(cname, c)
            self.assertTrue(c[cname]["present"], cname)
            self.assertGreater(c[cname]["byteSize"], 0, cname)
            self.assertGreater(c[cname]["wordCount"], 0, cname)
            self.assertIsNotNone(c[cname]["summary"], cname)

        self.assertEqual(c["ZMWP"]["summary"]["values"], [120, 1])
        self.assertEqual(c["傀儡"]["summary"]["personId"], 5)
        self.assertEqual(c["傀儡"]["summary"]["rank"], 2)
        self.assertEqual(c["CJApplied"]["summary"]["fields"]["attack"], 1)
        self.assertEqual(c["WuPinXiuLianHigh"]["summary"]["entries"]["3"], 4)
        self.assertEqual(c["SPTF"]["summary"]["equippedCount"], 1)
        self.assertEqual(c["SPTF"]["summary"]["storedCount"], 2)

    def test_validate_containers_and_bad_rconfig(self):
        good_sav = self.dir / "Save_3.sav"
        good_sav.write_bytes(self._build_full_tail_sav_bytes())
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = je.main(["validate", str(good_sav), "--json"])
        self.assertEqual(rc, 0)
        v_good = json.loads(buf.getvalue())
        self.assertTrue(v_good["ok"], v_good["errors"])
        self.assertIn("containers", v_good)

        bad_sav = self.dir / "Save_4.sav"
        bad_sav.write_bytes(self._build_full_tail_sav_bytes(rconfig_override={
            "format": 99,
            "baseline": "base",
            "values": {},
            "extras": {},
        }))
        buf2 = io.StringIO()
        with contextlib.redirect_stdout(buf2):
            rc2 = je.main(["validate", str(bad_sav), "--json"])
        self.assertEqual(rc2, 2)
        v_bad = json.loads(buf2.getvalue())
        self.assertFalse(v_bad["ok"])
        self.assertTrue(any("RConfig" in e for e in v_bad["errors"]))

    def test_edit_rconfig_and_untouched_verbatim_roundtrip(self):
        src = self.dir / "Save_5.sav"
        out = self.dir / "Save_6.sav"
        out_del = self.dir / "Save_7.sav"
        before_bytes = self._build_full_tail_sav_bytes()
        src.write_bytes(before_bytes)

        rc = je.main([
            "edit", str(src), "-o", str(out),
            "--rconfig-set", "testKey=42",
            "--rconfig-set", 'label="hello"',
        ])
        self.assertEqual(rc, 0)
        after_bytes = out.read_bytes()

        # Verify untouched ZIP entries (including r.grp since only RConfig in tjm changed)
        verbatim = je.verify_untouched_verbatim(
            before_bytes, after_bytes,
            editable_names=(je.TJM_NAME,),
        )
        self.assertTrue(verbatim["ok"])
        for n in ("r.grp", "s.grp", "d.grp", "a.grp", "e.grp", "custom.bin"):
            self.assertIn(n, verbatim["untouched"])

        s_after = je.JinshuSaveSession(after_bytes)
        rc_obj = s_after.get_rconfig()
        self.assertEqual(rc_obj["values"]["existingKey"], 10)
        self.assertEqual(rc_obj["values"]["testKey"], 42)
        self.assertEqual(rc_obj["values"]["label"], "hello")
        c = s_after.tjm.containers
        for cname in ("PTF", "SPTF", "RConfig", "ZMWP", "傀儡", "CJApplied", "WuPinXiuLianHigh"):
            self.assertTrue(c[cname]["present"], f"{cname} lost after rconfig-set")
        self.assertEqual(c["ZMWP"]["summary"]["values"], [120, 1])
        self.assertEqual(c["傀儡"]["summary"]["personId"], 5)
        self.assertEqual(c["WuPinXiuLianHigh"]["summary"]["entries"]["3"], 4)
        self.assertTrue(s_after.tjm.has_save_identity)

        rc2 = je.main([
            "edit", str(out), "-o", str(out_del),
            "--rconfig-del", "testKey",
        ])
        self.assertEqual(rc2, 0)
        s_del = je.JinshuSaveSession(out_del.read_bytes())
        self.assertNotIn("testKey", s_del.get_rconfig()["values"])
        self.assertEqual(s_del.get_rconfig()["values"]["label"], "hello")
        self.assertEqual(s_del.tjm.containers["ZMWP"]["summary"]["values"], [120, 1])


class NodeRoundTripTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.node = shutil.which("node")
        self.catalog = self.root / "src" / "catalog-data.js"
        self.core = self.root / "src" / "editor-core.js"
        if not self.node or not self.catalog.exists() or not self.core.exists():
            self.skipTest("node or editor js files unavailable")
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        if hasattr(self, "tmp"):
            self.tmp.cleanup()

    def test_python_node_python_roundtrip(self):
        script = self.dir / "roundtrip.js"
        script.write_text(
            "const fs = require('fs');\n"
            "const Catalog = require(process.argv[2]);\n"
            "const Core = require(process.argv[3]);\n"
            "const inPath = process.argv[4];\n"
            "const outPath = process.argv[5];\n"
            "const s = Core.createSession(Catalog);\n"
            "s.loadSavBytesSync(fs.readFileSync(inPath));\n"
            "const v = s.validate();\n"
            "if (!v.ok) { throw new Error(JSON.stringify(v.errors)); }\n"
            "s.setCurrency('gold', 333333);\n"
            "s.toggleSptfEquipped(0, 0, true);\n"
            "s.setCharacterStat(0, 'level', 99);\n"
            "fs.writeFileSync(outPath, Buffer.from(s.exportSavBytesSync()));\n",
            encoding="utf-8",
        )
        in_path = self.dir / "in.sav"
        out_path = self.dir / "out.sav"
        in_path.write_bytes(je.create_demo_sav_bytes())
        subprocess.run(
            [self.node, str(script), str(self.catalog), str(self.core),
             str(in_path), str(out_path)],
            check=True,
            capture_output=True,
        )
        s = je.JinshuSaveSession(out_path.read_bytes())
        self.assertEqual(s.tjm.basic_data[0], 333333)
        self.assertEqual(s.r.get_person(0, "level"), 99)
        self.assertTrue(s.validate()["ok"])
        self.assertIn(0, s.tjm.sptf[0])
        self.assertEqual(dict(je.TjmData.decode_sptf(w) for w in s.tjm.sptf[0])[0], True)


if __name__ == "__main__":
    unittest.main()
