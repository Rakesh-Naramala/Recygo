import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

let ai = null;
const apiKey = process.env.GEMINI_API_KEY;
if (apiKey && apiKey.trim() && !apiKey.includes('your_actual') && !apiKey.includes('your_gemini')) {
  try {
    ai = new GoogleGenAI({ apiKey });
  } catch (err) {
    console.warn('⚠️ Gemini AI SDK init failed, running with simulation fallback:', err.message);
  }
}

/**
 * 1. AI Vision: Classify scrap image and auto-fill listing
 */
export async function classifyScrapImage(imageBase64, mimeType = 'image/jpeg') {
  const prompt = `
    Analyze this photo of household or industrial scrap/waste.
    Respond ONLY with valid JSON (no markdown, no code fences) with these exact keys:
    {
      "category": "one of: cardboard, pet-plastic, aluminum-scrap, e-waste, iron-scrap, other",
      "is_recyclable": true or false,
      "estimated_weight_kg": number,
      "confidence_score": number between 0.0 and 1.0,
      "cleanliness_status": "short description",
      "suggested_title": "short descriptive title"
    }
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { data: imageBase64, mimeType } },
          ],
        },
      ],
    });

    const text = response.text.replace(/```json|```/g, '').trim();
    return JSON.parse(text);
  } catch (error) {
    console.error('AI Classification Error:', error.message);
    // Safe mock fallback if API key is not yet set
    return {
      category: 'cardboard',
      is_recyclable: true,
      estimated_weight_kg: 5.0,
      confidence_score: 0.85,
      cleanliness_status: 'dry and bundled',
      suggested_title: 'Corrugated Cardboard Boxes (~5kg)',
    };
  }
}

/**
 * 2. AI OCR: Verify physical weighing scale screen at doorstep
 */
export async function verifyScaleReading(imageBase64, manualGrossWeight) {
  const prompt = `
    Analyze this photo of scrap placed on a weighing scale.
    Read the numeric weight shown on the digital or analog scale display.
    If the display is obscured, analog needle-based, or unreadable due to glare, set is_readable to false.
    Respond ONLY with valid JSON (no markdown) with these exact keys:
    {
      "scale_reading": number or null,
      "is_readable": true or false,
      "display_type": "digital or analog or unknown",
      "confidence_score": number between 0 and 1
    }
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { data: imageBase64, mimeType: 'image/jpeg' } },
          ],
        },
      ],
    });

    const text = response.text.replace(/```json|```/g, '').trim();
    const result = JSON.parse(text);

    if (result.is_readable && result.scale_reading != null) {
      const difference = Math.abs(result.scale_reading - manualGrossWeight);
      const isMismatched = difference > 0.5;
      return {
        status: isMismatched ? 'disputed' : 'verified',
        ai_weight: result.scale_reading,
        needs_human_audit: isMismatched,
        notes: isMismatched
          ? `Scale shows ${result.scale_reading}kg but entered ${manualGrossWeight}kg`
          : 'Matched display reading',
      };
    }

    return {
      status: 'unreadable_fallback',
      ai_weight: null,
      needs_human_audit: true,
      notes: 'Glare/analog scale detected. Proceeded with manual entry and seller OTP.',
    };
  } catch (err) {
    return {
      status: 'unreadable_fallback',
      ai_weight: null,
      needs_human_audit: true,
      notes: 'OCR service offline. Proceeded with manual weight and seller OTP.',
    };
  }
}
