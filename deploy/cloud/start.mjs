import {spawn} from 'node:child_process';
const mode=process.argv[2]??'web';
if(!['web','worker','migrate','experiment'].includes(mode))throw Error('Unknown container mode.');
if(process.env.YTI_DB==='pglite'||!process.env.DATABASE_URL)throw Error('Cloud deployment requires durable PostgreSQL.');
let databaseUrl;try{databaseUrl=new URL(process.env.DATABASE_URL);}catch{throw Error('Invalid cloud PostgreSQL connection configuration.');}
const socket=databaseUrl.searchParams.get('host');
const cloudSocket=!!socket&&/^\/cloudsql\/[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$/.test(socket);
if(socket&&!cloudSocket)throw Error('Unsupported cloud PostgreSQL socket.');
if(!['postgres:','postgresql:'].includes(databaseUrl.protocol)||(!cloudSocket&&(databaseUrl.hostname==='localhost'||databaseUrl.hostname==='[::1]'||databaseUrl.hostname.startsWith('127.'))))throw Error('Cloud deployment requires a cloud PostgreSQL endpoint.');
if(mode==='web'){
 const origin=new URL(process.env.YTI_APP_ORIGIN??'');
 if(origin.protocol!=='https:'||!process.env.YTI_ACCESS_TOKEN||process.env.YTI_ACCESS_TOKEN.length<32)throw Error('Hosted web requires HTTPS origin and strong access secret.');
}
let experimentArgs=[];
if(mode==='experiment'){
 if(process.env.YTI_CLOUD_EXPERIMENT_ENABLED!=='true'||!process.env.DATABASE_URL_UNPOOLED)throw Error('Cloud experiment execution requires explicit enablement and dedicated direct database.');
 const execution=process.env.CLOUD_RUN_EXECUTION??'';if(!/^[a-z0-9-]+$/.test(execution))throw Error('Cloud execution identity required.');
 experimentArgs=['--experimental-strip-types','scripts/targeted-audit-paired.ts','run','--live','--bundle','/bundle/bundle.json','--evaluation-dir','/bundle/evaluation','--out',`/results/${execution}.json`,'--max-minutes','180',...(process.env.YTI_CLOUD_EXPERIMENT_RESUME==='true'?['--resume']:[])];
}
const args=mode==='experiment'?experimentArgs:mode==='web'?['node_modules/next/dist/bin/next','start','--hostname','0.0.0.0','--port',process.env.PORT??'8080']:['--experimental-strip-types',mode==='worker'?'deploy/cloud/worker.ts':'scripts/migrate.ts'];
const child=spawn(process.execPath,args,{stdio:'inherit',env:process.env});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
child.on('error',()=>{console.error('Container child failed to start.');process.exitCode=1;});
child.on('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
