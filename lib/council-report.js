'use strict';

const fs = require('fs');
const path = require('path');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

function markdownToHtml(value) {
  const lines = String(value || '').replace(/\r\n?/g, '\n').split('\n');
  const output = [];
  let paragraph = [];
  let list = [];
  const inline = (text) => escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const flushParagraph = () => {
    if (paragraph.length) output.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) output.push(`<ul>${list.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`);
    list = [];
  };
  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      output.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
    } else if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
    } else if (!line.trim()) {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return output.join('');
}

function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function advisorMarkdown(item) {
  return [
    `## ${item.label}`,
    '',
    `**Headline:** ${item.response.headline}`,
    '',
    item.response.assessment,
    '',
    `**Recommendation:** ${item.response.recommendation}`,
    '',
    '**Key risks:**',
    ...(item.response.keyRisks || []).map((value) => `- ${value}`),
    '',
    '**Key opportunities:**',
    ...(item.response.keyOpportunities || []).map((value) => `- ${value}`),
    '',
    `**First action:** ${item.response.firstAction}`,
  ].join('\n');
}

function buildTranscript({
  originalQuestion,
  frame,
  advisorResponses,
  anonymousResponses,
  anonymizationMapping,
  peerReviews,
  verdict,
  routing,
  generatedAt,
}) {
  const mapping = Object.entries(anonymizationMapping)
    .map(([letter, advisor]) => `- Response ${letter}: ${advisor}`)
    .join('\n');
  return [
    '# LLM Council Transcript',
    '',
    `Generated: ${generatedAt}`,
    '',
    '## Original Question',
    '',
    originalQuestion,
    '',
    '## Neutral Decision Frame',
    '',
    '```json',
    JSON.stringify(frame, null, 2),
    '```',
    '',
    '# Independent Advisor Analyses',
    '',
    ...advisorResponses.flatMap((item) => [advisorMarkdown(item), '']),
    '# Anonymization Mapping',
    '',
    mapping,
    '',
    '# Anonymized Responses Presented to Reviewers',
    '',
    ...anonymousResponses.flatMap((item) => [
      `## Response ${item.responseId}`,
      '',
      item.assessment,
      '',
      `Recommendation: ${item.recommendation}`,
      '',
    ]),
    '# Peer Reviews',
    '',
    ...peerReviews.flatMap((item) => [
      `## Reviewer ${item.reviewer}`,
      '',
      `- Strongest: Response ${item.strongestResponse} — ${item.strongestWhy}`,
      `- Biggest blind spot: Response ${item.biggestBlindSpotResponse} — ${item.biggestBlindSpot}`,
      `- What all five missed: ${item.allMissed}`,
      '',
    ]),
    '# Chairman Synthesis',
    '',
    verdict.planMarkdown,
    '',
    '# Model Routing Audit',
    '',
    `- Calls: ${routing?.totals?.calls || 0}`,
    `- Fallbacks: ${routing?.fallbackCount || 0}`,
    `- Input tokens: ${routing?.totals?.inputTokens || 0}`,
    `- Output tokens: ${routing?.totals?.outputTokens || 0}`,
    `- Recorded cost (USD): ${Number(routing?.totals?.costUsd || 0).toFixed(6)}`,
    '',
    ...(routing?.latest || []).map((item) => (
      `- ${item.role}: ${item.brain}/${item.model} · effort ${item.effort}`
      + `${item.routeIndex ? ` · fallback ${item.routeIndex}` : ''}`
    )),
    '',
  ].join('\n');
}

function buildHtml({
  originalQuestion,
  frame,
  advisorResponses,
  peerReviews,
  verdict,
  routing,
  generatedAt,
}) {
  const advisorCards = advisorResponses.map((item) => `
    <details>
      <summary><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.response.headline)}</strong></summary>
      <div class="detail-body">${markdownToHtml(item.response.assessment)}</div>
      <p><b>Recommendation:</b> ${escapeHtml(item.response.recommendation)}</p>
      <div class="risk-opportunity">
        <div><b>Key risks</b><ul>${(item.response.keyRisks || []).map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul></div>
        <div><b>Key opportunities</b><ul>${(item.response.keyOpportunities || []).map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul></div>
      </div>
      <p><b>First action:</b> ${escapeHtml(item.response.firstAction)}</p>
    </details>`).join('');
  const reviews = peerReviews.map((item) => `
    <li><b>${escapeHtml(item.reviewer)}</b>: strongest ${escapeHtml(item.strongestResponse)};
      blind spot ${escapeHtml(item.biggestBlindSpotResponse)}; all missed — ${escapeHtml(item.allMissed)}</li>`).join('');
  const positionGrid = advisorResponses.map((item) => `
    <article><span>${escapeHtml(item.label)}</span><p>${escapeHtml(item.response.recommendation)}</p></article>`).join('');
  const routeRows = (routing?.latest || []).map((item) => `
    <tr><td>${escapeHtml(item.role)}</td><td>${escapeHtml(item.brain)}</td><td>${escapeHtml(item.model)}</td>
    <td>${escapeHtml(item.effort)}</td><td>${item.routeIndex ? `Fallback ${Number(item.routeIndex)}` : 'Primary'}</td></tr>`).join('');
  const totals = routing?.totals || {};
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(verdict.title)}</title>
<style>
:root{color-scheme:light;--ink:#132033;--muted:#607087;--line:#dce4ee;--accent:#174f78;--soft:#f4f7fa}
*{box-sizing:border-box}body{margin:0;background:#eef2f6;color:var(--ink);font:15px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1100px;margin:0 auto;padding:48px 24px 80px}.hero,.card,details{background:white;border:1px solid var(--line);border-radius:14px}
.hero{padding:36px;margin-bottom:20px}.eyebrow{margin:0;color:var(--accent);font-weight:800;letter-spacing:.08em;text-transform:uppercase}
h1{font-size:clamp(28px,4vw,46px);line-height:1.12;margin:10px 0 16px}h2{margin-top:0}.question{color:var(--muted)}
.verdict{padding:28px;border-left:6px solid var(--accent)}.verdict p{margin:.5em 0}.grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin:20px 0}
.grid article{background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:14px}.grid span{font-size:12px;font-weight:800;color:var(--accent)}
.grid p{font-size:13px;margin:8px 0 0}section{margin-top:24px}.card{padding:24px}details{margin:10px 0;padding:0 18px}
summary{cursor:pointer;display:grid;gap:4px;padding:16px 0}summary span{color:var(--accent);font-weight:800}.detail-body{border-top:1px solid var(--line);padding-top:14px}
.confidence{display:inline-flex;padding:6px 10px;border-radius:999px;background:var(--soft);font-size:12px;font-weight:800}.risk-opportunity{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.metrics{display:flex;gap:8px;flex-wrap:wrap}.metrics span{padding:8px 10px;border-radius:999px;background:var(--soft);font-size:12px}
table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:8px;text-align:left;border-bottom:1px solid var(--line)}
footer{color:var(--muted);margin-top:32px;font-size:13px}@media(max-width:800px){.grid,.risk-opportunity{grid-template-columns:1fr}.hero{padding:24px}table{display:block;overflow-x:auto}}
@media print{body{background:white}main{max-width:none;padding:0}.hero,.card,details{break-inside:avoid}.hero{border:0;padding:0 0 20px}.verdict{border:1px solid var(--line);border-left:6px solid var(--accent)}}
</style>
</head>
<body><main>
  <header class="hero">
    <p class="eyebrow">LLM Council Verdict</p>
    <h1>${escapeHtml(verdict.title)}</h1>
    <p class="question">${escapeHtml(originalQuestion)}</p>
    <span class="confidence">Confidence · ${escapeHtml(verdict.confidence)}</span>
  </header>
  <section class="card verdict">${markdownToHtml(verdict.planMarkdown)}</section>
  <section>
    <h2>Advisor position map</h2>
    <div class="grid">${positionGrid}</div>
  </section>
  <section><h2>Independent analyses</h2>${advisorCards}</section>
  <section class="card">
    <h2>Peer-review highlights</h2>
    <ul>${reviews}</ul>
  </section>
  <section class="card">
    <h2>Model routing & usage</h2>
    <div class="metrics">
      <span>Calls <b>${Number(totals.calls) || 0}</b></span>
      <span>Fallbacks <b>${Number(routing?.fallbackCount) || 0}</b></span>
      <span>Input tokens <b>${Number(totals.inputTokens || 0).toLocaleString()}</b></span>
      <span>Output tokens <b>${Number(totals.outputTokens || 0).toLocaleString()}</b></span>
      <span>Recorded cost <b>$${Number(totals.costUsd || 0).toFixed(6)}</b></span>
    </div>
    <table><thead><tr><th>Role</th><th>Provider</th><th>Model</th><th>Effort</th><th>Route</th></tr></thead>
      <tbody>${routeRows}</tbody></table>
  </section>
  <section class="card">
    <h2>Neutral frame</h2>
    <p><b>Decision:</b> ${escapeHtml(frame.decision)}</p>
    <p><b>Stakes:</b> ${escapeHtml(frame.stakes)}</p>
  </section>
  <footer>Generated ${escapeHtml(generatedAt)} · Five independent perspectives · Anonymous peer review · Chairman synthesis</footer>
</main></body></html>`;
}

function writeCouncilReport({
  dataDir,
  sessionId,
  originalQuestion,
  frame,
  advisorResponses,
  anonymousResponses,
  anonymizationMapping,
  peerReviews,
  verdict,
  routing,
  generatedAt = new Date().toISOString(),
}) {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(String(sessionId))) throw new Error('Unsafe council report session id.');
  const directory = path.join(dataDir, 'council-artifacts', sessionId);
  fs.mkdirSync(directory, { recursive: true });
  const slug = timestampSlug(new Date(generatedAt));
  const htmlName = `council-report-${slug}.html`;
  const transcriptName = `council-transcript-${slug}.md`;
  fs.writeFileSync(path.join(directory, htmlName), buildHtml({
    originalQuestion, frame, advisorResponses, peerReviews, verdict, routing, generatedAt,
  }), 'utf8');
  fs.writeFileSync(path.join(directory, transcriptName), buildTranscript({
    originalQuestion,
    frame,
    advisorResponses,
    anonymousResponses,
    anonymizationMapping,
    peerReviews,
    verdict,
    routing,
    generatedAt,
  }), 'utf8');
  return {
    generatedAt,
    html: {
      name: htmlName,
      url: `/api/council/artifacts/${encodeURIComponent(htmlName)}`,
    },
    transcript: {
      name: transcriptName,
      url: `/api/council/artifacts/${encodeURIComponent(transcriptName)}`,
    },
  };
}

module.exports = {
  buildHtml,
  buildTranscript,
  writeCouncilReport,
};
