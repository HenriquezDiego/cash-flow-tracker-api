import logger from '../config/logger.js';
import { ApiError } from '../middleware/errorHandler.js';

/**
 * Service for automatically creating Google Sheets for new users
 */
class SheetCreationService {
  /**
   * Create a new Google Sheet for a user
   * @param {string} userAccessToken - User's OAuth access token
   * @param {string} userName - User's name for sheet title
   * @returns {Promise<string>} Created sheet ID
   */
  async createUserSheet(userAccessToken, userName) {
    try {
      logger.info('Creating new Google Sheet for user', { userName });

      const sheetTitle = `CashFlow Tracker - ${userName}`;
      
      // Create spreadsheet with all necessary sheets
      const spreadsheet = {
        properties: {
          title: sheetTitle,
          locale: 'es_MX',
          timeZone: 'America/Mexico_City'
        },
        sheets: [
          this.createExpensesSheet(),
          this.createCategoriesSheet(),
          this.createBudgetSheet(),
          this.createFixedExpensesSheet(),
          this.createDebtsSheet(),
          this.createCreditHistorySheet()
        ]
      };

      // Create the spreadsheet
      const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${userAccessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(spreadsheet)
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Failed to create user sheet', { 
          status: response.status, 
          error: errorText 
        });
        throw new ApiError(500, 'Failed to create Google Sheet');
      }

      const data = await response.json();
      const sheetId = data.spreadsheetId;

      logger.info('Google Sheet created successfully', { 
        sheetId, 
        userName,
        url: `https://docs.google.com/spreadsheets/d/${sheetId}`
      });

      // Populate with initial data (categories)
      await this.populateInitialData(userAccessToken, sheetId);

      return sheetId;
    } catch (error) {
      logger.error('Error creating user sheet', { 
        userName, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Create Expenses sheet configuration
   */
  createExpensesSheet() {
    return {
      properties: {
        title: 'Expenses',
        gridProperties: {
          rowCount: 1000,
          columnCount: 10,
          frozenRowCount: 1
        }
      },
      data: [{
        startRow: 0,
        startColumn: 0,
        rowData: [{
          values: [
            { userEnteredValue: { stringValue: 'id' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'date' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'description' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'amount' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'categoryId' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'isFixed' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'fixedExpenseId' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'debtId' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'entryType' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'status' }, userEnteredFormat: { textFormat: { bold: true } } }
          ]
        }]
      }]
    };
  }

  /**
   * Create Categories sheet configuration
   */
  createCategoriesSheet() {
    return {
      properties: {
        title: 'Categories',
        gridProperties: {
          rowCount: 100,
          columnCount: 4,
          frozenRowCount: 1
        }
      },
      data: [{
        startRow: 0,
        startColumn: 0,
        rowData: [{
          values: [
            { userEnteredValue: { stringValue: 'id' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'name' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'color' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'icon' }, userEnteredFormat: { textFormat: { bold: true } } }
          ]
        }]
      }]
    };
  }

  /**
   * Create Budget sheet configuration
   */
  createBudgetSheet() {
    return {
      properties: {
        title: 'Budget',
        gridProperties: {
          rowCount: 100,
          columnCount: 2,
          frozenRowCount: 1
        }
      },
      data: [{
        startRow: 0,
        startColumn: 0,
        rowData: [{
          values: [
            { userEnteredValue: { stringValue: 'month' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'amount' }, userEnteredFormat: { textFormat: { bold: true } } }
          ]
        }]
      }]
    };
  }

  /**
   * Create FixedExpenses sheet configuration
   */
  createFixedExpensesSheet() {
    return {
      properties: {
        title: 'FixedExpenses',
        gridProperties: {
          rowCount: 100,
          columnCount: 7,
          frozenRowCount: 1
        }
      },
      data: [{
        startRow: 0,
        startColumn: 0,
        rowData: [{
          values: [
            { userEnteredValue: { stringValue: 'id' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'name' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'amount' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'categoryId' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'dayOfMonth' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'active' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'debtId' }, userEnteredFormat: { textFormat: { bold: true } } }
          ]
        }]
      }]
    };
  }

  /**
   * Create Debts sheet configuration
   */
  createDebtsSheet() {
    return {
      properties: {
        title: 'Debts',
        gridProperties: {
          rowCount: 100,
          columnCount: 11,
          frozenRowCount: 1
        }
      },
      data: [{
        startRow: 0,
        startColumn: 0,
        rowData: [{
          values: [
            { userEnteredValue: { stringValue: 'id' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'name' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'issuer' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'creditLimit' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'balance' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'dueDay' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'cutOffDay' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'maskPan' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'interesEfectivo' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'brand' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'active' }, userEnteredFormat: { textFormat: { bold: true } } }
          ]
        }]
      }]
    };
  }

  /**
   * Create CreditHistory sheet configuration
   */
  createCreditHistorySheet() {
    return {
      properties: {
        title: 'CreditHistory',
        gridProperties: {
          rowCount: 1000,
          columnCount: 14,
          frozenRowCount: 1
        }
      },
      data: [{
        startRow: 0,
        startColumn: 0,
        rowData: [{
          values: [
            { userEnteredValue: { stringValue: 'debtId' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'statementDate' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'dueDate' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'previousBalance' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'charges' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'interests' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'payments' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'statementBalance' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'bonifiableInterest' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'installmentBalance' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'annualEffectiveRate' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'termMonths' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'periodDays' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { stringValue: 'paymentMade' }, userEnteredFormat: { textFormat: { bold: true } } }
          ]
        }]
      }]
    };
  }

  /**
   * Populate initial data (default categories)
   * @param {string} userAccessToken - User's OAuth access token
   * @param {string} sheetId - Sheet ID to populate
   */
  async populateInitialData(userAccessToken, sheetId) {
    try {
      logger.info('Populating initial categories', { sheetId });

      const defaultCategories = [
        ['1', 'Comida', '#FF5722', '🍔'],
        ['2', 'Transporte', '#2196F3', '🚗'],
        ['3', 'Entretenimiento', '#9C27B0', '🎮'],
        ['4', 'Servicios', '#4CAF50', '💡'],
        ['5', 'Salud', '#F44336', '🏥'],
        ['6', 'Educación', '#FF9800', '📚'],
        ['7', 'Pagos de Crédito', '#607D8B', '💳'],
        ['8', 'Ahorro', '#009688', '💰'],
        ['9', 'Otros', '#9E9E9E', '📌']
      ];

      const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Categories!A2:D10?valueInputOption=RAW`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${userAccessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            values: defaultCategories
          })
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Failed to populate initial data', { 
          status: response.status, 
          error: errorText 
        });
        // Don't throw error - sheet is still usable without initial data
      } else {
        logger.info('Initial categories populated successfully', { sheetId });
      }
    } catch (error) {
      logger.error('Error populating initial data', { 
        sheetId, 
        error: error.message 
      });
      // Don't throw - this is not critical
    }
  }
}

export default SheetCreationService;


