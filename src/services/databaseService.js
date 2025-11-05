const supabase = require('../config/supabase');

class DatabaseService {
  /**
   * Get or create a conversation between a buyer and a manufacturer
   */
  async getOrCreateConversation(buyerId, manufacturerId) {
    try {
      // Try to find existing
      let { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('buyer_id', buyerId)
        .eq('manufacturer_id', manufacturerId)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw new Error(`Failed to fetch conversation: ${error.message}`);
      }

      if (!data) {
        // Create new conversation
        const insert = await supabase
          .from('conversations')
          .insert([{ buyer_id: buyerId, manufacturer_id: manufacturerId }])
          .select('*')
          .single();
        if (insert.error) {
          // If unique constraint hit due to race, fetch again
          if (insert.error.code === '23505') {
            const retry = await supabase
              .from('conversations')
              .select('*')
              .eq('buyer_id', buyerId)
              .eq('manufacturer_id', manufacturerId)
              .single();
            if (retry.error) throw new Error(`Failed to fetch conversation after conflict: ${retry.error.message}`);
            return retry.data;
          }
          throw new Error(`Failed to create conversation: ${insert.error.message}`);
        }
        return insert.data;
      }

      return data;
    } catch (error) {
      console.error('DatabaseService.getOrCreateConversation error:', error);
      throw error;
    }
  }

  /**
   * List conversations for a user based on role
   */
  async listConversations(userId, role, { search, limit = 50, cursor } = {}) {
    try {
      let query = supabase
        .from('conversations')
        .select('*')
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit);

      if (role === 'buyer') {
        query = query.eq('buyer_id', userId);
      } else if (role === 'manufacturer') {
        query = query.eq('manufacturer_id', userId);
      }

      if (cursor) {
        query = query.lt('last_message_at', cursor);
      }

      if (search && typeof search === 'string' && search.trim().length > 0) {
        query = query.ilike('last_message_text', `%${search.trim()}%`);
      }

      const { data, error } = await query;
      if (error) {
        throw new Error(`Failed to list conversations: ${error.message}`);
      }
      return data || [];
    } catch (error) {
      console.error('DatabaseService.listConversations error:', error);
      throw error;
    }
  }

  /**
   * Check if user is participant of conversation
   */
  async getConversation(conversationId) {
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .single();
    if (error) {
      throw new Error(`Failed to fetch conversation: ${error.message}`);
    }
    return data;
  }

  /**
   * List messages for a conversation
   */
  async listMessages(conversationId, { before, limit = 50 } = {}) {
    try {
      let query = supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (before) {
        query = query.lt('created_at', before);
      }

      const { data, error } = await query;
      if (error) {
        throw new Error(`Failed to list messages: ${error.message}`);
      }
      // return in ascending chronological order for UI
      return (data || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    } catch (error) {
      console.error('DatabaseService.listMessages error:', error);
      throw error;
    }
  }

  /**
   * Insert a new message and update conversation summary
   */
  async insertMessage(conversationId, senderRole, senderId, body, clientTempId) {
    try {
      const { data, error } = await supabase
        .from('messages')
        .insert([{ conversation_id: conversationId, sender_role: senderRole, sender_id: senderId, body, client_temp_id: clientTempId }])
        .select('*')
        .single();
      if (error) {
        throw new Error(`Failed to insert message: ${error.message}`);
      }

      const updated = await supabase
        .from('conversations')
        .update({ last_message_at: data.created_at, last_message_text: body })
        .eq('id', conversationId)
        .select('id')
        .single();
      if (updated.error) {
        console.warn('Failed to update conversation summary:', updated.error.message);
      }

      return data;
    } catch (error) {
      console.error('DatabaseService.insertMessage error:', error);
      throw error;
    }
  }

  /**
   * Mark messages as read up to a timestamp (or up to a message id)
   */
  async markRead(conversationId, readerUserId, upToIsoTimestamp) {
    try {
      const { data, error } = await supabase
        .from('messages')
        .update({ is_read: true })
        .eq('conversation_id', conversationId)
        .lt('created_at', upToIsoTimestamp)
        .neq('sender_id', readerUserId)
        .select('id');
      if (error) {
        throw new Error(`Failed to mark messages read: ${error.message}`);
      }
      return Array.isArray(data) ? data.length : 0;
    } catch (error) {
      console.error('DatabaseService.markRead error:', error);
      throw error;
    }
  }

  /**
   * Mark messages as read up to a specific message id (resolves its timestamp)
   */
  async markReadByMessageId(conversationId, readerUserId, role, upToMessageId) {
    try {
      let upTo = new Date().toISOString();
      if (upToMessageId) {
        const { data: msg, error: msgErr } = await supabase
          .from('messages')
          .select('created_at, conversation_id')
          .eq('id', upToMessageId)
          .single();
        if (!msgErr && msg && msg.conversation_id === conversationId) {
          upTo = msg.created_at;
        }
      }

      return await this.markRead(conversationId, readerUserId, upTo);
    } catch (error) {
      console.error('DatabaseService.markReadByMessageId error:', error);
      throw error;
    }
  }
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
      console.error('DatabaseService.expireActiveOtps error:', error);
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

  /**
   * Get all manufacturers
   * @param {Object} options - Query options (filters, sorting, pagination)
   * @returns {Promise<Array>} Array of manufacturer profiles
   */
  async getAllManufacturers(options = {}) {
    try {
      let query = supabase.from('manufacturer_profiles').select('*');

      // Apply filters if provided
      if (options.verified !== undefined) {
        query = query.eq('is_verified', options.verified);
      }

      if (options.verification_status) {
        query = query.eq('verification_status', options.verification_status);
      }

      if (options.onboarding_completed !== undefined) {
        query = query.eq('onboarding_completed', options.onboarding_completed);
      }

      if (options.business_type) {
        query = query.eq('business_type', options.business_type);
      }

      // Apply sorting
      if (options.sortBy) {
        const ascending = options.sortOrder === 'asc';
        query = query.order(options.sortBy, { ascending });
      } else {
        // Default sorting by created_at descending
        query = query.order('created_at', { ascending: false });
      }

      // Apply pagination
      if (options.limit) {
        query = query.limit(options.limit);
      }

      if (options.offset) {
        query = query.range(options.offset, options.offset + (options.limit || 100) - 1);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(`Failed to fetch manufacturers: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('DatabaseService.getAllManufacturers error:', error);
      throw error;
    }
  }

  /**
   * Get all buyers
   * @param {Object} options - Query options (filters, sorting, pagination)
   * @returns {Promise<Array>} Array of buyer profiles
   */
  async getAllBuyers(options = {}) {
    try {
      let query = supabase.from('buyer_profiles').select('*');

      // Apply filters if provided
      if (options.verified !== undefined) {
        query = query.eq('is_verified', options.verified);
      }

      if (options.verification_status) {
        query = query.eq('verification_status', options.verification_status);
      }

      if (options.onboarding_completed !== undefined) {
        query = query.eq('onboarding_completed', options.onboarding_completed);
      }

      // Apply sorting
      if (options.sortBy) {
        const ascending = options.sortOrder === 'asc';
        query = query.order(options.sortBy, { ascending });
      } else {
        // Default sorting by created_at descending
        query = query.order('created_at', { ascending: false });
      }

      // Apply pagination
      if (options.limit) {
        query = query.limit(options.limit);
      }

      if (options.offset) {
        query = query.range(options.offset, options.offset + (options.limit || 100) - 1);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(`Failed to fetch buyers: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('DatabaseService.getAllBuyers error:', error);
      throw error;
    }
  }
}

module.exports = new DatabaseService();
