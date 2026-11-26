"""R515: executable plan countermodels, not product/browser/native tests.

Control-flow premises are quoted in maschinentag.r515.codex-source.txt.
The incomplete predicates below implement the stated plan literally; there
is no claim that the future implementation already contains these defects.
"""
import json


def planned_settings_tick(link, new_pub, hidden=True, pending=False):
    # Existing earlier returns, then the new branch proposed at 14665.
    if not link:
        return ['status_error']
    if not new_pub:
        return []
    if hidden:
        return [] if pending else ['settings_changed']
    return ['status', 'settings_changed']


def settings_counterexamples():
    cases = []
    for name, link, fresh in [('normal', True, True), ('no_controller', False, False),
                              ('no_new_publication', True, False)]:
        frames = planned_settings_tick(link, fresh)
        cases.append({'case': name, 'server_simulation': False,
                      'frames': frames, 'hidden_simulation': 'settings_changed' not in frames})
    assert not cases[0]['hidden_simulation']
    assert cases[1]['hidden_simulation'] and cases[2]['hidden_simulation']
    return cases


def visible_admission():
    timeline = [
        {'ms': 0, 'event': 'last adopted status', 'interp': 'IDLE'},
        {'ms': 10, 'event': 'hide'},
        {'ms': 1000, 'event': 'controller starts run; page gets no status'},
        {'ms': 2000, 'event': 'show; document.hidden becomes false'},
        {'ms': 2001, 'event': 'pending recheck timer fires'},
        {'ms': 2200, 'event': 'fresh machine status adopted'},
    ]
    literal_hidden_guard_allows = not False
    freshness_gate_allows = False
    assert literal_hidden_guard_allows and not freshness_gate_allows
    buffered = {'received_before_hide': True, 'flushed_after_show': True,
                'is_first_reactive_status_after_show': True, 'fresh_after_show': False}
    return {'timeline': timeline, 'document_hidden_guard_starts_old_idle_job': literal_hidden_guard_allows,
            'freshness_gate_blocks_it': not freshness_gate_allows, 'buffered_old_frame': buffered,
            'main_needBodies_while_hidden': {
                'already_owned_job': True, 'entry': 'runCollisionCheck(..., _colPendingRun)',
                'blocked_by_unqualified_hidden_guard': True}}


def receipt_predicate(start, end, words):
    return bool(words) and all(start < w['issued'] < w['work'] < w['received'] < end for w in words) and all(
        b['received'] - a['received'] <= 1000 for a, b in zip(words, words[1:]))


def phase_counterexamples():
    edge = [{'issued': 9770, 'work': 9780, 'received': 9800},
            {'issued': 9870, 'work': 9880, 'received': 9900}]
    batch = [{'issued': 50, 'work': 100, 'received': 4800},
             {'issued': 150, 'work': 200, 'received': 4900}]
    assert receipt_predicate(0, 10000, edge)
    assert receipt_predicate(0, 5000, batch)
    ack = {'compute_done_before_entry': True, 'all_shards_done': True,
           'result_received_at_entry': False, 'result_received_at_exit': False,
           'owed_work_shards': 0}
    return {'uncovered_entry': {'words': edge, 'phase_ms': 10000,
                               'literal_receipt_rule': 'PASS', 'no_work_before_ms': 9780},
            'delayed_receipts': {'words': batch, 'phase_ms': 5000,
                                 'literal_receipt_rule': 'PASS', 'no_work_after_ms': 200},
            'ack_is_not_compute': ack,
            'last_word_to_result_is_not_delivery': {
                'last_word_received_ms': 100, 'compute_ends_ms': 1100,
                'result_received_ms': 1105, 'plan_delivery_ms': 1005,
                'actual_post_compute_remainder_ms': 5}}


if __name__ == '__main__':
    print(json.dumps({'review': 'R515', 'kind': 'pure source-bound plan models',
                      'settings_path': settings_counterexamples(),
                      'visibility': visible_admission(), 'phase_proof': phase_counterexamples(),
                      'result': 'all countermodel assertions passed',
                      'product_runtime_test': False, 'live_connection': False}, indent=2))
