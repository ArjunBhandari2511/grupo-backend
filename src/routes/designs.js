const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const databaseService = require('../services/databaseService');
const supabase = require('../config/supabase');
const multer = require('multer');
const { uploadToCloudinary } = require('../config/cloudinary');

const router = express.Router();

// Configure multer for design image uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedImageTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

/**
 * @route   POST /api/designs/upload-image
 * @desc    Upload design image
 * @access  Private (Manufacturer only)
 */
router.post('/upload-image', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    if (req.user.role !== 'manufacturer') {
      return res.status(403).json({
        success: false,
        message: 'Only manufacturers can upload designs'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file uploaded'
      });
    }

    const { userId } = req.user;

    // Upload to Cloudinary
    const uploadOptions = {
      folder: `groupo-designs/${userId}`,
      resource_type: 'image',
      transformation: [
        { quality: 'auto', fetch_format: 'auto' }
      ],
      context: {
        userId,
        originalName: req.file.originalname
      },
      tags: ['design', userId]
    };

    const result = await uploadToCloudinary(req.file.buffer, uploadOptions);

    res.status(200).json({
      success: true,
      data: {
        url: result.secure_url,
        publicId: result.public_id,
        width: result.width,
        height: result.height,
        format: result.format
      }
    });
  } catch (error) {
    console.error('Design image upload error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload design image'
    });
  }
});

/**
 * @route   POST /api/designs
 * @desc    Create a new design
 * @access  Private (Manufacturer only)
 */
router.post('/',
  authenticateToken,
  [
    body('product_name').trim().notEmpty().withMessage('Product name is required').isLength({ max: 255 }).withMessage('Product name must be less than 255 characters'),
    body('product_category').trim().notEmpty().withMessage('Product category is required'),
    body('image_url').trim().notEmpty().withMessage('Image URL is required').isURL().withMessage('Image URL must be a valid URL'),
    body('price_1_50').optional().isFloat({ min: 0 }).withMessage('Price for 1-50 pieces must be a positive number'),
    body('price_51_100').optional().isFloat({ min: 0 }).withMessage('Price for 51-100 pieces must be a positive number'),
    body('price_101_200').optional().isFloat({ min: 0 }).withMessage('Price for 101-200 pieces must be a positive number'),
    body('tags').optional().isArray().withMessage('Tags must be an array')
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

      if (req.user.role !== 'manufacturer') {
        return res.status(403).json({
          success: false,
          message: 'Only manufacturers can create designs'
        });
      }

      const { userId } = req.user;
      const { product_name, product_category, image_url, price_1_50, price_51_100, price_101_200, tags } = req.body;

      // Insert design into database
      const { data, error } = await supabase
        .from('designs')
        .insert([{
          manufacturer_id: userId,
          product_name,
          product_category,
          image_url,
          price_1_50: price_1_50 ? parseFloat(price_1_50) : null,
          price_51_100: price_51_100 ? parseFloat(price_51_100) : null,
          price_101_200: price_101_200 ? parseFloat(price_101_200) : null,
          tags: tags && Array.isArray(tags) ? tags : []
        }])
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create design: ${error.message}`);
      }

      res.status(201).json({
        success: true,
        message: 'Design created successfully',
        data: { design: data }
      });
    } catch (error) {
      console.error('Create design error:', error);
      res.status(400).json({
        success: false,
        message: error.message || 'Failed to create design'
      });
    }
  }
);

/**
 * @route   GET /api/designs
 * @desc    Get all designs (for buyers) or manufacturer's own designs (for manufacturers)
 * @access  Private
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { userId, role } = req.user;
    const { category, search, limit, offset } = req.query;

    let query = supabase
      .from('designs')
      .select(`
        *,
        manufacturer_profiles (
          id,
          unit_name,
          location,
          is_verified,
          verification_status
        )
      `)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    // Manufacturers see only their own designs
    if (role === 'manufacturer') {
      query = query.eq('manufacturer_id', userId);
    }
    // Buyers see all active designs

    // Apply filters
    if (category && category !== 'all') {
      query = query.eq('product_category', category);
    }

    if (search) {
      query = query.ilike('product_name', `%${search}%`);
    }

    if (limit) {
      query = query.limit(parseInt(limit));
    }

    if (offset) {
      query = query.offset(parseInt(offset));
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch designs: ${error.message}`);
    }

    res.status(200).json({
      success: true,
      message: 'Designs retrieved successfully',
      data: { designs: data || [] }
    });
  } catch (error) {
    console.error('Get designs error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to retrieve designs'
    });
  }
});

/**
 * @route   GET /api/designs/:id
 * @desc    Get a single design by ID
 * @access  Private
 */
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('designs')
      .select(`
        *,
        manufacturer_profiles (
          id,
          unit_name,
          location,
          is_verified,
          verification_status
        )
      `)
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          message: 'Design not found'
        });
      }
      throw new Error(`Failed to fetch design: ${error.message}`);
    }

    res.status(200).json({
      success: true,
      message: 'Design retrieved successfully',
      data: { design: data }
    });
  } catch (error) {
    console.error('Get design error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to retrieve design'
    });
  }
});

/**
 * @route   PUT /api/designs/:id
 * @desc    Update a design
 * @access  Private (Manufacturer only, own designs)
 */
router.put('/:id',
  authenticateToken,
  [
    body('product_name').optional().trim().notEmpty().withMessage('Product name cannot be empty').isLength({ max: 255 }).withMessage('Product name must be less than 255 characters'),
    body('product_category').optional().trim().notEmpty().withMessage('Product category cannot be empty'),
    body('image_url').optional().trim().notEmpty().withMessage('Image URL cannot be empty').isURL().withMessage('Image URL must be a valid URL'),
    body('price_1_50').optional().isFloat({ min: 0 }).withMessage('Price for 1-50 pieces must be a positive number'),
    body('price_51_100').optional().isFloat({ min: 0 }).withMessage('Price for 51-100 pieces must be a positive number'),
    body('price_101_200').optional().isFloat({ min: 0 }).withMessage('Price for 101-200 pieces must be a positive number'),
    body('tags').optional().isArray().withMessage('Tags must be an array'),
    body('is_active').optional().isBoolean().withMessage('is_active must be a boolean')
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

      if (req.user.role !== 'manufacturer') {
        return res.status(403).json({
          success: false,
          message: 'Only manufacturers can update designs'
        });
      }

      const { id } = req.params;
      const { userId } = req.user;

      // Check if design exists and belongs to manufacturer
      const { data: existingDesign, error: fetchError } = await supabase
        .from('designs')
        .select('manufacturer_id')
        .eq('id', id)
        .single();

      if (fetchError || !existingDesign) {
        return res.status(404).json({
          success: false,
          message: 'Design not found'
        });
      }

      if (existingDesign.manufacturer_id !== userId) {
        return res.status(403).json({
          success: false,
          message: 'You can only update your own designs'
        });
      }

      // Build update object
      const updateData = {};
      if (req.body.product_name !== undefined) updateData.product_name = req.body.product_name;
      if (req.body.product_category !== undefined) updateData.product_category = req.body.product_category;
      if (req.body.image_url !== undefined) updateData.image_url = req.body.image_url;
      if (req.body.price_1_50 !== undefined) updateData.price_1_50 = req.body.price_1_50 ? parseFloat(req.body.price_1_50) : null;
      if (req.body.price_51_100 !== undefined) updateData.price_51_100 = req.body.price_51_100 ? parseFloat(req.body.price_51_100) : null;
      if (req.body.price_101_200 !== undefined) updateData.price_101_200 = req.body.price_101_200 ? parseFloat(req.body.price_101_200) : null;
      if (req.body.tags !== undefined) updateData.tags = Array.isArray(req.body.tags) ? req.body.tags : [];
      if (req.body.is_active !== undefined) updateData.is_active = req.body.is_active;

      // Update design
      const { data, error } = await supabase
        .from('designs')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update design: ${error.message}`);
      }

      res.status(200).json({
        success: true,
        message: 'Design updated successfully',
        data: { design: data }
      });
    } catch (error) {
      console.error('Update design error:', error);
      res.status(400).json({
        success: false,
        message: error.message || 'Failed to update design'
      });
    }
  }
);

/**
 * @route   DELETE /api/designs/:id
 * @desc    Delete a design (soft delete by setting is_active to false)
 * @access  Private (Manufacturer only, own designs)
 */
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'manufacturer') {
      return res.status(403).json({
        success: false,
        message: 'Only manufacturers can delete designs'
      });
    }

    const { id } = req.params;
    const { userId } = req.user;

    // Check if design exists and belongs to manufacturer
    const { data: existingDesign, error: fetchError } = await supabase
      .from('designs')
      .select('manufacturer_id')
      .eq('id', id)
      .single();

    if (fetchError || !existingDesign) {
      return res.status(404).json({
        success: false,
        message: 'Design not found'
      });
    }

    if (existingDesign.manufacturer_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own designs'
      });
    }

    // Soft delete by setting is_active to false
    const { data, error } = await supabase
      .from('designs')
      .update({ is_active: false })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to delete design: ${error.message}`);
    }

    res.status(200).json({
      success: true,
      message: 'Design deleted successfully',
      data: { design: data }
    });
  } catch (error) {
    console.error('Delete design error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to delete design'
    });
  }
});

module.exports = router;

