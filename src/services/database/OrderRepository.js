/**
 * Order Repository - Orders management
 */
const { supabase } = require('./BaseRepository');

class OrderRepository {
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
      console.error('OrderRepository.createOrder error:', error);
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
      console.error('OrderRepository.getManufacturerOrders error:', error);
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
      console.error('OrderRepository.getOrder error:', error);
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
      console.error('OrderRepository.getBuyerOrders error:', error);
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
      console.error('OrderRepository.updateOrderStatus error:', error);
      throw error;
    }
  }

  /**
   * Get all orders (requirements with responses) - can be filtered by status
   * Note: This queries requirement_responses table, not orders table
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
      console.error('OrderRepository.getOrders error:', error);
      throw error;
    }
  }
}

module.exports = new OrderRepository();

