#!/bin/bash
# style-check.sh — Remind about CSS/Vue style rules before edits to .vue/.css files

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only trigger for .vue and .css files
if [[ "$FILE_PATH" =~ \.(vue|css)$ ]]; then
  jq -n --arg file "$(basename "$FILE_PATH")" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      additionalContext: ("STYLE CHECK for " + $file + ":\n• Gaps: --gap-tight(4) / --gap-controls(8) / --gap-section(12) / --gap-panel(20) — never hardcode\n• Colors: semantic vars + color-mix() — never raw hex\n• Font-size: --fs-* tokens — never hardcode px\n• Radius: --radius-* tokens — never hardcode px\n• Hover: --hl-hover/selected/pressed/active — no custom %\n• Interactive: :disabled=\"!can.<class>\" on ALL elements (except navigation)\n• Inactive: :class=\"{ inactive: !can.X }\" — never inline :style opacity\n• New pattern? WARN user before creating one-off scoped styles")
    }
  }'
else
  exit 0
fi
