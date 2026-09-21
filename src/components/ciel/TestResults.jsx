import React from 'react';
import { Check, X } from 'lucide-react';

export default function TestResults({ results }) {
  return (
    <div className="space-y-4">
      {results.suites.map((s) => (
        <div key={s.name} className="rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
            <h3 className="font-heading text-sm font-semibold">{s.name}</h3>
            <span className={`text-xs font-mono ${s.failed ? 'text-destructive' : 'text-emerald-600'}`}>
              {s.passed}/{s.passed + s.failed}
            </span>
          </div>
          <ul className="divide-y divide-border">
            {s.tests.map((t) => (
              <li key={t.title} className="flex items-start gap-2.5 px-4 py-2 text-sm">
                {t.ok
                  ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  : <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />}
                <div className="min-w-0">
                  <p className={t.ok ? 'text-foreground' : 'text-destructive font-medium'}>{t.title}</p>
                  {t.error && <p className="mt-1 font-mono text-xs text-muted-foreground break-words">{t.error}</p>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}