const express = require('express');
const router = express.Router();
const databaseService = require('../services/databaseService');
const whatsappService = require('../services/whatsappService');
const { authenticateToken } = require('../middleware/auth');

let io = null;

router.setIo = (socketIo) => {
  io = socketIo;
};

// POST /api/ai-design-responses - Create response to AI design (Manufacturer only)
router.post('/', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'manufacturer') {
      return res.status(403).json({
        success: false,
        message: 'Only manufacturers can respond to AI designs'
      });
    }

    const { ai_design_id, price_per_unit, quantity } = req.body;

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

    const aiDesign = await databaseService.getAIDesign(ai_design_id);
    if (!aiDesign) {
      return res.status(404).json({
        success: false,
        message: 'AI design not found'
      });
    }

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
      // Continue - unique constraint will catch duplicates
    }

    const pricePerUnit = parseFloat(price_per_unit);
    const qty = parseInt(quantity);
    const basePrice = pricePerUnit * qty;
    const gst = basePrice * 0.05;
    const platformFee = basePrice * 0.10;
    const quotedPrice = basePrice + gst + platformFee;

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

    const response = await databaseService.createAIDesignResponse(responseData);
    const manufacturer = await databaseService.findManufacturerProfile(response.manufacturer_id);
    
    const enrichedResponse = {
      ...response,
      ai_design: { ...aiDesign, buyer_id: aiDesign.buyer_id },
      manufacturer: manufacturer || null
    };

    if (io) {
      io.to(`user:${aiDesign.buyer_id}`).emit('ai-design:response:new', { response: enrichedResponse });
    }

    (async () => {
      try {
        const buyer = await databaseService.findBuyerProfile(aiDesign.buyer_id);
        if (buyer && buyer.phone_number) {
          await whatsappService.notifyNewAIDesignResponse(buyer.phone_number, response, manufacturer);
        }
      } catch (waError) {
        console.error('WhatsApp notification error:', waError.message);
      }
    })();

    return res.status(201).json({
      success: true,
      message: 'Response submitted successfully',
      data: response
    });
  } catch (error) {
    console.error('Create AI design response error:', error);
    
    if (error.message && (
      error.message.includes('unique constraint') || 
      error.message.includes('duplicate key') ||
      error.message.includes('23505')
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

// GET /api/ai-design-responses - Get AI design responses
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { ai_design_id } = req.query;
    let responses;

    if (ai_design_id) {
      const aiDesign = await databaseService.getAIDesign(ai_design_id);
      
      if (!aiDesign) {
        return res.status(404).json({
          success: false,
          message: 'AI design not found'
        });
      }

      if (req.user.role === 'buyer' && aiDesign.buyer_id !== req.user.userId) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view responses for this AI design'
        });
      }

      responses = await databaseService.getAIDesignResponses(ai_design_id);
    } else {
      if (req.user.role === 'buyer') {
        responses = await databaseService.getBuyerAIDesignResponses(req.user.userId);
      } else if (req.user.role === 'manufacturer') {
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

// PATCH /api/ai-design-responses/:id/status - Update response status (Buyer only)
router.patch('/:id/status', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['accepted', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be either "accepted" or "rejected"'
      });
    }

    if (req.user.role !== 'buyer') {
      return res.status(403).json({
        success: false,
        message: 'Only buyers can accept or reject AI design responses'
      });
    }

    const existingResponse = await databaseService.getAIDesignResponse(id);
    if (!existingResponse) {
      return res.status(404).json({
        success: false,
        message: 'AI design response not found'
      });
    }

    const aiDesign = await databaseService.getAIDesign(existingResponse.ai_design_id);
    if (!aiDesign) {
      return res.status(404).json({
        success: false,
        message: 'AI design not found'
      });
    }

    if (aiDesign.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this response'
      });
    }

    const updatedResponse = await databaseService.updateAIDesignResponse(id, { status });
    const manufacturer = await databaseService.findManufacturerProfile(existingResponse.manufacturer_id);
    const buyer = await databaseService.findBuyerProfile(aiDesign.buyer_id);

    const enrichedResponse = {
      ...updatedResponse,
      ai_design: { ...aiDesign, buyer: buyer || null },
      manufacturer: manufacturer || null
    };

    if (io) {
      io.to(`user:${existingResponse.manufacturer_id}`).emit('ai-design:response:status:updated', { 
        response: enrichedResponse,
        status: status
      });
    }

    (async () => {
      try {
        if (manufacturer && manufacturer.phone_number) {
          await whatsappService.notifyAIDesignResponseStatusUpdate(manufacturer.phone_number, status, aiDesign);
        }
      } catch (waError) {
        console.error('WhatsApp notification error:', waError.message);
      }
    })();

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
