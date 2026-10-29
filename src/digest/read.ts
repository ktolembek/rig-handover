import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isNight, type DigestRow, type JobStatus, type ReadNight, type RunLine } from './types.js';

const STATUSES: readonly string[] = ['ok', 'retry', 'fail'];

function isStatus(v: unknown): v is JobStatus {
  return typeof v === 'string' && STATUSES.includes(v);
}

function parseLine(line: string): RunLine | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.at !== 'string') return null;
  if (typeof o.job !== 'string' || o.job === '') return null;
  if (!isStatus(o.status)) return null;
  if (!('owner' in o) || (o.owner !== null && typeof o.owner !== 'string')) return null;
  if (o.error !== undefined && typeof o.error !== 'string') return null;
  const run: RunLine = { at: o.at, job: o.job, status: o.status, owner: o.owner };
  if (o.error !== undefined) run.error = o.error;
  return run;
}

function readFileOrNull(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!isNight(night)) return null;
  const text = readFileOrNull(join(runsDir, `${night}.jsonl`));
  if (text === null) return null;

  const rows = new Map<string, DigestRow>();
  const counts = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const run = parseLine(line);
    if (!run) {
      badLines++;
      continue;
    }
    counts[run.status]++;
    const row = rows.get(run.job);
    if (!row) {
      rows.set(run.job, {
        job: run.job,
        owner: run.owner,
        runs: 1,
        retries: run.status === 'retry' ? 1 : 0,
        lastStatus: run.status,
        lastError: run.error ?? null,
        firstAt: run.at,
        lastAt: run.at,
      });
      continue;
    }
    row.owner = run.owner;
    row.runs++;
    if (run.status === 'retry') row.retries++;
    row.lastStatus = run.status;
    if (run.error !== undefined) row.lastError = run.error;
    row.lastAt = run.at;
  }

  const sorted = [...rows.values()].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
  return { night, rows: sorted, badLines, counts };
};
