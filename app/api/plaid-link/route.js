// Plaid — Step 1: Create a Link Token
// This starts the Plaid connection flow in the browser
// Docs: https://plaid.com/docs/api/tokens/#linktokencreate

export async function POST(req) {
  try {
    const { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } = await import("plaid");

    const config = new Configuration({
      basePath: PlaidEnvironments[process.env.PLAID_ENV || "sandbox"],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
          "PLAID-SECRET": process.env.PLAID_SECRET,
        },
      },
    });

    const plaid = new PlaidApi(config);

    const response = await plaid.linkTokenCreate({
      user: { client_user_id: "btlr-user-" + Date.now() },
      client_name: "BTLR Home OS",
      products: [Products.Liabilities, Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
    });

    return Response.json({ link_token: response.data.link_token });
  } catch (err) {
    console.error("Plaid link error:", err?.response?.data || err.message);
    return Response.json({ error: "Failed to create Plaid link token." }, { status: 500 });
  }
}
