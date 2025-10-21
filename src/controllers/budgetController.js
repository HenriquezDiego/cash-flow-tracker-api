import logger from '../config/logger.js';
import { ApiError } from '../middleware/errorHandler.js';

/**
 * Get budget
 */
export const getBudget = async (req, res, next) => {
  try {
    logger.info('GET /api/budget - Fetching budget', { userId: req.user?.id });
    
    const rows = await req.sheetsService.getBudgetObjects();

    res.json({
      success: true,
      data: rows,
      count: rows.length
    });
  } catch (error) {
    logger.error('Error in getBudget controller', { error: error.message });
    next(error);
  }
};

/**
 * Update budget
 */
export const updateBudget = async (req, res, next) => {
  try {
    const { month, amount } = req.body;
    
    logger.info('PUT /api/budget - Updating budget', { month, amount });

    // Validate required fields
    if (!month || !amount) {
      throw new ApiError(400, 'Missing required fields: month, amount');
    }

    // Validate month format (YYYY-MM)
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new ApiError(400, 'Invalid month format. Use YYYY-MM');
    }

    // Validate amount
    if (isNaN(amount) || parseFloat(amount) < 0) {
      throw new ApiError(400, 'Amount must be a non-negative number');
    }

    const budget = {
      month,
      amount: parseFloat(amount)
    };

    const result = await req.sheetsService.updateBudget(budget);
    
    logger.info('Budget updated successfully', { month, amount });
    
    res.json({
      success: true,
      message: 'Budget updated successfully',
      data: budget,
      result
    });
  } catch (error) {
    logger.error('Error in updateBudget controller', { 
      body: req.body, 
      error: error.message 
    });
    next(error);
  }
};
