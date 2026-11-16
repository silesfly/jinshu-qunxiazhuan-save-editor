#!/usr/bin/env python3
"""Build script for Jinshu Qunxiazhuan Save Editor v1.1.

Produces:
    dist/JinshuSaveEditor-v1.1.html   (always)
    dist/JinshuSaveEditor-v1.1.exe    (when --exe + --webview2 are supplied)

The HTML bundle is fully offline: no http:// or https:// references may
survive the bundling step, and every script is inlined via <script> blocks.
"""

import argparse
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "src")
DIST = os.path.join(ROOT, "dist")

HTML_IN = os.path.join(SRC, "editor-page.html")
HTML_OUT = os.path.join(DIST, "JinshuSaveEditor-v1.1.html")
EXE_OUT = os.path.join(DIST, "JinshuSaveEditor-v1.1.exe")

SCRIPT_ORDER = ("catalog-data.js", "sav-codec.js", "editor-core.js", "editor-ui.js")
BUNDLE_START = "<!-- BUNDLE_SCRIPTS_START -->"
BUNDLE_END = "<!-- BUNDLE_SCRIPTS_END -->"

CSC = "C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe"

REQUIRED_SDK_FILES = (
    "Microsoft.Web.WebView2.Core.dll",
    "Microsoft.Web.WebView2.WinForms.dll",
    "WebView2Loader.dll",
    "LICENSE.txt",
)


def _read_text(path):
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def _write_text(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def _escape_script_close(js):
    return re.sub(r"</(script)", lambda m: "<\\/" + m.group(1), js, flags=re.IGNORECASE)


def _inline_script(name):
    js = _read_text(os.path.join(SRC, name))
    js = _escape_script_close(js)
    return "<script>\n" + js + "\n</script>"


EXTERNAL_REF_RE = re.compile(
    r'(?i)\b(?:https?|ftp|wss?)://|\b(?:src|href|action|poster|data|cite)\s*=\s*["\']?\s*//|\burl\(\s*["\']?\s*(?:https?|ftp|wss?)?//'
)


def has_external_url_ref(html_text):
    if not isinstance(html_text, str):
        return False
    return EXTERNAL_REF_RE.search(html_text) is not None


def build_html():
    html = _read_text(HTML_IN)
    start = html.find(BUNDLE_START)
    if start < 0:
        raise SystemExit("bundle marker not found: " + BUNDLE_START)
    end = html.find(BUNDLE_END, start)
    if end < 0:
        raise SystemExit("bundle marker not found: " + BUNDLE_END)
    end += len(BUNDLE_END)

    blocks = [_inline_script(name) for name in SCRIPT_ORDER]
    bundle = "\n".join(blocks)

    out_html = html[:start] + bundle + html[end:]

    if has_external_url_ref(out_html):
        raise SystemExit("bundled HTML still contains an external URL reference")

    _write_text(HTML_OUT, out_html)
    print("wrote " + HTML_OUT)
    return out_html


def _require_sdk_file(folder, name):
    path = os.path.join(folder, name)
    if not os.path.isfile(path):
        raise SystemExit("missing WebView2 SDK file: " + path)
    return path


def _resolve_netfx_ref(name):
    base = "C:/Windows/Microsoft.NET/Framework64/v4.0.30319"
    candidate = os.path.join(base, name)
    if os.path.isfile(candidate):
        return candidate
    return name


def build_exe(webview2_dir):
    webview2_dir = os.path.abspath(webview2_dir)
    if not os.path.isdir(webview2_dir):
        raise SystemExit("WebView2 SDK folder does not exist: " + webview2_dir)

    sdk_paths = {}
    for name in REQUIRED_SDK_FILES:
        sdk_paths[name] = _require_sdk_file(webview2_dir, name)

    if not os.path.isfile(HTML_OUT):
        build_html()

    sources = [os.path.join(SRC, "SaveStore.cs"), os.path.join(SRC, "SaveEditor.cs")]
    for src in sources:
        if not os.path.isfile(src):
            raise SystemExit("missing source file: " + src)

    out_dir = os.path.dirname(EXE_OUT)
    if out_dir and not os.path.isdir(out_dir):
        os.makedirs(out_dir)

    args = [
        CSC,
        "/nologo",
        "/target:winexe",
        "/platform:x64",
        "/optimize+",
        "/debug-",
        "/out:" + EXE_OUT,
        "/reference:" + _resolve_netfx_ref("System.Windows.Forms.dll"),
        "/reference:" + _resolve_netfx_ref("System.Drawing.dll"),
        "/reference:" + _resolve_netfx_ref("System.Web.Extensions.dll"),
        "/reference:" + sdk_paths["Microsoft.Web.WebView2.Core.dll"],
        "/reference:" + sdk_paths["Microsoft.Web.WebView2.WinForms.dll"],
        "/resource:" + sdk_paths["Microsoft.Web.WebView2.Core.dll"] + ",Microsoft.Web.WebView2.Core.dll",
        "/resource:" + sdk_paths["Microsoft.Web.WebView2.WinForms.dll"] + ",Microsoft.Web.WebView2.WinForms.dll",
        "/resource:" + sdk_paths["WebView2Loader.dll"] + ",WebView2Loader.dll",
        "/resource:" + sdk_paths["LICENSE.txt"] + ",WebView2-LICENSE.txt",
        "/resource:" + HTML_OUT + ",editor.html",
    ]
    args.extend(sources)

    print(" ".join(args))
    completed = subprocess.call(args, cwd=ROOT)
    if completed != 0:
        raise SystemExit("csc.exe failed with exit code " + str(completed))

    if not os.path.isfile(EXE_OUT):
        raise SystemExit("csc.exe did not produce " + EXE_OUT)

    print("wrote " + EXE_OUT)


def main(argv):
    parser = argparse.ArgumentParser(description="Build Jinshu Qunxiazhuan Save Editor v1.1")
    parser.add_argument("--exe", action="store_true", help="also compile the Windows exe")
    parser.add_argument("--webview2", default=None, help="path to the WebView2 SDK folder")
    args = parser.parse_args(argv)

    build_html()

    if args.exe:
        if not args.webview2:
            raise SystemExit("--exe requires --webview2 <Path>")
        build_exe(args.webview2)

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
