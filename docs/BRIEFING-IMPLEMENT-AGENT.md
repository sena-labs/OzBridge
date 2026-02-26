# BRIEFING per Implement Agent — DevForge Refactoring

**Data**: 25 febbraio 2026  
**Stato**: Phase 1 completata → **iniziare da Phase 2**

---

## 1. Documenti di riferimento (DEVONO essere letti)

| Documento | Percorso | Contenuto |
|-----------|----------|-----------|
| **Specifica** | `docs/SPEC-DEVFORGE.md` | Requisiti funzionali, architettura target, API |
| **Architettura** | `docs/ARCHITECTURE-DEVFORGE.md` | Design dettagliato, interfacce, data flow |
| **Piano implementazione** | `docs/IMPLEMENTATION-PLAN.md` | Fasi 1→6 con file, modifiche, test, gate |

---

## 2. Stato attuale del progetto

### Metriche

| Metrica | Valore |
|---------|--------|
| Test passati | **431** (25 file test) |
| Coverage | ~99% |
| Bundle size | ~25 KB |
| Compilazione | `tsc --noEmit` ✅ (toolkit + root) |

### Phase 1 — COMPLETATA

File **creati**:

| File | Contenuto |
|------|-----------|
| `packages/copilot-chat-toolkit/src/i18n/types.ts` | `MessageCatalog`, `LocaleBundle`, `II18nService` |
| `packages/copilot-chat-toolkit/src/i18n/i18nService.ts` | Classe `I18nService` — fallback locale→en→raw key, placeholder `{0}..{N}` |
| `test/core/i18n.test.ts` | 19 test per I18nService |

File **modificati**:

| File | Modifica |
|------|----------|
| `packages/copilot-chat-toolkit/src/types.ts` | Aggiunto: `FollowupMap`, `IPlugin`, `PluginContext`, `IPluginLogger`, `PluginRegistration`, `PluginInfo`, `PluginRegistryChangeEvent`. Import `II18nService` da `./i18n/types.js` |
| `packages/copilot-chat-toolkit/src/index.ts` | Aggiunte sezioni `// ── i18n ──` e plugin exports. `FollowupMap` ora esportato da `./types.js` |
| `packages/copilot-chat-toolkit/src/participant/followups.ts` | `FollowupMap` ora importato da `../types.js` (centralizzato, non più definito localmente) |

---

## 3. Convenzioni di codice (CRITICHE — rispettare)

### Stile generale
- **Section headers**: `// ============================================================================`
- **JSDoc** su tutti gli export pubblici
- **Commenti IMPL**: ogni modifica ha `// IMPL: Phase N — descrizione breve`
- **TypeScript strict**: `strict: true`, `noImplicitAny`, `strictNullChecks`

### Import
- **Toolkit interno**: usare estensione `.js` (Node16 module resolution)
  ```typescript
  import type { II18nService } from './i18n/types.js';
  ```
- **Da toolkit a bridge**: usare `'copilot-chat-toolkit'` (alias in vitest.config.ts)
  ```typescript
  import { I18nService } from 'copilot-chat-toolkit';
  ```

### Test
- Framework: **Vitest** con `vi.fn()`, `vi.mock()`
- Pattern: factory functions in `test/helpers.ts`
- Mock vscode: `test/mocks/vscode.ts`
- Alias vitest.config.ts: `'copilot-chat-toolkit'` → `packages/copilot-chat-toolkit/src/index.ts`
- i18n mock tipico: `t: (key: string) => key` (restituisce la chiave come stringa)

### Build
- esbuild: `node esbuild.js` (NON `npx node esbuild.js`)
- tsc toolkit: `cd packages/copilot-chat-toolkit && npx tsc --noEmit`
- tsc root: `npx tsc --noEmit`
- test: `npx vitest run`

---

## 4. Fasi da implementare

```
Phase 2 ─── Core engine (PluginRegistry, HierarchicalRouter, AggregatedFollowups, comandi core)
Phase 2b ── i18n cataloghi core (10 lingue × ~15 chiavi)
Phase 3 ─── Plugin Oz (migrazione src/ → plugins/oz/)
Phase 4 ─── Plugin Shell (nuovo — streaming exec)
Phase 5 ─── Rename globale + package.json + extension.ts
Phase 5b ── Cataloghi locale Oz + Shell (10 lingue ciascuno)
Phase 6 ─── Pulizia + ConfigMigrator + docs + l10n bundles
```

### Istruzioni operative
1. **Un file alla volta** — il progetto deve compilare dopo ogni blocco di lavoro
2. **Gate dopo ogni fase**: `tsc --noEmit` + `vitest run` + `node esbuild.js`
3. **Toccare tutti i call-site** — se cambi un tipo o un export, aggiorna tutti gli import
4. **Se il design non corrisponde al codice**, fermarsi e proporre correzione minima
5. **Nuovi test** per ogni nuovo modulo — target ≥ 450 test totali, ≥ 95% coverage

---

## 5. Struttura file attuale (rilevante)

```
packages/copilot-chat-toolkit/src/
├── i18n/
│   ├── types.ts          ← [Phase 1] MessageCatalog, LocaleBundle, II18nService
│   └── i18nService.ts    ← [Phase 1] I18nService class
├── participant/
│   ├── commandRouter.ts  ← CommandRouter (usato oggi, sarà sostituito da HierarchicalRouter)
│   ├── followups.ts      ← FollowupProvider (import FollowupMap da ../types.js)
│   └── handler.ts        ← registerChatParticipant()
├── types.ts              ← [Phase 1] Tutti i tipi: base + plugin system + i18n re-export
└── index.ts              ← [Phase 1] Barrel exports aggiornato

src/
├── extension.ts          ← Entry point attuale (@warp) — sarà riscritto in Phase 5
├── commands/             ← 8 comandi Oz — migrano a src/plugins/oz/commands/ in Phase 3
├── parsers/              ← jsonParser + outputFormatter
├── participant/          ← followups Oz + handler
├── services/             ← configManager, contextCollector, logger, ozCliService, runPoller
└── types/index.ts        ← tipi Oz (WarpBridgeConfig, DTOs, IOzCliService)

test/
├── core/
│   └── i18n.test.ts      ← [Phase 1] 19 test I18nService
├── commands/             ← test comandi Oz (migrano in Phase 3)
├── services/             ← test servizi Oz (migrano in Phase 3)
├── parsers/              ← test parser
├── participant/          ← test followups + handler
├── helpers.ts            ← factory per mock (stream, token, configManager, cli, contextCollector)
├── mocks/vscode.ts       ← mock completo VS Code API
├── smoke.test.ts         ← test lifecycle extension
└── extensionEdge.test.ts ← test edge case extension
```

---

## 6. Avvertenze specifiche

- **`SlashCommandHandler`** e **`IContextCollector`** esistono GIÀ in `types.ts` — NON duplicare
- **`FollowupMap`** è ora in `types.ts`, NON più in `followups.ts` — è ri-esportato dal barrel
- **`CommandRouter`** nel toolkit resta invariato — `HierarchicalRouter` è un NUOVO modulo in `src/core/` che lo estende/sostituisce
- **vitest.config.ts** ha alias `'copilot-chat-toolkit'` → source path (no build needed per test)
- **I18n mock pattern** per test: `{ locale: 'en', registerCatalog: vi.fn(), t: vi.fn((key) => key) }`
