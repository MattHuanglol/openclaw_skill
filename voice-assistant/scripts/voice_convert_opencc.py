#!/usr/bin/env python3
"""voice_convert_opencc.py

Best-effort Chinese conversion to Traditional (s2t) using OpenCC.

Usage:
  echo "text" | python voice_convert_opencc.py

Output:
  converted text to stdout (no JSON)

If OpenCC is not available, it outputs the input unchanged.
"""

import sys

try:
    from opencc import OpenCC  # type: ignore
except Exception:
    OpenCC = None


def main():
    text = sys.stdin.read()
    if not text:
        return

    if OpenCC is None:
        sys.stdout.write(text)
        return

    try:
        cc = OpenCC("s2t")
        sys.stdout.write(cc.convert(text))
    except Exception:
        sys.stdout.write(text)


if __name__ == "__main__":
    main()
