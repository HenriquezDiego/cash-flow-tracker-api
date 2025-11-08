import logger from '../config/logger.js';
import { generateToken } from '../middleware/authMiddleware.js';
import authService from '../services/authService.js';
import { ApiError } from '../middleware/errorHandler.js';

/**
 * Initiate Google OAuth login
 */
export const loginWithGoogle = (req, res, next) => {
  logger.info('Initiating Google OAuth login');
  // Passport will handle the redirect to Google
  authService.getPassport().authenticate('google', {
    scope: [
      'profile',
      'email',
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.readonly'
    ],
    accessType: 'offline',
    prompt: 'consent'
  })(req, res, next);
};

/**
 * Handle Google OAuth callback
 */
export const googleCallback = (req, res, next) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  
  authService.getPassport().authenticate('google', {
    failureRedirect: `${frontendUrl}/login?error=auth_failed`,
    session: true
  })(req, res, (err) => {
    if (err) {
      logger.error('Google OAuth callback error', { error: err.message });
      return res.redirect(`${frontendUrl}/login?error=auth_failed`);
    }

    if (!req.user) {
      logger.error('No user in OAuth callback');
      return res.redirect(`${frontendUrl}/login?error=no_user`);
    }

    logger.info('User authenticated successfully', { 
      userId: req.user.id,
      email: req.user.email 
    });

    // Generate JWT token for API access
    const token = generateToken(req.user);

    // Redirect to frontend with token
    const redirectUrl = `${frontendUrl}/auth/callback?token=${token}`;
    res.redirect(redirectUrl);
  });
};

/**
 * Get current user profile
 */
export const getCurrentUser = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
    }

    logger.debug('Fetching current user profile', { userId: req.user.id });

    // Don't send sensitive data
    const userProfile = {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      sheetId: req.user.sheetId,
      createdAt: req.user.createdAt,
      lastLogin: req.user.lastLogin
    };

    res.json({
      success: true,
      data: userProfile
    });
  } catch (error) {
    logger.error('Error fetching current user', { error: error.message });
    next(error);
  }
};

/**
 * Logout user
 */
export const logout = (req, res, next) => {
  const userId = req.user?.id;
  
  req.logout((err) => {
    if (err) {
      logger.error('Error during logout', { userId, error: err.message });
      return next(err);
    }

    req.session.destroy((err) => {
      if (err) {
        logger.error('Error destroying session', { userId, error: err.message });
        return next(err);
      }

      logger.info('User logged out successfully', { userId });
      res.json({
        success: true,
        message: 'Logged out successfully'
      });
    });
  });
};

/**
 * Update user's sheet ID (connect existing sheet)
 */
export const updateSheetId = async (req, res, next) => {
  try {
    const { sheetId, skipValidation } = req.body;

    if (!sheetId || typeof sheetId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Valid sheet ID is required'
      });
    }

    logger.info('Updating user sheet ID', { 
      userId: req.user.id, 
      newSheetId: sheetId,
      skipValidation: skipValidation || false
    });

    // Validate access to the sheet
    const sheetMetadata = await authService.validateSheetAccess(
      req.user.accessToken,
      sheetId
    );

    // Validate sheet structure unless explicitly skipped
    let validationResult = null;
    if (!skipValidation) {
      validationResult = await authService.validateSheetStructure(
        req.user.accessToken,
        sheetId
      );

      if (!validationResult.isValid) {
        return res.status(400).json({
          success: false,
          error: 'La hoja de cálculo no tiene la estructura requerida',
          validation: validationResult,
          message: `Faltan las siguientes hojas: ${validationResult.missingSheets.join(', ')}`
        });
      }
    }

    const UserSheetService = (await import('../services/userSheetService.js')).default;
    const userSheetService = new UserSheetService();

    await userSheetService.updateUserSheetId(req.user.googleId, sheetId);

    logger.info('User sheet ID updated successfully', { 
      userId: req.user.id, 
      sheetId 
    });

    res.json({
      success: true,
      message: 'Sheet ID updated successfully',
      data: { 
        sheetId,
        title: sheetMetadata.properties?.title
      },
      validation: validationResult
    });
  } catch (error) {
    logger.error('Error updating sheet ID', { 
      userId: req.user?.id, 
      error: error.message 
    });
    next(error);
  }
};

/**
 * List all spreadsheets available to the user
 */
export const listUserSheets = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
    }

    logger.info('Listing user spreadsheets', { userId: req.user.id });

    // Get a valid access token (refresh if needed)
    let accessToken = req.user.accessToken;
    
    // Try to list sheets, if it fails with 401, refresh token and try again
    try {
      const sheets = await authService.listUserSheets(accessToken);
      
      res.json({
        success: true,
        data: sheets,
        count: sheets.length
      });
    } catch (error) {
      // If token expired (401), refresh it and try again
      // ApiError uses statusCode, but check both for compatibility
      const errorStatus = error.statusCode || error.status || (error.response && error.response.status);
      if (errorStatus === 401 && req.user.refreshToken) {
        logger.info('Access token expired, refreshing...', { userId: req.user.id });
        
        try {
          accessToken = await authService.refreshAccessToken(req.user.refreshToken);
          
          // Update user's access token in database
          const UserSheetService = (await import('../services/userSheetService.js')).default;
          const userSheetService = new UserSheetService();
          await userSheetService.updateUserTokens(req.user.googleId, accessToken, req.user.refreshToken);
          
          // Try again with refreshed token
          const sheets = await authService.listUserSheets(accessToken);
          
          res.json({
            success: true,
            data: sheets,
            count: sheets.length
          });
        } catch (refreshError) {
          logger.error('Failed to refresh access token', { 
            userId: req.user.id, 
            error: refreshError.message 
          });
          throw new ApiError(401, 'Error al actualizar la sesión. Por favor, inicia sesión nuevamente.');
        }
      } else {
        // Re-throw original error
        throw error;
      }
    }
  } catch (error) {
    logger.error('Error listing user spreadsheets', { 
      userId: req.user?.id, 
      error: error.message 
    });
    next(error);
  }
};

/**
 * Validate a sheet structure without updating
 */
export const validateSheet = async (req, res, next) => {
  try {
    const { sheetId } = req.body;

    if (!sheetId || typeof sheetId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Valid sheet ID is required'
      });
    }

    logger.info('Validating sheet structure', { 
      userId: req.user.id, 
      sheetId 
    });

    // Helper function to validate with token refresh
    const validateWithRefresh = async (accessToken) => {
      try {
        const sheetMetadata = await authService.validateSheetAccess(accessToken, sheetId);
        const validationResult = await authService.validateSheetStructure(accessToken, sheetId);
        return { sheetMetadata, validationResult };
      } catch (error) {
        const errorStatus = error.statusCode || error.status;
        if (errorStatus === 401 && req.user.refreshToken) {
          logger.info('Access token expired during validation, refreshing...', { userId: req.user.id });
          const newToken = await authService.refreshAccessToken(req.user.refreshToken);
          
          // Update user's access token in database
          const UserSheetService = (await import('../services/userSheetService.js')).default;
          const userSheetService = new UserSheetService();
          await userSheetService.updateUserTokens(req.user.googleId, newToken, req.user.refreshToken);
          
          // Retry with new token
          const sheetMetadata = await authService.validateSheetAccess(newToken, sheetId);
          const validationResult = await authService.validateSheetStructure(newToken, sheetId);
          return { sheetMetadata, validationResult };
        }
        throw error;
      }
    };

    const { sheetMetadata, validationResult } = await validateWithRefresh(req.user.accessToken);

    res.json({
      success: true,
      data: {
        sheetId,
        title: sheetMetadata.properties?.title,
        ...validationResult
      }
    });
  } catch (error) {
    logger.error('Error validating sheet', { 
      userId: req.user?.id, 
      error: error.message 
    });
    next(error);
  }
};

/**
 * Health check for authentication status
 */
export const checkAuth = (req, res) => {
  const isAuthenticated = req.isAuthenticated && req.isAuthenticated();
  
  res.json({
    success: true,
    authenticated: isAuthenticated,
    user: isAuthenticated ? {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      hasSheet: !!(req.user.sheetId && req.user.sheetId.trim() !== '')
    } : null
  });
};

