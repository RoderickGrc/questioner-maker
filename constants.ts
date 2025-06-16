
export const GEMINI_MODEL_TEXT = 'gemini-2.5-flash-preview-04-17';
// export const GEMINI_MODEL_IMAGE_GEN = 'imagen-3.0-generate-002'; // Not used in this app

export const APP_TITLE = "Generador CSV de Preguntas para Questioner Base";

export const CSV_FILENAME = "preguntas_questioner_base.csv";
export const REWRITE_QUESTIONS_FILENAME = "questions_to_rewrite.json";

export const MAX_OVERALL_REQUEST_ATTEMPTS = 2; // Max overall attempts for a single request (e.g. for network errors)
export const MAX_JSON_CORRECTION_ATTEMPTS = 5; // Max attempts to ask Gemini to correct JSON parsing/structure errors

export const LOG_TIMESTAMP_FORMAT: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
};

export const ANIMATION_DEBOUNCE_TIME = 2500; // ms for "Pregunta generada" animation