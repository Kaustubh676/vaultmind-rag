import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

export const EMBEDDING_MODEL = 'gemini-embedding-2';
export const GENERATION_MODEL = 'gemini-4-hydrogen';
export const EMBEDDING_DIMENSIONS = 768;

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const embeddings: number[][] = [];
  const batchSize = 20;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const response = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: batch,
      config: {
        outputDimensionality: EMBEDDING_DIMENSIONS,
      },
    });

    const batchVectors = response.embeddings ?? [];
    if (batchVectors.length !== batch.length) {
      throw new Error('Embedding service returned mismatched vector count.');
    }

    for (const item of batchVectors) {
      if (!item.values || item.values.length !== EMBEDDING_DIMENSIONS) {
        throw new Error('Invalid embedding vector dimensions received.');
      }
      embeddings.push(item.values);
    }
  }

  return embeddings;
}

export async function embedSingleQuery(query: string): Promise<number[]> {
  const [vector] = await embedTexts([query]);
  return vector;
}

export async function extractPdfPagesWithGemini(
  pdfBuffer: Buffer
): Promise<Array<{ pageNumber: number; text: string }>> {
  const response = await ai.models.generateContent({
    model: GENERATION_MODEL,
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: pdfBuffer.toString('base64'),
          },
        },
        {
          text: 'Extract all readable text, headings, tables, and chart labels from every page of this PDF document in page order. Return structured JSON with each page number and its full extracted text.',
        },
      ],
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          pages: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                pageNumber: { type: Type.INTEGER },
                text: { type: Type.STRING },
              },
              required: ['pageNumber', 'text'],
            },
          },
        },
        required: ['pages'],
      },
    },
  });

  const raw = (response.text ?? '{}').trim();
  const parsed = JSON.parse(raw) as {
    pages?: Array<{ pageNumber?: number; text?: string }>;
  };

  return (parsed.pages ?? [])
    .filter((p) => typeof p.text === 'string' && p.text.trim().length > 0)
    .map((p, idx) => ({
      pageNumber: typeof p.pageNumber === 'number' && p.pageNumber > 0 ? p.pageNumber : idx + 1,
      text: p.text!.trim(),
    }));
}

export async function streamRagAnswer(params: {
  question: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  contextBlocks: string;
}) {
  const systemInstruction = `You are Verity Vault, an enterprise knowledge base assistant.
Answer the user's question accurately using ONLY the provided document excerpts below.
Rules:
1. Cite supporting facts inline using bracketed numbers matching the source headers, such as [1] or [2]. Place citations immediately after the supported claim.
2. If the provided excerpts do not contain enough information to answer the question, explicitly state what is missing rather than fabricating details.
3. Keep answers structured, concise, and clear with Markdown formatting where helpful.`;

  const conversationPrefix = params.history
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  const prompt = [
    conversationPrefix ? `Previous conversation:\n${conversationPrefix}\n` : '',
    `Retrieved Document Excerpts:\n${params.contextBlocks}\n`,
    `Current Question: ${params.question}`,
  ]
    .filter(Boolean)
    .join('\n');

  return ai.models.generateContentStream({
    model: GENERATION_MODEL,
    contents: prompt,
    config: {
      systemInstruction,
    },
  });
}
