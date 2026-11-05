"""R300: counterexamples to the written plan, not sampler/product tests.

Pure stdlib; no HAL, LinuxCNC, sockets, or machine commands.
python3 -B function-inventory.r300.codex-reasoning.py
"""
import json

T = 0.001
BOUND = 50**2 / (2*750) + 2*50*4*T


def first_block(rows, after):
    for i in range(after+1, len(rows)-9):
        block = rows[i:i+10]
        if all(x['v'] == 0 for x in block) and max(x['p'] for x in block)-min(x['p'] for x in block) <= 0.001:
            return i
    return None


def base_row(n, sign=1):
    tau = min(n*T, 50/750)
    return {'n':n, 'p':314+sign*(50*tau-750*tau*tau/2),
            'v':sign*max(50-750*n*T,0)}


# The configured/printed period is still 1 ms and every sample number is
# consecutive, yet one scheduling delay inserts 480 ms of elapsed time.
# The delay is before the first stopped sample; receipt is causally later.
rows = [base_row(n) for n in range(201)]
for row in rows:
    row['capture_s'] = row['n']*T + (0.480 if row['n'] >= 20 else 0)
    row['receipt_s'] = row['capture_s']+0.00001
anchor, reply = 0, 0.0001
stop = first_block(rows, anchor)
by_number = (rows[stop]['n']-rows[anchor]['n'])*T
actual = rows[stop]['capture_s']-reply
receipt = rows[stop]['receipt_s']-reply
assert rows[anchor]['receipt_s'] < reply
assert by_number <= .5 < actual <= receipt
assert all(b['n']==a['n']+1 for a,b in zip(rows,rows[1:]))
clock_case = {'configured_period_s':T,'number_gap':rows[stop]['n'],
              'nominal_n_times_T_s':by_number,'capture_after_reply_s':actual,
              'receipt_after_reply_s':receipt,'numbers_consecutive':True,
              'enable_at_both_edges':True,'overruns':0,
              'rule_5a':receipt<=.5,'rule_5b':by_number<=.5,
              'required':'No PASS from 5b: nominal invocation count is not an elapsed-time upper bound.'}

# A stop lasts >10 samples, followed by a small forward restart and a
# second stop. Looking only AFTER the last moving sample picks the latter
# and makes the later-restart test vacuous. Mirror both jog directions.
restart_cases = []
for sign in (1,-1):
    rows = [base_row(n, sign) for n in range(201)]
    extra = 0.
    for row in rows:
        n = row['n']
        if 100 <= n < 120:
            speed = min(.5*(n-99),.5*(120-n),2.)
            extra += speed*T
            row['v'] = sign*speed
        if n >= 100:
            row['p'] += sign*extra
    earliest = first_block(rows, 0)
    last_moving = max(i for i,r in enumerate(rows) if r['v'] != 0)
    after_last = first_block(rows, last_moving)
    witnessed_restart = next(i for i,r in enumerate(rows) if i>earliest+9 and r['v'] != 0)
    upper = max(sign*(r['p']-rows[0]['p']) for r in rows)
    assert earliest < witnessed_restart < after_last
    assert upper < BOUND and after_last*T < .5
    assert not any(r['v'] != 0 for r in rows[after_last:])
    assert all(sign*(b['p']-a['p']) >= -1e-9 for a,b in zip(rows,rows[1:]))
    restart_cases.append({'sign':sign,'first_confirmed_stop_sample':earliest,
                          'restart_sample':witnessed_restart,'last_moving_sample':last_moving,
                          'stop_if_selected_after_last_move':after_last,'brake_upper_mm':upper,
                          'pre_reply_signed_travel_mm':14.,'bound_mm':BOUND,
                          'restart_after_selected_final_stop':False,
                          'required':'FAIL: latch the first confirmed stop, then reject this restart.'})

# enable checked only at the edges cannot show what happened between them.
# A disabled sampler writes no sample; IDs may remain consecutive while
# the servo and the machine continue running.
enable_case = {'enable_at_start':True,'enable_at_end':True,
               'observed_sample_numbers':[0,1,2,3],
               'observed_servo_invocations':[0,1,7,8],
               'hidden_disabled_invocations':[2,3,4,5,6],
               'overruns':0,
               'required':'Need a no-disable ownership invariant or independent continuity witness; two reads do not prove it.'}

print(json.dumps({'model_only':True,'clock_case':clock_case,
                  'restart_cases':restart_cases,'enable_case':enable_case},indent=2))
