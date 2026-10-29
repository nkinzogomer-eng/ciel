# ciel-core — le noyau, sans plateforme

Ce dossier est **autonome**. Il ne contient aucun import de `@base44/*`, aucun import npm,
et n'utilise que les API Web standard (`crypto.subtle`, `crypto.randomUUID`, `TextEncoder`).
Il tourne tel quel sur Node, Deno et Bun.

```
ciel-core/
├── core/          vocabulaire, horloge, ids, empreintes, prédicats, config
├── domain/        mission, plan, connaissance, preuve, décision, budget, expérience…
├── engines/       intake, synthèse, compilateur, exécuteur, vérification, reprise, boucle, apprentissage
├── interfaces/    contrats (capacité, stockage, provider d'intelligence)
├── adapters/      memory/ (référence) · fs/ (durable) · base44/ (plateforme) · intelligence/
├── capabilities/  capacités déterministes + « world »
├── tests/         172 tests, sans framework
├── server/        API HTTP portable (Bun / Deno / Node)
├── bin/ciel.mjs   CLI
├── orchestrator.ts  intention → mission → vérification → journal
├── runtime.ts     assemblage par injection
├── index.ts       point d'entrée public
└── status.ts      registre d'honnêteté (ce qui existe / ce qui n'existe pas)
```

---

## Lancer

Aucune installation n'est nécessaire pour le noyau (pas de dépendance).

```bash
# Node 22.18+ sait importer du .ts ; en dessous, ajouter --experimental-strip-types
node --experimental-strip-types ciel-core/bin/ciel.mjs test
node --experimental-strip-types ciel-core/bin/ciel.mjs status
node --experimental-strip-types ciel-core/bin/ciel.mjs run plan.json
node --experimental-strip-types ciel-core/bin/ciel.mjs serve --port 8787

# ou
bun  ciel-core/bin/ciel.mjs test
deno run --allow-net --allow-env ciel-core/bin/ciel.mjs test
```

### Exécuter une mission

```bash
cat > plan.json <<'JSON'
{
  "goal": "écrire puis relire une valeur",
  "tasks": [
    { "id": "a", "action": { "capability": "kv.set", "params": { "key": "k", "value": 1 } },
      "verification": { "kind": "PREDICATE", "predicate": { "path": "value", "op": "eq", "value": 1 } } },
    { "id": "b", "action": { "capability": "kv.get", "params": { "key": "k" } }, "dependencies": ["a"],
      "verification": { "kind": "PREDICATE", "predicate": { "path": "value", "op": "eq", "value": 1 } } }
  ]
}
JSON
node --experimental-strip-types ciel-core/bin/ciel.mjs run plan.json
# → statut EXECUTED · mission COMPLETED_VERIFIED · 2 vérifiée(s) · chaîne intacte
```

### Serveur HTTP

```bash
node --experimental-strip-types ciel-core/bin/ciel.mjs serve --port 8787
# affiche un token ; sans token explicite le serveur REFUSE de démarrer
# (--allow-anon pour un usage strictement local)

curl localhost:8787/health
curl -X POST localhost:8787/run -H 'content-type: application/json' -d '{"intent":"écris 7 sous compteur"}'
# AI désactivée : réponse NOT_EXECUTABLE, avec ce qui manque — jamais un plan inventé
```

| Route | Rôle |
|-------|------|
| `GET /health` | version, phase, dégradation (`CORE_ONLY` / `REDUCED` / `FULL`) |
| `GET /status` | registre d'honnêteté des 57 composants |
| `GET /capabilities` | capacités réellement enregistrées, avec manifeste |
| `GET /missions`, `GET /missions/:id` | missions du processus + journal et verdict de chaîne |
| `POST /run` | `{ "intent": "..." }` ou `{ "plan": {...} }` ou un plan brut |
| `POST /resume` | `{ "mission_id": "..." }` — reprise après interruption |

### Persistance durable

Par défaut l'état est en mémoire (perdu au redémarrage). Pour persister sans base de données :

```ts
import { createFileStore } from 'ciel-core/adapters/fs/fileStore.ts';
const store = await createFileStore({ dir: './data' });
```

Un fichier par enregistrement (écriture atomique), un journal append-only par mission,
validation de chaîne à chaque ajout. Testé : redémarrage relu, altération détectée,
ligne tronquée réparée.

---

## Utiliser le noyau comme bibliothèque

```ts
import {
  createCiel, createInMemoryStore, createWorld, fixedClock, sequentialIds, createConfig,
} from 'ciel-core';

const ciel = createCiel({
  store: createInMemoryStore(),
  clock: fixedClock(),            // horloge injectée : le domaine ne connaît pas Date.now()
  newId: sequentialIds(),          // ids déterministes en test
  config: createConfig(),          // IA désactivée par défaut
  permissions: ['state:write'],
  world: createWorld({}),
  withReferenceCapabilities: true,
});

const report = await ciel.run(plan);
// report.status      EXECUTED | AWAITING_CONFIRMATION | NOT_EXECUTABLE | REJECTED | REFUSED | AI_UNAVAILABLE
// report.outcome     COMPLETED_VERIFIED | COMPLETED_PARTIALLY_VERIFIED | COMPLETED_UNVERIFIED | BLOCKED | FAILED | WAITING_FOR_USER
// report.verification{ verified, unverified, failed, contradicted }
// report.ledger      { count, by_type, chain_ok }
```

Brancher un modèle (jamais pour vérifier, seulement pour proposer) :

```ts
import { createLlmProvider } from 'ciel-core/adapters/intelligence/base44Provider.ts';

const provider = createLlmProvider({
  name: 'mon-modele',
  invokeLLM: async ({ prompt, response_json_schema }) => monClient(prompt, response_json_schema),
});
// un plan écrit par le modèle revient en AWAITING_CONFIRMATION avec un proposal_id :
// rien ne s'exécute avant que l'humain confirme CETTE proposition précise (empreinte vérifiée).
```

---

## Ce que ce dossier ne fait pas

- **Aucune capacité système réelle** : pas de shell, pas de git, pas de réseau, pas de mail.
  Les capacités fournies sont déterministes (`kv.*`, `data.transform`, `counter.increment`,
  `mail.send` simulé, `always.fails`) et servent à prouver le noyau.
- **Aucun adaptateur de base de données** autre que le système de fichiers.
- **Aucune surface conversationnelle** : une phrase classée « conversation » renvoie
  `NOT_EXECUTABLE` et dit pourquoi.
- **Le rejeu automatique d'un `fallback` déclaré** n'est pas implémenté : le méta-raisonnement
  est consulté et journalisé, la décision reste à l'humain.

La source de vérité de ces limites est `status.ts` (`COMPONENT_STATUS` + `NOT_CLAIMED`).
