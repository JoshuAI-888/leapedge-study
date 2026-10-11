import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isEnglishLanguage, needsTranslation, translationPayload, applyTranslations, translationTargets, type TranslationTarget, type TranslatedMention } from '../src/server/youtube-intelligence/schemas/translation.ts';
import { Source, Mention, deriveEvidence } from '../src/features/youtube-intelligence/contracts.ts';
function target(id: string, text: string) {
  let translated: string | undefined;
  const value: TranslationTarget = { id, text_original: text, text_hash: createHash('sha256').update(text).digest('hex'), current: () => text, apply: (s) => { translated = s; } };
  return { value, translated: () => translated };
}
test('English language names and tags skip translation but mixed Han evidence never does', () => {
  for (const language of ['English', ' english ', 'EN', 'en-US', 'en_GB', 'eng', 'asr-en', 'asr-en-US']) {
    assert.equal(isEnglishLanguage(language), true, language);
    assert.equal(needsTranslation('Revenue rose 20%.', language), false, language);
    assert.equal(needsTranslation('Revenue 增長 20%.', language), true, language);
  }
  for (const language of ['French', 'fr', 'Spanish', 'zh', 'English and Chinese']) {
    assert.equal(needsTranslation('Revenue rose 20%.', language), true, language);
  }
});
test('identical copied spans are sent once and translation reaches every original target', () => {
  const a = target('c1.e1', '收入增長20%'); const b = target('m1', '收入增長20%'); const c = target('k1.e1', '利潤下降');
  const targets = [a.value, b.value, c.value];
  assert.deepEqual(translationPayload(targets).spans.map(s => s.id), ['c1.e1', 'k1.e1']);
  applyTranslations(targets, [{ id: 'c1.e1', translation_en: 'Revenue grew 20%.' }, { id: 'k1.e1', translation_en: 'Profit fell.' }]);
  assert.equal(a.translated(), 'Revenue grew 20%.'); assert.equal(b.translated(), a.translated()); assert.equal(c.translated(), 'Profit fell.');
});
test('corrupt duplicate hash and changed copied evidence fail before writing any translation', () => {
  const a = target('c1.e1', '收入'); const b = target('m1', '收入');
  b.value.text_hash = 'corrupt';
  assert.throws(() => translationPayload([a.value, b.value]), /hash|changed/);
  assert.throws(() => applyTranslations([a.value, b.value], [{ id: a.value.id, translation_en: 'Revenue' }]), /hash|changed/);
  assert.equal(a.translated(), undefined);
});
test('invalid returned IDs fail atomically before writing any translation', () => {
  const a = target('c1.e1', '收入');
  assert.throws(() => applyTranslations([a.value], [{ id: a.value.id, translation_en: 'Revenue' }, { id: 'alien', translation_en: 'Other' }]), /not sent/);
  assert.equal(a.translated(), undefined);
});
test('a span answered twice keeps its first translation instead of failing the run', () => {
  const a = target('k10.e1', '股价测试支撑');
  applyTranslations([a.value], [{ id: 'k10.e1', translation_en: 'The price tests support.' }, { id: 'k10.e1', translation_en: 'Shares test support.' }]);
  assert.equal(a.translated(), 'The price tests support.');
});
function disjointMention() {
 const source=Source.parse({source_kind:'captions',language:'zh',segments:[{id:'first',text:'我关注增长。',start_seconds:0,end_seconds:3},{id:'gap',text:'无关的间隔。',start_seconds:4,end_seconds:7},{id:'later',text:'但债务和百分之八的资本回报不适合我。',start_seconds:521,end_seconds:529}]});
 const range=(id:string)=>{const derived=deriveEvidence(source,{start_id:id,end_id:id});return {start_id:id,end_id:id,start_seconds:derived.start_seconds,end_seconds:derived.end_seconds,text_hash:derived.text_hash};};
 const mention:TranslatedMention=Mention.parse({ticker:null,instrument_as_spoken:'Company',market:'unknown',stance:'watch',sentiment:'neutral',rationale_en:'Growth and personal reservations.',is_call:false,claim_id:null,source_span:range('first'),source_ranges:[range('first'),range('later')]});
 return {source,mention};
}
test('each disjoint mention range translates separately, preserving navigation and original bytes',()=>{
 const {source,mention}=disjointMention();const original=structuredClone(source);
 const targets=translationTargets({source,mentions:[mention],claims:[],keyPoints:[],language:'zh'});
 assert.deepEqual(translationPayload(targets).spans.map(s=>s.id),['m1','m1.r2']);
 assert.deepEqual(translationPayload(targets).spans.map(s=>s.text_original),['我关注增长。','但债务和百分之八的资本回报不适合我。']);
 applyTranslations(targets,[{id:'m1',translation_en:'I watch growth.'},{id:'m1.r2',translation_en:'But debt and an eight percent return on capital do not suit me.'}]);
 assert.equal(mention.source_span.translation_en,'I watch growth.');
 assert.equal(mention.source_ranges?.[0].translation_en,'I watch growth.');
 assert.match(mention.source_ranges?.[1].translation_en ?? '',/eight percent/);
 assert.deepEqual(source,original);
});
test('missing or corrupted secondary translations cannot leave a partly translated mention',()=>{
 const {source,mention}=disjointMention();
 const targets=translationTargets({source,mentions:[mention],claims:[],keyPoints:[],language:'zh'});
 assert.throws(()=>applyTranslations(targets,[{id:'m1',translation_en:'I watch growth.'}]),/no translation/);
 assert.equal(mention.source_span.translation_en,undefined);
 assert.equal(mention.source_ranges?.[1].translation_en,undefined);
 mention.source_ranges![1].text_hash='a'.repeat(64);
 assert.throws(()=>translationTargets({source,mentions:[mention],claims:[],keyPoints:[],language:'zh'}),/hash/);
});
test('historical single-pointer mention keeps m1 translation identity without adding new ranges',()=>{
 const {source,mention}=disjointMention();delete mention.source_ranges;
 const targets=translationTargets({source,mentions:[mention],claims:[],keyPoints:[],language:'zh'});
 assert.deepEqual(targets.map(t=>t.id),['m1']);
 applyTranslations(targets,[{id:'m1',translation_en:'I watch growth.'}]);
 assert.equal(mention.source_span.translation_en,'I watch growth.');assert.equal(mention.source_ranges,undefined);
});
