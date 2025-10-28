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

      // Generate new OTP
      const otp = this.generateOTP();
      const expiryTime = new Date(Date.now() + (parseInt(process.env.OTP_EXPIRY_MINUTES) || 5) * 60 * 1000);

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
        body: `Your Grupo verification code is: ${otp}. This code expires in ${process.env.OTP_EXPIRY_MINUTES || 5} minutes.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phoneNumber
      });

      console.log(`OTP sent to ${phoneNumber}. Message SID: ${message.sid}`);

      return {
        success: true,
        message: 'OTP sent successfully',
        messageSid: message.sid,
        expiresIn: process.env.OTP_EXPIRY_MINUTES || 5
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
   * Verify OTP and create/update user
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
        // Increment attempts
        await databaseService.updateOTPSession(phoneNumber, {
          attempts: storedOTP.attempts + 1
        });
        throw new Error('Invalid OTP');
      }

      // Mark OTP as verified
      await databaseService.updateOTPSession(phoneNumber, {
        is_verified: true
      });

      // Check if user exists, create if not
      let user = await databaseService.findUserByPhone(phoneNumber);
      
      if (!user) {
        // Create new user
        const userData = {
          phone_number: phoneNumber,
          role: role,
          is_verified: true,
          last_login: new Date().toISOString()
        };
        user = await databaseService.createUser(userData);
        console.log(`New ${role} user created: ${phoneNumber}`);
      } else {
        // Update existing user
        await databaseService.updateUser(phoneNumber, {
          is_verified: true,
          last_login: new Date().toISOString()
        });
        console.log(`Existing user verified: ${phoneNumber}`);
      }

      // Generate JWT token
      const token = this.generateJWT(phoneNumber);

      // Store user session in database
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const sessionData = {
        user_id: user.id,
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
      };
      await databaseService.storeUserSession(sessionData);

      return {
        success: true,
        message: 'OTP verified successfully',
        token,
        user: {
          id: user.id,
          phoneNumber: user.phone_number,
          role: user.role,
          verified: user.is_verified
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
   * @returns {string} JWT token
   */
  generateJWT(phoneNumber) {
    const payload = {
      phoneNumber,
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
        user: session.users,
        session: session
      };
    } catch (error) {
      console.error('Error verifying token:', error);
      throw new Error(`Token verification failed: ${error.message}`);
    }
  }

  /**
   * Get user by phone number
   * @param {string} phoneNumber - Phone number
   * @returns {Promise<Object>} User data
   */
  async getUserByPhone(phoneNumber) {
    try {
      return await databaseService.findUserByPhone(phoneNumber);
    } catch (error) {
      console.error('Error getting user by phone:', error);
      throw error;
    }
  }

  /**
   * Get manufacturer profile by user ID
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Manufacturer profile data
   */
  async getManufacturerProfile(userId) {
    try {
      return await databaseService.findManufacturerProfile(userId);
    } catch (error) {
      console.error('Error getting manufacturer profile:', error);
      throw error;
    }
  }

  /**
   * Update manufacturer profile
   * @param {string} userId - User ID
   * @param {Object} profileData - Profile data to update
   * @returns {Promise<Object>} Updated profile data
   */
  async updateManufacturerProfile(userId, profileData) {
    try {
      return await databaseService.updateManufacturerProfile(userId, profileData);
    } catch (error) {
      console.error('Error updating manufacturer profile:', error);
      throw error;
    }
  }

  /**
   * Get buyer profile by user ID
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Buyer profile data
   */
  async getBuyerProfile(userId) {
    try {
      return await databaseService.findBuyerProfile(userId);
    } catch (error) {
      console.error('Error getting buyer profile:', error);
      throw error;
    }
  }

  /**
   * Update buyer profile
   * @param {string} userId - User ID
   * @param {Object} profileData - Profile data to update
   * @returns {Promise<Object>} Updated profile data
   */
  async updateBuyerProfile(userId, profileData) {
    try {
      return await databaseService.updateBuyerProfile(userId, profileData);
    } catch (error) {
      console.error('Error updating buyer profile:', error);
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
