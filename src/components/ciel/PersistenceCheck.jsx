import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Loader2, Play, Check, X } from 'lucide-react';

export default function PersistenceCheck() {
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    const r = await base44.functions.invoke('cielPersistenceCheck', {});
    setRes(r.data);
    setLoading(false);
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">Persistance réelle (hors mémoire)</p>
          <p className="text-sm text-muted-foreground">
            Une mission est exécutée sur un stockage persistant, puis relue par un runtime neuf — la simulation de redémarrage.
          </p>
        </div>
        <Button onClick={run} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
          Lancer le contrôle
        </Button>
      </div>

      {res?.error && <p className="mt-4 text-sm text-destructive">Erreur : {res.error}</p>}

      {res?.checks && (
        <ul className="mt-4 space-y-1.5 border-t border-border pt-4">
          {res.checks.map((c) => (
            <li key={c.name} className="flex items-start gap-2 text-sm">
              {c.ok ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />}
              <span>{c.name} <span className="font-mono text-xs text-muted-foreground">({c.detail})</span></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}