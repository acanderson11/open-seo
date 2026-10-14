import { articlePassages } from "@/types/schemas/articlePassages";
import { feedbackFields } from "@/types/schemas/contentFeedback";
import { z } from "zod";
import { loadPrivateReview, decidePrivateReview } from "./DraftReviewService";
import { featuredImageData } from "./FeaturedImageService";
const headers = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow",
};
const bodySchema = z.object({
  token: z.string().length(72),
  feedback: feedbackFields.optional(),
  decision: z.enum(["approved", "changes_requested"]).optional(),
});
export async function handlePrivateReview(request: Request) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/review") {
    const nonce = crypto.randomUUID();
    return new Response(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Review article · AND MKTG</title><style nonce="${nonce}">body{font:17px/1.65 system-ui;margin:0;background:#f5f5f4;color:#202023}main{max-width:800px;margin:40px auto;padding:28px;background:white;border-radius:12px}button{padding:12px 20px;margin:8px;border:0;border-radius:6px;cursor:pointer;background:#202023;color:white}button:disabled{opacity:.4}#status{padding:14px}article{overflow-wrap:anywhere}article details{margin:8px 0 20px;padding:8px 12px;border-left:2px solid #ddd}article section{position:relative;padding-right:42px}article summary{position:absolute;right:0;top:8px;cursor:pointer;font-size:24px;line-height:32px;width:32px;text-align:center;list-style:none}article summary::-webkit-details-marker{display:none}article details:not([open]){border:0;padding:0;margin:0}label{display:block;margin:12px 0}textarea,select{display:block;box-sizing:border-box;width:100%;padding:12px;border:1px solid #999;border-radius:6px;font:inherit}main{box-sizing:border-box}@media(max-width:600px){main{margin:0;padding:20px;border-radius:0}button{margin-left:0}}header{border-bottom:1px solid #ddd}</style></head><body><main><header><strong>AND MKTG · Article review</strong><h1 id="title">Loading your draft…</h1></header><p id="reason"></p><article id="article"></article><p id="status" role="status"></p><div id="actions" hidden><p id="delivery"></p><label>Overall feedback (optional)<textarea id="feedback" maxlength="4000" rows="4" placeholder="Use this for changes that apply to the whole article."></textarea></label><label>Use this feedback for<select id="scope"><option value="article">This article only</option><option value="preference">A lasting writing preference</option><option value="fact">A business fact correction (requires verification)</option></select></label><div id="lasting" hidden><label>Lasting instruction or factual correction<textarea id="instruction" maxlength="1000" rows="2"></textarea></label><label>Category<select id="category"><option value="voice">Voice and tone</option><option value="structure">Article structure</option><option value="terminology">Words and terminology</option></select></label><p>Overlapping guidance and factual corrections will be checked by the agency before becoming standing instructions.</p></div><button id="approve">Approve article</button><button id="changes">Request changes</button></div></main><script nonce="${nonce}">
 const token=location.hash.slice(1);const status=document.getElementById('status');const buttons=[...document.querySelectorAll('button')];let passages=[];
 function showPassages(blocks){const article=document.getElementById('article');article.replaceChildren();for(const block of blocks){const section=document.createElement('section');const content=document.createElement('div');content.innerHTML=block.html;section.append(content);const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='+';summary.title='Add comment';summary.setAttribute('aria-label','Add comment to passage '+(block.index+1));details.append(summary);const label=document.createElement('label');label.textContent='What should change in this passage?';const input=document.createElement('textarea');input.maxLength=1500;input.rows=2;input.oninput=()=>{passages=passages.filter(p=>p.blockIndex!==block.index);if(input.value.trim())passages.push({blockIndex:block.index,quote:block.quote,message:input.value.trim()});};label.append(input);details.append(label);section.append(details);article.append(section);}}

 function showImage(data){const old=document.getElementById('featured-image');if(old)old.remove();const figure=document.createElement('figure');figure.id='featured-image';figure.style.cssText='margin:24px 0';if(data.featuredImage?.base64){const image=document.createElement('img');image.src='data:image/webp;base64,'+data.featuredImage.base64;image.alt=data.featuredImage.altText||'Featured image awaiting alt text';image.style.cssText='display:block;width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;border-radius:8px';figure.append(image);const caption=document.createElement('figcaption');caption.textContent='Featured image · '+(data.featuredImage.altText||'Alt text awaiting agency review');figure.append(caption);}else{const note=document.createElement('p');note.textContent=data.imageStatus==='failed'?'Featured image generation failed. The agency can replace it before approval.':'No featured image is attached to this draft.';figure.append(note);}document.getElementById('article').before(figure);}
 document.getElementById('scope').onchange=()=>{document.getElementById('lasting').hidden=document.getElementById('scope').value==='article';};
 async function send(decision){const feedback={passages,message:document.getElementById('feedback').value.trim(),scope:document.getElementById('scope').value,category:document.getElementById('category').value,instruction:document.getElementById('instruction').value.trim()};if(decision==='changes_requested'&&((!feedback.message&&!passages.length)||(feedback.scope!=='article'&&!feedback.instruction))){status.textContent='Please explain the change and add a lasting instruction if selected.';return;}if(decision==='approved'&&(feedback.message||feedback.instruction||passages.length)){status.textContent='Choose Request changes to send your feedback before approving.';return;}const combined=[feedback.message,...passages.map(p=>'Passage '+(p.blockIndex+1)+': “'+p.quote+'”\\nRequested change: '+p.message)].filter(Boolean).join('\\n\\n');if(combined.length>4000){status.textContent='Keep the combined feedback and quoted passages under 4,000 characters.';return;}buttons.forEach(b=>b.disabled=true);try{const res=await fetch('/review/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,...(decision?{decision,...(decision==='changes_requested'?{feedback}:{})}:{})})});const data=await res.json();if(!res.ok)throw Error(data.message);if(decision){status.textContent=data.message;document.getElementById('actions').hidden=true;document.querySelectorAll('textarea').forEach(t=>t.disabled=true);}else{document.getElementById('title').textContent=data.title;document.getElementById('reason').textContent=(data.rationale||'')+' · Version '+data.version;showPassages(data.passages);showImage(data);document.getElementById('delivery').textContent=data.delivery==='wordpress'?'Approval authorizes publishing this exact draft to this project’s connected WordPress site.':'Approval makes this draft ready for manual copy/paste. Nothing is published automatically.';document.getElementById('approve').textContent=data.delivery==='wordpress'?'Approve and publish':'Approve for manual publishing';document.getElementById('actions').hidden=false;buttons.forEach(b=>b.disabled=false);}}catch{status.textContent='This link is expired, already used, or the draft has changed. Please contact your agency.';}}
 document.getElementById('approve').onclick=()=>send('approved');document.getElementById('changes').onclick=()=>send('changes_requested');send();
 </script></body></html>`,
      {
        headers: {
          ...headers,
          "content-type": "text/html;charset=utf-8",
          "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        },
      },
    );
  }
  if (request.method !== "POST" || url.pathname !== "/review/api")
    return new Response("Not found", { status: 404, headers });
  if (
    request.headers.get("origin") !== url.origin ||
    !request.headers.get("content-type")?.startsWith("application/json")
  )
    return new Response("Forbidden", { status: 403, headers });
  try {
    const reader = request.body?.getReader();
    if (!reader) throw Error();
    let size = 0,
      text = "";
    const decoder = new TextDecoder();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 24000) throw Error();
        text += decoder.decode(chunk.value, { stream: true });
      }
    } finally {
      await reader.cancel();
    }
    const body = bodySchema.parse(JSON.parse(text + decoder.decode()));
    if (body.decision)
      return Response.json(
        await decidePrivateReview(body.token, body.decision, body.feedback),
        { headers },
      );
    const { job, delivery } = await loadPrivateReview(body.token);
    const visual = await featuredImageData(job.projectId, job.id);
    return Response.json(
      {
        delivery,
        title: job.title ?? job.topic,
        rationale: job.rationale,
        bodyHtml: job.bodyHtml,
        passages: articlePassages(job.bodyHtml ?? ""),
        version: job.version,
        featuredImage: visual.image
          ? { base64: visual.base64, altText: visual.image.altText }
          : null,
        imageStatus: visual.latestAttempt?.status ?? "missing",
      },
      { headers },
    );
  } catch {
    return Response.json(
      { message: "Review unavailable" },
      { status: 403, headers },
    );
  }
}
