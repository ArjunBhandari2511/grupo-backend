const express = require('express');
const router = express.Router();
const databaseService = require('../services/databaseService');
const whatsappService = require('../services/whatsappService');
const { authenticateToken } = require('../middleware/auth');
const { uploadBase64Image } = require('../config/cloudinary');

// Socket.io instance will be set by the server
let io = null;

// Function to set io instance from server.js
router.setIo = (socketIo) => {
  io = socketIo;
};

/**
 * Helper function to check if a string is a base64 image
 * @param {string} str - String to check
 * @returns {boolean} - True if string is base64 image
 */
const isBase64Image = (str) => {
  if (!str || typeof str !== 'string') return false;
  // Check if it's a data URI or pure base64
  return str.startsWith('data:image/') || 
         (str.length > 100 && /^[A-Za-z0-9+/=]+$/.test(str.replace(/\s/g, '')));
};

/**
 * @route   POST /api/ai-designs
 * @desc    Create a new AI-generated design
 * @access  Private (Buyer only)
 * @note    Automatically uploads base64 images to Cloudinary
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

    let finalImageUrl = image_url.trim();

    // Check if image_url is a base64 image and upload to Cloudinary
    if (isBase64Image(image_url)) {
      try {
        console.log('Uploading base64 image to Cloudinary...');
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
        console.log('Image uploaded to Cloudinary:', uploadResult.url);
      } catch (uploadError) {
        console.error('Failed to upload image to Cloudinary:', uploadError);
        return res.status(500).json({
          success: false,
          message: 'Failed to upload image to Cloudinary',
          error: uploadError.message
        });
      }
    } else {
      // If it's already a URL (Cloudinary or external), use it as-is
      console.log('Using provided image URL (not base64)');
    }

    // Create AI design data
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
 * @query   include_responses - Optional: 'true' to include responses (optimizes N+1 queries)
 */
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
      // Buyers can see all their AI designs (draft and published)
      // Remove status filter for buyers to show all their designs
      const buyerOptions = { ...options };
      delete buyerOptions.status;
      aiDesigns = await databaseService.getBuyerAIDesigns(req.user.userId, buyerOptions);
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

    // If include_responses is true, batch fetch all responses to avoid N+1 queries
    if (include_responses === 'true' && aiDesigns.length > 0) {
      const designIds = aiDesigns.map(design => design.id);
      const responsesMap = await databaseService.getAIDesignResponsesBatch(designIds);
      
      // Attach responses to each design
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

/**
 * @route   GET /api/ai-designs/conversation/:conversationId/accepted
 * @desc    Get accepted AI designs for a conversation (buyer_id and manufacturer_id match)
 * @access  Private
 * @note    This route MUST come before /:id to avoid route conflicts
 */
router.get('/conversation/:conversationId/accepted', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    
    // Get conversation to extract buyer_id and manufacturer_id
    const conversation = await databaseService.getConversation(conversationId);
    
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    // Verify user is a participant in this conversation
    const { userId, role } = req.user;
    if (!((role === 'buyer' && conversation.buyer_id === userId) || 
          (role === 'manufacturer' && conversation.manufacturer_id === userId))) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view AI designs for this conversation'
      });
    }

    // Get accepted AI designs for this conversation
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
 * @route   PATCH /api/ai-designs/:id/push
 * @desc    Push an AI design to manufacturers (change status to published)
 * @access  Private (Buyer can push their own designs)
 */
router.patch('/:id/push', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Ensure user is a buyer
    if (req.user.role !== 'buyer') {
      return res.status(403).json({
        success: false,
        message: 'Only buyers can push AI designs to manufacturers'
      });
    }

    // Get the existing AI design
    const existingAIDesign = await databaseService.getAIDesign(id);

    if (!existingAIDesign) {
      return res.status(404).json({
        success: false,
        message: 'AI design not found'
      });
    }

    // Only the buyer who created it can push
    if (existingAIDesign.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to push this AI design'
      });
    }

    // Update status to published
    const updatedDesign = await databaseService.updateAIDesign(id, { status: 'published' });

    // Fetch buyer information to include in socket event
    const buyer = await databaseService.findBuyerProfile(updatedDesign.buyer_id);
    const enrichedAIDesign = {
      ...updatedDesign,
      buyer: buyer || null
    };

    // Emit socket event to all manufacturers
    if (io) {
      // Broadcast to all users in the manufacturer role room
      io.to('role:manufacturer').emit('ai-design:new', { aiDesign: enrichedAIDesign });
    }

    // Send WhatsApp notifications to all manufacturers (async, don't block response)
    (async () => {
      try {
        const manufacturers = await databaseService.getAllManufacturers();
        for (const manufacturer of manufacturers) {
          if (manufacturer.phone_number) {
            await whatsappService.notifyNewAIDesign(manufacturer.phone_number, updatedDesign);
          }
        }
      } catch (waError) {
        console.error('WhatsApp notification error (new AI design):', waError.message);
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

/**
 * @route   DELETE /api/ai-designs/:id
 * @desc    Delete an AI design
 * @access  Private (Buyer can delete their own, Admin can delete any)
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

    // Allow deletion if:
    // 1. User is admin (can delete any AI design)
    // 2. User is buyer and owns the AI design
    const isAdmin = req.user.role === 'admin';
    const isOwner = req.user.role === 'buyer' && existingAIDesign.buyer_id === req.user.userId;

    if (!isAdmin && !isOwner) {
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

