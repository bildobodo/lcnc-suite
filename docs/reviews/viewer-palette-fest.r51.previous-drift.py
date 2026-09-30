def evaluate_tlo_drift(meta, cur_mtime, tool_number, applied_tlo_z, eps=1e-4,
                       table_rows=None, table_only=False):
    """Has the tool-length picture moved since the preview was parsed? (W2 P4)

    The per-line limit validator bakes the PARSE-TIME tool table into its
    flags; a toolsetter re-measure afterwards leaves them stale (live
    defect: 11,532 false Z-max flags after tool_touch_off re-measured
    156.56 → 56.63 mm). Two drift signals, first hit wins:

    - "table_mtime": the tool-table FILE changed since the parse snapshot
      (G10 L1 writes through to disk) — the broad signal, catches every
      tool.
    - "tool_offset": the APPLIED offset now differs from the applied offset
      the parse was SEEDED with (`meta["applied_tlo"]`, TWP-09 — like with
      like: a `G43 H7` with T3 loaded, or a `G43.1`, never matched T3's
      table row and reparsed every debounce interval forever). A G49 after
      the parse is one honest drift, then the fresh meta settles. Legacy
      meta without the key keeps the row comparison, guarded to a loaded
      tool with a non-trivially-applied offset (G49 ≠ drift there).
    - "tool_loaded": a different tool is in the spindle than at parse time
      (`meta["loaded_tool"]`).

    - "table_row": a parse row for ANY tool the program touches differs
      from the live table's Z for that id (schema 8: the per-segment TLO
      the sim poses with comes from the parse-time rows, so a re-measure
      of a NOT-loaded program tool stales the pose too). `table_rows`
      = [(id, zoffset), ...] from STAT.tool_table; None = skip (legacy).

    `table_only` (the mid-run edge, operator 2026-09-29): only the TABLE
    signals — `table_mtime` and `table_row`. Mid-run the applied offset and
    the loaded tool are the PROGRAM's own state (its G43, its M6), never a
    drift of the start state the payload was seeded with.

    `meta` is the worker's parse-time snapshot {"table_mtime": float|None,
    "tlos": [[tool, xo, yo, zo(, diameter)], ...]}. Returns the reason
    string or None. The CALLER owns idle-gating and debounce. Pure.
    """
    if not meta:
        return None
    m0 = meta.get("table_mtime")
    if m0 is not None and cur_mtime is not None and cur_mtime != m0:
        return "table_mtime"
    applied_then = meta.get("applied_tlo")
    if table_only:
        pass
    elif applied_then is not None:
        try:
            z_then = float(applied_then[2])
        except (TypeError, IndexError, ValueError):
            z_then = None
        if (z_then is not None and applied_tlo_z is not None
                and abs(float(applied_tlo_z) - z_then) > eps):
            return "tool_offset"
        loaded_then = meta.get("loaded_tool")
        if (loaded_then is not None and tool_number is not None
                and int(loaded_then) != int(tool_number)):
            return "tool_loaded"
    elif tool_number and applied_tlo_z is not None and abs(applied_tlo_z) > eps:
        for row in meta.get("tlos") or []:
            if row and row[0] == tool_number:
                if abs(float(row[3]) - applied_tlo_z) > eps:
                    return "tool_offset"
                break
    if table_rows:
        live = {}
        for tid, z in table_rows:
            try:
                live.setdefault(int(tid), float(z))
            except (TypeError, ValueError):
                continue
        for row in meta.get("tlos") or []:
            if not row:
                continue
            lz = live.get(int(row[0]))
            if lz is not None and abs(float(row[3]) - lz) > eps:
                return "table_row"
    return None
