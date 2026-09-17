"""Small, read-only capability probe. Never prints credentials or request URLs."""
import json,sys,time,urllib.request,urllib.parse,urllib.error
from pathlib import Path
from datetime import datetime,timezone
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from leapstudy.provider import context
root=Path(__file__).resolve().parents[1]
keys={k:v.strip().strip('\"\'') for line in (root/'.env').read_text().splitlines() if '=' in line for k,_,v in [line.partition('=')]}
results=[]
for provider in (['fmp-adjusted'] if '--adjusted-only' in sys.argv else ['fmp','alphavantage']):
 for symbol in ['AAPL','SPY']:
  if provider.startswith('fmp'):
   endpoint='https://financialmodelingprep.com/stable/historical-price-eod/'+('dividend-adjusted' if provider=='fmp-adjusted' else 'full')
   params={'symbol':symbol,'from':'2026-07-01','to':'2026-09-11','apikey':keys['FMP_API_KEY']}
  else:
   endpoint='https://www.alphavantage.co/query'
   params={'function':'TIME_SERIES_DAILY_ADJUSTED','symbol':symbol,'outputsize':'compact','apikey':keys['ALPHAVANTAGE_API_KEY']}
  result={'provider':provider,'symbol':symbol,'endpoint':endpoint,'checked_at':datetime.now(timezone.utc).isoformat()}
  try:
   req=urllib.request.Request(endpoint+'?'+urllib.parse.urlencode(params),headers={'Accept':'application/json'})
   with urllib.request.urlopen(req,timeout=35,context=context()) as r:
    result['http_status']=r.status;data=json.load(r)
   rows=data if isinstance(data,list) else data.get('Time Series (Daily)',{})
   if rows:
    result['status']='available';result['rows']=len(rows)
    if isinstance(rows,list):
     result['fields']=list(rows[0]);result['earliest_date']=min(x['date'] for x in rows);result['latest_date']=max(x['date'] for x in rows)
    else:
     result['fields']=list(next(iter(rows.values())));result['earliest_date']=min(rows);result['latest_date']=max(rows)
    (root/'data'/f'{provider}-{symbol}-history.json').write_text(json.dumps(data))
   else:
    result['status']='no_price_data'
    message=json.dumps(data)
    for secret in keys.values():
     if len(secret)>8:message=message.replace(secret,'[REDACTED]')
    result['provider_message']=message[:600]
  except urllib.error.HTTPError as e:result.update(status='http_error',http_status=e.code)
  except Exception as e:result.update(status='request_failed',error_type=type(e).__name__)
  results.append(result)
  print(json.dumps(result))
  if provider=='alphavantage':time.sleep(1.1)
(root/'data'/('market-data-adjusted-capabilities.json' if '--adjusted-only' in sys.argv else 'market-data-capabilities.json')).write_text(json.dumps(results,indent=2))
