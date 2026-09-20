import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isEnglishLanguage, needsTranslation, translationPayload, applyTranslations, type TranslationTarget } from '../src/server/youtube-intelligence/schemas/translation.ts';
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
