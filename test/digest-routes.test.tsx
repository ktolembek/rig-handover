import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Night } from '../src/digest/types.js';

// Fixture nights live in a temp runs dir; `runs/` is read-only.
const FULL = '2026-01-10';
const EMPTY = '2026-01-11';
const BAD = '2026-01-12';
const MISSING = '2001-01-01';
const TRAVERSAL = '..%2F..%2Fetc';

// File order is deliberately not sorted by job: the page and the JSON must sort.
const fullLines = [
  '{"at":"2026-01-10T23:10:00+01:00","job":"c/broken","status":"fail","owner":"lane-07","error":"quota exceeded"}',
  '{"at":"2026-01-10T23:00:00+01:00","job":"a/steady","status":"ok","owner":null}',
  '{"at":"2026-01-11T01:00:00+01:00","job":"b/flaky","status":"retry","owner":"rook","error":"upstream 503"}',
  '{"at":"2026-01-11T01:01:00+01:00","job":"b/flaky","status":"retry","owner":"rook","error":"upstream 503"}',
  '{"at":"2026-01-11T01:03:00+01:00","job":"b/flaky","status":"retry","owner":"rook","error":"upstream 503"}',
  '{"at":"2026-01-11T01:07:00+01:00","job":"b/flaky","status":"ok","owner":"rook"}',
];

const badLines = [
  '{"at":"2026-01-12T02:00:00+01:00","job":"a/steady","status":"ok","owner":"rook"}',
  'this is not json',
  '{"at":"2026-01-12T03:00:00+01:00","job":"b/other","status":"ok","owner":"rook"}',
];

let tmpDir = '';

function app() {
  return createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir: tmpDir,
  });
}

// Every `<tr ...>...</tr>` that has data cells, in page order (the header row has <th> only).
function dataRows(html: string): string[] {
  return html
    .split('<tr')
    .slice(1)
    .filter((chunk) => chunk.includes('<td'));
}

function cells(row: string): string[] {
  return [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1] ?? '');
}

function rowFor(html: string, job: string): string {
  const row = dataRows(html).find((r) => cells(r)[0] === job);
  if (row === undefined) throw new Error(`no table row for ${job}`);
  return row;
}

function pageJobs(html: string): string[] {
  return dataRows(html).map((r) => cells(r)[0] ?? '');
}

function isWarn(row: string): boolean {
  // `row` starts right after `<tr`, so the opening tag's attributes come first.
  const attrs = row.slice(0, row.indexOf('>'));
  return /class="[^"]*\bwarn\b/.test(attrs);
}

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rig-routes-'));
  writeFileSync(join(tmpDir, `${FULL}.jsonl`), fullLines.join('\n') + '\n');
  writeFileSync(join(tmpDir, `${EMPTY}.jsonl`), '');
  writeFileSync(join(tmpDir, `${BAD}.jsonl`), badLines.join('\n') + '\n');
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /digest/:night', () => {
  it('renders 200 with the heading and one table for a night with a file', async () => {
    const res = await app().request(`/digest/${FULL}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain(`<h1>digest ${FULL}</h1>`);
    expect(html.match(/<table/g)).toHaveLength(1);
    for (const col of ['job', 'owner', 'runs', 'retries', 'last status', 'last error', 'first', 'last']) {
      expect(html).toContain(`>${col}</th>`);
    }
    expect(html).not.toContain('nothing ran');
    expect(html).not.toContain('line(s) didn');
  });

  it('renders one row per job, sorted by job, with times as in the log', async () => {
    const html = await (await app().request(`/digest/${FULL}`)).text();
    expect(pageJobs(html)).toEqual(['a/steady', 'b/flaky', 'c/broken']);
    expect(cells(rowFor(html, 'b/flaky'))).toEqual([
      'b/flaky',
      'rook',
      '4',
      '3',
      'ok',
      'upstream 503',
      '2026-01-11T01:00:00+01:00',
      '2026-01-11T01:07:00+01:00',
    ]);
    expect(cells(rowFor(html, 'c/broken'))).toEqual([
      'c/broken',
      'lane-07',
      '1',
      '0',
      'fail',
      'quota exceeded',
      '2026-01-10T23:10:00+01:00',
      '2026-01-10T23:10:00+01:00',
    ]);
  });

  it('marks retries >= 3 and fail rows as warn, and no others', async () => {
    const html = await (await app().request(`/digest/${FULL}`)).text();
    expect(isWarn(rowFor(html, 'b/flaky'))).toBe(true); // 3 retries, last status ok
    expect(isWarn(rowFor(html, 'c/broken'))).toBe(true); // fail, no retries
    expect(isWarn(rowFor(html, 'a/steady'))).toBe(false);
  });

  it('renders a null owner and a null last error as —', async () => {
    const html = await (await app().request(`/digest/${FULL}`)).text();
    const row = cells(rowFor(html, 'a/steady'));
    expect(row[1]).toBe('—');
    expect(row[5]).toBe('—');
  });

  it('is 404 with "no run log for" for a night with no file', async () => {
    const res = await app().request(`/digest/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain(`no run log for ${MISSING}`);
  });

  it('is 404 for a night that is not a date', async () => {
    const res = await app().request('/digest/not-a-night');
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('no run log for not-a-night');
  });

  it('is 404 for a path-traversal night', async () => {
    const res = await app().request(`/digest/${TRAVERSAL}`);
    expect(res.status).toBe(404);
  });

  it('says "nothing ran", with no table, for an empty night', async () => {
    const res = await app().request(`/digest/${EMPTY}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain(`<h1>digest ${EMPTY}</h1>`);
    expect(html).toContain('nothing ran');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('line(s) didn');
  });

  it('renders the valid rows and the bad-line message for a night with a bad line', async () => {
    const res = await app().request(`/digest/${BAD}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(pageJobs(html)).toEqual(['a/steady', 'b/other']);
    // hono/jsx escapes `'` in text, so don't match the apostrophe.
    expect(html).toContain('1 line(s) didn');
    expect(html).not.toContain('nothing ran');
  });
});

describe('GET /api/digest/:night', () => {
  it('returns 200 with the whole night for a night with a file', async () => {
    const res = await app().request(`/api/digest/${FULL}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as Night;
    expect(body.night).toBe(FULL);
    expect(body.badLines).toBe(0);
    expect(body.counts).toEqual({ ok: 2, retry: 3, fail: 1 });
    expect(body.rows.map((r) => r.job)).toEqual(['a/steady', 'b/flaky', 'c/broken']);
    expect(body.rows).toEqual([
      {
        job: 'a/steady',
        owner: null,
        runs: 1,
        retries: 0,
        lastStatus: 'ok',
        lastError: null,
        firstAt: '2026-01-10T23:00:00+01:00',
        lastAt: '2026-01-10T23:00:00+01:00',
      },
      {
        job: 'b/flaky',
        owner: 'rook',
        runs: 4,
        retries: 3,
        lastStatus: 'ok',
        lastError: 'upstream 503',
        firstAt: '2026-01-11T01:00:00+01:00',
        lastAt: '2026-01-11T01:07:00+01:00',
      },
      {
        job: 'c/broken',
        owner: 'lane-07',
        runs: 1,
        retries: 0,
        lastStatus: 'fail',
        lastError: 'quota exceeded',
        firstAt: '2026-01-10T23:10:00+01:00',
        lastAt: '2026-01-10T23:10:00+01:00',
      },
    ]);
  });

  it('is 404 JSON { error, night } for a night with no file', async () => {
    const res = await app().request(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log', night: MISSING });
  });

  it('is 404 for a night that is not a date', async () => {
    const res = await app().request('/api/digest/not-a-night');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log', night: 'not-a-night' });
  });

  it('is 404 for a path-traversal night', async () => {
    const res = await app().request(`/api/digest/${TRAVERSAL}`);
    expect(res.status).toBe(404);
  });

  it('gives no rows and no bad lines for an empty night', async () => {
    const res = await app().request(`/api/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      night: EMPTY,
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('keeps the valid rows and counts the bad line', async () => {
    const res = await app().request(`/api/digest/${BAD}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Night;
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['a/steady', 'b/other']);
    expect(body.counts).toEqual({ ok: 2, retry: 0, fail: 0 });
  });
});

describe('page and JSON agree', () => {
  it.each([FULL, BAD, EMPTY])('lists the same jobs in the same order for %s', async (night) => {
    const page = await app().request(`/digest/${night}`);
    const json = await app().request(`/api/digest/${night}`);
    expect(page.status).toBe(200);
    expect(json.status).toBe(200);
    const body = (await json.json()) as Night;
    expect(pageJobs(await page.text())).toEqual(body.rows.map((r) => r.job));
  });

  it('agrees on the real night 2026-10-28 too', async () => {
    const real = createApp({
      adapter: 'shim',
      installed: '2026-10-29T14:06:00+01:00',
      beatEverySeconds: 60,
      runsDir: 'runs', // read only: the reader never writes
    });
    const html = await (await real.request('/digest/2026-10-28')).text();
    const body = (await (await real.request('/api/digest/2026-10-28')).json()) as Night;
    expect(body.rows).toHaveLength(5);
    expect(pageJobs(html)).toEqual(body.rows.map((r) => r.job));
  });
});
