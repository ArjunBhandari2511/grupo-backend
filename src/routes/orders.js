const express = require('express');
const router = express.Router();
const databaseService = require('../services/databaseService');
const { authenticateToken } = require('../middleware/auth');

/**
 * @route   POST /api/orders
 * @desc    Create a new order (Buyer only)
 * @access  Private (Buyer only)
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    // Ensure user is a buyer
    if (req.user.role !== 'buyer') {
      return res.status(403).json({
        success: false,
        message: 'Only buyers can create orders'
      });
    }

    const {
      manufacturer_id,
      design_id,
      quantity,
      price_per_unit,
      total_price
    } = req.body;

    // Validate required fields
    if (!manufacturer_id || !design_id || !quantity || !price_per_unit || !total_price) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required: manufacturer_id, design_id, quantity, price_per_unit, total_price'
      });
    }

    // Validate quantity
    if (quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Quantity must be greater than 0'
      });
    }

    // Validate prices
    if (price_per_unit <= 0 || total_price <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Price per unit and total price must be greater than 0'
      });
    }

    // Create order data
    const orderData = {
      buyer_id: req.user.userId,
      manufacturer_id,
      design_id,
      quantity: parseInt(quantity),
      price_per_unit: parseFloat(price_per_unit),
      total_price: parseFloat(total_price),
      status: 'pending'
    };

    // Create order in database
    const order = await databaseService.createOrder(orderData);

    return res.status(201).json({
      success: true,
      message: 'Order created successfully',
      data: order
    });
  } catch (error) {
    console.error('Create order error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create order',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/orders/manufacturer
 * @desc    Get orders for the authenticated manufacturer
 * @access  Private (Manufacturer only)
 */
router.get('/manufacturer', authenticateToken, async (req, res) => {
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
      status: status || undefined,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
      sortBy,
      sortOrder
    };

    const orders = await databaseService.getManufacturerOrders(req.user.userId, options);

    return res.status(200).json({
      success: true,
      data: orders,
      count: orders.length
    });
  } catch (error) {
    console.error('Get manufacturer orders error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch orders',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/orders/buyer
 * @desc    Get orders for the authenticated buyer
 * @access  Private (Buyer only)
 */
router.get('/buyer', authenticateToken, async (req, res) => {
  try {
    // Ensure user is a buyer
    if (req.user.role !== 'buyer') {
      return res.status(403).json({
        success: false,
        message: 'Only buyers can access this endpoint'
      });
    }

    const { status, limit, offset, sortBy, sortOrder } = req.query;

    const options = {
      status: status || undefined,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
      sortBy,
      sortOrder
    };

    const orders = await databaseService.getBuyerOrders(req.user.userId, options);

    return res.status(200).json({
      success: true,
      data: orders,
      count: orders.length
    });
  } catch (error) {
    console.error('Get buyer orders error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch orders',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/orders/:id
 * @desc    Get a single order by ID
 * @access  Private (Buyer or Manufacturer who owns the order)
 */
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const order = await databaseService.getOrder(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Verify user has permission to view this order
    if (req.user.role === 'buyer' && order.buyer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this order'
      });
    }

    if (req.user.role === 'manufacturer' && order.manufacturer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this order'
      });
    }

    return res.status(200).json({
      success: true,
      data: order
    });
  } catch (error) {
    console.error('Get order error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch order',
      error: error.message
    });
  }
});

/**
 * @route   PATCH /api/orders/:id/status
 * @desc    Update order status (Manufacturer only)
 * @access  Private (Manufacturer only)
 */
router.patch('/:id/status', authenticateToken, async (req, res) => {
  try {
    // Ensure user is a manufacturer
    if (req.user.role !== 'manufacturer') {
      return res.status(403).json({
        success: false,
        message: 'Only manufacturers can update order status'
      });
    }

    const { id } = req.params;
    const { status } = req.body;

    // Validate status
    const validStatuses = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${validStatuses.join(', ')}`
      });
    }

    // Get the order and verify ownership
    const order = await databaseService.getOrder(id);
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (order.manufacturer_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this order'
      });
    }

    // Update order status
    const updatedOrder = await databaseService.updateOrderStatus(id, status);

    return res.status(200).json({
      success: true,
      message: 'Order status updated successfully',
      data: updatedOrder
    });
  } catch (error) {
    console.error('Update order status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update order status',
      error: error.message
    });
  }
});

module.exports = router;

