/** Report evidence interface: inspect, retrieve, export, ask. No generated code is executed. */
import fs from 'node:fs/promises';
import { db } from '../config/database.js';
import { resolveUploadPath } from '../config/runtime_paths.js';
import { OllamaService } from './ollama_service.js';

export function searchEvidence(report, query, limit = 12) {
  const tokens = [...new Set(String(query).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [])]
    .filter(t => !['what', 'the', 'and', 'are', 'for', 'this', 'with', 'from', 'does', 'how', 'was', 'report'].includes(t));
  if (!tokens.length) return [];
  const passages = [];
  for (const page of report.pages) {
    const text = [page.native_text, page.layout_text].filter(Boolean).join('\n');
    const lines = text.split(/\r?\n/);
    for (let start = 0; start < lines.length; start += 14) {
      const excerpt = lines.slice(Math.max(0, start - 2), start + 18).join('\n').slice(0, 5000);
      const lower = excerpt.toLowerCase();
      const score = tokens.reduce((n, t) => n + (lower.includes(t) ? 1 : 0), 0);
      if (score) passages.push({id: `p${page.page_number}-l${start}`, page: page.page_number, section: page.section, text: excerpt, score});
    }
  }
  for (const table of report.tables || []) {
    const text = JSON.stringify({headers: table.original_headers || table.headers, cells: table.cells || table.rows});
    const lower = text.toLowerCase();
    const score = tokens.reduce((n, t) => n + (lower.includes(t) ? 1 : 0), 0);
    if (score) passages.push({id: table.table_id, page: table.page_number, text: text.slice(0, 6000), score});
  }
  return passages.sort((a, b) => b.score - a.score || a.page - b.page).slice(0, Math.min(30, limit));
}

/** Deterministic column selection for radius questions; no model guesses table position. */
export function answerRadiusQuestion(report, question) {
  const radius = question.toLowerCase().replace(/three/g, '3').replace(/one/g, '1').replace(/five/g, '5').match(/\b(\d+(?:\.\d+)?)[ -]?(?:mile|mi)\b/);
  if (!radius) return null;
  const labels = [
    ['median household income', /median (?:household|hh) income/i, /^median (?:household|hh) income$/i],
    ['median home value', /median home value/i, /^median home value$/i],
    ['population growth', /pop(?:ulation)? growth/i, /^pop(?:ulation)? growth/i],
    ['household growth', /household growth/i, /^household growth/i],
    ['population', /population/i, /^\d{4} population$/i],
    ['households', /households/i, /^\d{4} households$/i],
    ['average age', /average age/i, /^\d{4} average age$/i],
    ['average household size', /average (?:household|hh) size/i, /^average (?:household|hh) size$/i],
    ['median year built', /median year built/i, /^median year built$/i],
  ];
  const metric = labels.find(([, pattern]) => pattern.test(question));
  if (!metric) return null;
  const requestedYears = question.match(/\b(?:19|20)\d{2}\b/g) || [];
  const matches = [];
  for (const table of report.tables || []) {
    const headers = table.original_headers || table.headers || [];
    const indexes = headers.map((h, i) => new RegExp(`^${radius[1].replace('.', '\\.')}[ -]*Miles?$`, 'i').test(String(h).trim()) ? i : -1).filter(i => i >= 0);
    if (indexes.length !== 1) continue;
    for (const row of table.cells || []) {
      if (!metric[2].test(String(row[0]).trim()) || requestedYears.some(year => !String(row[0]).includes(year))) continue;
      const value = String(row[indexes[0]] ?? '').trim();
      if (!value || ['-', '—', 'N/A'].includes(value.toUpperCase())) continue;
      matches.push({label: String(row[0]), value, page: table.page_number, id: table.table_id,
        quote: JSON.stringify({headers, cells: [row]})});
    }
  }
  if (!matches.length) return {answer: 'The retained evidence does not answer this question.', citations: [], status: 'insufficient_evidence'};
  const unique = [...new Map(matches.map(m => [m.label + ':' + m.value, m])).values()];
  const conflicts = unique.some((m, i) => unique.some((n, j) => i !== j && m.label === n.label && m.value !== n.value));
  return {answer: (conflicts ? 'Conflicting extracted values require review. ' : '') + unique.map(m => `${m.label} (${radius[1]} mile): ${m.value}.`).join(' '),
    citations: unique.map(({id, page, quote}) => ({id, page, quote})),
    status: conflicts ? 'conflicting_evidence' : 'table_lookup', method: 'header_matched_table_cells'};
}

export function validateAnswer(answer, passages) {
  if (!answer || typeof answer.answer !== 'string' || !Array.isArray(answer.citations)) {
    throw new Error('Model returned an invalid answer structure');
  }
  if (answer.answer.length > 12000) throw new Error('Model answer exceeded the limit');
  if (answer.citations.length === 0 && answer.answer !== 'The retained evidence does not answer this question.') {
    throw new Error('Model answer has no supporting evidence');
  }
  const citations = answer.citations.map(citation => {
    const source = passages.find(p => p.id === citation.id);
    if (!source || typeof citation.quote !== 'string' || citation.quote.trim().length < 4 || !source.text.includes(citation.quote)) {
      throw new Error('Model cited a quotation that is not in the retrieved evidence');
    }
    return { id: source.id, page: source.page, quote: citation.quote };
  });
  return {answer: answer.answer, citations, status: citations.length ? 'grounded_draft' : 'insufficient_evidence'};
}

export class ReportLibrary {
  constructor(model = new OllamaService()) { this.model = model; }
  async list() {
    return (await db.query(`SELECT r.*, f.original_filename FROM report_revisions r
      JOIN files f ON f.id = r.file_id ORDER BY r.id DESC`)).rows.map(r => ({...r, coverage: JSON.parse(r.coverage_json), coverage_json: undefined}));
  }
  async read(id) {
    if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) throw Object.assign(new Error('Invalid revision ID'), {statusCode: 400});
    const revision = (await db.query('SELECT * FROM report_revisions WHERE id = $1', [id])).rows[0];
    if (!revision) throw Object.assign(new Error('Report revision not found'), {statusCode: 404});
    const report = JSON.parse(await fs.readFile(resolveUploadPath(revision.evidence_path), 'utf8'));
    if (report.source_sha256 !== revision.source_sha256) throw new Error('Report source identity mismatch');
    return {revision, report: {...report, accepted_projection: revision.projection_json || null}};
  }
  async ask(id, question) {
    if (typeof question !== 'string' || !question.trim() || question.length > 2000) {
      throw Object.assign(new Error('Question must contain 1–2000 characters'), {statusCode: 400});
    }
    const {report, revision} = await this.read(id);
    const tableAnswer = answerRadiusQuestion(report, question);
    if (tableAnswer) return {...tableAnswer, revisionId: revision.id, coverage: report.coverage,
      notice: 'The requested radius is matched to its table heading. Values retain source periods; extraction still requires review.'};
    const passages = searchEvidence(report, question, 8);
    if (!passages.length) return {answer: 'The retained evidence does not answer this question.', citations: [], status: 'insufficient_evidence'};
    const generated = await this.model.answer(question, passages);
    return {...validateAnswer(generated, passages), revisionId: revision.id, coverage: report.coverage,
      model: this.model.model, notice: 'Quotes are checked against extracted text. Interpretations and OCR still require review; retrieval may omit relevant evidence.'};
  }
}

export function tablesCsv(report) {
  const escape = value => {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const rows = [['source_sha256', 'table_id', 'page', 'row', 'column', 'header', 'value']];
  for (const table of report.tables || []) {
    const headers = table.original_headers || table.headers || [];
    const cells = table.cells || (table.rows || []).map(r => (table.headers || []).map(h => r[h]));
    cells.forEach((row, ri) => row.forEach((value, ci) => rows.push([report.source_sha256, table.table_id, table.page_number, ri + 1, ci + 1, headers[ci], value])));
  }
  return rows.map(row => row.map(escape).join(',')).join('\r\n');
}
