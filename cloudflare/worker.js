// Hardened HUNUKU contact Worker (stage 1). Deploy in Cloudflare editor after review.\n// Preserves CONTACT_EMAIL and ASSETS bindings. Turnstile/rate limiting require separate configuration.
// Email Service binding: CONTACT_EMAIL; Assets binding: ASSETS.
const CONTACT_TO = "hunuku@outlook.co.nz";
const CONTACT_FROM = "website@hunuku.co.nz";
const ALLOWED_ORIGINS = new Set(["https://www.hunuku.co.nz", "https://hunuku.co.nz"]);
const jsonHeaders = {"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:jsonHeaders});}
function clean(value,max=500){
  if(value==null) return "";
  if(typeof value!=="string" || value.length>max) throw new Error("invalid_field");
  return value.trim();
}
function bounded(value,max){return typeof value==="string"&&value.length<=max;}
function validBody(body){
  if(!body||typeof body!=="object"||Array.isArray(body)) return false;
  return bounded(body.name,120)&&bounded(body.email,254)&&bounded(body.message,4000)&&
    bounded(body.website??"",200)&&bounded(body.organisation??"",160)&&
    bounded(body.organisationType??"",120)&&bounded(body.timing??"",120);
}
function escapeHtml(value){return String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
function validEmail(value){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)&&value.length<=254;}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname!=="/api/contact") return env.ASSETS.fetch(request);
    if(request.method==="GET") return json({ok:false,code:"method_not_allowed"},405);
    if(request.method!=="POST") return json({ok:false,code:"method_not_allowed"},405);
    const origin=request.headers.get("Origin");
    if(!origin||!ALLOWED_ORIGINS.has(origin)) return json({ok:false,code:"origin_not_allowed"},403);
    const contentType=request.headers.get("Content-Type")||"";
    if(!/^application\/json(?:\s*;|\s*$)/i.test(contentType)) return json({ok:false,code:"content_type"},415);
    const declaredLength=Number(request.headers.get("Content-Length")||0);
    if(!Number.isFinite(declaredLength)||declaredLength>8192) return json({ok:false,code:"too_large"},413);
    let body;
    try {
      // Read a bounded stream: Content-Length can be missing or misleading.
      if(!request.body) return json({ok:false,code:"invalid_json"},400);
      const reader=request.body.getReader(); const chunks=[]; let size=0;
      while(true){
        const {done,value}=await reader.read();
        if(done) break;
        size+=value.byteLength;
        if(size>8192){await reader.cancel();return json({ok:false,code:"too_large"},413);}
        chunks.push(value);
      }
      const bytes=new Uint8Array(size);let offset=0;
      for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      body=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
    } catch {return json({ok:false,code:"invalid_json"},400);}
    if(!validBody(body)) return json({ok:false,code:"validation"},400);
    if(clean(body.website,200)) return json({ok:true});
    const name=clean(body.name,120),email=clean(body.email,254),organisation=clean(body.organisation,160),organisationType=clean(body.organisationType,120),timing=clean(body.timing,120),message=clean(body.message,4000);
    if(!name||!validEmail(email)||!message) return json({ok:false,code:"validation"},400);
    if(!env.CONTACT_EMAIL) return json({ok:false,code:"binding_missing"},500);
    const subjectSuffix=(organisation||name).replace(/[\r\n\u0000-\u001f\u007f]/g," ").slice(0,100);
    const subject=`New Hūnuku enquiry - ${subjectSuffix}`;
    const text=["New enquiry from hunuku.co.nz","",`Name: ${name}`,`Email: ${email}`,organisation?`Organisation or group: ${organisation}`:null,organisationType?`Organisation type: ${organisationType}`:null,timing?`When they want to start: ${timing}`:null,"","What they are trying to achieve:",message,"",`Submitted: ${new Date().toISOString()}`].filter(Boolean).join("\n");
    const html=`<!doctype html><html><body style="font-family:Arial,sans-serif;color:#17231f;line-height:1.5">
<h2 style="color:#063d30">New Hūnuku website enquiry</h2>
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse">
<tr><td><strong>Name</strong></td><td>${escapeHtml(name)}</td></tr>
<tr><td><strong>Email</strong></td><td><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td></tr>
${organisation?`<tr><td><strong>Organisation</strong></td><td>${escapeHtml(organisation)}</td></tr>`:""}
${organisationType?`<tr><td><strong>Type</strong></td><td>${escapeHtml(organisationType)}</td></tr>`:""}
${timing?`<tr><td><strong>Timing</strong></td><td>${escapeHtml(timing)}</td></tr>`:""}
</table><h3 style="color:#063d30">What they are trying to achieve</h3>
<p style="white-space:pre-wrap">${escapeHtml(message)}</p>
<p style="font-size:12px;color:#66706b">Submitted from hunuku.co.nz at ${new Date().toISOString()}</p>
</body></html>`;
    try{
      await env.CONTACT_EMAIL.send({to:CONTACT_TO,from:{email:CONTACT_FROM,name:"Hunuku Website"},replyTo:{email,name},subject,text,html});
      return json({ok:true});
    }catch(error){
      console.error("Contact email send failed",String(error?.code||"unknown"));
      return json({ok:false,code:"email_delivery"},500);
    }
  }
};
