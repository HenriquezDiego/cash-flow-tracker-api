import cron from 'node-cron';
import logger from '../config/logger.js';
import config from '../config/config.js';
import UserSheetService from './userSheetService.js';
import GoogleSheetsService from './googleSheetsService.js';
import authService from './authService.js';
import { accrueDebtInternal } from '../controllers/debtController.js';

/**
 * Service for scheduled tasks (cron jobs)
 */
class ScheduledTasksService {
  constructor() {
    this.userSheetService = new UserSheetService();
    this.tasks = [];
  }

  /**
   * Initialize scheduled tasks
   */
  start() {
    if (!config.scheduledTasks.enabled) {
      logger.info('Scheduled tasks are disabled in configuration');
      return;
    }

    logger.info('Starting scheduled tasks service', {
      cronSchedule: config.scheduledTasks.cronSchedule,
      timezone: config.scheduledTasks.timezone
    });
    
    // Daily task to process debt accruals
    // Cron format: minute hour day month dayOfWeek
    // Default: '0 2 * * *' = Every day at 2:00 AM
    const dailyTask = cron.schedule(config.scheduledTasks.cronSchedule, async () => {
      logger.info('Daily scheduled task: Processing debt accruals', {
        timestamp: new Date().toISOString()
      });
      
      try {
        await this.processDebtAccruals();
      } catch (error) {
        logger.error('Error in daily scheduled task', {
          error: error.message,
          stack: error.stack
        });
      }
    }, {
      scheduled: true,
      timezone: config.scheduledTasks.timezone
    });

    this.tasks.push({ name: 'daily-debt-accruals', task: dailyTask });
    
    logger.info('Scheduled tasks initialized', {
      tasks: this.tasks.map(t => t.name),
      cronSchedule: config.scheduledTasks.cronSchedule,
      timezone: config.scheduledTasks.timezone
    });
  }

  /**
   * Process debt accruals for all users
   * This runs daily and checks which debts have their cutoff day today
   */
  async processDebtAccruals() {
    try {
      logger.info('Processing debt accruals for all users');
      
      // Get all users
      const users = await this.userSheetService.getAllUsers();
      logger.info('Found users for debt accrual processing', { count: users.length });
      
      let totalProcessed = 0;
      let totalSkipped = 0;
      let totalErrors = 0;
      
      // Process each user
      for (const user of users) {
        // Skip users without sheetId or accessToken
        if (!user.sheetId || !user.accessToken) {
          logger.debug('Skipping user without sheetId or accessToken', {
            userId: user.id,
            email: user.email
          });
          continue;
        }

        try {
          // Try to refresh token if needed (before creating service)
          let accessToken = user.accessToken;
          
          // Test token validity by attempting to access sheet
          try {
            const testResponse = await fetch(
              `https://sheets.googleapis.com/v4/spreadsheets/${user.sheetId}`,
              {
                headers: {
                  'Authorization': `Bearer ${accessToken}`,
                  'Content-Type': 'application/json'
                }
              }
            );
            
            // If token is expired (401), try to refresh
            if (testResponse.status === 401 && user.refreshToken) {
              logger.info('Access token expired, refreshing', {
                userId: user.id,
                email: user.email
              });
              
              try {
                accessToken = await authService.refreshAccessToken(user.refreshToken);
                
                // Update user's token in database
                await this.userSheetService.updateUserTokens(user.googleId, accessToken, user.refreshToken);
                
                logger.info('Access token refreshed successfully', {
                  userId: user.id,
                  email: user.email
                });
              } catch (refreshError) {
                logger.error('Failed to refresh token for user', {
                  userId: user.id,
                  email: user.email,
                  error: refreshError.message
                });
                continue; // Skip this user
              }
            } else if (!testResponse.ok && testResponse.status !== 401) {
              logger.warn('Unable to access user sheet', {
                userId: user.id,
                email: user.email,
                status: testResponse.status
              });
              continue; // Skip this user
            }
          } catch (testError) {
            logger.error('Error testing token validity', {
              userId: user.id,
              email: user.email,
              error: testError.message
            });
            continue; // Skip this user
          }
          
          // Create GoogleSheetsService instance with (potentially refreshed) token
          const sheetsService = new GoogleSheetsService(accessToken, user.sheetId);
          
          // Get all debts for this user
          const debts = await sheetsService.getDebtsObjects();
          logger.debug('Found debts for user', {
            userId: user.id,
            email: user.email,
            debtCount: debts.length
          });
          
          // Get today's date
          const today = new Date();
          const todayDay = today.getDate();
          
          // Process each active debt
          for (const debt of debts) {
            // Skip inactive debts
            if (!debt.active || debt.active === false) {
              continue;
            }
            
            // Check if this debt has a cutoff day that matches today
            const cutOffDay = debt.cutOffDay ? parseInt(debt.cutOffDay, 10) : null;
            
            if (!cutOffDay || cutOffDay !== todayDay) {
              continue;
            }
            
            logger.info('Processing debt accrual for cutoff day', {
              userId: user.id,
              email: user.email,
              debtId: debt.id,
              debtName: debt.name,
              cutOffDay: cutOffDay,
              today: todayDay
            });
            
            try {
              // Execute accrue for this debt
              // Use today's date to ensure we process the correct statement period
              const result = await accrueDebtInternal(sheetsService, debt.id, {
                recompute: false,
                dateParam: null, // Use today's date
                periodParam: null
              });
              
              if (result.skipped) {
                logger.info('Debt accrual skipped', {
                  userId: user.id,
                  debtId: debt.id,
                  reason: result.reason
                });
                totalSkipped++;
              } else {
                logger.info('Debt accrual processed successfully', {
                  userId: user.id,
                  debtId: debt.id,
                  statementDate: result.statementDate
                });
                totalProcessed++;
              }
            } catch (error) {
              logger.error('Error processing debt accrual', {
                userId: user.id,
                debtId: debt.id,
                error: error.message,
                stack: error.stack
              });
              totalErrors++;
            }
          }
        } catch (error) {
          logger.error('Error processing user debts', {
            userId: user.id,
            email: user.email,
            error: error.message
          });
          totalErrors++;
        }
      }
      
      logger.info('Debt accrual processing completed', {
        totalProcessed,
        totalSkipped,
        totalErrors,
        totalUsers: users.length
      });
    } catch (error) {
      logger.error('Error in processDebtAccruals', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Stop all scheduled tasks
   */
  stop() {
    logger.info('Stopping scheduled tasks service');
    this.tasks.forEach(({ name, task }) => {
      task.stop();
      logger.info('Stopped scheduled task', { name });
    });
    this.tasks = [];
  }

  /**
   * Manually trigger debt accrual processing (for testing)
   */
  async triggerDebtAccruals() {
    logger.info('Manually triggering debt accrual processing');
    await this.processDebtAccruals();
  }
}

// Export singleton instance
const scheduledTasksService = new ScheduledTasksService();
export default scheduledTasksService;

