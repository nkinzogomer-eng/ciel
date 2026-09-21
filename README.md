# Ciel — noyau cognitif portable

> Ce README est écrit pour être lu par une IA (ou un développeur) qui arrive sans contexte.
> Il décrit **ce qu'est Ciel**, **comment il est construit**, **pourquoi il est construit ainsi**,
> **ce qui est réellement implémenté et testé**, et **ce qui ne l'est pas**.
> Règle du projet : rien dans ce document ne décrit une fonctionnalité qui n'existe pas.
> Si un composant est un stub, il est marqué comme tel — ici et dans `base44/shared/ciel/status.ts`.

---

## 1. Qu'est-ce que Ciel

Ciel est un **noyau cognitif** : un système qui reçoit une intention, en fait une mission
structurée, l'exécute pas à pas, **vérifie** chaque résultat, journalise tout de façon
inviolable, sait reprendre après un crash sans répéter d'action dangereuse, et apprend de ses
propres prédictions.

Ce n'est **pas** un wrapper autour d'un modèle de langage. Le modèle est un composant optionnel
et remplaçable. Ciel fonctionne entièrement sans IA (`AI_ENABLED=false`).

### Les cinq invariants du projet

Tout le code découle de ces règles. Les enfreindre, c'est casser Ciel.

| # | Invariant | Conséquence dans le code |
|---|-----------|--------------------------|
| 1 | **Portabilité** — le noyau ne connaît pas Base44 | `base44/shared/ciel/` n'importe *jamais* le SDK Base44. Tout l'extérieur passe par des interfaces injectées. |
| 2 | **L'IA propose, Ciel décide** | Une sortie de modèle est une *proposition* validée par `planSynthesis`, jamais une vérité. La confiance déclarée par le modèle est stockée à part et ne devient jamais une confiance interne. |
| 3 | **Rien n'est vrai sans vérification** | Une tâche exécutée est `EXECUTED`, pas `VERIFIED`. Seul un vérificateur (prédicat, source indépendante, cohérence, humain) fait passer à `VERIFIED`. Une mission dont tout n'est pas vérifié ne rapporte jamais un succès. |
| 4 | **Sécurité avant reprise** | Une action non idempotente interrompue n'est **jamais** rejouée à l'aveugle : sonde d'effet, sinon `WAITING_FOR_USER`. |
| 5 | **Honnêteté d'état** | Chaque composant a un statut déclaré (`TESTED_IN_BASE44`, `REQUIRES_EXTERNAL_RUNTIME`, `NOT_IMPLEMENTED`). Aucun stub n'est présenté comme fini. |

---

## 2. Architecture en trois couches

```
┌─────────────────────────────────────────────────────────────┐
│  SURFACES            console Base44 (src/pages/CielConsole) │
│                      (Telegram, CLI : non implémentés)      │
├─────────────────────────────────────────────────────────────┤
│  ADAPTATEURS         MemoryStore : inMemory | Base44 entities│
│  (remplaçables)      Intelligence : null | mock | LLM Base44 │
│                      Capacités : référence déterministe      │
├─────────────────────────────────────────────────────────────┤
│  CIEL CORE           domaine + moteurs, TypeScript pur,      │
│  (portable)          zéro dépendance plateforme              │
└─────────────────────────────────────────────────────────────┘
```

Le Core ne fait **aucun** appel implicite : l'horloge, les identifiants, le stockage, les
capacités et le modèle sont tous **injectés** par `base44/shared/ciel/runtime.ts` (`createCiel`).
C'est ce qui rend le noyau exécutable tel quel sur Node/Deno/Docker/VPS, hors de Base44.

### Arborescence commentée

```
base44/shared/ciel/
├── core/            vocabulaire partagé, indépendant de tout
│   ├── types.ts         états, transitions légales, énumérations, CielError
│   ├── clock.ts         temps injecté (jamais Date.now() dans le domaine)
│   ├── ids.ts           identifiants injectés (déterministes en test)
│   ├── fingerprint.ts   SHA-256 canonique — base des hachages et invalidations
│   ├── predicate.ts     évaluateur de prédicats déterministe (vérification)
│   └── config.ts        AI désactivée par défaut, budgets, dégradation
├── domain/          modèles purs, sans effet de bord
│   ├── mission.ts       mission/tâche + transitions + WAITING_FOR_USER
│   ├── plan.ts          format de plan structuré : validation, tri topologique
│   ├── knowledge.ts     niveaux épistémiques et règles de promotion
│   ├── evidence.ts      observations, intégrité des preuves
│   ├── decision.ts      primitive de décision (7 types, provenance)
│   ├── confidence.ts    vecteur à 4 dimensions, global = maillon le plus faible
│   ├── strategy.ts      performance contextuelle, abandon indépendant du coût engagé
│   ├── actionGraph.ts   préconditions, dépendances, risque, politique de rejeu
│   ├── ledger.ts        événements chaînés par hachage
│   ├── checkpoint.ts    instantanés + plan de reprise
│   ├── verification.ts  enregistrements de vérification et règle de résolution
│   ├── budget.ts        temps/jetons/argent/appels, opérations protégées
│   └── experience.ts    expériences, prédictions, calibration contextuelle
├── engines/         la logique active
│   ├── goalKernel.ts        intention → classe (conversation/question/conseil/mission), sans IA
│   ├── planSynthesis.ts     prose → plan proposé par l'IA, puis validé par Ciel
│   ├── missionCompiler.ts   plan → mission + tâches exécutables
│   ├── executor.ts          exécution déterministe du graphe
│   ├── capabilityRegistry.ts capacités déclarées avec manifeste
│   ├── verificationEngine.ts applique les vérificateurs
│   ├── arbitration.ts       choix entre options concurrentes
│   ├── strategySelector.ts  sélection contextuelle de stratégie
│   ├── invalidation.ts      cascade d'invalidation par empreinte
│   ├── loopDetector.ts      détection de répétition / boucle
│   ├── ledgerService.ts     journal append-only chaîné
│   ├── checkpointService.ts sauvegarde synchrone avant action risquée
│   ├── recoveryEngine.ts    reprise après crash, sonde avant rejeu
│   ├── learning.ts          expérience → calibration → modèle de soi
│   ├── metaReasoning.ts     échec de stratégie → repli déterministe, puis IA arbitrée
│   └── sufficiency.ts       agir / chercher / demander / refuser
├── interfaces/      contrats que les adaptateurs doivent respecter
│   ├── capability.ts          manifeste : idempotent, réversible, effets, permissions
│   ├── memoryStore.ts         persistance
│   └── intelligenceProvider.ts contrat de sortie structurée obligatoire
├── adapters/
│   ├── memory/inMemoryStore.ts    référence + tests
│   ├── base44/entityStore.ts      persistance réelle via l'entité CielRecord
│   └── intelligence/{nullProvider,base44Provider}.ts
├── capabilities/reference.ts  capacités déterministes (pur, réversible, irréversible, échec, sonde)
├── tests/           harnais portable, résultats JSON agnostiques
│   ├── runner.ts + helpers/rig.ts
│   └── phaseA … phaseH/
├── runtime.ts       createCiel() : assemble tout par injection
└── status.ts        registre d'honnêteté : état réel de chaque composant
```

---

## 3. Le cycle de vie d'une mission (le chemin réel du code)

```
intention (texte)
   │
   ├─ goalKernel.classify()            ── sans IA : conversation / question / conseil / mission
   │
   ├─ (si prose libre et IA activée)
   │     planSynthesis.synthesize()    ── le modèle PROPOSE un plan JSON
   │        ├─ contrat de sortie vérifié (pas de texte libre accepté)
   │        ├─ plan.validate() : ids, actions, dépendances, cycles
   │        ├─ capacités inconnues → REFUS (aucune invention)
   │        └─ décision marquée « origine IA » → exige confirmation
   │
   ├─ missionCompiler.compile()        ── plan → mission + tâches, ordre topologique
   │
   └─ executor.run()                   ── pour chaque tâche, dans l'ordre :
         ├─ préconditions + empreintes vérifiées
         ├─ checkpointService.save()    (avant toute action risquée, synchrone)
         ├─ capability.execute()        (aucun appel de modèle ici — jamais)
         ├─ verificationEngine.verify() ── EXECUTED → VERIFIED | UNVERIFIED | CONTRADICTED
         ├─ invalidation.cascade()      ── ce que cette action rend obsolète
         ├─ budget.assess()             ── continuer / réduire / arrêter (vérif. protégée)
         ├─ loopDetector.check()        ── répétition stérile → arrêt
         └─ échec → metaReasoning       ── repli déterministe d'abord, IA arbitrée ensuite
         │
         ledgerService.append() à chaque étape (chaîné par hachage, rupture détectable)
```

Résultat possible d'une mission : `COMPLETED_VERIFIED`, `COMPLETED_PARTIALLY_VERIFIED`,
`BLOCKED`, `WAITING_FOR_USER`, `FAILED`. **`BLOCKED` est un succès du système** quand le plan
était faux : Ciel a refusé de mentir sur un résultat non vérifié.

Après un crash : `recoveryEngine` relit le dernier checkpoint. Action idempotente →
`REPLAY_ALLOWED`. Action non idempotente → `PROBE_BEFORE_REPLAY` : on sonde l'effet ; si
l'effet est indéterminable, la mission passe en `WAITING_FOR_USER`. Jamais de rejeu aveugle.

---

## 4. Comment il a été construit — phases A → H

Chaque phase s'est terminée par une suite de tests déterministes (dans
`base44/shared/ciel/tests/phaseX/`) et par une mise à jour de `status.ts`.

| Phase | Contenu | Preuve |
|-------|---------|--------|
| **A** | Vocabulaire, horloge/ids injectés, empreintes, config, tous les modèles de domaine, les trois interfaces, adaptateurs mémoire + IA nulle | `phaseA/` — dont `independence.test.ts` qui vérifie que le noyau n'importe rien de la plateforme |
| **B** | Journal chaîné, checkpoints, persistance réelle via l'entité `CielRecord` | `phaseB/persistence.test.ts` + `cielPersistenceCheck` : mission exécutée, relue après redémarrage, chaîne intacte |
| **C** | Noyau d'intention sans IA, compilateur, exécuteur de graphe, registre de capacités, capacités de référence | `phaseC/execution.test.ts`, `phaseC/goalKernel.test.ts` |
| **D** | Arbitrage, moteur de vérification (4 vérificateurs), sélection de stratégie contextuelle | `phaseD/verification.test.ts` |
| **E** | Invalidation en cascade par empreinte, moteur de reprise | `phaseE/invalidation.test.ts` |
| **F** | Gestion de budget / plan de politique, détection de boucles | `phaseF/budgetLoop.test.ts` |
| **G** | Expérience, calibration contextuelle, modèle de soi | `phaseG/learning.test.ts` |
| **H** | Couche d'intelligence : `IntelligenceProvider` JSON strict, synthèse de plan, méta-raisonnement, suffisance cognitive | `phaseH/intelligence.test.ts` + `cielIntelligenceCheck` contre un vrai modèle |

### Impasses — déjà essayées, ne pas refaire

- **Fusionner raisonnement / stratégie / méta-cognition** en un seul moteur : contredit la
  modularité, empêche de faire évoluer l'un sans casser l'autre.
- **Faire vérifier un résultat par un modèle** : refusé par `verification.ts` (un *performer*
  de type IA est rejeté). Une IA ne peut pas être sa propre preuve.
- **Copier la confiance déclarée par le modèle dans l'état interne** : `confidence.ts` la garde
  en `claimed`, séparée.

---

## 5. Ce qui tourne réellement, et où le voir

Trois fonctions backend, toutes appelables depuis la console (`/` → `src/pages/CielConsole.jsx`) :

| Fonction | Ce qu'elle prouve |
|----------|-------------------|
| `cielSelfTest` | Exécute l'intégralité des suites A→H et renvoie un rapport JSON agnostique (144 tests). |
| `cielPersistenceCheck` | Persistance réelle : une mission écrite, relue dans un processus neuf, journal chaîné vérifié. |
| `cielIntelligenceCheck` | Un vrai modèle propose un plan ; Ciel le valide, refuse les capacités inventées, garde la confiance interne à zéro, n'appelle aucun modèle pendant l'exécution, et ne rapporte comme succès que ce que la vérification a établi. |

Les résultats des tests sont **volontairement du JSON pur** : le harnais ne dépend d'aucun
framework et tourne à l'identique hors de Base44.

---

## 6. Ce qui n'est PAS implémenté (et pourquoi)

À lire avant de supposer qu'une capacité existe. Source de vérité : `status.ts`.

| Composant | Statut | Raison |
|-----------|--------|--------|
| Capacités Shell / Filesystem / Git / MCP | `REQUIRES_EXTERNAL_RUNTIME` | Interface + mock présents. Un vrai processus système est impossible dans Base44. |
| Adaptateurs Hermes / OpenClaw | `REQUIRES_EXTERNAL_RUNTIME` | Idem : contrat défini, exécution hors plateforme. |
| Surfaces Telegram / CLI | `REQUIRES_EXTERNAL_RUNTIME` | Nécessitent un processus long ou un terminal. |
| MemoryStore SQLite | `REQUIRES_EXTERNAL_RUNTIME` | Schéma et migrations prêts ; le pilote a besoin d'un runtime fichier. |
| Providers Anthropic / OpenAI par clé | `REQUIRES_EXTERNAL_RUNTIME` | Même adaptateur, il suffit d'injecter la fonction d'appel. |
| Mesure CPU / RAM du budget | `REQUIRES_EXTERNAL_RUNTIME` | Non mesurable ici ; les dimensions existent, non alimentées. |

---

## 7. Comment étendre Ciel sans le casser

**Ajouter une capacité** → un fichier dans `capabilities/`, avec un manifeste honnête :
`idempotent`, `reversible`, `side_effects`, `permissions`, `affected_state`, et une sonde
d'effet si elle n'est pas idempotente. Un manifeste faux casse l'invariant 4.

**Ajouter un stockage** → implémenter `interfaces/memoryStore.ts` et l'injecter dans
`createCiel`. Ne rien importer de la plateforme dans le Core.

**Ajouter un modèle** → implémenter `interfaces/intelligenceProvider.ts` : sortie structurée
obligatoire, texte libre refusé. Le modèle ne vérifie rien et n'exécute rien.

**Ajouter un moteur** → un fichier dans `engines/`, une suite de tests dans `tests/phaseX/`,
une ligne dans `status.ts`. Pas de test = statut `NOT_IMPLEMENTED`.

---

## 8. Exécuter le projet en local

### Prérequis

1. Cloner le dépôt, entrer dans le dossier.
2. `npm install`
3. `npm install -g base44@latest`
4. Installer [Deno](https://docs.deno.com/runtime/getting_started/installation/) — le backend local tourne dessus.

### Lancer

```bash
base44 login   # une fois par machine
base44 link    # une fois par clone
base44 dev     # backend local + frontend ensemble
```

Ouvrir l'URL frontend affichée (typiquement `http://localhost:5173`).

Notes :

- **Chaque nouveau clone a besoin de `base44 link`** : il écrit `base44/.app.jsonc` (volontairement gitignoré). L'app id est dans l'URL du Builder (`app.base44.com/apps/<id>/...`).
- **`base44 dev` lance déjà le frontend** — ne jamais lancer `npm run dev` séparément.
- **L'app doit avoir été publiée au moins une fois** pour que l'UI charge sous `base44 dev`.
- Les données d'entités en local sont **en mémoire** et effacées à chaque redémarrage ; les intégrations Core et l'OAuth sont transmises à l'app déployée.

### Frontend seul contre le backend hébergé

```bash
base44 dev --remote   # ⚠️ écrit dans les données de production
```

### Publier

Ce dépôt est synchronisé avec Base44 par git : pousser, puis publier depuis le dashboard
(`base44 dashboard open`) — pas `base44 deploy`, qui contournerait la synchronisation.

---

## 9. Liens

- Intégration GitHub : https://docs.base44.com/developers/app-code/local-development/github
- Développement local : https://docs.base44.com/developers/backend/overview/local-dev/local-development-overview
- Support : https://app.base44.com/support