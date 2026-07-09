/**
 * Local reference-data HTTP adapter. It never fetches public websites and never
 * accepts remote URLs, preserving offline operation.
 */

import express from 'express';
import { LocalReferenceData } from '../services/local_reference_data.js';

const router = express.Router();
const referenceData = new LocalReferenceData();

router.get('/status', async (_req, res) => {
  try {
    res.json({ success: true, snapshots: await referenceData.getStatus() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/import', async (req, res) => {
  try {
    const imported = await referenceData.importSnapshot(req.body?.snapshot);
    res.status(imported.alreadyImported ? 200 : 201).json({ success: true, snapshot: imported });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/lookup', async (req, res) => {
  try {
    const result = await referenceData.lookup({
      street: req.query.street,
      city: req.query.city,
      stateAbbr: req.query.stateAbbr,
      zipCode: req.query.zipCode,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
