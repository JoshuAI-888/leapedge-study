"""Reproduce the 16:9 architecture as editable SVG and PNG; no network calls."""
from pathlib import Path
from html import escape
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).parent
W, H = 2560, 1440
im = Image.new('RGB', (W, H), '#F3F6FA')
d = ImageDraw.Draw(im)
svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">', '<title>YouTube Intelligence — proposed target architecture</title>', '<desc>Keep caption providers, pilot native Google ingestion, preserve evidence validation and compare cautiously with LeapEdge.</desc>']
NAVY='#142D48'; MUTED='#51657A'; BLUE='#1767CE'; GREEN='#087B61'; AMBER='#9B6200'; RED='#A34545'
def rect(x,y,w,h,fill,stroke=None,r=18):
    d.rounded_rectangle((x,y,x+w,y+h),radius=r,fill=fill,outline=stroke,width=2)
    svg.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke or "none"}" stroke-width="2"/>')
def text(x,y,s,size=25,color=NAVY,bold=False):
    font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial'+(' Bold' if bold else '')+'.ttf',size)
    d.text((x,y),s,font=font,fill=color,anchor='lt')
    svg.append(f'<text x="{x}" y="{y+size*.80}" font-family="Arial, sans-serif" font-size="{size}" font-weight="{700 if bold else 400}" fill="{color}">{escape(s)}</text>')
def lines(x,y,ss,size=25,color=MUTED,gap=35):
    for i,s in enumerate(ss): text(x,y+i*gap,s,size,color)
def pill(x,y,label,color,bg,w):
    rect(x,y,w,37,bg,r=8); text(x+12,y+8,label,19,color,True)
def arrow(x,y):
    d.line((x,y,x+24,y),fill=BLUE,width=3);d.polygon([(x+24,y),(x+16,y-7),(x+16,y+7)],fill=BLUE)
    svg.append(f'<path d="M{x},{y} h24 m-8,-7 l8,7 -8,7" fill="none" stroke="{BLUE}" stroke-width="3"/>')

rect(0,0,W,H,'#F3F6FA',r=0)
text(48,36,'YOUTUBE INTELLIGENCE',23,BLUE,True)
text(48,79,'A simpler acquisition path. An uncompromised evidence trail.',51,NAVY,True)
text(48,148,'PROPOSED TARGET  /  15 SEP 2026  /  Standalone now → Finradar · Intelligence → YouTube Intelligence',25,MUTED)
pill(1670,32,'KEEP',GREEN,'#E3F3EC',100)
pill(1785,32,'PILOT / CONDITIONAL',AMBER,'#FFF0D5',265)
pill(2065,32,'OUT OF TARGET PATH',RED,'#F6E8E8',290)

xs=[48,547,1046,1545,2044]; bw=468
for i,x in enumerate(xs):
    rect(x,215,bw,510,'#FFFFFF','#DCE4EE')
    text(x+24,238,f'0{i+1}',24,BLUE,True)
    if i<4: arrow(x+bw+3,470)

x=xs[0]
text(x+24,280,'Discover & schedule',32,NAVY,True)
pill(x+24,336,'KEEP · YOUTUBE DATA API',GREEN,'#E3F3EC',340)
lines(x+24,399,['Video URLs • channels • new uploads','Titles, duration and source identity','Metadata key ≠ arbitrary captions'],24)
text(x+24,532,'Vercel job orchestration',27,NAVY,True)
lines(x+24,576,['Bounded stages, leases and retries','Idempotent jobs; spend reservations','Resume failures without double work'],24)

x=xs[1]
text(x+24,280,'Acquire the source',32,NAVY,True)
text(x+24,338,'KEEP  TranscriptAPI → Supadata',25,GREEN,True)
lines(x+24,381,['Primary captions → caption backup','Historical median: 0.77s → 2.88s','Both retrieved 4/6 test videos'],24,gap=32)
pill(x+24,502,'PILOT · NATIVE GEMINI API',AMBER,'#FFF0D5',345)
lines(x+24,557,['When captions fail: YouTube fileUri','Tested: gemini-3.8-flash, static mode','Short clip re-extraction for repair','Promote only after accuracy gates'],24,gap=32)

x=xs[2]
text(x+24,280,'Validate & preserve',32,NAVY,True)
text(x+24,341,'KEEP  Evidence validation',25,GREEN,True)
lines(x+24,390,['Source ID • duration • schema','Quote anchors • tickers • price roles','Original language + raw artifacts','Explicit empty / timeout / invalid states'],24,gap=35)
rect(x+20,550,bw-40,147,'#FFF6E6',r=12)
text(x+36,568,'TRUST BOUNDARY',22,AMBER,True)
lines(x+36,607,['Valid structure ≠ accurate speech.','Reject invalid evidence; review doubts.','No silent repair or “100%” guarantee.'],22,AMBER,gap=28)

x=xs[3]
text(x+24,280,'Synthesize & audit',32,NAVY,True)
text(x+24,341,'KEEP  OpenRouter · text models',25,GREEN,True)
lines(x+24,390,['Gemini 3.8 draft → Gemini 3.5 critic','English synthesis; original quotes','Exact quote checks + semantic audit','Separate entries, levels and holdings'],24,gap=35)
pill(x+24,551,'CONDITIONAL REMOVAL',AMBER,'#FFF0D5',315)
lines(x+24,607,['Retire OpenRouter MEDIA fallback','only when native passes its gates.','Text routing stays for now.'],24,gap=31)

x=xs[4]
text(x+24,280,'Research & monitor',32,NAVY,True)
lines(x+24,340,['Analysis • idea library • channel views','Settings: prompts, tokens, A/B history','KEEP FMP: adjusted prices + SPY','KEEP Resend: scheduled digests'],24,gap=37)
text(x+24,528,'Finradar integration later',26,NAVY,True)
lines(x+24,574,['Reuse auth, owner scope and services','Accumulate forward channel cohorts','Show benchmark rules and sample size','No new account / billing subsystem'],24,gap=32)

rect(48,755,2464,119,NAVY,r=16)
text(73,779,'KEEP · VERCEL + NEON',27,'#FFFFFF',True)
lines(73,824,['UI / API + durable job state'],23,'#CBD9E9')
text(560,779,'SOURCE & AUDIT RECORD',25,'#FFFFFF',True)
text(560,824,'Sources, hashes, quotes, failures, model versions',23,'#CBD9E9')
text(1230,779,'EXPERIMENT & BUDGET RECORD',25,'#FFFFFF',True)
text(1230,824,'Prompt versions, A/B outcomes, tokens, spend caps',23,'#CBD9E9')
text(1920,779,'SIMPLIFICATION',25,'#FFFFFF',True)
text(1920,824,'No vector DB needed for this pipeline',23,'#CBD9E9')

for x in [48,880,1712]: rect(x,906,800,431,'#FFFFFF','#DCE4EE')
x=72
text(x,931,'OUT OF THE TARGET PATH — WHY',27,RED,True)
lines(x,979,[
 'Tapline — same 4/6 coverage; slower than TranscriptAPI.',
 'BibiGPT — 2 empty-caption “successes”; minutes debited;',
 'Mandarin QQQ → Q discrepancy versus retained captions.',
 'YouTube.js / free scraping — no proven cloud advantage.',
 'Supadata generated ASR — hold: tested 403 responses.',
 'Alpha Vantage — reserve only; FMP avoids duplication.'
],24,gap=39)
text(x,1243,'Archive adapters and results; do not cancel accounts.',23,MUTED,True)
text(x,1280,'These are proposed routing decisions, not deployed changes.',22,MUTED)

x=904
text(x,931,'WHAT OUR TESTING ESTABLISHED',27,BLUE,True)
lines(x,979,[
 'Native: 12:59 caption-unavailable case passed structure;',
 '40:23 video also passed. Audio accuracy is still unscored.',
 '31:59 macro failed timestamp bounds; two 90s clips',
 'passed locally. No automatic repair has been approved.',
 'Quote A/B: 1/9 → 8/9 text-audit passes on one source.',
 'Critic still missed a condition; some views were omitted.'
],24,gap=39)
text(x,1243,'NEXT GATE: independent audio + held-out repeat tests.',23,AMBER,True)
text(x,1280,'Then hosted reliability, cost limits and rollback testing.',23,MUTED)

x=1736
text(x,931,'VERSUS LEAPEDGE',27,BLUE,True)
lines(x,979,[
 'Similar: discovery → evidence → synthesis → critique.',
 'LeapEdge reports Firebase / GCP; we retain Vercel / Neon.',
 'Its exact transcript vendor and prompt text are unknown.',
 'Captured Alpha output: 4 ideas + 9 points; one entry',
 'appeared to be resistance. Overall parity is unproven.',
 'Our target adds inspectable sources, failures and A/B runs.'
],24,gap=39)
text(x,1243,'RISKS: shared YouTube access, drift, missed claims, cost.',23,AMBER,True)
text(x,1280,'No vendor chain or critic guarantees truthful coverage.',23,MUTED)

text(48,1370,'Evidence: native-google-findings-white-paper.md + provider test artifacts  •  Historical small samples; timings are not SLA measurements.',22,MUTED)
text(48,1405,'Status: native ingestion and candidate quote prompt remain experimental. No production routing or provider subscriptions changed by this diagram.',20,MUTED)
svg.append('</svg>')
(OUT/'youtube-intelligence-target-architecture.svg').write_text('\n'.join(svg))
im.save(OUT/'youtube-intelligence-target-architecture.png')
print(f'Rendered {W}×{H} PNG + SVG in {OUT}')
