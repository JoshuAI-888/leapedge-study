"""Archive consulted public pages privately; publish only URL/status/hash metadata.
Run from repository root: python3 evaluations/native-google/snapshot-sources.py
No credentials, model calls, or scraping of authenticated pages.
"""
import concurrent.futures, datetime, hashlib, json, pathlib, subprocess
root = pathlib.Path('data/native-google-20260915/web-references')
root.mkdir(parents=True, exist_ok=True)
sources = json.loads(pathlib.Path('docs/native-google-research-sources.json').read_text())
def capture(s):
    at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    try:
        response = subprocess.run(['curl','--fail','--location','--max-time','25','--silent','--show-error',s['url']],capture_output=True,check=True)
        body = response.stdout
        artifact = root / (s['id'] + '.html')
        artifact.write_bytes(body)
        return dict(id=s['id'], url=s['url'], status='curl_success', capturedAt=at,
                    sha256=hashlib.sha256(body).hexdigest(), bytes=len(body), privateArtifact=artifact.name)
    except Exception as error:
        return dict(id=s['id'], url=s['url'], capturedAt=at, error=str(error),
                    note='Web-tool reading is recorded separately; this archival HTTP fetch failed.')
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    results = list(pool.map(capture, sources['sources']))
pathlib.Path('docs/native-google-source-snapshots.json').write_text(json.dumps(results, indent=2)+'\n')
print(json.dumps({'captured':sum('sha256' in r for r in results),'failed':sum('error' in r for r in results)}))
