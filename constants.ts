
export const GEMINI_MODEL_FLASH = 'gemini-2.5-flash';
export const GEMINI_MODEL_PRO = 'gemini-2.5-pro';
export const GEMINI_MODEL_FLASH_LITE = 'gemini-2.5-flash-lite';

export const APP_TITLE = "Generador de Preguntas para Haikú";

export const CSV_FILENAME = "preguntas_questioner_base.csv";
export const JSON_FILENAME = "preguntas_questioner_base.json";
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

export const LOCAL_STORAGE_API_KEY = 'geminiUserApiKey';
export const LOCAL_STORAGE_CLOUDINARY_CLOUD_NAME = 'cloudinaryCloudName';
export const LOCAL_STORAGE_CLOUDINARY_UPLOAD_PRESET = 'cloudinaryUploadPreset';
export const LOCAL_STORAGE_CLOUDINARY_AUTO_UPLOAD = 'cloudinaryAutoUpload';