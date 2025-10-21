import logger from '../config/logger.js';
import { ApiError } from '../middleware/errorHandler.js';

const sheetsService = new GoogleSheetsService();

/**
 * Get all categories
 */
export const getCategories = async (req, res, next) => {
  try {
    logger.info('GET /api/categories - Fetching all categories', { userId: req.user?.id });
    
    const categories = await req.sheetsService.getCategories();
    
    res.json({
      success: true,
      data: categories,
      count: categories.length
    });
  } catch (error) {
    logger.error('Error in getCategories controller', { error: error.message });
    next(error);
  }
};

/**
 * Create a new category
 */
export const createCategory = async (req, res, next) => {
  try {
    const { name, color } = req.body;
    
    logger.info('POST /api/categories - Creating new category', { name });
    
    // Validate required fields
    if (!name || name.trim() === '') {
      throw new ApiError(400, 'Category name is required');
    }
    
    const category = {
      name: name.trim(),
      color: color || '#6B7280'
    };
    
    const result = await sheetsService.addCategory(category);
    
    logger.info('Category created successfully', { id: result.id, name: result.name });
    
    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      data: result
    });
  } catch (error) {
    logger.error('Error in createCategory controller', { 
      body: req.body, 
      error: error.message 
    });
    next(error);
  }
};

/**
 * Update a category
 */
export const updateCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, color } = req.body;
    
    logger.info('PUT /api/categories - Updating category', { id });
    
    // Validate ID
    if (!id || isNaN(parseInt(id))) {
      throw new ApiError(400, 'Valid category ID is required');
    }
    
    // Prepare update data
    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (color !== undefined) updateData.color = color;
    
    // Check if there's something to update
    if (Object.keys(updateData).length === 0) {
      throw new ApiError(400, 'At least one field must be provided for update');
    }
    
    const result = await sheetsService.updateCategory(id, updateData);
    
    logger.info('Category updated successfully', { id, name: result.name });
    
    res.json({
      success: true,
      message: 'Category updated successfully',
      data: result
    });
  } catch (error) {
    logger.error('Error in updateCategory controller', { 
      params: req.params,
      body: req.body, 
      error: error.message 
    });
    next(error);
  }
};

/**
 * Delete a category
 */
export const deleteCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    logger.info('DELETE /api/categories - Deleting category', { id });
    
    // Validate ID
    if (!id || isNaN(parseInt(id))) {
      throw new ApiError(400, 'Valid category ID is required');
    }
    
    const result = await sheetsService.deleteCategory(id);
    
    logger.info('Category deleted successfully', { id });
    
    res.json({
      success: true,
      message: 'Category deleted successfully',
      data: result
    });
  } catch (error) {
    logger.error('Error in deleteCategory controller', { 
      params: req.params,
      error: error.message 
    });
    next(error);
  }
};
