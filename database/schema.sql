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
-- Profile fields are nullable until onboarding is completed
CREATE TABLE IF NOT EXISTS buyer_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone_number VARCHAR(20) UNIQUE NOT NULL,
  
  -- Basic Profile Information (nullable until onboarding is completed)
  full_name VARCHAR(255),
  email VARCHAR(255),
  company_name VARCHAR(255),
  gst_number VARCHAR(20),
  business_address TEXT,
  about_business TEXT,
  
  -- Onboarding Status
  onboarding_completed BOOLEAN DEFAULT FALSE,
  onboarding_completed_at TIMESTAMP WITH TIME ZONE,
  
  -- Verification Status
  is_verified BOOLEAN DEFAULT FALSE,
  verification_status VARCHAR(20) DEFAULT 'pending' CHECK (verification_status IN ('pending', 'under_review', 'approved', 'rejected')),
  
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
  verification_status VARCHAR(20) DEFAULT 'pending' CHECK (verification_status IN ('pending', 'under_review', 'approved', 'rejected')),
  
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
CREATE INDEX IF NOT EXISTS idx_buyer_profiles_onboarding_completed ON buyer_profiles(onboarding_completed);
CREATE INDEX IF NOT EXISTS idx_buyer_profiles_verification_status ON buyer_profiles(verification_status);
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

-- Constraints to ensure required fields are present when onboarding is completed

-- Buyer onboarding constraint
ALTER TABLE buyer_profiles 
  ADD CONSTRAINT check_buyer_onboarding_completed_fields 
  CHECK (
    (onboarding_completed = FALSE) OR 
    (onboarding_completed = TRUE AND full_name IS NOT NULL AND email IS NOT NULL AND company_name IS NOT NULL)
  );

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

-- Function to mark buyer onboarding as completed
CREATE OR REPLACE FUNCTION complete_buyer_onboarding(profile_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE buyer_profiles 
  SET 
    onboarding_completed = TRUE,
    onboarding_completed_at = NOW(),
    updated_at = NOW()
  WHERE id = profile_id;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

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

-- Function to get buyer onboarding status
CREATE OR REPLACE FUNCTION get_buyer_onboarding_status(phone_num VARCHAR(20))
RETURNS TABLE (
  id UUID,
  phone_number VARCHAR(20),
  full_name VARCHAR(255),
  onboarding_completed BOOLEAN,
  onboarding_completed_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    bp.id,
    bp.phone_number,
    bp.full_name,
    bp.onboarding_completed,
    bp.onboarding_completed_at
  FROM buyer_profiles bp
  WHERE bp.phone_number = phone_num;
END;
$$ LANGUAGE plpgsql;

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
