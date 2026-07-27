'use strict';

const fs = require('fs');
const path = require('path');

function escapeCell(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}

function toMarkdown(evaluation) {
  if (!evaluation || typeof evaluation !== 'object') throw new TypeError('evaluation 결과가 필요하다.');
  const lines = [];
  lines.push(`# AI Council 평가 보고서 — ${evaluation.decision}`);
  lines.push('');
  lines.push(`- 총점: **${evaluation.total}/${evaluation.maximum}**`);
  lines.push(`- 합격 기준: **${evaluation.passPolicy.minimumTotal}점 이상 + 모든 치명 게이트 통과**`);
  lines.push(`- 판정: **${evaluation.passed ? '합격' : '불합격'}**`);
  if (evaluation.metadata && evaluation.metadata.scenarioId) lines.push(`- 시나리오: \`${escapeCell(evaluation.metadata.scenarioId)}\``);
  lines.push(`- 생성 시각: ${evaluation.generatedAt}`);
  lines.push('');
  lines.push('## 치명 게이트');
  lines.push('');
  lines.push('| 게이트 | 결과 | 증거/결함 |');
  lines.push('|---|---:|---|');
  for (const gate of evaluation.gates) {
    const details = gate.passed
      ? gate.evidence.join('; ')
      : (gate.failures || gate.findings || gate.evidence).join('; ');
    lines.push(`| ${escapeCell(gate.id)} | ${gate.passed ? 'PASS' : 'FAIL'} | ${escapeCell(details)} |`);
  }
  lines.push('');
  lines.push('## 영역별 점수');
  lines.push('');
  lines.push('| 영역 | 점수 | 비율 |');
  lines.push('|---|---:|---:|');
  for (const category of evaluation.categories) {
    lines.push(`| ${escapeCell(category.id)}. ${escapeCell(category.name)} | ${category.score}/${category.maximum} | ${(category.ratio * 100).toFixed(0)}% |`);
  }
  lines.push('');
  lines.push('## 세부 평가');
  lines.push('');
  lines.push('| 항목 | 점수 | Anchor | 판정 근거 | 증거 |');
  lines.push('|---|---:|---:|---|---|');
  for (const criterion of evaluation.criteria) {
    lines.push(`| ${criterion.id} ${escapeCell(criterion.name)} | ${criterion.score}/${criterion.weight} | ${criterion.anchor} | ${escapeCell(criterion.finding)} | ${escapeCell(criterion.evidence.join('; '))} |`);
  }
  lines.push('');
  lines.push('## 최종 판정 근거');
  lines.push('');
  if (evaluation.reasons.length === 0) {
    lines.push('- 모든 합격 조건을 충족했다.');
  } else {
    for (const reason of evaluation.reasons) lines.push(`- ${reason}`);
  }
  lines.push('');
  return lines.join('\n');
}

function safeBaseName(value) {
  const base = String(value || 'evaluation-report').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return base || 'evaluation-report';
}

function writeReports(evaluation, { outputDir, baseName = 'evaluation-report' } = {}) {
  if (typeof outputDir !== 'string' || outputDir.trim() === '') throw new TypeError('outputDir가 필요하다.');
  const resolved = path.resolve(outputDir);
  fs.mkdirSync(resolved, { recursive: true });
  const base = safeBaseName(baseName);
  const jsonPath = path.join(resolved, `${base}.json`);
  const markdownPath = path.join(resolved, `${base}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(evaluation, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownPath, toMarkdown(evaluation), 'utf8');
  return { jsonPath, markdownPath };
}

module.exports = { toMarkdown, writeReports };
