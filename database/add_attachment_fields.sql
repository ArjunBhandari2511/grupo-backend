-- Add additional fields to message_attachments table for better file metadata
-- Run this SQL in your Supabase SQL Editor

-- Add file_type column to categorize attachments (image, video, audio, document)
ALTER TABLE message_attachments 
ADD COLUMN IF NOT EXISTS file_type VARCHAR(50);

-- Add original_name column to store the original filename
ALTER TABLE message_attachments 
ADD COLUMN IF NOT EXISTS original_name VARCHAR(255);

-- Add public_id column to store Cloudinary public ID for potential deletion
ALTER TABLE message_attachments 
ADD COLUMN IF NOT EXISTS public_id VARCHAR(255);

-- Add thumbnail_url column for video thumbnails
ALTER TABLE message_attachments 
ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

-- Add width and height for images/videos
ALTER TABLE message_attachments 
ADD COLUMN IF NOT EXISTS width INTEGER;

ALTER TABLE message_attachments 
ADD COLUMN IF NOT EXISTS height INTEGER;

-- Add duration for audio/video files (in seconds)
ALTER TABLE message_attachments 
ADD COLUMN IF NOT EXISTS duration NUMERIC(10, 2);

-- Create index on file_type for faster filtering
CREATE INDEX IF NOT EXISTS idx_message_attachments_file_type ON message_attachments(file_type);

-- Comment to describe the purpose
COMMENT ON TABLE message_attachments IS 'Stores file attachments (images, audio, videos, documents) for chat messages using Cloudinary';
COMMENT ON COLUMN message_attachments.file_type IS 'Type of file: image, video, audio, or document';
COMMENT ON COLUMN message_attachments.original_name IS 'Original filename as uploaded by user';
COMMENT ON COLUMN message_attachments.public_id IS 'Cloudinary public_id for file management';
COMMENT ON COLUMN message_attachments.thumbnail_url IS 'Thumbnail URL for videos or large images';
COMMENT ON COLUMN message_attachments.duration IS 'Duration in seconds for audio/video files';

