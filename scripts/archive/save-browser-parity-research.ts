/** Persist browser research after testing; this does not invoke analysis or change prompts. */
import {readFileSync} from 'node:fs';
import {put} from '../src/server/youtube-intelligence/research-store.ts';
import {db} from '../src/server/youtube-intelligence/store.ts';
const id='fresh-browser-parity-20260915';
const results=JSON.parse(readFileSync('docs/browser-parity-results-20260915.json','utf8'));
try {
 await put('captionBenchmark',id,{id,at:new Date().toISOString(),results,runtime:'Production browser workflows; observed latency upper bounds; three fresh matched cases plus one recovery retry; no fresh audio accuracy score.'});
 await put('improvement',id,{id,title:'Fresh browser parity: Chinese alignment, conditions, playback and share scope',status:'proposed',proposal:'Fix Chinese evidence alignment and empty outcome state; retain numeric operators; canonicalize instrument aliases; restore citation playback; freeze shared payload selection. Then blind-score fresh source windows and rerun paired browser tests.',outcome:'Not at parity. Short English broadly comparable; Chinese report empty; long retry completed with duplicate SoFi and flattened under-price conditions. Temporary share revoked and 404 verified after scope mismatch.',results});
 await put('researchWhitePaper',id,{id,at:new Date().toISOString(),markdown:readFileSync('docs/browser-parity-report-20260915.md','utf8'),scriptManifest:['scripts/browser-parity.py','scripts/browser-parity-screenshot.py','scripts/summarize-browser-parity.py','scripts/save-browser-parity-research.ts']});
 console.log('Browser comparison findings saved. No prompt or model setting changed.');
} finally {await db().close();}
