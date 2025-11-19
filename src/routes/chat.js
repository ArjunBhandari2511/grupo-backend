const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const databaseService = require('../services/databaseService');
const { buildMessageSummary } = require('../utils/messageSummary');

const router = express.Router();

const sanitizeBody = (text) => {
  if (typeof text !== 'string') return '';
  const noHtml = text.replace(/<[^>]*>/g, '');
  return noHtml.length > 4000 ? noHtml.slice(0, 4000) : noHtml;
};

// GET /conversations → list user’s conversations
router.get('/conversations', authenticateToken, async (req, res) => {
  try {
    const { userId, role } = req.user;
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);
    const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);

    const conversations = await databaseService.listConversations(userId, role, { limit, offset });

    // Enrich with peer display info
    const enriched = await Promise.all((conversations || []).map(async (c) => {
      try {
        // Ensure last message summary reflects the latest message
        let summary = { last_message_text: c.last_message_text, last_message_at: c.last_message_at };
        try {
          const { data: lastMsg, error: lastErr } = await require('../config/supabase')
            .from('messages')
            .select('body, created_at')
            .eq('conversation_id', c.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();
          if (!lastErr && lastMsg) {
            summary.last_message_text = lastMsg.body;
            summary.last_message_at = lastMsg.created_at;
          }
        } catch (_) {}

        if (role === 'buyer') {
          const prof = await databaseService.findManufacturerProfile(c.manufacturer_id);
          return {
            ...c,
            ...summary,
            peer: {
              id: c.manufacturer_id,
              role: 'manufacturer',
              displayName: prof?.unit_name || 'Manufacturer'
            }
          };
        } else {
          const prof = await databaseService.findBuyerProfile(c.buyer_id);
          return {
            ...c,
            ...summary,
            peer: {
              id: c.buyer_id,
              role: 'buyer',
              displayName: prof?.full_name || prof?.phone_number || 'Buyer'
            }
          };
        }
      } catch {
        return c;
      }
    }));

    res.status(200).json({ success: true, data: { conversations: enriched } });
  } catch (error) {
    console.error('List conversations error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to list conversations' });
  }
});

// POST /conversations → ensure/get conversation for buyerId + manufacturerId
router.post('/conversations', [
  body('buyerId').isUUID().withMessage('buyerId must be a valid UUID'),
  body('manufacturerId').isUUID().withMessage('manufacturerId must be a valid UUID')
], authenticateToken, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const { buyerId, manufacturerId } = req.body;

    // Only participants can create/ensure conversations for themselves
    const { userId, role } = req.user;
    if (!((role === 'buyer' && userId === buyerId) || (role === 'manufacturer' && userId === manufacturerId))) {
      return res.status(403).json({ success: false, message: 'Not authorized for this conversation' });
    }

    const convo = await databaseService.getOrCreateConversation(buyerId, manufacturerId);
    res.status(200).json({ success: true, data: { conversation: convo } });
  } catch (error) {
    console.error('Ensure conversation error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to ensure conversation' });
  }
});

// GET /conversations/:id/messages/requirement/:requirementId → get messages for a specific requirement in a conversation
router.get('/conversations/:id/messages/requirement/:requirementId', [
  param('id').isUUID().withMessage('conversation id must be a valid UUID'),
  param('requirementId').isUUID().withMessage('requirementId must be a valid UUID'),
  query('before').optional().isISO8601().withMessage('before must be an ISO timestamp'),
  query('limit').optional().isInt({ min: 1, max: 200 }).withMessage('limit must be between 1 and 200')
], authenticateToken, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const conversationId = req.params.id;
    const requirementId = req.params.requirementId;
    const before = req.query.before;
    const limit = parseInt(req.query.limit || '200', 10);

    const convo = await databaseService.getConversation(conversationId);

    // Auth: must be participant
    const { userId, role } = req.user;
    if (!convo || !((role === 'buyer' && convo.buyer_id === userId) || (role === 'manufacturer' && convo.manufacturer_id === userId))) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this conversation' });
    }

    // Get messages filtered by both conversation_id AND requirement_id
    const messages = await databaseService.listMessagesWithAttachments(conversationId, { before, limit, requirementId });
    
    return res.status(200).json({ 
      success: true, 
      data: { messages },
      count: messages.length 
    });
  } catch (error) {
    console.error('List messages by requirement error:', error);
    return res.status(400).json({ success: false, message: error.message || 'Failed to list messages' });
  }
});

// GET /conversations/:id/messages → paginate history
router.get('/conversations/:id/messages', [
  param('id').isUUID().withMessage('conversation id must be a valid UUID'),
  query('before').optional().isISO8601().withMessage('before must be an ISO timestamp'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
  query('requirementId').optional().isUUID().withMessage('requirementId must be a valid UUID')
], authenticateToken, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const conversationId = req.params.id;
    const before = req.query.before;
    const limit = parseInt(req.query.limit || '50', 10);
    const requirementId = req.query.requirementId || null;

    const convo = await databaseService.getConversation(conversationId);

    // Auth: must be participant
    const { userId, role } = req.user;
    if (!convo || !((role === 'buyer' && convo.buyer_id === userId) || (role === 'manufacturer' && convo.manufacturer_id === userId))) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this conversation' });
    }

    // Get messages with attachments
    const messages = await databaseService.listMessagesWithAttachments(conversationId, { before, limit, requirementId });
    res.status(200).json({ success: true, data: { messages } });
  } catch (error) {
    console.error('List messages error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to list messages' });
  }
});

// POST /conversations/:id/messages → send message
router.post('/conversations/:id/messages', [
  param('id').isUUID().withMessage('conversation id must be a valid UUID'),
  body('body').optional().isString().isLength({ max: 4000 }).withMessage('body must be at most 4000 characters'),
  body('clientTempId').optional().isString().isLength({ max: 64 }),
  body('attachments').optional().isArray().withMessage('attachments must be an array'),
  body('requirementId').optional().isUUID().withMessage('requirementId must be a valid UUID')
], authenticateToken, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const conversationId = req.params.id;
    const { userId, role } = req.user;
    const convo = await databaseService.getConversation(conversationId);
    if (!convo || !((role === 'buyer' && convo.buyer_id === userId) || (role === 'manufacturer' && convo.manufacturer_id === userId))) {
      return res.status(403).json({ success: false, message: 'Not authorized to send in this conversation' });
    }

    // Either body or attachments must be present
    const hasBody = req.body.body && req.body.body.trim().length > 0;
    const hasAttachments = req.body.attachments && Array.isArray(req.body.attachments) && req.body.attachments.length > 0;
    
    if (!hasBody && !hasAttachments) {
      return res.status(400).json({ success: false, message: 'Either body or attachments must be provided' });
    }

    const cleanBody = hasBody ? sanitizeBody(req.body.body) : '';
    const summaryText = buildMessageSummary(cleanBody, hasAttachments ? req.body.attachments : []);
    const requirementId = req.body.requirementId || null;
    const message = await databaseService.insertMessage(conversationId, role, userId, cleanBody, req.body.clientTempId || null, summaryText, requirementId);

    // Insert attachments if any
    let attachments = [];
    if (hasAttachments) {
      attachments = await databaseService.insertMessageAttachments(message.id, req.body.attachments);
    }

    // Return message with attachments
    const messageWithAttachments = {
      ...message,
      attachments
    };

    // WS fanout will be added in the WebSocket step
    res.status(201).json({ success: true, data: { message: messageWithAttachments } });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to send message' });
  }
});

// POST /conversations/:id/read → mark as read up to timestamp (or now if not provided)
router.post('/conversations/:id/read', [
  param('id').isUUID().withMessage('conversation id must be a valid UUID'),
  body('upTo').optional().isISO8601().withMessage('upTo must be an ISO timestamp')
], authenticateToken, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const conversationId = req.params.id;
    const { userId, role } = req.user;
    const convo = await databaseService.getConversation(conversationId);
    if (!convo || !((role === 'buyer' && convo.buyer_id === userId) || (role === 'manufacturer' && convo.manufacturer_id === userId))) {
      return res.status(403).json({ success: false, message: 'Not authorized to mark read in this conversation' });
    }

    const upTo = req.body.upTo || new Date().toISOString();
    const count = await databaseService.markRead(conversationId, userId, upTo);
    res.status(200).json({ success: true, data: { updated: count } });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to mark messages as read' });
  }
});

module.exports = router;


