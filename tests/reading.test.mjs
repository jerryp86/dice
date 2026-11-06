import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1];
assert.ok(inline, 'inline app script exists');
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    id, hidden: false, disabled: false, textContent: '', innerHTML: '', value: '',
    classList: { add() {}, remove() {} },
    querySelector() { return { textContent: '' }; },
    focus() {}, scrollIntoView() {}
  });
  return elements.get(id);
}
const context = vm.createContext({
  document: { getElementById: element, createElement: () => ({ style: {}, select() {}, remove() {} }), body: { append() {} } },
  navigator: {}, location: { href: 'https://jerryp86.github.io/dice/' },
  fetch: async () => { throw new Error('network must not be called by standard reading'); },
  setTimeout, setInterval, clearInterval, console
});
vm.runInContext(inline + '\nglobalThis.__test = { planets, signs, houses, interpret, render };', context);

const fixed = {
  relationship: { question: '我和伴侶最近溝通不順，怎麼談比較好？', category: '感情與伴侶' },
  career: { question: '我該怎麼改善目前的工作流程？', category: '職涯與工作' },
  finance: { question: '我正在考慮投資，如何先評估風險？', category: '財務與資源' }
};
const dice = { p: context.__test.planets.find(x => x.n === '水星'), s: context.__test.signs.find(x => x.n === '天秤座'), h: context.__test.houses.find(x => x.n === '第七宮・關係') };
for (const [name, sample] of Object.entries(fixed)) {
  test(`fixed dice produce practical ${name} reading`, () => {
    const result = context.__test.interpret(dice, sample.question);
    assert.equal(result.category, sample.category);
    assert.equal(result.steps.length, 3);
    assert.ok(result.planetLine.includes('水星'));
    assert.ok(result.zodiacLine.includes('天秤座'));
    assert.ok(result.houseLine.includes('第七宮・關係'));
    assert.ok(result.strengths.includes('為何在意'));
    assert.ok(result.tension.includes('拉扯') || result.tension.includes('忽略'));
    assert.ok(result.steps.every(step => step.length > 40));
  });
}

test('standard result rendering escapes question text before inserting HTML', () => {
  context.__test.render(dice, '<img src=x onerror=alert(1)> 工作');
  const output = element('interpretation').innerHTML;
  assert.ok(!output.includes('<img'));
  assert.ok(output.includes('&lt;img'));
});
