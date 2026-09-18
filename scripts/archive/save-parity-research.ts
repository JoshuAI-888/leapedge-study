import {readFileSync} from 'node:fs';
import {put,addPrompt,promptVersions} from '../src/server/youtube-intelligence/research-store.ts';
import {db} from '../src/server/youtube-intelligence/store.ts';
import {semanticPrompts} from '../evaluations/native-google/semantic-prompts.ts';
const id='human-review-v9-leapedge-20260915';
const results=JSON.parse(readFileSync('docs/v9-results-20260915.json','utf8'));
const facts=JSON.parse(readFileSync('docs/reviewed-facts-20260915.json','utf8'));
const prompt=semanticPrompts();
try {
 if(!(await promptVersions()).some(p=>p.id===prompt.id))await addPrompt(prompt);
 await put('captionBenchmark',id,{id,at:new Date().toISOString(),results,facts,runtime:'Development only; no overall accuracy or timing score; LeapEdge reports may be cached'});
 await put('improvement',id,{id,title:'V9 semantic-level experiment and LeapEdge comparison',status:'proposed',proposal:prompt.rationale,outcome:'Not promoted. Stop qualifier improved, yield-role error remains; Alpha structural rejection and long-video schema failure. LeapEdge also shows Apple entry/resistance and Coinbase stop inconsistencies.',results});
 await put('researchWhitePaper',id,{id,at:new Date().toISOString(),markdown:readFileSync('docs/parity-checkpoint-20260915.md','utf8')+'\n\n'+readFileSync('docs/leapedge-side-by-side-20260915.md','utf8'),scriptManifest:['scripts/import-blind-review.py','scripts/score-reviewed-facts.py','evaluations/native-google/selection-synthesis.ts','evaluations/native-google/semantic-prompts.ts','scripts/save-parity-research.ts']});
 console.log('Parity findings saved; default prompt unchanged.');
} finally {await db().close();}
