/**
 * AI Design Repository - AI Designs and AI Design Responses management
 */
const { supabase } = require('./BaseRepository');

class AIDesignRepository {
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
      console.error('AIDesignRepository.createAIDesign error:', error);
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
      console.error('AIDesignRepository.getBuyerAIDesigns error:', error);
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
      console.error('AIDesignRepository.getAllAIDesigns error:', error);
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
      console.error('AIDesignRepository.getAIDesign error:', error);
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
      console.error('AIDesignRepository.updateAIDesign error:', error);
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
      console.error('AIDesignRepository.deleteAIDesign error:', error);
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
      console.error('AIDesignRepository.getTodayDesignGenerationCount error:', error);
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
      console.error('AIDesignRepository.incrementDesignGenerationCount error:', error);
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
      console.error('AIDesignRepository.createAIDesignResponse error:', error);
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
      console.error('AIDesignRepository.getAIDesignResponse error:', error);
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
      console.error('AIDesignRepository.updateAIDesignResponse error:', error);
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
      console.error('AIDesignRepository.getAIDesignResponses error:', error);
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
      console.error('AIDesignRepository.getAIDesignResponsesBatch error:', error);
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
      console.error('AIDesignRepository.getBuyerAIDesignResponses error:', error);
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
      console.error('AIDesignRepository.getAcceptedAIDesignsForConversation error:', error);
      throw error;
    }
  }
}

module.exports = new AIDesignRepository();

