"""Reproduce observed browser latency and displayed model usage; not an accuracy scorer."""
import json
import re
from datetime import datetime
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data/browser-parity-20260915'
def read(name):
    return json.loads((DATA / f'{name}.json').read_text())
def elapsed(start, end):
    submitted = re.search(r'2026-\d\d-\d\dT[\d:.]+Z', str(read(start)['result']))
    assert submitted, start
    return round((datetime.fromisoformat(read(end)['observedAt']) - datetime.fromisoformat(submitted[0].replace('Z', '+00:00'))).total_seconds(), 3)
def metadata(name):
    result = read(name)['result']['text'].split('Pipeline metadata\n')[-1]
    m = json.JSONDecoder().raw_decode(result)[0]
    return {'prompt': m['prompt'], 'model': m['model'], 'displayedCostOrReservationUsd': m['costOrReservationUsd'], 'modelStages': len(m['metrics']), 'totalModelTokens': sum(x.get('usage', {}).get('total_tokens', 0) for x in m['metrics']), 'summedModelStageSeconds': round(sum(x.get('seconds', 0) for x in m['metrics']), 3)}
cases = [
 ('english-short', 'hYAnAtEqzI0', 'Miles Talks Finance', 'LeapEdge', 'short-submit', 'leap-short-report', 'report', 1, None),
 ('english-short', 'hYAnAtEqzI0', 'Miles Talks Finance', 'YouTube Intelligence', 'portal-short-submit', 'portal-short-poll5', 'report', 3, 'portal-short-metadata'),
 ('english-long', 'Q6G8pXFkKLk', 'Financial Education', 'LeapEdge', 'long-submit', 'long-poll4', 'transcription_length_failure', 0, None),
 ('english-long', 'Q6G8pXFkKLk', 'Financial Education', 'YouTube Intelligence', 'portal-long-submit', 'portal-long-poll4', 'budget_failure', 0, None),
 ('english-long-retry', 'Q6G8pXFkKLk', 'Financial Education', 'YouTube Intelligence', 'portal-long-retry-submit', 'portal-long-retry-poll7', 'report_with_duplicate_company', 4, 'portal-long-retry-final'),
 ('chinese-short', '9nb3fp76Rz0', '阳光财经', 'LeapEdge', 'chinese-submit', 'chinese-poll1', 'report', 3, None),
 ('chinese-short', '9nb3fp76Rz0', '阳光财经', 'YouTube Intelligence', 'portal-chinese-submit', 'portal-chinese-poll3', 'completed_without_accepted_evidence', 0, 'portal-chinese-rejections'),
]
rows=[]
for case, video, channel, product, start, end, outcome, count, meta in cases:
    rows.append(dict(case=case, videoId=video, channel=channel, product=product, outcome=outcome, acceptedCards=count, observedUpperBoundSeconds=elapsed(start,end), evidence=[start+'.json', end+'.json'], **({'usage':metadata(meta)} if meta else {})))
output={'method':'Browser submit to first captured terminal report/state. Upper bounds include polling and refresh delay; not server latency. Three fresh matched cases, one separately labelled retry. Cards are not verified facts.', 'accuracyMeasured':False, 'rows':rows}
(ROOT/'docs/browser-parity-results-20260915.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(output,ensure_ascii=False,indent=2))
