import logger from '../config/logger.js';
import { ApiError } from '../middleware/errorHandler.js';

/**
 * Get all expenses
 */
export const getExpenses = async (req, res, next) => {
  try {
    logger.info('GET /api/expenses - Fetching all expenses', { userId: req.user?.id });
    const expenses = await req.sheetsService.getExpensesObjects();
    
    res.json({
      success: true,
      data: expenses,
      count: expenses.length
    });
  } catch (error) {
    logger.error('Error in getExpenses controller', { error: error.message });
    next(error);
  }
};

/**
 * Add multiple expenses
 */
export const addExpensesBulk = async (req, res, next) => {
  try {
    const { expenses } = req.body;
    
    logger.info('POST /api/expenses/batch - Adding multiple expenses', { 
      count: expenses ? expenses.length : 0
    });

    // Validate required fields
    if (!expenses || !Array.isArray(expenses) || expenses.length === 0) {
      throw new ApiError(400, 'Missing or invalid expenses array');
    }

    // Validate each expense in the array
    const validatedExpenses = expenses.map((expense, index) => {
      const { id, date, description, amount, categoryId, isFixed, fixedExpenseId, debtId, entryType, status } = expense;
      
      // Validate required fields for each expense
      if (!date || !description || !amount || categoryId === undefined || categoryId === null || categoryId === '') {
        throw new ApiError(400, `Missing required fields in expense at index ${index}: date, description, amount, categoryId`);
      }

      // Generate ID if not provided
      const expenseId = id || Date.now() + Math.random().toString(36).substr(2, 9);
      
      return {
        id: expenseId,
        date,
        description: description.trim(),
        amount: parseFloat(amount),
        categoryId: parseInt(categoryId),
        isFixed: Boolean(isFixed),
        fixedExpenseId: fixedExpenseId || null,
        debtId: debtId || null,
        entryType: entryType ? String(entryType).toLowerCase() : null,
        status: status ? String(status).toLowerCase() : 'pending'
      };
    });

    const result = await req.sheetsService.addExpensesBulk(validatedExpenses);
    
    logger.info('Multiple expenses added successfully', { count: validatedExpenses.length });
    
    res.status(201).json({
      success: true,
      message: `${validatedExpenses.length} expenses added successfully`,
      data: validatedExpenses,
      count: validatedExpenses.length,
      result
    });
  } catch (error) {
    logger.error('Error in addExpensesBulk controller', { 
      body: req.body, 
      error: error.message 
    });
    next(error);
  }
};

/**
 * Add new expense
 */
export const addExpense = async (req, res, next) => {
  try {
    const { id, date, description, amount, categoryId, isFixed, fixedExpenseId, debtId, entryType, status } = req.body;
    
    logger.info('POST /api/expenses - Adding new expense', { 
      description, 
      amount, 
      categoryId,
      fixedExpenseId 
    });

    // Validate required fields
    if (!date || !description || !amount || categoryId === undefined || categoryId === null || categoryId === '') {
      throw new ApiError(400, 'Missing required fields: date, description, amount, categoryId');
    }

    // Generate ID if not provided
    const expenseId = id || Date.now() + Math.random().toString(36).substr(2, 9);
    
    const expense = {
      id: expenseId,
      date,
      description: description.trim(),
      amount: parseFloat(amount),
      categoryId: parseInt(categoryId),
      isFixed: Boolean(isFixed),
      fixedExpenseId: fixedExpenseId || null,
      debtId: debtId || null,
      entryType: entryType ? String(entryType).toLowerCase() : null,
      status: status ? String(status).toLowerCase() : 'pending'
    };

    const result = await req.sheetsService.addExpense(expense);
    
    logger.info('Expense added successfully', { expenseId: expense.id });
    
    res.status(201).json({
      success: true,
      message: 'Expense added successfully',
      data: expense,
      result
    });
  } catch (error) {
    logger.error('Error in addExpense controller', { 
      body: req.body, 
      error: error.message 
    });
    next(error);
  }
};

/**
 * Update expense
 */
export const updateExpense = async (req, res, next) => {
  try {
    const { id: idParam } = req.params;
    const { date, description, amount, categoryId, isFixed, fixedExpenseId, debtId, entryType, status } = req.body;

    logger.info('PUT /api/expenses - Updating expense', {
      id: idParam,
      description
    });

    if (!idParam) {
      throw new ApiError(400, 'Missing required field: id');
    }

    const expense = {
      id: idParam,
      date,
      description: description ? description.trim() : undefined,
      amount: amount !== undefined ? parseFloat(amount) : undefined,
      categoryId: categoryId !== undefined ? parseInt(categoryId) : undefined,
      isFixed: isFixed !== undefined ? Boolean(isFixed) : undefined,
      fixedExpenseId: fixedExpenseId !== undefined ? (fixedExpenseId || null) : undefined,
      debtId: debtId !== undefined ? (debtId || null) : undefined,
      entryType: entryType !== undefined ? (entryType ? String(entryType).toLowerCase() : null) : undefined,
      status: status !== undefined ? (status ? String(status).toLowerCase() : null) : undefined
    };

    const result = await req.sheetsService.updateExpense(expense);

    logger.info('Expense updated successfully', { expenseId: expense.id });

    res.json({
      success: true,
      message: 'Expense updated successfully',
      data: expense,
      result
    });
  } catch (error) {
    logger.error('Error in updateExpense controller', {
      body: req.body,
      error: error.message
    });
    next(error);
  }
};

/**
 * Delete expense
 */
export const deleteExpense = async (req, res, next) => {
  try {
    const { id } = req.params;

    logger.info('DELETE /api/expenses - Deleting expense', { id });

    if (!id) {
      throw new ApiError(400, 'Missing required field: id');
    }

    const result = await req.sheetsService.deleteExpense(id);

    res.json({
      success: true,
      message: 'Expense deleted successfully',
      id,
      result
    });
  } catch (error) {
    logger.error('Error in deleteExpense controller', {
      body: req.body,
      error: error.message
    });
    next(error);
  }
};
