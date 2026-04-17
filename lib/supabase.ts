import { createClient } from "@supabase/supabase-js";

// Use env vars — fallback ensures build succeeds even before env vars are set in Vercel
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yrzswipabeyrmjaqzsxw.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyenN3aXBhYmV5cm1qYXF6c3h3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMzc0MTksImV4cCI6MjA4ODYxMzQxOX0.OTmhmXh_YFjBix5stgXY6oL8cYYnyU9lyfqN4hcWmGU";

export const supabase = createClient(supabaseUrl, supabaseKey);
