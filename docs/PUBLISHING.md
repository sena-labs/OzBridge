# Publishing `ozbridge`

End-to-end procedure for publishing the extension to the **VS Code Marketplace** and **Open VSX** under the `sena-labs` publisher.

Every step below is **one-time setup**; after the first release, publishing happens automatically when a `v*.*.*` tag is pushed, via GitHub Actions (`.github/workflows/publish.yml`).

---

## ⚠️ Deadline: 1 December 2026 — `VSCE_PAT` stops working

**Azure DevOps retires global Personal Access Tokens on 2026-12-01.** The Azure
DevOps UI states it directly on the token page:

> Beginning December 1, 2026, Global Personal Access Tokens (PATs) scoped to all
> accessible organizations will no longer be supported.

`VSCE_PAT` is created with **Organization: All accessible organizations**, because
the Marketplace is a service separate from any Azure DevOps organization and an
org-scoped token cannot authenticate against it. That is exactly the option being
retired — so this is not a token expiry that can be fixed by minting another one
the same way. The mechanism goes away.

**Impact if nothing is done:** after 2026-12-01 the `publish-marketplace` job
fails to authenticate. Because the job skips with a warning when `VSCE_PAT` is
absent but *fails* when the token is rejected, the release stops there.

**Migration:** move Marketplace publishing to Microsoft Entra ID authentication
with workload identity federation, as recommended in the
[vsce publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).
Plan it for **October–November 2026**, so a broken pipeline is discovered on a
scheduled change rather than on a release.

**Not affected:**

| Channel | Auth | Action needed |
| --- | --- | --- |
| npm (`@sena-labs/oz-mcp-server`) | GitHub OIDC (trusted publishing) | none |
| MCP Registry | GitHub OIDC | none |
| Open VSX (`OVSX_PAT`) | Open VSX access token | none |
| VS Code Marketplace (`VSCE_PAT`) | Azure DevOps global PAT | **migrate before 2026-12-01** |

Only the Marketplace still depends on a long-lived credential. The other three
channels were moved to OIDC in 1.4.0 and hold no persistent secret.

---

## 1. Prerequisites

- A Microsoft account with access to [Azure DevOps](https://dev.azure.com).
- A GitHub account, used to authorise Open VSX.
- Node 20+, npm 10+.
- `vsce` and `ovsx` available through `npx` (no global install required).

---

## 2. Create the `sena-labs` publisher on the VS Code Marketplace

### 2.1 Create an Azure DevOps organization (if you have none)

The PAT is signed from an organization, but its name is irrelevant to `vsce` —
what matters is the **All accessible organizations** scope set in step 2.2. Any
organization the publisher-owning account can reach will do.

1. Sign in to https://dev.azure.com with the Microsoft account that owns — or will
   own — the Marketplace publisher.
2. If the account has no organization, the portal offers **Create new organization**.
   Accept; it is free.
3. No project is needed. The token page is reachable directly at
   `https://dev.azure.com/<organization>/_usersSettings/tokens`.

### 2.2 Generate a Personal Access Token (PAT)

1. Open `https://dev.azure.com/<organization>/_usersSettings/tokens`, or from the
   profile icon → **User settings** → **Personal access tokens**.
2. **+ New Token**, with these parameters:
   - **Name**: `vsce-sena-labs-publish`
   - **Organization**: **All accessible organizations** (⚠️ required by `vsce` —
     an org-scoped token returns `401` against the Marketplace)
   - **Expiration**: 1 year (the recommended maximum)
   - **Scopes**: Custom defined → click **Show all scopes** at the bottom of the
     panel, then tick **Marketplace → Manage** only. The Marketplace group is
     hidden until that link is clicked.
3. Click **Create** and store the token somewhere safe. **It is never shown again.**

> If **All accessible organizations** is not selectable, a tenant policy is
> blocking global PATs. Ask the tenant administrator to allow it — see also the
> retirement notice at the top of this document.

### 2.3 Create the publisher on the Marketplace

1. Go to https://marketplace.visualstudio.com/manage.
2. Sign in with the same Microsoft account used for the PAT.
3. **Create Publisher** with:
   - **Publisher ID**: `sena-labs` (must match the `publisher` field in
     `package.json` exactly)
   - **Name**: `Sena Labs`
   - **Email**: support contact address
   - **Website**: `https://github.com/sena-labs`
   - **Logo**: upload the Sena Labs logo (optional but recommended)
4. Accept the Publisher Agreement and privacy terms.
5. The publisher is now registered.

### 2.4 Verify from the CLI

```powershell
npx @vscode/vsce verify-pat sena-labs
# reads $env:VSCE_PAT, or prompts for the token
```

This confirms both that the token carries the right scope and that the account is
an owner of the publisher, without publishing anything.

> Avoid `vsce login` on machines with no OS credential store: `vsce` falls back to
> writing the token in clear text under `~/.vsce`.

---

## 3. Create the `sena-labs` publisher on Open VSX

Open VSX (run by the Eclipse Foundation) is the registry used by VSCodium, Cursor, Gitpod, Windsurf and Antigravity.

1. Go to https://open-vsx.org/.
2. **Log in** with GitHub (the `sena-labs` GitHub account).
3. Sign the Eclipse Publisher Agreement when prompted — publishing fails without it.
4. From the profile → **Settings** → **Access Tokens** → **Generate New Token**.
   - **Description**: `ovsx-sena-labs-publish`
   - Copy the token immediately; like the Azure PAT, it is shown only once and
     cannot be recovered afterwards.
5. To create the namespace:
   ```powershell
   npx ovsx create-namespace sena-labs -p <TOKEN>
   ```
6. The `sena-labs` namespace is now registered.

> A namespace starts **unverified**, which does not block publishing — it only
> shows a warning badge on the extension page. To claim ownership and clear it,
> open an issue with the
> [namespace ownership template](https://github.com/EclipseFdn/open-vsx.org/issues/new?template=claim-namespace-ownership.yml).

---

## 4. Configure the GitHub secrets for CI

In the `sena-labs/OzBridge` repository:

1. **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
2. Add:
   - `VSCE_PAT` → the Azure DevOps token (step 2.2)
   - `OVSX_PAT` → the Open VSX token (step 3.4)

> Names must match exactly what `.github/workflows/publish.yml` reads. When a
> secret is missing the corresponding job **skips with a warning and the run
> still closes green** — the release looks successful while the extension was
> never published.

npm and the MCP Registry need no secret: both authenticate through GitHub OIDC.
For npm this is [trusted publishing](https://docs.npmjs.com/trusted-publishers),
configured on npmjs.com against this repository and the `publish.yml` workflow
filename.

---

## 5. Manual publish (first release)

From the repository root:

```powershell
# Check the current state
npx @vscode/vsce show sena-labs.ozbridge  # reports "not found" the first time

# Build + test + package
npm ci
npm run compile
npm test
npm run build
npm run package  # produces ozbridge.vsix

# Publish to the VS Code Marketplace
npx @vscode/vsce publish --packagePath ozbridge.vsix -p $env:VSCE_PAT

# Publish to Open VSX
npx ovsx publish ozbridge.vsix -p $env:OVSX_PAT
```

After publishing:
- Marketplace: https://marketplace.visualstudio.com/items?itemName=sena-labs.ozbridge
- Open VSX: https://open-vsx.org/extension/sena-labs/ozbridge

Marketplace propagation can take 5–30 minutes. Open VSX is immediate.

---

## 6. Automatic publish (subsequent releases)

Once set up, pushing a `v*.*.*` tag triggers `.github/workflows/publish.yml`:

```powershell
# Bump the version
npm version minor  # creates the commit + tag

# Push the tag
git push origin main --tags
```

Keep all four version fields aligned before tagging — `package.json`,
`packages/oz-mcp-server/package.json`, and both `version` fields in `server.json`.
The workflow fails fast on skew.

The workflow:

1. Runs `npm ci`, the version-consistency check, `npm run compile`, `npm test`, `npm run build`.
2. Packages the VSIX.
3. Publishes to the VS Code Marketplace (using `VSCE_PAT`).
4. Publishes to Open VSX (using `OVSX_PAT`).
5. Publishes `@sena-labs/oz-mcp-server` to npm (GitHub OIDC, no secret).
6. Publishes `server.json` to the MCP Registry (GitHub OIDC, no secret), after
   checking that the `mcpName` published to npm matches the server name.
7. Creates a GitHub Release with the VSIX attached.

Every publishing job is idempotent: it queries the target registry first and skips
when the version is already served. A release that failed halfway can therefore be
finished by re-running the workflow — `gh workflow run publish.yml` — with no
re-tagging and no duplicate-version errors.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ERROR 401 Unauthorized` from `vsce publish` | PAT expired, wrong scope, or scoped to a single organization | Regenerate the PAT with scope `Marketplace → Manage` and **All accessible organizations** |
| `ERROR Extension name conflicts with an existing extension` | `sena-labs.ozbridge` is already taken | Change `name` in `package.json`, or contact Marketplace support |
| `ovsx publish` fails with `Namespace sena-labs does not exist` | The Open VSX namespace was never created | Run `npx ovsx create-namespace sena-labs -p <TOKEN>` |
| The VSIX contains unwanted files | `.vscodeignore` is incomplete | Check that `.vscodeignore` excludes `test/`, `.github/`, `docs/`, `packages/*/src/`, `dist-mcpb/` |
| A publishing job was skipped and the run still passed | The matching secret is not configured | Add `VSCE_PAT` / `OVSX_PAT`, then re-run the workflow |
| `cannot publish duplicate version` from the MCP Registry | That version is already published | Nothing to do — the job's guard skips it; the error only appears on versions of the workflow predating the guard |
| Version skew reported by the build job | The four version fields disagree | Align `package.json`, `packages/oz-mcp-server/package.json` and both fields in `server.json` |

---

## 8. Unpublish / deprecation

If a version ever has to be withdrawn:

```powershell
# VS Code Marketplace
npx @vscode/vsce unpublish sena-labs.ozbridge --version 0.1.0

# Open VSX
npx ovsx get sena-labs.ozbridge  # check first
# Unpublish from the UI: https://open-vsx.org/extension/sena-labs/ozbridge/manage
```

For the MCP Registry, use the publisher's lifecycle command instead of removing anything:

```bash
mcp-publisher status --status deprecated --all-versions \
  --message "<reason>" io.github.sena-labs/<server-name>
```

⚠️ Unpublishing is **discouraged**: it breaks every user who already has that version installed. Prefer shipping a patch release.

---

## Official references

- [vsce — publish extension](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [ovsx — publish to Open VSX](https://github.com/eclipse/openvsx/wiki/Publishing-Extensions)
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers)
- [MCP Registry — publishing](https://github.com/modelcontextprotocol/registry/blob/main/cmd/publisher/README.md)
- [Marketplace management](https://marketplace.visualstudio.com/manage)
- [Open VSX management](https://open-vsx.org/user-settings)
