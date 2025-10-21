import crypto from 'crypto';
import logger from '../config/logger.js';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

/**
 * Get encryption key from environment
 * @returns {Buffer} Encryption key
 */
function getEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY;
  
  if (!key) {
    throw new Error('ENCRYPTION_KEY not configured in environment variables');
  }
  
  // Ensure key is exactly 32 bytes for AES-256
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be exactly 32 characters');
  }
  
  return Buffer.from(key, 'utf-8');
}

/**
 * Encrypt a text string
 * @param {string} text - Text to encrypt
 * @returns {string} Encrypted text in format: iv:encryptedData
 */
export function encrypt(text) {
  try {
    if (!text) {
      return '';
    }

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Return IV and encrypted data separated by colon
    return iv.toString('hex') + ':' + encrypted;
  } catch (error) {
    logger.error('Error encrypting data', { error: error.message });
    throw new Error('Encryption failed');
  }
}

/**
 * Decrypt an encrypted string
 * @param {string} text - Encrypted text in format: iv:encryptedData
 * @returns {string} Decrypted text
 */
export function decrypt(text) {
  try {
    if (!text) {
      return '';
    }

    const parts = text.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const encryptedData = Buffer.from(parts[1], 'hex');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
    
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    logger.error('Error decrypting data', { error: error.message });
    throw new Error('Decryption failed');
  }
}

/**
 * Generate a random encryption key (for setup purposes)
 * @returns {string} 32-character random key
 */
export function generateEncryptionKey() {
  return crypto.randomBytes(32).toString('hex').slice(0, 32);
}


