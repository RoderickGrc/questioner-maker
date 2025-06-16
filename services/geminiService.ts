
import { GoogleGenAI, GenerateContentResponse, Part } from "@google/genai";
import { GEMINI_MODEL_TEXT, MAX_JSON_CORRECTION_ATTEMPTS, REWRITE_QUESTIONS_FILENAME } from '../constants';
import { QuestionData, LogType } from "../types"; 

type AddLogEntryFn = (type: LogType, message: string, details?: any) => void;
type SetLiveStreamContentFn = (chunk: string, replace?: boolean) => void;

const fileToGenerativePart = async (file: File, addLogEntry: AddLogEntryFn): Promise<Part | { error: string, fileName: string }> => {
  try {
    const base64EncodedDataPromise = new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
          if (reader.result) {
              resolve((reader.result as string).split(',')[1]);
          } else {
              reject(new Error("Error al leer el archivo: el resultado es nulo."));
          }
      };
      reader.onerror = (error) => reject(new Error(`Error en FileReader: ${error}`));
      reader.readAsDataURL(file);
    });
    const base64EncodedData = await base64EncodedDataPromise;

    let effectiveMimeType = file.type;
    const fileNameLower = file.name.toLowerCase();

    if (!effectiveMimeType || effectiveMimeType === "application/octet-stream") {
      if (fileNameLower.endsWith('.md')) {
        effectiveMimeType = 'text/markdown';
      } else if (fileNameLower.endsWith('.txt')) {
        effectiveMimeType = 'text/plain';
      } else if (fileNameLower.endsWith('.csv')) {
        effectiveMimeType = 'text/csv';
      } else if (fileNameLower.endsWith('.json')) {
        // Even for JSON, if we are not embedding it and sending as a part, this would be correct.
        // However, for REWRITE_QUESTIONS_FILENAME, we will embed its content in the prompt.
        effectiveMimeType = 'application/json'; 
      }
      if (effectiveMimeType !== file.type){
         addLogEntry(LogType.FileProcessing, `MIME type para "${file.name}" (original: "${file.type || 'ninguno'}") se estableció a "${effectiveMimeType}" por extensión.`);
      }
    }

    if (!effectiveMimeType) {
        const errorMessage = `No se pudo determinar un tipo MIME válido para el archivo "${file.name}". El navegador reportó: "${file.type || 'ninguno'}". Asegúrese de que el archivo tenga una extensión estándar o que el navegador pueda identificar su tipo.`;
        addLogEntry(LogType.Error, errorMessage, {fileName: file.name, originalMimeType: file.type});
        return { error: errorMessage, fileName: file.name };
    }

    addLogEntry(LogType.FileProcessing, `Archivo "${file.name}" procesado a base64. Usando MIME type: ${effectiveMimeType}.`, {fileName: file.name, mimeType: effectiveMimeType, originalBrowserMimeType: file.type || 'ninguno'});
    return {
      inlineData: {
        mimeType: effectiveMimeType,
        data: base64EncodedData,
      },
    };
  } catch (e: any) {
    addLogEntry(LogType.Error, `Error procesando archivo "${file.name}" a base64.`, {fileName: file.name, error: e.message});
    return { error: e.message, fileName: file.name };
  }
};

const readFileContentAsString = (file: File, addLogEntry: AddLogEntryFn): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            if (event.target && typeof event.target.result === 'string') {
                addLogEntry(LogType.FileProcessing, `Contenido del archivo "${file.name}" leído como texto.`, {fileName: file.name, size: file.size});
                resolve(event.target.result);
            } else {
                addLogEntry(LogType.Error, `Error al leer el contenido del archivo "${file.name}": resultado no es string o target es null.`);
                reject(new Error(`Error al leer el contenido del archivo "${file.name}"`));
            }
        };
        reader.onerror = (error) => {
            addLogEntry(LogType.Error, `Error de FileReader al leer "${file.name}" como texto.`, {fileName: file.name, error});
            reject(error);
        };
        reader.readAsText(file);
    });
};

const constructInitialPrompt = (
    generalContextText: string,
    generalContextFilesForNotice: File[], // Only for generating file notice string
    requestPrompt: string,
    requestSpecificFilesForNotice: File[], // Only for generating file notice string (excluding rewrite file)
    processedFileErrorMessages: string[],
    rewriteJsonContent?: string, // Content of questions_to_rewrite.json, if present
    existingQuestionsCsv?: string, 
    overallRetryError?: string
): string => {
    let generalFilesNotice = "";
    if (generalContextFilesForNotice.length > 0) {
        const fileNames = generalContextFilesForNotice.map(f => `"${f.name}"`).join(', ');
        generalFilesNotice = `The following general context files have been provided. Their content is crucial for your response: [${fileNames}]. You must base your answers on this information.\n`;
    }

    let requestFilesNotice = "";
    if (requestSpecificFilesForNotice.length > 0) {
        const fileNames = requestSpecificFilesForNotice.map(f => `"${f.name}"`).join(', ');
        requestFilesNotice = `Additionally, for this specific request, the user has attached: [${fileNames}]. Consider these files with high priority for this request.\n`;
    }
    
    let fileProcessingErrorsNotice = "";
    if (processedFileErrorMessages.length > 0) {
        fileProcessingErrorsNotice = "NOTICE: Some files could not be processed and their content is unavailable:\n" + processedFileErrorMessages.map(msg => `- ${msg}`).join('\n') + "\n";
    }

    let existingQuestionsContext = "";
    if (existingQuestionsCsv && existingQuestionsCsv.trim() !== '' && existingQuestionsCsv.split('\n').length > 1) { 
        existingQuestionsContext = `Contexto Adicional: Banco de Preguntas Existente (formato CSV interno para tu referencia. NO intentes replicar este formato CSV en tu salida JSON, sigue usando la estructura JSON con "" para campos vacíos):\n---\n${existingQuestionsCsv}\n---\nConsidera estas preguntas para evitar duplicados y generar contenido complementario o diferente.\n`;
    }

    let rewriteInstructions = "";
    if (rewriteJsonContent) {
        rewriteInstructions = `
ADEMÁS, esta es una SOLICITUD DE REESCRITURA.
Se te proporcionan las siguientes preguntas en formato JSON array. Debes procesar cada pregunta de este array.
--- INICIO DE JSON DE PREGUNTAS A REESCRIBIR ---
${rewriteJsonContent}
--- FIN DE JSON DE PREGUNTAS A REESCRIBIR ---

Para cada pregunta en el JSON anterior:
1.  Reescríbela basándote en la "Instrucción específica para esta tanda de preguntas" (que es: "${requestPrompt}").
2.  En tu respuesta JSON, DEBES incluir el campo "id" ORIGINAL de la pregunta que estás reescribiendo.
    Ejemplo de objeto reescrito: { "id": "id-original-de-la-pregunta", "Pregunta": "...", ... }
Si, además de reescribir, decides generar preguntas COMPLETAMENTE NUEVAS (no basadas en las del JSON anterior), para estas preguntas NUEVAS, NO incluyas un campo "id" en el objeto JSON, o establécelo a null. El sistema les asignará un ID nuevo.
`;
    }


    const questionObjectStructure = `{
  "id": "string_or_null (SOLO para preguntas REESCRITAS, usa el ID original. Para preguntas NUEVAS, omite este campo o usa null)",
  "Pregunta": "string (texto de la pregunta)",
  "Opción correcta 1": "string (texto de la opción)",
  "Opción Correcta 2": "string_or_empty_string", 
  "Opción Correcta 3": "string_or_empty_string", 
  "Opción Incorrecta 1": "string_or_empty_string", 
  "Opción Incorrecta 2": "string_or_empty_string", 
  "Opción Incorrecta 3": "string_or_empty_string", 
  "Explicación": "string_or_empty_string" 
}`;

    return `Eres un asistente experto en crear material de estudio para la plataforma "Questioner Base".
Tu tarea es generar preguntas basadas en el contexto y las instrucciones proporcionadas.
DEBES responder ÚNICAMENTE con un array JSON. Cada objeto en el array representa una pregunta.
NO incluyas NADA de texto fuera del array JSON (ni introducciones, ni despedidas, ni explicaciones adicionales fuera del JSON).

La estructura de cada objeto JSON de pregunta DEBE ser la siguiente:
${questionObjectStructure}

${rewriteJsonContent ? rewriteInstructions : ''}

Campos Opcionales: Si un campo opcional (como 'Opción Correcta 2', 'Opción Incorrecta 1', etc.) no se utiliza para una pregunta específica, establece su valor a una cadena vacía \`""\`. NO uses \`null\` para estos campos de opciones/explicación.

**Explicaciones Detalladas y Obligatorias:** Siempre DEBES incluir una 'Explicación' para cada pregunta. Esta explicación debe ser lo más detallada posible, basándose exhaustivamente en el material de contexto proporcionado. Si el material no ofrece una explicación directa para una pregunta particular, genera una explicación concisa pero informativa tú mismo. La 'Explicación' NUNCA debe ser \`null\`; usa una cadena vacía \`""\` solo si es absolutamente imposible generar cualquier forma de explicación (lo cual debería ser raro). Esfuérzate por utilizar la mayor cantidad de tokens necesarios para que las explicaciones sean completas y útiles, sin ser innecesariamente verbosas.

${generalFilesNotice}
Contexto general proporcionado (texto):
---
${generalContextText || "No se proporcionó contexto general en formato texto."}
---

${requestFilesNotice}
${existingQuestionsContext}
Instrucción específica para esta tanda de preguntas: "${requestPrompt}" 
${rewriteJsonContent ? `(Nota: Para la reescritura, esta es la instrucción principal que debes seguir para modificar las preguntas del JSON proporcionado.)` : ''}


${fileProcessingErrorsNotice}

Tipos de preguntas y cómo definirlas en JSON:
-   Pregunta de Selección Única: Solo 'Opción correcta 1' tiene valor. 'Opción Correcta 2' y 'Opción Correcta 3' deben ser \`""\`. Incluye al menos una opción incorrecta con valor (o \`""\` si no aplica).
-   Pregunta de Selección Múltiple: 'Opción correcta 1' Y TAMBIÉN 'Opción Correcta 2' (y/o 'Opción Correcta 3') tienen valor.
-   Pregunta de Tipo Verdadero/Falso: Selección única. 'Opción correcta 1' (ej. "Verdadero"), 'Opción Incorrecta 1' (ej. "Falso"). Resto de opciones \`""\`.
-   Pregunta de Respuesta Escrita: Solo 'Opción correcta 1' tiene valor, que debe ser MUY CORTO (1 a 3 palabras máximo, idealmente solo 1). TODAS las opciones incorrectas DEBEN ser \`""\`.

Conformación de las preguntas y opciones:
-   Las opciones de respuesta SIEMPRE (a menos que sea la transcripción de preguntas añadidas por el usuario) deben muy breves, centrándose en colocar el nombre de los términos usando entre 1 a 4 palabras.
-   Cuando hay necesidad de poner opciones de respuesta largas, la respuesta correcta NO puede ser más larga que las incorrectas debido a que por simple inspección o descarte se puede adivinar la opción correcta. Todas las opciones deben tener un tamaño similar.
-   Las respuestas de escritura NUNCA pueden ser textos largos, céntrate en hacerlas con el nombre del término y su definición o contenido dentro del campo de Pregunta.

${overallRetryError ? `\n¡ATENCIÓN! UN INTENTO ANTERIOR GLOBAL PARA ESTA SOLICITUD FALLÓ: "${overallRetryError}". Por favor, intenta generar las preguntas de nuevo, prestando especial atención a las instrucciones y al formato JSON.\n` : ''}

Genera un conjunto de preguntas que cumplan con la instrucción específica y el contexto proporcionado. El número de preguntas puede variar, pero prioriza la calidad y la cobertura del tema solicitado sobre un número fijo. Intenta generar al menos 1-3 preguntas si el material lo permite.
Recuerda, tu respuesta DEBE ser solo el array JSON.

RECUERDA GENERAR EL TIPO DE PREGUNTA QUE EL USUARIO ESPECIFICA LLENANDO LA OPCION CORRECTA/INCORRECTA (OC/OI): 
- Si el usuario dice "Selección única" solo llenarás OC1 y OI1-3 (min. 2).
- Si el usuario dice "Selección múltiple" solo llenarás OC1-3 (min 2) y OI1-3 (min. 1).
- Si el usuario dice "verdadero o falso" solo llenarás OC1 y OC2.
- Si el usuario dice "respuesta libre" o "escrita" solo llenarás OC1 con contenido corto.
`;
};

const constructJsonCorrectionPrompt = (
    faultyJsonOutput: string,
    parsingErrorDetails: string
): string => {
    const questionObjectStructure = `{
  "id": "string_or_null (SOLO para preguntas REESCRITAS, usa el ID original. Para preguntas NUEVAS, omite este campo o usa null)",
  "Pregunta": "string",
  "Opción correcta 1": "string",
  "Opción Correcta 2": "string_or_empty_string", 
  "Opción Correcta 3": "string_or_empty_string",
  "Opción Incorrecta 1": "string_or_empty_string",
  "Opción Incorrecta 2": "string_or_empty_string",
  "Opción Incorrecta 3": "string_or_empty_string",
  "Explicación": "string_or_empty_string" 
}`;
    return `Tu tarea anterior era generar un array JSON de preguntas, pero hubo un error en el formato de tu respuesta.

El error detectado fue: "${parsingErrorDetails}"

La respuesta ANTERIOR que generaste y que necesita CORRECCIÓN es:
---
${faultyJsonOutput}
---

Por favor, corrige ÚNICAMENTE el formato JSON de la respuesta anterior.
Asegúrate de que la respuesta sea un array JSON VÁLIDO.
Cada objeto en el array DEBE seguir esta estructura:
${questionObjectStructure}

NO generes preguntas nuevas. NO cambies el contenido sustancial de las preguntas si no es estrictamente necesario para corregir el formato JSON.
Verifica comillas, comas, llaves y corchetes para asegurar que el JSON sea válido.
Si un campo opcional no se usa, usa una cadena vacía \`""\`. NO uses \`null\` para campos de opciones/explicación. Para el campo "id", sigue las instrucciones: ID original para reescritas, null u omitido para nuevas.
La 'Explicación' es obligatoria y debe ser una cadena (puede ser \`""\` si es imposible una explicación).


Vuelve a generar la respuesta COMPLETA, con el formato JSON corregido. Solo el array JSON.
`;
};


export const generateQuestionsFromGemini = async (
  apiKey: string,
  generalContextText: string,
  generalContextFiles: File[], 
  requestPrompt: string,
  requestSpecificFiles: File[], 
  addLogEntry: AddLogEntryFn,
  setLiveStreamContent: SetLiveStreamContentFn,
  existingQuestionsCsv?: string, 
  overallAttemptError?: string
): Promise<{ rawText: string; parsedQuestions: QuestionData[]; jsonCorrectionAttempts: number }> => {
  if (!apiKey) { 
    addLogEntry(LogType.Error, "generateQuestionsFromGemini: API_KEY no fue proporcionada al servicio Gemini.");
    throw new Error("API_KEY no fue proporcionada al servicio Gemini.");
  }

  const ai = new GoogleGenAI({ apiKey });

  let jsonCorrectionAttempts = 0;
  let lastGeminiRawOutput = "";
  let lastJsonErrorForReprompt: string | undefined;

  const currentParts: Part[] = [];
  const processedFileErrorMessages: string[] = [];
  let rewriteJsonFileContent: string | undefined = undefined;

  // Consolidate files and identify the rewrite file
  const allFilesForProcessing = [...(generalContextFiles || []), ...(requestSpecificFiles || [])];
  const uniqueFilesForProcessing = allFilesForProcessing.filter((file, index, self) => 
    index === self.findIndex((f) => f.name === file.name && f.lastModified === file.lastModified && f.size === file.size)
  );

  const filesForPromptNoticeAndParts: File[] = [];

  for (const file of uniqueFilesForProcessing) {
    if (file.name === REWRITE_QUESTIONS_FILENAME) {
      try {
        rewriteJsonFileContent = await readFileContentAsString(file, addLogEntry);
        addLogEntry(LogType.Info, `Contenido de "${REWRITE_QUESTIONS_FILENAME}" leído y preparado para ser embebido en el prompt.`, {size: file.size});
        // Do not add REWRITE_QUESTIONS_FILENAME to filesForPromptNoticeAndParts as it's handled differently
      } catch (e:any) {
        const errorMsg = `Error al leer el archivo de reescritura "${file.name}": ${e.message}`;
        addLogEntry(LogType.Error, errorMsg, {fileName: file.name});
        processedFileErrorMessages.push(errorMsg);
      }
    } else {
      filesForPromptNoticeAndParts.push(file); // This file will be processed into a Part
    }
  }

  for (const file of filesForPromptNoticeAndParts) {
    const filePartOrError = await fileToGenerativePart(file, addLogEntry);
    if ('error' in filePartOrError) {
        processedFileErrorMessages.push(`${file.name}: ${filePartOrError.error}`);
    } else {
      currentParts.unshift(filePartOrError); // Prepend so text prompt is last
    }
  }
  
  // For notices, we filter out rewrite file from specific files, general files remain as is.
  const specificFilesForNotice = (requestSpecificFiles || []).filter(f => f.name !== REWRITE_QUESTIONS_FILENAME);

  const initialPromptText = constructInitialPrompt(
    generalContextText,
    generalContextFiles || [], // For general context notice
    requestPrompt,
    specificFilesForNotice, // For specific request notice (excluding rewrite file)
    processedFileErrorMessages,
    rewriteJsonFileContent, // Pass the content of the rewrite file
    existingQuestionsCsv, 
    overallAttemptError
  );
  
  const initialContentRequestParts = [...currentParts, { text: initialPromptText }];

  try {
    addLogEntry(LogType.GeminiRequest, `Solicitud inicial (streaming) a Gemini (intento general ${overallAttemptError ? 'con reintento' : '1'})`, { 
        promptLength: initialPromptText.length, 
        filesAttachedAsParts: currentParts.filter(p => !!p.inlineData).length, 
        isRewrite: !!rewriteJsonFileContent,
        existingQuestionsContextProvided: !!existingQuestionsCsv, 
        processedFileErrorMessages,
        // promptPreview: initialPromptText.substring(0, 500) // Log first 500 chars of prompt
    });
    setLiveStreamContent('', true); 

    const responseStream = await ai.models.generateContentStream({
        model: GEMINI_MODEL_TEXT,
        contents: [{ parts: initialContentRequestParts }],
        config: {
             responseMimeType: "application/json",
        }
    });

    let aggregatedStreamOutput = "";
    for await (const chunk of responseStream) {
      const chunkText = chunk.text;
      if (chunkText) {
        aggregatedStreamOutput += chunkText;
        setLiveStreamContent(chunkText, false); 
        addLogEntry(LogType.GeminiStream, "Chunk recibido de Gemini", { chunkLength: chunkText.length });
      }
    }
    lastGeminiRawOutput = aggregatedStreamOutput;
    addLogEntry(LogType.GeminiResponse, `Stream de Gemini finalizado. Contenido agregado (longitud: ${lastGeminiRawOutput.length})`, { aggregatedResponsePreview: lastGeminiRawOutput.substring(0, 300) + (lastGeminiRawOutput.length > 300 ? "..." : "") });

  } catch (streamError: any) {
     addLogEntry(LogType.Error, `Error durante el streaming inicial de Gemini.`, { error: streamError.message, stack: streamError.stack, promptLength: initialPromptText.length });
     throw streamError; 
  }


  while (jsonCorrectionAttempts < MAX_JSON_CORRECTION_ATTEMPTS) {
    try {
        if (jsonCorrectionAttempts > 0) { 
            const correctionPromptText = constructJsonCorrectionPrompt(lastGeminiRawOutput, lastJsonErrorForReprompt || "Error de parseo desconocido");
            addLogEntry(LogType.GeminiRequest, `Corrección JSON intento ${jsonCorrectionAttempts + 1}. Error anterior: ${lastJsonErrorForReprompt}`, { promptLength: correctionPromptText.length });
            
            const correctionResponse: GenerateContentResponse = await ai.models.generateContent({
                model: GEMINI_MODEL_TEXT,
                contents: [{ parts: [{text: correctionPromptText}] }], 
                config: { responseMimeType: "application/json" }
            });
            lastGeminiRawOutput = correctionResponse.text;
            addLogEntry(LogType.GeminiResponse, `Respuesta de corrección de Gemini recibida (intento ${jsonCorrectionAttempts + 1})`, { responseLength: lastGeminiRawOutput.length, responsePreview: lastGeminiRawOutput.substring(0,300) });
        }
        
        if (!lastGeminiRawOutput || lastGeminiRawOutput.trim() === '') {
            const errorMsg = "Gemini devolvió una respuesta JSON vacía.";
            addLogEntry(LogType.Error, errorMsg, { attempt: jsonCorrectionAttempts });
             if (jsonCorrectionAttempts >= 0 ) { // Always allow retry if empty, even first time
                lastJsonErrorForReprompt = errorMsg; 
                jsonCorrectionAttempts++; 
                continue; 
            } else { 
                throw new Error(errorMsg);
            }
        }
        
        let jsonStrToParse = lastGeminiRawOutput.trim();
        const fenceRegex = /^```(?:json)?\s*\n?(.*?)\n?\s*```$/s;
        const match = jsonStrToParse.match(fenceRegex);
        if (match && match[1]) {
            jsonStrToParse = match[1].trim();
            addLogEntry(LogType.Info, "Markdown JSON code fence detectado y removido.", { originalLength: lastGeminiRawOutput.length, cleanedLength: jsonStrToParse.length });
        }

        const parsedData = JSON.parse(jsonStrToParse);

        if (!Array.isArray(parsedData)) {
            throw new Error(`La respuesta JSON no es un array. Recibido: ${typeof parsedData}`);
        }

        const parsedQuestions: QuestionData[] = [];
        for (const [i, item] of (parsedData as any[]).entries()) {
            if (typeof item !== 'object' || item === null) {
                throw new Error(`Item ${i} en el array JSON no es un objeto.`);
            }
            
            const itemPregunta = item.Pregunta;
            const itemOpcionCorrecta1 = item['Opción correcta 1'];
            
            if (typeof itemPregunta !== 'string' || itemPregunta.trim() === '' ||
                typeof itemOpcionCorrecta1 !== 'string' || itemOpcionCorrecta1.trim() === '') {
                 throw new Error(`Item ${i} (${itemPregunta ? itemPregunta.substring(0,20) + "..." : "Pregunta Vacía" }) en el array JSON no tiene los campos requeridos 'Pregunta' y 'Opción correcta 1' como strings no vacíos.`);
            }
            
            const itemExplicacion = (item.Explicación === null || item.Explicación === undefined) ? "" : String(item.Explicación);
             if (item.Explicación === null || item.Explicación === undefined){
                 addLogEntry(LogType.Warning, `Item ${i}: Gemini omitió 'Explicación' o envió null/undefined, se usó "".`, {itemPreview: item.Pregunta.substring(0,50)});
            }

            const itemIdFromGemini = item.id; 
            let finalId: string;
            let questionTypeLog: string;

            if (typeof itemIdFromGemini === 'string' && itemIdFromGemini.trim() !== '') {
                finalId = itemIdFromGemini; 
                questionTypeLog = "Pregunta REESCRITA (ID original preservado)";
            } else {
                finalId = `gen-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`; 
                questionTypeLog = "Pregunta NUEVA (ID nuevo generado)";
            }
            addLogEntry(LogType.Info, `${questionTypeLog}: ${finalId}`, {itemPreview: item.Pregunta.substring(0,50)});


            const questionEntry: QuestionData = {
                id: finalId,
                Pregunta: itemPregunta,
                'Opción correcta 1': itemOpcionCorrecta1,
                'Opción Correcta 2': (item['Opción Correcta 2'] === null || item['Opción Correcta 2'] === undefined) ? undefined : String(item['Opción Correcta 2']),
                'Opción Correcta 3': (item['Opción Correcta 3'] === null || item['Opción Correcta 3'] === undefined) ? undefined : String(item['Opción Correcta 3']),
                'Opción Incorrecta 1': (item['Opción Incorrecta 1'] === null || item['Opción Incorrecta 1'] === undefined) ? undefined : String(item['Opción Incorrecta 1']),
                'Opción Incorrecta 2': (item['Opción Incorrecta 2'] === null || item['Opción Incorrecta 2'] === undefined) ? undefined : String(item['Opción Incorrecta 2']),
                'Opción Incorrecta 3': (item['Opción Incorrecta 3'] === null || item['Opción Incorrecta 3'] === undefined) ? undefined : String(item['Opción Incorrecta 3']),
                Explicación: itemExplicacion,
            };
            parsedQuestions.push(questionEntry);
        }
        
        if (parsedData.length > 0 && parsedQuestions.length === 0) {
             throw new Error("El array JSON fue recibido, pero ningún objeto cumplió la estructura esperada para las preguntas.");
        }
         if (parsedQuestions.length === 0 && parsedData.length === 0 && jsonStrToParse.trim() !== '' && jsonStrToParse.trim() !== '[]') {
            throw new Error(`Gemini no generó ninguna pregunta válida en el JSON. JSON parseado resultó en 0 preguntas. Contenido parseado: ${jsonStrToParse.substring(0,200)}...`);
        }
         if (parsedQuestions.length === 0 && jsonStrToParse.trim() === '[]') { 
             addLogEntry(LogType.Info, "Gemini devolvió un array JSON vacío '[]', lo que significa que no generó preguntas para esta solicitud.", {promptContext: jsonCorrectionAttempts > 0 ? "Corrección" : "Inicial"});
         }

        addLogEntry(LogType.Info, `JSON parseado y validado exitosamente. ${parsedQuestions.length} preguntas generadas/reescritas.`, { count: parsedQuestions.length });
        return { rawText: lastGeminiRawOutput, parsedQuestions, jsonCorrectionAttempts };

    } catch (error: any) {
        const promptContextForLog = jsonCorrectionAttempts > 0 ? "Corrección JSON" : "Parseo de Stream Inicial";
        addLogEntry(LogType.Error, `Error durante ${promptContextForLog} (intento corrección ${jsonCorrectionAttempts + 1}/${MAX_JSON_CORRECTION_ATTEMPTS})`, { error: error.message, stack: error.stack, rawOutputPreview: lastGeminiRawOutput.substring(0,500) });
        lastJsonErrorForReprompt = error.message;
    }
    
    jsonCorrectionAttempts++;
  }

  const finalErrorMsg = `Fallaron todos los ${MAX_JSON_CORRECTION_ATTEMPTS} intentos de corrección de formato JSON para la solicitud "${requestPrompt.substring(0,50)}...". Último error: ${lastJsonErrorForReprompt || "Error desconocido después de múltiples intentos."}`;
  addLogEntry(LogType.Error, finalErrorMsg, { prompt: requestPrompt, finalOutputPreview: lastGeminiRawOutput.substring(0, 500) });
  throw new Error(`${finalErrorMsg}. Respuesta final de Gemini: "${lastGeminiRawOutput.substring(0, 300)}..."`);
};


export const generateCollectionTitleFromGemini = async (
    apiKey: string,
    sampleQuestionsText: string,
    addLogEntry: AddLogEntryFn
): Promise<string> => {
    if (!apiKey) {
        addLogEntry(LogType.Error, "generateCollectionTitleFromGemini: API_KEY no fue proporcionada.");
        throw new Error("API_KEY no fue proporcionada para generar título.");
    }
    if (!sampleQuestionsText || sampleQuestionsText.trim() === "") {
        addLogEntry(LogType.Warning, "generateCollectionTitleFromGemini: No se proporcionó texto de muestra de preguntas.");
        return "Colección de Preguntas"; // Default title if no sample
    }

    const ai = new GoogleGenAI({ apiKey });

    const prompt = `Basándote en la siguiente muestra de preguntas, genera un título conciso y descriptivo para esta colección de preguntas. El título debe ser adecuado para un cuestionario o un conjunto de estudio. Responde únicamente con el texto del título. No incluyas prefijos como "Título:" ni comillas adicionales.

Muestra de preguntas:
---
${sampleQuestionsText}
---
`;
    try {
        addLogEntry(LogType.GeminiRequest, "Solicitando a Gemini la generación de un título para la colección.", { sampleLength: sampleQuestionsText.length });
        const response: GenerateContentResponse = await ai.models.generateContent({
            model: GEMINI_MODEL_TEXT,
            contents: prompt,
        });
        
        const title = response.text.trim();
        if (!title) {
            addLogEntry(LogType.Warning, "Gemini devolvió un título vacío para la colección.", { sample: sampleQuestionsText });
            return "Colección de Preguntas"; // Fallback
        }
        addLogEntry(LogType.GeminiResponse, "Título de colección generado por Gemini.", { title });
        return title;
    } catch (error: any) {
        addLogEntry(LogType.Error, "Error al generar título de colección con Gemini.", { error: error.message, sample: sampleQuestionsText });
        console.error("Error generating collection title:", error);
        throw new Error(`Error al generar título de colección: ${error.message}`);
    }
};
