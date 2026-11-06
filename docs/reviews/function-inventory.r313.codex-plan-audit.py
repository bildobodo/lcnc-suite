"""R313: pure countermodels for the proposed measurement contract.
No stage-3 implementation exists yet: these are NOT failing product tests.
Usage: python3 -B plan-audit.py ARCHIVE OUT_JSON
"""
import hashlib,json,sys
from pathlib import Path
root=Path(sys.argv[1]);out={}
# Contiguous 1-ms invocation numbers, but one delayed servo invocation.
# The two observed heartbeat edges are 200 invocation intervals apart.
# Buffered receipt times can shrink their apparent interval even further.
capture=[i*.001+(.2 if i>=100 else 0) for i in range(201)]
receipt=[.5+i*.000001 for i in range(201)]
assert all(r>=c for r,c in zip(receipt,capture))
assert .2 <= .250 and capture[-1]-capture[0] > .250
out['FI313-01']={'sample_numbers':[0,200],'nominal_period_ns':1000000,
 'number_gap':False,'overrun':False,'nominal_edge_gap_ms':200,
 'actual_edge_gap_ms':round((capture[-1]-capture[0])*1000),
 'receipt_edge_gap_ms':round((receipt[-1]-receipt[0])*1000,6),
 'fault_out':False,'meaning':'A 400 ms gap can have 200 contiguous nominal 1 ms intervals and 0.2 ms of buffered receipt spacing. No number gap or latch trip distinguishes it from a passing interval.'}
# Proving motion before the gateway has expired the client is no proof of
# continued AUTO after that expiry.
stop=0.; gateway_disarm=3.05; last_motion=gateway_disarm
assert last_motion-stop>=2 and last_motion-gateway_disarm<2
out['FI313-02']={'sigstop_s':stop,'gateway_disarm_s':gateway_disarm,
 'last_motion_s':last_motion,'continues_at_least_2s_after_sigstop':True,
 'continues_2s_after_disarm':False,
 'meaning':'A regression aborting AUTO exactly at hb-stall can satisfy a two-second observation anchored to SIGSTOP. The actual expiry must be witnessed and anchor the post-window.'}
# One normal expiry, then a resumed heartbeat and a sticky latch.
out_bits=[1 if n<500 or n>=901 else 0 for n in range(2401)]
fault=[int(n>=500) for n in range(len(out_bits))]
fall=next(n for n in range(1,len(out_bits)) if out_bits[n-1] and not out_bits[n])
last_true=max(n for n,v in enumerate(out_bits) if v)
assert fall==500 and fault[fall]==1 and last_true+1==len(out_bits)
out['FI313-03']={'first_falling_edge_n':fall,'fault_at_first_fall':fault[fall],
 'resumption_n':901,'global_last_true_n':last_true,
 'sample_after_global_last_true':None,
 'meaning':'The last TRUE of the whole section is after recovery of the heartbeat, not the expiry. Recovery of the latch also needs an integrity-covered section after the pre-acknowledgement section closes.'}
paths=['scripts/test_support/servo.py','scripts/test_support/live_session.py',
       'lcnc-gateway/gateway.py','examples/sim_config/hallib/lcnc_webui.hal']
out['sources']={p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in paths}
Path(sys.argv[2]).write_text(json.dumps(out,indent=2)+'\n')
