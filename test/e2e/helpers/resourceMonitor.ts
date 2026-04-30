import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export interface ResourceSample {
  /** ISO timestamp del campione */
  ts: string;
  /** secondi trascorsi dall'inizio del monitor */
  elapsedSec: number;
  /** numero di processi figli osservati (incluso il root) */
  processCount: number;
  /** RSS totale in MB */
  rssMb: number;
  /** % CPU totale (somma figli, può superare 100% su multi-core) */
  cpuPct: number;
  /** load average 1m della macchina (NaN su Windows) */
  loadAvg1m: number;
  /** memoria libera/totale macchina in MB */
  hostFreeMb: number;
  hostTotalMb: number;
  /** label opzionale per segnare lo step in corso */
  label?: string;
}

export interface ResourceMonitorOptions {
  rootPid: number;
  intervalMs?: number;
  outputFile: string;
}

/**
 * Campiona periodicamente CPU/RAM dell'albero di processi che ha
 * radice in `rootPid` e scrive un JSON-lines su disco. Funziona su
 * Windows (`wmic`) e Unix (`ps`). Implementazione volutamente senza
 * dipendenze native per evitare build step in CI.
 */
export class ResourceMonitor {
  private timer: NodeJS.Timeout | undefined;
  private samples: ResourceSample[] = [];
  private currentLabel: string | undefined;
  private startedAt = 0;

  constructor(private readonly opts: ResourceMonitorOptions) {}

  start(): void {
    this.startedAt = Date.now();
    const interval = this.opts.intervalMs ?? 1500;
    const loop = async () => {
      try {
        const sample = await this.sample();
        this.samples.push(sample);
      } catch (err) {
        // Best-effort: il monitor non deve mai far fallire un test.
        // eslint-disable-next-line no-console
        console.warn('[resource-monitor] sample failed:', (err as Error).message);
      }
    };
    this.timer = setInterval(loop, interval);
    // Primo campione immediato.
    void loop();
  }

  setLabel(label: string | undefined): void {
    this.currentLabel = label;
  }

  async stop(): Promise<ResourceSample[]> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await fs.mkdir(path.dirname(this.opts.outputFile), { recursive: true });
    const lines = this.samples.map((s) => JSON.stringify(s)).join('\n');
    await fs.writeFile(this.opts.outputFile, lines + '\n', 'utf8');
    return this.samples;
  }

  /** Statistiche aggregate utili per assertion/reportistica. */
  summary(): { peakRssMb: number; peakCpuPct: number; avgRssMb: number; avgCpuPct: number; samples: number } {
    if (this.samples.length === 0) {
      return { peakRssMb: 0, peakCpuPct: 0, avgRssMb: 0, avgCpuPct: 0, samples: 0 };
    }
    const peakRssMb = Math.max(...this.samples.map((s) => s.rssMb));
    const peakCpuPct = Math.max(...this.samples.map((s) => s.cpuPct));
    const avgRssMb = this.samples.reduce((a, s) => a + s.rssMb, 0) / this.samples.length;
    const avgCpuPct = this.samples.reduce((a, s) => a + s.cpuPct, 0) / this.samples.length;
    return { peakRssMb, peakCpuPct, avgRssMb, avgCpuPct, samples: this.samples.length };
  }

  private async sample(): Promise<ResourceSample> {
    const { processCount, rssMb, cpuPct } = await collectProcessTreeStats(this.opts.rootPid);
    const hostFreeMb = os.freemem() / 1024 / 1024;
    const hostTotalMb = os.totalmem() / 1024 / 1024;
    const loadAvg1m = os.loadavg()[0] ?? Number.NaN;
    return {
      ts: new Date().toISOString(),
      elapsedSec: (Date.now() - this.startedAt) / 1000,
      processCount,
      rssMb: round2(rssMb),
      cpuPct: round2(cpuPct),
      loadAvg1m: round2(loadAvg1m),
      hostFreeMb: round2(hostFreeMb),
      hostTotalMb: round2(hostTotalMb),
      label: this.currentLabel,
    };
  }
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Math.round(n * 100) / 100;
}

/** Raccoglie RSS+CPU% dell'albero di processi cross-platform. */
async function collectProcessTreeStats(rootPid: number): Promise<{ processCount: number; rssMb: number; cpuPct: number }> {
  if (process.platform === 'win32') {
    return collectWindows(rootPid);
  }
  return collectUnix(rootPid);
}

async function collectWindows(rootPid: number): Promise<{ processCount: number; rssMb: number; cpuPct: number }> {
  // `Get-Process` è ~10x più veloce di `Get-CimInstance Win32_Process`,
  // ma non espone PPID. Per la mappa parent->child usiamo CIM una volta
  // ogni 10 s e cachiamo: la topologia dei figli di Electron è stabile.
  const ppidMap = await getPpidMapCached();
  const ps = `Get-Process | Select-Object Id,WorkingSet64,@{n='Cpu100ns';e={[int64]$_.TotalProcessorTime.Ticks}} | ConvertTo-Csv -NoTypeInformation`;
  const csv = await runText('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
  const rows = parseCsv(csv);
  type Row = { pid: number; ppid: number; rss: number; cpu100ns: number };
  const all: Row[] = rows.map((r) => {
    const pid = Number(r.Id);
    return {
      pid,
      ppid: ppidMap.get(pid) ?? 0,
      rss: Number(r.WorkingSet64) || 0,
      cpu100ns: Number(r.Cpu100ns) || 0,
    };
  });
  const tree = collectDescendants(rootPid, all);
  const rssMb = tree.reduce((a, r) => a + r.rss, 0) / 1024 / 1024;
  const cpuPct = computeCpuPctWindows(tree);
  return { processCount: tree.length, rssMb, cpuPct };
}

let ppidCache: { map: Map<number, number>; ts: number } | undefined;
const PPID_CACHE_TTL_MS = 10_000;
async function getPpidMapCached(): Promise<Map<number, number>> {
  const now = Date.now();
  if (ppidCache && now - ppidCache.ts < PPID_CACHE_TTL_MS) return ppidCache.map;
  const ps = `Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Csv -NoTypeInformation`;
  const csv = await runText('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]).catch(() => '');
  const map = new Map<number, number>();
  for (const r of parseCsv(csv)) {
    const pid = Number(r.ProcessId);
    const ppid = Number(r.ParentProcessId);
    if (Number.isFinite(pid)) map.set(pid, Number.isFinite(ppid) ? ppid : 0);
  }
  ppidCache = { map, ts: now };
  return map;
}

const lastWindowsSnapshot = new Map<number, { cpu100ns: number; ts: number }>();
function computeCpuPctWindows(tree: Array<{ pid: number; cpu100ns: number }>): number {
  const now = Date.now();
  let totalPct = 0;
  for (const r of tree) {
    const prev = lastWindowsSnapshot.get(r.pid);
    lastWindowsSnapshot.set(r.pid, { cpu100ns: r.cpu100ns, ts: now });
    if (!prev) continue;
    const dtMs = now - prev.ts;
    if (dtMs <= 0) continue;
    // 100ns ticks -> ms : /10000
    const cpuMs = (r.cpu100ns - prev.cpu100ns) / 10000;
    if (cpuMs <= 0) continue;
    totalPct += (cpuMs / dtMs) * 100;
  }
  return totalPct;
}

async function collectUnix(rootPid: number): Promise<{ processCount: number; rssMb: number; cpuPct: number }> {
  // ps -axo pid=,ppid=,rss=,%cpu= (rss in KB)
  const out = await runText('ps', ['-axo', 'pid=,ppid=,rss=,%cpu=']);
  type Row = { pid: number; ppid: number; rss: number; cpu: number };
  const all: Row[] = out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [pid, ppid, rss, cpu] = l.split(/\s+/);
      return { pid: Number(pid), ppid: Number(ppid), rss: Number(rss), cpu: Number(cpu) };
    });
  const tree = collectDescendants(rootPid, all);
  const rssMb = tree.reduce((a, r) => a + r.rss, 0) / 1024;
  const cpuPct = tree.reduce((a, r) => a + r.cpu, 0);
  return { processCount: tree.length, rssMb, cpuPct };
}

function collectDescendants<T extends { pid: number; ppid: number }>(rootPid: number, all: T[]): T[] {
  const byParent = new Map<number, T[]>();
  for (const r of all) {
    if (!byParent.has(r.ppid)) byParent.set(r.ppid, []);
    byParent.get(r.ppid)!.push(r);
  }
  const result: T[] = [];
  const root = all.find((r) => r.pid === rootPid);
  if (root) result.push(root);
  const queue = [rootPid];
  const seen = new Set<number>([rootPid]);
  while (queue.length) {
    const p = queue.shift()!;
    const kids = byParent.get(p) ?? [];
    for (const k of kids) {
      if (seen.has(k.pid)) continue;
      seen.add(k.pid);
      result.push(k);
      queue.push(k.pid);
    }
  }
  return result;
}

function runText(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (b) => (out += b.toString()));
    child.stderr.on('data', (b) => (err += b.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} exited with ${code}: ${err.trim()}`));
    });
  });
}

function parseCsv(csv: string): Array<Record<string, string>> {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h.replace(/"/g, '')] = (cells[i] ?? '').replace(/"/g, '')));
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') {
      inQ = !inQ;
      cur += ch;
    } else if (ch === ',' && !inQ) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}
