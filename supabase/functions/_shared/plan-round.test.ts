import { test } from "node:test";
import assert from "node:assert/strict";
import { planRound, type HistoryRow } from "./plan-round.ts";

const first = () => 0;
const subtasks = [
  { id: "1.1", subtask_no: 1, probability: null },
  { id: "1.2", subtask_no: 2, probability: null },
  { id: "1.3", subtask_no: 3, probability: null },
];
const who = (plan: ReturnType<typeof planRound>, id: string) => plan.assignments.find((a) => a.subtaskId === id)!.studentId;
const h = (class_id: string, class_date: string, user_id: string | null, subtask_no: number): HistoryRow => ({
  class_id,
  class_date,
  user_id,
  subtask_no,
  probability: null,
});

// c1 (10-01): ala miała gorący; c2 (10-08): bob miał gorący; c3 (10-15): cyryl miał tylko resztkę (1.3)
const history: HistoryRow[] = [
  h("c1", "2026-10-01", "ala", 1),
  h("c2", "2026-10-08", "bob", 1),
  h("c3", "2026-10-15", "cyryl", 3),
  h("c3", "2026-10-15", null, 1),
];

test("tura 1: pierwszeństwo ma ten, kto najdawniej miał gorący, plusy nie mają znaczenia", () => {
  const plan = planRound(
    1,
    subtasks,
    [
      { user_id: "ala", subtask_id: "1.1" },
      { user_id: "bob", subtask_id: "1.1" },
    ],
    [],
    [{ user_id: "ala", points: 0 }, { user_id: "bob", points: 9 }],
    history,
    first,
  );
  // ala czeka 2 zajęcia (c2, c3), bob 1 (c3): ala pierwsza
  assert.equal(who(plan, "1.1"), "ala");
  assert.equal(plan.limitPerPerson, null);
});

test("tura 1: kto nigdy nie miał gorącego (nawet z resztką w historii), wyprzedza wszystkich", () => {
  const plan = planRound(
    1,
    subtasks,
    [
      { user_id: "ala", subtask_id: "1.1" },
      { user_id: "cyryl", subtask_id: "1.1" },
    ],
    [],
    [],
    history,
    first,
  );
  assert.equal(who(plan, "1.1"), "cyryl");
});

test("tura 2: tylko wolne podpunkty; posiadacz gorącego z tury 1 ustępuje temu, kto nic nie ma", () => {
  const plan = planRound(
    2,
    subtasks,
    [
      { user_id: "bob", subtask_id: "1.1" }, // zajęty w turze 1: ignorowany
      { user_id: "bob", subtask_id: "1.2" },
      { user_id: "ala", subtask_id: "1.2" },
      { user_id: "ala", subtask_id: "1.3" },
    ],
    [
      { subtask_id: "1.1", user_id: "bob" }, // bob ma gorący z tury 1
      { subtask_id: "1.2", user_id: null },
      { subtask_id: "1.3", user_id: null },
    ],
    [],
    history,
    first,
  );
  assert.equal(who(plan, "1.2"), "ala");
  assert.deepEqual(plan.assignments.map((a) => a.subtaskId).sort(), ["1.2", "1.3"]);
});
