#!/usr/bin/env python3
"""R315 plan arithmetic; synthetic only, no product imports or live commands."""
import json
import random

MS = 1_000_000
MOD = 2**32


def verdict(lo, hi):
    return 'PASS' if hi <= 250*MS else 'FAIL' if lo > 250*MS else 'incomplete'


def bounds(c, i, j):
    return max(0, c[j-1]-c[i+1]), c[j+1]-c[i-1]


# The source stream from R314: delay after C_201, before S_201.
c = [k*MS + (100*MS if k >= 202 else 0) for k in range(403)]
s = [t+MS//10 for t in c]
s[201] += 100*MS
lp = [MS]+[b-a for a,b in zip(c,c[1:])]
indices = (1,201,301)
histories = {
    'exceeded': (MS//2, 300*MS+MS//2, 400*MS+MS//2),
    'within': (MS//2, 200*MS+MS//2, 400*MS+MS//2),
}
observed = {}
results = {}
for name, edges in histories.items():
    assert all(s[i-1] < edge <= s[i] for i,edge in zip(indices,edges))
    observed[name] = [sum(edge <= sample for edge in edges) % 2 for sample in s]
    pairs = []
    for (i,j),(a,b) in zip(zip(indices,indices[1:]),zip(edges,edges[1:])):
        lo,hi=bounds(c,i,j)
        assert hi==sum(lp[i:j+2])
        assert lo==sum(lp[i+2:j])
        assert lo <= b-a <= hi
        pairs.append({'actual_ms':(b-a)/MS,'lower_ms':lo/MS,'upper_ms':hi/MS,
                      'correct_verdict':verdict(lo,hi)})
    results[name]=pairs
assert observed['exceeded']==observed['within']
assert results['within'][0]['correct_verdict']=='incomplete'


def no_wrap(c,a,b,mark,receipt):
    """Exact-integer form; all used periods are a+2..b, inclusive."""
    periods=[c[k]-c[k-1] for k in range(a+2,b+1)]
    raw=sum(p%MOD for p in periods)
    slack=receipt-mark-raw
    return {'slack_ns':slack,'no_wrap_proven':0 <= slack < MOD,
            'actual_wraps':sum(p//MOD for p in periods)}


wrap_cases={
    'ordinary':no_wrap([k*MS for k in range(12)],0,10,MS//20,10*MS+MS//5),
    'reader_delayed':no_wrap([k*MS for k in range(12)],0,10,MS//20,10*MS+MOD+MS),
    'one_wrap':no_wrap([k*MS+(MOD if k>=5 else 0) for k in range(12)],0,10,
                       MS//20,10*MS+MOD+MS//5),
    'exact_slack_boundary':no_wrap([k*MS for k in range(12)],0,10,0,9*MS+MOD),
}
assert wrap_cases['ordinary']['no_wrap_proven']
assert not any(wrap_cases[name]['no_wrap_proven'] for name in
               ['reader_delayed','one_wrap','exact_slack_boundary'])

# Generative check of the inequalities under their stated prerequisites.
rng=random.Random(315)
count=2000
proofs=0
for _ in range(count):
    n=32
    c=[0]
    for _ in range(n):
        c.append(c[-1]+rng.randint(1,5*MS)+(MOD if rng.randrange(70)==0 else 0))
    s=[rng.randint(c[k],c[k+1]) for k in range(n)]
    i,j=sorted(rng.sample(range(2,n-2),2))
    e1=rng.randint(s[i-1],s[i]); e2=rng.randint(s[j-1],s[j])
    lo,hi=bounds(c,i,j)
    assert lo<=e2-e1<=hi
    a=0; b=n-2
    mark=rng.randint(c[0],s[0])
    receipt=s[b]+rng.randint(0,10*MS)
    proof=no_wrap(c,a,b,mark,receipt)
    if proof['no_wrap_proven']:
        assert proof['actual_wraps']==0
        raw=[0]+[(c[k]-c[k-1])%MOD for k in range(1,len(c))]
        assert sum(raw[i:j+2])==hi
        assert sum(raw[i+2:j])==lo
        proofs+=1
    lower=c[b]-c[a+1]
    assert lower<=s[b]-s[a]

# W arrives during the delay from R314; the corrected range excludes it.
wc=[0]+[(2100+k)*MS for k in range(1,101)]
ws=[2100*MS+MS//10]+[x+MS//10 for x in wc[1:]]
post_w={'lower_duration_ms':(wc[-1]-wc[1])/MS,
        'actual_observation_ms':(ws[-1]-ws[0])/MS,
        'long_enough_2s':wc[-1]-wc[1]>=2000*MS}
assert not post_w['long_enough_2s']

ordinary={}
for gap in [100,260]:
    tc=[k*MS for k in range(gap+5)]
    lo,hi=bounds(tc,1,gap+1)
    ordinary[str(gap)+'ms']={'lower_ms':lo/MS,'upper_ms':hi/MS,
                             'verdict':verdict(lo,hi)}
assert ordinary['100ms']['verdict']=='PASS'
assert ordinary['260ms']['verdict']=='FAIL'

print(json.dumps({'same_observed_stream':True,'histories':results,
    'wrap_cases':wrap_cases,'generative_cases':count,
    'generative_no_wrap_proofs':proofs,'post_W':post_w,'ordinary':ordinary},indent=2))
