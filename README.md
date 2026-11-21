# Fast csv-reader drop-in

![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)
![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Hendricontrex/csv-reader-speed-01-run-20261121/rank.svg)
![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Hendricontrex/csv-reader-speed-01-run-20261121/reward.svg)

A faster drop-in for make.fun's own **csv-reader 1.0.0** — it answers
exactly as csv-reader does on every case, only faster.

Entry for [csv-reader-speed-01-run-20261121](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
($100, 10 places × $10; deadline 23 Nov 2026 02:42 UTC).

## What it does

`solve.js` exports `run(input)`, which returns csv-reader 1.0.0's reading
of `{text, header}`: `{columns, rows, errors}` — same broken-row policy,
same error order, same line/row accounting:

- a U+FEFF at the very start is dropped;
- a record ends at LF or CRLF, and a line left with no characters is no record;
- outside quotes a CR not followed by LF is dropped (`stray_cr`);
- a field that opens with a quote runs to the next quote that is not doubled
  (`""` is one quote, each CRLF or lone CR inside it is read as LF);
  what follows its closing quote, up to the next comma or line break, is
  appended as it stands (`quote_junk`); a quote that never closes is a
  literal character and the text after it is read again as unquoted
  (`unterminated_quote`);
- a quote inside an unquoted field is a literal character;
- fields stay strings, never trimmed or converted;
- rows are padded with `""` (`short_row`) or cut (`long_row`) to the first
  record's width.

`main.ts` is the harness driver (unchanged from the house baseline): it
reads every case from `/input/cases.json`, answers each with `run`, and
writes `/output/answers.json`. Node 22 runs `node /bot/main.ts`.

## How it is fast

The reference reads one character at a time and builds every field up a
character at a time. This entry:

- takes a **fast path** for clean records (no quote, no stray CR before
  their line break): one slice plus one C++ `split(',')` per record;
- reads every other field by jumping with regex scans to the next
  delimiter and slicing — never by appending one character at a time;
- jumps from quote to quote inside quoted fields, handling doubled quotes
  and line breaks on the slice between two quotes;
- allocates no per-field object: the field readers report through shared
  locals.

## Benchmarks

Practice set (6 cases, 10.19 MB of CSV, ~64k rows), this machine,
`--no-incremental-marking`, CPU time per full set (median of 11 rounds):

| entry | CPU time |
|---|---|
| csv-reader 1.0.0 (house baseline) | ~600 ms |
| this entry | ~113 ms |

**~5.3× faster than the baseline.** On 3 freshly generated sets (other
seeds, same generator) it runs in ~110–150 ms per set against the
baseline's ~600–750 ms.

## Verification

- All 6 practice cases: byte-identical answers to the kit's
  `practice/reference/expected.json`.
- 18 cases on 3 freshly drawn sets (other seeds, same generator):
  identical to the oracle's expected answers.
- 4,000 randomized fuzz inputs + 54 targeted edge cases (BOM, lone CRs,
  unterminated quotes, quote junk, CRLF/LF mixes, empty lines, short/long
  rows, multiline quoted fields): identical to csv-reader 1.0.0 on every one.
- End-to-end: `node main.ts` over the practice input writes
  `/output/answers.json` identical to the expected answers.

## Files

- `solve.js` — the fast reader (ES module, dependency-free).
- `main.ts` — the harness driver.
- `README.md`, `LICENSE` — this file and the MIT licence.

## Licence

MIT — see `LICENSE`.
