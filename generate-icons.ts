import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function generateIcon(prompt: string, filename: string) {
  console.log(`Generating ${filename}...`);
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: prompt,
    });
    
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        const base64Data = part.inlineData.data;
        fs.writeFileSync(path.join(process.cwd(), 'public', filename), Buffer.from(base64Data, 'base64'));
        console.log(`Saved ${filename}`);
        return;
      }
    }
    console.log(`Failed to find image data for ${filename}`);
  } catch (error) {
    console.error(`Error generating ${filename}:`, error);
  }
}

async function main() {
  await generateIcon(
    "A 3D isometric app icon of a modern commercial ship in a shipyard. Clean, vibrant colors, blue and white theme, glossy 3D render, white background, high quality, UI icon style.",
    "icon1.png"
  );
  await generateIcon(
    "A 3D stereoscopic app icon of a ship's radar or location pin with a cargo ship inside. Modern, sleek, 3D clay render style, blue and orange accents, white background, high resolution.",
    "icon2.png"
  );
  await generateIcon(
    "A 3D stylized app icon of a shipyard crane and a ship. Cute, modern 3D illustration, soft lighting, vibrant colors, white background, perfect for iOS app icon.",
    "icon3.png"
  );
}

main();
