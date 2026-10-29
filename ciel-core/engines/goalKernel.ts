// Goal Kernel — rule-based intake classification (spec §13, amendment 4.6). Phase C, no AI.
//
// Honest boundary: these rules classify the INTENT of an input. Turning free-form prose
// into an executable plan requires a language model and is NOT implemented here — the
// kernel says so explicitly instead of improvising a plan.
import { IntakeKind } from '../core/types.ts';
import { validatePlan } from '../domain/plan.ts';

const QUESTION_MARKERS = ['?', 'pourquoi', 'comment', 'qu\'est-ce', 'quoi', 'qui', 'quand', 'où', 'combien', 'why', 'how', 'what', 'who', 'when', 'where'];
const ADVICE_MARKERS = ['conseille', 'recommande', 'devrais-je', 'que penses-tu', 'ton avis', 'should i', 'advise', 'recommend', 'what do you think'];
const SMALL_TALK = ['bonjour', 'salut', 'merci', 'ça va', 'hello', 'hi ', 'thanks', 'thank you'];
const ACTION_MARKERS = ['crée', 'créer', 'ajoute', 'envoie', 'supprime', 'déploie', 'lance', 'exécute', 'mets à jour', 'configure',
  'écris', 'ecris', 'écrire', 'stocke', 'enregistre', 'relis', 'calcule', 'vérifie', 'verifie', 'génère', 'genere',
  'planifie', 'organise', 'traite', 'analyse', 'corrige', 'répare', 'repare', 'installe', 'publie', 'remplace',
  'create', 'add', 'send', 'delete', 'deploy', 'run', 'execute', 'update', 'build', 'fix',
  'write', 'save', 'store', 'calculate', 'check', 'generate', 'analyze', 'repair', 'install', 'publish', 'replace'];

function hits(text, markers) {
  const t = text.toLowerCase();
  return markers.filter((m) => t.includes(m));
}

export function classifyIntake(input) {
  // A structured plan is unambiguous: it is a mission, and it is executable now.
  if (input && typeof input === 'object' && Array.isArray(input.tasks)) {
    const v = validatePlan(input);
    return {
      kind: IntakeKind.MISSION, executable: v.ok, plan: v.ok ? input : null,
      reason: v.ok ? 'structured plan received' : `structured plan is invalid: ${v.errors.join('; ')}`,
      requires: v.ok ? [] : ['a valid structured plan'],
    };
  }

  const text = String(input ?? '').trim();
  if (!text) return { kind: IntakeKind.CONVERSATION, executable: false, plan: null, reason: 'empty input', requires: [] };

  const advice = hits(text, ADVICE_MARKERS);
  if (advice.length) return { kind: IntakeKind.ADVICE, executable: false, plan: null, reason: `advice markers: ${advice.join(', ')}`, requires: [] };

  const question = hits(text, QUESTION_MARKERS);
  const action = hits(text, ACTION_MARKERS);
  if (question.length && !action.length) return { kind: IntakeKind.QUESTION, executable: false, plan: null, reason: `question markers: ${question.join(', ')}`, requires: [] };

  if (action.length) {
    return {
      kind: IntakeKind.MISSION, executable: false, plan: null,
      reason: `action markers: ${action.join(', ')} — this rule-based kernel cannot derive an executable plan from prose without a language model`,
      requires: ['a structured mission plan, or ai.enabled with a reachable intelligence provider'],
    };
  }

  const small = hits(text, SMALL_TALK);
  return {
    kind: IntakeKind.CONVERSATION, executable: false, plan: null,
    reason: small.length ? `small talk: ${small.join(', ')}` : 'no action, question or advice marker found',
    requires: [],
  };
}