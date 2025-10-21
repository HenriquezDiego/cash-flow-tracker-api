import jwt from 'jsonwebtoken';
import logger from '../config/logger.js';
import { encrypt, decrypt } from '../utils/encryption.js';
import userCache from './userCacheService.js';
import { ApiError } from '../middleware/errorHandler.js';
import { nanoid } from 'nanoid';

/**
 * Schema for the Users sheet in the master spreadsheet
 */
export const USER_COLUMNS = {
  ID: 0,              // A: Internal unique ID
  GOOGLE_ID: 1,       // B: Google account ID
  EMAIL: 2,           // C: Email address
  NAME: 3,            // D: Display name
  SHEET_ID: 4,        // E: User's personal Google Sheet ID
  ACCESS_TOKEN: 5,    // F: Encrypted OAuth access token
  REFRESH_TOKEN: 6,   // G: Encrypted OAuth refresh token
  CREATED_AT: 7,      // H: Account creation timestamp
  LAST_LOGIN: 8       // I: Last login timestamp
};

/**
 * Service for managing users in the master Google Sheet
 */
class UserSheetService {
  constructor() {
    this.masterSheetId = process.env.MASTER_SHEET_ID;
    this.serviceAccount = {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY,
      token_uri: 'https://oauth2.googleapis.com/token'
    };
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Get access token for Service Account to access master sheet
   */
  async getMasterAccessToken() {
    try {
      // Check if token is still valid
      if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
        return this.accessToken;
      }

      logger.info('Generating new Service Account access token for master sheet');

      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: this.serviceAccount.client_email,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        aud: this.serviceAccount.token_uri,
        exp: now + 3600,
        iat: now
      };

      const privateKey = this.serviceAccount.private_key.replace(/\\n/g, '\n');
      const token = jwt.sign(payload, privateKey, { algorithm: 'RS256' });
      
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: token
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Failed to get Service Account access token', { 
          status: response.status, 
          error: errorText 
        });
        throw new ApiError(500, 'Failed to authenticate with Google Sheets API');
      }

      const data = await response.json();
      this.accessToken = data.access_token;
      this.tokenExpiry = Date.now() + (data.expires_in * 1000);
      
      logger.info('Successfully obtained Service Account access token');
      return this.accessToken;
    } catch (error) {
      logger.error('Error getting Service Account access token', { 
        error: error.message, 
        stack: error.stack 
      });
      throw error;
    }
  }

  /**
   * Make authenticated request to master Google Sheet
   */
  async makeRequest(endpoint, options = {}) {
    try {
      const token = await this.getMasterAccessToken();
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.masterSheetId}${endpoint}`;
      
      logger.debug('Making request to master sheet', { url, method: options.method || 'GET' });
      
      const response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...options.headers
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Master sheet API error', { 
          status: response.status, 
          endpoint, 
          error: errorText 
        });
        throw new ApiError(response.status, `Master sheet API error: ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      logger.error('Error making master sheet request', { 
        endpoint, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Find user by Google ID
   * @param {string} googleId - User's Google ID
   * @returns {Object|null} User data or null if not found
   */
  async findUserByGoogleId(googleId) {
    try {
      // Check cache first
      const cached = userCache.get(googleId);
      if (cached) {
        logger.debug('User found in cache', { googleId });
        return cached;
      }

      // Fetch from master sheet
      logger.debug('Fetching user from master sheet', { googleId });
      const response = await this.makeRequest('/values/Users!A:I');
      const rows = response.values || [];

      // Search for user (skip header row)
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row[USER_COLUMNS.GOOGLE_ID] === googleId) {
          const user = this.parseUserRow(row);
          
          // Cache the user
          userCache.set(googleId, user);
          logger.info('User found in master sheet', { googleId, userId: user.id });
          return user;
        }
      }

      logger.debug('User not found in master sheet', { googleId });
      return null;
    } catch (error) {
      logger.error('Error finding user by Google ID', { googleId, error: error.message });
      throw error;
    }
  }

  /**
   * Find user by internal ID
   * @param {string} id - User's internal ID
   * @returns {Object|null} User data or null if not found
   */
  async findUserById(id) {
    try {
      const response = await this.makeRequest('/values/Users!A:I');
      const rows = response.values || [];

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row[USER_COLUMNS.ID] === id) {
          return this.parseUserRow(row);
        }
      }

      return null;
    } catch (error) {
      logger.error('Error finding user by ID', { id, error: error.message });
      throw error;
    }
  }

  /**
   * Create a new user
   * @param {Object} userData - User data
   * @returns {Object} Created user
   */
  async createUser(userData) {
    try {
      logger.info('Creating new user', { email: userData.email });

      const id = nanoid(10);
      const now = new Date().toISOString();

      const values = [[
        id,
        userData.googleId,
        userData.email,
        userData.name || '',
        userData.sheetId || '',
        userData.accessToken ? encrypt(userData.accessToken) : '',
        userData.refreshToken ? encrypt(userData.refreshToken) : '',
        now,
        now
      ]];

      await this.makeRequest('/values/Users!A:I:append?valueInputOption=RAW', {
        method: 'POST',
        body: JSON.stringify({ values })
      });

      const user = {
        id,
        googleId: userData.googleId,
        email: userData.email,
        name: userData.name,
        sheetId: userData.sheetId,
        accessToken: userData.accessToken,
        refreshToken: userData.refreshToken,
        createdAt: now,
        lastLogin: now
      };

      // Cache the user
      userCache.set(userData.googleId, user);

      logger.info('User created successfully', { userId: id, email: userData.email });
      return user;
    } catch (error) {
      logger.error('Error creating user', { error: error.message });
      throw error;
    }
  }

  /**
   * Update user's OAuth tokens
   * @param {string} googleId - User's Google ID
   * @param {string} accessToken - New access token
   * @param {string} refreshToken - New refresh token
   */
  async updateUserTokens(googleId, accessToken, refreshToken) {
    try {
      const rowNumber = await this.findUserRowNumber(googleId);
      if (!rowNumber) {
        throw new ApiError(404, 'User not found');
      }

      const now = new Date().toISOString();
      
      // Update tokens and last login (columns F, G, I)
      await this.makeRequest(
        `/values/Users!F${rowNumber}:G${rowNumber}?valueInputOption=RAW`,
        {
          method: 'PUT',
          body: JSON.stringify({
            values: [[
              encrypt(accessToken),
              encrypt(refreshToken)
            ]]
          })
        }
      );

      // Update last login separately
      await this.makeRequest(
        `/values/Users!I${rowNumber}?valueInputOption=RAW`,
        {
          method: 'PUT',
          body: JSON.stringify({
            values: [[now]]
          })
        }
      );

      // Invalidate cache
      userCache.invalidate(googleId);

      logger.info('User tokens updated', { googleId });
    } catch (error) {
      logger.error('Error updating user tokens', { googleId, error: error.message });
      throw error;
    }
  }

  /**
   * Update user's sheet ID
   * @param {string} googleId - User's Google ID
   * @param {string} sheetId - New sheet ID
   */
  async updateUserSheetId(googleId, sheetId) {
    try {
      const rowNumber = await this.findUserRowNumber(googleId);
      if (!rowNumber) {
        throw new ApiError(404, 'User not found');
      }

      await this.makeRequest(
        `/values/Users!E${rowNumber}?valueInputOption=RAW`,
        {
          method: 'PUT',
          body: JSON.stringify({
            values: [[sheetId]]
          })
        }
      );

      // Invalidate cache
      userCache.invalidate(googleId);

      logger.info('User sheet ID updated', { googleId, sheetId });
    } catch (error) {
      logger.error('Error updating user sheet ID', { googleId, error: error.message });
      throw error;
    }
  }

  /**
   * Find the row number for a user by Google ID
   * @param {string} googleId - User's Google ID
   * @returns {number|null} Row number (1-based) or null
   */
  async findUserRowNumber(googleId) {
    try {
      const response = await this.makeRequest('/values/Users!B:B');
      const rows = response.values || [];

      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === googleId) {
          return i + 1; // 1-based row number
        }
      }

      return null;
    } catch (error) {
      logger.error('Error finding user row number', { googleId, error: error.message });
      throw error;
    }
  }

  /**
   * Parse a row from the Users sheet into a user object
   * @param {Array} row - Row data from sheet
   * @returns {Object} User object
   */
  parseUserRow(row) {
    return {
      id: row[USER_COLUMNS.ID] || '',
      googleId: row[USER_COLUMNS.GOOGLE_ID] || '',
      email: row[USER_COLUMNS.EMAIL] || '',
      name: row[USER_COLUMNS.NAME] || '',
      sheetId: row[USER_COLUMNS.SHEET_ID] || '',
      accessToken: row[USER_COLUMNS.ACCESS_TOKEN] ? decrypt(row[USER_COLUMNS.ACCESS_TOKEN]) : null,
      refreshToken: row[USER_COLUMNS.REFRESH_TOKEN] ? decrypt(row[USER_COLUMNS.REFRESH_TOKEN]) : null,
      createdAt: row[USER_COLUMNS.CREATED_AT] || '',
      lastLogin: row[USER_COLUMNS.LAST_LOGIN] || ''
    };
  }
}

export default UserSheetService;


