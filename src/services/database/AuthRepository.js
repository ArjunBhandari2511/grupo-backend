/**
 * Auth Repository - OTP sessions and User sessions management
 */
const { supabase } = require('./BaseRepository');

class AuthRepository {
  /**
   * Store OTP session
   * @param {Object} otpData - OTP session data
   * @returns {Promise<Object>} Stored OTP session
   */
  async storeOTPSession(otpData) {
    try {
      const { data, error } = await supabase
        .from('otp_sessions')
        .insert([otpData])
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to store OTP session: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('AuthRepository.storeOTPSession error:', error);
      throw error;
    }
  }

  /**
   * Expire any active (unverified and unexpired) OTPs for a phone number
   * @param {string} phoneNumber - Phone number
   * @returns {Promise<number>} number of rows updated
   */
  async expireActiveOtps(phoneNumber) {
    try {
      const { data, error } = await supabase
        .from('otp_sessions')
        .update({ expires_at: new Date().toISOString() })
        .eq('phone_number', phoneNumber)
        .eq('is_verified', false)
        .gt('expires_at', new Date().toISOString())
        .select('id');

      if (error) {
        throw new Error(`Failed to expire previous OTPs: ${error.message}`);
      }

      return Array.isArray(data) ? data.length : 0;
    } catch (error) {
      console.error('AuthRepository.expireActiveOtps error:', error);
      throw error;
    }
  }

  /**
   * Find OTP session by phone number
   * @param {string} phoneNumber - Phone number
   * @returns {Promise<Object|null>} OTP session or null
   */
  async findOTPSession(phoneNumber) {
    try {
      const { data, error } = await supabase
        .from('otp_sessions')
        .select('*')
        .eq('phone_number', phoneNumber)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw new Error(`Failed to find OTP session: ${error.message}`);
      }

      return data || null;
    } catch (error) {
      console.error('AuthRepository.findOTPSession error:', error);
      throw error;
    }
  }

  /**
   * Update OTP session
   * @param {string} sessionId - Session ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated OTP session
   */
  async updateOTPSession(sessionId, updateData) {
    try {
      const { data, error } = await supabase
        .from('otp_sessions')
        .update(updateData)
        .eq('id', sessionId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update OTP session: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('AuthRepository.updateOTPSession error:', error);
      throw error;
    }
  }

  /**
   * Store user session
   * @param {Object} sessionData - Session data with profile_id and profile_type
   * @returns {Promise<Object>} Stored session
   */
  async storeUserSession(sessionData) {
    try {
      const { data, error } = await supabase
        .from('user_sessions')
        .insert([sessionData])
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to store user session: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('AuthRepository.storeUserSession error:', error);
      throw error;
    }
  }

  /**
   * Find active user session
   * @param {string} tokenHash - Token hash
   * @returns {Promise<Object|null>} Session with profile data or null
   */
  async findUserSession(tokenHash) {
    try {
      const { data, error } = await supabase
        .from('user_sessions')
        .select('*')
        .eq('token_hash', tokenHash)
        .eq('is_active', true)
        .gt('expires_at', new Date().toISOString())
        .single();

      if (error && error.code !== 'PGRST116') {
        throw new Error(`Failed to find user session: ${error.message}`);
      }

      if (!data) {
        return null;
      }

      // Get the profile data based on profile_type
      let profileData = null;
      if (data.profile_type === 'buyer') {
        const { data: buyerProfile, error: buyerError } = await supabase
          .from('buyer_profiles')
          .select('*')
          .eq('id', data.profile_id)
          .single();
        
        if (!buyerError) {
          profileData = buyerProfile;
        }
      } else if (data.profile_type === 'manufacturer') {
        const { data: manufacturerProfile, error: manufacturerError } = await supabase
          .from('manufacturer_profiles')
          .select('*')
          .eq('id', data.profile_id)
          .single();
        
        if (!manufacturerError) {
          profileData = manufacturerProfile;
        }
      }

      return {
        ...data,
        profile: profileData
      };
    } catch (error) {
      console.error('AuthRepository.findUserSession error:', error);
      throw error;
    }
  }

  /**
   * Deactivate user session
   * @param {string} tokenHash - Token hash
   * @returns {Promise<Object>} Updated session
   */
  async deactivateUserSession(tokenHash) {
    try {
      const { data, error } = await supabase
        .from('user_sessions')
        .update({ is_active: false })
        .eq('token_hash', tokenHash)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to deactivate user session: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('AuthRepository.deactivateUserSession error:', error);
      throw error;
    }
  }

  /**
   * Get daily OTP send count for a phone number
   * @param {string} phoneNumber - Phone number
   * @returns {Promise<number>} Number of OTPs sent in the last 24 hours
   */
  async getDailyOTPCount(phoneNumber) {
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('otp_sessions')
        .select('id')
        .eq('phone_number', phoneNumber)
        .gte('created_at', oneDayAgo);

      if (error) {
        throw new Error(`Failed to get daily OTP count: ${error.message}`);
      }

      return data ? data.length : 0;
    } catch (error) {
      console.error('AuthRepository.getDailyOTPCount error:', error);
      throw error;
    }
  }

  /**
   * Clean up expired OTPs
   * @returns {Promise<number>} Number of deleted OTPs
   */
  async cleanupExpiredOTPs() {
    try {
      const { data, error } = await supabase
        .rpc('cleanup_expired_otps');

      if (error) {
        throw new Error(`Failed to cleanup expired OTPs: ${error.message}`);
      }

      return data || 0;
    } catch (error) {
      console.error('AuthRepository.cleanupExpiredOTPs error:', error);
      throw error;
    }
  }

  /**
   * Clean up expired sessions
   * @returns {Promise<number>} Number of deleted sessions
   */
  async cleanupExpiredSessions() {
    try {
      const { data, error } = await supabase
        .rpc('cleanup_expired_sessions');

      if (error) {
        throw new Error(`Failed to cleanup expired sessions: ${error.message}`);
      }

      return data || 0;
    } catch (error) {
      console.error('AuthRepository.cleanupExpiredSessions error:', error);
      throw error;
    }
  }
}

module.exports = new AuthRepository();

