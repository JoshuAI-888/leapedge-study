import {processNext,sweep,dispatchOpenRuns} from '../../src/server/youtube-intelligence/runner.ts';
import {teamPreferences} from '../../src/server/youtube-intelligence/research-store.ts';
import {database} from '../../src/server/youtube-intelligence/database.ts';
import {runCloudWorker} from './worker-loop.ts';
let stop=false;process.on('SIGTERM',()=>{stop=true;});process.on('SIGINT',()=>{stop=true;});
const result=await runCloudWorker({admissionSeconds:Number(process.env.YTI_CLOUD_ADMISSION_SECONDS??2700),idlePolls:12},{now:Date.now,stopping:()=>stop,dispatch:dispatchOpenRuns,sweep,capacity:async()=>(await teamPreferences()).processing.parallelVideos,process:processNext,sleep:()=>new Promise(resolve=>setTimeout(resolve,1000)),close:()=>database.close(),log:value=>console.log(JSON.stringify(value))});
console.log(JSON.stringify({event:'cloud-worker-drained',...result}));
