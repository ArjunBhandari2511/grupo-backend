const express = require('express');
const { body, validationResult } = require('express-validator');
const authService = require('../services/authService');

const router = express.Router();

const ADMIN_CREDENTIALS = {
  username: process.env.ADMIN_USERNAME || 'admin72397',
  password: process.env.ADMIN_PASSWORD || '72397admin'
};

const validatePhoneNumber = [
  body('phoneNumber')
    .isMobilePhone('any')
    .withMessage('Please provide a valid phone number')
    .custom((value) => {
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

// POST /api/auth/send-otp
router.post('/send-otp', validatePhoneNumber, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { phoneNumber, role = 'buyer' } = req.body;
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

// POST /api/auth/verify-otp
router.post('/verify-otp', validateOTP, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { phoneNumber, otp, role = 'buyer' } = req.body;
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

// POST /api/auth/refresh-token
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

// GET /api/auth/verify-token
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

// POST /api/auth/logout
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

// POST /api/auth/manufacturer-onboarding
router.post('/manufacturer-onboarding', [
  body('unit_name').notEmpty().isLength({ min: 1, max: 255 }).withMessage('Unit name is required'),
  body('business_type').notEmpty().isLength({ min: 1, max: 100 }).withMessage('Business type is required'),
  body('gst_number').notEmpty().isLength({ min: 1, max: 20 }).withMessage('GST number is required'),
  body('pan_number').optional().isLength({ min: 1, max: 20 }),
  body('coi_number').optional().isLength({ min: 1, max: 50 }),
  body('product_types').optional().isArray(),
  body('capacity').optional().isInt({ min: 0 }),
  body('location').optional().isLength({ min: 1, max: 1000 }),
  body('manufacturing_unit_image_url').optional().isURL(),
  body('msme_file').optional(),
  body('other_certificates').optional()
], async (req, res) => {
  try {
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

    let profile = await authService.getProfileByPhone(decoded.phoneNumber, decoded.role);
    if (!profile) {
      profile = await authService.createManufacturerProfile(decoded.phoneNumber);
    }

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
      msme_file_url: req.body.msme_file ? (typeof req.body.msme_file === 'string' ? req.body.msme_file : null) : null,
      other_certificates_url: req.body.other_certificates ? (typeof req.body.other_certificates === 'string' ? req.body.other_certificates : null) : null,
      onboarding_completed: true,
      onboarding_completed_at: new Date().toISOString()
    };

    const updatedProfile = await authService.submitManufacturerOnboarding(profile.id, onboardingData);

    res.status(200).json({
      success: true,
      message: 'Onboarding completed successfully',
      data: { profile: updatedProfile }
    });
  } catch (error) {
    console.error('Onboarding submission error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to submit onboarding data'
    });
  }
});

// GET /api/auth/manufacturer-profile
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

    const profile = await authService.getProfileByPhone(decoded.phoneNumber, decoded.role);
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

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

// PUT /api/auth/manufacturer-profile
router.put('/manufacturer-profile', [
  body('unit_name').optional().isLength({ min: 1, max: 255 }),
  body('business_type').optional().isLength({ min: 1, max: 100 }),
  body('gst_number').optional().isLength({ min: 1, max: 20 }),
  body('pan_number').optional().isLength({ min: 1, max: 20 }),
  body('coi_number').optional().isLength({ min: 1, max: 50 }),
  body('product_types').optional().isArray(),
  body('daily_capacity').optional().isInt({ min: 0 }),
  body('location').optional().isLength({ min: 1, max: 1000 }),
  body('manufacturing_unit_image_url').optional().isURL()
], async (req, res) => {
  try {
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

    const profile = await authService.getProfileByPhone(decoded.phoneNumber, decoded.role);
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    const updatedProfile = await authService.updateManufacturerProfile(profile.id, req.body);

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: { profile: updatedProfile }
    });
  } catch (error) {
    console.error('Update manufacturer profile error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to update profile'
    });
  }
});

// POST /api/auth/admin-login
router.post('/admin-login', [
  body('username').notEmpty().withMessage('Username is required'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { username, password } = req.body;

    if (username !== ADMIN_CREDENTIALS.username || password !== ADMIN_CREDENTIALS.password) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

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

// POST /api/auth/buyer-onboarding (deprecated)
router.post('/buyer-onboarding', async (req, res) => {
  return res.status(410).json({
    success: false,
    message: 'Buyer onboarding endpoint has been removed. Use PUT /api/auth/buyer-profile to update profile.'
  });
});

// GET /api/auth/buyer-profile
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

    const profile = await authService.getProfileByPhone(decoded.phoneNumber, decoded.role);
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    const fullProfile = await authService.getBuyerProfile(profile.id);

    const databaseService = require('../services/databaseService');
    const designCount = await databaseService.getTodayDesignGenerationCount(profile.id);
    const DAILY_LIMIT = 5;
    const designGenerationStatus = {
      count: designCount,
      remaining: Math.max(0, DAILY_LIMIT - designCount),
      limit: DAILY_LIMIT,
      canGenerate: designCount < DAILY_LIMIT
    };

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
        },
        designGenerationStatus
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

// GET /api/auth/buyer-profile/design-generation-status
router.get('/buyer-profile/design-generation-status', async (req, res) => {
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

    if (decoded.role !== 'buyer') {
      return res.status(403).json({
        success: false,
        message: 'Only buyers can check design generation status'
      });
    }

    const profile = await authService.getProfileByPhone(decoded.phoneNumber, decoded.role);
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    const databaseService = require('../services/databaseService');
    const DAILY_LIMIT = 5;
    const count = await databaseService.getTodayDesignGenerationCount(profile.id);

    return res.status(200).json({
      success: true,
      data: {
        count,
        remaining: Math.max(0, DAILY_LIMIT - count),
        limit: DAILY_LIMIT,
        canGenerate: count < DAILY_LIMIT
      }
    });
  } catch (error) {
    console.error('Get design generation status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get design generation status',
      error: error.message
    });
  }
});

// POST /api/auth/buyer-profile/increment-design-generation
router.post('/buyer-profile/increment-design-generation', async (req, res) => {
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

    if (decoded.role !== 'buyer') {
      return res.status(403).json({
        success: false,
        message: 'Only buyers can increment design generation count'
      });
    }

    const profile = await authService.getProfileByPhone(decoded.phoneNumber, decoded.role);
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    const databaseService = require('../services/databaseService');
    const DAILY_LIMIT = 5;
    
    const currentCount = await databaseService.getTodayDesignGenerationCount(profile.id);
    if (currentCount >= DAILY_LIMIT) {
      return res.status(429).json({
        success: false,
        message: `Daily limit of ${DAILY_LIMIT} designs reached. Please try again tomorrow.`,
        data: {
          count: currentCount,
          remaining: 0,
          limit: DAILY_LIMIT,
          canGenerate: false
        }
      });
    }

    const newCount = await databaseService.incrementDesignGenerationCount(profile.id);

    return res.status(200).json({
      success: true,
      message: 'Design generation count incremented',
      data: {
        count: newCount,
        remaining: Math.max(0, DAILY_LIMIT - newCount),
        limit: DAILY_LIMIT,
        canGenerate: newCount < DAILY_LIMIT
      }
    });
  } catch (error) {
    console.error('Increment design generation count error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to increment design generation count',
      error: error.message
    });
  }
});

// PUT /api/auth/buyer-profile
router.put('/buyer-profile', [
  body('full_name').notEmpty().isLength({ min: 1, max: 255 }).withMessage('Full name is required'),
  body('email').notEmpty().isEmail().withMessage('Please provide a valid email address'),
  body('phone_number').optional().isMobilePhone('any'),
  body('business_address').notEmpty().isLength({ min: 1, max: 1000 }).withMessage('Business address is required'),
  body('about_business').notEmpty().isLength({ min: 1, max: 1000 }).withMessage('About business is required')
], async (req, res) => {
  try {
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

    const profile = await authService.getProfileByPhone(decoded.phoneNumber, decoded.role);
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    const updatedProfile = await authService.updateBuyerProfile(profile.id, req.body);

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: { profile: updatedProfile }
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
