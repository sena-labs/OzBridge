# Publishing `warp-vsc-bridge`

Procedura end-to-end per pubblicare l'estensione sul **VS Code Marketplace** e su **Open VSX** con il publisher `sena-labs`.

Tutti i passaggi sono **one-time setup**; dopo la prima release, il publish diventa automatico al push di un tag `v*.*.*` via GitHub Actions (`.github/workflows/publish.yml`).

---

## 1. Pre-requisiti

- Account Microsoft + accesso ad [Azure DevOps](https://dev.azure.com).
- Account GitHub per autorizzare Open VSX.
- Node 20+, npm 10+.
- `vsce` e `ovsx` disponibili via `npx` (nessuna installazione globale richiesta).

---

## 2. Creare il publisher `sena-labs` su VS Code Marketplace

### 2.1 Creare l'organizzazione Azure DevOps (se non esiste)

1. Vai su https://aka.ms/SignupAzureDevOps e accedi con l'account Microsoft che userai come owner del publisher.
2. Crea un'organizzazione nominata `sena-labs` (o riusa un'organizzazione esistente).
3. Entra nell'organizzazione.

### 2.2 Generare un Personal Access Token (PAT)

1. Da Azure DevOps, click sull'icona profilo → **Personal access tokens**.
2. **New Token** con questi parametri:
   - **Name**: `vsce-sena-labs-publish`
   - **Organization**: **All accessible organizations** (⚠️ obbligatorio per `vsce`)
   - **Expiration**: 1 anno (massimo consigliato)
   - **Scopes**: Custom defined → spunta solo **Marketplace → Manage**
3. Clicca **Create** e salva il token in posto sicuro. **Non viene più mostrato.**

### 2.3 Creare il publisher su Marketplace

1. Vai su https://marketplace.visualstudio.com/manage.
2. Accedi con lo stesso account Microsoft del PAT.
3. **Create Publisher** con:
   - **Publisher ID**: `sena-labs` (deve combaciare esattamente col campo `publisher` in `package.json`)
   - **Name**: `Sena Labs`
   - **Email**: email di contatto supporto
   - **Website**: `https://github.com/sena-labs`
   - **Logo**: caricare il logo Sena Labs (opzionale ma consigliato)
4. Accetta i Publisher Agreement + Privacy terms.
5. Il publisher è ora registrato.

### 2.4 Verificare da CLI

```powershell
npx @vscode/vsce login sena-labs
# Paste del PAT quando richiesto
```

Output atteso: `Publisher 'sena-labs' verified.`

---

## 3. Creare il publisher `sena-labs` su Open VSX

Open VSX (gestito da Eclipse Foundation) è il registry per VSCodium, Cursor, Gitpod, Windsurf, Antigravity.

1. Vai su https://open-vsx.org/.
2. **Log in** con GitHub (useremo `sena-labs` come GitHub org o account).
3. Dal profilo → **Settings** → **Access Tokens** → **Generate New Token**.
   - **Description**: `ovsx-sena-labs-publish`
   - Salva il token generato.
4. Per creare il namespace:
   ```powershell
   npx ovsx create-namespace sena-labs -p <TOKEN>
   ```
5. Il namespace `sena-labs` è registrato.

---

## 4. Configurare i secret GitHub per CI

Nel repository `sena-labs/warp-vsc-bridge`:

1. **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
2. Aggiungi:
   - `VSCE_PAT` → il token Azure DevOps (step 2.2)
   - `OVSX_TOKEN` → il token Open VSX (step 3.3)

---

## 5. Publish manuale (prima release)

Dalla root del repository:

```powershell
# Verifica configurazione
npx @vscode/vsce show sena-labs.warp-vsc-bridge  # mostrerà "not found" la prima volta

# Build + test + package
npm ci
npm run compile
npm test
npm run build
npm run package  # produce warp-vsc-bridge.vsix

# Publish su VS Code Marketplace
npx @vscode/vsce publish --packagePath warp-vsc-bridge.vsix -p $env:VSCE_PAT

# Publish su Open VSX
npx ovsx publish warp-vsc-bridge.vsix -p $env:OVSX_TOKEN
```

Dopo la pubblicazione:
- Marketplace: https://marketplace.visualstudio.com/items?itemName=sena-labs.warp-vsc-bridge
- Open VSX: https://open-vsx.org/extension/sena-labs/warp-vsc-bridge

La propagazione su Marketplace può richiedere 5-30 minuti. Open VSX è istantaneo.

---

## 6. Publish automatico (release successive)

Dopo il setup, ogni push di un tag `v*.*.*` triggera automaticamente il workflow `.github/workflows/publish.yml`:

```powershell
# Bumpa la versione
npm version minor  # crea commit + tag v0.3.0

# Push tag
git push origin main --tags
```

Il workflow:
1. Esegue `npm ci`, `npm run compile`, `npm test`, `npm run build`.
2. Confeziona il VSIX.
3. Pubblica su VS Code Marketplace (usando `VSCE_PAT`).
4. Pubblica su Open VSX (usando `OVSX_TOKEN`).
5. Crea una GitHub Release con il VSIX come artifact.

---

## 7. Troubleshooting

| Sintomo | Causa | Soluzione |
|---|---|---|
| `ERROR 401 Unauthorized` su `vsce publish` | PAT scaduto o scope sbagliato | Rigenera PAT con scope `Marketplace → Manage` e **All accessible organizations** |
| `ERROR Extension name conflicts with an existing extension` | Qualcuno ha già riservato `sena-labs.warp-vsc-bridge` | Cambia `name` in `package.json` o chiedi support Marketplace |
| `ovsx publish` fallisce con `Namespace sena-labs does not exist` | Namespace Open VSX non creato | Esegui `npx ovsx create-namespace sena-labs -p <TOKEN>` |
| VSIX contiene file non desiderati | `.vscodeignore` incompleto | Verifica `.vscodeignore` esclude `test/`, `.github/`, `docs/`, `packages/*/src/` |
| Version già pubblicata | Tag già pushato e workflow eseguito | Bumpa a versione successiva (`npm version patch`) |

---

## 8. Unpublish / Deprecation

Se mai serve rimuovere una versione:

```powershell
# VS Code Marketplace
npx @vscode/vsce unpublish sena-labs.warp-vsc-bridge --version 0.1.0

# Open VSX
npx ovsx get sena-labs.warp-vsc-bridge  # verifica
# Unpublish da UI: https://open-vsx.org/extension/sena-labs/warp-vsc-bridge/manage
```

⚠️ Unpublish è **sconsigliato**: rompe tutti gli utenti che hanno quella versione installata. Preferire bump di versione con patch.

---

## Riferimenti ufficiali

- [vsce — publish extension](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [ovsx — publish to Open VSX](https://github.com/eclipse/openvsx/wiki/Publishing-Extensions)
- [Marketplace management](https://marketplace.visualstudio.com/manage)
- [Open VSX management](https://open-vsx.org/user-settings)
