#!/usr/bin/env python3
"""Prototype (never committed): portrait keys take equal shares of the strip column."""
import sys, pathlib
root = pathlib.Path(sys.argv[1])
def sub(rel, old, new, count=1):
    p = root / rel; s = p.read_text()
    assert s.count(old) >= count, (rel, old[:70], s.count(old)); p.write_text(s.replace(old, new, count))
T = "repeat(5, minmax(var(--key-size), 1fr))"
sub('src/NumberKeypadStrip.vue', "  .nkGrid { grid-template-columns: repeat(5, var(--key-size)); }", f"  .nkGrid {{ grid-template-columns: {T}; }}")
s = (root/'src/TextKeypadStrip.vue').read_text()
head, port = s.split("@media (orientation: portrait) {", 1)
port = port.replace("grid-template-columns: repeat(5, var(--key-size));", f"grid-template-columns: {T};")
(root/'src/TextKeypadStrip.vue').write_text(head + "@media (orientation: portrait) {" + port)
print('applied K', port.count(T))
