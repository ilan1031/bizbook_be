require("dotenv").config();
const axios = require("axios");

const askGemini = async (prompt) => {
  const apiKey = process.env.GEMINI_API_KEY; // Read from environment

  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY in .env file");
  }

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, // Updated model name and dynamic API key
      {
        contents: [{ parts: [{ text: prompt }] }], // Correctly formatted request body
      },
      {
        headers: { "Content-Type": "application/json" }, // Headers remain the same
      }
    );

    return response.data.candidates[0]?.content ?? "No response from AI"; // Extract the AI response
  } catch (error) {
    console.error("Gemini API Error:", error.response?.data || error.message);
    throw new Error("Failed to fetch AI response");
  }
};

module.exports = askGemini;