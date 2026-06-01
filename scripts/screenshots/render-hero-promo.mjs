#!/usr/bin/env node
// ---------------------------------------------------------------------------
// render-hero-promo.mjs — headless render of the MCP-forward hero banner
// ---------------------------------------------------------------------------
//
// The previous media/screenshot.png hero was a capture of the "Get Started"
// walkthrough, whose copy led with "run your first Oz agent from Copilot Chat"
// — the pre-repositioning message. After leading the listing with MCP, the
// hero must carry the new headline. This renders a brand-consistent hero
// banner (galleryBanner color #0E1116) headlessly via Chromium.
//
// Usage: node scripts/screenshots/render-hero-promo.mjs

import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', '..', 'media', 'screenshot.png');

const HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
  :root{ --bg:#0E1116; --fg:#e8ecf1; --muted:#8b97a7; --accent:#3794ff; --accent2:#4daafc;
         --green:#3fd07f; --card:#161b22; --border:#222a35; --mono:"Cascadia Code",Consolas,monospace; }
  *{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,"Segoe UI",system-ui,sans-serif;}
  html,body{background:var(--bg);}
  .hero{width:1280px;height:640px;background:
        radial-gradient(900px 520px at 84% 30%, rgba(55,148,255,.16), transparent 60%),
        radial-gradient(700px 480px at 12% 88%, rgba(63,208,127,.08), transparent 55%),
        var(--bg);
        position:relative;overflow:hidden;display:flex;align-items:center;}
  .grid{position:absolute;inset:0;background-image:
        linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),
        linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);
        background-size:40px 40px;mask-image:radial-gradient(900px 600px at 70% 40%,#000,transparent 80%);}
  /* left column */
  .left{width:580px;padding:0 0 0 76px;position:relative;z-index:2;}
  .brand{display:flex;align-items:center;gap:12px;margin-bottom:26px;}
  .logo{width:38px;height:38px;border-radius:9px;background:linear-gradient(135deg,#3794ff,#1f6feb);
        display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(55,148,255,.4);}
  .brand .name{font-size:20px;font-weight:700;letter-spacing:.02em;color:#fff;}
  .brand .badge{margin-left:6px;font-size:11px;color:var(--accent2);border:1px solid #243a55;
        background:rgba(55,148,255,.10);border-radius:20px;padding:3px 10px;font-family:var(--mono);}
  h1{font-size:50px;line-height:1.06;font-weight:800;color:var(--fg);letter-spacing:-.02em;margin-bottom:18px;}
  h1 .hl{background:linear-gradient(90deg,#5aa9ff,#9ad0ff);-webkit-background-clip:text;background-clip:text;color:transparent;}
  .sub{font-size:18px;line-height:1.5;color:var(--muted);margin-bottom:30px;max-width:520px;}
  .chips{display:flex;gap:10px;flex-wrap:wrap;}
  .chip{font-size:13px;color:#cdd6e0;background:var(--card);border:1px solid var(--border);
        border-radius:8px;padding:7px 12px;font-family:var(--mono);display:flex;align-items:center;gap:7px;}
  .chip .dot{width:7px;height:7px;border-radius:50%;background:var(--green);}
  .chip .dot.b{background:var(--accent);}
  /* right diagram: hub (Oz) → MCP clients */
  .right{position:absolute;right:64px;top:0;bottom:0;width:560px;z-index:2;}
  .right > svg{position:absolute;inset:0;width:100%;height:100%;}
  .node{position:absolute;background:var(--card);border:1px solid var(--border);border-radius:12px;
        padding:12px 16px;display:flex;align-items:center;gap:10px;color:var(--fg);font-size:15px;font-weight:600;
        box-shadow:0 10px 30px rgba(0,0,0,.35);}
  .node .ic{width:22px;height:22px;display:flex;align-items:center;justify-content:center;}
  .node .sub{font-size:11px;color:var(--muted);font-weight:400;font-family:var(--mono);margin-top:1px;}
  .hub2{background:linear-gradient(135deg,#13233b,#0f1b2e) !important;border:1px solid #2b466b !important;}
  .pill{position:absolute;font-family:var(--mono);font-size:11px;color:var(--accent2);background:rgba(55,148,255,.10);
        border:1px solid #243a55;border-radius:20px;padding:2px 9px;}
</style></head>
<body>
<div class="hero">
  <div class="grid"></div>
  <div class="left">
    <div class="brand">
      <div class="logo">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M9 2v6M15 2v6M7 8h10v3a5 5 0 0 1-10 0V8zM12 16v6"/></svg>
      </div>
      <span class="name">OzBridge</span>
      <span class="badge">MCP · @oz · VS Code</span>
    </div>
    <h1>Bring <span class="hl">Warp Oz</span><br/>to any IDE or agent<br/>— via MCP</h1>
    <div class="sub">Expose the Warp Oz toolset over the Model Context Protocol so Claude Code, Cursor and Codex drive Oz — and run it natively as <b style="color:#cdd6e0">@oz</b> in VS Code Copilot Chat.</div>
    <div class="chips">
      <div class="chip"><span class="dot b"></span>Embedded MCP server</div>
      <div class="chip"><span class="dot b"></span>Standalone npx server</div>
      <div class="chip"><span class="dot"></span>@oz Chat Participant</div>
    </div>
  </div>
  <div class="right">
    <svg viewBox="0 0 560 640" fill="none">
      <defs>
        <linearGradient id="ln" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#3794ff" stop-opacity="0.9"/>
          <stop offset="1" stop-color="#3794ff" stop-opacity="0.25"/>
        </linearGradient>
      </defs>
      <path d="M250 318 C 360 318, 360 150, 470 150" stroke="url(#ln)" stroke-width="2"/>
      <path d="M250 322 C 360 322, 360 252, 470 252" stroke="url(#ln)" stroke-width="2"/>
      <path d="M250 326 C 360 326, 360 388, 470 388" stroke="url(#ln)" stroke-width="2"/>
      <path d="M250 330 C 360 330, 360 500, 470 500" stroke="url(#ln)" stroke-width="2"/>
      <circle cx="470" cy="150" r="3.5" fill="#3794ff"/>
      <circle cx="470" cy="252" r="3.5" fill="#3794ff"/>
      <circle cx="470" cy="388" r="3.5" fill="#3794ff"/>
      <circle cx="470" cy="500" r="3.5" fill="#3fd07f"/>
    </svg>
    <div class="node hub2" style="left:120px;top:286px;padding:16px 20px;">
      <div class="ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#5aa9ff" stroke-width="2"><path d="M9 2v6M15 2v6M7 8h10v3a5 5 0 0 1-10 0V8zM12 16v6"/></svg></div>
      <div>Warp Oz<div class="sub">oz agent · cloud · drive</div></div>
    </div>
    <div class="node" style="left:392px;top:128px;">Claude Code<div class="sub" style="position:static">~/.claude.json</div></div>
    <div class="node" style="left:392px;top:230px;">Cursor<div class="sub" style="position:static">~/.cursor/mcp.json</div></div>
    <div class="node" style="left:392px;top:366px;">Codex<div class="sub" style="position:static">~/.codex/config.toml</div></div>
    <div class="node" style="left:392px;top:478px;"><span style="color:#3fd07f">●</span>&nbsp;:3847/sse<div class="sub" style="position:static">HTTP + SSE</div></div>
  </div>
</div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 2 });
await page.setContent(HTML, { waitUntil: 'load' });
await page.waitForTimeout(150);
await page.screenshot({ path: OUT, type: 'png' });
await browser.close();
process.stdout.write(`[render-hero-promo] wrote ${OUT}\n`);
