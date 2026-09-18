"""Preserve reviewer input and reproduce selected landmark interval checks; no API calls."""
import hashlib,json,re,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
p=Path(sys.argv[1]); raw=p.read_bytes(); review=json.loads(raw)
packet=json.loads((root/'docs/completion-blind-audio-review-20260915.json').read_text())
assert review['packetSha256']==packet['packetSha256']
assert review['containsCandidateAnswers'] is False
assert len(review['windows'])==len(packet['windows'])==9
for w,expected in zip(review['windows'],packet['windows']):
 for k in ('id','videoId','language','split','startSeconds','endSeconds'): assert w[k]==expected[k],k
 r=w['reference']; assert r['reviewerAttestedListening'] and r['text'].strip() and r['reviewer'].strip()
out=root/'data/human-review-20260915';out.mkdir(exist_ok=True)
sha=hashlib.sha256(raw).hexdigest();(out/(sha+'.original.json')).write_bytes(raw)
# Preselected diagnostic landmarks, NOT a random sample or overall accuracy estimate.
checks=[
 (2,501,'4e93d949-2083-43e3-98f5-fea6b133a4ad','s00077','10万'),
 (2,522,'4e93d949-2083-43e3-98f5-fea6b133a4ad','s00080','特斯拉'),
 (3,614,'4e93d949-2083-43e3-98f5-fea6b133a4ad','s00093','底仓'),
 (3,655,'4e93d949-2083-43e3-98f5-fea6b133a4ad','s00099','258'),
 (4,691,'4e93d949-2083-43e3-98f5-fea6b133a4ad','s00104','做空'),
 (7,1185,'0df6588a-cad3-411f-9202-12aac1c57495','s00183','double'),
 (7,1208,'0df6588a-cad3-411f-9202-12aac1c57495','s00188','49%'),
 (7,1233,'0df6588a-cad3-411f-9202-12aac1c57495','s00193','trillion'),
 (9,419,'fe349e23-40c9-4f38-986d-a252a6591b96','s00024','VOO'),
 (9,474,'fe349e23-40c9-4f38-986d-a252a6591b96','s00027','型反转'),
]
results=[]
for n,t,f,sid,term in checks:
 w=review['windows'][n-1]; assert w['startSeconds']<=t<w['endSeconds']
 assert term.lower() in w['reference']['text'].lower()
 sourcepath=root/'data/native-google-20260915'/f'{f}-source.json'; b=sourcepath.read_bytes(); source=json.loads(b)
 assert source['video_id']==w['videoId']
 s=next(s for s in source['segments'] if s['id']==sid);assert term.lower() in s['text'].lower()
 a,z=s['start_seconds'],s['end_seconds']
 results.append(dict(windowId=w['id'],videoId=w['videoId'],landmark=term,referenceSeconds=t,candidateStart=a,candidateEnd=z,unvalidatedPauseTimeDifference=round(max(a-t,t-z,0),2),sourceSha256=hashlib.sha256(b).hexdigest(),segmentId=sid))
report=dict(version='human-review-intake.v1',inputSha256=sha,packetSha256=review['packetSha256'],attestedWindows=9,audioConfirmation='User explicitly confirmed Chinese embedded subtitles checked against spoken audio in conversation',split='development',overallAccuracy=None,timestampAccuracy=None,timestampReferenceStatus='UNVALIDATED_PAUSE_TIMES',timingClarification='User clarified timestamps reflect when they stopped to transcribe, not precise spoken landmarks. Numerical differences are not measured timestamp errors.',limitations=['Diagnostic landmarks selected after inspection; not an unbiased aggregate accuracy sample','Reviewer times are pause/transcription times; differences cannot establish drift, offset direction or timestamp accuracy','Whole-window WER/CER not scored: boundary and transcription ambiguity reconciliation pending','No new LeapEdge comparison performed'],landmarkChecks=results)
(root/'docs/human-review-intake-20260915.json').write_text(json.dumps(report,indent=2)+'\n')
(out/'review-working-copy.json').write_text(json.dumps(review,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,indent=2))
