"""Apply text substitutions, failing loudly if a pattern doesn't match."""
import sys
def apply(path, subs):
    s = open(path).read()
    for old, new in subs:
        if old not in s:
            print("PATCH FAILED in %s — pattern not found:\n---\n%s\n---" % (path, old[:220]))
            sys.exit(1)
        if s.count(old) > 1:
            print("PATCH AMBIGUOUS in %s — %d matches:\n%s" % (path, s.count(old), old[:160]))
            sys.exit(1)
        s = s.replace(old, new)
    open(path, 'w').write(s)
    print("patched %s (%d substitutions)" % (path, len(subs)))
