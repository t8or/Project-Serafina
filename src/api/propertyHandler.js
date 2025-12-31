/**
 * Property API Handler
 * 
 * Provides REST API endpoints for property CRUD operations:
 * - List properties (active and deleted)
 * - Get property details with related files
 * - Soft delete and restore properties
 * - Permanent deletion (admin)
 */

import express from 'express';
import { PropertyService } from '../services/property_service.js';

const router = express.Router();
const propertyService = new PropertyService();

/**
 * GET /api/properties
 * 
 * List all active properties with scores.
 * 
 * Query Parameters:
 * - includeDeleted: 'true' to include soft-deleted properties
 */
router.get('/', async (req, res) => {
  try {
    const includeDeleted = req.query.includeDeleted === 'true';
    
    const properties = await propertyService.getAllWithScores({ includeDeleted });
    const summary = await propertyService.getSummaryStats();

    // Format properties for response
    const formattedProperties = properties.map(p => ({
      id: p.id,
      name: p.name,
      address: {
        street: p.address_street,
        city: p.address_city,
        state: p.address_state,
        stateAbbr: p.address_state_abbr,
        zipCode: p.address_zip,
        fullAddress: p.address_full
      },
      score: p.score ? parseFloat(p.score) : null,
      decision: p.decision,
      decisionColor: p.decision_color,
      status: p.status,
      createdAt: p.created_at,
      deletedAt: p.deleted_at
    }));

    res.json({
      success: true,
      count: formattedProperties.length,
      summary,
      properties: formattedProperties
    });

  } catch (error) {
    console.error('[Property API] List error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/properties/deleted
 * 
 * List all soft-deleted properties (pending permanent deletion).
 */
router.get('/deleted', async (req, res) => {
  try {
    const properties = await propertyService.getAllWithScores({ status: 'deleted' });

    // Calculate days until permanent deletion (30 days from deleted_at)
    const formattedProperties = properties
      .filter(p => p.deleted_at)
      .map(p => {
        const deletedAt = new Date(p.deleted_at);
        const permanentDeleteAt = new Date(deletedAt);
        permanentDeleteAt.setDate(permanentDeleteAt.getDate() + 30);
        const daysRemaining = Math.max(0, Math.ceil((permanentDeleteAt - new Date()) / (1000 * 60 * 60 * 24)));

        return {
          id: p.id,
          name: p.name,
          address: {
            street: p.address_street,
            city: p.address_city,
            state: p.address_state,
            stateAbbr: p.address_state_abbr,
            fullAddress: p.address_full
          },
          score: p.score ? parseFloat(p.score) : null,
          decision: p.decision,
          deletedAt: p.deleted_at,
          permanentDeleteAt,
          daysRemaining
        };
      });

    res.json({
      success: true,
      count: formattedProperties.length,
      properties: formattedProperties
    });

  } catch (error) {
    console.error('[Property API] List deleted error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/properties/:id
 * 
 * Get property details with all related data (documents, extracted files, score).
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const property = await propertyService.getWithRelatedData(parseInt(id));
    
    if (!property) {
      return res.status(404).json({
        success: false,
        error: 'Property not found'
      });
    }

    res.json({
      success: true,
      property: {
        id: property.id,
        name: property.name,
        address: {
          street: property.address_street,
          city: property.address_city,
          state: property.address_state,
          stateAbbr: property.address_state_abbr,
          zipCode: property.address_zip,
          fullAddress: property.address_full
        },
        status: property.status,
        createdAt: property.created_at,
        deletedAt: property.deleted_at,
        documents: property.documents.map(d => ({
          id: d.id,
          filename: d.filename,
          originalFilename: d.original_filename,
          fileType: d.file_type,
          fileSize: d.file_size,
          storagePath: d.storage_path,
          uploadedAt: d.uploaded_at
        })),
        extractedFiles: property.extractedFiles.map(ef => ({
          id: ef.id,
          sectionType: ef.section_type,
          storagePath: ef.storage_path,
          createdAt: ef.created_at
        })),
        score: property.score ? {
          value: parseFloat(property.score.score),
          decision: property.score.decision,
          decisionColor: property.score.decision_color,
          breakdown: property.score.breakdown,
          calculatedAt: property.score.calculated_at
        } : null,
        generatedFiles: property.generatedFiles.map(gf => ({
          id: gf.id,
          fileType: gf.file_type,
          fileName: gf.file_name,
          storagePath: gf.storage_path,
          createdAt: gf.created_at
        }))
      }
    });

  } catch (error) {
    console.error('[Property API] Get error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/properties/:id
 * 
 * Soft delete a property (can be restored within 30 days).
 * Supports both:
 * - Numeric database IDs (e.g., 123)
 * - File-based IDs (e.g., "e_1767155556269-bdo8hs") for backward compatibility
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if it's a numeric database ID or a file-based ID
    const numericId = parseInt(id);
    
    if (!isNaN(numericId) && numericId > 0) {
      // Database ID - use propertyService
      const property = await propertyService.softDelete(numericId);

      res.json({
        success: true,
        message: `Property "${property.name || id}" has been deleted. It can be restored within 30 days.`,
        property: {
          id: property.id,
          name: property.name,
          deletedAt: property.deleted_at
        }
      });
    } else {
      // File-based ID - delete the extracted files directly
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const extractedDir = path.default.join(process.cwd(), 'uploads', 'extracted');
      const files = await fs.default.readdir(extractedDir);
      
      // Find and delete all files matching this base name
      const matchingFiles = files.filter(f => f.startsWith(id) && f.endsWith('.json'));
      
      if (matchingFiles.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Property files not found'
        });
      }
      
      let deletedCount = 0;
      for (const file of matchingFiles) {
        try {
          await fs.default.unlink(path.default.join(extractedDir, file));
          deletedCount++;
        } catch (e) {
          console.warn(`[Property API] Could not delete ${file}: ${e.message}`);
        }
      }
      
      res.json({
        success: true,
        message: `Deleted ${deletedCount} files for property "${id}"`,
        property: {
          id: id,
          filesDeleted: deletedCount
        }
      });
    }

  } catch (error) {
    console.error('[Property API] Delete error:', error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: 'Property not found'
      });
    }
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/properties/:id/restore
 * 
 * Restore a soft-deleted property.
 */
router.post('/:id/restore', async (req, res) => {
  try {
    const { id } = req.params;
    
    const property = await propertyService.restore(parseInt(id));

    res.json({
      success: true,
      message: `Property "${property.name || id}" has been restored.`,
      property: {
        id: property.id,
        name: property.name,
        status: property.status
      }
    });

  } catch (error) {
    console.error('[Property API] Restore error:', error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: 'Property not found'
      });
    }
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/properties/:id/permanent
 * 
 * Permanently delete a property (admin only, cannot be undone).
 * This removes all database records AND files from the filesystem.
 */
router.delete('/:id/permanent', async (req, res) => {
  try {
    const { id } = req.params;
    const { confirm } = req.body;
    
    // Require explicit confirmation
    if (confirm !== 'PERMANENTLY DELETE') {
      return res.status(400).json({
        success: false,
        error: 'Permanent deletion requires confirmation. Send { "confirm": "PERMANENTLY DELETE" } in request body.'
      });
    }

    await propertyService.permanentDelete(parseInt(id));

    res.json({
      success: true,
      message: `Property ${id} and all related data have been permanently deleted.`
    });

  } catch (error) {
    console.error('[Property API] Permanent delete error:', error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: 'Property not found'
      });
    }
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PATCH /api/properties/:id
 * 
 * Update property details (name, address).
 */
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const property = await propertyService.update(parseInt(id), updates);
    
    if (!property) {
      return res.status(404).json({
        success: false,
        error: 'Property not found'
      });
    }

    res.json({
      success: true,
      property: {
        id: property.id,
        name: property.name,
        address: {
          street: property.address_street,
          city: property.address_city,
          state: property.address_state,
          stateAbbr: property.address_state_abbr,
          zipCode: property.address_zip,
          fullAddress: property.address_full
        }
      }
    });

  } catch (error) {
    console.error('[Property API] Update error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/properties/cleanup
 * 
 * Run cleanup to permanently delete properties that have been soft-deleted for > 30 days.
 * This is typically called by a cron job.
 */
router.post('/cleanup', async (req, res) => {
  try {
    const deleted = await propertyService.cleanupOldDeletedProperties();

    res.json({
      success: true,
      message: `Permanently deleted ${deleted} properties that were soft-deleted more than 30 days ago.`,
      deletedCount: deleted
    });

  } catch (error) {
    console.error('[Property API] Cleanup error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;

