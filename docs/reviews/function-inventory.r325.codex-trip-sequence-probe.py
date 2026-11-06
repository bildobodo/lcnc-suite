"""R325: two trips and duplicate acknowledgements through one fake app session.
Run: backend-python this.py /tmp/archive /tmp/output.json
Only the reader snapshot and controller binding are fake; the poller, command
reader, status envelopes and trip identity assignment are the product code.
"""
import json
from pathlib import Path
import sys
import time

root = Path(sys.argv[1]).resolve()
assert str(root).startswith('/tmp/')
sys.path.insert(0, str(root / 'lcnc-gateway'))
from test_trip_trace import TestTheTripAndItsAcknowledgementAreTraced, TestClient, STATUS_FAMILY, _decode
import gateway
case = TestTheTripAndItsAcknowledgementAreTraced()
case.setUp()
for name in ('_last_trip_ack', '_trip_seq'):
    case.addCleanup(setattr, gateway, name, getattr(gateway, name))
gateway._last_trip_ack = None
captured = []
try:
    case.latch(False)
    with TestClient(gateway.app) as client, client.websocket_connect('/ws') as ws:
        beat = [0.0]
        def frame(until):
            end = time.monotonic() + 8
            while time.monotonic() < end:
                m = _decode(ws.receive())
                if time.monotonic() - beat[0] > .1:
                    ws.send_json({'cmd':'heartbeat'})
                    beat[0] = time.monotonic()
                if until(m):
                    return m
            raise AssertionError('no matching test frame')
        def status():
            return frame(lambda m: m.get('type') in STATUS_FAMILY)
        def note(stage, m):
            captured.append({'stage':stage, 'trip':m.get('safety_trip'), 'ack':m.get('safety_trip_acked')})
        def acknowledge():
            ws.send_json({'cmd':'safety_trip_ack'})
            r = frame(lambda m:m.get('type')=='reply' and 'cmd' not in m)
            assert r.get('ok') is True, r
        ws.send_json({'cmd':'hello','session':'r325-sequence','resume_armed':False})
        for _ in range(5): status()
        case.latch(True)
        m=frame(lambda m:m.get('type') in STATUS_FAMILY and m.get('safety_trip'))
        first=m['safety_trip']['id']; note('first-trip',m)
        acknowledge()
        m=frame(lambda m:m.get('type') in STATUS_FAMILY and m.get('safety_trip_acked',{}).get('id')==first)
        assert not m.get('safety_trip'); note('first-ack',m)
        acknowledge()
        m=status(); assert m['safety_trip_acked']['id']==first and not m.get('safety_trip'); note('duplicate-ack',m)
        case.latch(False)
        for _ in range(5): status()
        case.latch(True)
        m=frame(lambda m:m.get('type') in STATUS_FAMILY and m.get('safety_trip'))
        second=m['safety_trip']['id']
        assert first!=second and m['safety_trip_acked']['id']==first
        assert second.split('-')[0]==first.split('-')[0]
        assert int(second.split('-')[1])==int(first.split('-')[1])+1
        note('second-trip-old-ack',m)
        acknowledge()
        m=frame(lambda m:m.get('type') in STATUS_FAMILY and m.get('safety_trip_acked',{}).get('id')==second)
        assert not m.get('safety_trip'); note('second-ack',m)
        for _ in range(5):
            m=status(); assert not m.get('safety_trip') and m['safety_trip_acked']['id']==second
    result={'head':'89003ac0','passed':True,'frames':captured,'trace':case.events,'bundle_count':len(case.bundles)}
    assert result['bundle_count']==2
    Path(sys.argv[2]).write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))
finally:
    case.doCleanups()
