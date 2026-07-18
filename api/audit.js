// api/audit.js — Vercel serverless function
// Two actions: 'analyze' (calls Claude) and 'subscribe' (stores the lead).
// No npm dependencies: uses fetch + Supabase REST directly, so this project
// needs no package.json and no build step.

const MODEL = 'claude-sonnet-4-6';

const SYSTEM = `You are the O.R.A. Time Inversion Audit — a diagnostic instrument, not a coach and not a cheerleader.

O.R.A. (Outcome Realisation Architecture) holds that people fall into the Activity Trap: they feel productive through busyness while making no progress toward the outcome they actually want. Failure is ARCHITECTURAL, never personal. You audit the system. You never shame the person.

The Value Leak taxonomy — activities producing noise rather than outcomes:
- Comfort Leak: feels restorative but isn't. Scrolling, passive TV, distraction loops. The tell: they finish it more tired than they started.
- Obligation Leak: commitments taken on to manage other people's feelings, not to produce outcomes.
- Preparation Leak: research, planning, organising, optimising that substitutes for execution. The most insidious, because it looks exactly like progress.
- Identity Leak: activities maintained because of who they used to be, not who they're becoming.

CRITICAL COUNTERWEIGHT: not all leaks should be plugged. Legitimate Non-Optimised Time — rest, relationships, joy, play — must be protected, never audited. If the person's evidence contains something that is genuinely restorative or genuinely about the people they love, name it and explicitly defend it. This is not optional. An audit that tries to optimise a person's whole life has misunderstood the framework.

TONE: direct, precise, unsentimental, warm underneath. Second person. Short sentences. No hedging, no therapy voice, no exclamation marks, no praise for "being honest". You are showing someone a measurement, not delivering a verdict on their worth.

Return ONLY valid JSON. No preamble, no markdown fences, no commentary.

{
  "evidenced_outcome": "One or two sentences. What an outsider would conclude they were optimising for, based purely on where the hours went. Blunt and specific to their words. Not cruel.",
  "gap": "One sentence naming the distance between the stated outcome and the evidenced one. If there is genuinely no gap, say so plainly — do not manufacture a problem.",
  "leaks": [
    {
      "type": "Comfort | Obligation | Preparation | Identity",
      "evidence": "The specific thing THEY said, paraphrased in a short phrase. Never invent evidence they did not give.",
      "note": "One sentence. What this is actually doing for them, and what it is costing. Architectural, not moralising."
    }
  ],
  "protect": "One or two sentences. Something in their evidence that is legitimate non-optimised time and should NOT be touched. If nothing in their answer qualifies, say that directly and tell them that absence is itself the finding — a life with no protected time is not an optimised life, it is a brittle one.",
  "question": "The single uncomfortable question they are avoiding. Under 20 words. Direct. This is the thing they will still be thinking about tomorrow."
}

Identify 1-3 leaks. Only what the evidence actually supports. Two real leaks beat four invented ones.`;

async function analyze(stated, actual) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1200,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `STATED OUTCOME (what they say they're building):\n${stated}\n\nEVIDENCE (where the last 30 days actually went):\n${actual}`
      }]
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .replace(/```json|```/g, '')
    .trim();

  return JSON.parse(text);
}

async function subscribe({ email, consent, audit }) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env vars missing');

  const res = await fetch(`${url}/rest/v1/audit_leads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({
      email: email.toLowerCase(),
      consent: !!consent,
      stated_outcome: audit?.stated || null,
      evidence: audit?.actual || null,
      audit_result: audit?.result || null,
      source: 'audit.jeffchandler.com.au'
    })
  });

  // 23505 = unique violation. Already on the list is a success, not an error.
  if (!res.ok && res.status !== 409) {
    const body = await res.text();
    if (!body.includes('23505')) throw new Error(`Supabase ${res.status}: ${body.slice(0, 300)}`);
  }

  // Optional: actually deliver the email. Skipped cleanly if Resend isn't configured.
  if (process.env.RESEND_API_KEY && audit?.result) {
    await sendEmail(email, audit).catch(e => console.error('Email send failed:', e.message));
  }
}

async function sendEmail(email, audit) {
  const r = audit.result;
  const leaks = (r.leaks || [])
    .map(l => `<p style="border-left:2px solid #F5A623;padding-left:14px;margin:0 0 18px">
        <strong style="font-family:monospace;font-size:12px;letter-spacing:1px;color:#B8791A;text-transform:uppercase">${esc(l.type)} Leak</strong><br>
        <em style="color:#4A5568">${esc(l.evidence)}</em><br>${esc(l.note)}</p>`)
    .join('');

  const html = `<div style="font-family:-apple-system,Segoe UI,Inter,sans-serif;max-width:560px;margin:0 auto;color:#0D1B2A;line-height:1.6">
    <p style="font-family:monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#F5A623">The Time Inversion Audit</p>

    <p>You asked for the measurement, so here it is. Read it once — then go and look at your calendar.</p>

    <p><strong>What you said you were building</strong><br>${esc(audit.stated)}</p>
    <p><strong>What the evidence says you were building</strong><br>${esc(r.evidenced_outcome)}</p>
    <p>${esc(r.gap)}</p>
    <hr style="border:0;border-top:1px solid #E2E8F0;margin:28px 0">
    <p style="font-family:monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#4A5568">Leak map</p>
    ${leaks}
    <hr style="border:0;border-top:1px solid #E2E8F0;margin:28px 0">
    <p style="font-family:monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#4A5568">Do not audit this</p>
    <p>${esc(r.protect)}</p>
    <p style="font-size:20px;font-weight:600;margin-top:28px">${esc(r.question)}</p>

    <hr style="border:0;border-top:1px solid #E2E8F0;margin:28px 0">

    <p>Nothing here is a character flaw. It's architecture — which means it's fixable. That's the whole point.</p>
    <p>Here's the thinking behind it. Most productivity advice tries to make you a better manager of your time — more discipline, more willpower, more doing. <strong>O.R.A. (Outcome Realisation Architecture) does the opposite. You don't need a manager. You need an architect.</strong> Willpower runs out; architecture doesn't.</p>
    <p>It runs as a loop, in four stages:</p>

    <div style="margin:18px 0 22px">
      <p style="margin:0 0 12px"><strong style="font-family:monospace;font-size:12px;letter-spacing:1px;color:#B8791A;text-transform:uppercase">Define</strong> — Name the outcome you actually want. The honest one, not the socially acceptable one.</p>
      <p style="margin:0 0 12px"><strong style="font-family:monospace;font-size:12px;letter-spacing:1px;color:#B8791A;text-transform:uppercase">Design</strong> — Engineer your environment so the right move becomes the path of least resistance.</p>
      <p style="margin:0 0 12px"><strong style="font-family:monospace;font-size:12px;letter-spacing:1px;color:#B8791A;text-transform:uppercase">Deliver</strong> — Run the smallest version of the system that still moves the needle — even on your worst week.</p>
      <p style="margin:0"><strong style="font-family:monospace;font-size:12px;letter-spacing:1px;color:#B8791A;text-transform:uppercase">Verify</strong> — Each week, audit the architecture, not yourself. "Where did the system fail?" — never "Why did I fail?"</p>
    </div>

    <p>The audit you just ran is the diagnosis — it shows you the gap. The tool I'm building runs the loop that closes it.</p>

    <div style="background:#0D1B2A;color:#F0F4F8;border-radius:10px;padding:24px 22px;margin:24px 0">
      <p style="font-family:monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#F5A623;margin:0 0 12px">Be one of the first</p>
      <p style="margin:0 0 18px;color:#F0F4F8">I want real people using this before I trust it. I'm opening it to a small group of beta testers — <strong>no cost, no commitment</strong>, and you can walk away whenever.</p>
      <p style="margin:0"><a href="https://ora-audit.vercel.app/beta" style="display:inline-block;background:#F5A623;color:#0D1B2A;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px">Learn more &amp; join the beta →</a></p>
    </div>

    <p>— Jeff</p>

    <hr style="border:0;border-top:1px solid #E2E8F0;margin:28px 0">
    <p style="font-size:12px;color:#4A5568">You're getting this because you ran the Time Inversion Audit and asked for your results.
    <a href="{{unsubscribe}}" style="color:#4A5568">Unsubscribe</a>.</p>
  </div>`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: 'Jeff Chandler <audit@jeffchandler.com.au>',
      to: [email],
      subject: 'Your Time Inversion Audit',
      html
    })
  });
}

const esc = s => String(s || '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { action } = req.body || {};

    if (action === 'analyze') {
      const { stated, actual } = req.body;
      if (!stated || !actual) return res.status(400).json({ error: 'Missing input' });
      const result = await analyze(String(stated).slice(0, 4000), String(actual).slice(0, 6000));
      return res.status(200).json(result);
    }

    if (action === 'subscribe') {
      const { email, consent, audit } = req.body;
      if (!email || !consent) return res.status(400).json({ error: 'Email and consent required' });
      await subscribe({ email: String(email).slice(0, 320), consent, audit });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('audit error:', err.message);
    return res.status(500).json({ error: 'Audit failed' });
  }
}
