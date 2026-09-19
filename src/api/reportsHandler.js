import express from 'express';
import { ReportLibrary, searchEvidence, tablesCsv } from '../services/report_library.js';
const router = express.Router();
const library = new ReportLibrary();
router.get('/', async (_req, res) => res.json({reports: await library.list()}));
router.get('/:id', async (req, res) => {
  const {revision, report} = await library.read(req.params.id);
  res.json({revision, coverage: report.coverage, timings: report.timings || null, tableCount: report.tables.length,
    pages: report.pages.map(p => ({page: p.page_number, section: p.section, status: p.layout_status, readingStatus: p.reading_status}))});
});
router.get('/:id/export', async (req, res) => {
  const {report} = await library.read(req.params.id);
  if (req.query.format === 'csv') res.type('text/csv').attachment(`report-${req.params.id}-tables.csv`).send(tablesCsv(report));
  else res.attachment(`report-${req.params.id}.json`).json(report);
});
router.get('/:id/search', async (req, res) => {
  const {report} = await library.read(req.params.id);
  const q = String(req.query.q || '').slice(0, 2000);
  res.json({coverage: report.coverage, passages: searchEvidence(report, q, 30)});
});
router.post('/:id/ask', async (req, res) => res.json(await library.ask(req.params.id, req.body.question)));
export default router;
