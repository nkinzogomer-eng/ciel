// Phase C — rule-based intake classification, and the honest boundary around prose.
import { suite, assert } from '../runner.ts';
import { classifyIntake } from '../../engines/goalKernel.ts';

suite('Phase C — Goal Kernel (no AI)', (test) => {
  test('a valid structured plan is an executable mission', () => {
    const r = classifyIntake({ goal: 'g', tasks: [{ id: 't1', action: { capability: 'data.transform', params: {} } }] });
    assert.equal(r.kind, 'MISSION');
    assert.equal(r.executable, true);
    assert.ok(r.plan);
  });

  test('an invalid structured plan is a mission that cannot run, with the reasons', () => {
    const r = classifyIntake({ goal: '', tasks: [] });
    assert.equal(r.kind, 'MISSION');
    assert.equal(r.executable, false);
    assert.equal(r.plan, null);
    assert.ok(r.reason.includes('invalid'));
  });

  test('a question is a question, not a mission', () => {
    assert.equal(classifyIntake('Pourquoi le disque est plein ?').kind, 'QUESTION');
    assert.equal(classifyIntake('How does the ledger work?').kind, 'QUESTION');
  });

  test('a request for advice is not executed', () => {
    const r = classifyIntake('Que penses-tu de cette architecture ?');
    assert.equal(r.kind, 'ADVICE');
    assert.equal(r.executable, false);
  });

  test('small talk stays conversation', () => {
    assert.equal(classifyIntake('bonjour').kind, 'CONVERSATION');
    assert.equal(classifyIntake('merci beaucoup').kind, 'CONVERSATION');
  });

  test('an action request in prose is a mission that is NOT executable without a model', () => {
    const r = classifyIntake('Envoie un rapport à Marc et supprime les vieux fichiers');
    assert.equal(r.kind, 'MISSION');
    assert.equal(r.executable, false);
    assert.equal(r.plan, null);
    assert.ok(r.reason.includes('without a language model'), 'the limit must be stated, not worked around');
    assert.equal(r.requires.length, 1);
  });

  test('empty input is never a mission', () => {
    assert.equal(classifyIntake('').kind, 'CONVERSATION');
    assert.equal(classifyIntake(null).executable, false);
  });
});