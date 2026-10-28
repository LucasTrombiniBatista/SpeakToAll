const test = require('node:test');
const assert = require('node:assert');
const { buildMarkdown, safeFolder } = require('../src/main/integrations/obsidian');

test('título com quebra de linha vira um único H1', () => {
  const md = buildMarkdown({ title: 'T\n# x', body: 'b' });
  assert.match(md, /^# T # x$/m);
  assert.doesNotMatch(md, /^# x$/m);
});

test('origin e language ficam entre aspas no frontmatter', () => {
  const md = buildMarkdown({ title: 'T' }, { source: 'a\nevil: 1', language: 'pt' });
  assert.ok(md.includes('origin: "a\\nevil: 1"'));
  assert.doesNotMatch(md, /^evil:/m);
});

test('safeFolder remove ..', () => {
  assert.strictEqual(safeFolder('../../x/./y'), 'x/y');
});
