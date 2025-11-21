const express = require('express');
const { body, validationResult } = require('express-validator');
const databaseService = require('../services/databaseService');

const router = express.Router();

/**
 * Admin authentication middleware
 * Allows hardcoded admin token for demo purposes
 */
const authenticateAdmin = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    const token = authHeader.substring(7);
    
    // Check for hardcoded admin token (for demo/dev purposes)
    const ADMIN_TOKENS = [
      'demo_admin_token',
      process.env.ADMIN_TOKEN // Allow env-based admin token
    ].filter(Boolean);
    
    if (ADMIN_TOKENS.includes(token)) {
      // Set admin user for demo
      req.user = {
        userId: 'admin_demo',
        role: 'admin',
        phoneNumber: 'admin',
        verified: true
      };
      return next();
    }
    
    // Try normal JWT authentication as fallback
    try {
      const authService = require('../services/authService');
      const decoded = authService.verifyJWT(token);
      
      if (decoded.role === 'admin') {
        req.user = {
          userId: decoded.userId,
          role: decoded.role,
          phoneNumber: decoded.phoneNumber,
          verified: true
        };
        return next();
      }
    } catch {
      // JWT verification failed, continue to error
    }
    
    return res.status(403).json({
      success: false,
      message: 'Access denied. Invalid admin token.'
    });
  } catch (error) {
    console.error('Admin authentication error:', error);
    return res.status(401).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};

/**
 * @route   GET /api/manufacturers
 * @desc    Get all manufacturers with optional filters
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
      business_type: req.query.business_type,
      sortBy: req.query.sortBy || 'created_at',
      sortOrder: req.query.sortOrder || 'desc',
      limit: req.query.limit ? parseInt(req.query.limit) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset) : undefined
    };

    const manufacturers = await databaseService.getAllManufacturers(options);

    res.status(200).json({
      success: true,
      message: 'Manufacturers retrieved successfully',
      data: {
        manufacturers,
        count: manufacturers.length
      }
    });

  } catch (error) {
    console.error('Get manufacturers error:', error);
    
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to retrieve manufacturers'
    });
  }
});

/**
 * @route   PATCH /api/manufacturers/:manufacturerId/verification-status
 * @desc    Update manufacturer verification status (Admin only)
 * @access  Private (Admin only)
 */
router.patch('/:manufacturerId/verification-status', 
  authenticateAdmin,
  [
    body('verification_status')
      .isIn(['pending', 'Accepted', 'Rejected', 'Blocked'])
      .withMessage('verification_status must be one of: pending, Accepted, Rejected, Blocked')
  ],
  async (req, res) => {
    try {
      // Check validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { manufacturerId } = req.params;
      const { verification_status } = req.body;

      // Check if manufacturer exists
      const manufacturer = await databaseService.findManufacturerProfile(manufacturerId);
      if (!manufacturer) {
        return res.status(404).json({
          success: false,
          message: 'Manufacturer not found'
        });
      }

      // Update verification status
      // Also update is_verified based on status
      const updateData = {
        verification_status,
        is_verified: verification_status === 'Accepted' ? true : false,
        updated_at: new Date().toISOString()
      };

      const updatedManufacturer = await databaseService.updateManufacturerProfile(manufacturerId, updateData);

      res.status(200).json({
        success: true,
        message: 'Verification status updated successfully',
        data: {
          manufacturer: updatedManufacturer
        }
      });

    } catch (error) {
      console.error('Update verification status error:', error);
      
      res.status(400).json({
        success: false,
        message: error.message || 'Failed to update verification status'
      });
    }
  }
);

module.exports = router;

