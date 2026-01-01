/**
 * Requirement Repository - Requirements and Requirement Responses management
 */
const { supabase } = require('./BaseRepository');

class RequirementRepository {
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
      console.error('RequirementRepository.createRequirement error:', error);
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
      console.error('RequirementRepository.getBuyerRequirements error:', error);
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
      console.error('RequirementRepository.getRequirement error:', error);
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
      console.error('RequirementRepository.updateRequirement error:', error);
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
      console.error('RequirementRepository.deleteRequirement error:', error);
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
      console.error('RequirementRepository.getBuyerRequirementStatistics error:', error);
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
      console.error('RequirementRepository.getAllRequirements error:', error);
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
      console.error('RequirementRepository.createRequirementResponse error:', error);
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
      console.error('RequirementRepository.getRequirementResponses error:', error);
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
      console.error('RequirementRepository.getManufacturerResponse error:', error);
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
      console.error('RequirementRepository.getRequirementResponseById error:', error);
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
      console.error('RequirementRepository.updateRequirementResponse error:', error);
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
      console.error('RequirementRepository.getManufacturerResponses error:', error);
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
      console.error('RequirementRepository.getNegotiatingRequirementsForConversation (negotiating/accepted) error:', error);
      throw error;
    }
  }
}

module.exports = new RequirementRepository();

