import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import TestResults from '@/components/ciel/TestResults';
import ComponentTable from '@/components/ciel/ComponentTable';
import PersistenceCheck from '@/components/ciel/PersistenceCheck';
import CheckPanel from '@/components/ciel/CheckPanel';
import MissionRunner from '@/components/ciel/MissionRunner';

export default function CielConsole() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('cielSelfTest', {});
      if (res.data?.error) setError(res.data.error);
      else setData(res.data);
    } catch (e) {
      // A non-admin (or an offline backend) must still get a usable page: the mission
      // runner is the point of the console, the test dashboard is a diagnostic.
      setError(e.message || 'la suite de tests est inaccessible');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { run(); }, []);

  const r = data?.results;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Ciel — Console du noyau</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data
              ? `Phase ${data.phase} · IA désactivée dans ce noyau · chaque résultat est vérifié avant d'être rapporté.`
              : 'Noyau cognitif portable · chaque résultat est vérifié avant d\'être rapporté.'}
          </p>
        </div>
        <Button variant="outline" onClick={run} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Relancer les tests
        </Button>
      </header>

      {error && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <div>
            <p className="font-medium">Suite de tests indisponible</p>
            <p className="text-muted-foreground">
              {error} — les fonctions de diagnostic sont réservées aux comptes administrateur.
              L'onglet Mission reste utilisable si votre compte y a accès.
            </p>
          </div>
        </div>
      )}

      {loading && !data && (
        <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Exécution de la suite de tests…
        </div>
      )}

      {data && r && (
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
      )}

      <Tabs defaultValue="mission">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="mission">Mission</TabsTrigger>
          {data && <TabsTrigger value="tests">Tests</TabsTrigger>}
          {data && <TabsTrigger value="components">État des composants</TabsTrigger>}
          <TabsTrigger value="persistence">Persistance</TabsTrigger>
          <TabsTrigger value="intelligence">Intelligence</TabsTrigger>
        </TabsList>

        <TabsContent value="mission"><MissionRunner /></TabsContent>
        {data && r && <TabsContent value="tests"><TestResults results={r} /></TabsContent>}
        {data && <TabsContent value="components"><ComponentTable components={data.components} notClaimed={data.not_claimed} /></TabsContent>}
        <TabsContent value="persistence"><PersistenceCheck /></TabsContent>
        <TabsContent value="intelligence">
          <CheckPanel
            functionName="cielIntelligenceCheck"
            title="Contrôle d'intelligence réel"
            description="Un vrai modèle propose un plan ; Ciel le valide, refuse les capacités inventées et ne compte comme réussi que ce qui est vérifié."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
