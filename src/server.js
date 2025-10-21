import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import compression from 'compression';
import cors from 'cors';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import fs from 'fs';

import config from './config/config.js';
import logger from './config/logger.js';
import { errorConverter, errorHandler, notFound } from './middleware/errorHandler.js';
import authService from './services/authService.js';
import { requireAuth, requireJWT, attachSheetsService } from './middleware/authMiddleware.js';

// Import routes
import authRoutes from './routes/authRoutes.js';
import budgetRoutes from './routes/budgetRoutes.js';
import categoryRoutes from './routes/categoryRoutes.js';
import expenseRoutes from './routes/expenseRoutes.js';
import fixedExpenseRoutes from './routes/fixedExpenseRoutes.js';
import debtRoutes from './routes/debtRoutes.js';
import generateFixedExpensesRoutes from './routes/generateFixedExpensesRoutes.js';
import metaRoutes from './routes/metaRoutes.js';

const app = express();


// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ['\'self\''],
      styleSrc: ['\'self\'', '\'unsafe-inline\''],
      scriptSrc: ['\'self\''],
      imgSrc: ['\'self\'', 'data:', 'https:'],
    },
  },
}));

// CORS configuration
app.use(cors({
  origin: config.corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax,
  message: {
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Compression middleware
app.use(compression());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session configuration (before Passport)
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-session-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: config.nodeEnv === 'production', // HTTPS only in production
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

// Initialize Passport for authentication
const passport = authService.getPassport();
app.use(passport.initialize());
app.use(passport.session());

// Logging middleware
app.use(morgan('combined', { stream: logger.stream }));

// OpenAPI/Swagger docs (only in development or when ENABLE_DOCS=true)
if (config.nodeEnv === 'development' || config.enableDocs) {
  try {
    const openapiPath = path.resolve(__dirname, './docs/openapi.json');
    const openapiDoc = JSON.parse(fs.readFileSync(openapiPath, 'utf-8'));
    app.get('/openapi.json', (_req, res) => res.json(openapiDoc));
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiDoc, { explorer: true }));
    logger.info('Swagger UI mounted at /docs');
  } catch (e) {
    logger.error('Failed to load OpenAPI document', { error: e.message });
  }
}

// Root endpoint - show API status
app.get('/', (req, res) => {
  res.json({
    message: '💰 Cash Flow Tracker API',
    status: 'running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.nodeEnv,
    version: '2.0.0',
    authentication: 'OAuth 2.0 with Google',
    endpoints: {
      health: '/health',
      auth: {
        loginWithGoogle: '/api/auth/google',
        checkAuth: '/api/auth/check',
        getCurrentUser: '/api/auth/me',
        logout: '/api/auth/logout'
      },
      data: {
        expenses: '/api/expenses',
        budgets: '/api/budget',
        categories: '/api/categories',
        fixedExpenses: '/api/fixed-expenses',
        debts: '/api/debts',
        generateFixedExpenses: '/api/generate-fixed-expenses?month=YYYY-MM'
      }
    },
    documentation: (config.nodeEnv === 'development' || config.enableDocs) ? '/docs' : undefined
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.nodeEnv
  });
});

// API routes

// Authentication routes (public)
app.use('/api/auth', authRoutes);

// Protected routes (require JWT authentication + user sheet)
app.use('/api/expenses', requireJWT, attachSheetsService, expenseRoutes);
app.use('/api/categories', requireJWT, attachSheetsService, categoryRoutes);
app.use('/api/budget', requireJWT, attachSheetsService, budgetRoutes);
app.use('/api/fixed-expenses', requireJWT, attachSheetsService, fixedExpenseRoutes);
app.use('/api/debts', requireJWT, attachSheetsService, debtRoutes);
app.use('/api/generate-fixed-expenses', requireJWT, attachSheetsService, generateFixedExpensesRoutes);
app.use('/api/meta', metaRoutes); // Public metadata endpoint

// 404 handler
app.use(notFound);

// Error handling middleware
app.use(errorConverter);
app.use(errorHandler);

// Start server
const PORT = config.port;

app.listen(PORT, () => {
  logger.info(`🚀 Cash Flow Tracker API v2.0 running on http://localhost:${PORT}`);
  logger.info(`📊 Master Sheet ID: ${process.env.MASTER_SHEET_ID}`);
  logger.info(`🔐 Authentication: OAuth 2.0 with Google`);
  logger.info(`🌍 Environment: ${config.nodeEnv}`);
  logger.info(`📝 Docs available at: http://localhost:${PORT}/docs`);
  
  console.log(`\n💰 Cash Flow Tracker API v2.0`);
  console.log(`🚀 Server: http://localhost:${PORT}`);
  console.log(`🔐 Multi-user mode with OAuth 2.0`);
  console.log(`📝 API Docs: http://localhost:${PORT}/docs`);
  console.log(`🌍 Environment: ${config.nodeEnv}\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

export default app;
