const supabase = require('../config/supabase');

class DatabaseService {
  /**
   * Create a new buyer profile
   * @param {Object} profileData - Buyer profile data
   * @returns {Promise<Object>} Created buyer profile
   */
  async createBuyerProfile(profileData) {
    try {
      const { data, error } = await supabase
        .from('buyer_profiles')
        .insert([profileData])
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create buyer profile: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('DatabaseService.createBuyerProfile error:', error);
      throw error;
    }
  }

  /**
   * Create a new manufacturer profile
   * @param {Object} profileData - Manufacturer profile data
   * @returns {Promise<Object>} Created manufacturer profile
   */
  async createManufacturerProfile(profileData) {
    try {
      const { data, error } = await supabase
        .from('manufacturer_profiles')
        .insert([profileData])
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create manufacturer profile: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('DatabaseService.createManufacturerProfile error:', error);
      throw error;
    }
  }

  /**
   * Find buyer profile by phone number
   * @param {string} phoneNumber - Phone number
   * @returns {Promise<Object|null>} Buyer profile data or null
   */
  async findBuyerProfileByPhone(phoneNumber) {
    try {
      const { data, error } = await supabase
        .from('buyer_profiles')
        .select('*')
        .eq('phone_number', phoneNumber)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        throw new Error(`Failed to find buyer profile: ${error.message}`);
      }

      return data || null;
    } catch (error) {
      console.error('DatabaseService.findBuyerProfileByPhone error:', error);
      throw error;
    }
  }

  /**
   * Find manufacturer profile by phone number
   * @param {string} phoneNumber - Phone number
   * @returns {Promise<Object|null>} Manufacturer profile data or null
   */
  async findManufacturerProfileByPhone(phoneNumber) {
    try {
      const { data, error } = await supabase
        .from('manufacturer_profiles')
        .select('*')
        .eq('phone_number', phoneNumber)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        throw new Error(`Failed to find manufacturer profile: ${error.message}`);
      }

      return data || null;
    } catch (error) {
      console.error('DatabaseService.findManufacturerProfileByPhone error:', error);
      throw error;
    }
  }

  /**
   * Update buyer profile data
   * @param {string} phoneNumber - Phone number
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated buyer profile
   */
  async updateBuyerProfileByPhone(phoneNumber, updateData) {
    try {
      const { data, error } = await supabase
        .from('buyer_profiles')
        .update(updateData)
        .eq('phone_number', phoneNumber)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update buyer profile: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('DatabaseService.updateBuyerProfileByPhone error:', error);
      throw error;
    }
  }

  /**
   * Update manufacturer profile data
   * @param {string} phoneNumber - Phone number
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated manufacturer profile
   */
  async updateManufacturerProfileByPhone(phoneNumber, updateData) {
    try {
      const { data, error } = await supabase
        .from('manufacturer_profiles')
        .update(updateData)
        .eq('phone_number', phoneNumber)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update manufacturer profile: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('DatabaseService.updateManufacturerProfileByPhone error:', error);
      throw error;
    }
  }

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
      console.error('DatabaseService.storeOTPSession error:', error);
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
      console.error('DatabaseService.findOTPSession error:', error);
      throw error;
    }
  }

  /**
   * Update OTP session
   * @param {string} phoneNumber - Phone number
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated OTP session
   */
  async updateOTPSession(phoneNumber, updateData) {
    try {
      const { data, error } = await supabase
        .from('otp_sessions')
        .update(updateData)
        .eq('phone_number', phoneNumber)
        .order('created_at', { ascending: false })
        .limit(1)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update OTP session: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('DatabaseService.updateOTPSession error:', error);
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
      console.error('DatabaseService.storeUserSession error:', error);
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
      console.error('DatabaseService.findUserSession error:', error);
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
      console.error('DatabaseService.deactivateUserSession error:', error);
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
      console.error('DatabaseService.cleanupExpiredOTPs error:', error);
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
      console.error('DatabaseService.cleanupExpiredSessions error:', error);
      throw error;
    }
  }


  /**
   * Find manufacturer profile by profile ID
   * @param {string} profileId - Profile ID
   * @returns {Promise<Object>} Manufacturer profile data
   */
  async findManufacturerProfile(profileId) {
    try {
      const { data, error } = await supabase
        .from('manufacturer_profiles')
        .select('*')
        .eq('id', profileId)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 is "not found"
        throw new Error(`Failed to find manufacturer profile: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('DatabaseService.findManufacturerProfile error:', error);
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
      // First check if profile exists
      const existingProfile = await this.findManufacturerProfile(profileId);
      
      if (existingProfile) {
        // Update existing profile
        const { data, error } = await supabase
          .from('manufacturer_profiles')
          .update({
            ...profileData,
            updated_at: new Date().toISOString()
          })
          .eq('id', profileId)
          .select()
          .single();

        if (error) {
          throw new Error(`Failed to update manufacturer profile: ${error.message}`);
        }

        return data;
      } else {
        throw new Error('Manufacturer profile not found');
      }
    } catch (error) {
      console.error('DatabaseService.updateManufacturerProfile error:', error);
      throw error;
    }
  }

  /**
   * Find buyer profile by profile ID
   * @param {string} profileId - Profile ID
   * @returns {Promise<Object>} Buyer profile data
   */
  async findBuyerProfile(profileId) {
    try {
      const { data, error } = await supabase
        .from('buyer_profiles')
        .select('*')
        .eq('id', profileId)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 is "not found"
        throw new Error(`Failed to find buyer profile: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('DatabaseService.findBuyerProfile error:', error);
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
      // First check if profile exists
      const existingProfile = await this.findBuyerProfile(profileId);
      
      if (existingProfile) {
        // Update existing profile
        const { data, error } = await supabase
          .from('buyer_profiles')
          .update({
            ...profileData,
            updated_at: new Date().toISOString()
          })
          .eq('id', profileId)
          .select()
          .single();

        if (error) {
          throw new Error(`Failed to update buyer profile: ${error.message}`);
        }

        return data;
      } else {
        throw new Error('Buyer profile not found');
      }
    } catch (error) {
      console.error('DatabaseService.updateBuyerProfile error:', error);
      throw error;
    }
  }
}

module.exports = new DatabaseService();
