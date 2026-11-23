import itertools, functools
from collections import Counter
F=range(1,7)
def cat(d):
    c=sorted(Counter(d).values(),reverse=True); s=set(d)
    r={}
    r['five']=c[0]==5
    r['four+']=c[0]>=4
    r['full']=c[:2]==[3,2]
    r['three+']=c[0]>=3
    r['twopair+']=(c[0]>=2 and len(c)>1 and c[1]>=2) or c[0]>=4
    r['pair+']=c[0]>=2
    r['lgstr']=s in ({1,2,3,4,5},{2,3,4,5,6})
    r['smstr+']=any(x<=s for x in ({1,2,3,4},{2,3,4,5},{3,4,5,6}))
    r['alleven']=all(x%2==0 for x in d)
    r['allodd']=all(x%2==1 for x in d)
    r['allhigh(4-6)']=all(x>=4 for x in d)
    r['sum>=25']=sum(d)>=25
    return r
# exclusive single-roll hand ranks
def rank(d):
    c=sorted(Counter(d).values(),reverse=True); s=set(d)
    if c[0]==5: return '5kind'
    if c[0]==4: return '4kind'
    if s in ({1,2,3,4,5},{2,3,4,5,6}): return 'lgstr'
    if c[:2]==[3,2]: return 'full'
    if any(x<=s for x in ({1,2,3,4},{2,3,4,5},{3,4,5,6})): return 'smstr'
    if c[0]==3: return '3kind'
    if c[:2]==[2,2]: return '2pair'
    if c[0]==2: return 'pair'
    return 'high'
allr=list(itertools.product(F,repeat=5))
N=len(allr)
ex=Counter(rank(d) for d in allr)
print("exclusive single roll:")
for k,v in ex.most_common(): print(f"  {k:6} {v/N*100:6.2f}%")
keys=list(cat(allr[0]).keys())
print("\ninclusive targets: single roll / with 1 reroll / with 2 rerolls (optimal hold, chasing that target)")
@functools.lru_cache(None)
def outcomes(n):
    return Counter(tuple(sorted(x)) for x in itertools.product(F,repeat=n))
def solve(key):
    @functools.lru_cache(None)
    def V(state,rolls):
        if cat(state)[key]: return 1.0
        if rolls==0: return 0.0
        best=0
        for m in range(32):
            held=tuple(sorted(state[i] for i in range(5) if m>>i&1))
            n=5-len(held); tot=6**n; p=0
            for o,c in outcomes(n).items():
                p+=c*V(tuple(sorted(held+o)),rolls-1)
            best=max(best,p/tot)
        return best
    res=[]
    for r in (0,1,2):
        p=0
        for o,c in outcomes(5).items(): p+=c*V(o,r)
        res.append(p/N)
    return res
for k in keys:
    a,b,c=solve(k); print(f"  {k:14} {a*100:6.2f}% {b*100:6.2f}% {c*100:6.2f}%")
