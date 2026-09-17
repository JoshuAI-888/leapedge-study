# Requires youtube-transcript-api==1.2.4 in an isolated virtualenv.
# Public reference videos only; no credentials, proxies, or paid services.
import json,time,pathlib,datetime
from requests import Session
from youtube_transcript_api import YouTubeTranscriptApi
class TimedSession(Session):
    def request(self,*args,**kwargs):
        kwargs.setdefault('timeout',30)
        return super().request(*args,**kwargs)
out=pathlib.Path('data/free-caption-benchmark')
out.mkdir(parents=True,exist_ok=True)
cases=[('wkAqHlYL7bQ',['en']),('v824SHV6COE',['en']),('kXYvRR7gV2E',['en']),('3u24qyWjSVM',['zh-Hans','zh-Hant','zh','zh-TW','zh-CN']),('J25UuUqHT3Y',['zh-Hans','zh-Hant','zh','zh-TW','zh-CN'])]
results=[]
for video,langs in cases:
    start=time.monotonic(); r={'videoId':video,'library':'youtube-transcript-api@1.2.4','at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
    try:
        api=YouTubeTranscriptApi(http_client=TimedSession())
        tracks=list(api.list(video)); r['availableTracks']=[{'language':t.language_code,'generated':t.is_generated} for t in tracks]
        candidates=[t for t in tracks if t.language_code in langs or any(t.language_code.startswith(l+'-') for l in langs)]
        if not candidates: raise ValueError('NoOriginalLanguageTrack')
        track=sorted(candidates,key=lambda t:t.is_generated)[0]
        data=track.fetch().to_raw_data()
        (out/(video+'-python-source.json')).write_text(json.dumps(data,ensure_ascii=False))
        r.update(status='completed',language=track.language_code,generated=track.is_generated,segments=len(data),lastEnd=max(s['start']+s['duration'] for s in data),characters=sum(len(s['text']) for s in data))
    except Exception as e:
        r.update(status='failed',errorType=type(e).__name__)
    r['durationSeconds']=round(time.monotonic()-start,3);results.append(r)
    (out/'python-results.json').write_text(json.dumps(results,indent=2))
    print(json.dumps(r),flush=True)
