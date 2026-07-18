// api/beta.js — Vercel serverless function
// Saves a beta-tester signup to Supabase (beta_signups table).
// Reuses the same SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars as audit.js.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { name, email, outcome, consent } = req.body || {};
    if (!email || !consent) return res.status(400).json({ error: 'Email and consent required' });

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Supabase env vars missing');

    const r = await fetch(`${url}/rest/v1/beta_signups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        name: name ? String(name).slice(0, 200) : null,
        email: String(email).toLowerCase().slice(0, 320),
        outcome: outcome ? String(outcome).slice(0, 2000) : null,
        consent: !!consent,
        source: 'audit-email'
      })
    });

    // 23505 = unique violation. Already signed up is a success, not an error.
    if (!r.ok && r.status !== 409) {
      const body = await r.text();
      if (!body.includes('23505')) throw new Error(`Supabase ${r.status}: ${body.slice(0, 300)}`);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('beta signup error:', err.message);
    return res.status(500).json({ error: 'Signup failed' });
  }
}
