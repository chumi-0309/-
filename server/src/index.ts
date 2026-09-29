import express from "express";
import cors from "cors";
import aiRouter from "./routes/ai.js";

const app = express();
const port = process.env.PORT || 9091;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.get('/api/v1/health', (req, res) => {
  console.log('Health check success');
  res.status(200).json({ status: 'ok' });
});

// AI 能力路由（翻译 / OCR / 智能排版）
app.use('/api/v1/ai', aiRouter);


app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}/`);
});