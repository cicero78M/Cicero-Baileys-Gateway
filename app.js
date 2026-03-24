import './src/utils/logger.js';
import express from 'express';
import morgan from 'morgan';
import { env } from './src/config/env.js';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import waHealthRoutes from './src/routes/waHealthRoutes.js';
import { notFound, errorHandler } from './src/middleware/errorHandler.js';
import { dedupRequest } from './src/middleware/dedupRequestMiddleware.js';
import { sensitivePathGuard } from './src/middleware/sensitivePathGuard.js';

// Bootstrap WA service (registers Baileys client and message handlers)
import './src/service/waService.js';

const app = express();
app.disable('etag');

app.use(cors({
  origin: env.CORS_ORIGIN,
  credentials: true,
}));

app.use(express.json());
app.use(cookieParser());
app.use(morgan('dev'));
app.use(dedupRequest);
app.use(sensitivePathGuard);

app.all('/', (req, res) => res.status(200).json({ status: 'ok' }));

// WA gateway health check endpoint
app.use('/api/health/wa', waHealthRoutes);

// Handler NotFound dan Error
app.use(notFound);
app.use(errorHandler);

const PORT = env.PORT;
app.listen(PORT, () => console.log(`Backend server running on port ${PORT}`));
