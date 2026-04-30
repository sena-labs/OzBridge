# OzBridge — Test E2E (Playwright + VS Code)

Questa suite avvia un'istanza reale di **VS Code** (Electron) con
l'estensione caricata in *development mode* tramite
`@vscode/test-electron`, e simula un utente che:

1. attende il boot del workbench e verifica l'attivazione dell'estensione;
2. apre la **Command Palette** e controlla che i comandi `OzBridge: …`
   siano registrati;
3. apre il **viewlet OzBridge** nell'activity bar e ispeziona le tree
   views *Runs & Resources* e *Warp Drive*;
4. esegue `OzBridge: Open Dashboard` e valida il contenuto del
   **webview** (titolo, sezioni, sparkline);
5. verifica la presenza della voce di **status bar**;
6. campiona **CPU/RAM** dell'intero albero di processi del workbench
   per tutta la durata dei test.

## Esecuzione

```powershell
npm run build           # compila l'estensione in dist/ (richiesto dal launch)
npm run test:e2e        # headless (default)
npm run test:e2e:headed # con UI visibile (debug locale)
```

> Su Linux CI usa `xvfb-run -a npm run test:e2e`.

Al primo lancio Playwright/`@vscode/test-electron` scarica VS Code
*stable* nella cache locale `.vscode-test/`.

## Output e artefatti

Tutti gli artefatti finiscono in `test-results/`:

| File                                          | Descrizione                                    |
| --------------------------------------------- | ---------------------------------------------- |
| `e2e-report/index.html`                       | report HTML Playwright                         |
| `e2e.json`                                    | report JSON machine-readable                   |
| `e2e-artifacts/resource-samples.jsonl`        | campioni risorse (1.5 s) — un JSON per riga    |
| `e2e-artifacts/resource-summary.json`         | aggregato (peak/avg CPU%, peak/avg RSS MB)     |
| `e2e-artifacts/<test-name>/trace.zip`         | trace Playwright (solo su failure)             |
| `e2e-artifacts/<test-name>/video.webm`        | video Electron (solo su failure)               |

## Monitor risorse

`test/e2e/helpers/resourceMonitor.ts` usa `Get-CimInstance` su Windows
e `ps` su Unix per ricostruire l'albero dei processi a partire dal PID
del processo principale di Electron e calcolare RSS totale + CPU%
incrementale. Nessuna dipendenza nativa.

I campioni includono anche `loadAvg1m` e memoria libera/totale del
sistema per facilitare correlazioni con eventuali rallentamenti CI.

## Note

- Lo script imposta `OZBRIDGE_E2E=1`: l'estensione può leggerla per
  evitare di spawnare la CLI Oz reale durante i test.
- Il workspace di test è una cartella tmp con un solo `README.md`,
  rimossa al termine.
- I test sono `fullyParallel: false` con `workers: 1`: un'unica
  istanza di VS Code per esecuzione (più affidabile, meno rumoroso
  per il monitor).
