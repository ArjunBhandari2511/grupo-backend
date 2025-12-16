const express = require('express');
const multer = require('multer');
const { authenticateToken } = require('../middleware/auth');
const { uploadToCloudinary } = require('../config/cloudinary');

const router = express.Router();

// Configure multer to use memory storage
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  // Define allowed file types
  const allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  const allowedAudioTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm'];
  const allowedDocTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'application/zip',
    'application/x-rar-compressed'
  ];
  const allowedVideoTypes = ['video/mp4', 'video/webm', 'video/quicktime'];

  const allAllowedTypes = [
    ...allowedImageTypes,
    ...allowedAudioTypes,
    ...allowedDocTypes,
    ...allowedVideoTypes
  ];

  if (allAllowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} is not supported`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

/**
 * POST /upload/chat-file
 * Upload a file for chat (image, audio, document, video)
 */
router.post('/chat-file', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const { userId, role } = req.user;
    const { conversationId } = req.body;

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        message: 'conversationId is required'
      });
    }

    // Determine resource type based on mime type
    let resourceType = 'auto';
    let fileType = 'file';

    if (req.file.mimetype.startsWith('image/')) {
      resourceType = 'image';
      fileType = 'image';
    } else if (req.file.mimetype.startsWith('video/')) {
      resourceType = 'video';
      fileType = 'video';
    } else if (req.file.mimetype.startsWith('audio/')) {
      resourceType = 'video'; // Cloudinary uses 'video' for audio files
      fileType = 'audio';
    } else {
      resourceType = 'raw';
      fileType = 'document';
    }

    // Upload to Cloudinary
    const uploadOptions = {
      folder: `groupo-chat/${conversationId}`,
      resource_type: resourceType,
      context: {
        userId,
        role,
        conversationId,
        originalName: req.file.originalname
      },
      tags: ['chat', role, conversationId]
    };

    // For images, add optimization transformations
    if (fileType === 'image') {
      uploadOptions.transformation = [
        { quality: 'auto', fetch_format: 'auto' }
      ];
    }

    const result = await uploadToCloudinary(req.file.buffer, uploadOptions);

    // Prepare response data
    const fileData = {
      url: result.secure_url,
      publicId: result.public_id,
      fileType,
      mimeType: req.file.mimetype,
      originalName: req.file.originalname,
      size: result.bytes,
      format: result.format,
      width: result.width,
      height: result.height,
      duration: result.duration, // For videos/audio
      thumbnail: fileType === 'image' ? result.secure_url : null,
      resourceType: result.resource_type
    };

    // Generate thumbnail for videos
    if (fileType === 'video' && result.public_id) {
      const { cloudinary } = require('../config/cloudinary');
      fileData.thumbnail = cloudinary.url(result.public_id, {
        resource_type: 'video',
        transformation: [
          { width: 300, height: 300, crop: 'fill', quality: 'auto' },
          { start_offset: '0', format: 'jpg' }
        ]
      });
    }

    res.status(200).json({
      success: true,
      data: fileData
    });
  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload file'
    });
  }
});

/**
 * POST /upload/multiple
 * Upload multiple files at once
 */
router.post('/multiple', authenticateToken, upload.array('files', 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded'
      });
    }

    const { userId, role } = req.user;
    const { conversationId } = req.body;

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        message: 'conversationId is required'
      });
    }

    const uploadPromises = req.files.map(async (file) => {
      let resourceType = 'auto';
      let fileType = 'file';

      if (file.mimetype.startsWith('image/')) {
        resourceType = 'image';
        fileType = 'image';
      } else if (file.mimetype.startsWith('video/')) {
        resourceType = 'video';
        fileType = 'video';
      } else if (file.mimetype.startsWith('audio/')) {
        resourceType = 'video';
        fileType = 'audio';
      } else {
        resourceType = 'raw';
        fileType = 'document';
      }

      const uploadOptions = {
        folder: `groupo-chat/${conversationId}`,
        resource_type: resourceType,
        context: {
          userId,
          role,
          conversationId,
          originalName: file.originalname
        },
        tags: ['chat', role, conversationId]
      };

      if (fileType === 'image') {
        uploadOptions.transformation = [
          { quality: 'auto', fetch_format: 'auto' }
        ];
      }

      const result = await uploadToCloudinary(file.buffer, uploadOptions);

      return {
        url: result.secure_url,
        publicId: result.public_id,
        fileType,
        mimeType: file.mimetype,
        originalName: file.originalname,
        size: result.bytes,
        format: result.format,
        width: result.width,
        height: result.height,
        duration: result.duration,
        thumbnail: fileType === 'image' ? result.secure_url : null,
        resourceType: result.resource_type
      };
    });

    const results = await Promise.all(uploadPromises);

    res.status(200).json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('Multiple file upload error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload files'
    });
  }
});

/**
 * POST /upload/ai-design-image
 * Upload a base64 AI design image to Cloudinary
 * @access  Private (Buyer only)
 */
router.post('/ai-design-image', authenticateToken, async (req, res) => {
  try {
    // Ensure user is a buyer
    if (req.user.role !== 'buyer') {
      return res.status(403).json({
        success: false,
        message: 'Only buyers can upload AI design images'
      });
    }

    const { image_base64, apparel_type } = req.body;

    if (!image_base64 || image_base64.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Base64 image data is required'
      });
    }

    const { uploadBase64Image } = require('../config/cloudinary');

    // Upload to Cloudinary
    const uploadResult = await uploadBase64Image(image_base64, {
      folder: `groupo-ai-designs/${req.user.userId}`,
      context: {
        buyer_id: req.user.userId,
        apparel_type: apparel_type || 'unknown',
        uploaded_via: 'ai-design-upload-endpoint'
      },
      tags: ['ai-design', 'uploaded', apparel_type ? apparel_type.toLowerCase().replace(/\s+/g, '-') : 'unknown']
    });

    res.status(200).json({
      success: true,
      data: {
        url: uploadResult.url,
        public_id: uploadResult.public_id,
        width: uploadResult.width,
        height: uploadResult.height,
        format: uploadResult.format,
        bytes: uploadResult.bytes
      }
    });
  } catch (error) {
    console.error('AI design image upload error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload AI design image'
    });
  }
});

module.exports = router;

