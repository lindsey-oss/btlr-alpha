// /api/maintenance — GET tasks, POST mark-done, POST snooze
// Auth: Bearer token in Authorization header.

import { createClient } from "@supabase/supabase-js";

function authedClient(req) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}
  );
}

// Re-evaluate status based on due_date and snoozed_until
function liveStatus(task) {
  if (task.completed_at) return "done";
  const now = new Date();
  const due = task.snoozed_until
    ? new Date(task.snoozed_until)
    : new Date(task.due_date);
  const diff = (due - now) / (1000 * 60 * 60 * 24);
  if (diff < 0)  return "overdue";
  if (diff <= 3) return "due-soon";
  return task.status; // preserve 'scheduled' / 'booked' / 'planned'
}

// GET /api/maintenance?property_id=xxx
// Returns all tasks for a property, statuses refreshed live.
export async function GET(req) {
  try {
    const supabase = authedClient(req);
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url      = new URL(req.url);
    const propId   = url.searchParams.get("property_id");
    if (!propId) return Response.json({ error: "property_id required" }, { status: 400 });

    const { data: tasks, error } = await supabase
      .from("maintenance_tasks")
      .select("*")
      .eq("property_id", propId)
      .eq("user_id", user.id)
      .order("due_date", { ascending: true });

    if (error) throw error;

    // Freshen statuses — due-dates drift relative to today
    const refreshed = (tasks ?? []).map(t => ({ ...t, status: liveStatus(t) }));

    // Sync refreshed statuses back to DB (fire-and-forget)
    const updates = refreshed.filter((t, i) => t.status !== (tasks?.[i]?.status));
    if (updates.length > 0) {
      await Promise.allSettled(
        updates.map(t =>
          supabase.from("maintenance_tasks")
            .update({ status: t.status })
            .eq("id", t.id)
        )
      );
    }

    return Response.json({ tasks: refreshed });
  } catch (err) {
    console.error("[GET /api/maintenance]", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/maintenance
// Body: { action: "complete" | "snooze" | "uncomplete", task_id, snooze_days? }
export async function POST(req) {
  try {
    const supabase = authedClient(req);
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { action, task_id, snooze_days = 7 } = await req.json();
    if (!task_id) return Response.json({ error: "task_id required" }, { status: 400 });

    let update = {};

    if (action === "complete") {
      update = {
        status:       "done",
        completed_at: new Date().toISOString(),
        snoozed_until: null,
      };
    } else if (action === "uncomplete") {
      // Fetch original due_date to restore status
      const { data: task } = await supabase
        .from("maintenance_tasks")
        .select("due_date, status")
        .eq("id", task_id)
        .eq("user_id", user.id)
        .single();

      const restoredStatus = (() => {
        if (!task?.due_date) return "planned";
        const diff = (new Date(task.due_date) - new Date()) / (1000 * 60 * 60 * 24);
        if (diff < 0)  return "overdue";
        if (diff <= 3) return "due-soon";
        return "planned";
      })();

      update = {
        status:       restoredStatus,
        completed_at: null,
      };
    } else if (action === "snooze") {
      const snoozedUntil = new Date();
      snoozedUntil.setDate(snoozedUntil.getDate() + snooze_days);
      update = {
        snoozed_until: snoozedUntil.toISOString().slice(0, 10),
        status:        "planned",
        completed_at:  null,
      };
    } else {
      return Response.json({ error: "Unknown action" }, { status: 400 });
    }

    const { error } = await supabase
      .from("maintenance_tasks")
      .update(update)
      .eq("id", task_id)
      .eq("user_id", user.id); // RLS safety

    if (error) throw error;

    // Auto-reschedule recurring tasks when marked complete
    if (action === "complete") {
      const { data: task } = await supabase
        .from("maintenance_tasks")
        .select("*")
        .eq("id", task_id)
        .single();

      if (task?.cadence_days) {
        const nextDue = new Date(task.due_date);
        nextDue.setDate(nextDue.getDate() + task.cadence_days);
        const nextDueStr = nextDue.toISOString().slice(0, 10);
        const diff = (nextDue - new Date()) / (1000 * 60 * 60 * 24);
        const nextStatus = diff < 0 ? "overdue" : diff <= 3 ? "due-soon" : "planned";

        await supabase.from("maintenance_tasks").insert({
          property_id:   task.property_id,
          user_id:       task.user_id,
          title:         task.title,
          category:      task.category,
          cadence:       task.cadence,
          cadence_days:  task.cadence_days,
          points:        task.points,
          due_date:      nextDueStr,
          status:        nextStatus,
          vendor_name:   task.vendor_name,
        });
      }
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/maintenance]", err);
    return Response.json({ error: err.message ?? "Action failed" }, { status: 500 });
  }
}
