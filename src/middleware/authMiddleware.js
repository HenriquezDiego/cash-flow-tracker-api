import jwt from 'jsonwebtoken';
import logger from '../config/logger.js';
import { ApiError } from './errorHandler.js';
import UserSheetService from '../services/userSheetService.js';

const userSheetService = new UserSheetService();

/**
 * Middleware to check if user is authenticated via session (Passport)
 */
export const requireAuth = (req, res, next) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    logger.debug('User authenticated via session', { userId: req.user?.id });
    return next();
  }

  logger.warn('Authentication required but user not authenticated');
  return res.status(401).json({
    success: false,
    error: 'Authentication required. Please log in.'
  });
};

/**
 * Middleware to check if user is authenticated via JWT token
 * Alternative to session-based auth for API access
 */
export const requireJWT = async (req, res, next) => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new ApiError(401, 'No token provided');
    }

    const token = authHeader.split(' ')[1];

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user from database
    const user = await userSheetService.findUserById(decoded.userId);
    
    if (!user) {
      throw new ApiError(401, 'User not found');
    }

    // Attach user to request
    req.user = user;
    
    logger.debug('User authenticated via JWT', { userId: user.id });
    next();
  } catch (error) {
    logger.error('JWT authentication failed', { error: error.message });
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expired'
      });
    }

    return res.status(401).json({
      success: false,
      error: error.message || 'Authentication failed'
    });
  }
};

/**
 * Middleware to check if user has a valid sheet configured
 */
export const requireSheet = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }

  if (!req.user.sheetId || req.user.sheetId.trim() === '') {
    logger.warn('User has no sheet configured', { userId: req.user.id });
    return res.status(400).json({
      success: false,
      error: 'No Google Sheet configured. Please set up your sheet first.',
      needsSetup: true
    });
  }

  logger.debug('User has valid sheet', { userId: req.user.id, sheetId: req.user.sheetId });
  next();
};

/**
 * Combined middleware: Require auth + valid sheet
 */
export const requireAuthAndSheet = [requireAuth, requireSheet];

/**
 * Combined middleware: Require JWT + valid sheet
 */
export const requireJWTAndSheet = [requireJWT, requireSheet];

/**
 * Generate JWT token for a user
 * @param {Object} user - User object
 * @returns {string} JWT token
 */
export function generateToken(user) {
  const payload = {
    userId: user.id,
    email: user.email,
    googleId: user.googleId
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: '7d' // Token valid for 7 days
  });

  logger.debug('JWT token generated', { userId: user.id });
  
  return token;
}

/**
 * Middleware to attach user's Google Sheets service instance to request
 * This should run AFTER authentication middleware
 */
export const attachSheetsService = async (req, res, next) => {
  try {
    if (!req.user) {
      throw new ApiError(401, 'User not authenticated');
    }

    if (!req.user.sheetId) {
      throw new ApiError(400, 'User has no sheet configured');
    }

    // Import GoogleSheetsService dynamically to avoid circular dependency
    const { default: GoogleSheetsService } = await import('../services/googleSheetsService.js');
    
    // Create a service instance with user's credentials
    req.sheetsService = new GoogleSheetsService(
      req.user.accessToken,
      req.user.sheetId
    );

    logger.debug('Sheets service attached to request', { 
      userId: req.user.id, 
      sheetId: req.user.sheetId 
    });
    
    next();
  } catch (error) {
    logger.error('Error attaching sheets service', { error: error.message });
    next(error);
  }
};


