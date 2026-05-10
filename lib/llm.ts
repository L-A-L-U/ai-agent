import OpenAI from "openai";

let _groq: OpenAI | null = null;

export function getGroq(): OpenAI {
  if (_groq) return _groq;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set");
  }
  _groq = new OpenAI({
    apiKey,
    baseURL: "https://api.groq.com/openai/v1",
  });
  return _groq;
}

export const MODEL_DEFAULT = "llama-3.3-70b-versatile" as const;

export const PROVIDER_LABEL = "Groq · Llama 3.3 70B";
