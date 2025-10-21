import logger from '../config/logger.js';

/**
 * In-memory cache for user data to reduce Google Sheets API calls
 */
class UserCache {
  constructor() {
    this.cache = new Map();
    this.TTL = 5 * 60 * 1000; // 5 minutes Time To Live
    
    // Cleanup expired entries every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 1000);
  }

  /**
   * Store user data in cache
   * @param {string} googleId - User's Google ID
   * @param {Object} userData - User data to cache
   */
  set(googleId, userData) {
    this.cache.set(googleId, {
      data: userData,
      timestamp: Date.now()
    });
    
    logger.debug('User cached', { googleId, cacheSize: this.cache.size });
  }

  /**
   * Retrieve user data from cache
   * @param {string} googleId - User's Google ID
   * @returns {Object|null} User data or null if not found/expired
   */
  get(googleId) {
    const cached = this.cache.get(googleId);
    
    if (!cached) {
      return null;
    }
    
    // Check if expired
    const age = Date.now() - cached.timestamp;
    if (age > this.TTL) {
      this.cache.delete(googleId);
      logger.debug('Cache expired for user', { googleId, age });
      return null;
    }
    
    logger.debug('Cache hit for user', { googleId, age });
    return cached.data;
  }

  /**
   * Invalidate (remove) user data from cache
   * @param {string} googleId - User's Google ID
   */
  invalidate(googleId) {
    const existed = this.cache.delete(googleId);
    if (existed) {
      logger.debug('Cache invalidated for user', { googleId });
    }
  }

  /**
   * Clear all cached data
   */
  clear() {
    const size = this.cache.size;
    this.cache.clear();
    logger.info('Cache cleared', { previousSize: size });
  }

  /**
   * Cleanup expired entries
   */
  cleanup() {
    const now = Date.now();
    let removed = 0;

    for (const [googleId, cached] of this.cache.entries()) {
      if (now - cached.timestamp > this.TTL) {
        this.cache.delete(googleId);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug('Cache cleanup completed', { removed, remaining: this.cache.size });
    }
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  getStats() {
    const now = Date.now();
    let expired = 0;
    let valid = 0;

    for (const cached of this.cache.values()) {
      if (now - cached.timestamp > this.TTL) {
        expired++;
      } else {
        valid++;
      }
    }

    return {
      total: this.cache.size,
      valid,
      expired,
      ttl: this.TTL
    };
  }

  /**
   * Stop cleanup interval (for graceful shutdown)
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clear();
    logger.info('User cache destroyed');
  }
}

// Export singleton instance
export default new UserCache();


