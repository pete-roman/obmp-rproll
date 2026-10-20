// node test/tray.test.mjs  -- the tray rules: the placeholder d20, 1-4 add, 5 clears, never empty, max 5.
import { add, clear, counts, fresh, fromCounts, parse, remove, total, KEY_KINDS } from '../src/tray.js';

let failures = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) { failures++; console.log(`FAIL ${label}: ${g}, expected ${w}`); } else console.log(`ok   ${label}`);
};
const keys = (t, seq) => seq.reduce((acc, k) => (k === 5 ? clear() : add(acc, KEY_KINDS[k]).tray), t);
const C = (d6, d10, d20, d100) => ({ d6, d10, d20, d100 });

eq('opens with one placeholder d20', fresh(), { ...C(0, 0, 1, 0), placeholder: true });
eq('1 replaces the placeholder with a d6', counts(keys(fresh(), [1])), C(1, 0, 0, 0));
eq('1, 1 gives two d6', counts(keys(fresh(), [1, 1])), C(2, 0, 0, 0));
eq('1, 1, 3 gives d6, d6, d20', counts(keys(fresh(), [1, 1, 3])), C(2, 0, 1, 0));
eq('3 first makes the placeholder a real d20: still one d20', keys(fresh(), [3]), { ...C(0, 0, 1, 0), placeholder: false });
eq('3, 3 gives two d20', counts(keys(fresh(), [3, 3])), C(0, 0, 2, 0));
eq('2 gives a d10, 4 a d100', counts(keys(fresh(), [2, 4])), C(0, 1, 0, 1));
eq('5 clears to one placeholder d20', keys(fresh(), [1, 2, 3, 5]), fresh());
eq('5 on a fresh tray stays fresh', keys(fresh(), [5]), fresh());
eq('after 5, the next add replaces the placeholder again', counts(keys(fresh(), [1, 5, 2])), C(0, 1, 0, 0));

const five = keys(fresh(), [1, 1, 2, 3, 4]);
eq('five dice', counts(five), C(2, 1, 1, 1));
const sixth = add(five, 'd6');
eq('a sixth die is refused', sixth.refused, true);
eq('and nothing changes', sixth.tray, five);

eq('removing the last die gives a placeholder d20', remove(keys(fresh(), [1]), 'd6'), fresh());
eq('removing one of two', counts(remove(keys(fresh(), [1, 1]), 'd6')), C(1, 0, 0, 0));
eq('removing a kind that is not there changes nothing', remove(keys(fresh(), [1]), 'd20'), keys(fresh(), [1]));
eq('removing the placeholder leaves it', remove(fresh(), 'd20'), fresh());
eq('the tray is never empty', [fresh(), keys(fresh(), [1]), remove(keys(fresh(), [4]), 'd100')].every((t) => total(t) >= 1), true);

eq('/roll 2d10 sets the tray', fromCounts(C(0, 2, 0, 0)), { ...C(0, 2, 0, 0), placeholder: false });
eq('/roll with six dice is not a tray', fromCounts(C(3, 0, 3, 0)), null);
eq('no dice is not a tray', fromCounts(C(0, 0, 0, 0)), null);
eq('negative is not a tray', fromCounts(C(-1, 2, 0, 0)), null);

eq('stored tray comes back', parse(JSON.stringify({ ...C(1, 1, 0, 0), placeholder: false })), { ...C(1, 1, 0, 0), placeholder: false });
eq('stored placeholder comes back', parse(JSON.stringify(fresh())), fresh());
eq('placeholder flag on a real tray is dropped', parse(JSON.stringify({ ...C(2, 0, 0, 0), placeholder: true })).placeholder, false);
eq('broken storage is ignored', parse('{nope'), null);

console.log(failures ? `${failures} failure(s)` : 'all passed');
process.exit(failures ? 1 : 0);
