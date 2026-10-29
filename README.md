# Ciel — noyau cognitif portable

> Ce README est écrit pour être lu par une IA (ou un développeur) qui arrive sans contexte.
> Il décrit **ce qu'est Ciel**, **comment il est construit**, **ce qui est réellement
> implémenté et testé**, et **ce qui ne l'est pas**.
> Règle du projet : rien ici ne décrit une fonctionnalité qui n'existe pas.
> Si un composant est un stub, ou n'existe pas du tout, il est marqué comme tel — ici et dans
> `ciel-core/status.ts`, qui est la source de vérité.

---

## 1. Qu'est-ce que Ciel

Ciel est un **noyau cognitif** : il reçoit une intention, en fait une mission structurée,
l'exécute pas à pas, **vérifie** chaque résultat, journalise tout dans une chaîne de hachages
où toute altération est détectable, sait reprendre après un crash sans rejouer à l'aveugle une
action dangereuse, et apprend de ses propres prédictions.

Ce n'est **pas** un wrapper autour d'un modèle de langage. Le modèle est un composant optionnel
et remplaçable. Ciel fonctionne entièrement sans IA (`ai.enabled = false` par défaut) : dans ce
mode, il accepte un **plan structuré** et rien d'autre.

Le noyau vit dans `ciel-core/` et **ne dépend d'aucune plateforme**. `base44/` n'est qu'une
des surfaces possibles ; `src/` en est une autre.

### Les cinq invariants

| # | Invariant | Conséquence dans le code |
|---|-----------|--------------------------|
| 1 | **Portabilité** — le noyau ne connaît aucune plateforme | `ciel-core/` n'importe ni `@base44/*` ni aucun paquet npm. Un test (`phaseA/independence`) le vérifie. |
| 2 | **L'IA propose, Ciel décide** | Une sortie de modèle est une *proposition* validée par `planSynthesis`, jamais une vérité. La confiance déclarée par le modèle est stockée à part (`claimed`) et ne devient jamais une confiance interne. |
| 3 | **Rien n'est vrai sans vérification** | Une tâche exécutée est `EXECUTED`, pas `VERIFIED`. Seul un vérificateur (prédicat, source indépendante, cohérence, humain) fait passer à `VERIFIED`. Une mission dont tout n'est pas vérifié ne rapporte jamais un succès. |
| 4 | **Sécurité avant reprise** | Une action non idempotente interrompue n'est **jamais** rejouée à l'aveugle : sonde d'effet, sinon `WAITING_FOR_USER`. |
| 5 | **Honnêteté d'état** | Chaque composant a un statut déclaré dans `status.ts` : `TESTED`, `TESTED_IN_BASE44`, `IMPLEMENTED`, `NOT_IMPLEMENTED`, `REQUIRES_EXTERNAL_RUNTIME`. Un composant absent n'est pas listé comme prêt. |

Le journal est **inviolable au sens détectable** (*tamper-evident*) : la chaîne de hachages
révèle une modification, une suppression ou un trou de séquence. Elle ne l'*empêche* pas — il
faudrait pour cela un ancrage externe, qui n'existe pas ici. `status.ts` (`NOT_CLAIMED`) le dit
explicitement.

---

## 2. Deux façons de l'exécuter

| | Autonome (recommandé pour développer) | Console Base44 |
|---|---|---|
| Commande | `node --experimental-strip-types ciel-core/bin/ciel.mjs test` | `base44 dev` puis l'onglet Console |
| Dépendances | **aucune** | `npm install` + CLI Base44 |
| Stockage | mémoire, ou `adapters/fs` (durable) | entités Base44 |
| Modèle | injecté (n'importe quel client) | `Core.InvokeLLM` de la plateforme |
| Détail | [`ciel-core/README.md`](ciel-core/README.md) | § 9 de ce fichier |

```bash
node --experimental-strip-types ciel-core/bin/ciel.mjs test      # 172 tests, ~0,4 s
node --experimental-strip-types ciel-core/bin/ciel.mjs status    # registre d'honnêteté
node --experimental-strip-types ciel-core/bin/ciel.mjs run plan.json
node --experimental-strip-types ciel-core/bin/ciel.mjs serve --port 8787
```

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  SURFACES     console Base44 (src/pages/CielConsole)             │
│               CLI (ciel-core/bin) · API HTTP (ciel-core/server)  │
├──────────────────────────────────────────────────────────────────┤
│  ADAPTATEURS  MemoryStore : in-memory | fs (durable) | Base44    │
│  (injectés)   Intelligence : null | mock | LLM (invokeLLM)       │
│               Capacités   : déterministes de référence           │
├──────────────────────────────────────────────────────────────────┤
│  CIEL CORE    domaine + moteurs + orchestrateur                  │
│  (portable)   TypeScript, zéro dépendance, zéro API plateforme   │
└──────────────────────────────────────────────────────────────────┘
```

Le Core ne fait **aucun** appel implicite : horloge, identifiants, stockage, capacités et
modèle sont injectés par `ciel-core/runtime.ts` (`createCiel`).

```
ciel-core/
├── core/            types.ts · clock.ts · ids.ts · fingerprint.ts · predicate.ts · config.ts
├── domain/          mission · plan · knowledge · evidence · decision · confidence · strategy
│                    actionGraph · ledger · checkpoint · verification · budget · experience
├── engines/         goalKernel · planSynthesis · missionCompiler · executor · capabilityRegistry
│                    verificationEngine · arbitration · strategySelector · invalidation
│                    loopDetector · ledgerService · checkpointService · recoveryEngine
│                    learning · metaReasoning · sufficiency
├── interfaces/      capability · memoryStore · intelligenceProvider
├── adapters/        memory/inMemoryStore · fs/fileStore · base44/entityStore
│                    intelligence/{nullProvider,base44Provider}
├── capabilities/    reference.ts (6 capacités déterministes) · world.ts
├── tests/           runner.ts + phaseA…phaseI (172 tests, sans framework)
├── server/main.ts   API HTTP portable (Bun / Deno / Node)
├── bin/ciel.mjs     CLI
├── orchestrator.ts  intention → mission → vérification → journal
├── runtime.ts       createCiel() — assemblage par injection
├── index.ts         point d'entrée public (139 exports)
└── status.ts        registre d'honnêteté (57 composants + NOT_CLAIMED)

base44/
├── config.jsonc     nom, commandes de build/serve
├── entities/        CielRecord (persistance générique) · User
└── functions/       cielSelfTest · cielPersistenceCheck · cielIntelligenceCheck · cielRun

src/                 console React (Base44) — onglets Tests / Composants / Persistance /
                     Intelligence / Mission
```

---

## 4. Le cycle de vie d'une mission (le code réel)

`ciel.run(intention)` → `ciel-core/orchestrator.ts` :

```
intention
  │
  ├─ goalKernel.classify()          sans IA : conversation / question / conseil / mission
  │     └─ conversation, question → NOT_EXECUTABLE (Ciel dit qu'il n'a pas de surface de dialogue)
  │
  ├─ plan
  │     ├─ plan structuré fourni → utilisé tel quel (validé)
  │     └─ prose + IA activée → planSynthesis : le modèle PROPOSE un plan JSON
  │           ├─ contrat de sortie vérifié      (texte libre refusé)
  │           ├─ validatePlan                  (ids, dépendances, cycles)
  │           └─ capacités inconnues → REJECTED (aucune invention)
  │
  ├─ confirmation                    un plan écrit par une IA n'est jamais exécuté seul
  │      proposition PERSISTÉE (proposal_id + empreinte) → AWAITING_CONFIRMATION
  │      l'humain confirme CETTE proposition ; une proposition altérée est refusée
  │
  ├─ sufficiency                     REFUSE bloque une action irréversible non vérifiable
  │
  ├─ missionCompiler.compile()       plan → mission + tâches, ordre topologique
  │
  └─ executor.run()                  pour chaque tâche, dans cet ordre :
        ├─ budget → capacité/permission → plan d'action (risque + politique de rejeu)
        ├─ confirmation explicite des actions irréversibles
        ├─ préconditions (empreintes) vérifiées
        ├─ checkpoint AVANT l'action (synchrone, avec l'action en vol)
        ├─ capability.execute()                 (aucun appel de modèle ici — jamais)
        ├─ observation → intégrité → preuve
        ├─ verificationEngine                    EXECUTED → VERIFIED | UNVERIFIED | CONTRADICTED
        ├─ invalidation en cascade               ce que cette action rend obsolète
        ├─ loopDetector (historique PAR mission)
        └─ échec → méta-raisonnement             repli déclaré d'abord, IA arbitrée ensuite
        journal.append() à chaque étape          (chaîné par hachage)
```

Le rapport final est un **compte rendu**, pas une promesse :

`COMPLETED_VERIFIED` · `COMPLETED_PARTIALLY_VERIFIED` · `COMPLETED_UNVERIFIED` · `BLOCKED` ·
`WAITING_FOR_USER` · `FAILED` — et le verdict de chaîne est recalculé avant de le renvoyer.

Après un crash : `recoveryEngine` relit le dernier checkpoint. Action idempotente →
`REPLAY_ALLOWED`. Action non idempotente → sonde d'effet ; si l'effet est indéterminable, la
mission passe en `WAITING_FOR_USER`. Jamais de rejeu aveugle.

---

## 5. Comment il a été construit — phases A → I

Chaque phase se termine par une suite de tests déterministes et une mise à jour de `status.ts`.

| Phase | Contenu | Preuve |
|-------|---------|--------|
| **A** | Vocabulaire, horloge/ids injectés, empreintes, config, modèles de domaine, interfaces, adaptateurs mémoire + IA nulle | `phaseA/` (dont `independence.test.ts`) |
| **B** | Journal chaîné, checkpoints, persistance Base44 | `phaseB/persistence.test.ts` + `cielPersistenceCheck` |
| **C** | Noyau d'intention sans IA, compilateur, exécuteur, registre, capacités | `phaseC/` |
| **D** | Arbitrage, vérification (4 vérificateurs), sélection de stratégie | `phaseD/verification.test.ts` |
| **E** | Invalidation en cascade, reprise | `phaseE/invalidation.test.ts` |
| **F** | Budget, détection de boucles | `phaseF/budgetLoop.test.ts` |
| **G** | Expérience, calibration, modèle de soi | `phaseG/learning.test.ts` |
| **H** | Couche d'intelligence : sortie JSON stricte, synthèse, méta-raisonnement, suffisance | `phaseH/intelligence.test.ts` |
| **I** | **Orchestrateur de bout en bout**, proposition persistée + confirmation, persistance fichier, CLI, API HTTP | `phaseI/orchestrator.test.ts`, `phaseB/fileStore.test.ts` |

**Total : 172 tests, 0 framework.** Ils tournent à l'identique sur Node, Deno, Bun et dans la
fonction Base44 `cielSelfTest`.

### Impasses — déjà essayées, ne pas refaire

- **Fusionner raisonnement / stratégie / méta-cognition** : contredit la modularité.
- **Faire vérifier un résultat par un modèle** : `verification.ts` rejette un performer `ai:*`.
- **Copier la confiance déclarée par le modèle** dans l'état interne : gardée en `claimed`.
- **Confirmer un plan en le re-synthétisant** : le modèle produit un plan différent à chaque
  appel, donc une empreinte différente — la confirmation devenait impossible. D'où la
  proposition persistée (`proposals`) introduite en phase I.

---

## 6. Ce qui tourne réellement, et où le voir

### Console Base44 (onglet par onglet)

| Fonction | Ce qu'elle prouve | Accès |
|----------|-------------------|-------|
| `cielSelfTest` | exécute les 172 tests et renvoie le registre de statuts | admin |
| `cielPersistenceCheck` | mission écrite, relue par un runtime neuf, chaîne vérifiée, journal append-only | admin |
| `cielIntelligenceCheck` | un vrai modèle propose un plan ; Ciel le valide, refuse les capacités inventées, garde la confiance interne à zéro | admin |
| `cielRun` | exécute une intention ou un plan depuis la console : `AWAITING_CONFIRMATION` puis confirmation par `proposal_id` | admin |

### Hors Base44

```bash
npm test                      # 172 tests
npm run ciel:status           # 57 composants, 6 non-revendications
npm run ciel:serve            # API HTTP avec token obligatoire
```

---

## 7. Ce qui n'est PAS implémenté (et pourquoi)

Source de vérité : `ciel-core/status.ts` (`COMPONENT_STATUS`, `NOT_CLAIMED`). **Aucun fichier
n'existe** pour les lignes marquées « aucun fichier » : ne pas les supposer prêtes.

| Composant | Statut | Réalité |
|-----------|--------|---------|
| Capacités Shell / Filesystem / Git / MCP | `NOT_IMPLEMENTED` | Aucun fichier. Les manifestes apparaissent seulement dans les tests, pour vérifier le refus d'une capacité non enregistrée. |
| Adaptateurs Hermes / OpenClaw | `NOT_IMPLEMENTED` | Aucun fichier. |
| Surface Telegram | `NOT_IMPLEMENTED` | Aucun fichier. |
| MemoryStore SQLite | `NOT_IMPLEMENTED` | Aucun fichier, aucun schéma, aucune migration. La persistance durable existe mais passe par le système de fichiers (`adapters/fs`). |
| Providers Anthropic / OpenAI livrés | `NOT_IMPLEMENTED` | `createLlmProvider({ invokeLLM })` accepte n'importe quel client : il reste à écrire cette fonction. Rien n'est fourni. |
| Rejeu automatique d'un `fallback` déclaré | `NOT_IMPLEMENTED` | Le méta-raisonnement est consulté et journalisé ; l'action n'est pas rejouée automatiquement. |
| Mesure CPU / RAM du budget | `REQUIRES_EXTERNAL_RUNTIME` | Dimensions déclarées, non alimentées. |
| Journal *tamper-proof* | non revendiqué | La chaîne détecte l'altération, elle ne l'empêche pas. |
| Isolation multi-utilisateurs du stockage | non revendiqué | Le store n'est pas partitionné par utilisateur ; c'est la responsabilité de l'appelant. |

---

## 8. Comment étendre Ciel sans le casser

**Ajouter une capacité** → un fichier dans `ciel-core/capabilities/`, avec un manifeste honnête :
`idempotent`, `reversible`, `side_effects`, `permissions`, `affected_state`, et une sonde
d'effet si elle n'est pas idempotente. Un manifeste faux casse l'invariant 4 — l'interface
refuse d'ailleurs d'enregistrer une capacité non idempotente sans `probeEffect()`.

**Ajouter un stockage** → implémenter `interfaces/memoryStore.ts` et l'injecter dans
`createCiel`. Ne rien importer de la plateforme dans le Core.

**Ajouter un modèle** → implémenter `interfaces/intelligenceProvider.ts` (ou passer une fonction
`invokeLLM` à `createLlmProvider`) : sortie structurée obligatoire, texte libre refusé.

**Ajouter un moteur** → un fichier dans `engines/`, une suite dans `tests/phaseX/`, une ligne
dans `status.ts`. Pas de test = statut `NOT_IMPLEMENTED`.

---

## 9. Exécuter le projet en local

### Noyau seul (sans Base44, sans installation)

```bash
node --experimental-strip-types ciel-core/bin/ciel.mjs test
```

### Console Base44

Prérequis : `npm install`, `npm install -g base44@latest`, et [Deno](https://docs.deno.com/runtime/getting_started/installation/).

```bash
base44 login   # une fois par machine
base44 link    # une fois par clone (écrit base44/.app.jsonc, gitignoré)
base44 dev     # backend local + frontend ensemble
```

Notes :

- **Chaque nouveau clone a besoin de `base44 link`** ; l'app id est dans l'URL du Builder.
- **`base44 dev` lance déjà le frontend** — ne pas lancer `npm run dev` séparément.
- L'app doit avoir été publiée au moins une fois pour que l'UI charge sous `base44 dev`.
- Les données d'entités en local sont **en mémoire** ; les intégrations Core et l'OAuth sont
  transmises à l'app déployée.
- Frontend seul contre le backend hébergé : `base44 dev --remote`
  ⚠️ écrit dans les données de production.

### Publier

Ce dépôt est synchronisé avec Base44 par git : pousser, puis publier depuis le dashboard
(`base44 dashboard open`) — pas `base44 deploy`, qui contournerait la synchronisation.

---

## 10. Vérifications

```bash
npm test        # 172 tests (noyau portable)
npm run lint    # ESLint : src/ (React) + ciel-core/ (TypeScript)
npm run build   # build Vite de la console
npm run check   # les trois
```

La CI (`.github/workflows/ci.yml`) exécute ces trois commandes sur Node 22 à chaque push.

Il n'y a **pas** de `typecheck` global : `tsc` sur un noyau volontairement non annoté produirait
des centaines de faux positifs, et `checkJs` sur le boilerplate shadcn/ui (`src/components/ui/`)
en produirait 386 autres. Le gate réel est ESLint + les tests + le build. Ne pas réintroduire un
script `typecheck` qui échoue sans rien vérifier d'utile.

---

## 11. Liens

- Intégration GitHub : https://docs.base44.com/developers/app-code/local-development/github
- Développement local : https://docs.base44.com/developers/backend/overview/local-dev/local-development-overview
- Support : https://app.base44.com/support
