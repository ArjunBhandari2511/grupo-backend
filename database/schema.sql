-- Groupo Manufacturing Platform Database Schema (Onboarding-First)
-- Run these SQL commands in your Supabase SQL Editor
-- 
-- This schema implements an onboarding-first approach where users must complete
-- their profile setup before accessing the main portal features.
-- 
-- Key features:
-- - Onboarding-first flow for both buyers and manufacturers
-- - Profile fields are nullable until onboarding is completed
-- - Constraints ensure required fields are present when onboarding is completed
-- - Separate onboarding status tracking
-- - Verification status management

-- OTP sessions table - stores OTP verification data
CREATE TABLE IF NOT EXISTS otp_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone_number VARCHAR(20) NOT NULL,
  otp_code VARCHAR(10) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  is_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  attempts INTEGER DEFAULT 0
);

-- User sessions table - tracks active JWT sessions
-- References profile tables instead of a separate users table
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL, -- References either buyer_profiles.id or manufacturer_profiles.id
  profile_type VARCHAR(20) NOT NULL CHECK (profile_type IN ('buyer', 'manufacturer')),
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE
);

-- Buyer profiles table - serves as both authentication and profile data storage
-- Profile fields are nullable
CREATE TABLE IF NOT EXISTS buyer_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone_number VARCHAR(20) UNIQUE NOT NULL,
  
  -- Basic Profile Information (nullable)
  full_name VARCHAR(255),
  email VARCHAR(255),
  business_address TEXT,
  about_business TEXT,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_login TIMESTAMP WITH TIME ZONE
);

-- Manufacturer profiles table - serves as both authentication and profile data storage
-- Profile fields are nullable until onboarding is completed
CREATE TABLE IF NOT EXISTS manufacturer_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone_number VARCHAR(20) UNIQUE NOT NULL,
  
  -- Basic Company Information (nullable until onboarding is completed)
  unit_name VARCHAR(255),
  business_type VARCHAR(100),
  gst_number VARCHAR(20),
  pan_number VARCHAR(20),
  coi_number VARCHAR(50),
  
  -- Manufacturing Details
  product_types TEXT[] DEFAULT '{}',
  daily_capacity INTEGER DEFAULT 0,
  location TEXT,
  
  -- Certifications and Documents
  msme_number VARCHAR(50),
  msme_file_url TEXT,
  other_certificates_url TEXT,
  
  -- Onboarding Status
  onboarding_completed BOOLEAN DEFAULT FALSE,
  onboarding_completed_at TIMESTAMP WITH TIME ZONE,
  
  -- Verification Status
  is_verified BOOLEAN DEFAULT FALSE,
  verification_status VARCHAR(20) DEFAULT 'pending' CHECK (verification_status IN ('pending', 'Accepted', 'Rejected', 'Blocked')),
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_login TIMESTAMP WITH TIME ZONE
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_otp_sessions_phone_number ON otp_sessions(phone_number);
CREATE INDEX IF NOT EXISTS idx_otp_sessions_expires_at ON otp_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_profile_id ON user_sessions(profile_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token_hash ON user_sessions(token_hash);

-- Buyer profile indexes
CREATE INDEX IF NOT EXISTS idx_buyer_profiles_phone_number ON buyer_profiles(phone_number);
CREATE INDEX IF NOT EXISTS idx_buyer_profiles_email ON buyer_profiles(email);

-- Manufacturer profile indexes
CREATE INDEX IF NOT EXISTS idx_manufacturer_profiles_phone_number ON manufacturer_profiles(phone_number);
CREATE INDEX IF NOT EXISTS idx_manufacturer_profiles_onboarding_completed ON manufacturer_profiles(onboarding_completed);
CREATE INDEX IF NOT EXISTS idx_manufacturer_profiles_verification_status ON manufacturer_profiles(verification_status);
CREATE INDEX IF NOT EXISTS idx_manufacturer_profiles_business_type ON manufacturer_profiles(business_type);

-- Row Level Security Policies (Disabled for now - using service role)
-- ALTER TABLE otp_sessions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE buyer_profiles ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE manufacturer_profiles ENABLE ROW LEVEL SECURITY;

-- Note: RLS policies are commented out for now since we're using service role key
-- which bypasses RLS. We'll enable these later when implementing proper JWT auth.

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_buyer_profiles_updated_at BEFORE UPDATE ON buyer_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_manufacturer_profiles_updated_at BEFORE UPDATE ON manufacturer_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Constraints removed for buyer profiles (simplified structure)

-- Manufacturer onboarding constraint
ALTER TABLE manufacturer_profiles 
  ADD CONSTRAINT check_manufacturer_onboarding_completed_fields 
  CHECK (
    (onboarding_completed = FALSE) OR 
    (onboarding_completed = TRUE AND unit_name IS NOT NULL AND business_type IS NOT NULL AND gst_number IS NOT NULL)
  );

-- Function to clean up expired OTPs (can be called periodically)
CREATE OR REPLACE FUNCTION cleanup_expired_otps()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM otp_sessions WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- Real-time Chat Schema
-- =============================================

-- Conversations between a buyer and a manufacturer
CREATE TABLE IF NOT EXISTS conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  buyer_id UUID NOT NULL REFERENCES buyer_profiles(id) ON DELETE CASCADE,
  manufacturer_id UUID NOT NULL REFERENCES manufacturer_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_message_at TIMESTAMP WITH TIME ZONE,
  last_message_text TEXT,
  is_archived BOOLEAN DEFAULT FALSE,
  CONSTRAINT uq_conversation_participants UNIQUE (buyer_id, manufacturer_id)
);

-- Messages within a conversation
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_role VARCHAR(20) NOT NULL CHECK (sender_role IN ('buyer', 'manufacturer')),
  sender_id UUID NOT NULL,
  body TEXT NOT NULL,
  requirement_id UUID REFERENCES requirements(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_read BOOLEAN DEFAULT FALSE,
  client_temp_id VARCHAR(64)
);

-- Optional: attachments for messages
CREATE TABLE IF NOT EXISTS message_attachments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  mime_type VARCHAR(255),
  size_bytes INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for chat tables
CREATE INDEX IF NOT EXISTS idx_conversations_buyer_manufacturer ON conversations(buyer_id, manufacturer_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at ON conversations(last_message_at);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_is_read ON messages(is_read);
CREATE INDEX IF NOT EXISTS idx_messages_requirement_id ON messages(requirement_id);

CREATE INDEX IF NOT EXISTS idx_message_attachments_message_id ON message_attachments(message_id);

-- Function to clean up expired sessions
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM user_sessions WHERE expires_at < NOW() OR is_active = FALSE;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Onboarding helper functions

-- Function removed - buyer onboarding no longer tracked

-- Function to mark manufacturer onboarding as completed
CREATE OR REPLACE FUNCTION complete_manufacturer_onboarding(profile_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE manufacturer_profiles 
  SET 
    onboarding_completed = TRUE,
    onboarding_completed_at = NOW(),
    updated_at = NOW()
  WHERE id = profile_id;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function removed - buyer onboarding no longer tracked

-- Function to get manufacturer onboarding status
CREATE OR REPLACE FUNCTION get_manufacturer_onboarding_status(phone_num VARCHAR(20))
RETURNS TABLE (
  id UUID,
  phone_number VARCHAR(20),
  unit_name VARCHAR(255),
  onboarding_completed BOOLEAN,
  onboarding_completed_at TIMESTAMP WITH TIME ZONE,
  verification_status VARCHAR(20)
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    mp.id,
    mp.phone_number,
    mp.unit_name,
    mp.onboarding_completed,
    mp.onboarding_completed_at,
    mp.verification_status
  FROM manufacturer_profiles mp
  WHERE mp.phone_number = phone_num;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- Requirements Schema
-- =============================================

-- Requirements table - buyers submit manufacturing requirements
CREATE TABLE IF NOT EXISTS requirements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  buyer_id UUID NOT NULL REFERENCES buyer_profiles(id) ON DELETE CASCADE,
  requirement_text TEXT NOT NULL,
  quantity INTEGER,
  brand_name VARCHAR(255),
  product_type VARCHAR(255),
  product_link TEXT,
  image_url TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Requirement responses table - manufacturers respond to requirements
CREATE TABLE IF NOT EXISTS requirement_responses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  requirement_id UUID NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  manufacturer_id UUID NOT NULL REFERENCES manufacturer_profiles(id) ON DELETE CASCADE,
  quoted_price DECIMAL(10, 2) NOT NULL,
  price_per_unit DECIMAL(10, 2) NOT NULL,
  delivery_time VARCHAR(255) NOT NULL,
  notes TEXT,
  status VARCHAR(20) DEFAULT 'submitted' CHECK (status IN ('submitted', 'accepted', 'rejected', 'negotiating')),
  invoice_number VARCHAR(50),
  accepted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT uq_requirement_manufacturer UNIQUE (requirement_id, manufacturer_id)
);

-- Indexes for requirements tables
CREATE INDEX IF NOT EXISTS idx_requirements_buyer_id ON requirements(buyer_id);
CREATE INDEX IF NOT EXISTS idx_requirements_created_at ON requirements(created_at);

CREATE INDEX IF NOT EXISTS idx_requirement_responses_requirement_id ON requirement_responses(requirement_id);
CREATE INDEX IF NOT EXISTS idx_requirement_responses_manufacturer_id ON requirement_responses(manufacturer_id);
CREATE INDEX IF NOT EXISTS idx_requirement_responses_status ON requirement_responses(status);

-- Trigger for requirements updated_at
CREATE TRIGGER update_requirements_updated_at BEFORE UPDATE ON requirements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger for requirement_responses updated_at
CREATE TRIGGER update_requirement_responses_updated_at BEFORE UPDATE ON requirement_responses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- =============================================
-- AI Designs Schema
-- =============================================

-- AI Designs table - buyers publish AI-generated designs to manufacturers
CREATE TABLE IF NOT EXISTS ai_designs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  buyer_id UUID NOT NULL REFERENCES buyer_profiles(id) ON DELETE CASCADE,
  apparel_type VARCHAR(255) NOT NULL,
  design_description TEXT,
  image_url TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  preferred_colors TEXT,
  print_placement VARCHAR(255),
  status VARCHAR(20) DEFAULT 'published' CHECK (status IN ('published', 'draft', 'archived')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for AI designs table
CREATE INDEX IF NOT EXISTS idx_ai_designs_buyer_id ON ai_designs(buyer_id);
CREATE INDEX IF NOT EXISTS idx_ai_designs_status ON ai_designs(status);
CREATE INDEX IF NOT EXISTS idx_ai_designs_created_at ON ai_designs(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_designs_apparel_type ON ai_designs(apparel_type);

-- Trigger for AI designs updated_at
CREATE TRIGGER update_ai_designs_updated_at BEFORE UPDATE ON ai_designs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- AI Design Responses Schema
-- =============================================

-- AI Design Responses table - manufacturers respond to AI designs
CREATE TABLE IF NOT EXISTS ai_design_responses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ai_design_id UUID NOT NULL REFERENCES ai_designs(id) ON DELETE CASCADE,
  manufacturer_id UUID NOT NULL REFERENCES manufacturer_profiles(id) ON DELETE CASCADE,
  price_per_unit DECIMAL(10, 2) NOT NULL,
  quantity INTEGER NOT NULL,
  gst DECIMAL(10, 2) NOT NULL DEFAULT 0,
  platform_fee DECIMAL(10, 2) NOT NULL DEFAULT 0,
  quoted_price DECIMAL(10, 2) NOT NULL,
  status VARCHAR(20) DEFAULT 'submitted' CHECK (status IN ('submitted', 'accepted', 'rejected', 'negotiating')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT uq_ai_design_manufacturer UNIQUE (ai_design_id, manufacturer_id)
);

-- Indexes for AI design responses table
CREATE INDEX IF NOT EXISTS idx_ai_design_responses_ai_design_id ON ai_design_responses(ai_design_id);
CREATE INDEX IF NOT EXISTS idx_ai_design_responses_manufacturer_id ON ai_design_responses(manufacturer_id);
CREATE INDEX IF NOT EXISTS idx_ai_design_responses_status ON ai_design_responses(status);
CREATE INDEX IF NOT EXISTS idx_ai_design_responses_created_at ON ai_design_responses(created_at);

-- Trigger for AI design responses updated_at
CREATE TRIGGER update_ai_design_responses_updated_at BEFORE UPDATE ON ai_design_responses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();