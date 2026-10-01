"""Capture the selected Chrome window region; inspect saved PNG before citing it."""
import subprocess,sys,time,pathlib,os
root=pathlib.Path(__file__).resolve().parents[1]
tab,label=sys.argv[1:3]
window_id=os.environ.get('CHROME_CAPTURE_WINDOW_ID')
if not window_id or not window_id.isdigit():raise SystemExit('Set CHROME_CAPTURE_WINDOW_ID to the inspected Chrome CGWindowID (6846 in the recorded session).')
ids=subprocess.check_output(['osascript','-e','tell application "Google Chrome" to get id of every tab of front window'],text=True).strip().split(', ')
index=[int(v) for v in ids].index(int(tab))+1
script=f'''tell application "Google Chrome"
activate
set active tab index of front window to {index}
get bounds of front window
end tell'''
bounds=subprocess.check_output(['osascript','-e',script],text=True).strip().split(', ')
x,y,r,b=map(int,bounds)
time.sleep(2)
out=root/'data/browser-parity-20260915'/f'{label}.png'
if out.exists():raise SystemExit('Refusing overwrite')
subprocess.run(['screencapture','-x','-o','-l',window_id,str(out)],check=True)
print(out)
