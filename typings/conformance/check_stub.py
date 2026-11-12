"""pyright only (never imported): the stub of the REAL binding satisfies the
interface the code needs — typings/linuxcnc.pyi against lcnc_iface's Protocols
(package 2, Codex R352/R353 VM352-01). A member the stub lacks or types
differently is an error here."""
import linuxcnc

from lcnc_iface import CommandLike, ErrorChannelLike, IniLike, StatLike, ToolRow


def stub_conforms(s: linuxcnc.stat, c: linuxcnc.command, e: linuxcnc.error_channel,
                  i: linuxcnc.ini, t: linuxcnc.tool) -> None:
    stat: StatLike = s
    command: CommandLike = c
    errors: ErrorChannelLike = e
    ini: IniLike = i
    row: ToolRow = t
    del stat, command, errors, ini, row
