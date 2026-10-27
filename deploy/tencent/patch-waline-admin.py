#!/usr/bin/env python3
"""Build the immutable dc1 admin asset from the verified upstream 0.34.2 file."""

import argparse
import hashlib
from pathlib import Path

EXPECTED_SHA256 = "fb745bd9bd983a6170877861f701752304b1534b835fe72b9db12c36999c627f"
ANCHOR = b'} catch {\n\t\t\ts(e("email or password error"));'
REPLACEMENT = (
    '} catch {\n\t\t\ts(e("login flow incomplete", { defaultValue: '
    'ui.language.toLowerCase() === "zh-cn" ? "登录流程未完成，请刷新登录页后重试。" : '
    'ui.language.toLowerCase() === "zh-tw" ? "登入流程未完成，請重新整理登入頁後重試。" : '
    '"Login did not complete. Refresh the login page and try again." }));'
).encode("utf-8")


def patch_bytes(source: bytes) -> bytes:
    if hashlib.sha256(source).hexdigest() != EXPECTED_SHA256:
        raise ValueError("upstream admin SHA-256 mismatch")
    if source.count(ANCHOR) != 1:
        raise ValueError("expected exactly one login error anchor")
    return source.replace(ANCHOR, REPLACEMENT, 1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.input.resolve() == args.output.resolve():
        parser.error("input and output must be different files")
    try:
        patched = patch_bytes(args.input.read_bytes())
    except (OSError, ValueError) as error:
        parser.exit(1, f"Refusing to patch admin asset: {error}\n")
    args.output.write_bytes(patched)


if __name__ == "__main__":
    main()
