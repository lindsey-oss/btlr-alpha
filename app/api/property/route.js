// PUT /api/property — update property metadata (address, year built, system ages)
// Called by Settings > Property card.
// After save, re-seeds maintenance forecast from new system ages.
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

// Derive due dates and statuses for standard maintenance tasks from system ages.
// Returns an array of task seed objects ready to upsert.
function seedMaintenanceTasks({ propertyId, userId, roofYear, hvacYear, waterHeaterYear }) {
  const now = new Date();
  const currentYear = now.getFullYear();

  function daysFromNow(days) {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function monthsFromNow(months) {
    const d = new Date(now);
    d.setMonth(d.getMonth() + months);
    return d.toISOString().slice(0, 10);
  }

  function taskStatus(dueDateStr) {
    const due = new Date(dueDateStr);
    const diff = (due - now) / (1000 * 60 * 60 * 24);
    if (diff < 0)  return "overdue";
    if (diff <= 3) return "due-soon";
    return "planned";
  }

  const base = { property_id: propertyId, user_id: userId };

  const tasks = [
    // Universal recurring tasks
    {
      ...base,
      title: "HVAC Filter Replacement",
      category: "HVAC",
      cadence: "Every 30 days",
      cadence_days: 30,
      points: 12,
      due_date: daysFromNow(30),
    },
    {
      ...base,
      title: "Smoke Detector Test",
      category: "Safety",
      cadence: "Every 90 days",
      cadence_days: 90,
      points: 10,
      due_date: daysFromNow(90),
    },
    {
      ...base,
      title: "Clean Dishwasher Filter",
      category: "Appliances",
      cadence: "Monthly",
      cadence_days: 30,
      points: 8,
      due_date: daysFromNow(30),
    },
    {
      ...base,
      title: "Test Sump Pump",
      category: "Plumbing",
      cadence: "Quarterly",
      cadence_days: 90,
      points: 10,
      due_date: monthsFromNow(3),
    },
    {
      ...base,
      title: "Chimney Inspection",
      category: "Exterior",
      cadence: "Annual",
      cadence_days: 365,
      points: 16,
      due_date: monthsFromNow(6),
    },
    {
      ...base,
      title: "Dryer Vent Cleaning",
      category: "Appliances",
      cadence: "Annual",
      cadence_days: 365,
      points: 14,
      due_date: monthsFromNow(8),
    },
    {
      ...base,
      title: "Gutter Cleaning",
      category: "Exterior",
      cadence: "Spring / Fall",
      cadence_days: 180,
      points: 14,
      due_date: daysFromNow(60),
    },
    {
      ...base,
      title: "Termite Inspection",
      category: "Pest",
      cadence: "Annual",
      cadence_days: 365,
      points: 18,
      due_date: monthsFromNow(8),
    },
    {
      ...base,
      title: "Winterize Outdoor Faucets",
      category: "Plumbing",
      cadence: "Fall",
      cadence_days: 365,
      points: 12,
      due_date: monthsFromNow(5),
    },
    {
      ...base,
      title: "Furnace Tune-Up",
      category: "HVAC",
      cadence: "Annual",
      cadence_days: 365,
      points: 16,
      due_date: monthsFromNow(5),
    },
  ];

  // Age-conditional tasks
  if (hvacYear) {
    const hvacAge = currentYear - Number(hvacYear);
    if (hvacAge >= 10) {
      tasks.push({
        ...base,
        title: "HVAC System Evaluation",
        category: "HVAC",
        cadence: "One-time",
        cadence_days: null,
        points: 20,
        due_date: daysFromNow(90),
      });
    }
  }

  if (waterHeaterYear) {
    const wAge = currentYear - Number(waterHeaterYear);
    if (wAge >= 8) {
      tasks.push({
        ...base,
        title: "Water Heater Inspection & Flush",
        category: "Plumbing",
        cadence: "Annual",
        cadence_days: 365,
        points: 16,
        due_date: daysFromNow(60),
      });
    }
  }

  if (roofYear) {
    const roofAge = currentYear - Number(roofYear);
    if (roofAge >= 15) {
      tasks.push({
        ...base,
        title: "Roof Condition Assessment",
        category: "Exterior",
        cadence: "One-time",
        cadence_days: null,
        points: 20,
        due_date: daysFromNow(60),
      });
    }
  }

  // Apply status based on due_date
  return tasks.map(t => ({ ...t, status: taskStatus(t.due_date) }));
}

export async function PUT(req) {
  try {
    const supabase = authedClient(req);

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      property_id,
      address,
      year_built,
      sqft,
      roof_year,
      hvac_year,
      water_heater_year,
    } = body;

    if (!property_id) {
      return Response.json({ error: "property_id required" }, { status: 400 });
    }

    // Build update payload — only include provided fields
    const update = {};
    if (address           !== undefined) update.address           = address;
    if (year_built        !== undefined) update.year_built        = year_built        ? Number(year_built)        : null;
    if (sqft              !== undefined) update.sqft              = sqft              ? Number(String(sqft).replace(/,/g, ""))  : null;
    if (roof_year         !== undefined) update.roof_year         = roof_year         ? Number(roof_year)         : null;
    if (hvac_year         !== undefined) update.hvac_year         = hvac_year         ? Number(hvac_year)         : null;
    if (water_heater_year !== undefined) update.water_heater_year = water_heater_year ? Number(water_heater_year) : null;

    if (Object.keys(update).length > 0) {
      const { error: propErr } = await supabase
        .from("properties")
        .update(update)
        .eq("id", property_id)
        .eq("user_id", user.id); // safety: only own property

      if (propErr) throw propErr;
    }

    // Re-seed maintenance tasks if system ages were updated
    const hasAgeUpdate = roof_year !== undefined || hvac_year !== undefined || water_heater_year !== undefined;
    if (hasAgeUpdate) {
      // Delete auto-generated (non-completed) tasks for this property and re-seed
      await supabase
        .from("maintenance_tasks")
        .delete()
        .eq("property_id", property_id)
        .eq("user_id", user.id)
        .neq("status", "done");

      const tasks = seedMaintenanceTasks({
        propertyId: property_id,
        userId: user.id,
        roofYear: roof_year ?? update.roof_year,
        hvacYear: hvac_year ?? update.hvac_year,
        waterHeaterYear: water_heater_year ?? update.water_heater_year,
      });

      if (tasks.length > 0) {
        const { error: seedErr } = await supabase
          .from("maintenance_tasks")
          .insert(tasks);
        if (seedErr) console.error("[PUT /api/property] maintenance seed error:", seedErr);
      }
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error("[PUT /api/property]", err);
    return Response.json({ error: err.message ?? "Update failed" }, { status: 500 });
  }
}

export async function GET(req) {
  try {
    const supabase = authedClient(req);
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: prop } = await supabase
      .from("properties")
      .select("id, address, year_built, sqft, roof_year, hvac_year, water_heater_year")
      .eq("user_id", user.id)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    return Response.json(prop ?? {});
  } catch (err) {
    console.error("[GET /api/property]", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
