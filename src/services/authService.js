const twilio = require('twilio');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const databaseService = require('./databaseService');

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

class AuthService {
  /**
   * Generate a random OTP
   * @param {number} length - Length of OTP
   * @returns {string} Generated OTP
   */
  generateOTP(length = parseInt(process.env.OTP_LENGTH) || 6) {
    const digits = '0123456789';
    let otp = '';
    for (let i = 0; i < length; i++) {
      otp += digits[Math.floor(Math.random() * digits.length)];
    }
    return otp;
  }

  /**
   * Get daily OTP send count for a phone number
   * @param {string} phoneNumber - Phone number
   * @returns {Promise<number>} Number of OTPs sent today
   */
  async getDailyOTPCount(phoneNumber) {
    try {
      return await databaseService.getDailyOTPCount(phoneNumber);
    } catch (error) {
      console.warn('Error getting daily OTP count:', error);
      return 0;
    }
  }

  /**
   * Send OTP via Twilio SMS
   * @param {string} phoneNumber - Phone number to send OTP to
   * @param {string} role - User role ('buyer' or 'manufacturer')
   * @returns {Promise<Object>} Result object
   */
  async sendOTP(phoneNumber, role = 'buyer') {
    try {
      // Validate phone number format
      if (!this.isValidPhoneNumber(phoneNumber)) {
        throw new Error('Invalid phone number format');
      }

      // Check daily resend limit (max 3 per day)
      const dailyCount = await this.getDailyOTPCount(phoneNumber);
      if (dailyCount >= 3) {
        throw new Error('You have reached the maximum of 3 OTP requests per day. Please try again tomorrow.');
      }

      // Proactively expire any previous active OTPs for this phone
      try {
        await databaseService.expireActiveOtps(phoneNumber);
      } catch (e) {
        // Do not block OTP sending if cleanup fails; log for observability
        console.warn('Could not expire previous OTPs:', e?.message || e);
      }

      // Generate new OTP
      const otp = this.generateOTP();
      const expiryTime = new Date(Date.now() + (parseInt(process.env.OTP_EXPIRY_MINUTES) || 2) * 60 * 1000);

      // Store OTP in database
      const otpData = {
        phone_number: phoneNumber,
        otp_code: otp,
        expires_at: expiryTime.toISOString(),
        is_verified: false,
        attempts: 0
      };

      await databaseService.storeOTPSession(otpData);

      // Send SMS via Twilio
      const message = await twilioClient.messages.create({
        body: `Your Grupo verification code is: ${otp}. This code expires in ${process.env.OTP_EXPIRY_MINUTES || 2} minutes.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phoneNumber
      });

      console.log(`OTP sent to ${phoneNumber}. Message SID: ${message.sid}`);

      return {
        success: true,
        message: 'OTP sent successfully',
        messageSid: message.sid,
        expiresIn: process.env.OTP_EXPIRY_MINUTES || 2
      };

    } catch (error) {
      console.error('Error sending OTP:', error);
      
      // Handle Twilio-specific errors
      if (error.code) {
        switch (error.code) {
          case 21211:
            throw new Error('Invalid phone number');
          case 21610:
            throw new Error('Phone number is not verified (trial account)');
          case 21408:
            throw new Error('Permission to send SMS denied');
          default:
            throw new Error(`SMS sending failed: ${error.message}`);
        }
      }
      
      throw new Error(`Failed to send OTP: ${error.message}`);
    }
  }

  /**
   * Verify OTP and create/update profile
   * @param {string} phoneNumber - Phone number
   * @param {string} otp - OTP to verify
   * @param {string} role - User role ('buyer' or 'manufacturer')
   * @returns {Promise<Object>} Result object
   */
  async verifyOTP(phoneNumber, otp, role = 'buyer') {
    try {
      // Get OTP session from database
      const storedOTP = await databaseService.findOTPSession(phoneNumber);

      if (!storedOTP) {
        throw new Error('OTP not found or expired');
      }

      // Check if OTP has expired
      if (new Date() > new Date(storedOTP.expires_at)) {
        throw new Error('OTP has expired');
      }

      // Check if already verified
      if (storedOTP.is_verified) {
        throw new Error('OTP has already been used');
      }

      // Check attempt limit (max 3 attempts)
      if (storedOTP.attempts >= 3) {
        throw new Error('Too many failed attempts. Please request a new OTP.');
      }

      // Verify OTP
      if (storedOTP.otp_code !== otp) {
        // Increment attempts on the specific OTP session row
        await databaseService.updateOTPSession(storedOTP.id, {
          attempts: storedOTP.attempts + 1
        });
        throw new Error('Invalid OTP');
      }

      // Mark OTP as verified
      await databaseService.updateOTPSession(storedOTP.id, {
        is_verified: true
      });

      // Check if profile exists, create if not
      let profile = null;
      if (role === 'buyer') {
        profile = await databaseService.findBuyerProfileByPhone(phoneNumber);
        
        if (!profile) {
          // Create new buyer profile
          const profileData = {
            phone_number: phoneNumber,
            last_login: new Date().toISOString()
          };
          profile = await databaseService.createBuyerProfile(profileData);
          console.log(`New buyer profile created: ${phoneNumber}`);
        } else {
          // Update existing buyer profile
          await databaseService.updateBuyerProfileByPhone(phoneNumber, {
            last_login: new Date().toISOString()
          });
          console.log(`Existing buyer profile updated: ${phoneNumber}`);
        }
      } else if (role === 'manufacturer') {
        profile = await databaseService.findManufacturerProfileByPhone(phoneNumber);
        
        if (!profile) {
          // Create new manufacturer profile
          const profileData = {
            phone_number: phoneNumber,
            is_verified: true,
            last_login: new Date().toISOString()
          };
          profile = await databaseService.createManufacturerProfile(profileData);
          console.log(`New manufacturer profile created: ${phoneNumber}`);
        } else {
          // Update existing manufacturer profile
          await databaseService.updateManufacturerProfileByPhone(phoneNumber, {
            is_verified: true,
            last_login: new Date().toISOString()
          });
          console.log(`Existing manufacturer profile verified: ${phoneNumber}`);
        }
      } else if (role === 'admin') {
        // For admin, we don't create a profile but still need a user ID for JWT
        // Use a dummy profile structure or check for admin profiles
        // For now, we'll use a mock profile structure with phone number as ID
        profile = {
          id: `admin_${phoneNumber.replace(/\+/g, '')}`,
          phone_number: phoneNumber,
          role: 'admin'
        };
        console.log(`Admin authentication: ${phoneNumber}`);
      }

      // Generate JWT token with profile id and role
      const token = this.generateJWT(profile.id, phoneNumber, role);

      // Store user session in database (skip for admin as they don't have a profile)
      if (role !== 'admin') {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const sessionData = {
          profile_id: profile.id,
          profile_type: role,
          token_hash: tokenHash,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
        };
        await databaseService.storeUserSession(sessionData);
      }

      return {
        success: true,
        message: 'OTP verified successfully',
        token,
        user: {
          id: profile.id,
          phoneNumber: profile.phone_number,
          role: role,
          verified: role === 'manufacturer' ? (profile.is_verified || false) : true
        }
      };

    } catch (error) {
      console.error('Error verifying OTP:', error);
      throw new Error(`OTP verification failed: ${error.message}`);
    }
  }

  /**
   * Generate JWT token
   * @param {string} phoneNumber - Phone number
   * @param {string} role - User role ('buyer' or 'manufacturer')
   * @returns {string} JWT token
   */
  generateJWT(userId, phoneNumber, role) {
    const payload = {
      userId,
      phoneNumber,
      role,
      iat: Math.floor(Date.now() / 1000),
      type: 'auth'
    };

    return jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '24h'
    });
  }

  /**
   * Verify JWT token
   * @param {string} token - JWT token
   * @returns {Object} Decoded token payload
   */
  verifyJWT(token) {
    try {
      return jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }

  /**
   * Validate phone number format
   * @param {string} phoneNumber - Phone number to validate
   * @returns {boolean} Is valid phone number
   */
  isValidPhoneNumber(phoneNumber) {
    // Basic phone number validation (E.164 format)
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    return phoneRegex.test(phoneNumber);
  }

  /**
   * Logout user by deactivating session
   * @param {string} token - JWT token
   * @returns {Promise<Object>} Result object
   */
  async logout(token) {
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await databaseService.deactivateUserSession(tokenHash);
      
      return {
        success: true,
        message: 'Logged out successfully'
      };
    } catch (error) {
      console.error('Error during logout:', error);
      throw new Error(`Logout failed: ${error.message}`);
    }
  }

  /**
   * Verify JWT token and get user session
   * @param {string} token - JWT token
   * @returns {Promise<Object>} User session data
   */
  async verifyTokenAndGetSession(token) {
    try {
      // First verify JWT
      const decoded = this.verifyJWT(token);
      
      // Then check database session
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const session = await databaseService.findUserSession(tokenHash);
      
      if (!session) {
        throw new Error('Session not found or expired');
      }
      
      return {
        user: session.profile,
        session: session
      };
    } catch (error) {
      console.error('Error verifying token:', error);
      throw new Error(`Token verification failed: ${error.message}`);
    }
  }

  /**
   * Get profile by phone number and role
   * @param {string} phoneNumber - Phone number
   * @param {string} role - User role ('buyer' or 'manufacturer')
   * @returns {Promise<Object>} Profile data
   */
  async getProfileByPhone(phoneNumber, role) {
    try {
      if (role === 'buyer') {
        return await databaseService.findBuyerProfileByPhone(phoneNumber);
      } else if (role === 'manufacturer') {
        return await databaseService.findManufacturerProfileByPhone(phoneNumber);
      }
      throw new Error('Invalid role specified');
    } catch (error) {
      console.error('Error getting profile by phone:', error);
      throw error;
    }
  }

  /**
   * Get manufacturer profile by profile ID
   * @param {string} profileId - Profile ID
   * @returns {Promise<Object>} Manufacturer profile data
   */
  async getManufacturerProfile(profileId) {
    try {
      return await databaseService.findManufacturerProfile(profileId);
    } catch (error) {
      console.error('Error getting manufacturer profile:', error);
      throw error;
    }
  }

  /**
   * Update manufacturer profile
   * @param {string} profileId - Profile ID
   * @param {Object} profileData - Profile data to update
   * @returns {Promise<Object>} Updated profile data
   */
  async updateManufacturerProfile(profileId, profileData) {
    try {
      return await databaseService.updateManufacturerProfile(profileId, profileData);
    } catch (error) {
      console.error('Error updating manufacturer profile:', error);
      throw error;
    }
  }

  /**
   * Get buyer profile by profile ID
   * @param {string} profileId - Profile ID
   * @returns {Promise<Object>} Buyer profile data
   */
  async getBuyerProfile(profileId) {
    try {
      return await databaseService.findBuyerProfile(profileId);
    } catch (error) {
      console.error('Error getting buyer profile:', error);
      throw error;
    }
  }

  /**
   * Update buyer profile
   * @param {string} profileId - Profile ID
   * @param {Object} profileData - Profile data to update
   * @returns {Promise<Object>} Updated profile data
   */
  async updateBuyerProfile(profileId, profileData) {
    try {
      return await databaseService.updateBuyerProfile(profileId, profileData);
    } catch (error) {
      console.error('Error updating buyer profile:', error);
      throw error;
    }
  }

  /**
   * Create manufacturer profile
   * @param {string} phoneNumber - Phone number
   * @returns {Promise<Object>} Created profile data
   */
  async createManufacturerProfile(phoneNumber) {
    try {
      const profileData = {
        phone_number: phoneNumber,
        is_verified: true,
        last_login: new Date().toISOString()
      };
      return await databaseService.createManufacturerProfile(profileData);
    } catch (error) {
      console.error('Error creating manufacturer profile:', error);
      throw error;
    }
  }

  /**
   * Submit manufacturer onboarding data
   * @param {string} profileId - Profile ID
   * @param {Object} onboardingData - Onboarding data
   * @returns {Promise<Object>} Updated profile data
   */
  async submitManufacturerOnboarding(profileId, onboardingData) {
    try {
      return await databaseService.updateManufacturerProfile(profileId, onboardingData);
    } catch (error) {
      console.error('Error submitting manufacturer onboarding:', error);
      throw error;
    }
  }

  async createBuyerProfile(phoneNumber) {
    try {
      const profileData = {
        phone_number: phoneNumber,
        last_login: new Date().toISOString()
      };
      return await databaseService.createBuyerProfile(profileData);
    } catch (error) {
      console.error('Error creating buyer profile:', error);
      throw error;
    }
  }

  async submitBuyerOnboarding(profileId, onboardingData) {
    try {
      return await databaseService.updateBuyerProfile(profileId, onboardingData);
    } catch (error) {
      console.error('Error submitting buyer onboarding:', error);
      throw error;
    }
  }

  /**
   * Clean up expired OTPs and sessions
   */
  async cleanupExpiredData() {
    try {
      const otpCount = await databaseService.cleanupExpiredOTPs();
      const sessionCount = await databaseService.cleanupExpiredSessions();
      
      console.log(`Cleanup completed: ${otpCount} expired OTPs, ${sessionCount} expired sessions removed`);
      
      return {
        expiredOTPs: otpCount,
        expiredSessions: sessionCount
      };
    } catch (error) {
      console.error('Error during cleanup:', error);
      throw error;
    }
  }
}

// Clean up expired data every 5 minutes
setInterval(async () => {
  try {
    const authService = new AuthService();
    await authService.cleanupExpiredData();
  } catch (error) {
    console.error('Scheduled cleanup failed:', error);
  }
}, 5 * 60 * 1000);

module.exports = new AuthService();
