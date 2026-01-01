/**
 * Database Service - Aggregates all repositories into a unified API
 * 
 * This module re-exports all methods from individual repositories,
 * providing backwards compatibility with the original monolithic DatabaseService.
 */

const AuthRepository = require('./AuthRepository');
const BuyerRepository = require('./BuyerRepository');
const ManufacturerRepository = require('./ManufacturerRepository');
const ConversationRepository = require('./ConversationRepository');
const RequirementRepository = require('./RequirementRepository');
const OrderRepository = require('./OrderRepository');
const AIDesignRepository = require('./AIDesignRepository');

// Create a unified database service object that combines all repositories
const DatabaseService = {
  // =============================================
  // AUTH METHODS (OTP & Sessions)
  // =============================================
  storeOTPSession: (...args) => AuthRepository.storeOTPSession(...args),
  expireActiveOtps: (...args) => AuthRepository.expireActiveOtps(...args),
  findOTPSession: (...args) => AuthRepository.findOTPSession(...args),
  updateOTPSession: (...args) => AuthRepository.updateOTPSession(...args),
  storeUserSession: (...args) => AuthRepository.storeUserSession(...args),
  findUserSession: (...args) => AuthRepository.findUserSession(...args),
  deactivateUserSession: (...args) => AuthRepository.deactivateUserSession(...args),
  getDailyOTPCount: (...args) => AuthRepository.getDailyOTPCount(...args),
  cleanupExpiredOTPs: (...args) => AuthRepository.cleanupExpiredOTPs(...args),
  cleanupExpiredSessions: (...args) => AuthRepository.cleanupExpiredSessions(...args),

  // =============================================
  // BUYER PROFILE METHODS
  // =============================================
  createBuyerProfile: (...args) => BuyerRepository.createBuyerProfile(...args),
  findBuyerProfileByPhone: (...args) => BuyerRepository.findBuyerProfileByPhone(...args),
  updateBuyerProfileByPhone: (...args) => BuyerRepository.updateBuyerProfileByPhone(...args),
  findBuyerProfile: (...args) => BuyerRepository.findBuyerProfile(...args),
  updateBuyerProfile: (...args) => BuyerRepository.updateBuyerProfile(...args),
  getAllBuyers: (...args) => BuyerRepository.getAllBuyers(...args),

  // =============================================
  // MANUFACTURER PROFILE METHODS
  // =============================================
  createManufacturerProfile: (...args) => ManufacturerRepository.createManufacturerProfile(...args),
  findManufacturerProfileByPhone: (...args) => ManufacturerRepository.findManufacturerProfileByPhone(...args),
  updateManufacturerProfileByPhone: (...args) => ManufacturerRepository.updateManufacturerProfileByPhone(...args),
  findManufacturerProfile: (...args) => ManufacturerRepository.findManufacturerProfile(...args),
  updateManufacturerProfile: (...args) => ManufacturerRepository.updateManufacturerProfile(...args),
  getAllManufacturers: (...args) => ManufacturerRepository.getAllManufacturers(...args),

  // =============================================
  // CONVERSATION & MESSAGE METHODS
  // =============================================
  getOrCreateConversation: (...args) => ConversationRepository.getOrCreateConversation(...args),
  listConversations: (...args) => ConversationRepository.listConversations(...args),
  getConversation: (...args) => ConversationRepository.getConversation(...args),
  insertMessage: (...args) => ConversationRepository.insertMessage(...args),
  insertMessageAttachments: (...args) => ConversationRepository.insertMessageAttachments(...args),
  listMessagesWithAttachments: (...args) => ConversationRepository.listMessagesWithAttachments(...args),
  markRead: (...args) => ConversationRepository.markRead(...args),

  // =============================================
  // REQUIREMENT METHODS
  // =============================================
  createRequirement: (...args) => RequirementRepository.createRequirement(...args),
  getBuyerRequirements: (...args) => RequirementRepository.getBuyerRequirements(...args),
  getRequirement: (...args) => RequirementRepository.getRequirement(...args),
  updateRequirement: (...args) => RequirementRepository.updateRequirement(...args),
  deleteRequirement: (...args) => RequirementRepository.deleteRequirement(...args),
  getBuyerRequirementStatistics: (...args) => RequirementRepository.getBuyerRequirementStatistics(...args),
  getAllRequirements: (...args) => RequirementRepository.getAllRequirements(...args),

  // =============================================
  // REQUIREMENT RESPONSE METHODS
  // =============================================
  createRequirementResponse: (...args) => RequirementRepository.createRequirementResponse(...args),
  getRequirementResponses: (...args) => RequirementRepository.getRequirementResponses(...args),
  getManufacturerResponse: (...args) => RequirementRepository.getManufacturerResponse(...args),
  getRequirementResponseById: (...args) => RequirementRepository.getRequirementResponseById(...args),
  updateRequirementResponse: (...args) => RequirementRepository.updateRequirementResponse(...args),
  getManufacturerResponses: (...args) => RequirementRepository.getManufacturerResponses(...args),
  getNegotiatingRequirementsForConversation: (...args) => RequirementRepository.getNegotiatingRequirementsForConversation(...args),

  // =============================================
  // ORDER METHODS
  // =============================================
  createOrder: (...args) => OrderRepository.createOrder(...args),
  getManufacturerOrders: (...args) => OrderRepository.getManufacturerOrders(...args),
  getOrder: (...args) => OrderRepository.getOrder(...args),
  getBuyerOrders: (...args) => OrderRepository.getBuyerOrders(...args),
  updateOrderStatus: (...args) => OrderRepository.updateOrderStatus(...args),
  getOrders: (...args) => OrderRepository.getOrders(...args),

  // =============================================
  // AI DESIGN METHODS
  // =============================================
  createAIDesign: (...args) => AIDesignRepository.createAIDesign(...args),
  getBuyerAIDesigns: (...args) => AIDesignRepository.getBuyerAIDesigns(...args),
  getAllAIDesigns: (...args) => AIDesignRepository.getAllAIDesigns(...args),
  getAIDesign: (...args) => AIDesignRepository.getAIDesign(...args),
  updateAIDesign: (...args) => AIDesignRepository.updateAIDesign(...args),
  deleteAIDesign: (...args) => AIDesignRepository.deleteAIDesign(...args),
  getTodayDesignGenerationCount: (...args) => AIDesignRepository.getTodayDesignGenerationCount(...args),
  incrementDesignGenerationCount: (...args) => AIDesignRepository.incrementDesignGenerationCount(...args),

  // =============================================
  // AI DESIGN RESPONSE METHODS
  // =============================================
  createAIDesignResponse: (...args) => AIDesignRepository.createAIDesignResponse(...args),
  getAIDesignResponse: (...args) => AIDesignRepository.getAIDesignResponse(...args),
  updateAIDesignResponse: (...args) => AIDesignRepository.updateAIDesignResponse(...args),
  getAIDesignResponses: (...args) => AIDesignRepository.getAIDesignResponses(...args),
  getAIDesignResponsesBatch: (...args) => AIDesignRepository.getAIDesignResponsesBatch(...args),
  getBuyerAIDesignResponses: (...args) => AIDesignRepository.getBuyerAIDesignResponses(...args),
  getAcceptedAIDesignsForConversation: (...args) => AIDesignRepository.getAcceptedAIDesignsForConversation(...args),
};

// Also export individual repositories for direct access if needed
module.exports = DatabaseService;

// Named exports for direct repository access
module.exports.AuthRepository = AuthRepository;
module.exports.BuyerRepository = BuyerRepository;
module.exports.ManufacturerRepository = ManufacturerRepository;
module.exports.ConversationRepository = ConversationRepository;
module.exports.RequirementRepository = RequirementRepository;
module.exports.OrderRepository = OrderRepository;
module.exports.AIDesignRepository = AIDesignRepository;

