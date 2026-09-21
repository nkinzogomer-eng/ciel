import React from 'react';
import StatusBadge from './StatusBadge';

const LAYERS = ['core', 'domain', 'interface', 'adapter', 'capability', 'surface'];

export default function ComponentTable({ components }) {
  return (
    <div className="space-y-6">
      {LAYERS.filter((l) => components.some((c) => c.layer === l)).map((layer) => (
        <div key={layer} className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-2.5">
            <h3 className="font-heading text-sm font-semibold uppercase tracking-wide">{layer}</h3>
          </div>
          <ul className="divide-y divide-border">
            {components.filter((c) => c.layer === layer).map((c) => (
              <li key={c.component} className="flex flex-col gap-1 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0">{c.component}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">phase {c.phase}</span>
                  <StatusBadge status={c.status} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}