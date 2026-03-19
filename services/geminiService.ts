import { GoogleGenAI } from "@google/genai";

// Fix: Per Gemini guidelines, initialize GoogleGenAI with the API key from environment variables directly.
// The API key is assumed to be pre-configured and available as process.env.API_KEY.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const model = 'gemini-2.5-flash';

const systemInstruction = `Eres un asistente de IA amigable y servicial para la clínica de medicina estética de la "Dra. María Fernanda Ubau".
Tu función es proporcionar información general y básica sobre tratamientos estéticos comunes.
No proporciones consejos médicos, precios ni agendes citas.
Si se te solicita consejo médico, declina amablemente y recomienda consultar con la doctora en la clínica.
Mantén tus respuestas concisas y fáciles de entender.
Los tratamientos conocidos son: Neuromoduladores (Botox), Relleno de Labios, Bioestimuladores de Colágeno, Armonización Facial, Rellenos Dérmicos y Consultas Estéticas.
El número de teléfono para agendar citas es +505 8837-4947. La clínica está en Chinandega.
`;


export const getGeminiResponse = async (prompt: string): Promise<string> => {
  try {
    const response = await ai.models.generateContent({
        model: model,
        contents: prompt,
        config: {
            systemInstruction: systemInstruction,
            temperature: 0.7,
            topP: 1,
            topK: 32,
        }
    });
    
    return response.text;
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    return "Lo siento, estoy teniendo problemas para responder en este momento. Por favor, inténtalo de nuevo en un momento.";
  }
};