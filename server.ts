import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // CORS middleware for legacy devices connecting on local network
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // AI Chat Proxy endpoint for legacy devices (e.g., iPad Mini 2 on iOS 9.3.5)
  app.post('/api/chat', async (req, res) => {
    try {
      const { provider, apiKey, model, messages, systemInstruction } = req.body;

      // Use client-provided API key or server environment GEMINI_API_KEY
      const effectiveKey = apiKey || process.env.GEMINI_API_KEY;

      // Handle OpenAI ChatGPT Provider / GPT Models
      if (provider === 'openai' || (model && typeof model === 'string' && model.startsWith('gpt'))) {
        const openAiKey = apiKey || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
        if (!openAiKey) {
          return res.status(400).json({ error: 'OpenAI API Key is required. Please enter your OpenAI API key in Settings.' });
        }
        
        const openAiMsgs: { role: string; content: string }[] = [];
        const noHashtagInstruction = 'IMPORTANT: Do NOT use hashtags (#) or markdown header hashes in your responses. Keep responses clean, well-structured, and concise using simple bullet points or clear short paragraphs.';
        const fullInstruction = systemInstruction ? `${systemInstruction}\n\n${noHashtagInstruction}` : noHashtagInstruction;

        openAiMsgs.push({ role: 'system', content: fullInstruction });

        (messages || []).forEach((msg: { role: string; content: string }) => {
          openAiMsgs.push({
            role: msg.role === 'model' ? 'assistant' : msg.role,
            content: msg.content
          });
        });

        const selectedGptModel = (model && model.startsWith('gpt')) ? model : 'gpt-3.5-turbo';

        const openAiRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openAiKey}`
          },
          body: JSON.stringify({
            model: selectedGptModel,
            messages: openAiMsgs
          })
        });

        const data = await openAiRes.json();
        if (!openAiRes.ok) {
          return res.status(openAiRes.status).json({ error: data.error?.message || 'OpenAI API Request Failed' });
        }

        const reply = data.choices?.[0]?.message?.content || 'No response generated.';
        return res.json({ reply, raw: data });
      }

      // Default: Google Gemini
      if (!effectiveKey) {
        return res.status(400).json({ 
          error: 'No API Key provided. Please enter a Gemini API Key in Settings or configure GEMINI_API_KEY on the server.' 
        });
      }

      const ai = new GoogleGenAI({
        apiKey: effectiveKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build'
          }
        }
      });

      // Map model alias to active Gemini model name
      let selectedModel = model || 'gemini-3.6-flash';
      if (!selectedModel || selectedModel === 'gemini-2.5-flash' || selectedModel === 'gemini-1.5-flash' || selectedModel === 'gemini-2.0-flash' || selectedModel === 'gemini-3.6-flash') {
        selectedModel = 'gemini-3.6-flash';
      }

      // Format FULL message history into Gemini contents structure without limits
      const allMessages = messages || [];
      const formattedContents = allMessages.map((msg: { role: string; content: string }) => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }));

      // Enhanced system instruction to eliminate hashtags and enforce fast concise answers
      const defaultInstruction = 'IMPORTANT: Do NOT use hashtags (#, ##, ###) or markdown header hashes in your responses. Keep responses fast, clean, well-structured, and concise using simple bullet points or clear short paragraphs.';
      const combinedInstruction = systemInstruction 
        ? `${systemInstruction}\n\n${defaultInstruction}`
        : defaultInstruction;

      const response = await ai.models.generateContent({
        model: selectedModel,
        contents: formattedContents.length > 0 ? formattedContents : 'Hello',
        config: {
          systemInstruction: combinedInstruction,
          temperature: 0.7
        }
      });

      const text = response.text || 'No text generated.';
      return res.json({ reply: text });

    } catch (err: any) {
      console.error('Chat API Error:', err);
      return res.status(500).json({ 
        error: err.message || 'An internal server error occurred while contacting the AI API.' 
      });
    }
  });

  // Vite middleware in development or static file serving in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
