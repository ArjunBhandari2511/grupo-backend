const express = require('express');
const databaseService = require('../services/databaseService');

const router = express.Router();

// GET /api/buyers
router.get('/', async (req, res) => {
  try {
    const options = {
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
