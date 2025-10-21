import logger from '../config/logger.js';
import { ApiError } from '../middleware/errorHandler.js';

/**
 * Get all fixed expenses
 */
export const getFixedExpenses = async (req, res, next) => {
  try {
    logger.info('GET /api/fixed-expenses - Fetching all fixed expenses');
    
    const fixedExpenses = await req.sheetsService.getFixedExpensesObjects();
    
    res.json({
      success: true,
      data: fixedExpenses,
      count: fixedExpenses.length
    });
  } catch (error) {
    logger.error('Error in getFixedExpenses controller', { error: error.message });
    next(error);
  }
};

/**
 * Add new fixed expense
 */
export const addFixedExpense = async (req, res, next) => {
  try {
    const { id, name, amount, categoryId, dayOfMonth, active } = req.body;
    
    logger.info('POST /api/fixed-expenses - Adding new fixed expense', { 
      name, 
      amount, 
      categoryId 
    });

    // Validate required fields
    if (!name || !amount || !categoryId || !dayOfMonth) {
      throw new ApiError(400, 'Missing required fields: name, amount, categoryId, dayOfMonth');
    }

    // Generate ID if not provided
    const fixedExpenseId = id || Date.now() + Math.random().toString(36).substr(2, 9);
    
    const fixedExpense = {
      id: fixedExpenseId,
      name: name.trim(),
      amount: parseFloat(amount),
      categoryId: parseInt(categoryId, 10),
      dayOfMonth: parseInt(dayOfMonth, 10),
      active: Boolean(active),
      debtId: req.body.debtId || null
    };

    const result = await req.sheetsService.addFixedExpense(fixedExpense);
    
    logger.info('Fixed expense added successfully', { fixedExpenseId: fixedExpense.id });
    
    res.status(201).json({
      success: true,
      message: 'Fixed expense added successfully',
      data: fixedExpense,
      result
    });
  } catch (error) {
    logger.error('Error in addFixedExpense controller', { 
      body: req.body, 
      error: error.message 
    });
    next(error);
  }
};

/**
 * Update fixed expense
 */
export const updateFixedExpense = async (req, res, next) => {
  try {
    const { id: idParam } = req.params;
    const { name, amount, categoryId, dayOfMonth, active } = req.body;
    
    logger.info('PUT /api/fixed-expenses - Updating fixed expense', { 
      id: idParam, 
      name 
    });

    // Validate required fields
    if (!idParam) {
      throw new ApiError(400, 'Missing required field: id');
    }

    const fixedExpense = {
      id: idParam,
      name: name ? name.trim() : undefined,
      amount: amount ? parseFloat(amount) : undefined,
      categoryId: categoryId ? parseInt(categoryId, 10) : undefined,
      dayOfMonth: dayOfMonth ? parseInt(dayOfMonth, 10) : undefined,
      active: active !== undefined ? Boolean(active) : undefined,
      debtId: req.body.debtId !== undefined ? (req.body.debtId || null) : undefined
    };

    const result = await req.sheetsService.updateFixedExpense(fixedExpense);
    
    logger.info('Fixed expense updated successfully', { fixedExpenseId: fixedExpense.id });
    
    res.json({
      success: true,
      message: 'Fixed expense updated successfully',
      data: fixedExpense,
      result
    });
  } catch (error) {
    logger.error('Error in updateFixedExpense controller', { 
      body: req.body, 
      error: error.message 
    });
    next(error);
  }
};

/**
 * Delete fixed expense
 */
export const deleteFixedExpense = async (req, res, next) => {
  try {
    const { id } = req.params;

    logger.info('DELETE /api/fixed-expenses - Deleting fixed expense', { id });

    if (!id) {
      throw new ApiError(400, 'Missing required field: id');
    }

    const result = await req.sheetsService.deleteFixedExpense(id);

    // Build response message
    let message = 'Fixed expense deleted successfully';
    const categoryId = result.fixedExpense.categoryId;
    if (result.deletedExpensesCount > 0) {
      message += `. Also deleted ${result.deletedExpensesCount} related expense(s)`;
    }

    res.json({
      success: true,
      message,
      data: {
        fixedExpense: { id, categoryId: categoryId, deleted: true },
        deletedExpensesCount: result.deletedExpensesCount
      },
      result: result.fixedExpense
    });
  } catch (error) {
    logger.error('Error in deleteFixedExpense controller', {
      params: req.params,
      error: error.message
    });
    next(error);
  }
};

/**
 * Generate fixed expenses for a given month (YYYY-MM)
 */
export const generateFixedExpenses = async (req, res, next) => {
  try {
    const { month } = req.body;

    logger.info('POST /api/generate-fixed-expenses - Generating fixed expenses', { month });

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      throw new ApiError(400, 'Missing or invalid month. Expected format: YYYY-MM');
    }

    const result = await req.sheetsService.generateFixedExpensesForMonth(month);

    res.status(201).json({
      success: true,
      data: result.items,
      count: result.items.length,
      month,
      saved: true,
      saveResult: result.saved ? result.saveResult : undefined
    });
  } catch (error) {
    logger.error('Error in generateFixedExpenses controller', { 
      query: req.query, 
      error: error.message 
    });
    next(error);
  }
};
