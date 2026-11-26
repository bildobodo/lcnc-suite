import {findings, pathsProgram, digest} from './src/viewer/stockMuteHarness';
import {ContactStore,NONE,GAP_UNDECIDABLE} from './src/viewer/contactStore';
// Exact comparison in stockMute.test.ts, the 'shards tables' test, head802e140c.
const pairsOf = (st: ContactStore) => {
 const m = new Map<number, string[]>();
 for(let e=0;e<st.episodes.rows;e++){
  const ivs:string[]=[];
  for(let iv=st.episodes.get(e,'firstIv');iv!==NONE;iv=st.intervals.get(iv,'next'))
   ivs.push(`${st.intervals.get(iv,'flags')}:${st.intervals.get(iv,'enter').toFixed(2)}-${st.intervals.get(iv,'exit').toFixed(2)}`);
  const pair=st.episodes.get(e,'pair');
  m.set(pair,[...(m.get(pair)??[]),`${st.episodes.get(e,'flags')} ${ivs.join(',')}`]);
 }
 return m;
};
const {st}=findings(pathsProgram().track());
st.gaps.append({pair:0,start:5,end:6,reason:GAP_UNDECIDABLE});
const original=digest(st), projection=JSON.stringify([...pairsOf(st)]);
const cases=[];
for (const [name,t,k] of [
 ['episode.onset',st.episodes,'onset'], ['episode.end',st.episodes,'end'],
 ['episode.closeDist',st.episodes,'closeDist'], ['interval.witness',st.intervals,'witness'],
 ['interval.freeAt',st.intervals,'freeAt'],['interval.freeR',st.intervals,'freeR'],
 ['gap.start',st.gaps,'start'],['gap.reason',st.gaps,'reason']
] as const){
 const before=t.get(0,k),counts=[st.episodes.rows,st.intervals.rows,st.gaps.rows];
 t.set(0,k,Number.isNaN(before)?123:before+17);
 cases.push({name,before,after:t.get(0,k),counts,projectionUnchanged:projection===JSON.stringify([...pairsOf(st)]),allColumnsChanged:original!==digest(st)});
 t.set(0,k,before);
}
console.log(JSON.stringify({cases},null,2));
