const express = require('express');
const router = express.Router();
const databaseService = require('../services/databaseService');
const whatsappService = require('../services/whatsappService');
const { authenticateToken } = require('../middleware/auth');

let io = null;

router.setIo = (socketIo) => {
  io = socketIo;
};

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
    
    const ADMIN_TOKENS = [
      'demo_admin_token',
      process.env.ADMIN_TOKEN
    ].filter(Boolean);
    
    if (ADMIN_TOKENS.includes(token)) {
      req.user = {
        userId: 'admin_demo',
        role: 'admin',
        phoneNumber: 'admin',
        verified: true
      };
      return next();
    }
    
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
      // JWT verification failed
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

// POST /api/requirements - Create requirement (Buyer only)
router.post('/', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'buyer') {
      return res.status(403).json({
        success: false,
        message: 'Only buyers can create requirements'
      });
    }

    const { requirement_text, quantity, product_type, product_link, image_url, notes } = req.body;

    if (!requirement_text || requirement_text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Requirement text is required'
      });
    }

    const requirementData = {
      buyer_id: req.user.userId,
      requirement_text: requirement_text.trim(),
      quantity: quantity ? parseInt(quantity) : null,
      product_type: product_type ? product_type.trim() : null,
      product_link: product_link ? product_link.trim() : null,
      image_url: image_url ? image_url.trim() : null,
      notes: notes ? notes.trim() : null
    };

    const requirement = await databaseService.createRequirement(requirementData);

    const buyer = await databaseService.findBuyerProfile(requirement.buyer_id);
    const enrichedRequirement = { ...requirement, buyer: buyer || null };

    if (io) {
      io.to('role:manufacturer').emit('requirement:new', { requirement: enrichedRequirement });
    }

    (async () => {
      try {
        const manufacturers = await databaseService.getAllManufacturers();
        for (const manufacturer of manufacturers) {
          if (manufacturer.phone_number) {
            await whatsappService.notifyNewRequirement(manufacturer.phone_number, requirement);
          }
        }
      } catch (waError) {
        console.error('WhatsApp notification error:', waError.message);
      }
    })();

    return res.status(201).json({
      success: true,
      message: 'Requirement created successfully',
      data: requirement
    });
  } catch (error) {
    console.error('Create requirement error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create requirement',
      error: error.message
    });
  }
});

// GET /api/requirements
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { limit, offset, sortBy, sortOrder } = req.query;

    const options = {
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
      sortBy,
      sortOrder
    };

    let requirements;

    if (req.user.role === 'buyer') {
      requirements = await databaseService.getBuyerRequirements(req.user.userId, options);
    } else if (req.user.role === 'manufacturer') {
      requirements = await databaseService.getAllRequirements(options);
    } else {
      return res.status(403).json({
        success: false,
        message: 'Invalid user role'
      });
    }

    return res.status(200).json({
      success: true,
      data: requirements,
      count: requirements.length
    });
  } catch (error) {
    console.error('Get requirements error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch requirements',
      error: error.message
    });
  }
});

// GET /api/requirements/buyer/statistics (Buyer only)
// Note: Must come before /:id
router.get('/buyer/statistics', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'buyer') {
      return res.status(403).json({
        success: false,
        message: 'Only buyers can access requirement statistics'
      });
    }

    const statistics = await databaseService.getBuyerRequirementStatistics(req.user.userId);

    return res.status(200).json({
      success: true,
      data: statistics
    });
  } catch (error) {
    console.error('Get buyer requirement statistics error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch requirement statistics',
      error: error.message
    });
  }
});

// GET /api/requirements/conversation/:conversationId/negotiating
// Note: Must come before /:id
router.get('/conversation/:conversationId/negotiating', authenticateToken, async (req, res) => {
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
        message: 'Not authorized to view requirements for this conversation'
      });
    }

    const requirements = await databaseService.getNegotiatingRequirementsForConversation(
      conversation.buyer_id,
      conversation.manufacturer_id
    );

    return res.status(200).json({
      success: true,
      data: requirements,
      count: requirements.length
    });
  } catch (error) {
    console.error('Get negotiating requirements error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch negotiating requirements',
      error: error.message
    });
  }
});

// GET /api/requirements/:id
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const requirement = await databaseService.getRequirement(id);

    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: 'Requirement not found'
      });
    }

    if (req.user.role === 'buyer' && requirement.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this requirement'
      });
    }

    const buyer = await databaseService.findBuyerProfile(requirement.buyer_id);
    const enrichedRequirement = { ...requirement, buyer: buyer || null };

    return res.status(200).json({
      success: true,
      data: enrichedRequirement
    });
  } catch (error) {
    console.error('Get requirement error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch requirement',
      error: error.message
    });
  }
});

// PUT /api/requirements/:id (Buyer only)
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const existingRequirement = await databaseService.getRequirement(id);

    if (!existingRequirement) {
      return res.status(404).json({
        success: false,
        message: 'Requirement not found'
      });
    }

    if (req.user.role !== 'buyer' || existingRequirement.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this requirement'
      });
    }

    const { requirement_text, quantity, product_type, product_link, image_url, notes } = req.body;

    const updateData = {};
    if (requirement_text !== undefined) updateData.requirement_text = requirement_text.trim();
    if (quantity !== undefined) updateData.quantity = parseInt(quantity);
    if (product_type !== undefined) updateData.product_type = product_type.trim();
    if (product_link !== undefined) updateData.product_link = product_link.trim();
    if (image_url !== undefined) updateData.image_url = image_url.trim();
    if (notes !== undefined) updateData.notes = notes.trim();

    const updatedRequirement = await databaseService.updateRequirement(id, updateData);

    return res.status(200).json({
      success: true,
      message: 'Requirement updated successfully',
      data: updatedRequirement
    });
  } catch (error) {
    console.error('Update requirement error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update requirement',
      error: error.message
    });
  }
});

// DELETE /api/requirements/:id (Buyer only)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const existingRequirement = await databaseService.getRequirement(id);

    if (!existingRequirement) {
      return res.status(404).json({
        success: false,
        message: 'Requirement not found'
      });
    }

    if (req.user.role !== 'buyer' || existingRequirement.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this requirement'
      });
    }

    await databaseService.deleteRequirement(id);

    return res.status(200).json({
      success: true,
      message: 'Requirement deleted successfully'
    });
  } catch (error) {
    console.error('Delete requirement error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete requirement',
      error: error.message
    });
  }
});

// POST /api/requirements/:id/responses - Create response (Manufacturer only)
router.post('/:id/responses', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'manufacturer') {
      return res.status(403).json({
        success: false,
        message: 'Only manufacturers can respond to requirements'
      });
    }

    const { id: requirementId } = req.params;
    const { quoted_price, price_per_unit, delivery_time, notes } = req.body;

    if (!quoted_price || !price_per_unit || !delivery_time) {
      return res.status(400).json({
        success: false,
        message: 'Quoted price, price per unit, and delivery time are required'
      });
    }

    const requirement = await databaseService.getRequirement(requirementId);
    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: 'Requirement not found'
      });
    }

    const existingResponse = await databaseService.getManufacturerResponse(requirementId, req.user.userId);
    if (existingResponse) {
      return res.status(400).json({
        success: false,
        message: 'You have already responded to this requirement'
      });
    }

    const responseData = {
      requirement_id: requirementId,
      manufacturer_id: req.user.userId,
      quoted_price: parseFloat(quoted_price),
      price_per_unit: parseFloat(price_per_unit),
      delivery_time: delivery_time.trim(),
      notes: notes ? notes.trim() : null,
      status: 'submitted'
    };

    const response = await databaseService.createRequirementResponse(responseData);
    const manufacturer = await databaseService.findManufacturerProfile(response.manufacturer_id);
    
    const enrichedResponse = {
      ...response,
      requirement: { ...requirement, buyer_id: requirement.buyer_id },
      manufacturer: manufacturer || null
    };

    if (io) {
      io.to(`user:${requirement.buyer_id}`).emit('requirement:response:new', { response: enrichedResponse });
    }

    (async () => {
      try {
        const buyer = await databaseService.findBuyerProfile(requirement.buyer_id);
        if (buyer && buyer.phone_number) {
          await whatsappService.notifyNewRequirementResponse(buyer.phone_number, response, manufacturer);
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
    console.error('Create requirement response error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit response',
      error: error.message
    });
  }
});

// GET /api/requirements/responses/my-responses (Manufacturer only)
// Note: Must come before /:id/responses
router.get('/responses/my-responses', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'manufacturer') {
      return res.status(403).json({
        success: false,
        message: 'Only manufacturers can access this endpoint'
      });
    }

    const { status, limit, offset, sortBy, sortOrder } = req.query;

    const options = {
      status,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
      sortBy,
      sortOrder
    };

    const responses = await databaseService.getManufacturerResponses(req.user.userId, options);

    return res.status(200).json({
      success: true,
      data: responses,
      count: responses.length
    });
  } catch (error) {
    console.error('Get manufacturer responses error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch responses',
      error: error.message
    });
  }
});

// GET /api/requirements/:id/responses
router.get('/:id/responses', authenticateToken, async (req, res) => {
  try {
    const { id: requirementId } = req.params;

    const requirement = await databaseService.getRequirement(requirementId);
    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: 'Requirement not found'
      });
    }

    if (req.user.role === 'buyer' && requirement.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view these responses'
      });
    }

    const responses = await databaseService.getRequirementResponses(requirementId);

    return res.status(200).json({
      success: true,
      data: responses,
      count: responses.length
    });
  } catch (error) {
    console.error('Get requirement responses error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch responses',
      error: error.message
    });
  }
});

// GET /api/requirements/responses/:responseId
router.get('/responses/:responseId', authenticateToken, async (req, res) => {
  try {
    const { responseId } = req.params;

    const response = await databaseService.getRequirementResponseById(responseId);
    if (!response) {
      return res.status(404).json({
        success: false,
        message: 'Response not found'
      });
    }

    const requirement = await databaseService.getRequirement(response.requirement_id);
    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: 'Requirement not found'
      });
    }

    if (req.user.role === 'buyer' && requirement.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this response'
      });
    }

    if (req.user.role === 'manufacturer' && response.manufacturer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this response'
      });
    }

    const manufacturer = await databaseService.findManufacturerProfile(response.manufacturer_id);
    const buyer = await databaseService.findBuyerProfile(requirement.buyer_id);

    const enrichedResponse = {
      ...response,
      requirement: { ...requirement, buyer: buyer || null },
      manufacturer: manufacturer || null
    };

    return res.status(200).json({
      success: true,
      data: enrichedResponse
    });
  } catch (error) {
    console.error('Get requirement response error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch response',
      error: error.message
    });
  }
});

// PATCH /api/requirements/responses/:responseId/status (Buyer only)
router.patch('/responses/:responseId/status', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'buyer') {
      return res.status(403).json({
        success: false,
        message: 'Only buyers can update response status'
      });
    }

    const { responseId } = req.params;
    const { status } = req.body;

    if (!status || !['accepted', 'rejected', 'negotiating'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be either "accepted", "rejected", or "negotiating"'
      });
    }

    const response = await databaseService.getRequirementResponseById(responseId);
    if (!response) {
      return res.status(404).json({
        success: false,
        message: 'Response not found'
      });
    }

    const requirement = await databaseService.getRequirement(response.requirement_id);
    if (!requirement || requirement.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this response'
      });
    }

    let updateData = { status };
    if (status === 'accepted') {
      updateData.accepted_at = new Date().toISOString();
    }

    const updatedResponse = await databaseService.updateRequirementResponse(responseId, updateData);
    const manufacturer = await databaseService.findManufacturerProfile(response.manufacturer_id);
    const buyer = await databaseService.findBuyerProfile(requirement.buyer_id);

    const enrichedResponse = {
      ...updatedResponse,
      requirement: { ...requirement, buyer: buyer || null },
      manufacturer: manufacturer || null
    };

    if (io) {
      io.to(`user:${response.manufacturer_id}`).emit('requirement:response:status:updated', { 
        response: enrichedResponse,
        status: status
      });
    }

    (async () => {
      try {
        if (manufacturer && manufacturer.phone_number) {
          await whatsappService.notifyResponseStatusUpdate(manufacturer.phone_number, status, requirement);
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
    console.error('Update response status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update response status',
      error: error.message
    });
  }
});

// GET /api/requirements/admin/orders (Admin only)
router.get('/admin/orders', authenticateAdmin, async (req, res) => {
  try {
    const { status, limit, offset, sortBy, sortOrder } = req.query;

    const options = {
      status: status || undefined,
      limit: limit ? parseInt(limit) : 100,
      offset: offset ? parseInt(offset) : 0,
      sortBy,
      sortOrder
    };

    const orders = await databaseService.getOrders(options);

    return res.status(200).json({
      success: true,
      data: orders,
      count: orders.length
    });
  } catch (error) {
    console.error('Get orders error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch orders',
      error: error.message
    });
  }
});

module.exports = router;
