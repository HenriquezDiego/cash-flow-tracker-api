import jwt from 'jsonwebtoken';
import logger from '../config/logger.js';
import { ApiError } from '../middleware/errorHandler.js';
import schemaMappings from '../config/schemaMappings.js';
import schemaTypes from '../config/schemaTypes.js';
/**
 * Service class for Google Sheets operations
 */
class GoogleSheetsService {
  constructor() {
    this.sheetId = process.env.GOOGLE_SHEET_ID;
    this.credentials = {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY,
      token_uri: 'https://oauth2.googleapis.com/token'
    };
    this.accessToken = null;
    this.tokenExpiry = null;
    // Cache para reducir peticiones a Google Sheets
    this.cache = {
      categories: null,
      categoriesTimestamp: null,
      cacheTimeout: 30000 // 30 segundos
    };
  }

  /**
   * Get access token for Google Sheets API
   */
  async getAccessToken() {
    try {
      // Check if token is still valid
      if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
        return this.accessToken;
      }

      logger.info('Generating new Google Sheets access token');

      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: this.credentials.client_email,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        aud: this.credentials.token_uri,
        exp: now + 3600,
        iat: now
      };

      const privateKey = this.credentials.private_key.replace(/\\n/g, '\n');
      
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
        logger.error('Failed to get access token', { status: response.status, error: errorText });
        throw new ApiError(500, 'Failed to authenticate with Google Sheets API');
      }

      const data = await response.json();
      this.accessToken = data.access_token;
      this.tokenExpiry = Date.now() + (data.expires_in * 1000);
      
      logger.info('Successfully obtained Google Sheets access token');
      return this.accessToken;
    } catch (error) {
      logger.error('Error getting access token', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  /**
   * Make authenticated request to Google Sheets API
   */
  async makeRequest(endpoint, options = {}) {
    try {
      const token = await this.getAccessToken();
      
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}${endpoint}`;
      
      logger.debug('Making Google Sheets API request', { url, method: options.method || 'GET' });
      
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
        logger.error('Google Sheets API error', { 
          status: response.status, 
          endpoint, 
          error: errorText 
        });
        throw new ApiError(response.status, `Google Sheets API error: ${errorText}`);
      }

      const data = await response.json();
      logger.debug('Google Sheets API response received', { endpoint, dataSize: JSON.stringify(data).length });
      
      return data;
    } catch (error) {
      logger.error('Error making Google Sheets request', { 
        endpoint, 
        error: error.message, 
        stack: error.stack 
      });
      throw error;
    }
  }

  /**
   * Convert a matrix of values (first row as headers) into an array of objects
   * Skips completely empty data rows and preserves original header names
   */
  mapRowsToObjects(values) {
    try {
      if (!Array.isArray(values) || values.length <= 1) {
        return [];
      }

      const headers = (values[0] || []).map(h => String(h).trim());

      const items = [];
      for (const row of values.slice(1)) {
        const hasAnyValue = Array.isArray(row) && row.some(cell => {
          return cell !== undefined && cell !== null && String(cell).trim() !== '';
        });
        if (!hasAnyValue) continue;

        const obj = {};
        for (let i = 0; i < headers.length; i++) {
          const key = headers[i] || `col${i + 1}`;
          obj[key] = row[i] !== undefined ? row[i] : null;
        }
        items.push(obj);
      }

      return items;
    } catch (error) {
      logger.error('Error mapping rows to objects', { error: error.message });
      throw error;
    }
  }

  /**
   * Normalize object keys using sheet-specific schema mappings
   */
  normalizeKeysForSheet(items, sheetTitle) {
    try {
      if (!Array.isArray(items) || items.length === 0) return items;
      const mapping = schemaMappings[sheetTitle];
      if (!mapping) return items;

      const normalized = items.map((item) => {
        const out = {};
        for (const [rawKey, value] of Object.entries(item)) {
          const normalizedKey = this.normalizeHeaderKey(rawKey);
          const canonical = mapping[normalizedKey] || this.toCamelCase(rawKey);
          if (out[canonical] === undefined) {
            out[canonical] = value;
          }
        }
        return out;
      });
      return normalized;
    } catch (error) {
      logger.error('Error normalizing keys for sheet', { sheetTitle, error: error.message });
      throw error;
    }
  }

  normalizeHeaderKey(key) {
    return String(key)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  toCamelCase(key) {
    return String(key)
      .trim()
      .replace(/^[^a-zA-Z]+/, '')
      .replace(/[-_\s]+([a-zA-Z0-9])/g, (_, c) => c.toUpperCase())
      .replace(/^[A-Z]/, (c) => c.toLowerCase());
  }

  /**
   * Coerce values to target types based on sheet schema
   */
  coerceTypesForSheet(items, sheetTitle) {
    try {
      if (!Array.isArray(items) || items.length === 0) return items;
      const typeSchema = schemaTypes[sheetTitle];
      if (!typeSchema) return items;

      const coerce = (value, type) => {
        if (value === null || value === undefined || value === '') return null;
        switch (type) {
          case 'number': {
            const n = Number(value);
            return Number.isFinite(n) ? n : null;
          }
          case 'boolean': {
            const v = String(value).trim().toLowerCase();
            if (v === 'true' || v === '1' || v === 'yes' || v === 'si') return true;
            if (v === 'false' || v === '0' || v === 'no') return false;
            return null;
          }
          case 'date': {
            // Accept YYYY-MM-DD or YYYY-MM
            const s = String(value).trim();
            if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
            if (/^\d{4}-\d{2}$/.test(s)) return s;
            // Try parse to ISO date
            const d = new Date(s);
            if (!Number.isNaN(d.getTime())) {
              const yyyy = d.getFullYear();
              const mm = String(d.getMonth() + 1).padStart(2, '0');
              const dd = String(d.getDate()).padStart(2, '0');
              return `${yyyy}-${mm}-${dd}`;
            }
            return null;
          }
          case 'string':
          default:
            return String(value);
        }
      };

      return items.map((item) => {
        const out = { ...item };
        for (const [key, type] of Object.entries(typeSchema)) {
          if (Object.prototype.hasOwnProperty.call(out, key)) {
            out[key] = coerce(out[key], type);
          } else {
            out[key] = null;
          }
        }
        return out;
      });
    } catch (error) {
      logger.error('Error coercing types for sheet', { sheetTitle, error: error.message });
      throw error;
    }
  }

  /**
   * Get categories from Google Sheets with cache
   */
  async getCategories() {
    try {
      // Verificar si tenemos datos en caché y si no han expirado
      const now = Date.now();
      if (this.cache.categories && 
          this.cache.categoriesTimestamp && 
          (now - this.cache.categoriesTimestamp) < this.cache.cacheTimeout) {
        logger.debug('Returning categories from cache', { count: this.cache.categories.length });
        return this.cache.categories;
      }

      logger.info('Fetching categories from Google Sheets');
      const response = await this.makeRequest('/values/Categories!A:C');
      const values = response.values || [];
      const categories = this.coerceTypesForSheet(
        this.normalizeKeysForSheet(this.mapRowsToObjects(values), 'Categories'),
        'Categories'
      );
      
      // Guardar en caché
      this.cache.categories = categories;
      this.cache.categoriesTimestamp = now;
      
      logger.info('Categories fetched successfully', { count: categories.length });
      return categories;
    } catch (error) {
      logger.error('Error fetching categories', { error: error.message });
      throw error;
    }
  }

  /**
   * Add a new category to Google Sheets
   */
  async addCategory(category) {
    try {
      logger.info('Adding new category to Google Sheets', { name: category.name });
      
      // Get the next available ID
      const categories = await this.getCategories();
      const maxId = categories.length > 0 ? Math.max(...categories.map(c => c.id || 0)) : 0;
      const newId = maxId + 1;
      
      const categoryData = {
        id: newId,
        name: category.name,
        color: category.color || '#6B7280'
      };
      
      // Add to Categories sheet
      const values = [
        [categoryData.id, categoryData.name, categoryData.color]
      ];
      
      const response = await this.makeRequest('/values/Categories!A:C:append?valueInputOption=RAW', {
        method: 'POST',
        body: JSON.stringify({
          values: values
        })
      });
      
      // Invalidar caché
      this.cache.categories = null;
      this.cache.categoriesTimestamp = null;
      
      logger.info('Category added successfully', { id: newId, name: category.name });
      return categoryData;
    } catch (error) {
      logger.error('Error adding category', { error: error.message });
      throw error;
    }
  }

  /**
   * Update a category in Google Sheets
   */
  async updateCategory(id, categoryData) {
    try {
      logger.info('Updating category in Google Sheets', { id, updates: categoryData });
      
      // Get all categories to find the row
      const categories = await this.getCategories();
      logger.debug('Categories found for update', { 
        categoriesCount: categories.length, 
        searchingForId: id, 
        parsedId: parseInt(id),
        categoryIds: categories.map(c => ({ id: c.id, type: typeof c.id }))
      });
      
      const categoryIndex = categories.findIndex(c => String(c.id) === String(id));
      
      if (categoryIndex === -1) {
        logger.error('Category not found for update', { 
          id, 
          parsedId: parseInt(id), 
          availableIds: categories.map(c => c.id) 
        });
        throw new ApiError(404, 'Category not found');
      }
      
      // Calculate the row number (header + index + 1)
      const rowNumber = categoryIndex + 2;
      
      // Prepare update data
      const updateData = {
        id: parseInt(id),
        name: categoryData.name,
        color: categoryData.color || '#6B7280'
      };
      
      const values = [
        [updateData.id, updateData.name, updateData.color]
      ];
      
      const response = await this.makeRequest(`/values/Categories!A${rowNumber}:C${rowNumber}?valueInputOption=RAW`, {
        method: 'PUT',
        body: JSON.stringify({
          values: values
        })
      });
      
      // Invalidar caché
      this.cache.categories = null;
      this.cache.categoriesTimestamp = null;
      
      logger.info('Category updated successfully', { id, name: updateData.name });
      return updateData;
    } catch (error) {
      logger.error('Error updating category', { id, error: error.message });
      throw error;
    }
  }

  /**
   * Delete a category from Google Sheets
   */
  async deleteCategory(id) {
    try {
      logger.info('Deleting category from Google Sheets', { id });
      
      // Get all categories to find the row
      const categories = await this.getCategories();
      logger.debug('Categories found for deletion', { 
        categoriesCount: categories.length, 
        searchingForId: id, 
        parsedId: parseInt(id),
        categoryIds: categories.map(c => ({ id: c.id, type: typeof c.id }))
      });
      
      const categoryIndex = categories.findIndex(c => String(c.id) === String(id));
      
      if (categoryIndex === -1) {
        logger.error('Category not found for deletion', { 
          id, 
          parsedId: parseInt(id), 
          availableIds: categories.map(c => c.id) 
        });
        throw new ApiError(404, 'Category not found');
      }
      
      // Calculate the row number (header + index + 1)
      const rowNumber = categoryIndex + 2;
      
      // Delete the row
      const response = await this.makeRequest(`/values/Categories!A${rowNumber}:C${rowNumber}:clear`, {
        method: 'POST'
      });
      
      // Invalidar caché
      this.cache.categories = null;
      this.cache.categoriesTimestamp = null;
      
      logger.info('Category deleted successfully', { id });
      return { id: parseInt(id), deleted: true };
    } catch (error) {
      logger.error('Error deleting category', { id, error: error.message });
      throw error;
    }
  }

  /**
   * Get expenses as array of objects using header row as keys
   */
  async getExpensesObjects() {
    try {
      logger.info('Fetching expenses (objects) from Google Sheets');
      const response = await this.makeRequest('/values/Expenses!A:J');
      const values = response.values || [];
      const expenses = this.coerceTypesForSheet(
        this.normalizeKeysForSheet(this.mapRowsToObjects(values), 'Expenses'),
        'Expenses'
      );
      logger.info('Expenses (objects) fetched successfully', { count: expenses.length });
      return expenses;
    } catch (error) {
      logger.error('Error fetching expenses (objects)', { error: error.message });
      throw error;
    }
  }

  /**
   * Get fixed expenses as array of objects using header row as keys
   */
  async getFixedExpensesObjects() {
    try {
      logger.info('Fetching fixed expenses (objects) from Google Sheets');
      const response = await this.makeRequest('/values/FixedExpenses!A:G');
      const values = response.values || [];
      const fixedExpenses = this.coerceTypesForSheet(
        this.normalizeKeysForSheet(this.mapRowsToObjects(values), 'FixedExpenses'),
        'FixedExpenses'
      );
      logger.info('Fixed expenses (objects) fetched successfully', { count: fixedExpenses.length });
      return fixedExpenses;
    } catch (error) {
      logger.error('Error fetching fixed expenses (objects)', { error: error.message });
      throw error;
    }
  }

  /**
   * Get budget as array of objects using header row as keys
   */
  async getBudgetObjects() {
    try {
      logger.info('Fetching budget (objects) from Google Sheets');
      const response = await this.makeRequest('/values/Budget!A:B');
      const values = response.values || [];
      const budget = this.coerceTypesForSheet(
        this.normalizeKeysForSheet(this.mapRowsToObjects(values), 'Budget'),
        'Budget'
      );
      logger.info('Budget (objects) fetched successfully', { count: budget.length });
      return budget;
    } catch (error) {
      logger.error('Error fetching budget (objects)', { error: error.message });
      throw error;
    }
  }

  /**
   * Get debts as array of objects using header row as keys
   */
  async getDebtsObjects() {
    try {
      logger.info('Fetching debts (objects) from Google Sheets');
      const response = await this.makeRequest('/values/Debts!A:K');
      const values = response.values || [];
      const debts = this.coerceTypesForSheet(
        this.normalizeKeysForSheet(this.mapRowsToObjects(values), 'Debts'),
        'Debts'
      );
      logger.info('Debts (objects) fetched successfully', { count: debts.length });
      return debts;
    } catch (error) {
      logger.error('Error fetching debts (objects)', { error: error.message });
      throw error;
    }
  }

  /**
   * Get expenses from Google Sheets
   */
  async getExpenses() {
    try {
      logger.info('Fetching expenses from Google Sheets');
      // Include column G for fixedExpenseId linkage
      const response = await this.makeRequest('/values/Expenses!A:J');
      const expenses = response.values || [];
      logger.info('Expenses fetched successfully', { count: expenses.length });
      return expenses;
    } catch (error) {
      logger.error('Error fetching expenses', { error: error.message });
      throw error;
    }
  }

  /**
   * Add new expense to Google Sheets
   */
  async addExpense(expense) {
    try {
      logger.info('Adding new expense to Google Sheets', { 
        description: expense.description, 
        amount: expense.amount 
      });

      const values = [[
        expense.id,
        expense.date,
        expense.description,
        expense.amount.toString(),
        expense.categoryId.toString(),
        expense.isFixed ? 'TRUE' : 'FALSE',
        expense.fixedExpenseId ? String(expense.fixedExpenseId) : '',
        expense.debtId ? String(expense.debtId) : '',
        expense.entryType ? String(expense.entryType) : '',
        expense.status ? String(expense.status) : ''
      ]];

      const response = await this.makeRequest('/values/Expenses!A:J:append?valueInputOption=RAW', {
        method: 'POST',
        body: JSON.stringify({ values })
      });

      logger.info('Expense added successfully', { expenseId: expense.id });

      // If it's a credit payment already marked as paid, subtract immediately
      try {
        // Credit determination is now based on presence of debtId
        const isCredit = !!expense.debtId;
        const isPayment = String(expense.entryType || '').toLowerCase() === 'payment';
        const isPaid = String(expense.status || '').toLowerCase() === 'paid';
        if (isCredit && isPayment && isPaid && expense.debtId) {
          await this.adjustDebtBalance(String(expense.debtId), -Number(expense.amount));
          logger.info('Debt balance adjusted on add (paid payment)', { debtId: expense.debtId, amount: expense.amount });
        }
        // Charges increase balance immediately regardless of status
        const isCharge = String(expense.entryType || '').toLowerCase() === 'charge';
        if (isCredit && isCharge && expense.debtId) {
          await this.adjustDebtBalance(String(expense.debtId), +Number(expense.amount));
          logger.info('Debt balance adjusted on add (charge)', { debtId: expense.debtId, amount: expense.amount });
        }
      } catch (e) {
        logger.error('Failed adjusting debt balance on add', { error: e.message });
      }

      return response;
    } catch (error) {
      logger.error('Error adding expense', { 
        expense: expense.description, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Add multiple expenses to Google Sheets in a single append
   */
  async addExpensesBulk(expenses) {
    try {
      logger.info('Adding multiple expenses to Google Sheets', { count: expenses.length });
  
      // Mapea cada objeto de gasto a un arreglo de valores para la fila de la hoja de cálculo
      const values = expenses.map(expense => [
        expense.id,
        expense.date,
        expense.description,
        expense.amount.toString(),
        expense.categoryId.toString(),
        expense.isFixed ? 'TRUE' : 'FALSE',
        expense.fixedExpenseId ? String(expense.fixedExpenseId) : '',
        expense.debtId ? String(expense.debtId) : '',
        expense.entryType ? String(expense.entryType) : '',
        expense.status ? String(expense.status) : ''
      ]);
  
      // Llama a la API una sola vez para agregar todas las filas
      const response = await this.makeRequest('/values/Expenses!A:J:append?valueInputOption=RAW', {
        method: 'POST',
        body: JSON.stringify({ values })
      });
  
      logger.info('Multiple expenses added successfully', { count: expenses.length });
      // Apply immediate adjustments for paid payments on credit
      for (const e of expenses) {
        try {
          // Credit determination is now based on presence of debtId
          const isCredit = !!e.debtId;
          const isPayment = String(e.entryType || '').toLowerCase() === 'payment';
          const isPaid = String(e.status || '').toLowerCase() === 'paid';
          if (isCredit && isPayment && isPaid && e.debtId) {
            await this.adjustDebtBalance(String(e.debtId), -Number(e.amount));
            logger.info('Debt balance adjusted on bulk add (paid payment)', { debtId: e.debtId, amount: e.amount });
          }
          // Charges: increase balance immediately
          const isCharge = String(e.entryType || '').toLowerCase() === 'charge';
          if (isCredit && isCharge && e.debtId) {
            await this.adjustDebtBalance(String(e.debtId), +Number(e.amount));
            logger.info('Debt balance adjusted on bulk add (charge)', { debtId: e.debtId, amount: e.amount });
          }
        } catch (e2) {
          logger.error('Failed adjusting debt balance on bulk add', { error: e2.message });
        }
      }
      return response;
    } catch (error) {
      logger.error('Error adding multiple expenses', { 
        error: error.message,
        expensesCount: expenses.length 
      });
      throw error;
    }
  }

  /**
   * Update expense in Google Sheets
   */
  async updateExpense(expense) {
    try {
      logger.info('Updating expense by id in Google Sheets', {
        id: expense.id,
        description: expense.description
      });

      if (!expense.id) {
        throw new ApiError(400, 'Missing required field: id');
      }

      const rowNumber = await this.findRowNumberById('Expenses', expense.id);
      if (!rowNumber) {
        throw new ApiError(404, 'Expense not found');
      }

      const existingResp = await this.makeRequest(`/values/Expenses!A${rowNumber}:J${rowNumber}`);
      const existing = (existingResp.values && existingResp.values[0]) || [];

      const merged = [
        expense.id,
        expense.date !== undefined ? expense.date : (existing[1] || ''),
        expense.description !== undefined ? expense.description : (existing[2] || ''),
        expense.amount !== undefined ? expense.amount.toString() : (existing[3] || ''),
        expense.categoryId !== undefined ? expense.categoryId.toString() : (existing[4] || ''),
        expense.isFixed !== undefined ? (expense.isFixed ? 'TRUE' : 'FALSE') : (existing[5] || ''),
        expense.fixedExpenseId !== undefined ? (expense.fixedExpenseId ? String(expense.fixedExpenseId) : '') : (existing[6] || ''),
        expense.debtId !== undefined ? (expense.debtId ? String(expense.debtId) : '') : (existing[7] || ''),
        expense.entryType !== undefined ? (expense.entryType ? String(expense.entryType) : '') : (existing[8] || ''),
        expense.status !== undefined ? (expense.status ? String(expense.status) : '') : (existing[9] || '')
      ];

      const response = await this.makeRequest(`/values/Expenses!A${rowNumber}:J${rowNumber}?valueInputOption=RAW`, {
        method: 'PUT',
        body: JSON.stringify({ values: [merged] })
      });

      logger.info('Expense updated successfully', { expenseId: expense.id, rowNumber });
      // Comprehensive balance adjustment logic for credit entries (payments and charges)
      try {
        const prevAmount = existing[3] !== undefined ? Number(existing[3]) : 0;
        const prevStatus = String(existing[9] || '').toLowerCase();
        const prevEntryType = String(existing[8] || '').toLowerCase();
        const prevDebtId = existing[7] ? String(existing[7]) : null;
        const nextAmount = merged[3] !== undefined ? Number(merged[3]) : 0;
        const nextStatus = String(merged[9] || '').toLowerCase();
        const nextEntryType = String(merged[8] || '').toLowerCase();
        const nextDebtId = merged[7] ? String(merged[7]) : null;

        // Payments: subtract on paid (now gated by presence of debtId)
        const wasPaid = !!prevDebtId && prevEntryType === 'payment' && prevStatus === 'paid';
        const isPaid = !!nextDebtId && nextEntryType === 'payment' && nextStatus === 'paid';

        // Charges: add immediately (ignore status), gated by debtId
        const wasCharge = !!prevDebtId && prevEntryType === 'charge';
        const isCharge = !!nextDebtId && nextEntryType === 'charge';

        if (!wasPaid && isPaid) {
          // Newly paid -> subtract full nextAmount from nextDebtId
          await this.adjustDebtBalance(nextDebtId, -nextAmount);
          logger.info('Debt balance adjusted (became paid)', { debtId: nextDebtId, amount: nextAmount });
        } else if (wasPaid && !isPaid) {
          // No longer paid -> add back previous amount to previous debt
          await this.adjustDebtBalance(prevDebtId, +prevAmount);
          logger.info('Debt balance reverted (left paid state)', { debtId: prevDebtId, amount: prevAmount });
        } else if (wasPaid && isPaid) {
          if (prevDebtId === nextDebtId) {
            // Same debt, adjust difference
            const delta = -(nextAmount - prevAmount);
            if (delta !== 0) {
              await this.adjustDebtBalance(nextDebtId, delta);
              logger.info('Debt balance adjusted (amount change while paid)', { debtId: nextDebtId, delta });
            }
          } else {
            // Debt changed: revert old, apply new
            await this.adjustDebtBalance(prevDebtId, +prevAmount);
            await this.adjustDebtBalance(nextDebtId, -nextAmount);
            logger.info('Debt balance adjusted (debtId changed while paid)', { fromDebt: prevDebtId, toDebt: nextDebtId, revert: prevAmount, apply: nextAmount });
          }
        }

        // Handle charges
        if (!wasCharge && isCharge) {
          // Became charge -> add nextAmount
          await this.adjustDebtBalance(nextDebtId, +nextAmount);
          logger.info('Debt balance adjusted (became charge)', { debtId: nextDebtId, amount: nextAmount });
        } else if (wasCharge && !isCharge) {
          // No longer charge -> remove previous charge
          await this.adjustDebtBalance(prevDebtId, -prevAmount);
          logger.info('Debt balance reverted (left charge state)', { debtId: prevDebtId, amount: prevAmount });
        } else if (wasCharge && isCharge) {
          if (prevDebtId === nextDebtId) {
            const delta = +(nextAmount - prevAmount);
            if (delta !== 0) {
              await this.adjustDebtBalance(nextDebtId, delta);
              logger.info('Debt balance adjusted (amount change while charge)', { debtId: nextDebtId, delta });
            }
          } else {
            await this.adjustDebtBalance(prevDebtId, -prevAmount);
            await this.adjustDebtBalance(nextDebtId, +nextAmount);
            logger.info('Debt balance adjusted (debtId changed while charge)', { fromDebt: prevDebtId, toDebt: nextDebtId, revert: prevAmount, apply: nextAmount });
          }
        }
      } catch (e) {
        logger.error('Failed adjusting debt balance on update', { error: e.message });
      }

      return response;
    } catch (error) {
      logger.error('Error updating expense', {
        id: expense.id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Delete expense in Google Sheets
   */
  async deleteExpense(id) {
    try {
      logger.info('Deleting expense in Google Sheets', { id });

      const rowNumber = await this.findRowNumberById('Expenses', id);
      if (!rowNumber) {
        throw new ApiError(404, 'Expense not found');
      }

      // Read existing row before deletion to revert if needed
      const existingResp = await this.makeRequest(`/values/Expenses!A${rowNumber}:J${rowNumber}`);
      const existing = (existingResp.values && existingResp.values[0]) || [];

      const resp = await this.deleteRowByNumber('Expenses', rowNumber);

      try {
        const amount = existing[3] !== undefined ? Number(existing[3]) : 0;
        const status = String(existing[9] || '').toLowerCase();
        const entryType = String(existing[8] || '').toLowerCase();
        const debtId = existing[7] ? String(existing[7]) : null;
        if (!!debtId) {
          if (entryType === 'payment' && status === 'paid') {
            // Deleting a paid payment -> add it back
            await this.adjustDebtBalance(debtId, +amount);
            logger.info('Debt balance reverted on delete (paid payment)', { debtId, amount });
          }
          if (entryType === 'charge') {
            // Deleting a charge -> remove it from balance
            await this.adjustDebtBalance(debtId, -amount);
            logger.info('Debt balance adjusted on delete (charge removed)', { debtId, amount });
          }
        }
      } catch (e) {
        logger.error('Failed adjusting debt balance on delete', { error: e.message });
      }

      logger.info('Expense deleted successfully', { id, rowNumber });
      return resp;
    } catch (error) {
      logger.error('Error deleting expense', { id, error: error.message });
      throw error;
    }
  }

  /**
   * Get budget from Google Sheets
   */
  async getBudget() {
    try {
      logger.info('Fetching budget from Google Sheets');
      const response = await this.makeRequest('/values/Budget!A:B');
      const budget = response.values || [];
      logger.info('Budget fetched successfully', { count: budget.length });
      return budget;
    } catch (error) {
      logger.error('Error fetching budget', { error: error.message });
      throw error;
    }
  }

  /**
   * Update budget in Google Sheets
   */
  async updateBudget(budget) {
    try {
      logger.info('Updating budget in Google Sheets', { 
        month: budget.month, 
        amount: budget.amount 
      });

      const values = [[budget.month, budget.amount.toString()]];

      // Find existing row by month in column A
      const rowNumber = await this.findRowNumberById('Budget', budget.month);
      let response;
      if (rowNumber) {
        // Update existing row A{row}:B{row}
        logger.info('Updating existing budget row', { month: budget.month, rowNumber });
        response = await this.makeRequest(`/values/Budget!A${rowNumber}:B${rowNumber}?valueInputOption=RAW`, {
          method: 'PUT',
          body: JSON.stringify({ values })
        });
      } else {
        // Append new row at the end
        logger.info('Appending new budget row', { month: budget.month });
        response = await this.makeRequest('/values/Budget!A:B:append?valueInputOption=RAW', {
          method: 'POST',
          body: JSON.stringify({ values })
        });
      }

      logger.info('Budget upsert successful', { month: budget.month });
      return response;
    } catch (error) {
      logger.error('Error updating budget', { 
        month: budget.month, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Get fixed expenses from Google Sheets
   */
  async getFixedExpenses() {
    try {
      logger.info('Fetching fixed expenses from Google Sheets');
      const response = await this.makeRequest('/values/FixedExpenses!A:F');
      const fixedExpenses = response.values || [];
      logger.info('Fixed expenses fetched successfully', { count: fixedExpenses.length });
      return fixedExpenses;
    } catch (error) {
      logger.error('Error fetching fixed expenses', { error: error.message });
      throw error;
    }
  }

  /**
   * Add new fixed expense to Google Sheets
   */
  async addFixedExpense(fixedExpense) {
    try {
      logger.info('Adding new fixed expense to Google Sheets', { 
        name: fixedExpense.name, 
        amount: fixedExpense.amount 
      });

      const values = [[
        fixedExpense.id,
        fixedExpense.name,
        fixedExpense.amount.toString(),
        fixedExpense.categoryId.toString(),
        fixedExpense.dayOfMonth.toString(),
        fixedExpense.active ? 'TRUE' : 'FALSE',
        fixedExpense.debtId ? String(fixedExpense.debtId) : ''
      ]];

      const response = await this.makeRequest('/values/FixedExpenses!A:G:append?valueInputOption=RAW', {
        method: 'POST',
        body: JSON.stringify({ values })
      });

      logger.info('Fixed expense added successfully', { expenseId: fixedExpense.id });
      return response;
    } catch (error) {
      logger.error('Error adding fixed expense', { 
        name: fixedExpense.name, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Update fixed expense in Google Sheets
   */
  async updateFixedExpense(fixedExpense) {
    try {
      logger.info('Updating fixed expense by id in Google Sheets', { 
        id: fixedExpense.id, 
        name: fixedExpense.name 
      });

      if (!fixedExpense.id) {
        throw new ApiError(400, 'Missing required field: id');
      }

      const rowNumber = await this.findRowNumberById('FixedExpenses', fixedExpense.id);
      if (!rowNumber) {
        throw new ApiError(404, 'Fixed expense not found');
      }

      const existingResp = await this.makeRequest(`/values/FixedExpenses!A${rowNumber}:G${rowNumber}`);
      const existing = (existingResp.values && existingResp.values[0]) || [];

      const merged = [
        fixedExpense.id,
        fixedExpense.name !== undefined ? fixedExpense.name : (existing[1] || ''),
        fixedExpense.amount !== undefined ? fixedExpense.amount.toString() : (existing[2] || ''),
        fixedExpense.categoryId !== undefined ? fixedExpense.categoryId.toString() : (existing[3] || ''),
        fixedExpense.dayOfMonth !== undefined ? fixedExpense.dayOfMonth.toString() : (existing[4] || ''),
        fixedExpense.active !== undefined ? (fixedExpense.active ? 'TRUE' : 'FALSE') : (existing[5] || ''),
        fixedExpense.debtId !== undefined ? (fixedExpense.debtId ? String(fixedExpense.debtId) : '') : (existing[6] || '')
      ];

      const response = await this.makeRequest(`/values/FixedExpenses!A${rowNumber}:G${rowNumber}?valueInputOption=RAW`, {
        method: 'PUT',
        body: JSON.stringify({ values: [merged] })
      });

      logger.info('Fixed expense updated successfully', { expenseId: fixedExpense.id, rowNumber });
      return response;
    } catch (error) {
      logger.error('Error updating fixed expense', { 
        id: fixedExpense.id, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Delete fixed expense in Google Sheets. Also deletes related expenses linked by fixedExpenseId.
   */
  async deleteFixedExpense(id) {
    try {
      logger.info('Deleting fixed expense', { id });

      // Get the fixed expense row number
      const rowNumber = await this.findRowNumberById('FixedExpenses', id);
      if (!rowNumber) {
        throw new ApiError(404, 'Fixed expense not found');
      }

      // Get the fixed expense data to check categoryId
      const fixedExpenseResponse = await this.makeRequest(`/values/FixedExpenses!A${rowNumber}:G${rowNumber}`);
      const fixedExpenseData = fixedExpenseResponse.values?.[0];
      
      if (!fixedExpenseData) {
        throw new ApiError(404, 'Fixed expense data not found');
      }

      const categoryId = parseInt(fixedExpenseData[3], 10); // Column D
      let deletedExpensesCount = 0;

      // Delete related expenses by fixedExpenseId regardless of category
      const expensesResponse = await this.makeRequest('/values/Expenses!A:J');
      const expenses = expensesResponse.values || [];
      if (expenses.length > 1) {
        const fixedExpenseIdIndex = 6; // column G in Expenses
        const expenseData = expenses.slice(1);
        const rowsToDelete = [];

        expenseData.forEach((row, index) => {
          if (row[fixedExpenseIdIndex] && String(row[fixedExpenseIdIndex]) === String(id)) {
            rowsToDelete.push(index + 2); // +2 for header offset
          }
        });

        logger.info('Found expenses to delete', {
          fixedExpenseId: id,
          rowsToDeleteCount: rowsToDelete.length,
          rowsToDelete: rowsToDelete
        });

        rowsToDelete.sort((a, b) => b - a);
        for (const rowNum of rowsToDelete) {
          try {
            await this.deleteRowByNumber('Expenses', rowNum);
            deletedExpensesCount++;
            logger.info('Deleted related expense', { fixedExpenseId: id, rowNumber: rowNum });
          } catch (error) {
            logger.error('Error deleting related expense', { fixedExpenseId: id, rowNumber: rowNum, error: error.message });
          }
        }
      }

      // Delete the fixed expense itself
      const response = await this.deleteRowByNumber('FixedExpenses', rowNumber);

      logger.info('Fixed expense deleted successfully', { id, rowNumber, categoryId, deletedExpensesCount });

      return {
        fixedExpense: { id, rowNumber, categoryId, response },
        deletedExpensesCount
      };
    } catch (error) {
      logger.error('Error deleting fixed expense', { id, error: error.message });
      throw error;
    }
  }

  /**
   * Get debts (credit cards) from Google Sheets
   */
  async getDebts() {
    try {
      logger.info('Fetching debts from Google Sheets');
      // Columns: A:id, B:name, C:issuer, D:creditLimit, E:balance, F:dueDay, G:cutOffDay, H:maskPan, I:interesEfectivo, J:brand, K:active
      const response = await this.makeRequest('/values/Debts!A:K');
      const debts = response.values || [];
      logger.info('Debts fetched successfully', { count: debts.length });
      return debts;
    } catch (error) {
      logger.error('Error fetching debts', { error: error.message });
      throw error;
    }
  }

  /**
   * Get CreditHistory as array of objects
   */
  async getCreditHistoryObjects() {
    try {
      logger.info('Fetching credit history (objects) from Google Sheets');
      const response = await this.makeRequest('/values/CreditHistory!A:N');
      const values = response.values || [];
      const items = this.coerceTypesForSheet(
        this.normalizeKeysForSheet(this.mapRowsToObjects(values), 'CreditHistory'),
        'CreditHistory'
      );
      logger.info('Credit history (objects) fetched successfully', { count: items.length });
      return items;
    } catch (error) {
      logger.error('Error fetching credit history (objects)', { error: error.message });
      throw error;
    }
  }

  /**
   * Append one record to CreditHistory
   */
  async appendCreditHistoryRecord(record) {
    try {
      logger.info('Appending credit history record', { debtId: record.debtId, statementDate: record.statementDate });
      const values = [[
        record.debtId || '',
        record.statementDate || '',
        record.dueDate || '',
        record.previousBalance !== undefined ? String(record.previousBalance) : '',
        record.charges !== undefined ? String(record.charges) : '',
        record.interests !== undefined ? String(record.interests) : '',
        record.payments !== undefined ? String(record.payments) : '',
        record.statementBalance !== undefined ? String(record.statementBalance) : '',
        record.bonifiableInterest !== undefined ? String(record.bonifiableInterest) : '',
        record.installmentBalance !== undefined ? String(record.installmentBalance) : '',
        record.annualEffectiveRate !== undefined ? String(record.annualEffectiveRate) : '',
        record.termMonths !== undefined ? String(record.termMonths) : '',
        record.periodDays !== undefined ? String(record.periodDays) : '',
        record.paymentMade !== undefined ? String(record.paymentMade) : ''
      ]];

      const response = await this.makeRequest('/values/CreditHistory!A:N:append?valueInputOption=RAW', {
        method: 'POST',
        body: JSON.stringify({ values })
      });
      logger.info('Credit history record appended');
      return response;
    } catch (error) {
      logger.error('Error appending credit history record', { error: error.message });
      throw error;
    }
  }

  /**
   * Find CreditHistory row number by (debtId, statementDate)
   */
  async findCreditHistoryRow(debtId, statementDateISO) {
    try {
      const response = await this.makeRequest('/values/CreditHistory!A:B');
      const rows = response.values || [];
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i] || [];
        if (String(r[0]) === String(debtId) && String(r[1]) === String(statementDateISO)) {
          return i + 1; // 1-based
        }
      }
      return null;
    } catch (error) {
      logger.error('Error finding credit history row', { debtId, statementDateISO, error: error.message });
      throw error;
    }
  }

  /**
   * Get a single CreditHistory record by row number
   */
  async getCreditHistoryByRow(rowNumber) {
    try {
      const resp = await this.makeRequest(`/values/CreditHistory!A${rowNumber}:N${rowNumber}`);
      const row = (resp.values && resp.values[0]) || [];
      return {
        debtId: row[0],
        statementDate: row[1],
        dueDate: row[2],
        previousBalance: row[3] !== undefined ? parseFloat(row[3]) : 0,
        charges: row[4] !== undefined ? parseFloat(row[4]) : 0,
        interests: row[5] !== undefined ? parseFloat(row[5]) : 0,
        payments: row[6] !== undefined ? parseFloat(row[6]) : 0,
        statementBalance: row[7] !== undefined ? parseFloat(row[7]) : 0,
        bonifiableInterest: row[8] !== undefined ? parseFloat(row[8]) : 0,
        installmentBalance: row[9] !== undefined ? parseFloat(row[9]) : 0,
        annualEffectiveRate: row[10] !== undefined ? parseFloat(row[10]) : 0,
        termMonths: row[11] !== undefined ? parseInt(row[11], 10) : null,
        periodDays: row[12] !== undefined ? parseInt(row[12], 10) : 0,
        paymentMade: row[13] !== undefined ? parseFloat(row[13]) : 0
      };
    } catch (error) {
      logger.error('Error getting credit history by row', { rowNumber, error: error.message });
      throw error;
    }
  }

  /**
   * Update a CreditHistory row with a new record
   */
  async updateCreditHistoryRow(rowNumber, record) {
    try {
      const values = [[
        record.debtId || '',
        record.statementDate || '',
        record.dueDate || '',
        record.previousBalance !== undefined ? String(record.previousBalance) : '',
        record.charges !== undefined ? String(record.charges) : '',
        record.interests !== undefined ? String(record.interests) : '',
        record.payments !== undefined ? String(record.payments) : '',
        record.statementBalance !== undefined ? String(record.statementBalance) : '',
        record.bonifiableInterest !== undefined ? String(record.bonifiableInterest) : '',
        record.installmentBalance !== undefined ? String(record.installmentBalance) : '',
        record.annualEffectiveRate !== undefined ? String(record.annualEffectiveRate) : '',
        record.termMonths !== undefined ? String(record.termMonths) : '',
        record.periodDays !== undefined ? String(record.periodDays) : '',
        record.paymentMade !== undefined ? String(record.paymentMade) : ''
      ]];
      const response = await this.makeRequest(`/values/CreditHistory!A${rowNumber}:N${rowNumber}?valueInputOption=RAW`, {
        method: 'PUT',
        body: JSON.stringify({ values })
      });
      return response;
    } catch (error) {
      logger.error('Error updating credit history row', { rowNumber, error: error.message });
      throw error;
    }
  }

  /**
   * Sum payments from Expenses for a debt between two dates inclusive
   */
  async sumPaymentsForDebt(debtId, startDateISO, endDateISO) {
    try {
      const expenses = await this.getExpensesObjects();
      const start = new Date(startDateISO);
      const end = new Date(endDateISO);
      let total = 0;
      for (const e of expenses) {
        if (!e || !e.debtId || !e.date) continue;
        if (String(e.debtId) !== String(debtId)) continue;
        const entryType = e.entryType ? String(e.entryType).toLowerCase() : '';
        if (entryType !== 'payment') continue;
        const d = new Date(e.date);
        const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        if (dateOnly >= new Date(start.getFullYear(), start.getMonth(), start.getDate()) && dateOnly <= new Date(end.getFullYear(), end.getMonth(), end.getDate())) {
          const amt = Number(e.amount);
          if (Number.isFinite(amt)) total += amt;
        }
      }
      return Number(total.toFixed(2));
    } catch (error) {
      logger.error('Error summing payments for debt', { debtId, startDateISO, endDateISO, error: error.message });
      throw error;
    }
  }

  /**
   * Add new debt to Google Sheets
   */
  async addDebt(debt) {
    try {
      logger.info('Adding new debt to Google Sheets', {
        name: debt.name,
        issuer: debt.issuer
      });

      const values = [[
        debt.id,
        debt.name,
        debt.issuer || '',
        debt.creditLimit !== undefined ? debt.creditLimit.toString() : '',
        debt.balance !== undefined ? debt.balance.toString() : '',
        debt.dueDay !== undefined ? debt.dueDay.toString() : '',
        debt.cutOffDay !== undefined ? debt.cutOffDay.toString() : '',
        debt.maskPan ? String(debt.maskPan) : '',
        debt.interesEfectivo !== undefined ? debt.interesEfectivo.toString() : '',
        debt.brand ? String(debt.brand) : '',
        debt.active ? 'TRUE' : 'FALSE'
      ]];

      // Append includes up to column K for brand
      const response = await this.makeRequest('/values/Debts!A:K:append?valueInputOption=RAW', {
        method: 'POST',
        body: JSON.stringify({ values })
      });

      logger.info('Debt added successfully', { debtId: debt.id });
      return response;
    } catch (error) {
      logger.error('Error adding debt', {
        name: debt.name,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Update debt in Google Sheets
   */
  async updateDebt(debt) {
    try {
      logger.info('Updating debt by id in Google Sheets', {
        id: debt.id,
        name: debt.name
      });

      if (!debt.id) {
        throw new ApiError(400, 'Missing required field: id');
      }

      const rowNumber = await this.findRowNumberById('Debts', debt.id);
      if (!rowNumber) {
        throw new ApiError(404, 'Debt not found');
      }

      const existingResp = await this.makeRequest(`/values/Debts!A${rowNumber}:K${rowNumber}`);
      const existing = (existingResp.values && existingResp.values[0]) || [];

      const merged = [
        debt.id,
        debt.name !== undefined ? debt.name : (existing[1] || ''),
        debt.issuer !== undefined ? debt.issuer : (existing[2] || ''),
        debt.creditLimit !== undefined ? debt.creditLimit.toString() : (existing[3] || ''),
        debt.balance !== undefined ? debt.balance.toString() : (existing[4] || ''),
        debt.dueDay !== undefined ? debt.dueDay.toString() : (existing[5] || ''),
        debt.cutOffDay !== undefined ? debt.cutOffDay.toString() : (existing[6] || ''),
        debt.maskPan !== undefined ? String(debt.maskPan) : (existing[7] || ''),
        debt.interesEfectivo !== undefined ? debt.interesEfectivo.toString() : (existing[8] || ''),
        debt.brand !== undefined ? String(debt.brand) : (existing[9] || ''),
        debt.active !== undefined ? (debt.active ? 'TRUE' : 'FALSE') : (existing[10] || '')
      ];

      const response = await this.makeRequest(`/values/Debts!A${rowNumber}:K${rowNumber}?valueInputOption=RAW`, {
        method: 'PUT',
        body: JSON.stringify({ values: [merged] })
      });

      logger.info('Debt updated successfully', { debtId: debt.id, rowNumber });
      return response;
    } catch (error) {
      logger.error('Error updating debt', {
        id: debt.id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Adjust a debt balance by a delta (can be positive or negative)
   */
  async adjustDebtBalance(debtId, delta) {
    try {
      if (!debtId || !Number.isFinite(Number(delta))) {
        throw new ApiError(400, 'Invalid parameters for adjustDebtBalance');
      }

      const rowNumber = await this.findRowNumberById('Debts', debtId);
      if (!rowNumber) {
        throw new ApiError(404, 'Debt not found');
      }

      const existingResp = await this.makeRequest(`/values/Debts!A${rowNumber}:K${rowNumber}`);
      const existing = (existingResp.values && existingResp.values[0]) || [];
      const currentBalance = parseFloat(existing[4] || '0') || 0;
      const newBalance = currentBalance + Number(delta);

      await this.updateDebt({ id: debtId, balance: newBalance });
      logger.info('Debt balance adjusted', { debtId, delta, from: currentBalance, to: newBalance });
      return newBalance;
    } catch (error) {
      logger.error('Error adjusting debt balance', { debtId, delta, error: error.message });
      throw error;
    }
  }

  /**
   * Delete debt in Google Sheets
   */
  async deleteDebt(id) {
    try {
      logger.info('Deleting debt in Google Sheets', { id });

      const rowNumber = await this.findRowNumberById('Debts', id);
      if (!rowNumber) {
        throw new ApiError(404, 'Debt not found');
      }

      const response = await this.deleteRowByNumber('Debts', rowNumber);

      logger.info('Debt deleted successfully', { id, rowNumber });
      return response;
    } catch (error) {
      logger.error('Error deleting debt', { id, error: error.message });
      throw error;
    }
  }

  /**
   * Find the row number (1-based) for a given id in column A, skipping header
   */
  async findRowNumberById(sheetTitle, id) {
    try {
      const response = await this.makeRequest(`/values/${sheetTitle}!A:A`);
      const rows = response.values || [];
      for (let i = 1; i < rows.length; i++) {
        const value = rows[i] && rows[i][0] !== undefined ? rows[i][0] : undefined;
        if (value === id) {
          return i + 1; // 1-based row number
        }
      }
      return null;
    } catch (error) {
      logger.error('Error finding row by id', { sheetTitle, id, error: error.message });
      throw error;
    }
  }

  /**
   * Delete a row by 1-based row number using BatchUpdate
   */
  async deleteRowByNumber(sheetTitle, rowNumber) {
    try {
      const sheetId = await this.getGridSheetIdByTitle(sheetTitle);
      if (sheetId === null || sheetId === undefined) {
        throw new ApiError(500, `Sheet not found: ${sheetTitle}`);
      }

      const startIndex = rowNumber - 1; // zero-based inclusive
      const endIndex = rowNumber; // zero-based exclusive

      const body = {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: 'ROWS',
                startIndex,
                endIndex
              }
            }
          }
        ]
      };

      const response = await this.makeRequest(':batchUpdate', {
        method: 'POST',
        body: JSON.stringify(body)
      });

      return response;
    } catch (error) {
      logger.error('Error deleting row by number', { sheetTitle, rowNumber, error: error.message });
      throw error;
    }
  }

  /**
   * Resolve and cache grid sheetId by its title
   */
  async getGridSheetIdByTitle(title) {
    try {
      if (!this.sheetTitleToGridId) {
        this.sheetTitleToGridId = {};
      }
      if (this.sheetTitleToGridId[title] !== undefined) {
        return this.sheetTitleToGridId[title];
      }

      const meta = await this.makeRequest('?fields=sheets.properties');
      const sheets = (meta && meta.sheets) || [];
      for (const sheet of sheets) {
        const props = sheet.properties || {};
        if (props.title === title) {
          this.sheetTitleToGridId[title] = props.sheetId;
          return props.sheetId;
        }
      }
      this.sheetTitleToGridId[title] = null;
      return null;
    } catch (error) {
      logger.error('Error getting grid sheetId by title', { title, error: error.message });
      throw error;
    }
  }

  /**
   * Generate fixed expenses for a specific month
   */
  async generateFixedExpensesForMonth(month) {
    try {
      logger.info('Generating fixed expenses for month', { month });
      
      const fixedExpenses = await this.getFixedExpenses();
      // Parse month safely (YYYY-MM)
      const [yearStr, monthStr] = (month || '').split('-');
      const year = parseInt(yearStr, 10);
      const monthIndex = parseInt(monthStr, 10) - 1; // 0-based
      if (Number.isNaN(year) || Number.isNaN(monthIndex) || monthIndex < 0 || monthIndex > 11) {
        throw new ApiError(400, 'Invalid month format. Expected YYYY-MM');
      }

      const monthStart = new Date(year, monthIndex, 1);
      const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
      
      const generatedExpenses = [];
      
      for (const fixedExpense of fixedExpenses.slice(1)) { // Skip header
        if (fixedExpense[5] === 'TRUE') { // If active
          const requestedDay = parseInt(fixedExpense[4], 10);
          if (Number.isNaN(requestedDay) || requestedDay <= 0) {
            continue;
          }

          // Clamp to last valid day of the target month
          const clampedDay = Math.min(requestedDay, daysInMonth);
          const expenseDate = new Date(year, monthIndex, clampedDay);

          // Format date as YYYY-MM-DD without timezone shifts
          const yyyy = expenseDate.getFullYear();
          const mm = String(expenseDate.getMonth() + 1).padStart(2, '0');
          const dd = String(expenseDate.getDate()).padStart(2, '0');
          const dateStr = `${yyyy}-${mm}-${dd}`;

          
          // Determine entry type based on presence of debtId (no longer tied to category 7)
          const hasDebt = !!fixedExpense[6];
          const entryType = hasDebt ? 'payment' : '';
          generatedExpenses.push({
            id: Date.now() + Math.random().toString(36).slice(2, 11),
            date: dateStr,
            description: fixedExpense[1],
            amount: parseFloat(fixedExpense[2]),
            categoryId: parseInt(fixedExpense[3]),
            isFixed: true,
            fixedExpenseId: fixedExpense[0],
            debtId: fixedExpense[6] ? String(fixedExpense[6]) : null,
            entryType: entryType || null,
            status: 'pending'
          });
        }
      }
      
      // Build deduplication set from existing expenses using ONLY (date + fixedExpenseId)
      const existing = await this.getExpenses();
      const existingSet = new Set();
      for (const row of existing.slice(1)) {
        const existingDate = row[1];
        const existingFixedId = row[6] ? String(row[6]) : '';
        if (existingDate && existingFixedId) {
          existingSet.add(`${existingDate}#${existingFixedId}`);
        }
      }

      // Filter out duplicates strictly by (date + fixedExpenseId)
      const toInsert = generatedExpenses.filter((e) => {
        const key = e.fixedExpenseId ? `${e.date}#${String(e.fixedExpenseId)}` : null;
        return key ? !existingSet.has(key) : true;
      });

      const skippedCount = generatedExpenses.length - toInsert.length;
      logger.info('Deduplication completed (date+fixedExpenseId)', { total: generatedExpenses.length, toInsert: toInsert.length, skipped: skippedCount });

      // Always save to Google Sheets (append to Expenses) if there are items after dedupe
      let saveResult = null;
      if (toInsert.length > 0) {
        logger.info('Saving generated fixed expenses to Google Sheets', { count: toInsert.length });
        saveResult = await this.addExpensesBulk(toInsert);
        logger.info('Generated fixed expenses saved successfully');
      }

      logger.info('Fixed expenses generation finished', { month, count: toInsert.length, skipped: skippedCount });
      return { items: toInsert, saved: true, saveResult };
    } catch (error) {
      logger.error('Error generating fixed expenses', { month, error: error.message });
      throw error;
    }
  }

  /**
   * Check if fixed expense already exists
   */
  async checkFixedExpenseExists(description, categoryId) {
    try {
      logger.debug('Checking if fixed expense exists', { description, categoryId });
      
      const fixedExpenses = await this.getFixedExpenses();
      const exists = fixedExpenses.slice(1).some(expense => 
        expense[1] === description && parseInt(expense[3]) === categoryId
      );
      
      logger.debug('Fixed expense existence check result', { description, categoryId, exists });
      return exists;
    } catch (error) {
      logger.error('Error checking fixed expense existence', { 
        description, 
        categoryId, 
        error: error.message 
      });
      throw error;
    }
  }
}

export default GoogleSheetsService;
