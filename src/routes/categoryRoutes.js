import express from 'express';
import { 
  getCategories, 
  createCategory, 
  updateCategory, 
  deleteCategory 
} from '../controllers/categoryController.js';
import { 
  createCategoryValidator, 
  updateCategoryValidator, 
  deleteCategoryValidator 
} from '../validators/categoryValidators.js';
import { validate } from '../middleware/validation.js';

const router = express.Router();

/**
 * @route   GET /api/categories
 * @desc    Get all categories
 * @access  Public
 */
router.get('/', getCategories);

/**
 * @route   POST /api/categories
 * @desc    Create a new category
 * @access  Private (requires JWT authentication)
 */
router.post('/', createCategoryValidator, validate, createCategory);

/**
 * @route   PUT /api/categories/:id
 * @desc    Update a category
 * @access  Private (requires JWT authentication)
 */
router.put('/:id', updateCategoryValidator, validate, updateCategory);

/**
 * @route   DELETE /api/categories/:id
 * @desc    Delete a category
 * @access  Private (requires JWT authentication)
 */
router.delete('/:id', deleteCategoryValidator, validate, deleteCategory);

export default router;
