/**
 * Conversation Repository - Conversations and Messages management
 */
const { supabase } = require('./BaseRepository');

class ConversationRepository {
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
      console.error('ConversationRepository.getOrCreateConversation error:', error);
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
            console.error('ConversationRepository.listConversations unread count error:', unreadCountError);
            return {
              ...conversation,
              unread_count: 0
            };
          }
        })
      );

      return withUnreadCounts;
    } catch (error) {
      console.error('ConversationRepository.listConversations error:', error);
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
      console.error('ConversationRepository.insertMessage error:', error);
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
      console.error('ConversationRepository.insertMessageAttachments error:', error);
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
      console.error('ConversationRepository.listMessagesWithAttachments error:', error);
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
      console.error('ConversationRepository.markRead error:', error);
      throw error;
    }
  }
}

module.exports = new ConversationRepository();

