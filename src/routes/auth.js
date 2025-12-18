const express = require('express');
const { body, validationResult } = require('express-validator');
const authService = require('../services/authService');

const router = express.Router();

/**
 * Admin credentials (hardcoded for demo purposes)
 * In production, these should be stored securely in environment variables or a database
 */
const ADMIN_CREDENTIALS = {
  username: process.env.ADMIN_USERNAME || 'admin72397',
  password: process.env.ADMIN_PASSWORD || '72397admin'
};

// Validation middleware
const validatePhoneNumber = [
  body('phoneNumber')
    .isMobilePhone('any')
    .withMessage('Please provide a valid phone number')
    .custom((value) => {
      // Ensure phone number starts with +
      if (!value.startsWith('+')) {
        throw new Error('Phone number must include country code (e.g., +1234567890)');
      }
      return true;
    }),
  body('role')
    .optional()
    .isIn(['buyer', 'manufacturer', 'admin'])
    .withMessage('Role must be either buyer, manufacturer, or admin')
];

const validateOTP = [
  body('phoneNumber')
    .isMobilePhone('any')
    .withMessage('Please provide a valid phone number'),
  body('otp')
    .isLength({ min: 4, max: 8 })
    .withMessage('OTP must be between 4 and 8 digits')
    .isNumeric()
    .withMessage('OTP must contain only numbers'),
  body('role')
    .optional()
    .isIn(['buyer', 'manufacturer', 'admin'])
    .withMessage('Role must be either buyer, manufacturer, or admin')
];

/**
 * @route   POST /api/auth/send-otp
 * @desc    Send OTP to phone number
 * @access  Public
 */
router.post('/send-otp', validatePhoneNumber, async (req, res) => {
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

    const { phoneNumber, role = 'buyer' } = req.body;

    // Send OTP
    const result = await authService.sendOTP(phoneNumber, role);

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      data: {
        phoneNumber,
        expiresIn: result.expiresIn,
        messageSid: result.messageSid
      }
    });

  } catch (error) {
    console.error('Send OTP error:', error);
    
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to send OTP',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * @route   POST /api/auth/verify-otp
 * @desc    Verify OTP and authenticate user
 * @access  Public
 */
router.post('/verify-otp', validateOTP, async (req, res) => {
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

    const { phoneNumber, otp, role = 'buyer' } = req.body;

    // Verify OTP
    const result = await authService.verifyOTP(phoneNumber, otp, role);

    res.status(200).json({
      success: true,
      message: 'Authentication successful',
      data: {
        user: result.user,
        token: result.token,
        expiresIn: process.env.JWT_EXPIRES_IN || '24h'
      }
    });

  } catch (error) {
    console.error('Verify OTP error:', error);
    
    res.status(400).json({
      success: false,
      message: error.message || 'OTP verification failed',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * @route   POST /api/auth/refresh-token
 * @desc    Refresh JWT token
 * @access  Private
 */
router.post('/refresh-token', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const token = authHeader.substring(7);
    const decoded = authService.verifyJWT(token);

    // Generate new token (preserve user id and role)
    const newToken = authService.generateJWT(decoded.userId, decoded.phoneNumber, decoded.role);

    res.status(200).json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        token: newToken,
        expiresIn: process.env.JWT_EXPIRES_IN || '24h'
      }
    });

  } catch (error) {
    console.error('Refresh token error:', error);
    
    res.status(401).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
});

/**
 * @route   GET /api/auth/verify-token
 * @desc    Verify JWT token
 * @access  Private
 */
router.get('/verify-token', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const token = authHeader.substring(7);
    const decoded = authService.verifyJWT(token);

    res.status(200).json({
      success: true,
      message: 'Token is valid',
      data: {
        user: {
          phoneNumber: decoded.phoneNumber,
          verified: true
        }
      }
    });

  } catch (error) {
    console.error('Verify token error:', error);
    
    res.status(401).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
});

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user
 * @access  Private
 */
router.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const token = authHeader.substring(7);
    await authService.logout(token);

    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Logout error:', error);
    
    res.status(400).json({
      success: false,
      message: error.message || 'Logout failed'
    });
  }
});


/**
 * @route   POST /api/auth/manufacturer-onboarding
 * @desc    Submit manufacturer onboarding data
 * @access  Private
 */
router.post('/manufacturer-onboarding', [
  body('unit_name').notEmpty().isLength({ min: 1, max: 255 }).withMessage('Unit name is required and must be between 1 and 255 characters'),
  body('business_type').notEmpty().isLength({ min: 1, max: 100 }).withMessage('Business type is required and must be between 1 and 100 characters'),
  body('gst_number').notEmpty().isLength({ min: 1, max: 20 }).withMessage('GST number is required and must be between 1 and 20 characters'),
  body('pan_number').optional().isLength({ min: 1, max: 20 }).withMessage('PAN number must be between 1 and 20 characters'),
  body('coi_number').optional().isLength({ min: 1, max: 50 }).withMessage('COI number must be between 1 and 50 characters'),
  body('product_types').optional().isArray().withMessage('Product types must be an array'),
  body('capacity').optional().isInt({ min: 0 }).withMessage('Capacity must be a positive integer'),
  body('location').optional().isLength({ min: 1, max: 1000 }).withMessage('Location must be between 1 and 1000 characters'),
  body('manufacturing_unit_image_url').optional().isURL().withMessage('Manufacturing unit image URL must be a valid URL'),
  body('msme_file').optional(),
  body('other_certificates').optional()
], async (req, res) => {
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

    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const token = authHeader.substring(7);
    const decoded = authService.verifyJWT(token);

    // Get or create profile from database
    let profile = await authService.getProfileByPhone(decoded.phoneNumber, decoded.role);
    if (!profile) {
      // Create new profile if it doesn't exist
      profile = await authService.createManufacturerProfile(decoded.phoneNumber);
    }

    // Submit onboarding data
    const onboardingData = {
      unit_name: req.body.unit_name,
      business_type: req.body.business_type,
      gst_number: req.body.gst_number,
      pan_number: req.body.pan_number,
      coi_number: req.body.coi_number,
      product_types: req.body.product_types || [],
      daily_capacity: req.body.capacity || 0,
      location: req.body.location,
      manufacturing_unit_image_url: req.body.manufacturing_unit_image_url || null,
      // Handle file objects - for now, store as null or placeholder
      msme_file_url: req.body.msme_file ? (typeof req.body.msme_file === 'string' ? req.body.msme_file : null) : null,
      other_certificates_url: req.body.other_certificates ? (typeof req.body.other_certificates === 'string' ? req.body.other_certificates : null) : null,
      onboarding_completed: true,
      onboarding_completed_at: new Date().toISOString()
    };

    const updatedProfile = await authService.submitManufacturerOnboarding(profile.id, onboardingData);

    res.status(200).json({
      success: true,
      message: 'Onboarding completed successfully',
      data: {
        profile: updatedProfile
      }
    });

  } catch (error) {
    console.error('Onboarding submission error:', error);
    
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to submit onboarding data'
    });
  }
});

/**
 * @route   GET /api/auth/manufacturer-profile
 * @desc    Get manufacturer profile
 * @access  Private
 */
router.get('/manufacturer-profile', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const token = authHeader.substring(7);
    const decoded = authService.verifyJWT(token);

    // Get profile from database
    const profile = await authService.getProfileByPhone(decoded.phoneNumber, decoded.role);
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    // Get full manufacturer profile data
    const fullProfile = await authService.getManufacturerProfile(profile.id);

    res.status(200).json({
      success: true,
      message: 'Profile retrieved successfully',
      data: {
        profile: fullProfile || {
          phone_number: profile.phone_number,
          unit_name: '',
          business_type: '',
          gst_number: '',
          pan_number: '',
          coi_number: '',
          product_types: [],
          daily_capacity: 0,
          location: '',
          onboarding_completed: false
        }
      }
    });

  } catch (error) {
    console.error('Get manufacturer profile error:', error);
    
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to get profile'
    });
  }
});

/**
 * @route   PUT /api/auth/manufacturer-profile
 * @desc    Update manufacturer profile
 * @access  Private
 */
router.put('/manufacturer-profile', [
  body('unit_name').optional().isLength({ min: 1, max: 255 }).withMessage('Unit name must be between 1 and 255 characters'),
  body('business_type').optional().isLength({ min: 1, max: 100 }).withMessage('Business type must be between 1 and 100 characters'),
  body('gst_number').optional().isLength({ min: 1, max: 20 }).withMessage('GST number must be between 1 and 20 characters'),
  body('pan_number').optional().isLength({ min: 1, max: 20 }).withMessage('PAN number must be between 1 and 20 characters'),
  body('coi_number').optional().isLength({ min: 1, max: 50 }).withMessage('COI number must be between 1 and 50 characters'),
  body('product_types').optional().isArray().withMessage('Product types must be an array'),
  body('daily_capacity').optional().isInt({ min: 0 }).withMessage('Daily capacity must be a positive integer'),
  body('location').optional().isLength({ min: 1, max: 1000 }).withMessage('Location must be between 1 and 1000 characters'),
  body('manufacturing_unit_image_url').optional().isURL().withMessage('Manufacturing unit image URL must be a valid URL')
], async (req, res) => {
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

    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const token = authHeader.substring(7);
    const decoded = authService.verifyJWT(token);

    // Get profile from database
    const profile = await authService.getProfileByPhone(decoded.phoneNumber, decoded.role);
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    // Update manufacturer profile
    const profileData = req.body;
    const updatedProfile = await authService.updateManufacturerProfile(profile.id, profileData);

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        profile: updatedProfile
      }
    });

  } catch (error) {
    console.error('Update manufacturer profile error:', error);
    
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to update profile'
    });
  }
});

/**
 * @route   POST /api/auth/admin-login
 * @desc    Admin login with username and password
 * @access  Public
 */
router.post('/admin-login', [
  body('username')
    .notEmpty()
    .withMessage('Username is required'),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
], async (req, res) => {
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

    const { username, password } = req.body;

    // Verify admin credentials
    if (username !== ADMIN_CREDENTIALS.username || password !== ADMIN_CREDENTIALS.password) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    // Generate JWT token for admin
    const adminProfileId = 'admin_' + ADMIN_CREDENTIALS.username;
    const token = authService.generateJWT(adminProfileId, ADMIN_CREDENTIALS.username, 'admin');

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          username: ADMIN_CREDENTIALS.username,
          role: 'admin'
        },
        expiresIn: process.env.JWT_EXPIRES_IN || '24h'
      }
    });

  } catch (error) {
    console.error('Admin login error:', error);
    
    res.status(400).json({
      success: false,
      message: error.message || 'Login failed'
    });
  }
});

/**
 * @route   POST /api/auth/buyer-onboarding
 * @desc    Submit buyer onboarding data (deprecated - buyer onboarding removed)
 * @access  Private
 */
router.post('/buyer-onboarding', async (req, res) => {
  return res.status(410).json({
    success: false,
    message: 'Buyer onboarding endpoint has been removed. Use PUT /api/auth/buyer-profile to update profile.'
  });
});

/**
 * @route   GET /api/auth/buyer-profile
 * @desc    Get buyer profile
 * @access  Private
 */
router.get('/buyer-profile', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const token = authHeader.substring(7);
    const decoded = authService.verifyJWT(token);

    // Get profile from database
    const profile = await authService.getProfileByPhone(decoded.phoneNumber, decoded.role);
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    // For buyer profile, get the full profile data
    const fullProfile = await authService.getBuyerProfile(profile.id);

    res.status(200).json({
      success: true,
      message: 'Profile retrieved successfully',
      data: {
        profile: fullProfile || {
          full_name: '',
          email: '',
          phone_number: profile.phone_number,
          business_address: '',
          about_business: ''
        }
      }
    });

  } catch (error) {
    console.error('Get buyer profile error:', error);
    
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to get profile'
    });
  }
});

/**
 * @route   PUT /api/auth/buyer-profile
 * @desc    Update buyer profile
 * @access  Private
 */
router.put('/buyer-profile', [
  body('full_name').notEmpty().isLength({ min: 1, max: 255 }).withMessage('Full name is required and must be between 1 and 255 characters'),
  body('email').notEmpty().isEmail().withMessage('Please provide a valid email address'),
  body('phone_number').optional().isMobilePhone('any').withMessage('Please provide a valid phone number'),
  body('business_address').notEmpty().isLength({ min: 1, max: 1000 }).withMessage('Business address is required and must be between 1 and 1000 characters'),
  body('about_business').notEmpty().isLength({ min: 1, max: 1000 }).withMessage('About business is required and must be between 1 and 1000 characters')
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Please fill up all fields',
        errors: errors.array()
      });
    }

    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const token = authHeader.substring(7);
    const decoded = authService.verifyJWT(token);

    // Get profile from database
    const profile = await authService.getProfileByPhone(decoded.phoneNumber, decoded.role);
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    // Update buyer profile
    const profileData = req.body;
    const updatedProfile = await authService.updateBuyerProfile(profile.id, profileData);

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        profile: updatedProfile
      }
    });

  } catch (error) {
    console.error('Update buyer profile error:', error);
    
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to update profile'
    });
  }
});

module.exports = router;
