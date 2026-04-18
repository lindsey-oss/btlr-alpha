"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { Home as HomeIcon, Loader2, Eye, EyeOff, DollarSign, Bot } from "lucide-react";

const C = {
  navy:    "#0f1f3d",
  accent:  "#2563eb",
  text:    "#0f172a",
  text2:   "#475569",
  text3:   "#94a3b8",
  border:  "#e2e8f0",
  bg:      "#f0f4f8",
  red:     "#dc2626",
  green:   "#16a34a",
};

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode]         = useState<"login" | "signup">("login");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw]     = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [success, setSuccess]   = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setError(error.message);
      } else {
        // If email confirmation is off in Supabase, go straight to dashboard
        // If email confirmation is on, show a message
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          router.push("/dashboard");
        } else {
          setSuccess("Account created! Check your email to confirm, then sign in.");
          setMode("login");
        }
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
      } else {
        router.push("/dashboard");
      }
    }
    setLoading(false);
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex",
      background: `linear-gradient(135deg, ${C.navy} 0%, #1e3a8a 60%, #1e3a5f 100%)`,
      position: "relative", overflow: "hidden",
    }}>
      {/* Background decoration */}
      <div style={{ position: "absolute", top: "-20%", right: "-10%", width: 600, height: 600,
        borderRadius: "50%", background: "rgba(37,99,235,0.15)", pointerEvents: "none" }}/>
      <div style={{ position: "absolute", bottom: "-20%", left: "-5%", width: 400, height: 400,
        borderRadius: "50%", background: "rgba(255,255,255,0.04)", pointerEvents: "none" }}/>

      {/* Left — branding */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center",
        padding: "60px 80px", color: "white" }} className="hidden-mobile">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 48 }}>
          <div style={{ width: 44, height: 44, borderRadius: 14, background: "rgba(255,255,255,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
            border: "1px solid rgba(255,255,255,0.2)" }}>
            <HomeIcon size={22} color="white"/>
          </div>
          <span style={{ fontWeight: 700, fontSize: 22, letterSpacing: "-0.5px" }}>BTLR</span>
        </div>

        <h1 style={{ fontSize: 42, fontWeight: 800, letterSpacing: "-1.5px", lineHeight: 1.1, marginBottom: 20 }}>
          Your home,<br/>fully managed.
        </h1>
        <p style={{ fontSize: 17, color: "rgba(255,255,255,0.55)", lineHeight: 1.7, maxWidth: 420 }}>
          Mortgage tracking, home health scores, repair budgeting, and an AI butler that handles the rest. Like Jarvis — for your home.
        </p>

        <div style={{ marginTop: 48, display: "flex", flexDirection: "column", gap: 16 }}>
          {[
            { icon: <HomeIcon size={18} color="white"/>, text: "Home health score & predictive maintenance" },
            { icon: <DollarSign size={18} color="white"/>, text: "Mortgage, insurance & property tax in one place" },
            { icon: <Bot size={18} color="white"/>, text: "AI concierge that acts on your behalf" },
          ].map((item, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(255,255,255,0.12)",
                border: "1px solid rgba(255,255,255,0.18)", display: "flex", alignItems: "center",
                justifyContent: "center", flexShrink: 0 }}>
                {item.icon}
              </div>
              <span style={{ fontSize: 15, color: "rgba(255,255,255,0.65)" }}>{item.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right — form */}
      <div style={{ width: 440, display: "flex", alignItems: "center", justifyContent: "center",
        padding: 32, background: "white", flexShrink: 0 }}>
        <div style={{ width: "100%", maxWidth: 360 }}>

          {/* Mobile logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 36 }}>
            <div style={{ width: 36, height: 36, borderRadius: 11, background: C.navy,
              display: "flex", alignItems: "center", justifyContent: "center" }}>
              <HomeIcon size={18} color="white"/>
            </div>
            <span style={{ fontWeight: 700, fontSize: 18, color: C.text, letterSpacing: "-0.3px" }}>BTLR</span>
          </div>

          <h2 style={{ fontSize: 24, fontWeight: 700, color: C.text, letterSpacing: "-0.5px", marginBottom: 6 }}>
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h2>
          <p style={{ fontSize: 16, color: C.text3, marginBottom: 28 }}>
            {mode === "login" ? "Sign in to your home dashboard." : "Start managing your home like a pro."}
          </p>

          {/* Toggle */}
          <div style={{ display: "flex", background: C.bg, borderRadius: 10, padding: 4, marginBottom: 28, border: `1px solid ${C.border}` }}>
            {(["login", "signup"] as const).map(m => (
              <button key={m} onClick={() => { setMode(m); setError(""); setSuccess(""); }} style={{
                flex: 1, padding: "8px 0", borderRadius: 8, border: "none", cursor: "pointer",
                fontSize: 15, fontWeight: 600, transition: "all 0.2s",
                background: mode === m ? "white" : "transparent",
                color: mode === m ? C.text : C.text3,
                boxShadow: mode === m ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
              }}>
                {m === "login" ? "Sign In" : "Sign Up"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Email */}
            <div>
              <label style={{ display: "block", fontSize: 16, fontWeight: 600, color: C.text2, marginBottom: 6 }}>
                Email address
              </label>
              <input
                type="email" required value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                style={{ width: "100%", padding: "11px 14px", borderRadius: 10, fontSize: 16,
                  border: `1px solid ${C.border}`, background: C.bg, color: C.text,
                  outline: "none", boxSizing: "border-box" }}
              />
            </div>

            {/* Password */}
            <div>
              <label style={{ display: "block", fontSize: 16, fontWeight: 600, color: C.text2, marginBottom: 6 }}>
                Password
              </label>
              <div style={{ position: "relative" }}>
                <input
                  type={showPw ? "text" : "password"} required value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={mode === "signup" ? "Min. 6 characters" : "Your password"}
                  style={{ width: "100%", padding: "11px 42px 11px 14px", borderRadius: 10, fontSize: 16,
                    border: `1px solid ${C.border}`, background: C.bg, color: C.text,
                    outline: "none", boxSizing: "border-box" }}
                />
                <button type="button" onClick={() => setShowPw(!showPw)} style={{
                  position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none", cursor: "pointer", color: C.text3, padding: 0,
                }}>
                  {showPw ? <EyeOff size={16}/> : <Eye size={16}/>}
                </button>
              </div>
            </div>

            {/* Error / Success */}
            {error && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8,
                padding: "10px 14px", fontSize: 15, color: C.red }}>
                {error}
              </div>
            )}
            {success && (
              <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8,
                padding: "10px 14px", fontSize: 15, color: C.green }}>
                {success}
              </div>
            )}

            {/* Submit */}
            <button type="submit" disabled={loading} style={{
              padding: "12px", borderRadius: 10, border: "none", cursor: "pointer",
              background: C.navy, color: "white", fontSize: 16, fontWeight: 600,
              opacity: loading ? 0.7 : 1, display: "flex", alignItems: "center",
              justifyContent: "center", gap: 8, marginTop: 4, transition: "opacity 0.2s",
            }}>
              {loading && <Loader2 size={15} className="animate-spin"/>}
              {loading ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}
            </button>
          </form>

          <p style={{ marginTop: 24, fontSize: 16, color: C.text3, textAlign: "center" }}>
            By signing up you agree to BTLR's Terms of Service and Privacy Policy.
          </p>
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) { .hidden-mobile { display: none !important; } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
}
