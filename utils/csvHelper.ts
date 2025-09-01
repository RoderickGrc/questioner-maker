import { QuestionData, CSV_HEADERS } from '../types';

// Robust CSV line parser considering quotes
export function parseCsvLineRobust(line: string): string[] {
    const fields: string[] = [];
    let currentField = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
                // Escaped double quote
                currentField += '"';
                i++; // Skip next quote
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            fields.push(currentField);
            currentField = "";
        } else {
            currentField += char;
        }
    }
    fields.push(currentField); // Add the last field

    // Trim fields if they were not quoted, or if quotes were only for containing commas
    return fields.map(field => {
        if (field.startsWith('"') && field.endsWith('"')) {
            // Remove outer quotes and unescape inner double quotes
            return field.substring(1, field.length - 1).replace(/""/g, '"');
        }
        return field.trim();
    });
}


export function generateCsvString(questions: QuestionData[]): string {
  const escapeCsvField = (fieldValue?: string): string => {
    if (fieldValue === null || typeof fieldValue === 'undefined' || fieldValue === "") {
      return ''; // Ensure undefined, null, and explicitly empty strings become empty fields
    }
    const stringField = String(fieldValue);
    // If the field contains a comma, double quote, or newline, wrap it in double quotes
    // and escape any existing double quotes by doubling them.
    if (stringField.includes(',') || stringField.includes('"') || stringField.includes('\n')) {
      return `"${stringField.replace(/"/g, '""')}"`;
    }
    return stringField;
  };

  const headerRow = CSV_HEADERS.join(',');
  const dataRows = questions.map(q => [
    escapeCsvField(q.Pregunta),
    escapeCsvField(q['Opción correcta 1']),
    escapeCsvField(q['Opción Correcta 2']),
    escapeCsvField(q['Opción Correcta 3']),
    escapeCsvField(q['Opción Incorrecta 1']),
    escapeCsvField(q['Opción Incorrecta 2']),
    escapeCsvField(q['Opción Incorrecta 3']),
    escapeCsvField(q.Explicación),
  ].join(','));

  return [headerRow, ...dataRows].join('\n');
}

export function generateJsonString(
    questions: QuestionData[],
    collectionTitle: string,
    asignatura: string,
    categoria: string,
    descripcion: string
): string {
    const exportData = {
        "Nombre de Colección": collectionTitle || "Colección de Preguntas",
        "Asignatura": asignatura,
        "Categoría": categoria,
        "Descripción": descripcion,
        questions: questions,
    };
    return JSON.stringify(exportData, null, 2); // Pretty print JSON
}

// Build export filename using collection title: haiku_[titulo].ext
export function buildExportFilename(collectionTitle: string, ext: 'json' | 'csv'): string {
  const base = (collectionTitle && collectionTitle.trim() !== '') ? collectionTitle : 'coleccion';
  // Normalize, remove diacritics, replace non-alphanumerics with underscores, collapse repeats
  const sanitized = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 80); // keep it reasonable
  return `haiku_${sanitized || 'coleccion'}.${ext}`;
}

function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const link = document.createElement('a');
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

export function downloadCsvFile(csvString: string, filename: string): void {
  downloadFile(csvString, filename, 'text/csv;charset=utf-8;');
}

export function downloadJsonFile(jsonString: string, filename: string): void {
    downloadFile(jsonString, filename, 'application/json;charset=utf-8;');
}
