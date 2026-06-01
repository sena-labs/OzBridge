#!/usr/bin/env node
// ---------------------------------------------------------------------------
// render-mcp-promo.mjs — headless promotional render of the MCP bridge
// ---------------------------------------------------------------------------
//
// The live capture harness (capture.mjs) needs an interactive desktop session
// to launch VS Code via Electron. In CI / headless environments that is not
// available, so this script renders a faithful, dark-theme representation of
// the **embedded MCP bridge** surface — the "Register MCP client" quick pick
// (Claude Code / Cursor / Codex) plus the listening endpoint — using a headless
// Chromium. Every string is taken verbatim from the extension:
//   - registrar display names + config paths (src/mcp/registrars/*.ts)
//   - quick-pick title/placeholder (src/mcp/lifecycle.ts runRegistrarCommand)
//   - endpoint format http://127.0.0.1:3847/sse (McpServer)
//
// Output: media/screenshot-mcp.png. Prefer a real capture from capture.mjs on
// a desktop when one is available; this render exists so the Marketplace listing
// never ships a wrong/duplicate image.
//
// Usage: node scripts/screenshots/render-mcp-promo.mjs

import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', '..', 'media', 'screenshot-mcp.png');

const HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
  :root{
    --bg:#1e1e1e; --sidebar:#252526; --activity:#333333; --title:#323233;
    --tab:#2d2d2d; --fg:#cccccc; --muted:#858585; --border:#3c3c3c;
    --accent:#0e639c; --focus:#007fd4; --sel:#04395e; --hover:#2a2d2e;
    --green:#89d185; --link:#3794ff; --badge:#4d4d4d;
  }
  *{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,"Segoe UI",system-ui,sans-serif;}
  html,body{background:#181818;}
  .canvas{width:1200px;height:740px;background:#181818;display:flex;align-items:center;justify-content:center;}
  .win{width:1140px;height:680px;border-radius:8px;overflow:hidden;background:var(--bg);
       box-shadow:0 18px 60px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.04);display:flex;flex-direction:column;position:relative;}
  .titlebar{height:34px;background:var(--title);display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:12px;flex:0 0 34px;position:relative;}
  .traffic{position:absolute;left:12px;display:flex;gap:8px;}
  .traffic span{width:12px;height:12px;border-radius:50%;}
  .body{flex:1;display:flex;min-height:0;}
  /* activity bar */
  .activity{width:48px;background:var(--activity);display:flex;flex-direction:column;align-items:center;padding-top:10px;gap:18px;}
  .activity .ico{width:24px;height:24px;color:#858585;display:flex;align-items:center;justify-content:center;}
  .activity .ico.active{color:#fff;border-left:2px solid var(--focus);margin-left:-2px;padding-left:2px;}
  /* sidebar */
  .sidebar{width:300px;background:var(--sidebar);display:flex;flex-direction:column;}
  .sb-title{padding:10px 14px 8px;color:var(--muted);font-size:11px;letter-spacing:.08em;font-weight:600;}
  .row{display:flex;align-items:center;gap:7px;padding:3px 10px 3px 14px;color:var(--fg);font-size:13px;height:24px;}
  .row .tw{width:14px;color:var(--muted);font-size:10px;}
  .row .ci{width:16px;height:16px;color:#858585;display:inline-flex;align-items:center;justify-content:center;}
  .row.cat{color:#cccccc;font-weight:600;}
  .row.child{padding-left:38px;}
  .muted{color:var(--muted);}
  .badge{margin-left:auto;background:var(--badge);color:#ddd;border-radius:9px;font-size:10px;padding:0 6px;height:15px;display:inline-flex;align-items:center;}
  /* editor */
  .editor{flex:1;background:var(--bg);display:flex;flex-direction:column;}
  .tabs{height:35px;background:#252526;display:flex;align-items:flex-end;}
  .tab{height:35px;display:flex;align-items:center;gap:8px;padding:0 14px;background:var(--bg);color:var(--fg);font-size:12px;border-right:1px solid #1a1a1a;}
  .tab .dot{width:8px;height:8px;border-radius:50%;background:#cccccc;}
  .edcontent{flex:1;padding:18px 22px;color:#6a6a6a;font-size:13px;font-family:"Cascadia Code",Consolas,monospace;line-height:1.7;}
  .edcontent .k{color:#569cd6;} .edcontent .s{color:#ce9178;} .edcontent .c{color:#6a9955;} .edcontent .p{color:#9cdcfe;}
  /* dim + quickpick overlay */
  .scrim{position:absolute;inset:0;background:rgba(0,0,0,.35);}
  .qp{position:absolute;top:8px;left:50%;transform:translateX(-50%);width:620px;background:#252526;border:1px solid #454545;
      border-radius:6px;box-shadow:0 8px 28px rgba(0,0,0,.55);overflow:hidden;}
  .qp-title{padding:8px 12px 4px;color:#bbb;font-size:12px;}
  .qp-input{margin:0 8px 8px;height:30px;background:#3c3c3c;border:1px solid var(--focus);border-radius:3px;color:#cccccc;
            display:flex;align-items:center;padding:0 10px;font-size:13px;}
  .qp-input .ph{color:#8a8a8a;}
  .qp-list{padding-bottom:6px;}
  .qp-item{display:flex;align-items:center;gap:10px;padding:7px 14px;color:#cccccc;font-size:13px;}
  .qp-item.sel{background:var(--sel);}
  .qp-item .ci{width:16px;height:16px;color:#cfcfcf;display:inline-flex;align-items:center;justify-content:center;}
  .qp-item .name{font-weight:500;}
  .qp-item .path{margin-left:auto;color:#9a9a9a;font-size:12px;font-family:"Cascadia Code",Consolas,monospace;}
  .qp-item .ok{color:var(--green);}
  /* notification toast */
  .toast{position:absolute;right:18px;bottom:42px;width:360px;background:#252526;border:1px solid #454545;border-radius:6px;
         box-shadow:0 8px 24px rgba(0,0,0,.5);padding:12px 14px;color:#cccccc;font-size:12.5px;line-height:1.5;}
  .toast .hd{display:flex;align-items:center;gap:8px;margin-bottom:5px;}
  .toast .live{width:9px;height:9px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);}
  .toast b{color:#fff;font-weight:600;}
  .toast .url{color:var(--link);font-family:"Cascadia Code",Consolas,monospace;}
  /* status bar */
  .statusbar{height:24px;background:var(--accent);display:flex;align-items:center;gap:14px;padding:0 12px;color:#fff;font-size:12px;flex:0 0 24px;}
  .statusbar .seg{display:flex;align-items:center;gap:5px;}
</style></head>
<body><div class="canvas"><div class="win">
  <div class="titlebar"><div class="traffic"><span style="background:#ff5f57"></span><span style="background:#febc2e"></span><span style="background:#28c840"></span></div>OzBridge — Visual Studio Code</div>
  <div class="body">
    <div class="activity">
      <div class="ico">≡</div>
      <div class="ico">⌕</div>
      <div class="ico active">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3"/></svg>
      </div>
      <div class="ico">⎇</div>
      <div class="ico">▸</div>
    </div>
    <div class="sidebar">
      <div class="sb-title">OZBRIDGE: RUNS &amp; RESOURCES</div>
      <div class="row cat"><span class="tw">▸</span><span class="ci">▣</span>Active Runs<span class="badge">2</span></div>
      <div class="row cat"><span class="tw">▸</span><span class="ci">⟳</span>History</div>
      <div class="row cat"><span class="tw">▸</span><span class="ci">◷</span>Schedules</div>
      <div class="row cat"><span class="tw">▸</span><span class="ci">▤</span>Environments</div>
      <div class="row cat"><span class="tw">▾</span><span class="ci" style="color:#75beff;">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 2v6M15 2v6M7 8h10v3a5 5 0 0 1-10 0V8zM12 16v6"/></svg>
      </span>MCP Servers</div>
      <div class="row child muted">● github</div>
      <div class="row child muted">● filesystem</div>
      <div class="row child muted">● postgres-readonly</div>
      <div class="row child muted">● brave-search</div>
      <div class="row cat"><span class="tw">▸</span><span class="ci">⚿</span>Secrets</div>
    </div>
    <div class="editor">
      <div class="tabs"><div class="tab"><span class="dot"></span>extension.ts</div></div>
      <div class="edcontent">
        <div><span class="c">// OzBridge exposes Oz over MCP to any client</span></div>
        <div><span class="k">const</span> <span class="p">server</span> = <span class="k">new</span> McpServer(tools, info, {</div>
        <div>&nbsp;&nbsp;bindAddress: <span class="s">'127.0.0.1'</span>, port: <span class="s">3847</span>,</div>
        <div>});</div>
        <div><span class="k">await</span> server.start(); <span class="c">// → /sse</span></div>
      </div>
    </div>
  </div>
  <div class="scrim"></div>
  <div class="qp">
    <div class="qp-title">OzBridge · Register MCP client</div>
    <div class="qp-input"><span class="ph">Choose the client whose config file should be updated</span></div>
    <div class="qp-list">
      <div class="qp-item sel"><span class="ci">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M9 2v6M15 2v6M7 8h10v3a5 5 0 0 1-10 0V8zM12 16v6"/></svg>
      </span><span class="name">Claude Code (CLI)</span><span class="path">~/.claude.json</span><span class="ok">✓</span></div>
      <div class="qp-item"><span class="ci">▣</span><span class="name">Cursor</span><span class="path">~/.cursor/mcp.json</span></div>
      <div class="qp-item"><span class="ci">▤</span><span class="name">Codex (CLI)</span><span class="path">~/.codex/config.toml</span></div>
    </div>
  </div>
  <div class="toast">
    <div class="hd"><span class="live"></span><b>OzBridge MCP server</b></div>
    <div>Listening on <span class="url">http://127.0.0.1:3847/sse</span></div>
    <div class="muted" style="margin-top:3px">4 tools exposed · Claude Code, Cursor &amp; Codex can drive Oz</div>
  </div>
  <div class="statusbar">
    <div class="seg">☁ OzBridge: 2 active</div>
    <div class="seg">⚡ MCP :3847</div>
  </div>
</div></div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 740 }, deviceScaleFactor: 2 });
await page.setContent(HTML, { waitUntil: 'load' });
await page.waitForTimeout(150);
await page.screenshot({ path: OUT, type: 'png' });
await browser.close();
process.stdout.write(`[render-mcp-promo] wrote ${OUT}\n`);
