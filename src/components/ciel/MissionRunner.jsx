import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Loader2, Play, Check, ShieldQuestion, GitBranch, Files } from 'lucide-react';

const STATUS_STYLE = {
  EXECUTED: 'text-foreground',
  AWAITING_CONFIRMATION: 'text-amber-700',
  NOT_EXECUTABLE: 'text-muted-foreground',
  REJECTED: 'text-destructive',
  REFUSED: 'text-destructive',
  AI_UNAVAILABLE: 'text-muted-foreground',
};

const OUTCOME_STYLE = {
  COMPLETED_VERIFIED: 'text-emerald-600',
  COMPLETED_PARTIALLY_VERIFIED: 'text-amber-700',
  COMPLETED_UNVERIFIED: 'text-destructive',
  BLOCKED: 'text-amber-700',
  WAITING_FOR_USER: 'text-amber-700',
  FAILED: 'text-destructive',
};

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`font-mono text-lg ${tone || ''}`}>{value}</p>
    </div>
  );
}

export default function MissionRunner() {
  const [text, setText] = useState('Écris la valeur 7 sous la clé "compteur", relis-la, puis calcule la somme de [1,2,3].');
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const invoke = async (payload) => {
    setLoading(true);
    setError(null);
    try {
      const r = await base44.functions.invoke('cielRun', payload);
      if (r.data?.error) setError(r.data.error);
      else setRes(r.data);
    } catch (e) {
      setError(e.message || 'appel impossible');
    } finally {
      setLoading(false);
    }
  };

  const runIntent = () => invoke({ intent: text });
  const runPlan = () => {
    try {
      invoke({ plan: JSON.parse(text) });
    } catch (_) {
      setError('le texte n\'est pas un plan JSON valide');
    }
  };
  const confirm = () => invoke({ confirm: res.confirmation.proposal_id });

  const v = res?.verification;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="font-medium">Exécuter une mission</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Une intention en français, ou un plan structuré JSON. Ciel classe l'intention, refuse ce
          qu'il ne peut pas faire, et ne rapporte comme réussi que ce qui a été vérifié.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          spellCheck={false}
          className="mt-3 w-full rounded-md border border-input bg-background p-3 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={runIntent} disabled={loading || !text.trim()}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            Lancer l'intention
          </Button>
          <Button variant="outline" onClick={runPlan} disabled={loading || !text.trim()}>
            <Files className="mr-2 h-4 w-4" />
            Exécuter comme plan JSON
          </Button>
        </div>
        {error && <p className="mt-3 text-sm text-destructive">Erreur : {error}</p>}
      </div>

      {res && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Statut" value={res.status} tone={STATUS_STYLE[res.status]} />
            <Stat label="Mission" value={res.outcome || '—'} tone={OUTCOME_STYLE[res.outcome]} />
            <Stat label="Vérifiées" value={v ? `${v.verified}/${v.verified + v.unverified + v.failed + v.blocked}` : '—'} />
            <Stat
              label="Chaîne"
              value={res.ledger ? (res.ledger.chain_ok ? 'intacte' : 'rompue') : '—'}
              tone={res.ledger ? (res.ledger.chain_ok ? 'text-emerald-600' : 'text-destructive') : ''}
            />
          </div>

          {res.reason && (
            <p className={`text-sm ${STATUS_STYLE[res.status] || ''}`}>{res.reason}</p>
          )}

          {res.errors?.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {res.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}

          {res.intake && (
            <p className="font-mono text-xs text-muted-foreground">
              intake: {res.intake.kind}{res.intake.executable ? ' · exécutable' : ' · non exécutable'}
            </p>
          )}

          {res.sufficiency && (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-card p-3 text-sm">
              <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p>
                  Suffisance cognitive : <span className="font-mono">{res.sufficiency.recommendation}</span>
                </p>
                <p className="text-muted-foreground">{res.sufficiency.reason}</p>
              </div>
            </div>
          )}

          {res.confirmation?.required && res.confirmation?.proposal_id && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
              <p className="font-medium">Un modèle a écrit ce plan — il ne s'exécute pas sans vous</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Empreinte <span className="font-mono text-xs">{String(res.confirmation.plan_fingerprint).slice(0, 23)}…</span>.
                Confirmer approuve exactement ce plan ; toute modification ultérieure le rendrait refusable.
              </p>
              <pre className="mt-3 max-h-64 overflow-auto rounded-md bg-white/70 p-3 font-mono text-xs">
                {JSON.stringify(res.confirmation.plan ?? res.plan, null, 2)}
              </pre>
              <Button className="mt-3" onClick={confirm} disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                Confirmer et exécuter
              </Button>
            </div>
          )}

          {res.steps?.length > 0 && (
            <div className="rounded-lg border border-border bg-card">
              <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                <GitBranch className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-heading text-sm font-semibold">Déroulé</h3>
              </div>
              <ul className="divide-y divide-border">
                {res.steps.map((s, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                    <span className="font-mono text-xs">
                      {s.capability} <span className="text-muted-foreground">({s.task_id})</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {s.verification && (
                        <span className="font-mono text-xs text-muted-foreground">{s.verification}</span>
                      )}
                      <span className={
                        ['VERIFIED', 'SUCCEEDED'].includes(s.result) ? 'text-emerald-600'
                          : ['FAILED', 'BLOCKED'].includes(s.result) ? 'text-destructive'
                            : 'text-amber-700'
                      }>
                        {s.result}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {res.reframe && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <p>
                Méta-raisonnement : <span className="font-mono">{res.reframe.source || 'AUCUN'}</span>
                {res.reframe.requires_user ? ' — une décision humaine est requise' : ''}
              </p>
              <p className="text-muted-foreground">{res.reframe.reason}</p>
            </div>
          )}

          {res.mission && (
            <p className="font-mono text-xs text-muted-foreground">
              mission {res.mission.id} · {res.ledger?.count ?? 0} événements de journal · {res.ai_calls} appel(s) au modèle
            </p>
          )}
        </>
      )}
    </div>
  );
}
