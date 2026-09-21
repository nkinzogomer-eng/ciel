import React from 'react';

const STYLES = {
  TESTED_IN_BASE44: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  IMPLEMENTED: 'bg-sky-100 text-sky-800 border-sky-200',
  SIMULATED: 'bg-amber-100 text-amber-800 border-amber-200',
  STUB: 'bg-amber-100 text-amber-800 border-amber-200',
  NOT_IMPLEMENTED: 'bg-slate-100 text-slate-600 border-slate-200',
  REQUIRES_EXTERNAL_RUNTIME: 'bg-violet-100 text-violet-800 border-violet-200',
};

const LABELS = {
  TESTED_IN_BASE44: 'Testé ici',
  IMPLEMENTED: 'Implémenté',
  SIMULATED: 'Simulé',
  STUB: 'Ébauche',
  NOT_IMPLEMENTED: 'À faire',
  REQUIRES_EXTERNAL_RUNTIME: 'Hors Base44',
};

export default function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STYLES[status] || STYLES.NOT_IMPLEMENTED}`}>
      {LABELS[status] || status}
    </span>
  );
}