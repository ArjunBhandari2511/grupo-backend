const express = require('express');
const router = express.Router();
const databaseService = require('../services/databaseService');
const { authenticateToken } = require('../middleware/auth');

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
 * @route   POST /api/requirements
 * @desc    Create a new requirement
 * @access  Private (Buyer only)
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    // Ensure user is a buyer
    if (req.user.role !== 'buyer') {
      return res.status(403).json({
        success: false,
        message: 'Only buyers can create requirements'
      });
    }

    const {
      requirement_text,
      quantity,
      product_type,
      product_link,
      image_url,
      notes
    } = req.body;

    // Validate required fields
    if (!requirement_text || requirement_text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Requirement text is required'
      });
    }

    // Create requirement data
    const requirementData = {
      buyer_id: req.user.userId,
      requirement_text: requirement_text.trim(),
      quantity: quantity ? parseInt(quantity) : null,
      product_type: product_type ? product_type.trim() : null,
      product_link: product_link ? product_link.trim() : null,
      image_url: image_url ? image_url.trim() : null,
      notes: notes ? notes.trim() : null
    };

    // Create requirement in database
    const requirement = await databaseService.createRequirement(requirementData);

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

/**
 * @route   GET /api/requirements
 * @desc    Get requirements for the authenticated user
 * @access  Private (Buyer gets their own, Manufacturer gets all)
 */
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
      // Buyers can only see their own requirements
      requirements = await databaseService.getBuyerRequirements(req.user.userId, options);
    } else if (req.user.role === 'manufacturer') {
      // Manufacturers can see all requirements
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

/**
 * @route   GET /api/requirements/buyer/statistics
 * @desc    Get requirement statistics for the authenticated buyer
 * @access  Private (Buyer only)
 * @note    This route MUST come before /:id to avoid route conflicts
 */
router.get('/buyer/statistics', authenticateToken, async (req, res) => {
  try {
    // Ensure user is a buyer
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

/**
 * @route   GET /api/requirements/conversation/:conversationId/negotiating
 * @desc    Get negotiating and accepted requirements for a conversation (buyer_id and manufacturer_id match)
 * @access  Private
 * @note    This route MUST come before /:id to avoid route conflicts
 */
router.get('/conversation/:conversationId/negotiating', authenticateToken, async (req, res) => {
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
        message: 'Not authorized to view requirements for this conversation'
      });
    }

    // Get negotiating and accepted requirements for this conversation
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
    console.error('Get negotiating/accepted requirements error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch negotiating/accepted requirements',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/requirements/:id
 * @desc    Get a single requirement by ID
 * @access  Private
 */
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

    // Buyers can only view their own requirements
    if (req.user.role === 'buyer' && requirement.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this requirement'
      });
    }

    // Include buyer details
    const buyer = await databaseService.findBuyerProfile(requirement.buyer_id);
    const enrichedRequirement = {
      ...requirement,
      buyer: buyer || null
    };

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

/**
 * @route   PUT /api/requirements/:id
 * @desc    Update a requirement
 * @access  Private (Buyer can update their own)
 */
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Get the existing requirement
    const existingRequirement = await databaseService.getRequirement(id);

    if (!existingRequirement) {
      return res.status(404).json({
        success: false,
        message: 'Requirement not found'
      });
    }

    // Only the buyer who created it can update
    if (req.user.role !== 'buyer' || existingRequirement.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this requirement'
      });
    }

    const {
      requirement_text,
      quantity,
      product_type,
      product_link,
      image_url,
      notes
    } = req.body;

    // Build update data
    const updateData = {};
    if (requirement_text !== undefined) updateData.requirement_text = requirement_text.trim();
    if (quantity !== undefined) updateData.quantity = parseInt(quantity);
    if (product_type !== undefined) updateData.product_type = product_type.trim();
    if (product_link !== undefined) updateData.product_link = product_link.trim();
    if (image_url !== undefined) updateData.image_url = image_url.trim();
    if (notes !== undefined) updateData.notes = notes.trim();

    // Update requirement in database
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

/**
 * @route   DELETE /api/requirements/:id
 * @desc    Delete a requirement
 * @access  Private (Buyer can delete their own)
 */
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Get the existing requirement
    const existingRequirement = await databaseService.getRequirement(id);

    if (!existingRequirement) {
      return res.status(404).json({
        success: false,
        message: 'Requirement not found'
      });
    }

    // Only the buyer who created it can delete
    if (req.user.role !== 'buyer' || existingRequirement.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this requirement'
      });
    }

    // Delete requirement from database
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

// =============================================
// REQUIREMENT RESPONSES ROUTES
// =============================================

/**
 * @route   POST /api/requirements/:id/responses
 * @desc    Create a response to a requirement
 * @access  Private (Manufacturer only)
 */
router.post('/:id/responses', authenticateToken, async (req, res) => {
  try {
    // Ensure user is a manufacturer
    if (req.user.role !== 'manufacturer') {
      return res.status(403).json({
        success: false,
        message: 'Only manufacturers can respond to requirements'
      });
    }

    const { id: requirementId } = req.params;
    const {
      quoted_price,
      price_per_unit,
      delivery_time,
      notes
    } = req.body;

    // Validate required fields
    if (!quoted_price || !price_per_unit || !delivery_time) {
      return res.status(400).json({
        success: false,
        message: 'Quoted price, price per unit, and delivery time are required'
      });
    }

    // Check if requirement exists
    const requirement = await databaseService.getRequirement(requirementId);
    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: 'Requirement not found'
      });
    }

    // Check if manufacturer has already responded
    const existingResponse = await databaseService.getManufacturerResponse(
      requirementId,
      req.user.userId
    );

    if (existingResponse) {
      return res.status(400).json({
        success: false,
        message: 'You have already responded to this requirement'
      });
    }

    // Create response data (fees are calculated in frontend)
    const responseData = {
      requirement_id: requirementId,
      manufacturer_id: req.user.userId,
      quoted_price: parseFloat(quoted_price), // Store price as sent from frontend (includes fees)
      price_per_unit: parseFloat(price_per_unit), // Store price per unit as sent from frontend
      delivery_time: delivery_time.trim(),
      notes: notes ? notes.trim() : null,
      status: 'submitted'
    };

    // Create response in database
    const response = await databaseService.createRequirementResponse(responseData);

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

/**
 * @route   GET /api/requirements/responses/my-responses
 * @desc    Get all responses from the authenticated manufacturer
 * @access  Private (Manufacturer only)
 * @note    This route MUST come before /:id/responses to avoid route conflicts
 */
router.get('/responses/my-responses', authenticateToken, async (req, res) => {
  try {
    // Ensure user is a manufacturer
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

/**
 * @route   GET /api/requirements/:id/responses
 * @desc    Get all responses for a requirement
 * @access  Private
 */
router.get('/:id/responses', authenticateToken, async (req, res) => {
  try {
    const { id: requirementId } = req.params;

    // Check if requirement exists
    const requirement = await databaseService.getRequirement(requirementId);
    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: 'Requirement not found'
      });
    }

    // Buyers can only view responses to their own requirements
    if (req.user.role === 'buyer' && requirement.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view these responses'
      });
    }

    // Get responses
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

/**
 * @route   GET /api/requirements/responses/:responseId
 * @desc    Get a single requirement response by ID
 * @access  Private (Buyer or Manufacturer who owns the requirement/response)
 */
router.get('/responses/:responseId', authenticateToken, async (req, res) => {
  try {
    const { responseId } = req.params;

    // Get the response
    const response = await databaseService.getRequirementResponseById(responseId);
    
    if (!response) {
      return res.status(404).json({
        success: false,
        message: 'Response not found'
      });
    }

    // Get the requirement to verify ownership
    const requirement = await databaseService.getRequirement(response.requirement_id);
    
    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: 'Requirement not found'
      });
    }

    // Verify user has permission to view this response
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

    // Enrich response with requirement and manufacturer details
    const manufacturer = await databaseService.findManufacturerProfile(response.manufacturer_id);
    const buyer = await databaseService.findBuyerProfile(requirement.buyer_id);

    const enrichedResponse = {
      ...response,
      requirement: {
        ...requirement,
        buyer: buyer || null
      },
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

/**
 * @route   PATCH /api/requirements/responses/:responseId/status
 * @desc    Update response status (accept/reject) - Buyer only
 * @access  Private (Buyer only)
 */
router.patch('/responses/:responseId/status', authenticateToken, async (req, res) => {
  try {
    // Ensure user is a buyer
    if (req.user.role !== 'buyer') {
      return res.status(403).json({
        success: false,
        message: 'Only buyers can update response status'
      });
    }

    const { responseId } = req.params;
    const { status } = req.body;

    // Validate status
    if (!status || !['accepted', 'rejected', 'negotiating'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be either "accepted", "rejected", or "negotiating"'
      });
    }

    // Get the response and verify ownership
    const response = await databaseService.getRequirementResponseById(responseId);
    
    if (!response) {
      return res.status(404).json({
        success: false,
        message: 'Response not found'
      });
    }

    // Get the requirement to verify buyer ownership
    const requirement = await databaseService.getRequirement(response.requirement_id);
    
    if (!requirement || requirement.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this response'
      });
    }

    // Update status
    let updateData = { status };
    if (status === 'accepted') {
      updateData.accepted_at = new Date().toISOString();
    }

    // Update response status
    const updatedResponse = await databaseService.updateRequirementResponse(responseId, updateData);

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

// =============================================
// ADMIN ORDERS ROUTES
// =============================================

/**
 * @route   GET /api/requirements/admin/orders
 * @desc    Get all orders with optional status filter (Admin only)
 * @access  Private (Admin only)
 * @query   status - Optional filter: 'accepted', 'rejected', 'submitted' (pending), or omit for all
 */
router.get('/admin/orders', authenticateAdmin, async (req, res) => {
  try {
    const { status, limit, offset, sortBy, sortOrder } = req.query;

    const options = {
      status: status || undefined, // Filter by status if provided
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
