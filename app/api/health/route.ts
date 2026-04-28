import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const start = Date.now();
  let db_ok = false;
  let storage_ok = false;

  try {
    // Check DB connectivity
    const { error } = await supabase.from('properties').select('id').limit(1);
    db_ok = !error;
  } catch { db_ok = false; }

  try {
    // Check storage connectivity
    const { error } = await supabase.storage.listBuckets();
    storage_ok = !error;
  } catch { storage_ok = false; }

  const latency_ms = Date.now() - start;
  const status = db_ok && storage_ok ? 'ok' : (!db_ok && !storage_ok ? 'down' : 'degraded');

  // Log health check result
  try {
    await supabase.from('health_checks').insert({ status, db_ok, storage_ok, latency_ms });
  } catch { /* don't fail health check if logging fails */ }

  return Response.json({ status, db_ok, storage_ok, latency_ms, timestamp: new Date().toISOString() },
    { status: status === 'down' ? 503 : 200 }
  );
}
