"""R516 plan countermodels and positive controls; no product imports.

The source premises are recorded separately. These model proposed contracts,
not a built implementation, an actual browser, or a LinuxCNC session.
"""
import itertools
import json


def settings_models():
    # Top-of-loop reconcile is independent of the earlier controller branches.
    delivery = [{'link': link, 'new_pub': fresh, 'settings_sent': True}
                for link, fresh in itertools.product([False, True], repeat=2)]
    # ON read at v5, OFF commits while send yields. Only pre-read v5 is booked.
    race = {'read_version': 5, 'read_view': 'ON', 'store_after_send': 6,
            'booked_version': 5, 'next_reconcile_owed': True}
    assert race['store_after_send'] != race['booked_version']
    # ws_send_measured also returns zero on RuntimeError WITHOUT scheduling close.
    failure = {'send_case': 'RuntimeError', 'bytes': 0, 'close_scheduled': False,
               'status_task_done': True, 'reader_still_waiting': True, 'connection_closed': False}
    return {'top_of_loop_controls': delivery, 'version_race_control': race,
            'zero_bytes_is_not_closed': failure}


def visibility_models():
    selected = {'pub_gen': 10, 'interp': 'IDLE', 'selected_in_epoch': 4}
    # Existing status_loop may await viewer_init before building the envelope.
    client_epoch = 6  # hide(epoch5), controller starts, show(epoch6) during await
    current_pub = {'pub_gen': 11, 'interp': 'AUTO'}
    stamped = {**selected, 'vis_epoch': client_epoch}
    literal_qualified = stamped['vis_epoch'] == client_epoch
    frozen_pair_qualified = selected['selected_in_epoch'] == client_epoch
    assert literal_qualified and not frozen_pair_qualified
    return {'selected_before_await': selected, 'current_when_envelope_built': current_pub,
            'late_epoch_stamp': stamped, 'literal_gate_accepts_old_idle': literal_qualified,
            'captured_epoch_gate_rejects': not frozen_pair_qualified,
            'new_snapshot_control': {'pub_gen': 12, 'interp': 'AUTO', 'vis_epoch': 6}}


def word_predicate(e, x, words, end_recv=None):
    words = [w for w in words if w['issue'] >= e and w['recv'] <= x]
    if not words or words[0]['recv'] - e > 1000:
        return False
    if any(b['recv'] - a['issue'] > 1000 for a,b in zip(words, words[1:])):
        return False
    return (x - words[-1]['issue'] <= 1000 or
            (end_recv is not None and e <= end_recv <= x and end_recv - words[-1]['issue'] <= 1000))


def phase_models():
    healthy = [{'issue': i, 'recv': i+100} for i in range(1000, 10000, 200)]
    assert word_predicate(1000, 10000, healthy)
    old_edges = [{'issue': 9770, 'recv': 9800}, {'issue': 9870, 'recv': 9900}]
    old_bunched = [{'issue': 50, 'recv': 4800}, {'issue': 150, 'recv': 4900}]
    assert not word_predicate(0, 10000, old_edges)
    assert not word_predicate(0, 5000, old_bunched)
    # The final slice starts after tick900 but ends INSIDE [1000,10000].
    # The plan excludes this shard merely because that tick was issued before E.
    late_end = {'tick_issued': 900, 'slice_started': 920, 'compute_end': 9900,
                'end_received': 9950, 'phase_entry': 1000, 'phase_exit': 10000}
    ignored = late_end['tick_issued'] < late_end['phase_entry']
    actual_ended_before_entry = late_end['compute_end'] <= late_end['phase_entry']
    assert ignored and not actual_ended_before_entry
    # A computeEnd message may arrive after X even though the compute ended before X.
    words = [{'issue': i, 'recv': i+50} for i in range(0, 1000, 200)]
    passed = word_predicate(0, 1000, words)
    hidden_end = {'compute_end': 900, 'end_received': 1200, 'phase_exit': 1000,
                  'plan_duty_at_exit': True, 'actual_compute_open_at_exit': False}
    assert passed and hidden_end['compute_end'] < hidden_end['phase_exit'] < hidden_end['end_received']
    # A post-exit tick that really obtains another slice would positively prove
    # compute through X; a finished generator cannot supply that witness.
    return {'v3_interior_control': 'PASS', 'r515_edge_case': 'rejected',
            'r515_delivery_case': 'rejected',
            'old_tick_does_not_prove_early_end': {**late_end, 'plan_excludes_shard': ignored,
                                                'healthy_sibling_can_make_phase_pass': True},
            'missing_end_does_not_prove_work_left': {**hidden_end, 'v3_word_predicate': passed},
            'positive_post_exit_control': {'tick_issue': 1001, 'slice_started': 1010,
                                           'word_received': 1050, 'proves_compute_open_at_1000': True}}


if __name__ == '__main__':
    print(json.dumps({'review': 'R516', 'kind': 'pure source-bound plan models',
                      'settings': settings_models(), 'visibility': visibility_models(),
                      'phase': phase_models(), 'result': 'all model assertions passed',
                      'product_or_browser_test': False, 'live_access': False}, indent=2))
