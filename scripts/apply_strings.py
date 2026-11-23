#!/usr/bin/env python3
"""Apply Hebrew translations to a checkout of the Zed source tree.

Two modes, both driven by translations/manifest.json:

* "files": {"path.rs": "map.json"}  - whole string literals equal to a key are
  replaced anywhere in that one file (used for the main menu).
* "ui_global": ["ui.he.json", ...]  - a global English->Hebrew dictionary applied
  to every non-test crates/**/*.rs file, but ONLY where the literal is the visible
  text of a UI call (Label::new("..."), Tooltip::text("..."), .entry("...") ...).
  Identifiers, comparisons, log messages and settings keys are never touched.

Every key of a global dictionary must be found at least once, otherwise the run
fails (the upstream text changed and the translation is stale). Use --lenient to
only warn.
"""
import argparse
import json
import os
import re
import sys

LITERAL = re.compile(r'"((?:[^"\\]|\\.)*)"')

HEBREW = re.compile("[\u0590-\u05ff]")
# Written as Rust escapes: rustc rejects raw bidi control characters inside string literals.
RIGHT_TO_LEFT_EMBEDDING = "\\u{202b}"
POP_DIRECTIONAL_FORMATTING = "\\u{202c}"
BIDI_WRAP = False


def finish(value):
    """Optionally wrap a Hebrew value so it lays out as a right-to-left paragraph."""
    if BIDI_WRAP and HEBREW.search(value):
        return RIGHT_TO_LEFT_EMBEDDING + value + POP_DIRECTIONAL_FORMATTING
    return value

S = r'"((?:[^"\\]|\\.)+)"'
UI_PATTERNS = [re.compile(p) for p in [
    r'Label::new\(\s*' + S + r'\s*\)',
    r'LabelLike::new\(\s*' + S,
    r'Tooltip::text\(\s*' + S,
    r'Tooltip::simple\(\s*' + S,
    r'Tooltip::for_action\(\s*' + S,
    r'Tooltip::for_action_title\(\s*' + S,
    r'Tooltip::for_action_title_in\(\s*' + S,
    r'\.(?:entry|action|toggleable_entry|custom_entry|link|header|label|submenu)\(\s*' + S,
    r'\.(?:tooltip_text|title|description|placeholder|set_placeholder_text|label_text|tooltip)\(\s*' + S,
    r'Button::new\(\s*"[^"]*"\s*,\s*' + S,
    r'(?:primary_action_label|secondary_action_label|tooltip_label):\s*' + S + r'\.into\(\)',
    r'ToggleButtonSimple::new\(\s*' + S,
    r'(?<![A-Za-z_])(?:title|description|label|header|placeholder|summary):\s*' + S + r'\.into\(\)',
    r'(?<![A-Za-z_])(?:title|description|label|header):\s*' + S,
]]


# `.header(...)` is also the HTTP request builder; these are protocol names, never UI text.
HTTP_HEADER_NAMES = {"Authorization", "Accept", "Location", "Content-Type", "User-Agent", "Cookie"}


def is_http_header(match):
    return ".header(" in match.group(0)[: match.start(1) - match.start()] and match.group(1) in HTTP_HEADER_NAMES


def is_test_path(path):
    p = path.replace("\\", "/")
    return ("/tests/" in p or "/benches/" in p or "/examples/" in p
            or "/fixtures/" in p or "/evals/" in p
            or p.endswith(("_tests.rs", "_test.rs")) or "/test/" in p)


def check_safe(mapping, name):
    for key, value in mapping.items():
        if '"' in value or "\\" in value or "\n" in value:
            sys.exit(f"unsafe characters in translation of {key!r} ({name})")


def apply_literal_file(path, mapping):
    with open(path, encoding="utf-8") as f:
        src = f.read()
    hits = {}

    def sub(match):
        text = match.group(1)
        if text in mapping:
            hits[text] = hits.get(text, 0) + 1
            return '"' + finish(mapping[text]) + '"'
        return match.group(0)

    out = LITERAL.sub(sub, src)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(out)
    return hits


def apply_ui_file(path, mapping, hits):
    with open(path, encoding="utf-8") as f:
        src = f.read()
    spans = []
    for pat in UI_PATTERNS:
        for m in pat.finditer(src):
            text = m.group(1)
            if is_http_header(m):
                continue
            if text in mapping:
                spans.append((m.start(1), m.end(1), text))
    if not spans:
        return
    spans.sort()
    out, last = [], 0
    for start, end, text in spans:
        if start < last:  # overlapping match from another pattern
            continue
        out.append(src[last:start])
        out.append(finish(mapping[text]))
        last = end
        hits[text] = hits.get(text, 0) + 1
    out.append(src[last:])
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write("".join(out))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, help="path to the Zed checkout")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--lenient", action="store_true", help="do not fail on unused keys")
    parser.add_argument("--bidi-wrap", action="store_true",
                        help="wrap every Hebrew string in RLE..PDF so neutrals and embedded English order correctly")
    args = parser.parse_args()
    global BIDI_WRAP
    BIDI_WRAP = args.bidi_wrap

    manifest_dir = os.path.dirname(os.path.abspath(args.manifest))
    with open(args.manifest, encoding="utf-8") as f:
        manifest = json.load(f)

    failed = False
    for rel_path, map_name in manifest.get("files", {}).items():
        with open(os.path.join(manifest_dir, map_name), encoding="utf-8") as f:
            mapping = json.load(f)
        check_safe(mapping, map_name)
        hits = apply_literal_file(os.path.join(args.root, rel_path), mapping)
        unused = [k for k in mapping if k not in hits]
        print(f"{rel_path}: replaced {sum(hits.values())} literals ({len(hits)} distinct)")
        if unused:
            print(f"  unused keys: {unused}")
            failed = failed or not args.lenient

    for map_name in manifest.get("ui_global", []):
        with open(os.path.join(manifest_dir, map_name), encoding="utf-8") as f:
            mapping = json.load(f)
        check_safe(mapping, map_name)
        hits = {}
        for d, _, files in os.walk(os.path.join(args.root, "crates")):
            for name in files:
                path = os.path.join(d, name)
                if name.endswith(".rs") and not is_test_path(path):
                    apply_ui_file(path, mapping, hits)
        unused = [k for k in mapping if k not in hits]
        print(f"{map_name}: replaced {sum(hits.values())} UI strings ({len(hits)}/{len(mapping)} keys used)")
        if unused:
            print(f"  unused keys ({len(unused)}): {unused[:40]}")
            failed = failed or not args.lenient

    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
