import { suite, assert } from '../runner.ts';
import { MissionStatus, TaskStatus } from '../../core/types.ts';
import { createMission, createTask, transitionMission, transitionTask, readyTasks, missionOutcome } from '../../domain/mission.ts';
import { fixedClock } from '../../core/clock.ts';

const clock = fixedClock();
const now = clock.now();

suite('Phase A · Mission & Task state machines', (test) => {
  test('a mission starts CREATED and follows the legal path to RUNNING', () => {
    let m = createMission({ id: 'm1', goal: 'test', now });
    assert.equal(m.status, MissionStatus.CREATED);
    m = transitionMission(m, MissionStatus.COMPILED, { now });
    m = transitionMission(m, MissionStatus.RUNNING, { now });
    assert.equal(m.status_history.length, 3);
  });

  test('illegal transitions are rejected (CREATED -> RUNNING)', () => {
    const m = createMission({ id: 'm1', goal: 'test', now });
    assert.throws(() => transitionMission(m, MissionStatus.RUNNING, { now }), 'ILLEGAL_TRANSITION');
  });

  test('WAITING_FOR_USER requires the question and why it is needed', () => {
    let m = createMission({ id: 'm1', goal: 'test', now });
    m = transitionMission(m, MissionStatus.COMPILED, { now });
    m = transitionMission(m, MissionStatus.RUNNING, { now });
    assert.throws(() => transitionMission(m, MissionStatus.WAITING_FOR_USER, { now }), 'QUESTION_REQUIRED');
    m = transitionMission(m, MissionStatus.WAITING_FOR_USER, { now, question: { text: 'Which repo?', why_needed: 'target is ambiguous' } });
    assert.equal(m.pending_question.text, 'Which repo?');
    m = transitionMission(m, MissionStatus.RUNNING, { now, reason: 'user answered' });
    assert.equal(m.pending_question, null);
  });

  test('WAITING_FOR_USER and BLOCKED are distinct states with distinct exits', () => {
    let m = createMission({ id: 'm1', goal: 'test', now });
    m = transitionMission(m, MissionStatus.COMPILED, { now });
    m = transitionMission(m, MissionStatus.RUNNING, { now });
    const blocked = transitionMission(m, MissionStatus.BLOCKED, { now });
    assert.throws(() => transitionMission(blocked, MissionStatus.WAITING_FOR_USER, { now }), 'ILLEGAL_TRANSITION');
    // BLOCKED may end as FAILED; WAITING_FOR_USER may not (it can only resume or be cancelled).
    transitionMission(blocked, MissionStatus.FAILED, { now });
    const waiting = transitionMission(m, MissionStatus.WAITING_FOR_USER, { now, question: { text: 'q', why_needed: 'w' } });
    assert.throws(() => transitionMission(waiting, MissionStatus.FAILED, { now }), 'ILLEGAL_TRANSITION');
  });

  test('task attempts increment on RUNNING; terminal task states have no exits', () => {
    let t = createTask({ id: 't1', mission_id: 'm1', action: { capability: 'compute' }, now });
    t = transitionTask(t, TaskStatus.READY, { now });
    t = transitionTask(t, TaskStatus.RUNNING, { now });
    assert.equal(t.attempts, 1);
    t = transitionTask(t, TaskStatus.FAILED, { now });
    t = transitionTask(t, TaskStatus.READY, { now, reason: 'retry' });
    t = transitionTask(t, TaskStatus.RUNNING, { now });
    assert.equal(t.attempts, 2);
    t = transitionTask(t, TaskStatus.CANCELLED, { now });
    assert.throws(() => transitionTask(t, TaskStatus.READY, { now }), 'ILLEGAL_TRANSITION');
  });

  test('readyTasks: dependencies must be SUCCEEDED or VERIFIED; UNVERIFIED does not unlock', () => {
    const a = { ...createTask({ id: 'a', mission_id: 'm', action: { capability: 'x' }, now }), status: TaskStatus.UNVERIFIED };
    const b = createTask({ id: 'b', mission_id: 'm', action: { capability: 'x' }, dependencies: ['a'], now });
    assert.deepEqual(readyTasks([a, b]).map((t) => t.id), []);
    assert.deepEqual(readyTasks([{ ...a, status: TaskStatus.VERIFIED }, b]).map((t) => t.id), ['b']);
  });

  test('missionOutcome is honest: partial verification is not SUCCESS', () => {
    const mk = (id, status) => ({ ...createTask({ id, mission_id: 'm', action: { capability: 'x' }, now }), status });
    assert.equal(missionOutcome([mk('a', 'VERIFIED'), mk('b', 'VERIFIED')]), MissionStatus.COMPLETED_VERIFIED);
    assert.equal(missionOutcome([mk('a', 'VERIFIED'), mk('b', 'UNVERIFIED')]), MissionStatus.COMPLETED_PARTIALLY_VERIFIED);
    assert.equal(missionOutcome([mk('a', 'UNVERIFIED')]), MissionStatus.COMPLETED_UNVERIFIED);
    assert.equal(missionOutcome([mk('a', 'VERIFIED'), mk('b', 'PENDING')]), null);
    assert.equal(missionOutcome([mk('a', 'FAILED'), mk('b', 'VERIFIED')]), MissionStatus.FAILED);
    assert.equal(missionOutcome([mk('a', 'BLOCKED')]), MissionStatus.BLOCKED);
    assert.equal(missionOutcome([mk('a', 'WAITING_FOR_USER')]), MissionStatus.WAITING_FOR_USER);
    assert.equal(missionOutcome([mk('a', 'SUPERSEDED')]), MissionStatus.UNKNOWN);
  });
});