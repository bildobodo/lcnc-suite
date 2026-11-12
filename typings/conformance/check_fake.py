"""pyright only (never imported): the tests' fake satisfies the SAME interface
as the real binding's stub (package 2, Codex R352/R353 VM352-01) — a fake
command with another shape, a missing method or a wrong return type is an
error here. Its runtime counter-cases (missing / extra / keyword argument,
unknown command) are in lcnc-gateway/test_lcnc_iface.py."""
import fake_linuxcnc as fake

from lcnc_iface import CommandLike, ErrorChannelLike, IniLike, StatLike, ToolRow

stat: StatLike = fake._Stat()
command: CommandLike = fake._Command()
errors: ErrorChannelLike = fake._ErrorChannel()
ini: IniLike = fake._Ini("machine.ini")
row: ToolRow = fake._ToolRow(1, 12.5, 6.0)
