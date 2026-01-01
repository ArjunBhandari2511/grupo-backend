const express = require('express');
const router = express.Router();
const databaseService = require('../services/databaseService');
const whatsappService = require('../services/whatsappService');
const { authenticateToken } = require('../middleware/auth');
const { uploadBase64Image } = require('../config/cloudinary');

let io = null;

router.setIo = (socketIo) => {
  io = socketIo;
};

const isBase64Image = (str) => {
  if (!str || typeof str !== 'string') return false;
  return str.startsWith('data:image/') || 
         (str.length > 100 && /^[A-Za-z0-9+/=]+$/.test(str.replace(/\s/g, '')));
};

// POST /api/ai-designs - Create new AI design (Buyer only)
router.post('/', authenticateToken, async (req, res) => {
  try {
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

    let finalImageUrl = image_url.trim();

    if (isBase64Image(image_url)) {
      try {
        const uploadResult = await uploadBase64Image(image_url, {
          folder: `groupo-ai-designs/${req.user.userId}`,
          context: {
            buyer_id: req.user.userId,
            apparel_type: apparel_type.trim(),
            uploaded_via: 'ai-design-generation'
          },
          tags: ['ai-design', 'generated', apparel_type.toLowerCase().replace(/\s+/g, '-')]
        });
        finalImageUrl = uploadResult.url;
      } catch (uploadError) {
        console.error('Failed to upload image to Cloudinary:', uploadError);
        return res.status(500).json({
          success: false,
          message: 'Failed to upload image to Cloudinary',
          error: uploadError.message
        });
      }
    }

    const aiDesignData = {
      buyer_id: req.user.userId,
      image_url: finalImageUrl,
      apparel_type: apparel_type.trim(),
      design_description: design_description ? design_description.trim() : null,
      quantity: parseInt(quantity),
      preferred_colors: preferred_colors ? preferred_colors.trim() : null,
      print_placement: print_placement ? print_placement.trim() : null,
      status: status || 'draft'
    };

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

// GET /api/ai-designs - Get AI designs
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { limit, offset, status, apparel_type, include_responses } = req.query;

    const options = {
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
      status,
      apparel_type
    };

    let aiDesigns;

    if (req.user.role === 'buyer') {
      const buyerOptions = { ...options };
      delete buyerOptions.status;
      aiDesigns = await databaseService.getBuyerAIDesigns(req.user.userId, buyerOptions);
    } else if (req.user.role === 'manufacturer') {
      aiDesigns = await databaseService.getAllAIDesigns(options);
    } else if (req.user.role === 'admin') {
      options.includeBuyer = true;
      aiDesigns = await databaseService.getAllAIDesigns(options);
    } else {
      return res.status(403).json({
        success: false,
        message: 'Invalid user role'
      });
    }

    if (include_responses === 'true' && aiDesigns.length > 0) {
      const designIds = aiDesigns.map(design => design.id);
      const responsesMap = await databaseService.getAIDesignResponsesBatch(designIds);
      
      aiDesigns = aiDesigns.map(design => ({
        ...design,
        responses: responsesMap.get(design.id) || []
      }));
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

// GET /api/ai-designs/conversation/:conversationId/accepted - Get accepted AI designs for conversation
// Note: This route MUST come before /:id to avoid route conflicts
router.get('/conversation/:conversationId/accepted', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    
    const conversation = await databaseService.getConversation(conversationId);
    
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    const { userId, role } = req.user;
    if (!((role === 'buyer' && conversation.buyer_id === userId) || 
          (role === 'manufacturer' && conversation.manufacturer_id === userId))) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view AI designs for this conversation'
      });
    }

    const aiDesigns = await databaseService.getAcceptedAIDesignsForConversation(
      conversation.buyer_id,
      conversation.manufacturer_id
    );

    return res.status(200).json({
      success: true,
      data: aiDesigns,
      count: aiDesigns.length
    });
  } catch (error) {
    console.error('Get accepted AI designs error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch accepted AI designs',
      error: error.message
    });
  }
});

// GET /api/ai-designs/:id - Get single AI design by ID
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

    if (req.user.role === 'buyer' && aiDesign.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this AI design'
      });
    }

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

// PATCH /api/ai-designs/:id/push - Push AI design to manufacturers (Buyer only)
router.patch('/:id/push', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (req.user.role !== 'buyer') {
      return res.status(403).json({
        success: false,
        message: 'Only buyers can push AI designs to manufacturers'
      });
    }

    const existingAIDesign = await databaseService.getAIDesign(id);

    if (!existingAIDesign) {
      return res.status(404).json({
        success: false,
        message: 'AI design not found'
      });
    }

    if (existingAIDesign.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to push this AI design'
      });
    }

    const updatedDesign = await databaseService.updateAIDesign(id, { status: 'published' });

    const buyer = await databaseService.findBuyerProfile(updatedDesign.buyer_id);
    const enrichedAIDesign = {
      ...updatedDesign,
      buyer: buyer || null
    };

    if (io) {
      io.to('role:manufacturer').emit('ai-design:new', { aiDesign: enrichedAIDesign });
    }

    (async () => {
      try {
        const manufacturers = await databaseService.getAllManufacturers();
        for (const manufacturer of manufacturers) {
          if (manufacturer.phone_number) {
            await whatsappService.notifyNewAIDesign(manufacturer.phone_number, updatedDesign);
          }
        }
      } catch (waError) {
        console.error('WhatsApp notification error:', waError.message);
      }
    })();

    return res.status(200).json({
      success: true,
      message: 'AI design pushed to manufacturers successfully',
      data: updatedDesign
    });
  } catch (error) {
    console.error('Push AI design error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to push AI design',
      error: error.message
    });
  }
});

// DELETE /api/ai-designs/:id - Delete AI design (Buyer or Admin)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const existingAIDesign = await databaseService.getAIDesign(id);

    if (!existingAIDesign) {
      return res.status(404).json({
        success: false,
        message: 'AI design not found'
      });
    }

    const isAdmin = req.user.role === 'admin';
    const isOwner = req.user.role === 'buyer' && existingAIDesign.buyer_id === req.user.userId;

    if (!isAdmin && !isOwner) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this AI design'
      });
    }

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
