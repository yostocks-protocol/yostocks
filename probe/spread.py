import json, urllib.request
H={'Accept-Encoding':'identity','User-Agent':'binance-web3/1.1 (Skill)'}
def get(u):
    return json.load(urllib.request.urlopen(urllib.request.Request(u,headers=H),timeout=15))
d=json.load(open('list.json'))['data']
from collections import defaultdict
m=defaultdict(dict)
for x in d:
    if x['chainId']=='56' and x['type'] in (1,2,3): m[x['ticker']][x['type']]=x
name={1:'Ondo',2:'xStk',3:'bStk'}
for t in ['NVDA','TSLA','AAPL','SPY','COIN','MSTR','GOOGL','META']:
    row=[]
    for ty,x in sorted(m[t].items()):
        try:
            r=get('https://www.binance.com/bapi/defi/v2/public/wallet-direct/buw/wallet/market/token/rwa/dynamic/ai?chainId=56&contractAddress='+x['contractAddress'])['data']
            p=float(r['tokenInfo']['price']); mul=float(r['tokenInfo']['sharesMultiplier'] or 1)
            row.append((name[ty],round(p/mul,3),r['tokenInfo']['totalHolders'],r['stockInfo']['price']))
        except Exception as e: row.append((name[ty],'ERR',str(e)[:40]))
    ps=[r[1] for r in row if isinstance(r[1],float)]
    print(t, row, 'spread%%=%.3f'%((max(ps)-min(ps))/min(ps)*100) if len(ps)>1 else '')
