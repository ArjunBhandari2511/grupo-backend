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
   * List messages for a conversation
   */
  async listMessages(conversationId, { before, limit = 50, requirementId = null } = {}) {
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

      // Filter by requirement_id if provided
      if (requirementId) {
        query = query.eq('requirement_id', requirementId);
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
  async insertMessage(conversationId, senderRole, senderId, body, clientTempId, summaryText, requirementId = null) {
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
   * Get message attachments
   * @param {string} messageId - Message ID
   * @returns {Promise<Array>} Array of attachments
   */
  async getMessageAttachments(messageId) {
    try {
      const { data, error } = await supabase
        .from('message_attachments')
        .select('*')
        .eq('message_id', messageId)
        .order('created_at', { ascending: true });

      if (error) {
        throw new Error(`Failed to get attachments: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('DatabaseService.getMessageAttachments error:', error);
      throw error;
    }
  }

  /**
   * Get messages with attachments
   * @param {string} conversationId - Conversation ID
   * @param {Object} options - Query options (before, limit, requirementId)
   * @returns {Promise<Array>} Array of messages with attachments
   */
  async listMessagesWithAttachments(conversationId, { before, limit = 50, requirementId = null } = {}) {
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
          manufacturer:manufacturer_profiles(id, unit_name, location, business_type)
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
          requirement:requirements(id, requirement_text, quantity, brand_name, product_type, created_at, buyer_id)
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
            requirement_text,
            quantity,
            brand_name,
            product_type,
            created_at,
            buyer:buyer_profiles(id, full_name, phone_number, business_address)
          ),
          manufacturer:manufacturer_profiles(id, unit_name, phone_number, location, business_type)
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
   * Get negotiating requirements for a specific conversation
   * Returns requirements where status is 'negotiating' and matches the buyer_id and manufacturer_id
   * @param {string} buyerId - Buyer ID from conversation
   * @param {string} manufacturerId - Manufacturer ID from conversation
   * @returns {Promise<Array>} Array of requirements with their details
   */
  async getNegotiatingRequirementsForConversation(buyerId, manufacturerId) {
    try {
      // First, get requirement_responses with status 'negotiating' for this manufacturer
      const { data: responses, error: responsesError } = await supabase
        .from('requirement_responses')
        .select(`
          requirement_id,
          requirement:requirements(
            id,
            requirement_text,
            quantity,
            brand_name,
            product_type,
            product_link,
            image_url,
            notes,
            created_at,
            updated_at,
            buyer_id
          )
        `)
        .eq('status', 'negotiating')
        .eq('manufacturer_id', manufacturerId);

      if (responsesError) {
        throw new Error(`Failed to fetch negotiating requirement responses: ${responsesError.message}`);
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
      console.error('DatabaseService.getNegotiatingRequirementsForConversation error:', error);
      throw error;
    }
  }

  /**
   * Get all accepted orders (requirements with accepted responses)
   * @param {Object} options - Query options (sorting, pagination)
   * @returns {Promise<Array>} Array of accepted orders with buyer and manufacturer info
   * @deprecated Use getOrders({ status: 'accepted' }) instead
   */
  async getAcceptedOrders(options = {}) {
    return this.getOrders({ ...options, status: 'accepted' });
  }

  /**
   * Get all rejected orders (requirements with rejected responses)
   * @param {Object} options - Query options (sorting, pagination)
   * @returns {Promise<Array>} Array of rejected orders with buyer and manufacturer info
   * @deprecated Use getOrders({ status: 'rejected' }) instead
   */
  async getRejectedOrders(options = {}) {
    return this.getOrders({ ...options, status: 'rejected' });
  }

  /**
   * Get all pending orders (requirements with submitted/pending responses)
   * @param {Object} options - Query options (sorting, pagination)
   * @returns {Promise<Array>} Array of pending orders with buyer and manufacturer info
   * @deprecated Use getOrders({ status: 'submitted' }) instead
   */
  async getPendingOrders(options = {}) {
    return this.getOrders({ ...options, status: 'submitted' });
  }
}

module.exports = new DatabaseService();
