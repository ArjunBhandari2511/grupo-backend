const twilio = require('twilio');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// In-memory storage for OTPs (in production, use Redis or database)
const otpStorage = new Map();

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
   * @returns {Promise<Object>} Result object
   */
  async sendOTP(phoneNumber) {
    try {
      // Validate phone number format
      if (!this.isValidPhoneNumber(phoneNumber)) {
        throw new Error('Invalid phone number format');
      }

      // Generate new OTP
      const otp = this.generateOTP();
      const expiryTime = new Date(Date.now() + (parseInt(process.env.OTP_EXPIRY_MINUTES) || 5) * 60 * 1000);

      // Store OTP with metadata
      const rateLimitKey = `otp_${phoneNumber}`;
      otpStorage.set(rateLimitKey, {
        otp,
        phoneNumber,
        createdAt: new Date(),
        expiresAt: expiryTime,
        verified: false
      });

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
   * Verify OTP
   * @param {string} phoneNumber - Phone number
   * @param {string} otp - OTP to verify
   * @returns {Promise<Object>} Result object
   */
  async verifyOTP(phoneNumber, otp) {
    try {
      const rateLimitKey = `otp_${phoneNumber}`;
      const storedOTP = otpStorage.get(rateLimitKey);

      if (!storedOTP) {
        throw new Error('OTP not found or expired');
      }

      // Check if OTP has expired
      if (new Date() > storedOTP.expiresAt) {
        otpStorage.delete(rateLimitKey);
        throw new Error('OTP has expired');
      }

      // Check if already verified
      if (storedOTP.verified) {
        throw new Error('OTP has already been used');
      }

      // Verify OTP
      if (storedOTP.otp !== otp) {
        throw new Error('Invalid OTP');
      }

      // Mark as verified
      storedOTP.verified = true;
      otpStorage.set(rateLimitKey, storedOTP);

      // Generate JWT token
      const token = this.generateJWT(phoneNumber);

      return {
        success: true,
        message: 'OTP verified successfully',
        token,
        user: {
          phoneNumber,
          verified: true
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
   * Clean up expired OTPs
   */
  cleanupExpiredOTPs() {
    const now = new Date();
    for (const [key, value] of otpStorage.entries()) {
      if (now > value.expiresAt) {
        otpStorage.delete(key);
      }
    }
  }
}

// Clean up expired OTPs every 5 minutes
setInterval(() => {
  const authService = new AuthService();
  authService.cleanupExpiredOTPs();
}, 5 * 60 * 1000);

module.exports = new AuthService();
