import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import { apiRouter } from './routes/api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/api', apiRouter);

// Serve evidence screenshots
app.use('/evidence', express.static(path.join(__dirname, '..', 'data', 'evidence')));

// Serve built client in production
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) res.status(404).json({ error: 'Client not built. Run npm run dev.' });
  });
});

app.listen(PORT, () => {
  console.log(`QUTIE server running on http://localhost:${PORT}`);
});
