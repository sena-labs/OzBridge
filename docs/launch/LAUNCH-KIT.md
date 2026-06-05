# OzBridge v1.2.0 — Launch Kit

**Independent VS Code extension + standalone MCP server that brings Warp™ Oz™ into any IDE or MCP client.**

> Compliance gate: **PASS on all 7 copy assets.** Every formal listing carries the verbatim disclaimer, ™ on first Warp/Oz mention, zero endorsement implication, companion tone, and no Warp visual identity. Two non-copy execution blockers remain (npm publish for the registry; OG-card image regen) — see Open Issues. The private Warp trademark permission is correctly absent from every public asset.

---

## Verbatim disclaimer (use exactly, every formal surface)

```
OzBridge is an independent project and is not affiliated with, endorsed by, or sponsored by Warp.
```

Nominative-use line (house style — append on highest-scrutiny surfaces, esp. Warp's own Discord):

```
Warp™ and Oz™ are trademarks of Warp, Inc., used here nominatively only to describe interoperability.
```

---

## 1. VS Code Marketplace listing  ·  impact 5 / effort 1  ·  KEEP

**Status:** copy is DONE — `package.nls.json` short description is already MCP-led and compliant; the README hero/gallery already render. Do **not** rewrite the listing.

**Action:** confirm the gallery renders on the published listing and that the `VSCE_PAT` publish is unblocked (the `publish.yml` Marketplace job skips silently if `VSCE_PAT` is unset).

**Listing short description (already live in `package.nls.json:3`):**
> Bring Warp™ Oz™ to any IDE or agent via MCP — plus native @oz in VS Code Copilot Chat. Independent project, not affiliated with, endorsed by, or sponsored by Warp.

**Images:** README hero `media/screenshot.png` (renders inline; no action). Optional premium hero `ozbridge-hero-banner` is `verdict:regen` — not required for the listing to ship.

**Posting note:** publish is tag-driven (`git tag v1.2.0 && git push --tags`). The compliant copy is the gate, and it is met.

---

## 2. Open VSX listing  ·  impact 4 / effort 1  ·  KEEP

**Status:** same VSIX, second registry. `publish.yml` already wires `ovsx publish` on tag (verified, lines 94–118). Near-zero marginal effort; reuses identical compliant copy.

**Action:** ensure `OVSX_PAT` secret is set (job skips with a warning otherwise) and the `open-vsx.org` namespace `sena-labs` is verified/claimed.

**Posting note:** captures the Cursor / VSCodium / Windsurf slice that defaults to Open VSX — the exact MCP-client audience.

---

## 3. GitHub repo README + topics  ·  impact 4 / effort 1  ·  KEEP  ·  APPROVED

**Action — set About + homepage + topics (verbatim disclaimer; 184 chars, well under GitHub's cap):**

```bash
gh repo edit sena-labs/OzBridge \
  --description "Bring Warp™ Oz™ to any IDE or agent via MCP — plus native @oz in VS Code Copilot Chat. OzBridge is an independent project and is not affiliated with, endorsed by, or sponsored by Warp." \
  --homepage "https://marketplace.visualstudio.com/items?itemName=sena-labs.ozbridge" \
  --add-topic warp,oz,mcp,model-context-protocol,vscode-extension,copilot,copilot-chat,claude-code,cursor,codex,ai-agents,llm-tools
```

**Images:** set the repo social preview to `ozbridge-social-og-card` once regenerated and re-downloaded into the repo (currently `compliancePass:false` — DO NOT use the current URL).

**Posting note:** the About uses the full **verbatim** sentence (not the README's clipped paraphrase) because a repo About is a formal listing under rule #1. Treat the rumored "1 star / no topics / stale About" as unverified — set the metadata anyway because it is free.

---

## 4. Official MCP server registry  ·  impact 5 / effort 3  ·  KEEP  ·  **NOT YET SHIPPABLE (gated)**

**This is the one genuinely gated channel.** `@sena-labs/oz-mcp-server` is 404 on npm (never published) and `publish.yml` has **no `npm publish` step** (verified — it only builds the VSIX → Marketplace/OpenVSX/GitHub Release). The README on disk is publish-ready as-is (TM marks, verbatim disclaimer, the **six** real tools, loopback/constant-time security note, client configs).

**Step A — publish npm (the actual blocker), run from repo root:**
```bash
cd packages/oz-mcp-server
npm whoami                 # 401 ⇒ not logged in
npm login                  # user with publish rights on @sena-labs
npm run build              # rebuild dist/server.js (1.2.0)
npm pack --dry-run         # expect README.md + dist/server.js + package.json
npm publish --access public   # --access public is REQUIRED for scoped pkgs
```

**Step B — write `server.json` at repo ROOT (schema-valid; the draft's was invalid), then `mcp-publisher login github && mcp-publisher publish`:**
```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.sena-labs/oz-mcp-server",
  "description": "Standalone MCP server that brings Warp(TM) Oz(TM) agents to Claude Code, Cursor, Codex, and any MCP client — no VS Code required.",
  "version": "1.2.0",
  "repository": {
    "url": "https://github.com/sena-labs/OzBridge",
    "source": "github",
    "subfolder": "packages/oz-mcp-server"
  },
  "websiteUrl": "https://github.com/sena-labs/OzBridge",
  "packages": [
    {
      "registryType": "npm",
      "identifier": "@sena-labs/oz-mcp-server",
      "version": "1.2.0",
      "transport": { "type": "stdio" },
      "runtimeHint": "npx"
    }
  ],
  "_meta": {
    "io.modelcontextprotocol.registry/publisher-provided": {
      "disclaimer": "OzBridge is an independent project and is not affiliated with, endorsed by, or sponsored by Warp.",
      "keywords": ["mcp", "warp", "oz", "agent", "claude-code", "cursor", "codex"],
      "prerequisites": "Requires Warp(TM) installed with the oz CLI on PATH and a Warp account (a free account is sufficient for local runs).",
      "tools": ["oz_agent_run", "oz_agent_run_cloud", "oz_run_get", "oz_run_list", "oz_list_models", "oz_set_default_model"]
    }
  }
}
```

Critical schema facts (verified against source + the live schema): the registry `name` is the **reverse-DNS GitHub-verified namespace** `io.github.sena-labs/...`, NOT the npm scope `@sena-labs`. `$schema` and the `packages` array are required. `version` must equal `package.json` at submit time (read it, don't paste stale — the registry rejects re-submitting a published version).

**Step C — in the registry / awesome-mcp PR, LINK the on-disk README, do not paste a reworded copy** (so the PR and the published artifact never drift):
`https://github.com/sena-labs/OzBridge/blob/main/packages/oz-mcp-server/README.md`

**Posting note:** bullseye audience, near-zero competition for the Warp-Oz slot, highest durable leverage — but it does not exist until Step A lands. Compliance PASS; execution is the gate.

---

## 5. awesome-mcp GitHub list PR  ·  impact 3 / effort 1  ·  KEEP  ·  DEPENDS ON #4

**Action:** after npm is live, pick the **single highest-traffic** awesome-mcp list (they are several competing lists with different schemas), follow its category schema exactly, submit one clean PR. Link the canonical README; include the verbatim disclaimer in the PR description.

**Posting note:** evergreen high-intent backlink. Do not open until the npm package resolves, or the entry 404s on click.

---

## 6. Show HN (Hacker News)  ·  impact 3 / effort 3  ·  KEEP  ·  APPROVED  ·  fire AFTER #4

**Title:**
`Show HN: OzBridge — bring Warp™ Oz™ agents into any IDE or MCP client (MIT)`

**Post body:**
> Warp's Oz agents are great at multi-step coding work, but they only run inside Warp's own terminal. The moment I switched to VS Code — or wanted Claude Code, Cursor, or Codex to drive an Oz run on their own — there was no way to reach them. So I built the bridge.
>
> OzBridge is a VS Code extension and a standalone MCP server that exposes the Oz agent toolset to any editor or agent that speaks MCP.
>
> In VS Code it registers an `@oz` chat participant and a set of Language Model Tools, so Copilot Agent mode can run, query, and list Oz agent runs on its own without you typing `@oz`. Outside VS Code, it runs an MCP 2025-03-26 server over HTTP+SSE that Claude Code, Cursor, and Codex connect to. If you don't want the editor at all, there's a standalone `@sena-labs/oz-mcp-server` package.
>
> How it talks to Warp: it shells out to the documented `oz` CLI and sets the documented `WARP_OUTPUT_FORMAT=json` to parse structured output instead of scraping the terminal. No private APIs, no reverse engineering.
>
> MIT-licensed, ~160 KB runtime, no third-party runtime deps, cross-platform (macOS/Linux/Windows). The transport and the CLI-output parser are covered by 1,400+ tests.
>
> Prerequisites: Warp installed with `oz` on your PATH, a Warp account (free tier works for local runs), and — to invoke `@oz` or the Agent-mode tools — the GitHub Copilot Chat extension.
>
> Install: `code --install-extension sena-labs.ozbridge`
> Repo: https://github.com/sena-labs/OzBridge
>
> OzBridge is an independent project and is not affiliated with, endorsed by, or sponsored by Warp.

**Prepared first comment (post once submission is live):**
> Happy to go into the internals, since a bridge like this lives or dies on them.
>
> Transport: the embedded MCP server binds to loopback (127.0.0.1) by default. `GET /sse` opens a Server-Sent-Events stream; the first frame is an `endpoint` event telling the client where to POST. The client then sends JSON-RPC 2.0 requests to `/messages?sessionId=<uuid>`, and responses come back over the SSE stream. There's also a `GET /health`. It speaks MCP 2025-03-26 and falls back to 2024-11-05.
>
> Auth: a bearer token is optional and off by default, because the server only listens on loopback. If you change the bind address to anything non-loopback, the server refuses to start unless you've set a token — I'd rather fail closed than silently expose a JSON-RPC surface that can spawn the `oz` CLI. When a token is set, it's checked with Node's `crypto.timingSafeEqual` (length-padded) so the comparison doesn't leak via timing.
>
> How Oz is invoked: OzBridge spawns the same `oz` binary Warp ships and documents, with `WARP_OUTPUT_FORMAT=json` so output is structured. No undocumented flags or internal APIs. The output parser has a 5-level fallback for the cases where the CLI interleaves plain text and JSON.
>
> VS Code side: the `@oz` participant uses the stable Chat Participant API; the Language Model Tools are declared in `package.json` so Agent mode can discover and call them in agentic flows.
>
> Source is MIT, so all of the above is verifiable in the repo: https://github.com/sena-labs/OzBridge
>
> OzBridge is an independent project and is not affiliated with, endorsed by, or sponsored by Warp.

**Images:** none inline (HN is text). The repo link unfurls the social card on some surfaces — ensure `ozbridge-social-og-card` is regenerated + set as the repo social preview first.

**Posting note:** post Tue–Thu morning US Eastern. Engineering-first; the security story in the comment is now factually correct (verified against `server.ts:69–75` — loopback default, optional token, hard non-loopback refusal). Never reference the private Warp permission. **Caveat:** HN strips the ™ from rendered titles and ignores markdown — the body carries Warp™/Oz™ on first mention, so rule #2 holds on the durable surface regardless.

---

## 7. Warp community Discord #showcase  ·  impact 4 / effort 2  ·  KEEP  ·  APPROVED

**Post (attach `media/screenshot.png` inline):**
> Hey all — I built an independent extension that brings Warp™ Oz™ into VS Code and any MCP client (Claude Code, Cursor, Codex).
>
> Inside VS Code you get `@oz` right in Copilot Chat, a sidebar for your runs, schedules and secrets, and a Warp Drive browser. Prefer to drive it from elsewhere? Flip on the embedded MCP server and the same Oz toolset is available to Claude Code over HTTP+SSE.
>
> One line to try it:
> ```
> code --install-extension sena-labs.ozbridge
> ```
> Repo: https://github.com/sena-labs/OzBridge
> *[attach: media/screenshot.png]*
>
> *Warp™ and Oz™ are trademarks of Warp, Inc., used here nominatively only to describe interoperability. OzBridge is an independent project and is not affiliated with, endorsed by, or sponsored by Warp.*

**Images:** primary = `media/screenshot.png` (the README hero, original art, attach inline — the scroll-stopper). Optional richer 1:1 = `ozbridge-square-promo-tile` once regenerated.

**Posting note:** this is Warp's own house → strictest review. Both hard rules are met AND the nominative-use attribution line is included (house style per commit `550cac8`). Zero mention of the private permission (grep-confirmed absent). Attach the image — a #showcase post without one is half an asset.

---

## 8. Reddit r/ChatGPTCoding  ·  impact 3 / effort 2  ·  KEEP  ·  APPROVED  ·  the single Reddit bet  ·  AFTER #4

**Title:**
`Firing Warp™ Oz™ agent runs from Claude Code and Cursor without leaving the editor — one MCP bridge`

**Post body (attach an original screenshot — Claude Code terminal dispatching an Oz run; NO Warp branding):**
> **[Image: Claude Code terminal showing an Oz agent run dispatched through the MCP bridge — original screenshot, no Warp branding]**
>
> I kept window-switching to Warp™ just to kick off an Oz™ agent run, so I wired the two together: **OzBridge**, a VS Code extension *and* a standalone MCP server. Claude Code and Cursor (or any MCP client) talk to it over HTTP+SSE and call the Oz tools directly.
>
> **The workflow**
>
> Start the server — no VS Code needed for Claude Code / Cursor:
> ```bash
> npx @sena-labs/oz-mcp-server --port 3847 --token my-secret
> ```
>
> **Claude Code** — `~/.claude.json`:
> ```json
> {
>   "mcpServers": {
>     "oz-bridge": {
>       "type": "sse",
>       "url": "http://127.0.0.1:3847/sse",
>       "headers": { "Authorization": "Bearer my-secret" }
>     }
>   }
> }
> ```
> Or one line:
> ```bash
> claude mcp add --transport sse oz-bridge http://127.0.0.1:3847/sse \
>   --header "Authorization: Bearer my-secret"
> ```
>
> **Cursor** — `~/.cursor/mcp.json`:
> ```json
> {
>   "mcpServers": {
>     "oz-bridge": {
>       "url": "http://127.0.0.1:3847/sse",
>       "headers": { "Authorization": "Bearer my-secret" }
>     }
>   }
> }
> ```
>
> Both clients then auto-discover the tools (`oz_agent_run`, `oz_run_list`, `oz_list_models`, …) and can call them in agent mode.
>
> **One heads-up:** `oz_agent_run` is local, but `oz_agent_run_cloud` **spends Warp credits** — worth knowing before you hand it to an auto-approving agent loop.
>
> **Honest prerequisites:** Warp installed, the `oz` CLI on your PATH, a Warp account (free tier works for local runs), and Node 20+ for the standalone server.
>
> Repo + full docs: https://github.com/sena-labs/OzBridge
>
> ---
> *OzBridge is an independent project and is not affiliated with, endorsed by, or sponsored by Warp.*
>
> ---
> What are you actually handing off to agents from inside your editor — and are you letting them fire runs autonomously, or keeping a human in the loop?

**Images:** one original screenshot/GIF of a Claude Code → Oz run. Optional 1:1 = `ozbridge-square-promo-tile` (regen first). **No Warp logo/wordmark/brand colors.**

**Posting note:** depends on npm being live (the `npx` line must work). Post as a builder sharing a workflow, not an ad. Don't upvote your own post; engage in comments early. Disclaimer is in the body as belt-and-suspenders even though the linked repo also carries it.

---

## Optional (NOT in the launch set) — Dev.to evergreen  ·  APPROVED

Ship only **after** all must-haves land; `canonical_url` → the repo. Full approved copy exists for A7-devto-evergreen. One image fix is mandatory before publishing: **repoint `cover_image` and the inline embed to `media/screenshot-mcp.png`** — the draft referenced `media/hero.png`, which **does not exist** (verified; `media/` has no `hero.png`). The two tool-name surfaces (4 VS Code LM tools vs 6 MCP tools) are deliberately different and are explained in the body. Verbatim disclaimer top + bottom; Warp™/Oz™ in the title.

---

## Channels killed (and why)

- **Reddit r/vscode** — beginner/theme traffic, anti-self-promo; the Warp+account+oz prerequisite wipes out conversion. Overlapping users reached via r/ChatGPTCoding.
- **Reddit r/programming** — massive, generic, promotion-hostile; a niche bridge reads as spam. HN covers broad credibility better.
- **Reddit r/LocalLLaMA** — values clash: local/offline ethos vs hosted Warp Oz + paid credits. Expect "why not local?", not installs.
- **Product Hunt** — heavy launch ritual for a maker crowd, not Warp-Oz pros; external prerequisite crushes conversion.
- **YouTube demo video** — production/SEO too heavy for a solo maintainer; static hero + optional GIF cover the job.
- **X/Twitter thread** — no audience ⇒ ~0 qualified installs. Permitted only as a free 60-second reshare of the HN link if an account already exists.
- **Dev.to** (as a launch lever) — real writing time for diffuse, low-intent reach; allowed only as an optional post-launch nice-to-have, canonical-linked.
- **LinkedIn / Mastodon / Bluesky / Medium / Hashnode** — wrong surface or no pre-built audience; near-zero cold reach; duplicate jobs already covered.
- **Indie Hackers** — founder/revenue-oriented; a free MIT companion has no monetization narrative.
- **Email newsletter** — no list exists; capture interest via GitHub watch/stars instead.

---

## Launch-day sequence

**Pre-flight (do BEFORE launch day — these gate everything):**
0a. Re-download all 3 launch images into the repo — the `replicate.delivery` URLs expire ~24h. The OG card (`compliancePass:false`) and hero+tile (`verdict:regen`) should be regenerated first.
0b. `npm publish --access public` the MCP server (Channel 4, Step A) — **the master dependency** for #4, #5, #6, #8.
0c. Submit `server.json` via `mcp-publisher` (Channel 4, Step B).
0d. Confirm `VSCE_PAT` + `OVSX_PAT` secrets set; verify Open VSX `sena-labs` namespace.

**Launch day (in order):**
1. **Tag the release** → `git tag v1.2.0 && git push --tags` — fires Marketplace (#1) + Open VSX (#2) + GitHub Release. *(Confirm gallery renders.)*
2. **GitHub repo metadata** (#3) — run the `gh repo edit` command; set the social preview image. *(Free, do early; everything links here.)*
3. **awesome-mcp PR** (#5) — one clean PR to the highest-traffic list, linking the canonical README.
4. **Warp Discord #showcase** (#7) — warm post + `media/screenshot.png`. *(Lowest-risk audience; warm up here.)*
5. **Reddit r/ChatGPTCoding** (#8) — workflow post + original screenshot; stay in comments.
6. **Show HN** (#6) — Tue–Thu AM US Eastern; post the prepared first comment immediately; man the thread.

**Post-launch (optional):** Dev.to evergreen (cover repointed to `screenshot-mcp.png`); X reshare of the HN link if an account exists.

**Throughline:** verbatim disclaimer on every surface · Warp™/Oz™ on first mention · never imply endorsement · original art only · the private Warp permission stays private.