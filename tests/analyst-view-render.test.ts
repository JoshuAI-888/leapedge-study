import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnalystView, analystNote } from "../src/features/youtube-intelligence/analyst-view.ts";

// Render real TSX, with the app's existing TypeScript compiler. No browser,
// paid provider, dependency or source-text assertion substitutes for markup.
registerHooks({
  resolve(specifier, context, next) {
    return next(specifier === "next/link" ? "next/link.js" : specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith(".tsx")) return {format:"module",shortCircuit:true,source:ts.transpileModule(readFileSync(fileURLToPath(url),"utf8"),{
      compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},
    }).outputText};
    return next(url,context);
  },
});
const { AnalystViewPanel } = await import("../src/features/youtube-intelligence/ui/AnalystView.tsx");
const point = {id:"s1",topic:"Planet Labs",kind:"creator_view",speaker:"creator",text:"The creator watches Planet Labs if backlog converts.",at:30,references:[{evidenceId:"c1",startId:"s8",endId:"s9",text:"Watch if backlog converts.",at:30}]};
function view() {
 return AnalystView.parse({title:"Original video",heading:"PL · Planet Labs — Creator watches",publicationState:"coverage_in_progress",channel:null,publishedAt:null,summary:[{text:point.text,at:30,references:point.references}],sections:[
  {key:"thesis",title:"Thesis",points:[point]},
  {key:"countercase",title:"Countercase",points:[]},
  {key:"evidence",title:"Evidence",points:[point]},
 ],stance:{bullish:0,bearish:0,neutral:0},ideas:[],sentiment:[],otherMentions:[],themes:[],keyPoints:[],numbers:[],notStated:[],watchOuts:[],diagnostics:[]});
}

test("checked findings render honest progress, semantic sections and exact evidence destinations",()=>{
 const v=view();
 const html=renderToStaticMarkup(createElement(AnalystViewPanel,{view:v,note:analystNote(v),onSeek:()=>{}}));
 assert.match(html,/>30-second brief<\/h2>/);
 assert.match(html,/Checked findings — full-source coverage still in progress/);
 assert.match(html,/<h2>Thesis<\/h2>/);
 assert.match(html,/<h3>Planet Labs<\/h3>/);
 assert.match(html,/href="#yi-av-evidence-s1"/);
 assert.match(html,/id="yi-av-evidence-s1"/);
 assert.match(html,/Watch if backlog converts\./);
 assert.match(html,/Play from 0:30/);
 assert.match(html,/coverage is still in progress/);
 assert.doesNotMatch(html,/No actionable idea was stated/);
});

test("short company headings render a long thesis as body text without hiding conditions",()=>{
 const v=view();
 v.sections=[];
 v.ideas=[{key:"PL",ticker:"PL",name:"Planet Labs",spoken:null,market:null,resolvedBy:null,action:"watch",stance:"watch",owner:"creator",ownerName:null,conviction:"unspecified",horizon:null,thesis:point.text,also:[],levels:[],option:null,size:null,conditions:["if profitable","if backlog converts","if margins improve"],risks:["Dilution","Losses","Execution"],catalysts:[],quote:null,claimIds:["c1"]}];
 const html=renderToStaticMarkup(createElement(AnalystViewPanel,{view:v,note:analystNote(v),onSeek:()=>{}}));
 assert.match(html,/<h3>PL · Creator Watching<\/h3>/);
 assert.match(html,/<p>The creator watches Planet Labs if backlog converts\.<\/p>/);
 assert.match(html,/if profitable; if backlog converts; if margins improve/);
 assert.match(html,/Dilution; Losses; Execution/);
});
