import { EmailMessage } from "cloudflare:email";

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

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function headerSafe(value, max = 160) {
  return clean(value, max).replace(/[\r\n]+/g, " ");
}

function quotedPrintable(value) {
  return String(value)
    .replace(/=/g, "=3D")
    .replace(/\r?\n/g, "\r\n")
    .replace(/[^\x20-\x7E\r\n]/g, ch =>
      Array.from(new TextEncoder().encode(ch))
        .map(byte => "=" + byte.toString(16).toUpperCase().padStart(2, "0"))
        .join("")
    );
}

function htmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildRawEmail({ name, email, organisation, organisationType, timing, message }) {
  const safeName = headerSafe(name, 120);
  const safeEmail = headerSafe(email, 254);
  const subjectName = headerSafe(organisation || name, 140);
  const subject = `New Hūnuku enquiry — ${subjectName}`;
  const boundary = "hunuku-contact-" + Date.now().toString(36);

  const textBody = [
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

  const htmlBody = `<!doctype html>
<html><body style="font-family:Arial,sans-serif;color:#17231f;line-height:1.5">
  <h2 style="color:#063d30">New Hūnuku website enquiry</h2>
  <table cellpadding="6" cellspacing="0" style="border-collapse:collapse">
    <tr><td><strong>Name</strong></td><td>${htmlEscape(name)}</td></tr>
    <tr><td><strong>Email</strong></td><td><a href="mailto:${htmlEscape(email)}">${htmlEscape(email)}</a></td></tr>
    ${organisation ? `<tr><td><strong>Organisation</strong></td><td>${htmlEscape(organisation)}</td></tr>` : ""}
    ${organisationType ? `<tr><td><strong>Type</strong></td><td>${htmlEscape(organisationType)}</td></tr>` : ""}
    ${timing ? `<tr><td><strong>Timing</strong></td><td>${htmlEscape(timing)}</td></tr>` : ""}
  </table>
  <h3 style="color:#063d30">What they are trying to achieve</h3>
  <p style="white-space:pre-wrap">${htmlEscape(message)}</p>
  <p style="font-size:12px;color:#66706b">Submitted from hunuku.co.nz at ${new Date().toISOString()}</p>
</body></html>`;

  return [
    `From: "Hūnuku Website" <${CONTACT_FROM}>`,
    `To: ${CONTACT_TO}`,
    `Reply-To: "${safeName.replaceAll('"', "'")}" <${safeEmail}>`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    quotedPrintable(textBody),
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    quotedPrintable(htmlBody),
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
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

    try {
      const raw = buildRawEmail({ name, email, organisation, organisationType, timing, message });
      const outbound = new EmailMessage(CONTACT_FROM, CONTACT_TO, raw);
      await env.CONTACT_EMAIL.send(outbound);
      return json({ ok: true });
    } catch (error) {
      console.error("Contact email send failed", error?.code || "", error?.message || error);
      return json({ ok: false, code: "email_delivery" }, 500);
    }
  },
};
