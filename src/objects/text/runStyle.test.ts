import { describe, expect, it } from 'vitest';
import type { TextRun } from './indentation/types';
import { applyRunStyle, joinRuns, representativeRunStyle, splitRunsAtOffset } from './runStyle';

function text(runs: TextRun[]): string {
  return runs.map((r) => r.text).join('');
}

describe('applyRunStyle', () => {
  it('applies a patch across a single plain run, splitting it in three', () => {
    const runs: TextRun[] = [{ text: 'hello world' }];
    const next = applyRunStyle(runs, 2, 5, { color: '#ff0000' });
    expect(text(next)).toBe('hello world');
    expect(next).toEqual([
      { text: 'he' },
      { text: 'llo', color: '#ff0000' },
      { text: ' world' },
    ]);
  });

  it('applies to the whole line when start=0 and end=length', () => {
    const runs: TextRun[] = [{ text: 'abc' }];
    const next = applyRunStyle(runs, 0, 3, { bold: true });
    expect(next).toEqual([{ text: 'abc', bold: true }]);
  });

  it('merges into an existing styled run spanning multiple runs, preserving untouched styles', () => {
    const runs: TextRun[] = [
      { text: 'red', color: '#ff0000' },
      { text: 'plain' },
      { text: 'blue', color: '#0000ff' },
    ];
    // select "d" (end of "red") through "pl" (start of "plain")
    const next = applyRunStyle(runs, 2, 5, { fontSize: 20 });
    expect(text(next)).toBe(text(runs));
    expect(next).toEqual([
      { text: 're', color: '#ff0000' },
      { text: 'd', color: '#ff0000', fontSize: 20 },
      { text: 'pl', fontSize: 20 },
      { text: 'ain' },
      { text: 'blue', color: '#0000ff' },
    ]);
  });

  it('is a no-op when end <= start', () => {
    const runs: TextRun[] = [{ text: 'abc' }];
    expect(applyRunStyle(runs, 3, 1, { bold: true })).toBe(runs);
  });

  it('merges adjacent runs that end up with identical style', () => {
    const runs: TextRun[] = [{ text: 'ab', bold: true }, { text: 'cd' }];
    // styling "cd" bold too should merge with the preceding bold "ab"
    const next = applyRunStyle(runs, 2, 4, { bold: true });
    expect(next).toEqual([{ text: 'abcd', bold: true }]);
  });
});

describe('splitRunsAtOffset', () => {
  it('splits a run in the middle, both halves keeping the original style', () => {
    const runs: TextRun[] = [{ text: 'hello', color: '#111' }, { text: 'world' }];
    const { before, after } = splitRunsAtOffset(runs, 3);
    expect(before).toEqual([{ text: 'hel', color: '#111' }]);
    expect(after).toEqual([{ text: 'lo', color: '#111' }, { text: 'world' }]);
  });

  it('splits exactly on a run boundary without creating empty runs', () => {
    const runs: TextRun[] = [{ text: 'ab', color: '#111' }, { text: 'cd' }];
    const { before, after } = splitRunsAtOffset(runs, 2);
    expect(before).toEqual([{ text: 'ab', color: '#111' }]);
    expect(after).toEqual([{ text: 'cd' }]);
  });

  it('k=0 puts everything after', () => {
    const runs: TextRun[] = [{ text: 'abc' }];
    const { before, after } = splitRunsAtOffset(runs, 0);
    expect(before).toEqual([]);
    expect(after).toEqual(runs);
  });

  it('k=full length puts everything before', () => {
    const runs: TextRun[] = [{ text: 'abc' }];
    const { before, after } = splitRunsAtOffset(runs, 3);
    expect(before).toEqual(runs);
    expect(after).toEqual([]);
  });
});

describe('joinRuns', () => {
  it('merges a matching boundary pair into one run', () => {
    const a: TextRun[] = [{ text: 'foo', bold: true }];
    const b: TextRun[] = [{ text: 'bar', bold: true }];
    expect(joinRuns(a, b)).toEqual([{ text: 'foobar', bold: true }]);
  });

  it('keeps differently-styled boundary runs separate', () => {
    const a: TextRun[] = [{ text: 'foo', bold: true }];
    const b: TextRun[] = [{ text: 'bar' }];
    expect(joinRuns(a, b)).toEqual([{ text: 'foo', bold: true }, { text: 'bar' }]);
  });

  it('round-trips with splitRunsAtOffset (split then join reproduces the original)', () => {
    const runs: TextRun[] = [{ text: 'abc', color: '#f00' }, { text: 'def' }];
    const { before, after } = splitRunsAtOffset(runs, 4);
    expect(joinRuns(before, after)).toEqual(runs);
  });
});

describe('representativeRunStyle', () => {
  it('returns the style of the first run overlapping the range', () => {
    const runs: TextRun[] = [{ text: 'ab' }, { text: 'cd', color: '#0f0' }];
    expect(representativeRunStyle(runs, 2, 4)).toEqual({ color: '#0f0', fontSize: undefined, fontFamily: undefined, bold: undefined });
  });

  it('returns {} for an empty/invalid range', () => {
    const runs: TextRun[] = [{ text: 'ab', color: '#0f0' }];
    expect(representativeRunStyle(runs, 1, 1)).toEqual({});
  });
});
