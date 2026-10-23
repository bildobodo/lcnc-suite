#!/usr/bin/env python3
"""R187 offline causal/age proof checks against the unchanged supplied report.
R187_PROBE_ROOT names the temp root with measurement-tools and the TS evidence.
No machine connection, driver, generator or calibration is executed.
"""
import copy
import json
import os
from pathlib import Path
import random
import sys
import unittest

ROOT=Path(os.environ.get('R187_PROBE_ROOT','/tmp/codex-r187-b4k897uq'))
sys.path.insert(0,str(ROOT/'measurement-tools'))
import bpc2 as report
CAUSAL=json.loads((ROOT/'causal-evidence.json').read_text())['delayedWord']
CLOCK=json.loads((ROOT/'clock-evidence.json').read_text())
OUT={}

def span(p0=10000,p1=11000):
    return [dict(job=9,pid=1,file='synthetic.ngc',pinned=True,p0_ns=int(p0*1e6),p1_ns=int(p1*1e6),t_wall_ns=int(15e9))]

def extract():
    events=copy.deepcopy(CAUSAL['events'])
    for e in events:e['t_wall_ns']=int(15e9)
    ps=report.hb_pairs_of(events,{'P'},0,int(20e9))
    ws=report.words_of(events,{'P'})
    return ps,ws

def verdict(name,ps=None,ws=None,sp=None):
    basep,basew=extract()
    r=report.r_verdict(span() if sp is None else sp,basep if ps is None else ps,basew if ws is None else ws)
    OUT[name]=r
    return r['verdict']

class Proof(unittest.TestCase):
    def test_actual_collector_chain_proves_only_the_later_heartbeat(self):
        ps,ws=extract()
        self.assertEqual(verdict('actual_chain_before_word',ps={'P':ps['P'][:2]},ws=ws),'R overlap not proven')
        self.assertEqual(verdict('actual_chain_after_word'),'R overlap proven')
        self.assertEqual(OUT['actual_chain_after_word']['proof']['heartbeat_b']['seq'],3)

    def test_browser_offsets_are_irrelevant_to_r(self):
        ps,ws=extract()
        for p in ps['P']:
            p['hs']-=1e12;p['hr']-=1e12
        self.assertEqual(verdict('browser_clock_shift',ps=ps,ws=ws),'R overlap proven')

    def test_old_r186_collision_word_before_parse_has_an_older_tick(self):
        ps,ws=extract()
        # Tick 1 and the real work preceded this parse; the answers inside it
        # issued ticks 2 and 3. Delaying the old word does not make it current.
        ps['P'][0]['g']=8150
        ps['P'][1]['dt']=1;ps['P'][1]['dn']=1
        self.assertEqual(verdict('old_collision_before_parse',ps=ps,ws=ws),'R overlap not proven')

    def test_old_r186_slice_after_parse_needs_a_later_heartbeat_outside_it(self):
        ps,ws=extract()
        ps['P'][2]['g']=12850
        self.assertEqual(verdict('old_ws_clock_after_parse',ps=ps,ws=ws),'R overlap not proven')

    def test_missing_word_or_wrong_word_is_not_a_witness(self):
        ps,ws=extract()
        self.assertEqual(verdict('missing_word',ws={}), 'R overlap not proven')
        ws['P'][1]['tick']=99
        self.assertEqual(verdict('wrong_word',ws=ws), 'R overlap not proven')

    def test_no_cross_page_or_gateway_join(self):
        ps,ws=extract();ws['Q']=ws.pop('P')
        self.assertEqual(verdict('other_page',ws=ws),'R overlap not proven')
        ps['P'][2]['pid']=9
        self.assertEqual(verdict('other_gateway',ps=ps),'R overlap not proven')

    def test_missing_end_and_non_run_words_stay_unknown(self):
        sp=span();sp[0]['p1_ns']=None
        self.assertEqual(verdict('no_end',sp=sp),'R overlap not proven')
        events=copy.deepcopy(CAUSAL['events'])
        for e in events:
            if e['tag']=='browser.collision.sweep_witness':e['run_gen']=None
        self.assertEqual(verdict('idle_word',ws=report.words_of(events,{'P'})),'R overlap not proven')

    def test_r_causal_order_with_random_delays(self):
        rng=random.Random(187);proven=0;unproven=0
        for k in range(10000):
            ga=10000+rng.uniform(-1000,1000)
            arrival_a=ga+rng.uniform(0,400)
            tick_at_worker=arrival_a+rng.uniform(0,400)
            start=tick_at_worker+rng.uniform(0,400)
            end=start+rng.uniform(.01,90)
            word_at_ws=end+rng.uniform(0,500)
            send_b=10000+rng.uniform(0,2200)
            gb=send_b+rng.uniform(0,300)
            dt=1 if send_b>=word_at_ws else 0
            # Browser clocks may have arbitrary offsets; only g is used by R.
            offset=rng.uniform(-1e9,1e9)
            pairs={'P':[dict(seq=1,g=ga,pid=1,ta=1,dt=0,dn=0,hs=ga-10+offset,hr=arrival_a+offset),
                        dict(seq=2,g=gb,pid=1,ta=2,dt=dt,dn=dt,hs=send_b+offset,hr=gb+10+offset)]}
            word={'P':{1:dict(n=1,tick=1,id=42,run_gen=7,range_from=0,shard=0,gen=1)}}
            p0=10000+rng.uniform(-1200,500);p1=p0+rng.uniform(100,2600)
            got=report.r_verdict(span(p0,p1),pairs,word)
            if got['verdict']=='R overlap proven':
                proven+=1
                self.assertLess(p0,start)
                self.assertLess(end,p1)
                self.assertLessEqual(word_at_ws,send_b)
            else:unproven+=1
        self.assertGreater(proven,0);self.assertGreater(unproven,0)
        OUT['random_causality']={'cases':10000,'seed':187,'proven':proven,'unproven':unproven,'false_positives':0}

    def test_real_unknown_and_conflict_rows_cannot_pass_age_target(self):
        for key,row in CLOCK['unknown'].items():
            # Include a fast valid sample too: absence of age data in the bad
            # row must not silently turn into a pass from the other row.
            fast=dict(age_h={'10':100},age_unbound=0,age_neg=0,clk_conflicts=0)
            r=report.target([row,fast],[row,fast],{'complete':True})
            OUT['age_'+key]=r
            self.assertEqual(r['verdict'],'not proven')

    def test_positive_age_bound_can_pass(self):
        row=dict(age_h={'30':100},age_unbound=0,age_neg=0,clk_conflicts=0)
        got=report.target([row],[row],{'complete':True})
        self.assertEqual(got['verdict'],'met');OUT['age_positive']=got

if __name__=='__main__':
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Proof))
    OUT['_result']={'run':result.testsRun,'failures':len(result.failures),'errors':len(result.errors)}
    (ROOT/'tools-evidence.json').write_text(json.dumps(OUT,indent=2))
    raise SystemExit(not result.wasSuccessful())
