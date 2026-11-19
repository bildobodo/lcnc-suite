#!/usr/bin/env python3
"""Prototype edits (never committed): common fixes + variant A (tool compact) or B (spacing)."""
import sys, pathlib, re
root = pathlib.Path(sys.argv[1]); variant = sys.argv[2]
def sub(rel, old, new, count=1):
    p = root / rel; s = p.read_text()
    assert old in s, (rel, old[:60]); p.write_text(s.replace(old, new, count))
# common 1: the fade adds no gap
sub('src/App.vue', "  z-index: var(--z-raised);\n}\n.strip > .stripFade { right: 0; }",
    "  z-index: var(--z-raised);\n  margin-inline-start: calc(-1 * var(--strip-gap, var(--gap-controls)));\n}\n.strip > .stripFade { right: 0; }")
# common 2: a checked option keeps its width
sub('src/ChoiceGroup.vue', ':checked="o.value === modelValue"', ':data-label="o.label" :checked="o.value === modelValue"')
sub('src/style.css', ".choice.pending {", ".choice[data-label]::after { content: attr(data-label); display: block; height: 0; overflow: hidden; visibility: hidden; font-weight: var(--fw-semibold); }\n.choice.pending {")
# common 3: the step select never sizes the column
sub('src/JogStrip.vue', ".stepSizer {", ".stepBlock > select { width: 0; min-width: 100%; }\n.stepSizer {")
if variant == 'A':
    sub('src/style.css', "  --key-action-w: 70px;", "  --key-action-w: 70px;\n  --strip-tool-w: 224px;")
    sub('src/ToolStrip.vue', "<style scoped>\n", "<style scoped>\n@media (orientation: landscape) { .toolStrip { width: var(--strip-tool-w); } }\n")
    s = (root/'src/ToolStrip.vue').read_text()
    old = re.search(r'<div class="statusRow"><span class="label-muted md">Z Offset</span>.*?</span></span></div>', s, re.S).group(0)
    new = ('<div class="statusRow"><span class="label-muted md">Z Offset</span><span class="val-status md mono">{{ fmtQty(toolLength, linearUnit) }}</span></div>\n'
           '        <div class="statusRow"><span class="label-muted md">In effect</span><span data-tool-offset class="val-status md" :class="{ warn: offsetWarn }">{{ offsetWord ?? NO_VALUE }}</span></div>')
    (root/'src/ToolStrip.vue').write_text(s.replace(old, new))
elif variant == 'B':
    sub('src/App.vue', ".strip > * + * {\n  border-left: 1px solid var(--border-subtle);\n  padding-left: var(--gap-controls);",
        ".strip > * + * {\n  border-left: 1px solid var(--border-subtle);\n  padding-left: var(--gap-tight);")
    sub('src/App.vue', "  padding: var(--gap-controls) var(--gap-controls) var(--gap-controls) 0;\n  gap: var(--gap-controls);",
        "  padding: var(--gap-controls) var(--gap-controls) var(--gap-controls) 0;\n  gap: var(--gap-tight);\n  --strip-gap: var(--gap-tight);")
    sub('src/JogStrip.vue', '<div class="jogContent row-sections">', '<div class="jogContent row-sections" style="column-gap: var(--gap-controls)">')
    sub('src/JogStrip.vue', '<div ref="jogBtnsRef" class="jogBtns row-sections">', '<div ref="jogBtnsRef" class="jogBtns row-sections" style="column-gap: var(--gap-controls)">')
    sub('src/OverridesStrip.vue', '<div class="ovrSection row-sections strip-slider-group">', '<div class="ovrSection row-sections strip-slider-group" style="column-gap: var(--gap-controls)">')
    sub('src/SetupStrip.vue', "  grid-template-columns: max-content max-content;", "  grid-template-columns: max-content max-content;\n  column-gap: var(--gap-controls);")
print('applied', variant)
