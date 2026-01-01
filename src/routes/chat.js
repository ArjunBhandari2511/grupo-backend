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

// GET /conversations - List user's conversations
router.get('/conversations', authenticateToken, async (req, res) => {
  try {
    const { userId, role } = req.user;
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);
    const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);

    const conversations = await databaseService.listConversations(userId, role, { limit, offset });

    const enriched = await Promise.all((conversations || []).map(async (c) => {
      try {
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
              displayName: prof?.manufacturer_id || 'Manufacturer'
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
              displayName: prof?.buyer_identifier || 'Buyer'
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

// POST /conversations - Ensure/get conversation for buyerId + manufacturerId
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

// GET /conversations/:id/messages/requirement/:requirementId - Get messages for specific requirement
router.get('/conversations/:id/messages/requirement/:requirementId', [
  param('id').isUUID(),
  param('requirementId').isUUID(),
  query('before').optional().isISO8601(),
  query('limit').optional().isInt({ min: 1, max: 200 })
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
    const { userId, role } = req.user;

    if (!convo || !((role === 'buyer' && convo.buyer_id === userId) || (role === 'manufacturer' && convo.manufacturer_id === userId))) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this conversation' });
    }

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

// GET /conversations/:id/messages/ai-design/:aiDesignId - Get messages for specific AI design
router.get('/conversations/:id/messages/ai-design/:aiDesignId', [
  param('id').isUUID(),
  param('aiDesignId').isUUID(),
  query('before').optional().isISO8601(),
  query('limit').optional().isInt({ min: 1, max: 200 })
], authenticateToken, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const conversationId = req.params.id;
    const aiDesignId = req.params.aiDesignId;
    const before = req.query.before;
    const limit = parseInt(req.query.limit || '200', 10);

    const convo = await databaseService.getConversation(conversationId);
    const { userId, role } = req.user;

    if (!convo || !((role === 'buyer' && convo.buyer_id === userId) || (role === 'manufacturer' && convo.manufacturer_id === userId))) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this conversation' });
    }

    const messages = await databaseService.listMessagesWithAttachments(conversationId, { before, limit, aiDesignId });
    
    return res.status(200).json({ 
      success: true, 
      data: { messages },
      count: messages.length 
    });
  } catch (error) {
    console.error('List messages by AI design error:', error);
    return res.status(400).json({ success: false, message: error.message || 'Failed to list messages' });
  }
});

// GET /conversations/:id/messages - Paginate history
router.get('/conversations/:id/messages', [
  param('id').isUUID(),
  query('before').optional().isISO8601(),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('requirementId').optional().isUUID(),
  query('aiDesignId').optional().isUUID()
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
    const aiDesignId = req.query.aiDesignId || null;

    const convo = await databaseService.getConversation(conversationId);
    const { userId, role } = req.user;

    if (!convo || !((role === 'buyer' && convo.buyer_id === userId) || (role === 'manufacturer' && convo.manufacturer_id === userId))) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this conversation' });
    }

    const messages = await databaseService.listMessagesWithAttachments(conversationId, { before, limit, requirementId, aiDesignId });
    res.status(200).json({ success: true, data: { messages } });
  } catch (error) {
    console.error('List messages error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to list messages' });
  }
});

// POST /conversations/:id/messages - Send message
router.post('/conversations/:id/messages', [
  param('id').isUUID(),
  body('body').optional().isString().isLength({ max: 4000 }),
  body('clientTempId').optional().isString().isLength({ max: 64 }),
  body('attachments').optional().isArray(),
  body('requirementId').optional().isUUID(),
  body('aiDesignId').optional().isUUID()
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

    const hasBody = req.body.body && req.body.body.trim().length > 0;
    const hasAttachments = req.body.attachments && Array.isArray(req.body.attachments) && req.body.attachments.length > 0;
    
    if (!hasBody && !hasAttachments) {
      return res.status(400).json({ success: false, message: 'Either body or attachments must be provided' });
    }

    const cleanBody = hasBody ? sanitizeBody(req.body.body) : '';
    const summaryText = buildMessageSummary(cleanBody, hasAttachments ? req.body.attachments : []);
    const requirementId = req.body.requirementId || null;
    const aiDesignId = req.body.aiDesignId || null;
    const message = await databaseService.insertMessage(conversationId, role, userId, cleanBody, req.body.clientTempId || null, summaryText, requirementId, aiDesignId);

    let attachments = [];
    if (hasAttachments) {
      attachments = await databaseService.insertMessageAttachments(message.id, req.body.attachments);
    }

    const messageWithAttachments = { ...message, attachments };

    res.status(201).json({ success: true, data: { message: messageWithAttachments } });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to send message' });
  }
});

// POST /conversations/:id/read - Mark as read
router.post('/conversations/:id/read', [
  param('id').isUUID(),
  body('upTo').optional().isISO8601()
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
