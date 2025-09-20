import React, { useState, useEffect } from 'react';

// --- UI Components ---

const Spinner = ({ size = 'h-12 w-12' }) => (
  <div className={`animate-spin rounded-full ${size} border-b-2 border-gray-900`}></div>
);

const ErrorDisplay = ({ message }) => (
  <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg relative" role="alert">
    <strong className="font-bold">Error: </strong>
    <span className="block sm:inline">{message}</span>
  </div>
);


// --- Main App Component ---
const App = () => {
  // --- State Management ---
  const [step, setStep] = useState(1);
  const [articleUrl, setArticleUrl] = useState('');
  const [meme, setMeme] = useState(null);
  const [video, setVideo] = useState({ script: '', generating: false, generated: false });
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // --- API Keys ---
  const [geminiApiKey] = useState('AIzaSyBUwFblzjourQJNnlx85Q9Ss7_k9GbbgSE');
  const [apifyToken] = useState('apify_api_r3hThVPnYb7AlQHvTYGEc9bZbipV0Z3oCCaJ');
  const [minimaxApiKey] = useState('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJHcm91cE5hbWUiOiJMaXogWmhhbmciLCJVc2VyTmFtZSI6IkxpeiBaaGFuZyIsIkFjY291bnQiOiIiLCJTdWJqZWN0SUQiOiIxOTY5MDc3Mzk5NDA0NDIxOTY3IiwiUGhvbmUiOiIiLCJHcm91cElEIjoiMTk2OTA3NzM5OTQwMDIyMzU2NyIsIlBhZ2VOYW1lIjoiIiwiTWFpbCI6ImhlbGxvLmxpei56aGFuZ0BnbWFpbC5jb20iLCJDcmVhdGVUaW1lIjoiMjAyNS0wOS0yMCAwNjo0MDozOSIsIlRva2VuVHlwZSI6MSwiaXNzIjoibWluaW1heCJ9.Jc0MzjZeBy3JB4COlzbyk2SjVXOBqPL9YdMnTGH-FOGeDoeU4uMictq6_KRQT4ADajiAtvrY_3EZ_kXxL1xWvsIdge0RY-pb_qKQxJ2mq4o_aMP-As0TbLDN8ViGmqxNB9hnCAzdRhm0P03fkntRpWg605QUPJcJPYwTV8eTlDgZEjRtEljmUdpdUOXqRgDNgF_8i9k7_vTwOcwCpHVYxu66sFsGnalfv-w6S1nl1oKygjFsiPUWPRl3sawSYKp1_-qGqA_Jtlv-PXbUQm7w7zj0kchjrhUyYDZOAZx5umlGfL0oklTthMSQgb9r09SY8vqHOwMhxNQj-SAWRSgq8g');

  // --- Core API Logic ---

  const fetchWithBackoff = async (url, options = {}, retries = 3, delay = 1000) => {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      if (retries > 0) {
        await new Promise(res => setTimeout(res, delay));
        return fetchWithBackoff(url, options, retries - 1, delay * 2);
      } else {
        console.error("API call failed after multiple retries:", error);
        setErrorMessage("An API call failed. Please check the console for details.");
        setLoading(false);
        throw error;
      }
    }
  };

  const handleUrlSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    if (!articleUrl || !articleUrl.startsWith('http')) {
        setErrorMessage("Please enter a valid URL.");
        return;
    }

    setLoading(true);
    setLoadingMessage('Reading the article...');
    setStep(2);
    setMeme(null);
    setVideo({ script: '', generating: false, generated: false });

    try {
      const runUrl = `https://api.apify.com/v2/acts/apify~web-scraper/runs?token=${apifyToken}`;
      const pageFunction = `
        async function pageFunction(context) {
          const { $, request } = context;
          const h1 = $('h1').first().text().trim();
          const title = $('title').text().trim();
          return { url: request.url, headline: h1 || title, title: title };
        }
      `;
      const runPayload = { startUrls: [{ url: articleUrl }], pageFunction };
      const runObject = await fetchWithBackoff(runUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(runPayload) });
      const { id: runId, defaultDatasetId } = runObject.data;
      if (!runId) throw new Error("Failed to start Apify web scraper.");

      setLoadingMessage('Understanding the news...');
      let runStatus = '';
      const statusUrl = `https://api.apify.com/v2/actor-runs/${runId}?token=${apifyToken}`;
      const startTime = Date.now();
      const timeout = 60000;

      while (runStatus !== 'SUCCEEDED') {
        if (Date.now() - startTime > timeout) throw new Error('Scraping timed out.');
        const statusResponse = await fetchWithBackoff(statusUrl);
        runStatus = statusResponse.data.status;
        if (runStatus === 'FAILED' || runStatus === 'ABORTED') throw new Error('Apify failed to scrape the article.');
        await new Promise(res => setTimeout(res, 2000));
      }

      const resultsUrl = `https://api.apify.com/v2/datasets/${defaultDatasetId}/items?token=${apifyToken}`;
      const resultsData = await fetchWithBackoff(resultsUrl);
      const articleData = resultsData?.[0];
      const articleTitle = articleData?.headline;

      if (!articleTitle || articleTitle.toLowerCase().includes("404") || articleTitle.toLowerCase().includes("not found")) {
        throw new Error("Could not extract a valid title from the URL.");
      }

      setLoadingMessage('Getting meme inspiration...');
      const memeData = await generateSingleMeme(articleTitle);
      const finalMeme = { title: articleData.title, url: articleUrl, ...memeData };
      setMeme(finalMeme);
      setStep(3);
      setLoading(false);

      // Automatically start video generation after meme is done
      generateVideo(finalMeme.title, finalMeme.text);

    } catch (error) {
      console.warn("Initial scrape failed, attempting fallback search:", error.message);
      await handleSearchFallback(articleUrl);
    }
  };

  const handleSearchFallback = async (failedUrl) => {
    try {
        setLoadingMessage('Original URL failed. Searching for a similar article...');
        let keywords = new URL(failedUrl).pathname.split('/').pop().replace(/\.html|\.htm/g, '').replace(/[-_]/g, ' ');
        if (!keywords) throw new Error("Could not extract keywords from URL.");

        const textApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${geminiApiKey}`;
        const prompt = `You are a creative news writer. Based on the keywords: "${keywords}", create a realistic, engaging news headline that could be from a recent article. Make it sound professional and current. Return ONLY the headline as a string, nothing else.`;
        const payload = { contents: [{ parts: [{ text: prompt }] }] };
        const result = await fetchWithBackoff(textApiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const realHeadline = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (!realHeadline || realHeadline.length < 10) throw new Error("Fallback search could not find a relevant article.");

        setLoadingMessage('Found an alternative! Generating meme...');
        const memeData = await generateSingleMeme(realHeadline);
        const finalMeme = { title: realHeadline, url: failedUrl, fallbackUsed: true, ...memeData };
        setMeme(finalMeme);
        setStep(3);
        setLoading(false);

        // Automatically start video generation after meme is done
        generateVideo(finalMeme.title, finalMeme.text);

    } catch (fallbackError) {
        console.error('Fallback search failed:', fallbackError);
        console.error('Fallback error details:', {
            url: failedUrl,
            keywords: keywords,
            error: fallbackError.message
        });
        setErrorMessage(`Fallback search failed: ${fallbackError.message}. This could be due to API issues or invalid API keys. Please try a different URL or check the console for more details.`);
        setStep(1);
        setLoading(false);
    }
  };
  
  const generateSingleMeme = async (headlineTitle) => {
      // Try to generate image with Imagen API, fallback to placeholder if it fails
      let imageUrl;
      try {
          const imageApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${geminiApiKey}`;
          const imagePrompt = `A high-quality, funny, and visually appealing meme image representing the concept of this news headline: "${headlineTitle}". Style: modern, shareable, clear, and impactful. IMPORTANT: Do not include any text, words, or letters in the image itself.`;
          const imagePayload = { instances: [{ prompt: imagePrompt }], parameters: { "sampleCount": 1 } };
          const imageResult = await fetchWithBackoff(imageApiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(imagePayload) });
          const base64Data = imageResult.predictions?.[0]?.bytesBase64Encoded;
          if (!base64Data) throw new Error("Image generation failed.");
          imageUrl = `data:image/png;base64,${base64Data}`;
      } catch (imageError) {
          console.warn('Image generation failed, using placeholder:', imageError.message);
          // Use a simple placeholder image
          imageUrl = `https://via.placeholder.com/400x300/2563eb/ffffff?text=${encodeURIComponent('Meme Image')}`;
      }

      const textApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${geminiApiKey}`;
      const textPrompt = `You are a witty news commentator. For the headline "${headlineTitle}", generate a very brief (one short sentence max), funny meme caption that captures the essence of the news.`;
      const textPayload = { contents: [{ parts: [{ text: textPrompt }] }] };
      const textResult = await fetchWithBackoff(textApiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(textPayload) });
      const text = textResult.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("Text generation failed.");

      return { imageUrl, text: text.trim() };
  };

  const generateVideo = async (headline, memeText) => {
    setVideo(prev => ({ ...prev, generating: true }));

    // 1. Generate the video script using Gemini
    const scriptApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${geminiApiKey}`;
    const scriptPrompt = `You are an AI news moderator for "Meme Street Journal". Write a concise, engaging 30-second video script about the news headline: "${headline}". First, briefly explain the news. Then, present our witty meme about it, which says: "${memeText}". End with a quick sign-off. The tone should be like a modern news explainer on TikTok or Reels.`;
    const scriptPayload = { contents: [{ parts: [{ text: scriptPrompt }] }] };
    
    try {
        const scriptResult = await fetchWithBackoff(scriptApiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(scriptPayload) });
        const script = scriptResult.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!script) throw new Error("Video script generation failed.");
        setVideo(prev => ({ ...prev, script }));

        // 2. Simulate the call to Minimax Video API
        console.log("--- SIMULATING MINIMAX VIDEO API CALL ---");
        console.log("Authorization Token:", minimaxApiKey);
        console.log("Payload:", {
          script: script,
          headline: headline,
          meme_image: meme?.imageUrl, // This would be the base64 data of the meme image
          presenter: "ai_moderator_v2"
        });
        
        // Simulate video processing time
        await new Promise(res => setTimeout(res, 3000)); 

        setVideo(prev => ({ ...prev, generating: false, generated: true }));

    } catch (error) {
        console.error("Video generation process failed:", error);
        setVideo({ script: "Could not generate video script.", generating: false, generated: true });
    }
  };

  // --- Render Functions ---

  const renderHeader = () => (
    <div className="text-center mb-10">
      <h1 className="text-5xl font-bold text-gray-800">Meme Street Journal</h1>
      <p className="text-lg text-gray-500 mt-2">Your daily dose of news, memefied.</p>
    </div>
  );

  const renderStepContent = () => {
    if (loading) {
      return (
        <div className="text-center flex flex-col items-center justify-center h-64">
          <Spinner />
          <p className="text-xl font-semibold text-gray-700 mt-4">{loadingMessage}</p>
        </div>
      );
    }
    
    switch (step) {
      case 1:
        return (
          <div className="bg-white p-8 rounded-xl shadow-lg text-center">
            <h2 className="text-2xl font-bold mb-6 text-gray-800">Enter a News Article URL to Memefy</h2>
            {errorMessage && <ErrorDisplay message={errorMessage} />}
            <form onSubmit={handleUrlSubmit} className="mt-4">
              <input
                type="url"
                value={articleUrl}
                onChange={(e) => setArticleUrl(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                placeholder="https://www.cnbc.com/2024/09/12/apple-event-iphone-16-pro-airpods-4.html"
              />
              <button type="submit" className="w-full mt-4 bg-blue-600 text-white py-3 rounded-lg font-semibold text-lg hover:bg-blue-700 transition-all transform hover:scale-105 disabled:bg-gray-400" disabled={loading}>
                Memefy It!
              </button>
            </form>
          </div>
        );
      case 3:
        if (!meme) return null;
        return (
          <div>
            <div className="bg-white rounded-xl shadow-lg overflow-hidden max-w-2xl mx-auto">
              <div className="p-4 border-b">
                 {meme.fallbackUsed && (
                    <p className="text-sm text-orange-600 bg-orange-100 p-2 rounded-md mb-3">
                        We couldn't use your original URL, so we found a similar article to memefy!
                    </p>
                 )}
                 <h3 className="font-semibold text-gray-800">{meme.title}</h3>
                 <a href={meme.url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-500 hover:underline truncate block">{meme.url}</a>
              </div>
              <div className="p-4">
                  <div className="max-w-md mx-auto bg-black text-white rounded-lg">
                    <img src={meme.imageUrl} alt={meme.title} className="w-full h-auto object-contain" />
                    <p className="p-4 text-center font-semibold text-lg">{meme.text}</p>
                  </div>
              </div>
              <div className="p-4 border-t">
                  <h3 className="text-xl font-bold text-center text-gray-800">AI Moderator Video Summary</h3>
                  {video.generating ? (
                    <div className="flex flex-col items-center justify-center h-40">
                        <Spinner />
                        <p className="mt-2 text-gray-600">Generating video script...</p>
                    </div>
                  ) : video.generated ? (
                    <div className="mt-4 bg-gray-800 text-white rounded-lg p-4 font-mono text-sm">
                        <p className="text-yellow-400 mb-2">// SIMULATED VIDEO PLAYER</p>
                        <p className="whitespace-pre-wrap">{video.script}</p>
                    </div>
                  ) : null}
              </div>
            </div>
            <button onClick={() => {setStep(1); setArticleUrl('');}} className="block mx-auto mt-8 bg-gray-700 text-white py-3 px-8 rounded-lg font-semibold hover:bg-gray-800 transition-colors">
                Memefy Another Article
            </button>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans p-4 sm:p-8">
      <div className="max-w-4xl mx-auto">
        {renderHeader()}
        {renderStepContent()}
      </div>
    </div>
  );
};

export default App;

