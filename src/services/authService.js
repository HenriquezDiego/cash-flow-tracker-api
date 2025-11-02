import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import logger from '../config/logger.js';
import UserSheetService from './userSheetService.js';
import SheetCreationService from './sheetCreationService.js';
import { ApiError } from '../middleware/errorHandler.js';

/**
 * Service for handling OAuth authentication
 */
class AuthService {
  constructor() {
    this.userSheetService = new UserSheetService();
    this.sheetCreationService = new SheetCreationService();
    this.initializePassport();
  }

  /**
   * Initialize Passport with Google OAuth strategy
   */
  initializePassport() {
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: process.env.GOOGLE_REDIRECT_URI,
          scope: [
            'profile',
            'email',
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive.readonly'
          ],
          accessType: 'offline',
          prompt: 'consent'
        },
        async (accessToken, refreshToken, profile, done) => {
          try {
            logger.info('Google OAuth callback received', { 
              googleId: profile.id,
              email: profile.emails?.[0]?.value 
            });

            const googleId = profile.id;
            const email = profile.emails?.[0]?.value;
            const name = profile.displayName;

            // Check if user already exists
            let user = await this.userSheetService.findUserByGoogleId(googleId);

            if (user) {
              // Existing user - update tokens
              logger.info('Existing user logging in', { googleId, email });
              await this.userSheetService.updateUserTokens(googleId, accessToken, refreshToken);
              
              // Refresh user data
              user = await this.userSheetService.findUserByGoogleId(googleId);
            } else {
              // New user - create account and sheet
              logger.info('New user detected, creating account', { googleId, email });
              
              // Create Google Sheet for the user
              const sheetId = await this.sheetCreationService.createUserSheet(accessToken, name);
              
              // Create user record in master sheet
              user = await this.userSheetService.createUser({
                googleId,
                email,
                name,
                sheetId,
                accessToken,
                refreshToken
              });

              logger.info('New user created successfully', { 
                userId: user.id, 
                email,
                sheetId 
              });
            }

            return done(null, user);
          } catch (error) {
            logger.error('Error in OAuth callback', { error: error.message, stack: error.stack });
            return done(error, null);
          }
        }
      )
    );

    // Serialize user for session
    passport.serializeUser((user, done) => {
      logger.debug('Serializing user', { userId: user.id });
      done(null, user.id);
    });

    // Deserialize user from session
    passport.deserializeUser(async (id, done) => {
      try {
        logger.debug('Deserializing user', { userId: id });
        const user = await this.userSheetService.findUserById(id);
        
        if (!user) {
          logger.warn('User not found during deserialization', { userId: id });
          return done(new ApiError(404, 'User not found'), null);
        }
        
        done(null, user);
      } catch (error) {
        logger.error('Error deserializing user', { userId: id, error: error.message });
        done(error, null);
      }
    });

    logger.info('Passport initialized with Google OAuth strategy');
  }

  /**
   * Get Passport instance
   * @returns {passport} Passport instance
   */
  getPassport() {
    return passport;
  }

  /**
   * Refresh user's access token using refresh token
   * @param {string} refreshToken - OAuth refresh token
   * @returns {Promise<string>} New access token
   */
  async refreshAccessToken(refreshToken) {
    try {
      logger.info('Refreshing access token');

      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: 'refresh_token'
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Failed to refresh access token', { 
          status: response.status, 
          error: errorText 
        });
        throw new ApiError(401, 'Failed to refresh access token');
      }

      const data = await response.json();
      logger.info('Access token refreshed successfully');
      
      return data.access_token;
    } catch (error) {
      logger.error('Error refreshing access token', { error: error.message });
      throw error;
    }
  }

  /**
   * Validate if user has a valid sheet configured
   * @param {Object} user - User object
   * @returns {boolean} Whether user has a valid sheet
   */
  validateUserSheet(user) {
    return !!(user && user.sheetId && user.sheetId.trim() !== '');
  }

  /**
   * Validate that user has access to a specific Google Sheet
   * @param {string} accessToken - User's OAuth access token
   * @param {string} sheetId - Google Sheet ID to validate
   * @returns {Promise<Object>} Sheet metadata if accessible
   */
  async validateSheetAccess(accessToken, sheetId) {
    try {
      logger.info('Validating sheet access', { sheetId });

      // First, try to access the sheet metadata
      const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Failed to access sheet', { 
          status: response.status, 
          error: errorText 
        });
        throw new ApiError(response.status, 'No tienes acceso a esta hoja de cálculo');
      }

      const sheetData = await response.json();
      logger.info('Sheet access validated successfully', { 
        sheetId, 
        title: sheetData.properties?.title 
      });

      return sheetData;
    } catch (error) {
      logger.error('Error validating sheet access', { 
        sheetId, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * List all spreadsheets available to the user
   * @param {string} accessToken - User's OAuth access token
   * @returns {Promise<Array>} List of spreadsheet files
   */
  async listUserSheets(accessToken) {
    try {
      logger.info('Listing user spreadsheets');

      // Use Drive API to search for spreadsheets
      const response = await fetch(
        'https://www.googleapis.com/drive/v3/files?' +
        new URLSearchParams({
          q: "mimeType='application/vnd.google-apps.spreadsheet'",
          fields: 'files(id,name,createdTime,modifiedTime,webViewLink)',
          orderBy: 'modifiedTime desc',
          pageSize: '50'
        }),
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Failed to list spreadsheets', { 
          status: response.status, 
          error: errorText,
          endpoint: 'Drive API v3/files'
        });
        
        // More specific error message
        let errorMessage = 'Error al listar hojas de cálculo';
        if (response.status === 403) {
          errorMessage = 'No tienes permisos para listar hojas. Por favor, cierra sesión y vuelve a iniciar sesión para otorgar permisos de Google Drive.';
        }
        
        throw new ApiError(response.status, errorMessage);
      }

      const data = await response.json();
      logger.info('Spreadsheets listed successfully', { count: data.files?.length || 0 });

      return data.files || [];
    } catch (error) {
      logger.error('Error listing spreadsheets', { error: error.message });
      throw error;
    }
  }

  /**
   * Validate that a sheet has the required structure (sheets)
   * @param {string} accessToken - User's OAuth access token
   * @param {string} sheetId - Google Sheet ID to validate
   * @returns {Promise<Object>} Validation result with missing sheets list
   */
  async validateSheetStructure(accessToken, sheetId) {
    try {
      logger.info('Validating sheet structure', { sheetId });

      const requiredSheets = [
        'Expenses',
        'Categories',
        'Budget',
        'FixedExpenses',
        'Debts',
        'CreditHistory'
      ];

      // Get sheet metadata
      const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Failed to access sheet for structure validation', { 
          status: response.status, 
          error: errorText 
        });
        throw new ApiError(response.status, 'No se puede acceder a esta hoja de cálculo');
      }

      const sheetData = await response.json();
      const existingSheets = (sheetData.sheets || []).map(s => s.properties.title);
      
      const missingSheets = requiredSheets.filter(
        sheet => !existingSheets.includes(sheet)
      );

      const isValid = missingSheets.length === 0;

      logger.info('Sheet structure validation completed', { 
        sheetId,
        isValid,
        missingSheets: missingSheets.length > 0 ? missingSheets : 'none'
      });

      return {
        isValid,
        missingSheets,
        existingSheets,
        requiredSheets
      };
    } catch (error) {
      logger.error('Error validating sheet structure', { 
        sheetId, 
        error: error.message 
      });
      throw error;
    }
  }
}

// Export singleton instance
const authService = new AuthService();
export default authService;


