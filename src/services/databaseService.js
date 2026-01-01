/**
 * Database Service - Facade for backwards compatibility
 * 
 * This file re-exports the modular database service from ./database/index.js
 * All methods are preserved with the same signatures for backwards compatibility.
 * 
 * The actual implementations are now organized in:
 * - database/AuthRepository.js        - OTP sessions & User sessions
 * - database/BuyerRepository.js       - Buyer profile management
 * - database/ManufacturerRepository.js - Manufacturer profile management
 * - database/ConversationRepository.js - Conversations & Messages
 * - database/RequirementRepository.js  - Requirements & Requirement responses
 * - database/OrderRepository.js        - Orders
 * - database/AIDesignRepository.js     - AI Designs & AI Design responses
 */

module.exports = require('./database');
