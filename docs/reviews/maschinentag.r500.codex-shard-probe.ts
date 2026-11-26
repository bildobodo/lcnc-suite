import { pathsProgram, findings, canonical, canonicalDiff, digest, SHARD_TOL } from './src/viewer/stockMuteHarness';
import { buildContactView, targetAt, trackLineAt } from './src/viewer/contactView';
import { NONE, type ContactStore } from './src/viewer/contactStore';

const track = pathsProgram().track();
const { st, model } = findings(track, { stocks: 4 });
const before = canonical([st]), rawBefore = digest(st);
const count = (st: ContactStore) => ({ episodes: st.episodes.rows, intervals: st.intervals.rows, gaps: st.gaps.rows });
const view = (st: ContactStore) => {
  const end = track.cum[track.count - 1]!;
  const v = buildContactView({ sources: [{ stores: [st], ownCoverage: end, at: (c: number) => c }],
    pairName: (pi: number) => ({ a: model.bodies[model.pairs[pi]![0]]!.id, b: model.bodies[model.pairs[pi]![1]]!.id }), coverage: end });
  return Array.from({length: v.n}, (_, i) => targetAt(v, i, trackLineAt(track)));
};
const shownBefore = view(st), countsBefore = count(st);
const E = st.episodes, I = st.intervals, iv = 0;
const oldEpisode = I.get(iv, 'episode'), oldPair = E.get(oldEpisode, 'pair');
const newEpisode = Array.from({length: E.rows}, (_, i) => i).find(e => E.get(e, 'pair') !== oldPair && E.get(e, 'ivCount') > 0)!;
const newFirst = E.get(newEpisode, 'firstIv'), newNext = I.get(newFirst, 'next');
if (newNext === NONE) throw Error('fixture needs a second interval');
const cases = [
  {table:'intervals' as const, row:iv, column:'episode', to:newEpisode},
  {table:'episodes' as const, row:oldEpisode, column:'firstIv', to:newFirst},
  {table:'intervals' as const, row:iv, column:'next', to:newNext},
  {table:'intervals' as const, row:iv, column:'enter', to:I.get(iv, 'enter') + 3},
].map(change => {
  const copy = st.copy(), from = copy[change.table].get(change.row, change.column);
  copy[change.table].set(change.row, change.column, change.to);
  let shownAfter: ReturnType<typeof view> | {error:string};
  try { shownAfter = view(copy); }
  catch (e) { shownAfter = {error: String(e)}; }
  return {mutation:{...change,from}, countsAfter:count(copy), rawChanged:rawBefore !== digest(copy),
    exactDiff:canonicalDiff(before,canonical([copy])), boundedDiff:canonicalDiff(before,canonical([copy]),SHARD_TOL),
    shownChanged:JSON.stringify(shownBefore) !== JSON.stringify(shownAfter),
    changedTargets: Array.isArray(shownAfter) ? shownAfter.flatMap((a,i) => JSON.stringify(a) === JSON.stringify(shownBefore[i]) ? [] : [{before:shownBefore[i],after:a}]) : shownAfter};
});
console.log(JSON.stringify({head:'e0080767',countsBefore,cases},null,2));
