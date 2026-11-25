"""R478 plan predicates only; ToolLoadDialog has not been implemented."""
import json

# Section 2.4 has an unqualified requested/unconfirmed row, even though an
# external change may make the current file un-loadable during the wait.
requested = True
unconfirmed = 'file changed'
load_refusal = 'Line 1 too long for LinuxCNC — shorten it in an editor'

# Section 2.3 names next load/write, another path and an incomplete read as
# reasons to end a confirmed slot, but not a changed owner at the same path.
previous = dict(path='/same/tool.tbl', owner='A', loaded_seq=2)
now = dict(path='/same/tool.tbl', owner='B', state='complete', loaded=None)
next_load_or_write = False
clear_by_written_rules = (next_load_or_write or previous['path'] != now['path']
                         or now['state'] != 'complete')
print(json.dumps({'kind':'plan models, not product code','cases':[
    {'case':'unconfirmed load followed by a malformed current file',
     'requested':requested,'why':unconfirmed,'load_refusal':load_refusal,
     'matching_write_note_rows':['file not loadable','this page requested a load since, not confirmed'],
     'unqualified_requested_text':'Table saved, load requested but not confirmed — a restart loads it.'},
    {'case':'confirmed display slot, then another owner at the same path',
     'previous':previous,'now':now,'clear_by_written_rules':clear_by_written_rules,
     'valid_current_load_record':False}
]},indent=2))
