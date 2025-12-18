const express = require('express');
const router = express.Router();
const databaseService = require('../services/databaseService');
const { authenticateToken } = require('../middleware/auth');

/**
 * @route   POST /api/ai-design-responses
 * @desc    Create a response to an AI design (manufacturer responds)
 * @access  Private (Manufacturer only)
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    // Ensure user is a manufacturer
    if (req.user.role !== 'manufacturer') {
      return res.status(403).json({
        success: false,
        message: 'Only manufacturers can respond to AI designs'
      });
    }

    const {
      ai_design_id,
      price_per_unit,
      quantity
    } = req.body;

    // Validate required fields
    if (!ai_design_id) {
      return res.status(400).json({
        success: false,
        message: 'AI design ID is required'
      });
    }

    if (!price_per_unit || price_per_unit <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Price per unit must be greater than 0'
      });
    }

    if (!quantity || quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Quantity must be greater than 0'
      });
    }

    // Verify AI design exists
    const aiDesign = await databaseService.getAIDesign(ai_design_id);
    if (!aiDesign) {
      return res.status(404).json({
        success: false,
        message: 'AI design not found'
      });
    }

    // Check if manufacturer has already responded to this AI design
    try {
      const existingResponses = await databaseService.getAIDesignResponses(ai_design_id);
      const hasExistingResponse = existingResponses.some(
        (resp) => resp.manufacturer_id === req.user.userId
      );

      if (hasExistingResponse) {
        return res.status(409).json({
          success: false,
          message: 'You have already responded to this AI design. You can only respond once per design.'
        });
      }
    } catch (checkError) {
      // If check fails, continue - the unique constraint will catch it anyway
      console.warn('Could not check existing responses, proceeding with insert:', checkError.message);
    }

    // Calculate price breakdown
    const pricePerUnit = parseFloat(price_per_unit);
    const qty = parseInt(quantity);
    const basePrice = pricePerUnit * qty;
    const gst = basePrice * 0.05; // 5% GST
    
    // Calculate platform fee - fixed 10% of base price
    const platformFeeRate = 0.10; // Fixed 10%
    const platformFee = basePrice * platformFeeRate;
    
    const quotedPrice = basePrice + gst + platformFee;

    // Create response data
    const responseData = {
      ai_design_id,
      manufacturer_id: req.user.userId,
      price_per_unit: pricePerUnit,
      quantity: qty,
      gst: parseFloat(gst.toFixed(2)),
      platform_fee: parseFloat(platformFee.toFixed(2)),
      quoted_price: parseFloat(quotedPrice.toFixed(2)),
      status: 'submitted'
    };

    // Create AI design response in database
    const response = await databaseService.createAIDesignResponse(responseData);

    return res.status(201).json({
      success: true,
      message: 'Response submitted successfully',
      data: response
    });
  } catch (error) {
    console.error('Create AI design response error:', error);
    
    // Handle unique constraint violation (manufacturer already responded)
    if (error.message && (
      error.message.includes('unique constraint') || 
      error.message.includes('duplicate key') ||
      error.message.includes('23505') // PostgreSQL unique violation error code
    )) {
      return res.status(409).json({
        success: false,
        message: 'You have already responded to this AI design. You can only respond once per design.'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to submit response',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/ai-design-responses
 * @desc    Get AI design responses
 * @access  Private
 * @note    Buyers see responses to their AI designs, Manufacturers see their own responses
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { ai_design_id } = req.query;

    let responses;

    if (ai_design_id) {
      // Get responses for a specific AI design
      const aiDesign = await databaseService.getAIDesign(ai_design_id);
      
      if (!aiDesign) {
        return res.status(404).json({
          success: false,
          message: 'AI design not found'
        });
      }

      // Buyers can only see responses to their own AI designs
      if (req.user.role === 'buyer' && aiDesign.buyer_id !== req.user.userId) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view responses for this AI design'
        });
      }

      responses = await databaseService.getAIDesignResponses(ai_design_id);
    } else {
      // Get all responses based on user role
      if (req.user.role === 'buyer') {
        // Buyers see responses to their AI designs
        responses = await databaseService.getBuyerAIDesignResponses(req.user.userId);
      } else if (req.user.role === 'manufacturer') {
        // Manufacturers see their own responses
        // For now, we'll need to filter by manufacturer_id
        // This can be enhanced later if needed
        return res.status(400).json({
          success: false,
          message: 'Please specify ai_design_id to view responses'
        });
      } else {
        return res.status(403).json({
          success: false,
          message: 'Invalid user role'
        });
      }
    }

    return res.status(200).json({
      success: true,
      data: responses,
      count: responses.length
    });
  } catch (error) {
    console.error('Get AI design responses error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch AI design responses',
      error: error.message
    });
  }
});

/**
 * @route   PATCH /api/ai-design-responses/:id/status
 * @desc    Update AI design response status (accept/reject)
 * @access  Private (Buyer can accept/reject responses to their designs)
 */
router.patch('/:id/status', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Validate status
    if (!status || !['accepted', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be either "accepted" or "rejected"'
      });
    }

    // Ensure user is a buyer
    if (req.user.role !== 'buyer') {
      return res.status(403).json({
        success: false,
        message: 'Only buyers can accept or reject AI design responses'
      });
    }

    // Get the existing response
    const existingResponse = await databaseService.getAIDesignResponse(id);
    if (!existingResponse) {
      return res.status(404).json({
        success: false,
        message: 'AI design response not found'
      });
    }

    // Get the AI design to verify ownership
    const aiDesign = await databaseService.getAIDesign(existingResponse.ai_design_id);
    if (!aiDesign) {
      return res.status(404).json({
        success: false,
        message: 'AI design not found'
      });
    }

    // Only the buyer who owns the AI design can accept/reject responses
    if (aiDesign.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this response'
      });
    }

    // Update response status
    const updatedResponse = await databaseService.updateAIDesignResponse(id, { status });

    return res.status(200).json({
      success: true,
      message: `Response ${status} successfully`,
      data: updatedResponse
    });
  } catch (error) {
    console.error('Update AI design response status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update response status',
      error: error.message
    });
  }
});

module.exports = router;

