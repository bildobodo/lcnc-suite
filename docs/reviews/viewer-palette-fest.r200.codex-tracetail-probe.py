"""Offline TraceTail boundary probes; no live paths or sockets."""
import builtins,json,os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from tracetail import TraceTail

def row(t,tag):
 return (json.dumps({'t_wall_ns':t,'tag':tag,'pad':'x'*80},separators=(',',':'))+'\n').encode()

class TraceBoundaries(unittest.TestCase):
 def test_incomplete_head_and_line_wait(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'trace.ndjson';r=row(100,'one');p.write_bytes(r[:20]);t=TraceTail(0,d)
   self.assertEqual(t.since(0),[])
   with p.open('ab') as f:f.write(r[20:60])
   self.assertEqual(t.since(0),[])
   with p.open('ab') as f:f.write(r[60:])
   self.assertEqual([x['tag'] for x in t.since(0)],['one'])
   self.assertEqual(len(t.since(0)),1)
 def test_renamed_file_keeps_growing(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'trace.ndjson';q=Path(d)/'trace.ndjson.1';p.write_bytes(row(100,'old'));t=TraceTail(0,d)
   self.assertEqual(len(t.since(0)),1);p.rename(q);p.write_bytes(row(101,'new'))
   with q.open('ab') as f:f.write(row(102,'late old writer'))
   self.assertEqual([x['tag'] for x in t.since(0)],['old','new','late old writer'])
   self.assertEqual(len(t.since(0)),3)
 def test_reused_inode_already_larger_than_saved_offset(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'trace.ndjson';p.write_bytes(row(100,'old'));t=TraceTail(0,d);t.since(0);ino=p.stat().st_ino
   p.write_bytes(row(101,'new1')+row(102,'new2'));self.assertEqual(p.stat().st_ino,ino)
   self.assertEqual([x['tag'] for x in t.since(0)],['old','new1','new2'])
 def test_rotation_between_stat_and_open_does_not_duplicate(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'trace.ndjson';q=Path(d)/'trace.ndjson.1';p.write_bytes(row(100,'old1')+row(101,'old2'));t=TraceTail(0,d);t.since(0)
   stat=os.stat; rotated=False
   def rotate_after_stat(path,*args,**kwargs):
    nonlocal rotated
    s=stat(path,*args,**kwargs)
    if Path(path)==p and not rotated:
     rotated=True;p.rename(q);p.write_bytes(row(102,'gcode.publish'))
    return s
   original_open=builtins.open
   def rotate_before_open(path,*args,**kwargs):
    nonlocal rotated
    if Path(path)==p and not rotated:
     rotated=True;p.rename(q);p.write_bytes(row(102,'gcode.publish'))
    return original_open(path,*args,**kwargs)
   # Original reader: rotate after path stat. fd-based control: rotate just
   # before open instead; both exercise the path changing under the reader.
   with patch('tracetail.os.stat',side_effect=rotate_after_stat), patch('tracetail.open',side_effect=rotate_before_open,create=True):t.poll()
   actual=[x['tag'] for x in t.since(0)]
   print('rotation race observations',actual,flush=True)
   self.assertEqual(actual,['old1','old2','gcode.publish'])

if __name__=='__main__':unittest.main()
