import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const cache = new Map<string, any>();

export async function extractSafeBaseIngredients(meals: string[]): Promise<string[]> {
  const cacheKey = 'base_' + meals.join(',');
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Extract the fundamental base ingredients from these meals. Return them as a list of simple, lowercase strings. Meals: ${meals.join(', ')}`,
    config: {
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        description: "List of base ingredient names in lowercase",
        items: {
          type: Type.STRING
        }
      }
    }
  });

  try {
    const data = JSON.parse(response.text || "[]");
    cache.set(cacheKey, data);
    return data;
  } catch (e) {
    console.error("Failed to parse gemini response", e);
    return [];
  }
}

export interface AnalysisResult {
  standard_name: string;
  status: 'red' | 'yellow' | 'blue' | 'green';
  reason: string;
}

export interface ScanAnalysis {
  foodName?: string;
  results: AnalysisResult[];
}

export async function analyzeFoodText({
  text, 
  allergies, 
  safeIngredients
}: {
  text: string, 
  allergies: string[], 
  safeIngredients: string[]
}): Promise<ScanAnalysis> {
  const cacheKey = 'text_' + text + '_' + allergies.join(',');
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const promptString = `
    You are an expert food safety analyzer. Analyze the provided ingredient list or food name.
    
    User Profile:
    - Known Clinical Allergies: ${allergies.length > 0 ? allergies.join(', ') : 'None'}
    - Baseline Safe Ingredients: ${safeIngredients.length > 0 ? safeIngredients.slice(0, 100).join(', ') + (safeIngredients.length > 100 ? ' and more' : '') : 'None'}

    Identify the ingredients or food items in the text. For each, determine a safety status based on this strict rubric:
    "red": It is a known clinical allergen for this user, or contains it.
    "yellow": It is a common sensitivity or highly processed ingredient that might cause issues.
    "green": It is in the user's safe baseline, or is a generally safe whole food.
    "blue": It is novel, untested, or unknown.

    If the text appears to be a meal or dish name (like "Onde Onde", "Lasagna", "Big Mac"), identify its foodName.

    Return an object containing the optional 'foodName' and the array of identified ingredients with their rigorous assessments.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview", 
    contents: { parts: [{ text: text + "\n\n" + promptString }] },
    config: {
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          foodName: {
            type: Type.STRING,
            description: "The name of the dish or product identified, if applicable. Leave null if it's just raw ingredients."
          },
          results: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                standard_name: {
                  type: Type.STRING,
                  description: "Standardized ingredient or food name in lowercase"
                },
                status: {
                  type: Type.STRING,
                  description: "red, yellow, green, or blue strictly based on the rubric",
                },
                reason: {
                  type: Type.STRING,
                  description: "Very brief (1 sentence max) safety reasoning addressing the user's profile"
                }
              },
              required: ["standard_name", "status", "reason"]
            }
          }
        },
        required: ["results"]
      }
    }
  });

  try {
    const data = JSON.parse(response.text || "{}");
    const result = {
      foodName: data.foodName || undefined,
      results: data.results || []
    };
    cache.set(cacheKey, result);
    return result;
  } catch (e) {
    console.error("Failed to parse gemini response", e);
    return { results: [] };
  }
}

export async function chatWithAssistant(
  history: {role: 'user'|'model', parts: [{text: string}]}[],
  context?: {
    allergies: string[];
    safeMeals: string[];
    allergenSideEffects: Record<string, string[]>;
    recentScans: string[];
  }
): Promise<string> {
  const profileContext = context ? `

USER PROFILE CONTEXT:
Clinical Allergies: ${context.allergies.join(', ') || 'None'}
Safe Plates: ${context.safeMeals.slice(0, 10).join(', ') || 'None'}
Side Effects Logged: ${JSON.stringify(context.allergenSideEffects)}
Recent Scan History: ${context.recentScans.slice(0, 5).join(' | ') || 'None'}

Use this information to provide personalized, accurate advice. Do not mention that you were just provided this data. Act like it's naturally accessible to you.` : '';

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: history,
    config: {
      temperature: 0.7,
      systemInstruction: "You are a helpful dietary and food safety assistant for the SureBite app. Answer questions concisely based on the user's personal dietary profile." + profileContext,
    }
  });
  return response.text || "";
}

export async function analyzeFoodImage({
  base64Data,
  mimeType, 
  allergies, 
  safeIngredients
}: {
  base64Data: string, 
  mimeType: string, 
  allergies: string[], 
  safeIngredients: string[]
}): Promise<ScanAnalysis> {
  // basic cache for images (assuming length and partial data combo might be good enough, or just skip caching for images for safety)
  
  const promptString = `
    You are an expert food safety analyzer. Analyze the provided image, which is either a food product, an ingredients list, or a raw food item.
    
    User Profile:
    - Known Clinical Allergies: ${allergies.length > 0 ? allergies.join(', ') : 'None'}
    - Baseline Safe Ingredients: ${safeIngredients.length > 0 ? safeIngredients.slice(0, 100).join(', ') + (safeIngredients.length > 100 ? ' and more' : '') : 'None'}

    Identify the ingredients or food items in the image. For each, determine a safety status based on this strict rubric:
    "red": It is a known clinical allergen for this user, or contains it.
    "yellow": It is a common sensitivity or highly processed ingredient that might cause issues.
    "green": It is in the user's safe baseline, or is a generally safe whole food.
    "blue": It is novel, untested, or unknown.

    If the image appears to be a meal or dish name (like "Onde Onde", "Lasagna", "Big Mac"), identify its foodName.

    Return an object containing the optional 'foodName' and the array of identified ingredients with their rigorous assessments.
  `;

  const imagePart = {
    inlineData: {
      mimeType,
      data: base64Data,
    },
  };

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview", 
    contents: { parts: [imagePart, { text: promptString }] },
    config: {
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          foodName: {
            type: Type.STRING,
            description: "The name of the dish or product identified, if applicable. Leave null if it's just raw ingredients."
          },
          results: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                standard_name: {
                  type: Type.STRING,
                  description: "Standardized ingredient or food name in lowercase"
                },
                status: {
                  type: Type.STRING,
                  description: "red, yellow, green, or blue strictly based on the rubric",
                },
                reason: {
                  type: Type.STRING,
                  description: "Very brief (1 sentence max) safety reasoning addressing the user's profile"
                }
              },
              required: ["standard_name", "status", "reason"]
            }
          }
        },
        required: ["results"]
      }
    }
  });

  try {
    const data = JSON.parse(response.text || "{}");
    return {
      foodName: data.foodName || undefined,
      results: data.results || []
    };
  } catch (e) {
    console.error("Failed to parse gemini response", e);
    return { results: [] };
  }
}

