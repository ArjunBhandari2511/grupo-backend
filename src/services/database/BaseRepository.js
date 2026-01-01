/**
 * Base Repository - Shared database utilities and Supabase client
 */
const supabase = require('../../config/supabase');

/**
 * Base class for all repositories providing shared functionality
 */
class BaseRepository {
  constructor() {
    this.supabase = supabase;
  }

  /**
   * Handle Supabase "not found" errors gracefully
   * @param {Object} error - Supabase error object
   * @returns {boolean} True if error is "no rows returned"
   */
  isNotFoundError(error) {
    return error && error.code === 'PGRST116';
  }

  /**
   * Handle Supabase unique constraint violation
   * @param {Object} error - Supabase error object
   * @returns {boolean} True if error is unique constraint violation
   */
  isUniqueViolation(error) {
    return error && error.code === '23505';
  }
}

module.exports = { BaseRepository, supabase };

