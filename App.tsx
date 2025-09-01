import React, { useState, useCallback, useEffect, useRef } from 'react';
import { QuestionData, GenerationRequest, RequestStatus, CSV_HEADERS, GeneralContextFilePreview, LogEntry, LogType, CSV_HEADER_TO_QUESTION_DATA_KEY_MAP, QuestionDisplayType, QuestionTypeVisualInfo, ThinkingIntensity } from './types';
import { APP_TITLE, MAX_OVERALL_REQUEST_ATTEMPTS, LOG_TIMESTAMP_FORMAT, ANIMATION_DEBOUNCE_TIME, REWRITE_QUESTIONS_FILENAME } from './constants';
import { generateQuestionsFromGemini, generateCollectionTitleFromGemini, generateMetadataFromGemini } from './services/geminiService';
import { generateCsvString, downloadCsvFile, parseCsvLineRobust, generateJsonString, downloadJsonFile, buildExportFilename } from './utils/csvHelper';
import EditableCell from './components/EditableCell';
import { 
    PlusIcon, TrashIcon, DownloadIcon, ProcessIcon, CheckCircleIcon, XCircleIcon, ClockIcon, 
    ProcessingIcon as SpinnerIcon, PaperClipIcon, FileTextIcon, ListBulletIcon, ChevronDownIcon, 
    ChevronUpIcon, DocumentPlusIcon, AcademicCapIcon, PencilIcon, CogIcon, XMarkIcon,
    TextLinesIcon, CheckListIcon, CircleDotIcon, ArrowsRightLeftIcon, QuestionMarkCircleIcon, SparklesIcon,
    MinusCircleIcon, BrainIcon
} from './components/icons';

const LOCAL_STORAGE_API_KEY = 'geminiUserApiKey';

// Helper function to check if a field is empty or undefined
const isFieldEmpty = (value?: string): boolean => value === undefined || value === null || value.trim() === '';

// Function to determine question type and get visual info
const getQuestionTypeInfo = (question: QuestionData): QuestionTypeVisualInfo => {
  const p = question.Pregunta;
  const c1 = question['Opción correcta 1'];
  const c2 = question['Opción Correcta 2'];
  const c3 = question['Opción Correcta 3'];
  const i1 = question['Opción Incorrecta 1'];
  const i2 = question['Opción Incorrecta 2'];
  const i3 = question['Opción Incorrecta 3'];

  const hasC1 = !isFieldEmpty(c1);
  const hasC2 = !isFieldEmpty(c2);
  const hasC3 = !isFieldEmpty(c3);
  const hasI1 = !isFieldEmpty(i1);
  const hasI2 = !isFieldEmpty(i2);
  const hasI3 = !isFieldEmpty(i3);

  const incorrectOptionsFilled = [hasI1, hasI2, hasI3].filter(Boolean).length;

  // 0. Empty Question (Highest priority)
  if (isFieldEmpty(p)) {
    return {
      type: QuestionDisplayType.Empty,
      icon: <MinusCircleIcon className="w-5 h-5 text-slate-400" />,
      label: "Vacía",
      colorClass: "text-slate-400",
      description: "Pregunta Vacía: El campo 'Pregunta' está vacío. Estas preguntas serán ignoradas al guardar el CSV."
    };
  }

  // 1. Open Answer
  if (hasC1 && isFieldEmpty(c2) && isFieldEmpty(c3) && isFieldEmpty(i1) && isFieldEmpty(i2) && isFieldEmpty(i3)) {
    return {
      type: QuestionDisplayType.OpenAnswer,
      icon: <TextLinesIcon className="w-5 h-5 text-sky-400" />,
      label: "Abierta",
      colorClass: "text-sky-400",
      description: "Respuesta Abierta: Solo 'Opción correcta 1' tiene valor. Todas las demás opciones deben estar vacías."
    };
  }

  // 2. Flashcard
  if (hasC2 && isFieldEmpty(c1) && isFieldEmpty(c3) && isFieldEmpty(i1) && isFieldEmpty(i2) && isFieldEmpty(i3)) {
    return {
      type: QuestionDisplayType.Flashcard,
      icon: <AcademicCapIcon className="w-5 h-5 text-cyan-400" />,
      label: "Flashcard",
      colorClass: "text-cyan-400",
      description: "Flashcard: Solo 'Opción Correcta 2' tiene valor. Ideal para respuestas largas de desarrollo o conceptos. El resto de opciones debe estar vacío."
    };
  }

  // 3. True/False
  if (hasC1 && hasI1 && isFieldEmpty(c2) && isFieldEmpty(c3) && isFieldEmpty(i2) && isFieldEmpty(i3)) {
    return {
      type: QuestionDisplayType.TrueFalse,
      icon: <ArrowsRightLeftIcon className="w-5 h-5 text-lime-400" />,
      label: "V/F",
      colorClass: "text-lime-400",
      description: "Verdadero/Falso: 'Opción correcta 1' y 'Opción Incorrecta 1' tienen valor. Las demás opciones deben estar vacías."
    };
  }

  // 4. Multiple Correct
  if (hasC1 && (hasC2 || hasC3) && incorrectOptionsFilled >= 1) {
    return {
      type: QuestionDisplayType.MultipleCorrect,
      icon: <CheckListIcon className="w-5 h-5 text-amber-400" />,
      label: "Múltiple",
      colorClass: "text-amber-400",
      description: "Opción Múltiple (Varias Correctas): 'Opción correcta 1' y al menos una de 'Opción Correcta 2/3' tienen valor. Mínimo 1 incorrecta."
    };
  }

  // 5. Single Correct
  if (hasC1 && isFieldEmpty(c2) && isFieldEmpty(c3) && incorrectOptionsFilled >= 2) {
    return {
      type: QuestionDisplayType.SingleCorrect,
      icon: <CircleDotIcon className="w-5 h-5 text-fuchsia-400" />,
      label: "Única",
      colorClass: "text-fuchsia-400",
      description: "Selección Única: Solo 'Opción correcta 1' tiene valor. Mínimo 2 opciones incorrectas."
    };
  }
  
  return {
    type: QuestionDisplayType.Unknown,
    icon: <QuestionMarkCircleIcon className="w-5 h-5 text-red-500" />, // Changed color to red for more emphasis
    label: "Desc.",
    colorClass: "text-red-500",
    description: "Tipo Desconocido: La estructura de la pregunta no coincide con los tipos definidos. Esta pregunta NO se guardará en el CSV hasta que se corrija."
  };
};


// New sub-component for displaying request status details
const RequestStatusDisplay: React.FC<{ req: GenerationRequest }> = ({ req }) => {
  const elements: JSX.Element[] = [];

  if (req.status === RequestStatus.Completed && req.questionsGeneratedCount !== undefined) {
    let text = `${req.questionsGeneratedCount} pregunta(s) generada(s).`;
    if (req.jsonCorrectionAttempts && req.jsonCorrectionAttempts > 0) {
      text += ` (${req.jsonCorrectionAttempts} correcciones JSON)`;
    }
    elements.push(<p key="completed" className="text-xs text-green-400 mt-1">{text}</p>);
  } else if (req.status === RequestStatus.Error && req.errorDetails) {
    elements.push(
      <p key="error" className="text-xs text-red-400 mt-1" title={req.errorDetails}>
        Error: {req.errorDetails.substring(0, 150)}{req.errorDetails.length > 150 ? '...' : ''}
      </p>
    );
    // If there were correction attempts leading to this error, display them as a separate line
    if (req.jsonCorrectionAttempts && req.jsonCorrectionAttempts > 0) {
      elements.push(
        <p key="error-corrections" className="text-xs mt-1 text-yellow-400">
          Falló tras {req.jsonCorrectionAttempts} correcciones JSON de Gemini.
        </p>
      );
    }
  } else if (req.jsonCorrectionAttempts && req.jsonCorrectionAttempts > 0 && req.status === RequestStatus.Processing) {
    // Display if processing and there were prior correction attempts (e.g. retrying after JSON parse error)
     elements.push(
        <p key="processing-corrections" className="text-xs mt-1 text-blue-400">
            Con {req.jsonCorrectionAttempts} correcciones JSON de Gemini.
        </p>
    );
  }
  
  if (elements.length === 0) {
    return null; // Render nothing if no specific status message applies
  }
  return <>{elements}</>; // Use Fragment to return one or more <p> elements
};


const App: React.FC = () => {
  const [generalContextText, setGeneralContextText] = useState<string>('');
  const [generalContextFiles, setGeneralContextFiles] = useState<File[]>([]);
  const [generalContextFilePreviews, setGeneralContextFilePreviews] = useState<GeneralContextFilePreview[]>([]);
  const generalFilePickerRef = useRef<HTMLInputElement>(null);
  const filePickerRef = useRef<HTMLInputElement>(null);
  
  const [requests, setRequests] = useState<GenerationRequest[]>([]);
  const [newRequestPrompt, setNewRequestPrompt] = useState<string>('');
  const [newRequestFiles, setNewRequestFiles] = useState<File[]>([]);
  const [newRequestFilePreviews, setNewRequestFilePreviews] = useState<GeneralContextFilePreview[]>([]);
  const requestFilePickerRef = useRef<HTMLInputElement>(null);
  const newRequestAreaRef = useRef<HTMLDivElement>(null); 
  
  const [generatedQuestions, setGeneratedQuestions] = useState<QuestionData[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [overallProgress, setOverallProgress] = useState<number>(0);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState<boolean>(false);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const [geminiLiveThought, setGeminiLiveThought] = useState<string>('');
  const [showGeminiStreamOutput, setShowGeminiStreamOutput] = useState<boolean>(false); 
  
  const [currentAnimatedPreviewText, setCurrentAnimatedPreviewText] = useState<string | null>(null);
  const animatedPreviewClearTimeoutRef = useRef<number | null>(null);
  const currentRawStreamRef = useRef<string>(''); 

  const geminiThoughtsContainerRef = useRef<HTMLDivElement>(null);
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(null);

  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
  const [userApiKeyInput, setUserApiKeyInput] = useState<string>(''); 
  const [currentStoredUserApiKey, setCurrentStoredUserApiKey] = useState<string | null>(null);

  // State for row selection
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<Set<string>>(new Set());
  const [lastSelectedRowId, setLastSelectedRowId] = useState<string | null>(null);

  // State for Collection Metadata
  const [collectionTitle, setCollectionTitle] = useState<string>('');
  const [asignatura, setAsignatura] = useState<string>('');
  const [categoria, setCategoria] = useState<string>('');
  const [descripcion, setDescripcion] = useState<string>('');
  const [isGeneratingMetadata, setIsGeneratingMetadata] = useState<boolean>(false);
  const [isMetadataExpanded, setIsMetadataExpanded] = useState<boolean>(true);


  // State for Save dropdown menu
  const [isSaveMenuOpen, setIsSaveMenuOpen] = useState(false);
  const saveMenuRef = useRef<HTMLDivElement>(null);
  
  const [thinkingIntensity, setThinkingIntensity] = useState<ThinkingIntensity>(ThinkingIntensity.High);


  const addLogEntry = useCallback((type: LogType, message: string, details?: any) => {
    setLogEntries(prev => [...prev, { id: `log-${Date.now()}-${Math.random().toString(36).substring(7)}`, timestamp: new Date(), type, message, details }]);
  }, []);

  useEffect(() => {
    const storedKey = localStorage.getItem(LOCAL_STORAGE_API_KEY);
    setCurrentStoredUserApiKey(storedKey);
    setUserApiKeyInput(storedKey || ''); 
    if (storedKey) {
        addLogEntry(LogType.Info, "Clave API de usuario cargada desde localStorage.");
    } else {
        addLogEntry(LogType.Info, "No se encontró clave API de usuario en localStorage, se usará la del entorno si está disponible.");
    }

    addLogEntry(LogType.System, `Aplicación iniciada.`);
    if (!process.env.API_KEY && !storedKey) {
      const errorMsg = "ADVERTENCIA: API_KEY no está configurada en el entorno y no se ha proporcionado una clave local. La aplicación podría no funcionar.";
      setGlobalError(errorMsg); 
      addLogEntry(LogType.Warning, errorMsg);
    } else if (process.env.API_KEY && !storedKey) {
      addLogEntry(LogType.Info, "API_KEY del entorno está disponible.");
    }
  }, [addLogEntry]);


  useEffect(() => {
    if (showLogs && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logEntries, showLogs]);
  
  useEffect(() => {
    if (showGeminiStreamOutput && geminiThoughtsContainerRef.current) {
        geminiThoughtsContainerRef.current.scrollTop = geminiThoughtsContainerRef.current.scrollHeight;
    }
  }, [geminiLiveThought, showGeminiStreamOutput]);

  // Effect to close save menu on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (saveMenuRef.current && !saveMenuRef.current.contains(event.target as Node)) {
        setIsSaveMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);


  useEffect(() => {
    const newPreviews: GeneralContextFilePreview[] = [];
    generalContextFiles.forEach(file => {
      const id = `${file.name}-${file.lastModified}-${Math.random().toString(36).substring(2,7)}`;
      const preview: GeneralContextFilePreview = {
        id,
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
      };
      if (file.type.startsWith('image/')) {
        preview.previewUrl = URL.createObjectURL(file);
      }
      newPreviews.push(preview);
    });
    setGeneralContextFilePreviews(newPreviews);

    return () => {
      newPreviews.forEach(p => {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      });
    };
  }, [generalContextFiles]);

  useEffect(() => {
    const previews: GeneralContextFilePreview[] = [];
    newRequestFiles.forEach(file => {
      const id = `${file.name}-${file.lastModified}-${file.size}-${Math.random().toString(36).substring(2,7)}`; 
      const preview: GeneralContextFilePreview = {
        id,
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
      };
      if (file.type.startsWith('image/')) {
        preview.previewUrl = URL.createObjectURL(file);
      }
      previews.push(preview);
    });
    setNewRequestFilePreviews(previews);

    return () => {
      previews.forEach(p => {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      });
    };
  }, [newRequestFiles]);

  useEffect(() => {
    const targetDiv = newRequestAreaRef.current;
    if (!targetDiv) return;

    const handlePaste = (event: ClipboardEvent) => {
      if (isProcessing) return;

      const items = event.clipboardData?.items;
      if (!items) return;

      let imagePasted = false;
      const pastedFiles: File[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            const extension = file.name.split('.').pop() || file.type.split('/')[1] || 'png';
            const newFileName = `pasted-image-${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${extension}`;
            const renamedFile = new File([file], newFileName, { type: file.type, lastModified: file.lastModified });
            pastedFiles.push(renamedFile);
            imagePasted = true;
          }
        }
      }

      if (imagePasted) {
        event.preventDefault();
        setNewRequestFiles(prevFiles => {
            const newFilesToAdd = pastedFiles.filter(pf => !prevFiles.some(ef => ef.name === pf.name && ef.lastModified === pf.lastModified && ef.size === pf.size));
            return [...prevFiles, ...newFilesToAdd];
        });
        addLogEntry(LogType.FileProcessing, `${pastedFiles.length} imagen(es) pegada(s) desde el portapapeles a la nueva solicitud.`, { files: pastedFiles.map(f => f.name) });
      }
    };

    targetDiv.addEventListener('paste', handlePaste);
    return () => {
      targetDiv.removeEventListener('paste', handlePaste);
    };
  }, [isProcessing, addLogEntry]);


  const getEffectiveApiKey = useCallback((): string | undefined => {
    const key = currentStoredUserApiKey || process.env.API_KEY;
    return key;
  }, [currentStoredUserApiKey]);


  const generateAiMetadata = useCallback(async () => {
      const apiKey = getEffectiveApiKey();
      if (!apiKey || generatedQuestions.length === 0 || isGeneratingMetadata) return;

      const needsTitle = !collectionTitle.trim();
      const needsOtherMeta = !asignatura.trim() || !descripcion.trim();

      if (!needsTitle && !needsOtherMeta) return;

      setIsGeneratingMetadata(true);
      addLogEntry(LogType.Info, "Iniciando generación de metadatos con IA...");

      const sampleQuestionsText = generatedQuestions
          .slice(-10) // Sample of last 10 questions
          .map(q => q.Pregunta)
          .filter(p => p && p.trim() !== "")
          .join('\n');
      
      if (!sampleQuestionsText) {
          addLogEntry(LogType.Warning, "No hay preguntas con texto para generar metadatos.");
          setIsGeneratingMetadata(false);
          return;
      }

      try {
          const promises = [];
          if (needsTitle) {
              promises.push(generateCollectionTitleFromGemini(apiKey, sampleQuestionsText, addLogEntry));
          } else {
              promises.push(Promise.resolve(collectionTitle));
          }

          if (needsOtherMeta) {
              promises.push(generateMetadataFromGemini(apiKey, sampleQuestionsText, addLogEntry));
          } else {
              promises.push(Promise.resolve({ asignatura, descripcion }));
          }

          const [titleResult, metadataResult] = await Promise.all(promises);
          
          if (needsTitle && typeof titleResult === 'string') {
              setCollectionTitle(titleResult);
              addLogEntry(LogType.Info, `Título de colección generado: "${titleResult}"`);
          }
          if (needsOtherMeta && metadataResult) {
              setAsignatura(metadataResult.asignatura);
              setDescripcion(metadataResult.descripcion);
              addLogEntry(LogType.Info, `Metadatos generados: Asignatura="${metadataResult.asignatura}", Descripción="${metadataResult.descripcion.substring(0, 50)}..."`);
          }
      } catch (error: any) {
          addLogEntry(LogType.Error, "Error durante la generación de metadatos.", { error: error.message });
      } finally {
          setIsGeneratingMetadata(false);
      }

  }, [getEffectiveApiKey, generatedQuestions, collectionTitle, asignatura, descripcion, addLogEntry, isGeneratingMetadata]);

  const prevQuestionCountRef = useRef(generatedQuestions.length);
  useEffect(() => {
      const hasNewQuestions = generatedQuestions.length > prevQuestionCountRef.current;
      prevQuestionCountRef.current = generatedQuestions.length;

      if (hasNewQuestions) {
          generateAiMetadata();
      }
  }, [generatedQuestions, generateAiMetadata]);

  const handleOpenConfigModal = () => {
    setUserApiKeyInput(currentStoredUserApiKey || ''); 
    setShowConfigModal(true);
  };

  const handleCloseConfigModal = () => {
    setShowConfigModal(false);
    setUserApiKeyInput(currentStoredUserApiKey || ''); 
  };

  const handleSaveApiKey = () => {
    const newKeyToStore = userApiKeyInput.trim();
    if (newKeyToStore) {
      localStorage.setItem(LOCAL_STORAGE_API_KEY, newKeyToStore);
      setCurrentStoredUserApiKey(newKeyToStore);
      addLogEntry(LogType.Info, "Clave API de usuario guardada en localStorage.");
    } else {
      localStorage.removeItem(LOCAL_STORAGE_API_KEY);
      setCurrentStoredUserApiKey(null);
      addLogEntry(LogType.Info, "Clave API de usuario eliminada de localStorage. Se usará la del entorno.");
    }
    setShowConfigModal(false);
  };
  
  const handleResetApiKey = () => {
    localStorage.removeItem(LOCAL_STORAGE_API_KEY);
    setCurrentStoredUserApiKey(null);
    setUserApiKeyInput('');
    addLogEntry(LogType.Info, "Configuración de API Key restablecida. Se usará la del entorno.");
  };

  const intensityMapping = [ThinkingIntensity.Fast, ThinkingIntensity.Medium, ThinkingIntensity.High, ThinkingIntensity.VeryHigh];
  const intensityLabels = ["Rápido", "Medio", "Alto", "Muy Alto"];

  const handleIntensityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = parseInt(e.target.value, 10);
      setThinkingIntensity(intensityMapping[value]);
  };

  const getIntensityValue = () => {
      return intensityMapping.indexOf(thinkingIntensity);
  };

  const handleAddRequest = () => {
    if (newRequestPrompt.trim() === '') return;
    const newReq: GenerationRequest = {
      id: `req-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      prompt: newRequestPrompt,
      status: RequestStatus.Pending,
      requestFiles: [...newRequestFiles],
      thinkingIntensity: thinkingIntensity,
    };
    setRequests(prev => [...prev, newReq]);
    addLogEntry(LogType.Info, "Nueva solicitud añadida a la cola.", { prompt: newRequestPrompt, files: newRequestFiles.map(f => f.name) });
    setNewRequestPrompt('');
    setNewRequestFiles([]);
    if (requestFilePickerRef.current) {
        requestFilePickerRef.current.value = ""; 
    }
  };

  const handleRemoveRequest = (id: string) => {
    if (isProcessing && requests.find(r => r.id === id)?.status === RequestStatus.Processing) return; 
    const requestToRemove = requests.find(req => req.id === id);
    setRequests(prev => prev.filter(req => req.id !== id));
    if (requestToRemove) {
        addLogEntry(LogType.Info, `Solicitud "${requestToRemove.prompt.substring(0,30)}..." eliminada de la cola.`);
    }
  };

  const handleEditRequest = (id: string) => {
    if (isProcessing) return;
    const requestToEdit = requests.find(req => req.id === id);
    if (requestToEdit && requestToEdit.status !== RequestStatus.Processing) {
      setNewRequestPrompt(requestToEdit.prompt);
      setNewRequestFiles(requestToEdit.requestFiles || []);
      setThinkingIntensity(requestToEdit.thinkingIntensity);
      setRequests(prevReqs => prevReqs.filter(req => req.id !== id));
      addLogEntry(LogType.Info, `Solicitud "${requestToEdit.prompt.substring(0,30)}..." movida a edición.`);
      const promptInput = newRequestAreaRef.current?.querySelector('textarea');
      promptInput?.focus();
    }
  };

  const handleMoveRequestUp = (id: string) => {
    if (isProcessing) return;
    setRequests(prevReqs => {
      const index = prevReqs.findIndex(req => req.id === id);
      if (index > 0) {
        const newReqs = [...prevReqs];
        const temp = newReqs[index];
        newReqs[index] = newReqs[index - 1];
        newReqs[index - 1] = temp;
        addLogEntry(LogType.Info, `Solicitud "${temp.prompt.substring(0,30)}..." movida hacia arriba en la cola.`);
        return newReqs;
      }
      return prevReqs;
    });
  };

  const handleMoveRequestDown = (id: string) => {
    if (isProcessing) return;
    setRequests(prevReqs => {
      const index = prevReqs.findIndex(req => req.id === id);
      if (index < prevReqs.length - 1 && index !== -1) {
        const newReqs = [...prevReqs];
        const temp = newReqs[index];
        newReqs[index] = newReqs[index + 1];
        newReqs[index + 1] = temp;
        addLogEntry(LogType.Info, `Solicitud "${temp.prompt.substring(0,30)}..." movida hacia abajo en la cola.`);
        return newReqs;
      }
      return prevReqs;
    });
  };

  const setLiveStreamContentCallback = useCallback((chunk: string, replace = false) => {
    if (replace) {
        currentRawStreamRef.current = chunk;
    } else {
        currentRawStreamRef.current += chunk;
    }
    setGeminiLiveThought(currentRawStreamRef.current);

    const streamSoFar = currentRawStreamRef.current;
    let latestPreguntaContent = '';

    const keyMarker = '"Pregunta"';
    let lastPreguntaKeyIndex = streamSoFar.lastIndexOf(keyMarker);

    if (lastPreguntaKeyIndex !== -1) {
        let valueStartIndex = -1;
        for (let i = lastPreguntaKeyIndex + keyMarker.length; i < streamSoFar.length; i++) {
            if (streamSoFar[i] === '"') {
                valueStartIndex = i + 1; 
                break;
            } else if (streamSoFar[i] !== ':' && streamSoFar[i] !== ' ' && streamSoFar[i] !== '\n' && streamSoFar[i] !== '\t') {
                break; 
            }
        }
        
        if (valueStartIndex !== -1) {
            let contentBuffer = "";
            let inEscape = false;
            for (let i = valueStartIndex; i < streamSoFar.length; i++) {
                const char = streamSoFar[i];
                if (inEscape) {
                    contentBuffer += char;
                    inEscape = false;
                } else if (char === '\\') {
                    inEscape = true;
                    contentBuffer += char; 
                } else if (char === '"') {
                    latestPreguntaContent = contentBuffer; 
                    break; 
                } else {
                    contentBuffer += char;
                }
            }
            if (!latestPreguntaContent && contentBuffer) { 
                latestPreguntaContent = contentBuffer; 
            }
        }
    }

    if (latestPreguntaContent) {
        if (animatedPreviewClearTimeoutRef.current) {
            clearTimeout(animatedPreviewClearTimeoutRef.current);
            animatedPreviewClearTimeoutRef.current = null;
        }
        const displayContent = latestPreguntaContent.length > 70 
            ? latestPreguntaContent.substring(0, 67) + "..." 
            : latestPreguntaContent;
        
        const escapedDisplayContent = displayContent
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");

        setCurrentAnimatedPreviewText(`Pregunta [<span class="text-blue-400 font-semibold">${escapedDisplayContent}</span>] generada!`);
    }
  }, [setCurrentAnimatedPreviewText, setGeminiLiveThought]);


  const processQueue = useCallback(async () => {
    const apiKey = getEffectiveApiKey();
    if (!apiKey) {
        const errorMsg = "Error Crítico: No se pudo determinar la API_KEY de Gemini. Configure una clave en el entorno o a través de la configuración de la aplicación.";
        setGlobalError(errorMsg);
        addLogEntry(LogType.Error, errorMsg);
        setIsProcessing(false);
        return;
    }
    setGlobalError(null);
    setIsProcessing(true);
    setOverallProgress(0);
        
    addLogEntry(LogType.System, "Procesamiento de cola iniciado.", { requestCount: requests.filter(r => r.status === RequestStatus.Pending || r.status === RequestStatus.Error).length });
    
    const pendingOrErrorRequests = requests.filter(r => r.status === RequestStatus.Pending || r.status === RequestStatus.Error);

    for (let i = 0; i < pendingOrErrorRequests.length; i++) {
      const currentRequest = pendingOrErrorRequests[i];
      addLogEntry(LogType.Info, `Procesando solicitud ${i+1}/${pendingOrErrorRequests.length}: "${currentRequest.prompt.substring(0,50)}..."`, { requestId: currentRequest.id });
      
      currentRawStreamRef.current = ''; 
      setCurrentAnimatedPreviewText(null); 
      if (animatedPreviewClearTimeoutRef.current) clearTimeout(animatedPreviewClearTimeoutRef.current);

      setRequests(prevReqs => prevReqs.map(r => r.id === currentRequest.id ? { ...r, status: RequestStatus.Processing, errorDetails: undefined, jsonCorrectionAttempts: 0, questionsGeneratedCount: 0 } : r));
  
      let overallAttempt = 0;
      let successInRequest = false;
      let lastOverallAttemptError: string | undefined;
      let totalJsonCorrectionAttemptsForThisRequest = 0;

      const existingQuestionsCsv = generatedQuestions.length > 0 ? generateCsvString(generatedQuestions.filter(q => getQuestionTypeInfo(q).type !== QuestionDisplayType.Empty)) : undefined;
  
      while (overallAttempt < MAX_OVERALL_REQUEST_ATTEMPTS && !successInRequest) {
        try {
          addLogEntry(LogType.Info, `Intento general ${overallAttempt + 1}/${MAX_OVERALL_REQUEST_ATTEMPTS} para solicitud "${currentRequest.prompt.substring(0,30)}..."`, { requestId: currentRequest.id });
          
          const { parsedQuestions: newQsFromGemini, jsonCorrectionAttempts } = await generateQuestionsFromGemini(
            apiKey, 
            generalContextText,
            generalContextFiles, 
            currentRequest.prompt,
            currentRequest.requestFiles || [],
            currentRequest.thinkingIntensity,
            addLogEntry,
            setLiveStreamContentCallback,
            existingQuestionsCsv, 
            lastOverallAttemptError 
          );
          
          setGeneratedQuestions(prevGeneratedQuestions => {
              const questionsFromCurrentGeminiCall = [...newQsFromGemini];
              let updatedList: QuestionData[] = [...prevGeneratedQuestions];
              const processedIdsFromGemini = new Set<string>();
          
              // Update existing questions that were rewritten
              updatedList = updatedList.map(existingQ => {
                  const rewrittenVersion = questionsFromCurrentGeminiCall.find(nq => nq.id === existingQ.id);
                  if (rewrittenVersion) {
                      processedIdsFromGemini.add(rewrittenVersion.id);
                      addLogEntry(LogType.Info, `Pregunta ID ${existingQ.id} reemplazada por versión reescrita.`, {original: existingQ.Pregunta.substring(0,50), new: rewrittenVersion.Pregunta.substring(0,50)});
                      return rewrittenVersion; 
                  }
                  return existingQ; 
              });
          
              // Add brand new questions generated by Gemini
              questionsFromCurrentGeminiCall.forEach(nq => {
                  if (!processedIdsFromGemini.has(nq.id)) { // If not already processed (i.e., it's a new question or wasn't in original list)
                      // Check if it's genuinely new or if it's an ID that wasn't in the original list but Gemini provided it
                      const alreadyExists = updatedList.some(uq => uq.id === nq.id);
                      if (!alreadyExists) {
                        updatedList.push(nq);
                        addLogEntry(LogType.Info, `Nueva pregunta ID ${nq.id} añadida.`, {pregunta: nq.Pregunta.substring(0,50)});
                      } else {
                        // This case should be rare if IDs are unique 'gen-' or original from rewrite.
                        // Could happen if Gemini re-uses an ID from a previous rewrite request that was deleted locally.
                        addLogEntry(LogType.Warning, `Pregunta ID ${nq.id} de Gemini ya existe, posible duplicado o ID no único.`, {pregunta: nq.Pregunta.substring(0,50)});
                      }
                  }
              });
              return updatedList;
          });
          
          totalJsonCorrectionAttemptsForThisRequest = jsonCorrectionAttempts;
          setRequests(prevReqs => prevReqs.map(r => r.id === currentRequest.id ? { ...r, status: RequestStatus.Completed, errorDetails: undefined, jsonCorrectionAttempts: totalJsonCorrectionAttemptsForThisRequest, questionsGeneratedCount: newQsFromGemini.length } : r));
          addLogEntry(LogType.Info, `Solicitud "${currentRequest.prompt.substring(0,30)}..." completada con éxito. ${newQsFromGemini.length} objetos de pregunta recibidos de Gemini (reescritos y/o nuevos).`, { requestId: currentRequest.id, questionsReturnedByGemini: newQsFromGemini.length, jsonCorrectionAttempts });
          successInRequest = true;

        } catch (error: any) {
          console.error(`Error procesando solicitud ${currentRequest.id}, intento general ${overallAttempt + 1}:`, error);
          lastOverallAttemptError = error.message || "Error desconocido de Gemini.";
          const errorSource = error.sourceError || error; 
          const attemptsFromError = errorSource.jsonCorrectionAttempts;
          totalJsonCorrectionAttemptsForThisRequest = typeof attemptsFromError === 'number' ? attemptsFromError : totalJsonCorrectionAttemptsForThisRequest;

          addLogEntry(LogType.Error, `Error en intento general ${overallAttempt + 1} para solicitud "${currentRequest.prompt.substring(0,30)}..."`, { requestId: currentRequest.id, error: lastOverallAttemptError, jsonCorrectionAttempts: totalJsonCorrectionAttemptsForThisRequest });
          setGeminiLiveThought(prev => prev + `\n\n--- ERROR EN INTENTO ${overallAttempt + 1}: ${lastOverallAttemptError} ---\n`);


          if (overallAttempt === MAX_OVERALL_REQUEST_ATTEMPTS - 1) { 
            setRequests(prevReqs => prevReqs.map(r => r.id === currentRequest.id ? { ...r, status: RequestStatus.Error, errorDetails: lastOverallAttemptError, jsonCorrectionAttempts: totalJsonCorrectionAttemptsForThisRequest, questionsGeneratedCount:0 } : r));
            addLogEntry(LogType.Error, `Todos los intentos generales fallaron para solicitud "${currentRequest.prompt.substring(0,30)}..."`, { requestId: currentRequest.id, finalError: lastOverallAttemptError, jsonCorrectionAttempts: totalJsonCorrectionAttemptsForThisRequest });
          }
        }
        overallAttempt++;
      }
      setOverallProgress(((i + 1) / pendingOrErrorRequests.length) * 100);
    }
    
    addLogEntry(LogType.System, "Procesamiento de cola finalizado.", { finalQuestionCount: generatedQuestions.length });
    setIsProcessing(false);
    if (animatedPreviewClearTimeoutRef.current) clearTimeout(animatedPreviewClearTimeoutRef.current);
    animatedPreviewClearTimeoutRef.current = window.setTimeout(() => {
        setCurrentAnimatedPreviewText(null);
    }, ANIMATION_DEBOUNCE_TIME);

  }, [requests, generalContextText, generalContextFiles, addLogEntry, generatedQuestions, setLiveStreamContentCallback, setCurrentAnimatedPreviewText, setGeminiLiveThought, getEffectiveApiKey]);


  const handleSave = (format: 'csv' | 'json') => {
    setIsSaveMenuOpen(false);

    const questionsWithTypes = generatedQuestions.map(q => ({ ...q, typeInfo: getQuestionTypeInfo(q) }));

    const unknownQuestionsExist = questionsWithTypes.some(q => q.typeInfo.type === QuestionDisplayType.Unknown);
    if (unknownQuestionsExist) {
        const errorMsg = "No se puede guardar: existen preguntas con tipo 'Desconocido'. Por favor, edita o elimina estas preguntas.";
        addLogEntry(LogType.Error, errorMsg, { count: questionsWithTypes.filter(q => q.typeInfo.type === QuestionDisplayType.Unknown).length });
        setGlobalError(errorMsg);
        return;
    }
    
    const questionsToSave = questionsWithTypes
        .filter(q => q.typeInfo.type !== QuestionDisplayType.Empty && q.typeInfo.type !== QuestionDisplayType.Unknown)
        .map(({typeInfo, ...qData}) => qData as QuestionData); // Remove typeInfo before saving


    if (questionsToSave.length === 0) {
        const errorMsg = "No hay preguntas válidas para guardar. Asegúrate de que no todas estén vacías o marcadas como desconocidas.";
        addLogEntry(LogType.Info, "Intento de guardar, pero no hay preguntas válidas para exportar.", { format });
        setGlobalError(errorMsg);
        return;
    }
    
    setGlobalError(null); // Clear previous errors if save is successful

    try {
      if (format === 'csv') {
        const csvString = generateCsvString(questionsToSave);
        const filename = buildExportFilename(collectionTitle, 'csv');
        downloadCsvFile(csvString, filename);
        addLogEntry(LogType.Info, "Archivo CSV generado y descarga iniciada.", { filename, questionCount: questionsToSave.length });
      } else if (format === 'json') {
        const jsonString = generateJsonString(questionsToSave, collectionTitle, asignatura, categoria, descripcion);
        const filename = buildExportFilename(collectionTitle, 'json');
        downloadJsonFile(jsonString, filename);
        addLogEntry(LogType.Info, "Archivo JSON generado y descarga iniciada.", { filename, questionCount: questionsToSave.length, collectionTitle });
      }
    } catch (error: any) {
        addLogEntry(LogType.Error, `Error al generar o descargar el archivo ${format.toUpperCase()}.`, { error: error.message });
        setGlobalError(`Error al generar el archivo ${format.toUpperCase()}: ` + error.message);
    }
  };
  
  const handleGeneralContextFilesChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      const filesArray = Array.from(event.target.files);
      setGeneralContextFiles(prev => {
         const existingFileKeys = new Set(prev.map(f => `${f.name}-${f.lastModified}-${f.size}`));
         const newFilesToAdd = filesArray.filter(af => !existingFileKeys.has(`${af.name}-${af.lastModified}-${af.size}`));
         return [...prev, ...newFilesToAdd];
      });
      addLogEntry(LogType.FileProcessing, `${filesArray.length} archivo(s) de contexto general seleccionado(s).`, { files: filesArray.map(f => f.name) });
       if (generalFilePickerRef.current) generalFilePickerRef.current.value = ""; 
    }
  };

  const removeGeneralContextFile = (fileIdToRemove: string) => {
    const filePreviewToRemove = generalContextFilePreviews.find(fp => fp.id === fileIdToRemove);
    if (!filePreviewToRemove) {
        addLogEntry(LogType.Warning, `Intento de eliminar archivo de contexto general con ID no encontrado: ${fileIdToRemove}`);
        return;
    }

    setGeneralContextFiles(prevFiles =>
      prevFiles.filter(f => 
        !(f.name === filePreviewToRemove.name && 
          f.lastModified === filePreviewToRemove.lastModified && 
          f.size === filePreviewToRemove.size)
      )
    );
    addLogEntry(LogType.FileProcessing, `Archivo de contexto general "${filePreviewToRemove.name}" eliminado.`);
  };
  

  const handleNewRequestFilesChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      const filesArray = Array.from(event.target.files);
      setNewRequestFiles(prev => { 
        const existingFileKeys = new Set(prev.map(f => `${f.name}-${f.lastModified}-${f.size}`));
        const newFilesToAdd = filesArray.filter(af => !existingFileKeys.has(`${af.name}-${af.lastModified}-${af.size}`));
        return [...prev, ...newFilesToAdd];
      });
      addLogEntry(LogType.FileProcessing, `${filesArray.length} archivo(s) adjuntado(s) a la nueva solicitud.`, { files: filesArray.map(f => f.name) });
      if (requestFilePickerRef.current) requestFilePickerRef.current.value = ""; 
    }
  };
  
  const removeNewRequestFileByPreviewId = (previewId: string) => {
    const previewToRemove = newRequestFilePreviews.find(p => p.id === previewId);
    if (previewToRemove) {
        setNewRequestFiles(prevFiles => prevFiles.filter(
            file => !(file.name === previewToRemove.name && 
                      file.lastModified === previewToRemove.lastModified && 
                      file.size === previewToRemove.size)
        ));
        addLogEntry(LogType.FileProcessing, `Archivo "${previewToRemove.name}" eliminado de la nueva solicitud pendiente.`);
    }
  };

  const handleLoadFileClick = () => {
    if (filePickerRef.current) {
        filePickerRef.current.click();
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
        const file = event.target.files[0];
        const fileNameLower = file.name.toLowerCase();
        
        const reader = new FileReader();

        reader.onload = (e) => {
            const text = e.target?.result as string;
            if (!text) {
                const errorMsg = `Error: El archivo ${file.name} está vacío o no se pudo leer.`;
                addLogEntry(LogType.Error, "Error al leer el archivo: contenido vacío.", {fileName: file.name});
                setGlobalError(errorMsg);
                return;
            }

            try {
                if (fileNameLower.endsWith('.csv')) {
                    addLogEntry(LogType.FileProcessing, `Intentando cargar CSV: ${file.name}`);
                    const lines = text.split(/\r\n|\n/);
                    if (lines.length < 2) throw new Error("Archivo CSV inválido: debe tener al menos una cabecera y una fila de datos.");
                    
                    const headerLine = lines[0];
                    const parsedHeader = parseCsvLineRobust(headerLine);
                    const isValidHeader = CSV_HEADERS.length === parsedHeader.length && CSV_HEADERS.every((h, i) => parsedHeader[i].trim() === h.trim());
                    if (!isValidHeader) throw new Error(`La cabecera del CSV no coincide. Esperado: ${CSV_HEADERS.join(', ')}. Encontrado: ${parsedHeader.join(', ')}`);

                    const newQuestions: QuestionData[] = [];
                    let skippedRows = 0;
                    for (let i = 1; i < lines.length; i++) {
                        if (lines[i].trim() === '') continue;
                        const fields = parseCsvLineRobust(lines[i]);
                        if (fields.length !== CSV_HEADERS.length) {
                            addLogEntry(LogType.Warning, `Fila ${i+1} del CSV omitida: número incorrecto de columnas.`, {fileName: file.name});
                            skippedRows++;
                            continue;
                        }
                        const question: Partial<QuestionData> = { id: `csv-import-${Date.now()}-${Math.random().toString(36).substring(2, 9)}` };
                        CSV_HEADERS.forEach((header, index) => {
                            const key = CSV_HEADER_TO_QUESTION_DATA_KEY_MAP[header];
                            if (key) (question as any)[key] = fields[index] || undefined;
                        });
                        newQuestions.push(question as QuestionData);
                    }
                    setGeneratedQuestions(prev => [...prev, ...newQuestions]);
                    addLogEntry(LogType.Info, `${newQuestions.length} preguntas importadas desde "${file.name}". ${skippedRows > 0 ? `${skippedRows} filas omitidas.` : ''}`);

                } else if (fileNameLower.endsWith('.json')) {
                    addLogEntry(LogType.FileProcessing, `Intentando cargar JSON: ${file.name}`);
                    const data = JSON.parse(text);

                    if (typeof data !== 'object' || data === null) throw new Error("El archivo JSON no contiene un objeto válido.");
                    
                    if (typeof data["Nombre de Colección"] === 'string') {
                        setCollectionTitle(data["Nombre de Colección"]);
                    }
                    if (typeof data["Asignatura"] === 'string') {
                        setAsignatura(data["Asignatura"]);
                    }
                    if (typeof data["Categoría"] === 'string') {
                        setCategoria(data["Categoría"]);
                    }
                    if (typeof data["Descripción"] === 'string') {
                        setDescripcion(data["Descripción"]);
                    }
                    addLogEntry(LogType.Info, `Metadatos importados desde JSON.`);

                    if (!Array.isArray(data.questions)) throw new Error("El objeto JSON no contiene un array 'questions'.");

                    const newQuestions: QuestionData[] = [];
                    let skippedCount = 0;
                    for (const item of data.questions) {
                        if (typeof item !== 'object' || item === null || typeof item.Pregunta !== 'string') {
                            skippedCount++;
                            continue;
                        }
                        newQuestions.push({
                            id: `json-import-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                            Pregunta: item.Pregunta,
                            'Opción correcta 1': String(item['Opción correcta 1'] ?? ''),
                            'Opción Correcta 2': item['Opción Correcta 2'] || undefined,
                            'Opción Correcta 3': item['Opción Correcta 3'] || undefined,
                            'Opción Incorrecta 1': item['Opción Incorrecta 1'] || undefined,
                            'Opción Incorrecta 2': item['Opción Incorrecta 2'] || undefined,
                            'Opción Incorrecta 3': item['Opción Incorrecta 3'] || undefined,
                            Explicación: item.Explicación || undefined,
                        });
                    }
                    setGeneratedQuestions(prev => [...prev, ...newQuestions]);
                    addLogEntry(LogType.Info, `${newQuestions.length} preguntas importadas desde "${file.name}".${skippedCount > 0 ? ` ${skippedCount} items omitidos.` : ''}`);

                } else {
                    throw new Error("Tipo de archivo no soportado. Por favor, carga un archivo .csv o .json.");
                }
                setGlobalError(null);

            } catch (error: any) {
                const errorMsg = `Error al procesar el archivo "${file.name}": ${error.message}`;
                addLogEntry(LogType.Error, errorMsg, {fileName: file.name});
                setGlobalError(errorMsg);
            }
        };

        reader.onerror = () => {
            const errorMsg = `Error al leer el archivo "${file.name}".`;
            addLogEntry(LogType.Error, errorMsg, { error: reader.error });
            setGlobalError(errorMsg);
        };

        reader.readAsText(file);
        
        if (filePickerRef.current) {
            filePickerRef.current.value = "";
        }
    }
  };


  const handleQuestionEdit = (questionId: string, field: keyof QuestionData, value: string) => {
    setGeneratedQuestions(prev => 
      prev.map(q => 
        q.id === questionId ? { ...q, [field]: value } : q
      )
    );
    addLogEntry(LogType.Info, `Pregunta ID ${questionId} actualizada. Campo: ${String(field)}, Nuevo valor: "${value.substring(0,30)}..."`);
  };

  const handleDeleteGeneratedQuestion = (questionId: string) => {
    const questionToDelete = generatedQuestions.find(q => q.id === questionId);
    setGeneratedQuestions(prev => prev.filter(q => q.id !== questionId));
    if (questionToDelete) {
        addLogEntry(LogType.Info, `Pregunta "${questionToDelete.Pregunta.substring(0,30)}..." (ID: ${questionId}) eliminada.`);
    }
    setSelectedQuestionIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(questionId);
        return newSet;
    });
    if (expandedQuestionId === questionId) {
        setExpandedQuestionId(null); 
    }
  };

  const handleAddManualQuestion = () => {
    const newQuestion: QuestionData = {
      id: `manual-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      Pregunta: '', // Will be classified as 'Empty'
      'Opción correcta 1': '',
      'Opción Correcta 2': undefined,
      'Opción Correcta 3': undefined,
      'Opción Incorrecta 1': undefined,
      'Opción Incorrecta 2': undefined,
      'Opción Incorrecta 3': undefined,
      Explicación: undefined,
    };
    setGeneratedQuestions(prev => [newQuestion, ...prev]); // Add to top for visibility
    addLogEntry(LogType.Info, "Nueva fila de pregunta manual añadida a la tabla (inicialmente vacía).");
    setExpandedQuestionId(newQuestion.id); 
  };

  const handleRowExpandToggle = (questionId: string) => {
    setExpandedQuestionId(prevId => prevId === questionId ? null : questionId);
  };

  // Row selection handlers
  const handleRowSelectionToggle = (questionId: string, isShiftClick: boolean) => {
    const newSelectedIds = new Set(selectedQuestionIds);
    const questionIndex = generatedQuestions.findIndex(q => q.id === questionId);

    if (isShiftClick && lastSelectedRowId && lastSelectedRowId !== questionId && questionIndex !== -1) {
        const lastSelectedIndex = generatedQuestions.findIndex(q => q.id === lastSelectedRowId);
        if (lastSelectedIndex !== -1) {
            const start = Math.min(questionIndex, lastSelectedIndex);
            const end = Math.max(questionIndex, lastSelectedIndex);
            const shouldBeSelected = !newSelectedIds.has(questionId); // Determine based on the clicked item's new state

            for (let i = start; i <= end; i++) {
                const idInRange = generatedQuestions[i].id;
                if (shouldBeSelected) {
                    newSelectedIds.add(idInRange);
                } else {
                    newSelectedIds.delete(idInRange);
                }
            }
        }
    } else {
        if (newSelectedIds.has(questionId)) {
            newSelectedIds.delete(questionId);
        } else {
            newSelectedIds.add(questionId);
        }
    }
    setSelectedQuestionIds(newSelectedIds);
    setLastSelectedRowId(questionId);
  };

  const handleSelectAllToggle = () => {
    if (selectedQuestionIds.size === generatedQuestions.length && generatedQuestions.length > 0) {
      setSelectedQuestionIds(new Set());
      addLogEntry(LogType.Info, "Todas las preguntas deseleccionadas.");
    } else {
      setSelectedQuestionIds(new Set(generatedQuestions.map(q => q.id)));
      addLogEntry(LogType.Info, "Todas las preguntas seleccionadas.");
    }
  };

  const handleDeleteSelectedQuestions = () => {
    if (selectedQuestionIds.size === 0) return;
    const questionsToDeleteCount = selectedQuestionIds.size;
    setGeneratedQuestions(prev => prev.filter(q => !selectedQuestionIds.has(q.id)));
    setSelectedQuestionIds(new Set());
    setLastSelectedRowId(null);
    if (expandedQuestionId && selectedQuestionIds.has(expandedQuestionId)) {
      setExpandedQuestionId(null);
    }
    addLogEntry(LogType.Info, `${questionsToDeleteCount} pregunta(s) seleccionada(s) eliminada(s).`);
  };

  const handleRewriteSelectedQuestions = () => {
    if (selectedQuestionIds.size === 0 || isProcessing) return;

    const questionsToRewrite = generatedQuestions.filter(q => selectedQuestionIds.has(q.id));
    if (questionsToRewrite.length === 0) return;

    const questionsJsonString = JSON.stringify(questionsToRewrite.map(q => ({
        id: q.id, 
        Pregunta: q.Pregunta,
        'Opción correcta 1': q['Opción correcta 1'],
        'Opción Correcta 2': q['Opción Correcta 2'],
        'Opción Correcta 3': q['Opción Correcta 3'],
        'Opción Incorrecta 1': q['Opción Incorrecta 1'],
        'Opción Incorrecta 2': q['Opción Incorrecta 2'],
        'Opción Incorrecta 3': q['Opción Incorrecta 3'],
        Explicación: q.Explicación,
    })), null, 2);
    const questionsFile = new File([questionsJsonString], REWRITE_QUESTIONS_FILENAME, { type: "application/json" });
    
    setNewRequestFiles(prevFiles => {
        const otherFiles = prevFiles.filter(f => f.name !== REWRITE_QUESTIONS_FILENAME);
        return [questionsFile, ...otherFiles];
    });
    
    addLogEntry(LogType.Info, `${questionsToRewrite.length} pregunta(s) seleccionada(s) y adjuntada(s) como '${REWRITE_QUESTIONS_FILENAME}'. Por favor, escribe tus instrucciones de reescritura en 'Nueva Solicitud' y añádelo a la cola.`);
    
    setSelectedQuestionIds(new Set());
    setLastSelectedRowId(null);

    const promptInput = newRequestAreaRef.current?.querySelector('textarea');
    promptInput?.focus();
  };

  const isQuestionSelected = (questionId: string) => selectedQuestionIds.has(questionId);
  const areAllQuestionsSelected = selectedQuestionIds.size === generatedQuestions.length && generatedQuestions.length > 0;
  const hasUnknownQuestions = generatedQuestions.some(q => getQuestionTypeInfo(q).type === QuestionDisplayType.Unknown);

  const getStatusIcon = (status: RequestStatus) => {
    switch (status) {
      case RequestStatus.Pending: return <ClockIcon className="w-5 h-5 text-neutral-400" />;
      case RequestStatus.Processing: return <SpinnerIcon className="w-5 h-5 text-blue-400" />;
      case RequestStatus.Completed: return <CheckCircleIcon className="w-5 h-5 text-green-400" />;
      case RequestStatus.Error: return <XCircleIcon className="w-5 h-5 text-red-400" />;
      default: return null;
    }
  };

  const getLogColor = (type: LogType) => {
    switch (type) {
        case LogType.Error: return 'text-red-400';
        case LogType.Warning: return 'text-yellow-400';
        case LogType.GeminiRequest: return 'text-blue-400';
        case LogType.GeminiResponse: return 'text-purple-400';
        case LogType.GeminiStream: return 'text-pink-400';
        case LogType.System: return 'text-yellow-300';
        case LogType.FileProcessing: return 'text-teal-400';
        default: return 'text-neutral-300';
    }
  }


  return (
    <div className="min-h-screen bg-black text-neutral-300 p-4 md:p-8 flex flex-col items-center">
      <header className="w-full mb-8 flex justify-between items-center">
        <div className="text-left">
            <h1 className="text-4xl font-bold text-blue-400 mb-1">{APP_TITLE}</h1>
            <p className="text-neutral-400 text-sm">Crea preguntas para tus quizzes de forma eficiente con IA.</p>
        </div>
        <button
            onClick={handleOpenConfigModal}
            className="p-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition-colors"
            title="Configuración"
            aria-label="Abrir configuración"
        >
            <CogIcon className="w-6 h-6" />
        </button>
      </header>

      {globalError && (
        <div className="w-full max-w-3xl bg-red-800 border border-red-600 text-red-200 px-4 py-3 rounded-md mb-6" role="alert">
          <p className="font-bold">Error/Advertencia:</p>
          <p className="text-sm">{globalError}</p>
        </div>
      )}

      {showConfigModal && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"  aria-modal="true" role="dialog">
          <div className="bg-neutral-800 p-6 rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-semibold text-neutral-100">Configuración</h2>
              <button 
                onClick={handleCloseConfigModal} 
                className="p-1 text-neutral-400 hover:text-neutral-100"
                aria-label="Cerrar modal de configuración"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            
            <div className="mb-4">
              <label htmlFor="apiKeyInput" className="block text-sm font-medium text-neutral-300 mb-1">
                Clave API de Gemini (GEMINI_API_KEY)
              </label>
              <input
                type="password"
                id="apiKeyInput"
                value={userApiKeyInput}
                onChange={(e) => setUserApiKeyInput(e.target.value)}
                placeholder="Pega tu clave API aquí..."
                className="w-full p-3 bg-neutral-700 border border-neutral-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors placeholder-neutral-500 text-neutral-100"
              />
              <p className="mt-1 text-xs text-neutral-400">
                Dejar en blanco para usar la clave del entorno. Si se provee, esta clave se usará en lugar de la configurada en el entorno y se guardará localmente en tu navegador.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row justify-between gap-3">
              <button
                onClick={handleResetApiKey}
                className="w-full sm:w-auto px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-md transition-colors"
              >
                Restablecer a Clave de Entorno
              </button>
              <button
                onClick={handleSaveApiKey}
                className="w-full sm:w-auto px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors font-semibold"
              >
                Guardar Cambios
              </button>
            </div>
          </div>
        </div>
      )}


      <main className="w-full grid grid-cols-1 lg:grid-cols-4 gap-8">
        <section className="lg:col-span-1 flex flex-col gap-6 p-6 bg-neutral-900 rounded-xl shadow-lg">
          <div>
            <h2 className="text-2xl font-semibold text-neutral-100 mb-3">1. Contexto General</h2>
            <textarea
              value={generalContextText}
              onChange={(e) => setGeneralContextText(e.target.value)}
              placeholder="Pega aquí el material de estudio principal (texto, notas, etc.). Este contexto se usará para todas las solicitudes."
              className="w-full h-32 p-3 bg-neutral-800 border border-neutral-700 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors placeholder-neutral-500 text-neutral-100"
              disabled={isProcessing}
            />
            <div className="mt-3">
              <label htmlFor="context-files" className="block text-sm font-medium text-neutral-400 mb-1">Cargar archivos de contexto (opcional, múltiple):</label>
              <input 
                type="file" 
                id="context-files"
                multiple
                ref={generalFilePickerRef}
                onChange={handleGeneralContextFilesChange}
                className="w-full text-sm text-neutral-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 disabled:opacity-50"
                disabled={isProcessing}
                accept="image/*,text/*,application/pdf,.md,.json,.csv"
              />
              {generalContextFilePreviews.length > 0 && (
                <div className="mt-2 space-y-2 text-xs">
                  <p className="text-neutral-300 font-medium">Archivos de contexto cargados:</p>
                  <ul className="list-none pl-0 max-h-32 overflow-y-auto bg-neutral-800 p-2 rounded-md border border-neutral-700">
                    {generalContextFilePreviews.map(fp => (
                      <li key={fp.id} className="flex justify-between items-center p-1.5 bg-neutral-700 rounded hover:bg-neutral-600 border border-neutral-600">
                        <div className="flex items-center gap-2 overflow-hidden">
                          {fp.previewUrl ? <img src={fp.previewUrl} alt={fp.name} className="w-8 h-8 object-cover rounded"/> : <FileTextIcon className="w-6 h-6 text-neutral-400 flex-shrink-0"/> }
                          <span className="truncate text-neutral-200" title={`${fp.name} (${fp.type}, ${(fp.size/1024).toFixed(1)}KB)`}>
                            {fp.name} <span className="text-neutral-400">({(fp.size/1024).toFixed(1)}KB)</span>
                          </span>
                        </div>
                        <button onClick={() => removeGeneralContextFile(fp.id)} disabled={isProcessing} className="p-1 text-red-400 hover:text-red-500 disabled:text-neutral-500">
                          <TrashIcon className="w-4 h-4"/>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-neutral-100 mb-3">2. Cola de Solicitudes</h2>
            <div ref={newRequestAreaRef} className="bg-neutral-800 p-3 rounded-md border border-neutral-700">
              <textarea
                value={newRequestPrompt}
                onChange={(e) => setNewRequestPrompt(e.target.value)}
                placeholder="Tema o instrucción específica para un grupo de preguntas (puede ser de varias líneas)"
                className="w-full p-3 mb-2 bg-neutral-700 border border-neutral-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors placeholder-neutral-500 text-neutral-100 h-24 resize-y"
                disabled={isProcessing}
              />
              <div className="mb-2">
                 <label htmlFor="request-files" className="block text-xs font-medium text-neutral-400 mb-1">
                    Adjuntar archivos a esta solicitud (opcional) <span className="text-neutral-500">(o pega con Ctrl+V)</span>:
                 </label>
                <input 
                    type="file" 
                    id="request-files"
                    multiple
                    ref={requestFilePickerRef}
                    onChange={handleNewRequestFilesChange}
                    className="w-full text-sm text-neutral-400 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 disabled:opacity-50"
                    disabled={isProcessing}
                    accept="image/*,text/*,application/pdf,.md,.json,.csv"
                />
                {newRequestFilePreviews.length > 0 && (
                    <div className="mt-2 space-y-1 text-xs max-h-28 overflow-y-auto bg-neutral-700 p-1.5 rounded-md border border-neutral-600">
                      {newRequestFilePreviews.map(fp => (
                        <div key={fp.id} className="flex justify-between items-center p-1 bg-neutral-800 rounded text-neutral-200 hover:bg-neutral-600 border border-neutral-600">
                          <div className="flex items-center gap-1.5 overflow-hidden">
                            {fp.previewUrl ? <img src={fp.previewUrl} alt={fp.name} className="w-6 h-6 object-cover rounded flex-shrink-0"/> : <FileTextIcon className="w-4 h-4 text-neutral-400 flex-shrink-0"/> }
                            <span className={`truncate text-xs ${fp.name === REWRITE_QUESTIONS_FILENAME ? 'text-purple-300 font-semibold' : ''}`} title={`${fp.name} (${fp.type}, ${(fp.size/1024).toFixed(1)}KB)`}>
                                {fp.name} {fp.name === REWRITE_QUESTIONS_FILENAME && "(para reescribir)"}
                            </span>
                          </div>
                          <button onClick={() => removeNewRequestFileByPreviewId(fp.id)} disabled={isProcessing} className="p-0.5 text-red-400 hover:text-red-500 disabled:text-neutral-500">
                              <TrashIcon className="w-3.5 h-3.5"/>
                          </button>
                        </div>
                      ))}
                    </div>
                )}
              </div>
               <div className="my-3">
                  <label htmlFor="thinking-intensity" className="flex items-center gap-2 text-sm font-medium text-neutral-300 mb-2">
                      <BrainIcon className="w-5 h-5 text-purple-400" />
                      Intensidad de Pensamiento
                  </label>
                  <input
                      type="range"
                      id="thinking-intensity"
                      min="0"
                      max="3"
                      value={getIntensityValue()}
                      onChange={handleIntensityChange}
                      className="w-full h-2 bg-neutral-600 rounded-lg appearance-none cursor-pointer accent-purple-500"
                      disabled={isProcessing}
                  />
                  <div className="flex justify-between text-xs text-neutral-400 mt-1 px-1">
                      {intensityLabels.map((label, index) => (
                          <span 
                              key={label} 
                              className={`font-medium ${getIntensityValue() === index ? 'text-purple-300' : ''}`}
                          >
                              {label}
                          </span>
                      ))}
                  </div>
              </div>
              <button
                onClick={handleAddRequest}
                disabled={isProcessing || newRequestPrompt.trim() === ''}
                className="w-full p-3 bg-blue-600 hover:bg-blue-700 text-white rounded-md flex items-center justify-center gap-2 transition-colors disabled:bg-neutral-700 disabled:text-neutral-400 disabled:cursor-not-allowed"
              >
                <PlusIcon className="w-5 h-5" /> Añadir a Cola
              </button>
            </div>
            
            <div className="mt-3 max-h-60 overflow-y-auto bg-neutral-800 p-3 rounded-md border border-neutral-700 space-y-2">
              {requests.length === 0 && <p className="text-neutral-400 text-sm italic">La cola está vacía. Añade solicitudes.</p>}
              {requests.map((req, index) => (
                <div key={req.id} className="p-3 bg-neutral-700 rounded-md flex items-start gap-2 border border-neutral-600 shadow-sm">
                  <div className="flex flex-col gap-1 mr-2">
                        <button
                            onClick={() => handleMoveRequestUp(req.id)}
                            disabled={isProcessing || index === 0 || req.status === RequestStatus.Processing}
                            className="p-1 text-blue-400 hover:text-blue-300 disabled:text-neutral-500 disabled:cursor-not-allowed"
                            title="Mover arriba"
                        >
                            <ChevronUpIcon className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => handleMoveRequestDown(req.id)}
                            disabled={isProcessing || index === requests.length - 1 || req.status === RequestStatus.Processing}
                            className="p-1 text-blue-400 hover:text-blue-300 disabled:text-neutral-500 disabled:cursor-not-allowed"
                            title="Mover abajo"
                        >
                            <ChevronDownIcon className="w-4 h-4" />
                        </button>
                    </div>
                  <div className="flex-grow min-w-0">
                    <p className="text-sm text-neutral-100 truncate" title={req.prompt}>{req.prompt}</p>
                    {req.requestFiles && req.requestFiles.length > 0 && (
                      <div className="mt-1 text-xs text-neutral-400 flex items-center gap-1">
                        <PaperClipIcon className="w-3 h-3"/> {req.requestFiles.length} archivo(s) adjunto(s)
                         {req.requestFiles.some(f => f.name === REWRITE_QUESTIONS_FILENAME) && 
                            <span className="text-purple-400">(Reescritura)</span> 
                         }
                      </div>
                    )}
                    <RequestStatusDisplay req={req} />
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {getStatusIcon(req.status)}
                     <button
                        onClick={() => handleEditRequest(req.id)}
                        disabled={isProcessing || req.status === RequestStatus.Processing}
                        className="p-1 text-yellow-400 hover:text-yellow-300 disabled:text-neutral-500 disabled:cursor-not-allowed"
                        title="Editar solicitud"
                    >
                        <PencilIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleRemoveRequest(req.id)}
                      disabled={isProcessing && req.status === RequestStatus.Processing}
                      className="text-red-400 hover:text-red-300 disabled:text-neutral-500 disabled:cursor-not-allowed"
                      title="Eliminar solicitud"
                    >
                      <TrashIcon className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
           <button
              onClick={processQueue}
              disabled={isProcessing || requests.filter(r => r.status === RequestStatus.Pending || r.status === RequestStatus.Error).length === 0}
              className="w-full mt-4 p-4 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-md flex items-center justify-center gap-2 text-lg transition-colors disabled:bg-neutral-700 disabled:text-neutral-400 disabled:cursor-not-allowed"
            >
              {isProcessing ? <SpinnerIcon className="w-6 h-6" /> : <ProcessIcon className="w-6 h-6" />}
              {isProcessing ? `Procesando... (${overallProgress.toFixed(0)}%)` : 'Generar Preguntas'}
            </button>
            {isProcessing && (
              <div className="w-full bg-neutral-700 rounded-full h-2.5 mt-2">
                <div className="bg-blue-500 h-2.5 rounded-full transition-all duration-300 ease-out" style={{ width: `${overallProgress}%` }}></div>
              </div>
            )}
            
            <div className="mt-4 p-0 bg-neutral-900 rounded-xl"> 
              <h2 className="text-2xl font-semibold text-neutral-100 mb-3 flex items-center gap-2 p-2 bg-neutral-800 rounded-t-md border-b border-neutral-700">
                  <AcademicCapIcon className="w-6 h-6 text-blue-400"/>
                  3. Procesamiento de Gemini
              </h2>
              <div className="p-3 bg-neutral-800 border border-neutral-700 rounded-b-md text-xs min-h-[40px]"> {/* Added min-h for consistent height */}
                  {isProcessing && geminiLiveThought && (
                      <p className="italic text-neutral-300">Gemini está procesando... El stream detallado de la respuesta se muestra en la sección 'Streamming Retornado' más abajo si está activa.</p>
                  )}
                  {isProcessing && !geminiLiveThought && (
                      <p className="italic text-neutral-400">Esperando la primera respuesta de Gemini...</p>
                  )}
                  {!isProcessing && (
                     <p className="italic text-neutral-400">Procesamiento de cola inactivo.</p>
                  )}
              </div>
            </div>

            {currentAnimatedPreviewText && (
                <div 
                  className="p-2 my-2 bg-blue-900 border border-blue-700 text-blue-300 rounded-md text-sm text-center transition-opacity duration-500 ease-in-out opacity-100 animate-pulse"
                  dangerouslySetInnerHTML={{ __html: currentAnimatedPreviewText }}
                  aria-live="assertive"
                />
            )}
            
            <div className="mt-4">
                <button
                    onClick={() => setShowGeminiStreamOutput(prev => !prev)}
                    className="w-full p-2 bg-neutral-700 hover:bg-neutral-600 text-neutral-200 rounded-md flex items-center justify-center gap-2 text-sm transition-colors"
                >
                    <ListBulletIcon className="w-5 h-5" /> 
                    {showGeminiStreamOutput ? 'Ocultar Streamming Retornado' : 'Mostrar Streamming Retornado'}
                    {showGeminiStreamOutput ? <ChevronUpIcon className="w-4 h-4"/> : <ChevronDownIcon className="w-4 h-4"/>}
                </button>
            </div>
            {showGeminiStreamOutput && (
                <div 
                  ref={geminiThoughtsContainerRef}
                  className="mt-2 p-3 bg-neutral-900 border border-neutral-700 rounded-md max-h-96 overflow-y-auto text-xs shadow text-neutral-300 whitespace-pre-wrap" 
                  aria-live="polite"
                  aria-atomic="true"
                >
                  <h3 className="text-base font-semibold text-neutral-100 mb-2 sticky top-0 bg-neutral-900 py-1 z-10 border-b border-neutral-700">Stream de Gemini</h3>
                  {isProcessing && !geminiLiveThought && <p className="italic text-neutral-400">Esperando respuesta de Gemini...</p>}
                  {geminiLiveThought || (!isProcessing && <p className="italic text-neutral-500">El procesamiento ha finalizado o no está activo. Este es el último stream recibido.</p>)}
                </div>
            )}

            <div className="mt-4">
                <button
                    onClick={() => setShowLogs(prev => !prev)}
                    className="w-full p-2 bg-neutral-700 hover:bg-neutral-600 text-neutral-200 rounded-md flex items-center justify-center gap-2 text-sm transition-colors"
                >
                    <ListBulletIcon className="w-5 h-5" />
                    {showLogs ? 'Ocultar Log de Actividad' : 'Mostrar Log de Actividad'}
                    {showLogs ? <ChevronUpIcon className="w-4 h-4"/> : <ChevronDownIcon className="w-4 h-4"/>}
                </button>
            </div>
            {showLogs && (
                <div className="mt-2 p-3 bg-neutral-900 border border-neutral-700 rounded-md max-h-96 overflow-y-auto text-xs shadow" ref={logContainerRef}>
                    <h3 className="text-lg font-semibold text-neutral-100 mb-2 sticky top-0 bg-neutral-900 py-1 z-10 border-b border-neutral-700">Log de Actividad</h3>
                    {logEntries.length === 0 && <p className="text-neutral-400 italic">No hay entradas en el log todavía.</p>}
                    <ul>
                        {logEntries.map(log => (
                        <li key={log.id} className={`py-1 border-b border-neutral-800 last:border-b-0 ${getLogColor(log.type)}`}>
                            <span className="font-semibold">{log.timestamp.toLocaleTimeString(undefined, LOG_TIMESTAMP_FORMAT)}</span> [{log.type.toUpperCase()}]: {log.message}
                            {log.details && (typeof log.details === 'string' || typeof log.details === 'number') && <span className="block pl-4 text-neutral-400 text-opacity-80">{'>'} {String(log.details).substring(0,300)}{String(log.details).length > 300 ? '...' : ''}</span>}
                            {log.details && typeof log.details === 'object' && (
                                <details className="pl-4 mt-1 text-neutral-400 text-opacity-80">
                                    <summary className="cursor-pointer text-xs hover:text-neutral-300">Ver detalles...</summary>
                                    <pre className="mt-1 p-2 bg-neutral-800 rounded text-xs overflow-x-auto whitespace-pre-wrap break-all border border-neutral-700">
                                        {JSON.stringify(log.details, null, 2).substring(0,1000)}
                                        {JSON.stringify(log.details, null, 2).length > 1000 ? '\n... (truncado)' : ''}
                                    </pre>
                                </details>
                            )}
                        </li>
                        ))}
                    </ul>
                </div>
            )}
        </section>

        <section className="lg:col-span-3 flex flex-col gap-6">
          <div className="p-6 bg-neutral-900 rounded-xl shadow-lg flex-grow flex flex-col">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-2xl font-semibold text-neutral-100">4. Preguntas Generadas ({generatedQuestions.length})</h2>
              <div className="flex gap-2">
                 <input 
                    type="file" 
                    ref={filePickerRef}
                    onChange={handleFileChange}
                    accept=".csv,.json"
                    className="hidden" 
                    id="file-picker"
                />
                <button
                  onClick={handleLoadFileClick}
                  disabled={isProcessing}
                  className="p-3 bg-teal-600 hover:bg-teal-700 text-white rounded-md flex items-center gap-2 transition-colors disabled:bg-neutral-700 disabled:text-neutral-400 disabled:cursor-not-allowed"
                  title="Cargar preguntas desde un archivo CSV o JSON"
                >
                  <DocumentPlusIcon className="w-5 h-5" /> Cargar Archivo
                </button>
                <button
                  onClick={handleAddManualQuestion}
                  disabled={isProcessing}
                  className="p-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md flex items-center gap-2 transition-colors disabled:bg-neutral-700 disabled:text-neutral-400 disabled:cursor-not-allowed"
                  title="Añadir una pregunta manualmente a la tabla"
                >
                  <PlusIcon className="w-5 h-5" /> Añadir Pregunta
                </button>
                <div className="relative" ref={saveMenuRef}>
                    <button
                        onClick={() => setIsSaveMenuOpen(prev => !prev)}
                        disabled={isProcessing || generatedQuestions.length === 0 || hasUnknownQuestions}
                        className="p-3 bg-blue-600 hover:bg-blue-700 text-white rounded-md flex items-center gap-2 transition-colors disabled:bg-neutral-700 disabled:text-neutral-400 disabled:cursor-not-allowed"
                        title={hasUnknownQuestions ? "No se puede guardar: existen preguntas con tipo 'Desconocido'. Por favor, corrígelas." : "Guardar preguntas"}
                    >
                        <DownloadIcon className="w-5 h-5" /> Guardar
                        <ChevronDownIcon className={`w-4 h-4 transition-transform ${isSaveMenuOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isSaveMenuOpen && (
                        <div className="absolute right-0 top-full mt-2 w-48 bg-neutral-800 border border-neutral-700 rounded-md shadow-lg z-20 overflow-hidden">
                            <button
                                onClick={() => handleSave('json')}
                                className="w-full text-left px-4 py-2 text-sm text-neutral-200 hover:bg-blue-600 flex items-center gap-2"
                            >
                                Guardar como JSON
                            </button>
                            <button
                                onClick={() => handleSave('csv')}
                                className="w-full text-left px-4 py-2 text-sm text-neutral-200 hover:bg-blue-600 flex items-center gap-2"
                            >
                                Guardar como CSV
                            </button>
                        </div>
                    )}
                </div>
              </div>
            </div>

             {selectedQuestionIds.size > 0 && (
                <div className="mb-3 py-2 px-3 bg-neutral-800 border border-neutral-700 rounded-lg flex items-center justify-between h-[52px] transition-all duration-150">
                    <span className="text-sm text-neutral-300">
                        {selectedQuestionIds.size} pregunta(s) seleccionada(s)
                    </span>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                        <button
                        onClick={handleDeleteSelectedQuestions}
                        disabled={isProcessing}
                        className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs rounded-md flex items-center gap-1.5 transition-colors disabled:bg-neutral-600 disabled:text-neutral-400"
                        title="Eliminar preguntas seleccionadas"
                        >
                        <TrashIcon className="w-4 h-4" /> Eliminar
                        </button>
                        <button
                        onClick={handleRewriteSelectedQuestions}
                        disabled={isProcessing}
                        className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs rounded-md flex items-center gap-1.5 transition-colors disabled:bg-neutral-600 disabled:text-neutral-400"
                        title="Adjuntar preguntas seleccionadas para reescritura. Defina la instrucción en 'Nueva Solicitud'."
                        >
                        <SparklesIcon className="w-4 h-4" /> Reescribir
                        </button>
                    </div>
                </div>
            )}
            
            <div className="mb-4 bg-neutral-800 border border-neutral-700 rounded-lg">
                <button
                    onClick={() => setIsMetadataExpanded(prev => !prev)}
                    className="w-full flex justify-between items-center p-4 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-t-lg"
                    aria-expanded={isMetadataExpanded}
                    aria-controls="metadata-content"
                >
                    <h3 className="text-xl font-semibold text-neutral-200">Metadatos de la Colección</h3>
                    {isMetadataExpanded ? <ChevronUpIcon className="w-6 h-6 text-neutral-400" /> : <ChevronDownIcon className="w-6 h-6 text-neutral-400" />}
                </button>
                {isMetadataExpanded && (
                    <div id="metadata-content" className="p-4 pt-0 space-y-4">
                        {isGeneratingMetadata && (
                          <div className="mb-2 p-3 bg-neutral-800 border border-neutral-700 rounded-md flex items-center gap-3">
                            <SpinnerIcon className="w-5 h-5 text-blue-400" />
                            <div className="flex-1">
                              <p className="text-sm text-neutral-200">Generando metadatos con IA...</p>
                              <div className="mt-2 h-1.5 bg-neutral-700 rounded">
                                <div className="h-1.5 bg-blue-500 rounded w-2/3 animate-pulse"></div>
                              </div>
                            </div>
                          </div>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="collection-title-input" className="block text-sm font-medium text-neutral-300 mb-1">Nombre de Colección</label>
                                <div className="relative">
                                    <input
                                        id="collection-title-input"
                                        type="text"
                                        value={collectionTitle}
                                        onChange={(e) => setCollectionTitle(e.target.value)}
                                        placeholder={isGeneratingMetadata ? "Generando título..." : "Título para la colección"}
                                        className="w-full p-2 bg-neutral-700 border border-neutral-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors placeholder-neutral-500 text-neutral-100"
                                        disabled={isProcessing || isGeneratingMetadata}
                                    />
                                    {/* Removed floating spinner for cleaner loading UI */}
                                </div>
                            </div>
                            <div>
                                <label htmlFor="asignatura-input" className="block text-sm font-medium text-neutral-300 mb-1">Asignatura</label>
                                <div className="relative">
                                    <input
                                        id="asignatura-input"
                                        type="text"
                                        value={asignatura}
                                        onChange={(e) => setAsignatura(e.target.value)}
                                        placeholder={isGeneratingMetadata ? "Generando sugerencia..." : "Ej: Biología Celular"}
                                        className="w-full p-2 bg-neutral-700 border border-neutral-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors placeholder-neutral-500 text-neutral-100"
                                        disabled={isProcessing || isGeneratingMetadata}
                                    />
                                    {/* Removed floating spinner for cleaner loading UI */}
                                </div>
                            </div>
                            <div className="md:col-span-2">
                                <label htmlFor="categoria-input" className="block text-sm font-medium text-neutral-300 mb-1">Categoría</label>
                                <input
                                    id="categoria-input"
                                    type="text"
                                    value={categoria}
                                    onChange={(e) => setCategoria(e.target.value)}
                                    placeholder="Propósito (Ej: Examen Parcial, Actividad de Repaso). El usuario define esto."
                                    className="w-full p-2 bg-neutral-700 border border-neutral-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors placeholder-neutral-500 text-neutral-100"
                                    disabled={isProcessing}
                                />
                            </div>
                            <div className="md:col-span-2">
                                <label htmlFor="descripcion-input" className="block text-sm font-medium text-neutral-300 mb-1">Descripción</label>
                                <div className="relative">
                                    <textarea
                                        id="descripcion-input"
                                        value={descripcion}
                                        onChange={(e) => setDescripcion(e.target.value)}
                                        placeholder={isGeneratingMetadata ? "Generando descripción..." : "Una breve descripción del contenido de estudio."}
                                        className="w-full h-24 p-2 bg-neutral-700 border border-neutral-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors placeholder-neutral-500 text-neutral-100 resize-y"
                                        disabled={isProcessing || isGeneratingMetadata}
                                    />
                                    {/* Removed floating spinner for cleaner loading UI */}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className="overflow-auto flex-grow border border-neutral-700 rounded-md bg-neutral-900 min-h-[200px]">
              {generatedQuestions.length === 0 ? (
                 <div className="p-10 text-center text-neutral-400">
                  <p className="italic">Aún no se han generado preguntas.</p>
                  <p>Completa el contexto, añade solicitudes y haz clic en "Procesar Cola", o añade una pregunta manualmente.</p>
                </div>
              ) : (
              <table className="min-w-full text-sm text-left text-neutral-100 table-fixed">
                <thead className="text-xs text-blue-300 uppercase bg-neutral-800 sticky top-0 z-10 border-b-2 border-neutral-700">
                  <tr>
                    <th scope="col" className="px-2 py-3 w-[4%] min-w-[50px] text-center">
                      <input 
                        type="checkbox"
                        className="form-checkbox h-4 w-4 text-blue-500 bg-neutral-700 border-neutral-600 rounded focus:ring-blue-500 focus:ring-offset-0 focus:ring-offset-transparent"
                        checked={areAllQuestionsSelected}
                        onChange={handleSelectAllToggle}
                        aria-label="Seleccionar todas las preguntas"
                        disabled={isProcessing}
                      />
                    </th>
                    <th scope="col" className="px-3 py-3 w-[5%] min-w-[70px] break-words">Tipo</th>
                    {CSV_HEADERS.map(header => {
                        let thClassName = "px-3 py-3 break-words ";
                        switch (header) {
                            case "Pregunta":
                                thClassName += "w-[20%] min-w-[200px]";
                                break;
                            case "Explicación":
                                thClassName += "w-[20%] min-w-[200px]";
                                break;
                            case "Tipo":
                            case "Opción correcta 1":
                            case "Opción Correcta 2":
                            case "Opción Correcta 3":
                            case "Opción Incorrecta 1":
                            case "Opción Incorrecta 2":
                            case "Opción Incorrecta 3":
                                thClassName += "w-[7%] min-w-[110px]"; 
                                break;
                            default: 
                                thClassName += "w-auto min-w-[100px]";
                        }
                        return (
                          <th key={header} scope="col" className={thClassName}>{header}</th>
                        );
                    })}
                    <th scope="col" className="px-3 py-3 w-[6%] min-w-[80px]">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {generatedQuestions.map((q) => {
                    const typeInfo = getQuestionTypeInfo(q);
                    const isRowExpanded = expandedQuestionId === q.id;
                    const isSelected = isQuestionSelected(q.id);
                    return (
                    <tr 
                        key={q.id} 
                        id={q.id} // Added ID for scrolling
                        className={`${isSelected ? 'bg-neutral-700' : 'bg-neutral-900'} border-b border-neutral-800 hover:bg-neutral-800 transition-colors group ${typeInfo.type === QuestionDisplayType.Unknown ? 'outline outline-2 outline-red-500' : ''}`}
                    >
                      <td className="px-2 py-1 align-top text-center" onClick={(e: React.MouseEvent<HTMLTableCellElement>) => { e.stopPropagation(); handleRowSelectionToggle(q.id, e.nativeEvent.shiftKey); }}>
                        <input
                          type="checkbox"
                          className="form-checkbox h-4 w-4 text-blue-500 bg-neutral-700 border-neutral-600 rounded focus:ring-blue-500 focus:ring-offset-0 focus:ring-offset-transparent cursor-pointer"
                          checked={isSelected}
                          readOnly // The state is controlled by the td's onClick
                          aria-label={`Seleccionar pregunta: ${q.Pregunta.substring(0, 50)}`}
                          disabled={isProcessing}
                        />
                      </td>
                      <td className="px-2 py-1 align-top cursor-pointer" title={typeInfo.description} onClick={() => handleRowExpandToggle(q.id)}>
                          <div className="flex items-center gap-1.5">
                            {typeInfo.icon}
                            <span className={`text-xs font-medium ${typeInfo.colorClass}`}>{typeInfo.label}</span>
                          </div>
                      </td>
                      {CSV_HEADERS.map(header => {
                         const fieldKey = CSV_HEADER_TO_QUESTION_DATA_KEY_MAP[header];
                         const cellBaseClasses = "text-neutral-200 min-h-[3em]"; 
                         const cellDynamicClasses = isRowExpanded 
                            ? "whitespace-pre-wrap break-words" 
                            : "truncate-3-lines"; 
                         return (
                            <td key={`${q.id}-${header}`} className="px-2 py-1 align-top cursor-pointer" onClick={() => handleRowExpandToggle(q.id)}>
                                <div onClick={(e) => e.stopPropagation()}> 
                                    <EditableCell
                                        value={q[fieldKey]}
                                        onSave={(newValue) => handleQuestionEdit(q.id, fieldKey, newValue)}
                                        multiline={fieldKey === 'Pregunta' || fieldKey === 'Explicación'}
                                        className={`${cellBaseClasses} ${cellDynamicClasses}`}
                                        placeholder={header}
                                        isInitiallyEditing={q.Pregunta === '' && fieldKey === 'Pregunta'} // Auto-edit if new manual question
                                    />
                                </div>
                            </td>
                         );
                      })}
                      <td className="px-2 py-1 align-top text-center">
                        <div onClick={(e) => e.stopPropagation()}> 
                            <button 
                                onClick={() => handleDeleteGeneratedQuestion(q.id)}
                                disabled={isProcessing}
                                className="p-1.5 text-red-400 hover:text-red-300 disabled:text-neutral-500 disabled:cursor-not-allowed"
                                title="Eliminar esta pregunta"
                            >
                                <TrashIcon className="w-5 h-5"/>
                            </button>
                        </div>
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
              )}
            </div>
          </div>
        </section>
      </main>
      <footer className="w-full mt-12 text-center text-sm text-neutral-400">
        <p>Desarrollado con React, TypeScript, Tailwind CSS y Gemini API.</p>
        <p>
          {currentStoredUserApiKey 
            ? "Usando clave API proporcionada por el usuario." 
            : (process.env.API_KEY ? "Usando clave API del entorno." : "Advertencia: Clave API no configurada.")
          }
           Puedes cambiar esto en <button onClick={handleOpenConfigModal} className="underline hover:text-blue-300">Configuración</button>.
        </p>
      </footer>
    </div>
  );
};

export default App;
