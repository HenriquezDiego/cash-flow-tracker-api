import express from 'express';
import {
  loginWithGoogle,
  googleCallback,
  getCurrentUser,
  logout,
  updateSheetId,
  checkAuth
} from '../controllers/authController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

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
router.put('/sheet', requireAuth, updateSheetId);

/**
 * @route   GET /api/auth/check
 * @desc    Check authentication status
 * @access  Public
 */
router.get('/check', checkAuth);

export default router;


