#!/usr/bin/env python3
"""Print a user service for explicit installation by the operator."""
import argparse
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--profile', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
def escape(value):
    return str(value).replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%').replace('$', '$$')
text = (root/'deploy/wiki.service.in').read_text()
print(text.replace('@PROFILE@', escape(Path(args.profile).expanduser().resolve()))
          .replace('@SOURCE@', escape(root)), end='')
