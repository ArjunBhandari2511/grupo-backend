const { v2: cloudinary } = require('cloudinary');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

/**
 * Upload file to Cloudinary
 * @param {Buffer} fileBuffer - File buffer from multer
 * @param {Object} options - Upload options
 * @returns {Promise<Object>} - Cloudinary upload result
 */
const uploadToCloudinary = (fileBuffer, options = {}) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: options.folder || 'groupo-chat',
        resource_type: options.resource_type || 'auto',
        allowed_formats: options.allowed_formats,
        max_file_size: options.max_file_size || 10485760, // 10MB default
        transformation: options.transformation,
        ...options
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      }
    );

    uploadStream.end(fileBuffer);
  });
};

/**
 * Upload base64 image to Cloudinary
 * @param {string} base64Image - Base64 image string (can include data URI prefix)
 * @param {Object} options - Upload options
 * @returns {Promise<Object>} - Cloudinary upload result with secure_url
 */
const uploadBase64Image = async (base64Image, options = {}) => {
  try {
    // Remove data URI prefix if present (e.g., "data:image/png;base64,")
    let base64Data = base64Image;
    if (base64Image.includes(',')) {
      base64Data = base64Image.split(',')[1];
    }

    const uploadOptions = {
      folder: options.folder || 'groupo-ai-designs',
      resource_type: 'image',
      // Optimize images automatically
      transformation: [
        { quality: 'auto', fetch_format: 'auto' },
        ...(options.transformation || [])
      ],
      // Add context and tags
      context: {
        ...options.context,
        uploaded_at: new Date().toISOString()
      },
      tags: ['ai-design', ...(options.tags || [])],
      ...options
    };

    const result = await cloudinary.uploader.upload(
      `data:image/png;base64,${base64Data}`,
      uploadOptions
    );

    return {
      url: result.secure_url,
      public_id: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
      bytes: result.bytes,
      ...result
    };
  } catch (error) {
    console.error('Cloudinary base64 upload error:', error);
    throw new Error(`Failed to upload image to Cloudinary: ${error.message}`);
  }
};

module.exports = {
  cloudinary,
  uploadToCloudinary,
  uploadBase64Image
};

