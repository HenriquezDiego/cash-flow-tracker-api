import { body, param } from 'express-validator';

/**
 * Validation rules for creating categories
 */
export const createCategoryValidator = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Name must be between 1 and 255 characters'),
    
  body('color')
    .optional()
    .matches(/^#[0-9A-Fa-f]{6}$/)
    .withMessage('Color must be a valid hex color (e.g., #FF5733)')
];

/**
 * Validation rules for updating categories
 */
export const updateCategoryValidator = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID must be a positive integer'),
    
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Name must be between 1 and 255 characters'),
    
  body('color')
    .optional()
    .matches(/^#[0-9A-Fa-f]{6}$/)
    .withMessage('Color must be a valid hex color (e.g., #FF5733)')
];

/**
 * Validation rules for deleting categories
 */
export const deleteCategoryValidator = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID must be a positive integer')
];
