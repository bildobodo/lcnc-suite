"""Small arithmetic regression guards, no gateway/interpreter/browser/NML.
The functions are compiled unchanged from the product AST in the isolated archive.
"""
import ast,math,unittest,os
from pathlib import Path
from typing import List
import numpy as np
ROOT=Path(os.environ.get('R489_TREE','/tmp/r489/tree'))
source=ROOT/'lcnc-gateway/gcode_parse_worker.py'
parsed=ast.parse(source.read_text())
mod=ast.Module(body=[n for n in parsed.body if isinstance(n,ast.FunctionDef) and n.name in {'_rdp_keep','_course_splits','_turning_points'}],type_ignores=[])
ns={'np':np,'math':math,'List':List};exec(compile(mod,str(source),'exec'),ns)
def keep(points,anchors=(),times=None):
    return ns['_rdp_keep'](np.array(points,dtype=float),anchors,.005**2,None if times is None else np.array(times,dtype=float))
class Review(unittest.TestCase):
    def test_a_representable_turn_is_not_rounding_of_an_unmoving_axis(self):
        p=[(x,1000.,0.) for x in [0.,1.,1.-2**-13,2.]]
        self.assertTrue(np.array_equal(np.array(p),np.array(p,dtype=np.float32)))
        self.assertEqual(keep(p),[0,1,2,3])
    def test_unrelated_anchored_tail_changes_no_earlier_course(self):
        p=[(x,0.,0.) for x in [0.,1.,1.-2**-13,2.]]
        before=keep(p)
        after=keep(p+[(1000.,0.,0.)],[3])
        self.assertEqual(after[:-1],before)
    def test_short_nonzero_chord_holds_even_its_own_back_bound(self):
        d=2**-12;p=np.array([(x,1024.,0.) for x in [0.,3*d,-d,d]])
        k=keep(p);back=min(.005,4*float(np.spacing(np.float32(abs(p).max()))))
        for a,b in zip(k,k[1:]):
            along=p[a:b+1,0]-p[a,0]
            if p[b,0]<p[a,0]:along=-along
            self.assertLessEqual(float((np.maximum.accumulate(along)-along).max()),back)
    def test_timed_short_chord_still_holds_its_course(self):
        d=2**-12;p=[(x,1024.,0.) for x in [0.,3*d,-d,d]]
        self.assertEqual(keep(p,times=[0,1,2,3]),[0,1,2,3])
    def test_large_reversals_control(self):
        self.assertEqual(keep([(0,0,z) for z in [40,-10,15,-5,20]]),[0,1,2,3,4])
    def test_even_control(self):
        self.assertEqual(keep([(x,1000,0) for x in range(20)],times=list(range(20))),[0,19])
    def test_speed_change_control(self):
        self.assertEqual(keep([(x,0,0) for x in [0,10,20,30,40]],times=[0,1,2,2.1,2.2]),[0,2,4])
    def test_small_reversal_without_unrelated_offset_control(self):
        self.assertEqual(keep([(x,0,0) for x in [0.,1.,1.-2**-13,2.]]),[0,1,2,3])
if __name__=='__main__':unittest.main(verbosity=2)
