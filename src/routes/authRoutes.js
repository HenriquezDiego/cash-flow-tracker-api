import express from 'express';
import {
  loginWithGoogle,
  googleCallback,
  getCurrentUser,
  logout,
  updateSheetId,
  checkAuth,
  listUserSheets,
  validateSheet
} from '../controllers/authController.js';
import { requireAuth, requireJWT } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   GET /api/auth/google
 * @desc    Initiate Google OAuth login
 * @access  Public
 */
router.get('/google', loginWithGoogle);

/**
 * @route   GET /api/auth/google/callback
 * @desc    Handle Google OAuth callback
 * @access  Public
 */
router.get('/google/callback', googleCallback);

/**
 * @route   GET /api/auth/me
 * @desc    Get current user profile
 * @access  Private
 */
router.get('/me', requireAuth, getCurrentUser);

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user
 * @access  Private
 */
router.post('/logout', requireAuth, logout);

/**
 * @route   PUT /api/auth/sheet
 * @desc    Update user's sheet ID
 * @access  Private
 */
router.put('/sheet', requireJWT, updateSheetId);

/**
 * @route   GET /api/auth/sheets
 * @desc    List all spreadsheets available to the user
 * @access  Private
 */
router.get('/sheets', requireJWT, listUserSheets);

/**
 * @route   POST /api/auth/sheet/validate
 * @desc    Validate a sheet structure without updating
 * @access  Private
 */
router.post('/sheet/validate', requireJWT, validateSheet);

/**
 * @route   GET /api/auth/check
 * @desc    Check authentication status
 * @access  Public
 */
router.get('/check', checkAuth);

export default router;


