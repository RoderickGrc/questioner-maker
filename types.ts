
export interface QuestionData {
  id: string;
  Pregunta: string;
  'Opción correcta 1': string;
  'Opción Correcta 2'?: string | undefined;
  'Opción Correcta 3'?: string | undefined;
  'Opción Incorrecta 1'?: string | undefined;
  'Opción Incorrecta 2'?: string | undefined;
  'Opción Incorrecta 3'?: string | undefined;
  Explicación?: string | undefined;
}

export enum RequestStatus {
  Pending = 'pending',
  Processing = 'processing',
  Completed = 'completed',
  Error = 'error',
}

export interface GenerationRequest {
  id:string;
  prompt: string;
  status: RequestStatus;
  requestFiles?: File[];
  errorDetails?: string;
  jsonCorrectionAttempts?: number; 
  questionsGeneratedCount?: number; // To show how many questions this request produced
}

export const CSV_HEADERS = [
  "Pregunta",
  "Opción correcta 1",
  "Opción Correcta 2",
  "Opción Correcta 3",
  "Opción Incorrecta 1",
  "Opción Incorrecta 2",
  "Opción Incorrecta 3",
  "Explicación",
];

// Helper to map CSV_HEADERS to QuestionData keys
export const CSV_HEADER_TO_QUESTION_DATA_KEY_MAP: Record<string, keyof QuestionData> = {
  "Pregunta": "Pregunta",
  "Opción correcta 1": "Opción correcta 1",
  "Opción Correcta 2": "Opción Correcta 2",
  "Opción Correcta 3": "Opción Correcta 3",
  "Opción Incorrecta 1": "Opción Incorrecta 1",
  "Opción Incorrecta 2": "Opción Incorrecta 2",
  "Opción Incorrecta 3": "Opción Incorrecta 3",
  "Explicación": "Explicación",
};


export interface ProcessEnv {
  API_KEY?: string;
}

export interface GeneralContextFilePreview {
  id: string; // Use a unique ID for React keys, e.g., file.name + file.lastModified
  name: string;
  type: string;
  size: number;
  lastModified: number; // Added to store the original file's lastModified timestamp
  previewUrl?: string; // For images
}

export enum LogType {
  Info = 'info',
  Error = 'error',
  Warning = 'warning',
  GeminiRequest = 'gemini-request',
  GeminiResponse = 'gemini-response',
  GeminiStream = 'gemini-stream',
  FileProcessing = 'file-processing',
  System = 'system',
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  type: LogType;
  message: string;
  details?: any; // Optional, for structured data like prompts or responses
}

export enum QuestionDisplayType {
  OpenAnswer = 'OpenAnswer',
  MultipleCorrect = 'MultipleCorrect',
  SingleCorrect = 'SingleCorrect',
  TrueFalse = 'TrueFalse',
  Unknown = 'Unknown',
  Empty = 'Empty', // Added new type for empty questions
}

export interface QuestionTypeVisualInfo {
  type: QuestionDisplayType;
  icon: JSX.Element;
  label: string;
  colorClass: string;
  description: string;
}


declare global {
  interface Window {
    process?: {
      env: ProcessEnv;
    };
  }
}