// Digest contract (plan morning-digest). The reader itself is `readNight` in `./read.js`,
// typed `ReadNight` below. "Last" always means last in file order.

export type JobStatus = 'ok' | 'retry' | 'fail';

// One valid line of runs/<night>.jsonl.
export type RunLine = {
  at: string;
  job: string;
  status: JobStatus;
  owner: string | null;
  error?: string;
};

// One row per job.
export type DigestRow = {
  job: string;
  /** Owner of the job's last line; null renders as `—`. */
  owner: string | null;
  /** Number of lines for this job. */
  runs: number;
  /** Lines with status 'retry'. */
  retries: number;
  /** Status of the job's last line. */
  lastStatus: JobStatus;
  /** Error of the last line that had one; null if none did. */
  lastError: string | null;
  /** `at` of the first and last line, exactly as in the log (offset kept, never UTC). */
  firstAt: string;
  lastAt: string;
};

export type Night = {
  night: string;
  /** Sorted by job, plain string compare (`a.job < b.job`). */
  rows: DigestRow[];
  /** Non-empty lines that aren't JSON or lack the RunLine fields/types. Blank lines are ignored. */
  badLines: number;
  /** Valid lines per status. */
  counts: { ok: number; retry: number; fail: number };
};

// `:night` comes from the URL and becomes a file path: reject anything that fails this.
export const NIGHT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isNight(s: string): boolean {
  return NIGHT_PATTERN.test(s);
}

// null when `night` fails NIGHT_PATTERN or <runsDir>/<night>.jsonl doesn't exist.
// An empty file gives { rows: [], badLines: 0, counts all 0 }. Bad lines are counted, never thrown.
export type ReadNight = (runsDir: string, night: string) => Night | null;
