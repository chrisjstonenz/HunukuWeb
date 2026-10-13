const CONTACT_TO = "hunuku@outlook.co.nz";
const CONTACT_FROM = "website@hunuku.co.nz";
const ALLOWED_ORIGINS = new Set([
  "https://www.hunuku.co.nz",
  "https://hunuku.co.nz",
]);

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== "/api/contact") {
      return env.ASSETS.fetch(request);
    }

    if (request.method !== "POST") {
      return json({ ok: false }, 405);
    }

    const origin = request.headers.get("Origin");
    if (origin && !ALLOWED_ORIGINS.has(origin) && !origin.endsWith(".workers.dev")) {
      return json({ ok: false }, 403);
    }

    const contentType = request.headers.get("Content-Type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return json({ ok: false }, 415);
    }

    const declaredLength = Number(request.headers.get("Content-Length") || 0);
    if (declaredLength > 20_000) {
      return json({ ok: false }, 413);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false }, 400);
    }

    // Honeypot: pretend success so bots do not learn how the form is protected.
    if (clean(body.website, 200)) {
      return json({ ok: true });
    }

    const name = clean(body.name, 120);
    const email = clean(body.email, 254);
    const organisation = clean(body.organisation, 160);
    const organisationType = clean(body.organisationType, 120);
    const timing = clean(body.timing, 120);
    const message = clean(body.message, 5000);

    if (!name || !validEmail(email) || !message) {
      return json({ ok: false }, 400);
    }

    const subjectSuffix = organisation || name;
    const subject = `New Hūnuku enquiry — ${subjectSuffix}`;

    const text = [
      "New enquiry from hunuku.co.nz",
      "",
      `Name: ${name}`,
      `Email: ${email}`,
      organisation ? `Organisation or group: ${organisation}` : null,
      organisationType ? `Organisation type: ${organisationType}` : null,
      timing ? `When they want to start: ${timing}` : null,
      "",
      "What they are trying to achieve:",
      message,
      "",
      `Submitted: ${new Date().toISOString()}`,
    ].filter(Boolean).join("\n");

    const html = `<!doctype html>
<html><body style="font-family:Arial,sans-serif;color:#17231f;line-height:1.5">
  <h2 style="color:#063d30">New Hūnuku website enquiry</h2>
  <table cellpadding="6" cellspacing="0" style="border-collapse:collapse">
    <tr><td><strong>Name</strong></td><td>${escapeHtml(name)}</td></tr>
    <tr><td><strong>Email</strong></td><td><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td></tr>
    ${organisation ? `<tr><td><strong>Organisation</strong></td><td>${escapeHtml(organisation)}</td></tr>` : ""}
    ${organisationType ? `<tr><td><strong>Type</strong></td><td>${escapeHtml(organisationType)}</td></tr>` : ""}
    ${timing ? `<tr><td><strong>Timing</strong></td><td>${escapeHtml(timing)}</td></tr>` : ""}
  </table>
  <h3 style="color:#063d30">What they are trying to achieve</h3>
  <p style="white-space:pre-wrap">${escapeHtml(message)}</p>
  <p style="font-size:12px;color:#66706b">Submitted from hunuku.co.nz at ${new Date().toISOString()}</p>
</body></html>`;

    try {
      await env.CONTACT_EMAIL.send({
        to: CONTACT_TO,
        from: { email: CONTACT_FROM, name: "Hūnuku Website" },
        replyTo: { email, name },
        subject,
        text,
        html,
      });
      return json({ ok: true });
    } catch (error) {
      console.error("Contact email send failed", error?.code || "", error?.message || error);
      return json({ ok: false }, 500);
    }
  },
};
