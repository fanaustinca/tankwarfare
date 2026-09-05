#!/bin/bash
# Syntax-check every ES module in js/ (node --check needs .mjs for ESM)
cd ~/tankwarfare
fail=0
tmp=$(mktemp -d)
for f in js/*.js; do
  cp "$f" "$tmp/$(basename $f .js).mjs"
  if ! node --check "$tmp/$(basename $f .js).mjs" 2>"$tmp/err"; then
    echo "✗ $f"; head -12 "$tmp/err"; fail=1
  fi
done
rm -rf "$tmp"
[ $fail -eq 0 ] && echo "✓ all modules parse cleanly"
exit $fail
