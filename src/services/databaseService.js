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
      const conversations = data || [];

      const withUnreadCounts = await Promise.all(
        conversations.map(async (conversation) => {
          try {
            const { count, error: unreadError } = await supabase
              .from('messages')
              .select('id', { count: 'exact', head: true })
              .eq('conversation_id', conversation.id)
              .eq('is_read', false)
              .neq('sender_id', userId);

            if (unreadError) {
              throw unreadError;
            }

            return {
              ...conversation,
              unread_count: typeof count === 'number' ? count : 0
            };
          } catch (unreadCountError) {
            console.error('DatabaseService.listConversations unread count error:', unreadCountError);
            return {
              ...conversation,
              unread_count: 0
            };
          }
        })
      );

      return withUnreadCounts;
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
   * Insert a new message and update conversation summary
   */
  async insertMessage(conversationId, senderRole, senderId, body, clientTempId, summaryText, requirementId = null, aiDesignId = null) {
    try {
      const messageData = {
        conversation_id: conversationId,
        sender_role: senderRole,
        sender_id: senderId,
        body,
        client_temp_id: clientTempId
      };
      
      if (requirementId) {
        messageData.requirement_id = requirementId;
      }
      
      if (aiDesignId) {
        messageData.ai_design_id = aiDesignId;
      }

      const { data, error } = await supabase
        .from('messages')
        .insert([messageData])
        .select('*')
        .single();
      if (error) {
        throw new Error(`Failed to insert message: ${error.message}`);
      }

      const updated = await supabase
        .from('conversations')
        .update({ last_message_at: data.created_at, last_message_text: summaryText ?? body })
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
   * Insert message attachments
   * @param {string} messageId - Message ID
   * @param {Array} attachments - Array of attachment objects
   * @returns {Promise<Array>} Array of inserted attachments
   */
  async insertMessageAttachments(messageId, attachments) {
    try {
      if (!attachments || attachments.length === 0) {
        return [];
      }

      const attachmentRecords = attachments.map(att => ({
        message_id: messageId,
        file_url: att.url,
        mime_type: att.mimeType,
        size_bytes: att.size,
        file_type: att.fileType,
        original_name: att.originalName,
        public_id: att.publicId,
        thumbnail_url: att.thumbnail,
        width: att.width,
        height: att.height,
        duration: att.duration
      }));

      const { data, error } = await supabase
        .from('message_attachments')
        .insert(attachmentRecords)
        .select('*');

      if (error) {
        throw new Error(`Failed to insert attachments: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('DatabaseService.insertMessageAttachments error:', error);
      throw error;
    }
  }

  /**
   * Get messages with attachments
   * @param {string} conversationId - Conversation ID
   * @param {Object} options - Query options (before, limit, requirementId)
   * @returns {Promise<Array>} Array of messages with attachments
   */
  async listMessagesWithAttachments(conversationId, { before, limit = 50, requirementId = null, aiDesignId = null } = {}) {
    try {
      let query = supabase
        .from('messages')
        .select(`
          *,
          attachments:message_attachments(*)
        `)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (before) {
        query = query.lt('created_at', before);
      }

      // Filter by requirement_id if provided
      if (requirementId) {
        query = query.eq('requirement_id', requirementId);
      }
      
      // Filter by ai_design_id if provided
      if (aiDesignId) {
        query = query.eq('ai_design_id', aiDesignId);
      }

      const { data, error } = await query;
      if (error) {
        throw new Error(`Failed to list messages with attachments: ${error.message}`);
      }
      // return in ascending chronological order for UI
      return (data || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    } catch (error) {
      console.error('DatabaseService.listMessagesWithAttachments error:', error);
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
      console.error('DatabaseService.getDailyOTPCount error:', error);
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

  // =============================================
  // REQUIREMENTS METHODS
  // =============================================

  /**
   * Create a new requirement
   * @param {Object} requirementData - Requirement data
   * @returns {Promise<Object>} Created requirement
   */
  async createRequirement(requirementData) {
    try {
      const { data, error } = await supabase
        .from('requirements')
        .insert([requirementData])
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create requirement: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('DatabaseService.createRequirement error:', error);
      throw error;
    }
  }

  /**
   * Get requirements for a buyer
   * @param {string} buyerId - Buyer profile ID
   * @param {Object} options - Query options (filters, sorting, pagination)
   * @returns {Promise<Array>} Array of requirements
   */
  async getBuyerRequirements(buyerId, options = {}) {
    try {
      let query = supabase
        .from('requirements')
        .select('*')
        .eq('buyer_id', buyerId);

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
        throw new Error(`Failed to fetch requirements: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('DatabaseService.getBuyerRequirements error:', error);
      throw error;
    }
  }

  /**
   * Get a single requirement by ID
   * @param {string} requirementId - Requirement ID
   * @returns {Promise<Object>} Requirement data
   */
  async getRequirement(requirementId) {
    try {
      const { data, error } = await supabase
        .from('requirements')
        .select('*')
        .eq('id', requirementId)
        .single();

      if (error) {
        throw new Error(`Failed to fetch requirement: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('DatabaseService.getRequirement error:', error);
      throw error;
    }
  }

  /**
   * Update a requirement
   * @param {string} requirementId - Requirement ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated requirement
   */
  async updateRequirement(requirementId, updateData) {
    try {
      const { data, error } = await supabase
        .from('requirements')
        .update({
          ...updateData,
          updated_at: new Date().toISOString()
        })
        .eq('id', requirementId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update requirement: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('DatabaseService.updateRequirement error:', error);
      throw error;
    }
  }

  /**
   * Delete a requirement
   * @param {string} requirementId - Requirement ID
   * @returns {Promise<boolean>} Success status
   */
  async deleteRequirement(requirementId) {
    try {
      const { error } = await supabase
        .from('requirements')
        .delete()
        .eq('id', requirementId);

      if (error) {
        throw new Error(`Failed to delete requirement: ${error.message}`);
      }

      return true;
    } catch (error) {
      console.error('DatabaseService.deleteRequirement error:', error);
      throw error;
    }
  }

  /**
   * Get buyer requirement statistics
   * @param {string} buyerId - Buyer ID
   * @returns {Promise<Object>} Statistics object with total, accepted, pending_review, in_negotiation counts
   */
  async getBuyerRequirementStatistics(buyerId) {
    try {
      // Get total requirements count
      const { count: totalCount, error: totalError } = await supabase
        .from('requirements')
        .select('id', { count: 'exact', head: true })
        .eq('buyer_id', buyerId);

      if (totalError) {
        throw new Error(`Failed to fetch total requirements: ${totalError.message}`);
      }

      // Get all requirements for this buyer
      const { data: requirements, error: requirementsError } = await supabase
        .from('requirements')
        .select('id')
        .eq('buyer_id', buyerId);

      if (requirementsError) {
        throw new Error(`Failed to fetch requirements: ${requirementsError.message}`);
      }

      const requirementIds = (requirements || []).map(r => r.id);

      if (requirementIds.length === 0) {
        return {
          total: 0,
          accepted: 0,
          pending_review: 0,
          in_negotiation: 0
        };
      }

      // Get all responses for these requirements
      const { data: responses, error: responsesError } = await supabase
        .from('requirement_responses')
        .select('requirement_id, status')
        .in('requirement_id', requirementIds);

      if (responsesError) {
        throw new Error(`Failed to fetch responses: ${responsesError.message}`);
      }

      // Group responses by requirement_id
      const requirementResponseMap = new Map();
      (responses || []).forEach(response => {
        if (!requirementResponseMap.has(response.requirement_id)) {
          requirementResponseMap.set(response.requirement_id, []);
        }
        requirementResponseMap.get(response.requirement_id).push(response.status);
      });

      // Calculate statistics
      let accepted = 0;
      let in_negotiation = 0;
      let pending_review = 0;

      requirementIds.forEach(requirementId => {
        const responseStatuses = requirementResponseMap.get(requirementId) || [];
        
        if (responseStatuses.length === 0) {
          // No responses = pending review
          pending_review++;
        } else {
          // Check if any response is accepted
          if (responseStatuses.includes('accepted')) {
            accepted++;
          }
          // Check if any response is negotiating
          else if (responseStatuses.includes('negotiating')) {
            in_negotiation++;
          } else {
            // Has responses but none are accepted or negotiating = pending review
            pending_review++;
          }
        }
      });

      return {
        total: totalCount || 0,
        accepted,
        pending_review,
        in_negotiation
      };
    } catch (error) {
      console.error('DatabaseService.getBuyerRequirementStatistics error:', error);
      throw error;
    }
  }

  /**
   * Get all requirements (for manufacturers to view)
   * @param {Object} options - Query options (filters, sorting, pagination)
   * @returns {Promise<Array>} Array of requirements with buyer info
   */
  async getAllRequirements(options = {}) {
    try {
      let query = supabase
        .from('requirements')
        .select(`
          *,
          buyer:buyer_profiles(id, full_name, phone_number, business_address)
        `);

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
        throw new Error(`Failed to fetch all requirements: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('DatabaseService.getAllRequirements error:', error);
      throw error;
    }
  }

  // =============================================
  // REQUIREMENT RESPONSES METHODS
  // =============================================

  /**
   * Create a requirement response (manufacturer responds to a requirement)
   * @param {Object} responseData - Response data
   * @returns {Promise<Object>} Created response
   */
  async createRequirementResponse(responseData) {
    try {
      const { data, error } = await supabase
        .from('requirement_responses')
        .insert([responseData])
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create requirement response: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('DatabaseService.createRequirementResponse error:', error);
      throw error;
    }
  }

  /**
   * Get responses for a specific requirement
   * @param {string} requirementId - Requirement ID
   * @returns {Promise<Array>} Array of responses
   */
  async getRequirementResponses(requirementId) {
    try {
      const { data, error } = await supabase
        .from('requirement_responses')
        .select(`
          *,
          manufacturer:manufacturer_profiles(id, manufacturer_id, unit_name, location, business_type)
        `)
        .eq('requirement_id', requirementId)
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(`Failed to fetch requirement responses: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('DatabaseService.getRequirementResponses error:', error);
      throw error;
    }
  }

  /**
   * Get manufacturer's response to a specific requirement
   * @param {string} requirementId - Requirement ID
   * @param {string} manufacturerId - Manufacturer ID
   * @returns {Promise<Object|null>} Response or null
   */
  async getManufacturerResponse(requirementId, manufacturerId) {
    try {
      const { data, error } = await supabase
        .from('requirement_responses')
        .select('*')
        .eq('requirement_id', requirementId)
        .eq('manufacturer_id', manufacturerId)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        throw new Error(`Failed to fetch manufacturer response: ${error.message}`);
      }

      return data || null;
    } catch (error) {
      console.error('DatabaseService.getManufacturerResponse error:', error);
      throw error;
    }
  }

  /**
   * Get a requirement response by ID
   * @param {string} responseId - Response ID
   * @returns {Promise<Object|null>} Response object or null
   */
  async getRequirementResponseById(responseId) {
    try {
      const { data, error } = await supabase
        .from('requirement_responses')
        .select('*')
        .eq('id', responseId)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        throw new Error(`Failed to fetch requirement response: ${error.message}`);
      }

      return data || null;
    } catch (error) {
      console.error('DatabaseService.getRequirementResponseById error:', error);
      throw error;
    }
  }

  /**
   * Update a requirement response
   * @param {string} responseId - Response ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated response
   */
  async updateRequirementResponse(responseId, updateData) {
    try {
      const { data, error } = await supabase
        .from('requirement_responses')
        .update({
          ...updateData,
          updated_at: new Date().toISOString()
        })
        .eq('id', responseId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update requirement response: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('DatabaseService.updateRequirementResponse error:', error);
      throw error;
    }
  }

  /**
   * Get all responses from a manufacturer
   * @param {string} manufacturerId - Manufacturer ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of responses with requirement info
   */
  async getManufacturerResponses(manufacturerId, options = {}) {
    try {
      let query = supabase
        .from('requirement_responses')
        .select(`
          *,
          requirement:requirements(id, requirement_text, quantity, product_type, created_at, buyer_id)
        `)
        .eq('manufacturer_id', manufacturerId);

      // Apply filters
      if (options.status) {
        query = query.eq('status', options.status);
      }

      // Apply sorting
      if (options.sortBy) {
        const ascending = options.sortOrder === 'asc';
        query = query.order(options.sortBy, { ascending });
      } else {
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
        throw new Error(`Failed to fetch manufacturer responses: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('DatabaseService.getManufacturerResponses error:', error);
      throw error;
    }
  }

  /**
   * Get all orders (requirements with responses) - can be filtered by status
   * @param {Object} options - Query options (status filter, sorting, pagination)
   * @returns {Promise<Array>} Array of orders with buyer and manufacturer info
   */
  async getOrders(options = {}) {
    try {
      let query = supabase
        .from('requirement_responses')
        .select(`
          *,
          requirement:requirements(
            id,
            requirement_no,
            requirement_text,
            quantity,
            product_type,
            created_at,
            buyer:buyer_profiles(id, full_name, phone_number, business_address)
          ),
          manufacturer:manufacturer_profiles(id, manufacturer_id, unit_name, phone_number, location, business_type)
        `);

      // Apply status filter if provided
      if (options.status) {
        query = query.eq('status', options.status);
      }

      // Apply sorting
      if (options.sortBy) {
        const ascending = options.sortOrder === 'asc';
        query = query.order(options.sortBy, { ascending });
      } else {
        // Default sorting by created_at descending (most recent first)
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
        throw new Error(`Failed to fetch orders: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('DatabaseService.getOrders error:', error);
      throw error;
    }
  }

  /**
   * Get negotiating and accepted requirements for a specific conversation
   * Returns requirements where status is 'negotiating' or 'accepted' and matches the buyer_id and manufacturer_id
   * @param {string} buyerId - Buyer ID from conversation
   * @param {string} manufacturerId - Manufacturer ID from conversation
   * @returns {Promise<Array>} Array of requirements with their details
   */
  async getNegotiatingRequirementsForConversation(buyerId, manufacturerId) {
    try {
      // First, get requirement_responses with status 'negotiating' or 'accepted' for this manufacturer
      const { data: responses, error: responsesError } = await supabase
        .from('requirement_responses')
        .select(`
          requirement_id,
          requirement:requirements(
            id,
            requirement_no,
            requirement_text,
            quantity,
            product_type,
            product_link,
            image_url,
            notes,
            created_at,
            updated_at,
            buyer_id
          )
        `)
        .in('status', ['negotiating', 'accepted'])
        .eq('manufacturer_id', manufacturerId);

      if (responsesError) {
        throw new Error(`Failed to fetch negotiating/accepted requirement responses: ${responsesError.message}`);
      }

      // Filter to only include requirements where buyer_id matches the conversation's buyer_id
      const requirements = (responses || [])
        .map(item => item.requirement)
        .filter(req => req && req.buyer_id === buyerId);

      // Sort by created_at descending (newest first)
      requirements.sort((a, b) => {
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        return dateB - dateA;
      });

      return requirements;
    } catch (error) {
      console.error('DatabaseService.getNegotiatingRequirementsForConversation (negotiating/accepted) error:', error);
      throw error;
    }
  }

  // =============================================
  // ORDERS METHODS
  // =============================================

  /**
   * Create a new order
   * @param {Object} orderData - Order data (buyer_id, manufacturer_id, design_id, quantity, price_per_unit, total_price)
   * @returns {Promise<Object>} Created order
   */
  async createOrder(orderData) {
    try {
      const { data, error } = await supabase
        .from('orders')
        .insert([orderData])
        .select(`
          *,
          design:designs(id, product_name, product_category, image_url),
          buyer:buyer_profiles(id, full_name, phone_number),
          manufacturer:manufacturer_profiles(id, manufacturer_id, unit_name, phone_number)
        `)
        .single();

      if (error) {
        throw new Error(`Failed to create order: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('DatabaseService.createOrder error:', error);
      throw error;
    }
  }

  /**
   * Get orders for a manufacturer
   * @param {string} manufacturerId - Manufacturer ID
   * @param {Object} options - Query options (status filter, sorting, pagination)
   * @returns {Promise<Array>} Array of orders with design and buyer info
   */
  async getManufacturerOrders(manufacturerId, options = {}) {
    try {
      let query = supabase
        .from('orders')
        .select(`
          *,
          design:designs(id, product_name, product_category, image_url),
          buyer:buyer_profiles(id, full_name, phone_number, business_address)
        `)
        .eq('manufacturer_id', manufacturerId);

      // Apply status filter if provided
      if (options.status) {
        query = query.eq('status', options.status);
      }

      // Apply sorting
      if (options.sortBy) {
        const ascending = options.sortOrder === 'asc';
        query = query.order(options.sortBy, { ascending });
      } else {
        // Default sorting by created_at descending (most recent first)
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
        throw new Error(`Failed to fetch manufacturer orders: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('DatabaseService.getManufacturerOrders error:', error);
      throw error;
    }
  }

  /**
   * Get a single order by ID
   * @param {string} orderId - Order ID
   * @returns {Promise<Object>} Order data
   */
  async getOrder(orderId) {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          design:designs(id, product_name, product_category, image_url),
          buyer:buyer_profiles(id, full_name, phone_number, business_address),
          manufacturer:manufacturer_profiles(id, manufacturer_id, unit_name, phone_number, location)
        `)
        .eq('id', orderId)
        .single();

      if (error) {
        throw new Error(`Failed to fetch order: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('DatabaseService.getOrder error:', error);
      throw error;
    }
  }

  /**
   * Get orders for a buyer
   * @param {string} buyerId - Buyer ID
   * @param {Object} options - Query options (status filter, sorting, pagination)
   * @returns {Promise<Array>} Array of orders with design and manufacturer info
   */
  async getBuyerOrders(buyerId, options = {}) {
    try {
      let query = supabase
        .from('orders')
        .select(`
          *,
          design:designs(id, product_name, product_category, image_url),
          manufacturer:manufacturer_profiles(id, manufacturer_id, unit_name, phone_number, location, business_type)
        `)
        .eq('buyer_id', buyerId);

      // Apply status filter if provided
      if (options.status) {
        query = query.eq('status', options.status);
      }

      // Apply sorting
      if (options.sortBy) {
        const ascending = options.sortOrder === 'asc';
        query = query.order(options.sortBy, { ascending });
      } else {
        // Default sorting by created_at descending (most recent first)
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
        throw new Error(`Failed to fetch buyer orders: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('DatabaseService.getBuyerOrders error:', error);
      throw error;
    }
  }

  /**
   * Update order status
   * @param {string} orderId - Order ID
   * @param {string} status - New status
   * @returns {Promise<Object>} Updated order
   */
  async updateOrderStatus(orderId, status) {
    try {
      const { data, error } = await supabase
        .from('orders')
        .update({
          status,
          updated_at: new Date().toISOString()
        })
        .eq('id', orderId)
        .select(`
          *,
          design:designs(id, product_name, product_category, image_url),
          buyer:buyer_profiles(id, full_name, phone_number),
          manufacturer:manufacturer_profiles(id, manufacturer_id, unit_name, phone_number)
        `)
        .single();

      if (error) {
        throw new Error(`Failed to update order status: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('DatabaseService.updateOrderStatus error:', error);
      throw error;
    }
  }

  // =============================================
  // AI DESIGNS METHODS
  // =============================================

  /**
   * Create a new AI design
   * @param {Object} aiDesignData - AI design data
   * @returns {Promise<Object>} Created AI design
   */
  async createAIDesign(aiDesignData) {
    try {
      const { data, error } = await supabase
        .from('ai_designs')
        .insert([aiDesignData])
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create AI design: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('DatabaseService.createAIDesign error:', error);
      throw error;
    }
  }

  /**
   * Get AI designs for a buyer
   * @param {string} buyerId - Buyer profile ID
   * @param {Object} options - Query options (filters, sorting, pagination)
   * @returns {Promise<Array>} Array of AI designs
   */
  async getBuyerAIDesigns(buyerId, options = {}) {
    try {
      let query = supabase
        .from('ai_designs')
        .select('*')
        .eq('buyer_id', buyerId);

      // Apply status filter
      if (options.status) {
        query = query.eq('status', options.status);
      }

      // Apply apparel type filter
      if (options.apparel_type) {
        query = query.eq('apparel_type', options.apparel_type);
      }

      // Apply sorting
      query = query.order('created_at', { ascending: false });

      // Apply pagination
      if (options.limit) {
        query = query.limit(options.limit);
      }
      if (options.offset) {
        query = query.range(options.offset, options.offset + (options.limit || 50) - 1);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(`Failed to fetch buyer AI designs: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('DatabaseService.getBuyerAIDesigns error:', error);
      throw error;
    }
  }

  /**
   * Get all published AI designs (for manufacturers)
   * @param {Object} options - Query options (filters, sorting, pagination)
   * @returns {Promise<Array>} Array of AI designs
   */
  async getAllAIDesigns(options = {}) {
    try {
      // Build select query - include buyer info if requested
      const includeBuyer = options.includeBuyer !== false; // Default to true
      const selectQuery = includeBuyer
        ? '*, buyer:buyer_profiles(id, full_name, phone_number)'
        : '*';

      let query = supabase
        .from('ai_designs')
        .select(selectQuery)
        .eq('status', 'published'); // Only show published designs to manufacturers

      // Apply apparel type filter
      if (options.apparel_type) {
        query = query.eq('apparel_type', options.apparel_type);
      }

      // Apply sorting
      query = query.order('created_at', { ascending: false });

      // Apply pagination
      if (options.limit) {
        query = query.limit(options.limit);
      }
      if (options.offset) {
        query = query.range(options.offset, options.offset + (options.limit || 50) - 1);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(`Failed to fetch AI designs: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('DatabaseService.getAllAIDesigns error:', error);
      throw error;
    }
  }

  /**
   * Get a single AI design by ID
   * @param {string} id - AI design ID
   * @returns {Promise<Object|null>} AI design or null if not found
   */
  async getAIDesign(id) {
    try {
      const { data, error } = await supabase
        .from('ai_designs')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // Not found
        }
        throw new Error(`Failed to fetch AI design: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('DatabaseService.getAIDesign error:', error);
      throw error;
    }
  }

  /**
   * Update an AI design
   * @param {string} id - AI design ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated AI design
   */
  async updateAIDesign(id, updateData) {
    try {
      const { data, error } = await supabase
        .from('ai_designs')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update AI design: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('DatabaseService.updateAIDesign error:', error);
      throw error;
    }
  }

  /**
   * Delete an AI design
   * @param {string} id - AI design ID
   * @returns {Promise<void>}
   */
  async deleteAIDesign(id) {
    try {
      const { error } = await supabase
        .from('ai_designs')
        .delete()
        .eq('id', id);

      if (error) {
        throw new Error(`Failed to delete AI design: ${error.message}`);
      }
    } catch (error) {
      console.error('DatabaseService.deleteAIDesign error:', error);
      throw error;
    }
  }

  // =============================================
  // AI DESIGN RESPONSES METHODS
  // =============================================

  /**
   * Create an AI design response (manufacturer responds to an AI design)
   * @param {Object} responseData - Response data
   * @returns {Promise<Object>} Created response
   */
  async createAIDesignResponse(responseData) {
    try {
      const { data, error } = await supabase
        .from('ai_design_responses')
        .insert([responseData])
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create AI design response: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('DatabaseService.createAIDesignResponse error:', error);
      throw error;
    }
  }

  /**
   * Get a single AI design response by ID
   * @param {string} responseId - AI design response ID
   * @returns {Promise<Object|null>} AI design response or null if not found
   */
  async getAIDesignResponse(responseId) {
    try {
      const { data, error } = await supabase
        .from('ai_design_responses')
        .select('*')
        .eq('id', responseId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // Not found
        }
        throw new Error(`Failed to fetch AI design response: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('DatabaseService.getAIDesignResponse error:', error);
      throw error;
    }
  }

  /**
   * Update an AI design response
   * @param {string} responseId - AI design response ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated AI design response
   */
  async updateAIDesignResponse(responseId, updateData) {
    try {
      const { data, error } = await supabase
        .from('ai_design_responses')
        .update(updateData)
        .eq('id', responseId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update AI design response: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('DatabaseService.updateAIDesignResponse error:', error);
      throw error;
    }
  }

  /**
   * Get responses for a specific AI design
   * @param {string} aiDesignId - AI Design ID
   * @returns {Promise<Array>} Array of responses
   */
  async getAIDesignResponses(aiDesignId) {
    try {
      const { data, error } = await supabase
        .from('ai_design_responses')
        .select(`
          *,
          manufacturer:manufacturer_profiles(id, manufacturer_id, unit_name, location, business_type)
        `)
        .eq('ai_design_id', aiDesignId)
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(`Failed to fetch AI design responses: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('DatabaseService.getAIDesignResponses error:', error);
      throw error;
    }
  }

  /**
   * Batch fetch responses for multiple AI designs (optimizes N+1 queries)
   * @param {Array<string>} aiDesignIds - Array of AI Design IDs
   * @returns {Promise<Map<string, Array>>} Map of design ID to responses array
   */
  async getAIDesignResponsesBatch(aiDesignIds) {
    try {
      if (!aiDesignIds || aiDesignIds.length === 0) {
        return new Map();
      }

      const { data, error } = await supabase
        .from('ai_design_responses')
        .select(`
          *,
          manufacturer:manufacturer_profiles(id, manufacturer_id, unit_name, location, business_type)
        `)
        .in('ai_design_id', aiDesignIds)
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(`Failed to batch fetch AI design responses: ${error.message}`);
      }

      // Group responses by ai_design_id
      const responsesMap = new Map();
      (data || []).forEach((response) => {
        const designId = response.ai_design_id;
        if (!responsesMap.has(designId)) {
          responsesMap.set(designId, []);
        }
        responsesMap.get(designId).push(response);
      });

      // Ensure all design IDs have an entry (even if empty)
      aiDesignIds.forEach((id) => {
        if (!responsesMap.has(id)) {
          responsesMap.set(id, []);
        }
      });

      return responsesMap;
    } catch (error) {
      console.error('DatabaseService.getAIDesignResponsesBatch error:', error);
      throw error;
    }
  }

  /**
   * Get all AI design responses for a buyer (responses to their AI designs)
   * @param {string} buyerId - Buyer ID
   * @returns {Promise<Array>} Array of responses
   */
  async getBuyerAIDesignResponses(buyerId) {
    try {
      // First, get all AI designs for this buyer
      const { data: aiDesigns, error: designsError } = await supabase
        .from('ai_designs')
        .select('id')
        .eq('buyer_id', buyerId);

      if (designsError) {
        throw new Error(`Failed to fetch buyer AI designs: ${designsError.message}`);
      }

      if (!aiDesigns || aiDesigns.length === 0) {
        return [];
      }

      const aiDesignIds = aiDesigns.map(d => d.id);

      // Then get all responses for these AI designs
      // Note: We fetch responses first, then enrich with design and manufacturer data
      const { data: responses, error: responsesError } = await supabase
        .from('ai_design_responses')
        .select('*')
        .in('ai_design_id', aiDesignIds)
        .order('created_at', { ascending: false });

      if (responsesError) {
        throw new Error(`Failed to fetch buyer AI design responses: ${responsesError.message}`);
      }

      if (!responses || responses.length === 0) {
        return [];
      }

      // Enrich responses with design and manufacturer data
      const enrichedResponses = await Promise.all(
        responses.map(async (response) => {
          // Get AI design details
          const { data: aiDesign } = await supabase
            .from('ai_designs')
            .select('id, apparel_type, design_description, image_url, quantity')
            .eq('id', response.ai_design_id)
            .single();

          // Get manufacturer details
          const { data: manufacturer } = await supabase
            .from('manufacturer_profiles')
            .select('id, unit_name, location, business_type')
            .eq('id', response.manufacturer_id)
            .single();

          return {
            ...response,
            ai_design: aiDesign || null,
            manufacturer: manufacturer || null
          };
        })
      );

      return enrichedResponses;
    } catch (error) {
      console.error('DatabaseService.getBuyerAIDesignResponses error:', error);
      throw error;
    }
  }

  /**
   * Get accepted AI designs for a conversation (buyer_id and manufacturer_id match)
   * Returns AI designs where responses have status 'accepted' for this buyer and manufacturer
   * @param {string} buyerId - Buyer ID
   * @param {string} manufacturerId - Manufacturer ID
   * @returns {Promise<Array>} Array of AI designs
   */
  async getAcceptedAIDesignsForConversation(buyerId, manufacturerId) {
    try {
      // First, get ai_design_responses with status 'accepted' for this manufacturer
      const { data: responses, error: responsesError } = await supabase
        .from('ai_design_responses')
        .select(`
          ai_design_id,
          ai_design:ai_designs(
            id,
            buyer_id,
            design_no,
            apparel_type,
            design_description,
            image_url,
            quantity,
            preferred_colors,
            print_placement,
            status,
            created_at,
            updated_at
          )
        `)
        .eq('status', 'accepted')
        .eq('manufacturer_id', manufacturerId);

      if (responsesError) {
        throw new Error(`Failed to fetch accepted AI design responses: ${responsesError.message}`);
      }

      // Filter to only include AI designs where buyer_id matches the conversation's buyer_id
      const aiDesigns = (responses || [])
        .map(item => item.ai_design)
        .filter(design => design && design.buyer_id === buyerId);

      // Sort by created_at descending (newest first)
      aiDesigns.sort((a, b) => {
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        return dateB - dateA;
      });

      return aiDesigns;
    } catch (error) {
      console.error('DatabaseService.getAcceptedAIDesignsForConversation error:', error);
      throw error;
    }
  }

  /**
   * Get today's design generation count for a buyer (from buyer_profiles table)
   * @param {string} buyerId - Buyer ID
   * @returns {Promise<number>} Count of designs generated today
   */
  async getTodayDesignGenerationCount(buyerId) {
    try {
      const { data, error } = await supabase
        .from('buyer_profiles')
        .select('daily_design_generation_count, last_design_generation_date')
        .eq('id', buyerId)
        .single();

      if (error) {
        throw new Error(`Failed to fetch buyer profile: ${error.message}`);
      }

      if (!data) {
        return 0;
      }

      // Check if we need to reset (date changed)
      const today = new Date().toISOString().split('T')[0];
      const lastDate = data.last_design_generation_date 
        ? new Date(data.last_design_generation_date).toISOString().split('T')[0]
        : null;

      // If no date or date is different, count is 0
      if (!lastDate || lastDate !== today) {
        return 0;
      }

      return data.daily_design_generation_count || 0;
    } catch (error) {
      console.error('DatabaseService.getTodayDesignGenerationCount error:', error);
      throw error;
    }
  }

  /**
   * Increment design generation count for today (in buyer_profiles table)
   * @param {string} buyerId - Buyer ID
   * @returns {Promise<number>} New count after increment
   */
  async incrementDesignGenerationCount(buyerId) {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // First get current values
      const { data: current, error: fetchError } = await supabase
        .from('buyer_profiles')
        .select('daily_design_generation_count, last_design_generation_date')
        .eq('id', buyerId)
        .single();

      if (fetchError) {
        throw new Error(`Failed to fetch buyer profile: ${fetchError.message}`);
      }

      const lastDate = current.last_design_generation_date 
        ? new Date(current.last_design_generation_date).toISOString().split('T')[0]
        : null;

      // Reset count if date changed
      const currentCount = (lastDate === today) ? (current.daily_design_generation_count || 0) : 0;
      const newCount = currentCount + 1;

      // Update buyer profile
      const { data: updated, error: updateError } = await supabase
        .from('buyer_profiles')
        .update({
          daily_design_generation_count: newCount,
          last_design_generation_date: today
        })
        .eq('id', buyerId)
        .select('daily_design_generation_count')
        .single();

      if (updateError) {
        throw new Error(`Failed to increment design generation count: ${updateError.message}`);
      }

      return updated.daily_design_generation_count;
    } catch (error) {
      console.error('DatabaseService.incrementDesignGenerationCount error:', error);
      throw error;
    }
  }

}

module.exports = new DatabaseService();
