import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Evaluator } from '../src/runners/evaluate.js';
import { SessionPool } from '../src/runners/pool.js';
import { HASKELL_LIB, hasBinary } from './helpers.js';

const ghci = process.env.GHCI_BIN ?? 'ghci';

describe.skipIf(!hasBinary(ghci))('Evaluator', () => {
  const pool = new SessionPool(4, 60_000);
  const evaluator = new Evaluator({ ghciBin: ghci, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wb-eval-')), libDir: HASKELL_LIB, pool });
  afterAll(() => pool.closeAll());
  const foldMaybe = 'foldMaybe :: r -> (a -> r) -> Maybe a -> r\nfoldMaybe n j v = case v of\n  Nothing -> n\n  Just x -> j x';
  const foldEither = 'foldEither :: (a -> r) -> (b -> r) -> Either a b -> r\nfoldEither l r v = case v of\n  Left x -> l x\n  Right y -> r y';

  it('computes results with the given definitions, and reports what does not type-check', async () => {
    const [four, text, wrong] = await evaluator.haskell(foldMaybe, ['foldMaybe 0 (\\x -> x + 1) (Just 3)', 'foldMaybe "-" show (Just 3 :: Maybe Int)', 'foldMaybe 0 id (Just True)']);
    expect(four).toEqual({ ok: true, value: '4' });
    expect(text).toEqual({ ok: true, value: '"3"' });
    expect(wrong?.ok).toBe(false);
  }, 60_000);

  it('keeps the definitions of widgets that ask at the same time apart', async () => {
    const [a, b] = await Promise.all([evaluator.haskell(foldMaybe, ['foldMaybe 1 id Nothing']), evaluator.haskell(foldEither, ['foldEither length negate (Left "abc")'])]);
    expect(a).toEqual([{ ok: true, value: '1' }]);
    expect(b).toEqual([{ ok: true, value: '3' }]);
  }, 60_000);
});
