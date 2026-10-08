import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Loader2, Play, Check, X } from 'lucide-react';

export default function CheckPanel({ title, description, functionName }) {
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    const r = await base44.functions.invoke(functionName, {});
    setRes(r.data);
    setLoading(false);
  };

  const checks = Array.isArray(res?.checks) ? res.checks : null;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-md">
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button onClick={run} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
          {loading ? 'Appel du modèle…' : 'Lancer le contrôle'}
        </Button>
      </div>

      {res?.error && <p className="mt-4 text-sm text-destructive">Erreur : {res.error}</p>}

      {checks && (
        <ul className="mt-4 space-y-1.5 border-t border-border pt-4">
          {checks.map((c, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              {c.ok ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> : <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />}
              <span>{c.name}{c.detail != null && <span className="ml-1 font-mono text-xs text-muted-foreground">({String(c.detail)})</span>}</span>
            </li>
          ))}
        </ul>
      )}

      {res && !checks && !res.error && (
        <pre className="mt-4 max-h-80 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">{JSON.stringify(res, null, 2)}</pre>
      )}
    </div>
  );
}