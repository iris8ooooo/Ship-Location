import React, { useState } from 'react';
import { GoogleGenAI } from '@google/genai';
import { Loader2, Image as ImageIcon } from 'lucide-react';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export function IconGenerator() {
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const generateIcons = async () => {
    setLoading(true);
    setImages([]);
    try {
      const prompts = [
        "A 3D isometric app icon of a modern commercial ship in a shipyard. Clean, vibrant colors, blue and white theme, glossy 3D render, white background, high quality, UI icon style.",
        "A 3D stereoscopic app icon of a ship's radar or location pin with a cargo ship inside. Modern, sleek, 3D clay render style, blue and orange accents, white background, high resolution.",
        "A 3D stylized app icon of a shipyard crane and a ship. Cute, modern 3D illustration, soft lighting, vibrant colors, white background, perfect for iOS app icon."
      ];

      const newImages: string[] = [];
      for (const prompt of prompts) {
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: prompt,
        });
        
        const parts = response.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          if (part.inlineData) {
            newImages.push(`data:image/png;base64,${part.inlineData.data}`);
            break;
          }
        }
      }
      setImages(newImages);
    } catch (error) {
      console.error("Failed to generate icons:", error);
      alert("Failed to generate icons. Check console.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-20 right-4 z-50 bg-white p-4 rounded-lg shadow-xl border border-gray-200 max-w-sm">
      <h3 className="font-bold mb-2 flex items-center gap-2">
        <ImageIcon className="w-5 h-5" />
        아이콘 시안 생성기
      </h3>
      <p className="text-xs text-gray-500 mb-4">
        AI를 사용하여 3D 입체 형태의 앱 아이콘 시안 3개를 생성합니다.
      </p>
      
      <button 
        onClick={generateIcons}
        disabled={loading}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-md text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        {loading ? '생성 중 (약 10~20초 소요)...' : '아이콘 시안 3개 생성하기'}
      </button>

      {images.length > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          {images.map((img, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <img src={img} alt={`Icon ${i+1}`} className="w-full aspect-square rounded-2xl shadow-sm border border-gray-100" />
              <span className="text-xs font-medium">시안 {i+1}</span>
            </div>
          ))}
        </div>
      )}
      
      {images.length > 0 && (
        <p className="text-xs text-gray-500 mt-3 text-center">
          마음에 드는 시안 번호를 채팅창에 말씀해 주세요!
        </p>
      )}
    </div>
  );
}
