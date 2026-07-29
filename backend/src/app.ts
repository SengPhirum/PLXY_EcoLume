import path from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { config, isProduction } from './config.js';
import { query } from './db.js';
import { apiRouter } from './routes/api.js';
import { webRouter } from './routes/web.js';
import { sessionMiddleware } from './security.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', path.resolve('src/views'));

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"]
      }
    },
    hsts: isProduction ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false
  }));
  app.use(morgan(isProduction ? 'combined' : 'dev'));
  app.use(express.json({ limit: '64kb' }));
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));
  app.use(cookieParser());
  app.use(sessionMiddleware);
  app.use('/public', express.static(path.resolve('src/public'), {
    immutable: isProduction,
    maxAge: isProduction ? '7d' : 0
  }));

  app.get('/health', async (_request, response) => {
    try {
      await query('SELECT 1');
      response.json({
        status: 'ok',
        service: 'plxy-ecolume',
        version: '0.1.0',
        time: new Date().toISOString()
      });
    } catch {
      response.status(503).json({ status: 'degraded', database: 'unavailable' });
    }
  });

  app.use('/api/v1', (request: Request, response: Response, next: NextFunction) => {
    if (request.method === 'GET' || request.path === '/device/telemetry') {
      next();
      return;
    }
    const origin = request.header('origin');
    if (origin && origin !== config.APP_BASE_URL) {
      response.status(403).json({ error: 'Origin rejected' });
      return;
    }
    next();
  }, apiRouter);
  app.use(webRouter);

  app.use((_request, response) => {
    response.status(404).render('error', {
      title: 'Page not found',
      message: 'The requested EcoLume resource does not exist.'
    });
  });

  app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
    console.error('Unhandled request error', error);
    if (request.path.startsWith('/api/')) {
      response.status(500).json({ error: 'Internal server error' });
    } else {
      response.status(500).render('error', {
        title: 'Service interruption',
        message: 'The request could not be completed. Please try again or contact the operations administrator.'
      });
    }
  });

  return app;
}

