const express = require('express');
const databaseService = require('../services/databaseService');

const router = express.Router();

/**
 * @route   GET /api/buyers
 * @desc    Get all buyers with optional filters
 * @access  Public
 */
router.get('/', async (req, res) => {
  try {
    // Extract query parameters
    const options = {
      verified: req.query.verified !== undefined ? req.query.verified === 'true' : undefined,
      verification_status: req.query.verification_status,
      onboarding_completed: req.query.onboarding_completed !== undefined 
        ? req.query.onboarding_completed === 'true' 
        : undefined,
      sortBy: req.query.sortBy || 'created_at',
      sortOrder: req.query.sortOrder || 'desc',
      limit: req.query.limit ? parseInt(req.query.limit) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset) : undefined
    };

    const buyers = await databaseService.getAllBuyers(options);

    res.status(200).json({
      success: true,
      message: 'Buyers retrieved successfully',
      data: {
        buyers,
        count: buyers.length
      }
    });

  } catch (error) {
    console.error('Get buyers error:', error);
    
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to retrieve buyers'
    });
  }
});

module.exports = router;

