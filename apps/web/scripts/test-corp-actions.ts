import { parseAction } from './backfill-corp-actions.ts';

const cases: Array<[string, string, number | null]> = [
  ['Bonus 1:1',                                                                   'bonus',         0.5],
  ['Bonus 3:1',                                                                   'bonus',         0.25],
  ['Bonus 1:2',                                                                   'bonus',         2/3],
  ['Bonus Issue 2:5',                                                             'bonus',         5/7],
  ['Face Value Split (Sub-Division) - From Rs10/- Per Share To Re 1/- Per Share', 'split',         0.1],
  ['Face Value Split (Sub-Division) - From Rs 10/- Per Share To Rs 5/- Per Share','split',         0.5],
  ['Face Value Split From Rs 2/- To Re 1/-',                                      'split',         0.5],
  ['Consolidation of Shares From Re 1/- Per Share To Rs 10/- Per Share',          'consolidation', 10],
  ['Interim Dividend - Rs 2 Per Share',                                           'dividend',      null],
  ['Interim Dividend - Re 1 Per Share',                                           'dividend',      null],
  ['Buy Back',                                                                    'other',         null],
  ['Annual General Meeting',                                                      'other',         null],
  ['Interest Payment',                                                            'other',         null],
];

let bad = 0;
for (const [subj, wantType, wantF] of cases) {
  const got = parseAction(subj);
  const fOk = wantF === null ? got.adjFactor === null
            : got.adjFactor !== null && Math.abs(got.adjFactor - wantF) < 1e-9;
  const ok = got.actionType === wantType && fOk;
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${got.actionType.padEnd(14)} f=${String(got.adjFactor).padEnd(20)} | ${subj.slice(0,58)}`);
  if (!ok) console.log(`      expected type=${wantType} factor=${wantF}`);
}
console.log(bad === 0 ? `\nAll ${cases.length} cases passed.` : `\n${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
