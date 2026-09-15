"""Capture only rendered Chrome DOM and timestamp UI actions for parity research.
No direct application API, cookies, browser storage, or hidden application state.
Usage: python3 scripts/browser-parity.py TAB_ID LABEL [JAVASCRIPT]
"""
import sys,json,subprocess,datetime,pathlib
root=pathlib.Path(__file__).resolve().parents[1]
tab,label=sys.argv[1:3]
out=root/'data/browser-parity-20260915'/f'{label}.json'
if out.exists():raise SystemExit('Refusing to overwrite capture before executing action')
code=sys.argv[3] if len(sys.argv)>3 else 'JSON.stringify({url:location.href,text:document.body.innerText,links:Array.from(document.querySelectorAll("a")).map(a=>({text:a.innerText,href:a.href})),inputs:Array.from(document.querySelectorAll("input")).map(a=>({placeholder:a.placeholder,type:a.type})),buttons:Array.from(document.querySelectorAll("button")).map(a=>({text:a.innerText,disabled:a.disabled}))})'
script=f'tell application "Google Chrome" to execute tab id {int(tab)} of front window javascript {json.dumps(code,ensure_ascii=False)}'
start=datetime.datetime.now(datetime.timezone.utc).isoformat()
r=subprocess.run(['osascript','-e',script],capture_output=True,text=True)
payload={'startedAt':start,'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'tabId':tab,'label':label,'result':r.stdout.strip(),'error':r.stderr.strip(),'returncode':r.returncode}
try:payload['result']=json.loads(payload['result'])
except ValueError:pass
out=root/'data/browser-parity-20260915'/f'{label}.json'
if out.exists():raise SystemExit('Refusing to overwrite capture')
out.write_text(json.dumps(payload,ensure_ascii=False,indent=2))
print(json.dumps(payload,ensure_ascii=False))
