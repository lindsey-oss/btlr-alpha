// Plaid — Fetch mortgage + financial data and save to properties table

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function GET(req) {
  try {
    // Get stored access token
    const { data: property } = await supabase
      .from("properties")
      .select("id, plaid_access_token")
      .limit(1)
      .maybeSingle();

    if (!property?.plaid_access_token) {
      return Response.json({ connected: false });
    }

    const { Configuration, PlaidApi, PlaidEnvironments } = await import("plaid");

    const config = new Configuration({
      basePath: PlaidEnvironments[process.env.PLAID_ENV || "sandbox"],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
          "PLAID-SECRET":    process.env.PLAID_SECRET,
        },
      },
    });

    const plaid      = new PlaidApi(config);
    const accessToken = property.plaid_access_token;

    // ── Pull liabilities (mortgage) ──────────────────────────────────────
    let mortgage = null;
    try {
      const liabRes  = await plaid.liabilitiesGet({ access_token: accessToken });
      const mortgages = liabRes.data.liabilities?.mortgage ?? [];

      if (mortgages.length > 0) {
        const m       = mortgages[0];
        const dueDate = m.next_payment_due_date; // "YYYY-MM-DD"
        const dueDay  = dueDate ? new Date(dueDate + "T12:00:00").getDate() : null;

        // Get readable account name from accounts list
        const accounts    = liabRes.data.accounts ?? [];
        const acct        = accounts.find(a => a.account_id === m.account_id);
        const lenderName  = acct?.name ?? acct?.official_name ?? "Mortgage";

        mortgage = {
          lender:  lenderName,
          balance: m.outstanding_principal_balance ?? null,
          payment: m.next_monthly_payment ?? null,
          due_day: dueDay,
          rate:    m.interest_rate?.percentage
                   ? m.interest_rate.percentage / 100   // convert 6.5 → 0.065
                   : null,
        };

        // Persist to properties table so it loads on next visit
        if (property?.id) {
          await supabase.from("properties").update({
            mortgage_lender:     mortgage.lender,
            mortgage_balance:    mortgage.balance,
            mortgage_payment:    mortgage.payment,
            mortgage_due_day:    mortgage.due_day,
            mortgage_rate:       mortgage.rate,
            mortgage_updated_at: new Date().toISOString(),
          }).eq("id", property.id);
        }
      }
    } catch (liabErr) {
      const code = liabErr?.response?.data?.error_code;
      console.error("Liabilities fetch error:", code || liabErr.message);
      // PRODUCTS_NOT_SUPPORTED → institution doesn't support liabilities (sandbox-only issue)
      // ITEM_LOGIN_REQUIRED → user needs to re-authenticate
      // Both are non-fatal — mortgage data can be entered manually
    }

    // ── Pull recent transactions ─────────────────────────────────────────
    let recentTransactions = [];
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const txRes = await plaid.transactionsGet({
        access_token: accessToken,
        start_date: thirtyDaysAgo.toISOString().split("T")[0],
        end_date:   new Date().toISOString().split("T")[0],
        options: { count: 20 },
      });
      recentTransactions = txRes.data.transactions.map(t => ({
        name:   t.name,
        amount: t.amount,
        date:   t.date,
      }));
    } catch { /* Non-fatal */ }

    // ── Pull savings / investment accounts (for Repair Fund display) ────────
    let savingsAccounts = [];
    try {
      const acctRes = await plaid.accountsGet({ access_token: accessToken });
      savingsAccounts = (acctRes.data.accounts ?? [])
        .filter(a =>
          // depository savings, money market, cd, cash management
          (a.type === "depository" && ["savings", "money market", "cd", "cash management"].includes(a.subtype)) ||
          // investment / brokerage accounts (Acorns, Robinhood, etc.)
          a.type === "investment"
        )
        .map(a => ({
          name:    a.official_name ?? a.name ?? "Savings Account",
          balance: a.balances?.current ?? a.balances?.available ?? 0,
          type:    a.type,
          subtype: a.subtype ?? null,
        }))
        .sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0)); // highest balance first
    } catch (acctErr) {
      console.error("[plaid-data] accounts fetch error:", acctErr?.response?.data?.error_code || acctErr.message);
    }

    return Response.json({ connected: true, mortgage, recentTransactions, savingsAccounts });
  } catch (err) {
    console.error("Plaid data error:", err?.response?.data || err.message);
    return Response.json({ error: "Failed to fetch financial data." }, { status: 500 });
  }
}
