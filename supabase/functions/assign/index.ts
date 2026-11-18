// Edge Function `assign`: przydział jednej tury dla zajęć. Wywołuje admin grupy z frontu:
//   supabase.functions.invoke('assign', { body: { classId, round } })
// Działa z tokenem wywołującego (bez klucza service_role), więc obowiązuje RLS:
// tylko admin widzi wszystkie deklaracje i może zapisać przydział.

import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { planRound, type HistoryRow } from "../_shared/plan-round.ts";
import type { AssignRequestDto, AssignResponseDto } from "../_shared/dto.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Tylko POST" });

  let input: AssignRequestDto;
  try {
    input = await req.json();
  } catch {
    return reply(400, { error: "Niepoprawny JSON" });
  }
  const { classId, round } = input;
  if (typeof classId !== "string" || (round !== 1 && round !== 2)) {
    return reply(400, { error: "Wymagane: classId (uuid) i round (1 albo 2)" });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return reply(401, { error: "Zaloguj się" });

  const { data: cls, error: clsError } = await supabase
    .from("classes").select("id, group_id, status, date").eq("id", classId).maybeSingle();
  if (clsError) return reply(500, { error: clsError.message });
  if (!cls) return reply(404, { error: "Nie ma takich zajęć albo nie należysz do grupy" });

  const { data: me } = await supabase
    .from("group_members").select("role")
    .eq("group_id", cls.group_id).eq("user_id", auth.user.id).maybeSingle();
  if (me?.role !== "admin") return reply(403, { error: "Przydział uruchamia tylko admin grupy" });

  const expected = round === 1 ? "round1_open" : "round2_open";
  if (cls.status !== expected) {
    return reply(409, { error: `Tura ${round} wymaga statusu ${expected}, a jest ${cls.status}` });
  }

  const [sets, declarations, round1, points] = await Promise.all([
    supabase.from("class_task_sets").select("task_set_id").eq("class_id", classId),
    supabase.from("declarations").select("user_id, subtask_id").eq("class_id", classId),
    supabase.from("assignments").select("subtask_id, user_id").eq("class_id", classId).eq("round", 1),
    supabase.from("points_totals").select("user_id, points").eq("group_id", cls.group_id),
  ]);
  for (const r of [sets, declarations, round1, points]) {
    if (r.error) return reply(500, { error: r.error.message });
  }

  const setIds = sets.data!.map((s) => s.task_set_id);
  const { data: subtasks, error: subError } = await supabase
    .from("subtasks").select("id, subtask_no, probability").in("task_set_id", setIds);
  if (subError) return reply(500, { error: subError.message });

  // Historia: przydziały z wcześniejszych zajęć grupy (do rotacji gorących).
  const { data: past, error: pastError } = await supabase
    .from("classes").select("id, date").eq("group_id", cls.group_id).lt("date", cls.date);
  if (pastError) return reply(500, { error: pastError.message });
  const pastDate = new Map(past!.map((c) => [c.id, c.date as string]));
  const { data: pastAssignments, error: pastAssError } = pastDate.size
    ? await supabase.from("assignments").select("class_id, subtask_id, user_id").in("class_id", [...pastDate.keys()])
    : { data: [], error: null };
  if (pastAssError) return reply(500, { error: pastAssError.message });
  const { data: pastSubtasks, error: pastSubError } = pastAssignments!.length
    ? await supabase.from("subtasks").select("id, subtask_no, probability")
      .in("id", [...new Set(pastAssignments!.map((a) => a.subtask_id))])
    : { data: [], error: null };
  if (pastSubError) return reply(500, { error: pastSubError.message });
  const subtaskInfo = new Map(pastSubtasks!.map((s) => [s.id, s]));
  const history: HistoryRow[] = pastAssignments!.map((a) => {
    const s = subtaskInfo.get(a.subtask_id)!;
    return {
      class_id: a.class_id,
      class_date: pastDate.get(a.class_id)!,
      user_id: a.user_id,
      subtask_no: s.subtask_no,
      probability: s.probability === null ? null : Number(s.probability),
    };
  });

  const plan = planRound(
    round,
    subtasks!.map((s) => ({ ...s, probability: s.probability === null ? null : Number(s.probability) })),
    declarations.data!,
    round1.data!,
    points.data!,
    history,
  );

  const rows = plan.assignments.map((a) => ({
    class_id: classId,
    subtask_id: a.subtaskId,
    user_id: a.studentId,
    backup_user_id: a.backupStudentId,
    round,
  }));
  const { error: saveError } = await supabase.from("assignments").upsert(rows);
  if (saveError) return reply(500, { error: saveError.message });

  const nextStatus = round === 1 ? "round2_open" : "assigned";
  const { error: statusError } = await supabase.from("classes").update({ status: nextStatus }).eq("id", classId);
  if (statusError) return reply(500, { error: statusError.message });

  const body: AssignResponseDto = { assignments: plan.assignments, limitPerPerson: plan.limitPerPerson };
  return reply(200, body);
});
