import { test } from "node:test";
import assert from "node:assert/strict";
import { assign, probability, DEFAULT_PROBABILITY as D, TARGET_BUDGET, type Student } from "./assignment.ts";

const first = () => 0;
const s = (id: string, subtaskNo: number) => ({ id, subtaskNo });
/** Student: id, ile zajęć czeka na gorący (undefined = nigdy nie miał), zgłoszone podpunkty. */
const st = (id: string, hotWait: number | undefined, ...declarations: string[]): Student => ({
  id,
  points: 0,
  hotWait,
  declarations,
});
const who = (result: ReturnType<typeof assign>, subtaskId: string) =>
  result.find((r) => r.subtaskId === subtaskId)!.studentId;
const mine = (result: ReturnType<typeof assign>, id: string) =>
  result.filter((r) => r.studentId === id).map((r) => r.subtaskId).sort();

test("bez wpisanej wartości szansa zależy od numeru podpunktu", () => {
  assert.equal(probability(s("a", 1)), D.first);
  assert.equal(probability(s("b", 2)), D.second);
  assert.equal(probability({ id: "e", subtaskNo: 5, probability: null }), D.rest);
  assert.equal(probability({ id: "c", subtaskNo: 3, probability: 1 }), 1);
});

test("błędne prawdopodobieństwo jest odrzucane", () => {
  assert.throws(() => assign([{ id: "x", subtaskNo: 1, probability: 1.5 }], [], 1), /0\.\.1/);
});

test("kto dłużej czeka na gorący, dostaje go pierwszy, niezależnie od plusów", () => {
  const result = assign(
    [s("1.1", 1)],
    [
      { ...st("ala", 5, "1.1"), points: 9 },
      { ...st("bob", 1, "1.1"), points: 0 },
    ],
    1,
    first,
  );
  assert.equal(who(result, "1.1"), "ala");
});

test("kto nigdy nie miał gorącego, wyprzedza każdego, kto już miał", () => {
  const result = assign([s("1.1", 1)], [st("ala", 100, "1.1"), st("bob", undefined, "1.1")], 1, first);
  assert.equal(who(result, "1.1"), "bob");
});

test("losowanie rozstrzyga remis w kolejce, a ten sam los daje ten sam wynik", () => {
  const sub = [s("1.1", 1)];
  const students = [st("ala", 2, "1.1"), st("bob", 2, "1.1")];
  const seq = (...v: number[]) => () => v.shift() ?? 0;
  assert.equal(who(assign(sub, students, 1, seq(0.1, 0.9)), "1.1"), "ala");
  assert.equal(who(assign(sub, students, 1, seq(0.9, 0.1)), "1.1"), "bob");
});

test("zgłoszenie dodatkowych podpunktów nie pogarsza przydziału", () => {
  const sub = [s("1.1", 1), s("1.2", 2), s("1.3", 3), s("1.4", 4)];
  const few = assign(sub, [st("ala", 5, "1.1"), st("bob", 1, "1.1", "1.2")], 1, first);
  const many = assign(sub, [st("ala", 5, "1.1", "1.2", "1.3", "1.4"), st("bob", 1, "1.1", "1.2")], 1, first);
  assert.equal(who(few, "1.1"), "ala");
  assert.equal(who(many, "1.1"), "ala");
  assert.equal(who(few, "1.2"), "bob");
  assert.equal(who(many, "1.2"), "bob");
});

test("elastyczny z wysokim priorytetem nie blokuje gorącego komuś, kto ma tylko ten jeden", () => {
  // ala (czeka najdłużej) woli 1.1, ale ma też 1.2; bob chce tylko 1.1: obaj dostają gorący
  const result = assign([s("1.1", 1), s("1.2", 2)], [st("ala", 9, "1.1", "1.2"), st("bob", 1, "1.1")], 1, first);
  assert.equal(who(result, "1.1"), "bob");
  assert.equal(who(result, "1.2"), "ala");
});

test("wyższy w kolejce nie traci gorącego na rzecz niższego", () => {
  const result = assign([s("1.1", 1), s("1.2", 2)], [st("ala", 9, "1.1"), st("bob", 1, "1.1", "1.2")], 1, first);
  assert.equal(who(result, "1.1"), "ala");
  assert.equal(who(result, "1.2"), "bob");
});

test("tura 1: bez gorącego dostajesz resztki do budżetu, z gorącym nie dostajesz resztek", () => {
  const sub = [s("1.1", 1), s("1.3", 3), s("1.4", 4), s("1.5", 5), s("1.6", 6)];
  const result = assign(
    sub,
    [
      st("ala", 9, "1.1", "1.3"), // ma gorący, resztki jej niepotrzebne
      st("cyryl", 1, "1.1", "1.3", "1.4", "1.5", "1.6"),
    ],
    1,
    first,
  );
  assert.deepEqual(mine(result, "ala"), ["1.1"]);
  const cyryl = mine(result, "cyryl");
  assert.equal(cyryl.length, 3); // 3 x 0.3 = 0.9 >= budżet
  assert.ok(cyryl.length * D.rest >= TARGET_BUDGET);
});

test("tura 2: wolny gorący trafia najpierw do osoby bez gorącego", () => {
  const result = assign(
    [s("2.1", 1)],
    [
      { ...st("ala", 0, "2.1"), heldBudget: 0.9 },
      { ...st("bob", 9, "2.1"), heldBudget: 0 },
    ],
    2,
    first,
  );
  assert.equal(who(result, "2.1"), "bob");
});

test("tura 2: jeśli nikt bez gorącego go nie chce, wolny gorący dostaje posiadacz jednego", () => {
  const result = assign([s("2.1", 1)], [{ ...st("ala", 0, "2.1"), heldBudget: 0.9 }], 2, first);
  assert.equal(who(result, "2.1"), "ala");
});

test("tura 2: kto ma już budżet, nie dostaje resztek", () => {
  const result = assign([s("2.3", 3)], [{ ...st("ala", 0, "2.3"), heldBudget: 0.9 }], 2, first);
  assert.equal(who(result, "2.3"), null);
});

test("tura 2: kto z tury 1 ma tylko resztkę, dostaje wolny gorący i wtedy resztek już nie", () => {
  const result = assign(
    [s("2.1", 1), s("2.4", 4)],
    [{ ...st("ala", 0, "2.1", "2.4"), heldBudget: 0.3 }],
    2,
    first,
  );
  assert.deepEqual(mine(result, "ala"), ["2.1"]);
});

test("nikt nie dostaje podpunktu, którego nie zaznaczył", () => {
  const result = assign([s("1.1", 1), s("2.1", 1), s("3.1", 1)], [st("ala", 0, "1.1", "2.1")], 1, first);
  assert.equal(who(result, "3.1"), null);
});

test("przy 8 chętnych na gorące i 6 gorących dokładnie 6 osób je dostaje, a reszta ma resztki", () => {
  const hot = ["1.1", "1.2", "2.1", "2.2", "3.1", "3.2"];
  const sub = [...hot.map((id, i) => s(id, (i % 2) + 1)), s("1.3", 3), s("1.4", 4), s("2.3", 3), s("2.4", 4), s("3.3", 3)];
  const students = Array.from({ length: 8 }, (_, i) => st(`u${i}`, i, ...hot, "1.3", "1.4", "2.3", "2.4", "3.3"));
  const result = assign(sub, students, 1, first);
  const withHot = students.filter((u) => mine(result, u.id).some((id) => hot.includes(id)));
  assert.equal(withHot.length, 6);
  // dostają ci, którzy czekają najdłużej (u7, u6, ... u2)
  assert.deepEqual(withHot.map((u) => u.id).sort(), ["u2", "u3", "u4", "u5", "u6", "u7"]);
});

test("zastępca: inna osoba z deklaracją, bez nikogo bez chętnych, nikt nie zastępuje dwa razy", () => {
  const result = assign(
    [s("1.1", 1), s("1.2", 2), s("1.3", 3)],
    [st("ala", 1, "1.1", "1.2"), st("bob", 0, "1.2", "1.1"), st("cyryl", 0, "1.3")],
    1,
    first,
  );
  const by = (id: string) => result.find((r) => r.subtaskId === id)!;
  assert.notEqual(by("1.1").backupStudentId, by("1.1").studentId);
  assert.equal(by("1.3").backupStudentId, null); // nikt inny nie zaznaczył 1.3
  const used = result.map((r) => r.backupStudentId).filter(Boolean);
  assert.equal(new Set(used).size, used.length);
  for (const r of result) assert.notEqual(r.backupStudentId, r.studentId);
});
