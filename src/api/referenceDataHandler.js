/**
 * Reference snapshots and explicit, user-triggered public listing lookups.
 */

import express from 'express';
import { loadPropertyAssessment, saveReferenceInputs } from '../services/assessment_reference.js';
import { readPublicListing } from '../services/public_listing.js';
import { LocalReferenceData } from '../services/local_reference_data.js';
import { ensureScoringConfigLoaded, getScoringService } from '../services/property_data_assembler.js';

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

router.get('/properties/:id', async (req, res) => {
  try {
    await ensureScoringConfigLoaded();
    const ctx = await loadPropertyAssessment(Number(req.params.id));
    res.json({success:true, property:{id:ctx.property.id,name:ctx.property.name,address:ctx.address},
      snapshotId:ctx.reference.provenance?.snapshotId ?? null, revisionId:ctx.revision?.id ?? null,
      observations:ctx.reference.data?.observations || {}, breakdown:getScoringService().calculateScore(ctx.projection).breakdown});
  } catch(error) {res.status(400).json({success:false,error:error.message});}
});
router.post('/properties/:id/read-listing', async (req, res) => {
  try {
    const ctx = await loadPropertyAssessment(Number(req.params.id));
    res.json({success:true,...await readPublicListing(req.body?.url,ctx.address)});
  } catch(error) {res.status(400).json({success:false,error:error.message});}
});
router.post('/properties/:id', async (req, res) => {
  try {
    res.json({success:true,...await saveReferenceInputs(Number(req.params.id),req.body?.observations,req.body?.snapshotId,req.body?.revisionId)});
  } catch(error) {res.status(400).json({success:false,error:error.message});}
});

export default router;
