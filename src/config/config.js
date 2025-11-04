import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

const config = {
  // Server configuration
  port: process.env.PORT || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Google Sheets configuration
  googleSheetId: process.env.GOOGLE_SHEET_ID,
  googleServiceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  googlePrivateKey: process.env.GOOGLE_PRIVATE_KEY,
  
  // JWT configuration
  jwtSecret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  
  // Logging configuration
  logLevel: process.env.LOG_LEVEL || 'info',
  logFile: process.env.LOG_FILE || 'logs/app.log',
  
  // CORS configuration
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  
  // Rate limiting
  rateLimitWindowMs: 15 * 60 * 1000, // 15 minutes
  rateLimitMax: 100, // limit each IP to 100 requests per windowMs
  
  // Validation
  validationOptions: {
    abortEarly: false,
    allowUnknown: true,
    stripUnknown: true
  },

  // Docs
  enableDocs: (process.env.ENABLE_DOCS || '').toLowerCase() === 'true',

  // Scheduled tasks configuration
  scheduledTasks: {
    enabled: (process.env.SCHEDULED_TASKS_ENABLED || 'true').toLowerCase() === 'true',
    cronSchedule: process.env.SCHEDULED_TASKS_CRON || '0 2 * * *', // Default: 2:00 AM daily
    timezone: process.env.SCHEDULED_TASKS_TIMEZONE || 'America/Mexico_City'
  }
};

// Validate required configuration
const requiredConfig = ['googleSheetId', 'googleServiceAccountEmail', 'googlePrivateKey'];
const missingConfig = requiredConfig.filter(key => !config[key]);

if (missingConfig.length > 0 && config.nodeEnv === 'production') {
  throw new Error(`Missing required configuration: ${missingConfig.join(', ')}`);
}

export default config;
