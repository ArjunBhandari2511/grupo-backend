const express = require('express');
const { body, validationResult } = require('express-validator');
const authService = require('../services/authService');

const router = express.Router();

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
    .isIn(['buyer', 'manufacturer'])
    .withMessage('Role must be either buyer or manufacturer')
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
    .isIn(['buyer', 'manufacturer'])
    .withMessage('Role must be either buyer or manufacturer')
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
 * @route   POST /api/auth/refresh
 * @desc    Refresh JWT token (alias)
 * @access  Private
 */
router.post('/refresh', async (req, res) => {
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
    const result = await authService.logout(token);

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
  body('location').optional().isLength({ min: 1, max: 1000 }).withMessage('Location must be between 1 and 1000 characters')
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
 * @route   POST /api/auth/buyer-onboarding
 * @desc    Submit buyer onboarding data
 * @access  Private
 */
router.post('/buyer-onboarding', [
  body('full_name').notEmpty().isLength({ min: 1, max: 255 }).withMessage('Full name is required and must be between 1 and 255 characters'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('company_name').notEmpty().isLength({ min: 1, max: 255 }).withMessage('Company name is required and must be between 1 and 255 characters'),
  body('gst_number').optional().isLength({ min: 1, max: 20 }).withMessage('GST number must be between 1 and 20 characters'),
  body('business_address').optional().isLength({ min: 1, max: 1000 }).withMessage('Business address must be between 1 and 1000 characters'),
  body('about_business').optional().isLength({ min: 1, max: 2000 }).withMessage('About business must be between 1 and 2000 characters')
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
      profile = await authService.createBuyerProfile(decoded.phoneNumber);
    }

    // Submit onboarding data
    const onboardingData = {
      full_name: req.body.full_name,
      email: req.body.email,
      company_name: req.body.company_name,
      gst_number: req.body.gst_number,
      business_address: req.body.business_address,
      about_business: req.body.about_business,
      onboarding_completed: true,
      onboarding_completed_at: new Date().toISOString()
    };

    const updatedProfile = await authService.submitBuyerOnboarding(profile.id, onboardingData);

    res.status(200).json({
      success: true,
      message: 'Onboarding completed successfully',
      data: {
        profile: updatedProfile
      }
    });

  } catch (error) {
    console.error('Buyer onboarding submission error:', error);
    
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to submit onboarding data'
    });
  }
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
          company_name: '',
          business_type: '',
          gst_number: '',
          pan_number: '',
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
  body('full_name').optional().isLength({ min: 1, max: 255 }).withMessage('Full name must be between 1 and 255 characters'),
  body('email').optional().isEmail().withMessage('Please provide a valid email address'),
  body('phone_number').optional().isMobilePhone('any').withMessage('Please provide a valid phone number'),
  body('company_name').optional().isLength({ min: 1, max: 255 }).withMessage('Company name must be between 1 and 255 characters'),
  body('business_type').optional().isLength({ min: 1, max: 100 }).withMessage('Business type must be between 1 and 100 characters'),
  body('gst_number').optional().isLength({ min: 1, max: 20 }).withMessage('GST number must be between 1 and 20 characters'),
  body('pan_number').optional().isLength({ min: 1, max: 20 }).withMessage('PAN number must be between 1 and 20 characters'),
  body('business_address').optional().isLength({ min: 1, max: 1000 }).withMessage('Business address must be between 1 and 1000 characters'),
  body('about_business').optional().isLength({ min: 1, max: 1000 }).withMessage('About business must be between 1 and 1000 characters')
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
