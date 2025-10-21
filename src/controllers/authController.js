import logger from '../config/logger.js';
import { generateToken } from '../middleware/authMiddleware.js';
import authService from '../services/authService.js';

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
      'https://www.googleapis.com/auth/spreadsheets'
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
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
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
 * Update user's sheet ID (for future use when we add "connect existing sheet")
 */
export const updateSheetId = async (req, res, next) => {
  try {
    const { sheetId } = req.body;

    if (!sheetId || typeof sheetId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Valid sheet ID is required'
      });
    }

    logger.info('Updating user sheet ID', { 
      userId: req.user.id, 
      newSheetId: sheetId 
    });

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
      data: { sheetId }
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

