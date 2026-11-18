#!/usr/bin/env python3
"""Apply Hebrew translations to a checkout of the Zed source tree.

Reads a manifest that maps Rust source files (relative to --root) to JSON files
of {"English text": "Hebrew text"}. Only whole string literals that equal a key
exactly are replaced, so code, identifiers and partial strings are never touched.

The run fails if a translation key is not found in its file (the upstream text
changed) so that stale translations are noticed instead of silently skipped.
"""
import argparse
import json
import os
import re
import sys

LITERAL = re.compile(r'"((?:[^"\\]|\\.)*)"')


def apply_file(path, mapping):
    for key, value in mapping.items():
        if '"' in value or "\\" in value or "\n" in value:
            sys.exit(f"unsafe characters in translation of {key!r}")
    with open(path, encoding="utf-8") as f:
        src = f.read()
    hits = {}

    def sub(match):
        text = match.group(1)
        if text in mapping:
            hits[text] = hits.get(text, 0) + 1
            return '"' + mapping[text] + '"'
        return match.group(0)

    out = LITERAL.sub(sub, src)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(out)
    return hits


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, help="path to the Zed checkout")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--lenient", action="store_true", help="do not fail on unused keys")
    args = parser.parse_args()

    manifest_dir = os.path.dirname(os.path.abspath(args.manifest))
    with open(args.manifest, encoding="utf-8") as f:
        manifest = json.load(f)

    failed = False
    for rel_path, map_name in manifest["files"].items():
        with open(os.path.join(manifest_dir, map_name), encoding="utf-8") as f:
            mapping = json.load(f)
        hits = apply_file(os.path.join(args.root, rel_path), mapping)
        unused = [k for k in mapping if k not in hits]
        print(f"{rel_path}: replaced {sum(hits.values())} literals ({len(hits)} distinct)")
        if unused:
            print(f"  unused keys: {unused}")
            failed = failed or not args.lenient
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
