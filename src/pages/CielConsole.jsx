import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2, RefreshCw } from 'lucide-react';
import TestResults from '@/components/ciel/TestResults';
import ComponentTable from '@/components/ciel/ComponentTable';
import PersistenceCheck from '@/components/ciel/PersistenceCheck';

export default function CielConsole() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const run = async () => {
    setLoading(true);
    const res = await base44.functions.invoke('cielSelfTest', {});
    setData(res.data);
    setLoading(false);
  };

  useEffect(() => { run(); }, []);

  const r = data?.results;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Ciel — Console du noyau</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Phase {data?.phase ?? '…'} · IA désactivée · le noyau tourne sans aucun appel de modèle.
          </p>
        </div>
        <Button variant="outline" onClick={run} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Relancer les tests
        </Button>
      </header>

      {loading && !data && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Exécution de la suite de tests…
        </div>
      )}

      {data && (
        <>
          <div className="mb-8 grid grid-cols-3 gap-3">
            {[
              { label: 'Tests', value: r.total },
              { label: 'Réussis', value: r.passed },
              { label: 'Échoués', value: r.failed },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-border bg-card p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</p>
                <p className={`font-mono text-2xl ${s.label === 'Échoués' && s.value > 0 ? 'text-destructive' : ''}`}>{s.value}</p>
              </div>
            ))}
          </div>

          <Tabs defaultValue="tests">
            <TabsList className="mb-4">
              <TabsTrigger value="tests">Tests</TabsTrigger>
              <TabsTrigger value="components">État des composants</TabsTrigger>
              <TabsTrigger value="persistence">Persistance</TabsTrigger>
            </TabsList>
            <TabsContent value="tests"><TestResults results={r} /></TabsContent>
            <TabsContent value="components"><ComponentTable components={data.components} /></TabsContent>
            <TabsContent value="persistence"><PersistenceCheck /></TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}