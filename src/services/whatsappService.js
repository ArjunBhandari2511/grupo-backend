/**
 * WhatsApp Notification Service
 * Uses WASender API to send WhatsApp messages
 * 
 * API Documentation: https://wasenderapi.com
 * Postman Collection: https://github.com/wasenderapi/wasenderapi-postman
 */

const axios = require('axios');

class WhatsAppService {
  constructor() {
    this.baseUrl = 'https://wasenderapi.com/api';
    this.apiKey = process.env.WASENDER_API_KEY;
    this.enabled = !!this.apiKey;
    
    if (!this.enabled) {
      console.warn('[WhatsAppService] WASENDER_API_KEY not configured. WhatsApp notifications disabled.');
    }
  }

  /**
   * Get axios instance with auth headers
   * @returns {import('axios').AxiosInstance}
   */
  getClient() {
    return axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 30000 // 30 second timeout
    });
  }

  /**
   * Format phone number to JID format (WhatsApp ID)
   * @param {string} phoneNumber - Phone number in E.164 format (e.g., +919876543210)
   * @returns {string} JID format (e.g., 919876543210@s.whatsapp.net)
   */
  formatToJid(phoneNumber) {
    // Remove + and any spaces/dashes
    const cleaned = phoneNumber.replace(/[\+\s\-\(\)]/g, '');
    return `${cleaned}@s.whatsapp.net`;
  }

  /**
   * Format phone number for API (without @s.whatsapp.net)
   * @param {string} phoneNumber - Phone number in E.164 format
   * @returns {string} Cleaned phone number
   */
  formatPhoneNumber(phoneNumber) {
    // Remove + and any spaces/dashes
    return phoneNumber.replace(/[\+\s\-\(\)]/g, '');
  }

  /**
   * Check if a phone number is registered on WhatsApp
   * @param {string} phoneNumber - Phone number in E.164 format
   * @returns {Promise<{exists: boolean, jid?: string}>}
   */
  async isOnWhatsApp(phoneNumber) {
    if (!this.enabled) {
      console.warn('[WhatsAppService] Service not enabled');
      return { exists: false };
    }

    try {
      const jid = this.formatToJid(phoneNumber);
      const client = this.getClient();
      const response = await client.get(`/on-whatsapp/${jid}`);
      
      return {
        exists: response.data?.exists === true || response.data?.onWhatsApp === true,
        jid: jid
      };
    } catch (error) {
      console.error('[WhatsAppService] Error checking WhatsApp status:', error.message);
      return { exists: false };
    }
  }

  /**
   * Send a text message via WhatsApp
   * @param {string} phoneNumber - Recipient phone number in E.164 format
   * @param {string} message - Message text to send
   * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
   */
  async sendMessage(phoneNumber, message) {
    if (!this.enabled) {
      console.warn('[WhatsAppService] Service not enabled. Message not sent.');
      return { success: false, error: 'WhatsApp service not configured' };
    }

    if (!phoneNumber || !message) {
      return { success: false, error: 'Phone number and message are required' };
    }

    try {
      const client = this.getClient();
      const to = this.formatPhoneNumber(phoneNumber);
      
      const response = await client.post('/send-message', {
        to: to,
        text: message
      });

      console.log(`[WhatsAppService] Message sent to ${phoneNumber}`);
      
      return {
        success: true,
        messageId: response.data?.messageId || response.data?.id || null
      };
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message;
      console.error('[WhatsAppService] Error sending message:', errorMessage);
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Get session user info (verify API connection)
   * @returns {Promise<{success: boolean, user?: object, error?: string}>}
   */
  async getSessionInfo() {
    if (!this.enabled) {
      return { success: false, error: 'WhatsApp service not configured' };
    }

    try {
      const client = this.getClient();
      const response = await client.get('/user');
      
      return {
        success: true,
        user: response.data
      };
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message;
      console.error('[WhatsAppService] Error getting session info:', errorMessage);
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  // ========================================
  // Notification Helper Methods
  // ========================================

  /**
   * Send notification for new requirement (to manufacturers)
   * @param {string} phoneNumber - Manufacturer phone number
   * @param {object} requirement - Requirement details
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async notifyNewRequirement(phoneNumber, requirement) {
    const message = `🔔 *New Requirement on Grupo!*

A buyer is looking for:
📦 ${requirement.requirement_text || 'Product requirement'}
${requirement.quantity ? `📊 Quantity: ${requirement.quantity.toLocaleString()}` : ''}
${requirement.product_type ? `🏷️ Type: ${requirement.product_type}` : ''}

Login to your Grupo manufacturer portal to submit a quote!
https://grupo-dev.vercel.app/manufacturer-portal`;

    return this.sendMessage(phoneNumber, message);
  }

  /**
   * Send notification for new requirement response (to buyers)
   * @param {string} phoneNumber - Buyer phone number
   * @param {object} response - Response details
   * @param {object} manufacturer - Manufacturer details
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async notifyNewRequirementResponse(phoneNumber, response, manufacturer) {
    const message = `🎉 *New Quote Received on Grupo!*

${manufacturer?.unit_name || 'A manufacturer'} has responded to your requirement!

💰 Quoted Price: ₹${response.quoted_price?.toLocaleString('en-IN') || 'N/A'}
${response.price_per_unit ? `📦 Per Unit: ₹${response.price_per_unit.toLocaleString('en-IN')}` : ''}
${response.delivery_time ? `🚚 Delivery: ${response.delivery_time}` : ''}

Login to your Grupo buyer portal to review and respond!
https://grupo-dev.vercel.app/buyer-portal`;

    return this.sendMessage(phoneNumber, message);
  }

  /**
   * Send notification for requirement response status update (to manufacturers)
   * @param {string} phoneNumber - Manufacturer phone number
   * @param {string} status - New status (accepted, rejected, negotiating)
   * @param {object} requirement - Requirement details
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async notifyResponseStatusUpdate(phoneNumber, status, requirement) {
    const statusEmoji = status === 'accepted' ? '✅' : status === 'rejected' ? '❌' : '💬';
    const statusText = status === 'accepted' ? 'Accepted' : status === 'rejected' ? 'Rejected' : 'In Negotiation';
    
    const message = `${statusEmoji} *Quote ${statusText}!*

Your quote for "${requirement?.requirement_text?.slice(0, 50) || 'the requirement'}${requirement?.requirement_text?.length > 50 ? '...' : ''}" has been ${status}.

${status === 'accepted' ? 'Congratulations! The buyer has accepted your quote. You can now start chatting to finalize details.' : ''}
${status === 'negotiating' ? 'The buyer wants to negotiate. Check your chats for more details.' : ''}

Login to your Grupo manufacturer portal for more details!
https://grupo-dev.vercel.app/manufacturer-portal`;

    return this.sendMessage(phoneNumber, message);
  }

  /**
   * Send notification for new AI design (to manufacturers)
   * @param {string} phoneNumber - Manufacturer phone number
   * @param {object} aiDesign - AI Design details
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async notifyNewAIDesign(phoneNumber, aiDesign) {
    const message = `🎨 *New AI Design Published on Grupo!*

A buyer has published an AI-generated design:
👕 Type: ${aiDesign.apparel_type || 'Apparel'}
${aiDesign.quantity ? `📊 Quantity: ${aiDesign.quantity.toLocaleString()}` : ''}
${aiDesign.preferred_colors ? `🎨 Colors: ${aiDesign.preferred_colors}` : ''}

Login to your Grupo manufacturer portal to view the design and submit a quote!
https://grupo-dev.vercel.app/manufacturer-portal`;

    return this.sendMessage(phoneNumber, message);
  }

  /**
   * Send notification for new AI design response (to buyers)
   * @param {string} phoneNumber - Buyer phone number
   * @param {object} response - Response details
   * @param {object} manufacturer - Manufacturer details
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async notifyNewAIDesignResponse(phoneNumber, response, manufacturer) {
    const message = `🎉 *New Quote for Your AI Design!*

${manufacturer?.unit_name || 'A manufacturer'} has quoted on your AI design!

💰 Price per unit: ₹${response.price_per_unit?.toLocaleString('en-IN') || 'N/A'}
📦 Quantity: ${response.quantity?.toLocaleString() || 'N/A'}

Login to your Grupo buyer portal to review and respond!
https://grupo-dev.vercel.app/buyer-portal`;

    return this.sendMessage(phoneNumber, message);
  }

  /**
   * Send notification for AI design response status update (to manufacturers)
   * @param {string} phoneNumber - Manufacturer phone number
   * @param {string} status - New status (accepted, rejected)
   * @param {object} aiDesign - AI Design details
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async notifyAIDesignResponseStatusUpdate(phoneNumber, status, aiDesign) {
    const statusEmoji = status === 'accepted' ? '✅' : '❌';
    const statusText = status === 'accepted' ? 'Accepted' : 'Rejected';
    
    const message = `${statusEmoji} *AI Design Quote ${statusText}!*

Your quote for the "${aiDesign?.apparel_type || 'AI design'}" has been ${status}.

${status === 'accepted' ? 'Congratulations! The buyer has accepted your quote. You can now start chatting to finalize details.' : ''}

Login to your Grupo manufacturer portal for more details!
https://grupo-dev.vercel.app/manufacturer-portal`;

    return this.sendMessage(phoneNumber, message);
  }

}

// Export singleton instance
module.exports = new WhatsAppService();

