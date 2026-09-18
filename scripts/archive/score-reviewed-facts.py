"""Reproduce targeted content checks. These analyst labels are not whole-video accuracy."""
import json,hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[1]
review=json.loads((root/'data/human-review-20260915/review-working-copy.json').read_text())
cases=[
 (2,'4e93d949-2083-43e3-98f5-fea6b133a4ad','s00077','10万','10万','number','preserved','BTC 100,000 remains a question/possibility, not an entry.'),
 (3,'4e93d949-2083-43e3-98f5-fea6b133a4ad','s00093','底仓','底仓','condition','preserved','Retain a base position, not a new unconditional entry.'),
 (3,'4e93d949-2083-43e3-98f5-fea6b133a4ad','s00093','550以上','550以上','number','preserved','The above-550 qualifier is retained.'),
 (4,'4e93d949-2083-43e3-98f5-fea6b133a4ad','s00104','绝对不是让你去做空','绝对不是让你去做空','negation','preserved','Target is not an instruction to short; lexical error elsewhere in cue remains outside this fact.'),
 (7,'0df6588a-cad3-411f-9202-12aac1c57495','s00188','49%','49%','number','preserved','49% year-over-year growth retained.'),
 (7,'0df6588a-cad3-411f-9202-12aac1c57495','s00193',"wouldn't be surprised", "wouldn't be surprised",'condition','preserved','Trillion-dollar future remains hedged speculation.'),
 (9,'fe349e23-40c9-4f38-986d-a252a6591b96','s00024','VOO为主','VOO为主','issuer','preserved','VOO primary and QQQ secondary DCA preference retained.'),
 (9,'fe349e23-40c9-4f38-986d-a252a6591b96','s00025','新出现的风险','今年新出现的风险','condition','altered','Candidate adds this year to newly emerged risk; reference does not specify this year.'),
]
rows=[]
for n,f,sid,ref,needle,kind,verdict,reason in cases:
 w=review['windows'][n-1];assert ref in w['reference']['text']
 p=root/'data/native-google-20260915'/f'{f}-source.json';raw=p.read_bytes();d=json.loads(raw)
 assert d['video_id']==w['videoId'];s=next(s for s in d['segments'] if s['id']==sid);assert needle in s['text']
 rows.append(dict(windowId=w['id'],videoId=w['videoId'],kind=kind,referencePhrase=ref,candidatePhrase=needle,verdict=verdict,reason=reason,segmentId=sid,sourceSha256=hashlib.sha256(raw).hexdigest()))
report=dict(method='Content correspondence reviewed independently of pause timestamps; targeted post-inspection sample, no recall or overall accuracy estimate.',scope='native ingestion text only, not synthesis or LeapEdge',humanReference='Audio checked by user; individual comparison labels adjudicated by assistant',timestampAccuracy=None,overallAccuracy=None,checks=rows)
(root/'docs/reviewed-facts-20260915.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print('8 targeted checks: 7 preserved, 1 altered. Not overall accuracy; no timing score.')
