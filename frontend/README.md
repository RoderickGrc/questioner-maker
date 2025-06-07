# Gemini Question CSV Generator

This React application uses Google's Gemini API to generate quiz questions in CSV format compatible with **Questioner Base**.

## Setup

1. Copy `.env.example` to `.env` and fill in your Google API key:

```bash
cp .env.example .env
# edit .env and set VITE_GEMINI_API_KEY
```

2. Install dependencies and run the development server:

```bash
npm install
npm run dev
```

## Usage

- Upload context material (PDF, text, images, etc.) in the **Context** section.
- Add multiple request items in the **Request Queue**. Each item can include a prompt and additional files.
- Press **Process** to sequentially send each request to Gemini. Progress is displayed while processing.
- Generated questions are shown in a table. When finished you can **Download CSV**.

The output follows the format required by "Questioner Base".
