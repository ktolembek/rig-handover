import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

function tempRuns(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

describe('readNight', () => {
  it('reads 2026-10-28: 5 jobs, 1 bad line', () => {
    const n = readNight('runs', '2026-10-28');
    expect(n).not.toBeNull();
    if (!n) return;
    expect(n.night).toBe('2026-10-28');
    expect(n.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(n.badLines).toBe(1);
    expect(n.counts).toEqual({ ok: 10, retry: 4, fail: 1 });

    const row = (job: string) => n.rows.find((r) => r.job === job);
    expect(row('fixtures/refresh')).toMatchObject({ runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503' });
    expect(row('lane/sync')).toEqual({
      job: 'lane/sync',
      owner: 'rook',
      runs: 8,
      retries: 1,
      lastStatus: 'ok',
      lastError: 'lock held',
      firstAt: '2026-10-28T23:00:06+01:00',
      lastAt: '2026-10-29T05:00:04+01:00',
    });
    expect(row('notes/backup')).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded', owner: 'lane-07' });
    expect(row('digest/render')).toMatchObject({ owner: null, runs: 1, lastError: null });
  });

  it('reads 2026-10-27 with no bad lines', () => {
    const n = readNight('runs', '2026-10-27');
    expect(n?.rows.map((r) => r.job)).toEqual(['fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs']);
    expect(n?.badLines).toBe(0);
    expect(n?.counts).toEqual({ ok: 7, retry: 0, fail: 0 });
  });

  it('is null for a night with no file', () => {
    expect(readNight('runs', '2001-01-01')).toBeNull();
  });

  it('is null for a bad night string', () => {
    expect(readNight('runs', '../etc')).toBeNull();
    expect(readNight('runs', '2026-10-28/../x')).toBeNull();
    expect(readNight('runs', '2026-10-28.jsonl')).toBeNull();
    expect(readNight('runs', '')).toBeNull();
  });

  it('gives an empty night for an empty file', () => {
    const dir = tempRuns({ '2026-01-01.jsonl': '', '2026-01-02.jsonl': '\n  \n\n' });
    const empty = { rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
    expect(readNight(dir, '2026-01-01')).toEqual({ night: '2026-01-01', ...empty });
    expect(readNight(dir, '2026-01-02')).toEqual({ night: '2026-01-02', ...empty });
  });

  it('counts wrong-typed lines as bad and keeps the valid ones', () => {
    const lines = [
      '{"at":"2026-01-03T01:00:00+01:00","job":"a","status":"retry","owner":"x","error":"e1"}',
      '{"at":"2026-01-03T02:00:00+01:00","job":1,"status":"ok","owner":"x"}',
      '{"at":"2026-01-03T02:00:00+01:00","job":"","status":"ok","owner":"x"}',
      '{"at":"2026-01-03T02:00:00+01:00","job":"a","status":"done","owner":"x"}',
      '{"at":"2026-01-03T02:00:00+01:00","job":"a","status":"ok"}',
      '{"at":"2026-01-03T02:00:00+01:00","job":"a","status":"ok","owner":7}',
      '{"at":"2026-01-03T02:00:00+01:00","job":"a","status":"ok","owner":"x","error":503}',
      '{"at":12,"job":"a","status":"ok","owner":"x"}',
      '["a"]',
      'null',
      '"text"',
      'not json',
      '   ',
      '{"at":"2026-01-03T03:00:00+01:00","job":"a","status":"ok","owner":null}',
    ];
    const dir = tempRuns({ '2026-01-03.jsonl': lines.join('\n') + '\n' });
    expect(readNight(dir, '2026-01-03')).toEqual({
      night: '2026-01-03',
      rows: [
        {
          job: 'a',
          owner: null,
          runs: 2,
          retries: 1,
          lastStatus: 'ok',
          lastError: 'e1',
          firstAt: '2026-01-03T01:00:00+01:00',
          lastAt: '2026-01-03T03:00:00+01:00',
        },
      ],
      badLines: 11,
      counts: { ok: 1, retry: 1, fail: 0 },
    });
  });
});
