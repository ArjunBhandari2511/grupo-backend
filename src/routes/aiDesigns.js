const express = require('express');
const router = express.Router();
const databaseService = require('../services/databaseService');
const { authenticateToken } = require('../middleware/auth');

/**
 * @route   POST /api/ai-designs
 * @desc    Create a new AI-generated design
 * @access  Private (Buyer only)
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    // Ensure user is a buyer
    if (req.user.role !== 'buyer') {
      return res.status(403).json({
        success: false,
        message: 'Only buyers can publish AI designs'
      });
    }

    const {
      image_url,
      apparel_type,
      design_description,
      quantity,
      preferred_colors,
      print_placement,
      status
    } = req.body;

    // Validate required fields
    if (!image_url || image_url.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Image URL is required'
      });
    }

    if (!apparel_type || apparel_type.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Apparel type is required'
      });
    }

    if (!quantity || quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Quantity must be greater than 0'
      });
    }

    // Create AI design data
    const aiDesignData = {
      buyer_id: req.user.userId,
      image_url: image_url.trim(),
      apparel_type: apparel_type.trim(),
      design_description: design_description ? design_description.trim() : null,
      quantity: parseInt(quantity),
      preferred_colors: preferred_colors ? preferred_colors.trim() : null,
      print_placement: print_placement ? print_placement.trim() : null,
      status: status || 'published'
    };

    // Create AI design in database
    const aiDesign = await databaseService.createAIDesign(aiDesignData);

    return res.status(201).json({
      success: true,
      message: 'AI design published successfully',
      data: aiDesign
    });
  } catch (error) {
    console.error('Create AI design error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to publish AI design',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/ai-designs
 * @desc    Get AI designs
 * @access  Private
 * @note    Buyers see their own designs, Manufacturers see all published designs
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { limit, offset, status, apparel_type } = req.query;

    const options = {
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
      status,
      apparel_type
    };

    let aiDesigns;

    if (req.user.role === 'buyer') {
      // Buyers can only see their own AI designs
      aiDesigns = await databaseService.getBuyerAIDesigns(req.user.userId, options);
    } else if (req.user.role === 'manufacturer') {
      // Manufacturers can see all published AI designs
      aiDesigns = await databaseService.getAllAIDesigns(options);
    } else if (req.user.role === 'admin') {
      // Admins can see all published AI designs with buyer information
      options.includeBuyer = true;
      aiDesigns = await databaseService.getAllAIDesigns(options);
    } else {
      return res.status(403).json({
        success: false,
        message: 'Invalid user role'
      });
    }

    return res.status(200).json({
      success: true,
      data: aiDesigns,
      count: aiDesigns.length
    });
  } catch (error) {
    console.error('Get AI designs error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch AI designs',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/ai-designs/:id
 * @desc    Get a single AI design by ID
 * @access  Private
 */
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const aiDesign = await databaseService.getAIDesign(id);

    if (!aiDesign) {
      return res.status(404).json({
        success: false,
        message: 'AI design not found'
      });
    }

    // Buyers can only view their own AI designs
    if (req.user.role === 'buyer' && aiDesign.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this AI design'
      });
    }

    // Include buyer details
    const buyer = await databaseService.findBuyerProfile(aiDesign.buyer_id);
    const enrichedAIDesign = {
      ...aiDesign,
      buyer: buyer || null
    };

    return res.status(200).json({
      success: true,
      data: enrichedAIDesign
    });
  } catch (error) {
    console.error('Get AI design error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch AI design',
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/ai-designs/:id
 * @desc    Delete an AI design
 * @access  Private (Buyer can delete their own)
 */
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Get the existing AI design
    const existingAIDesign = await databaseService.getAIDesign(id);

    if (!existingAIDesign) {
      return res.status(404).json({
        success: false,
        message: 'AI design not found'
      });
    }

    // Only the buyer who created it can delete
    if (req.user.role !== 'buyer' || existingAIDesign.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this AI design'
      });
    }

    // Delete AI design from database
    await databaseService.deleteAIDesign(id);

    return res.status(200).json({
      success: true,
      message: 'AI design deleted successfully'
    });
  } catch (error) {
    console.error('Delete AI design error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete AI design',
      error: error.message
    });
  }
});

module.exports = router;

