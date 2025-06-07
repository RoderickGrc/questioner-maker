import { useState } from 'react';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Papa from 'papaparse';
import './App.css';

const MODEL = 'gemini-2.5-flash-preview-04-17';

function App() {
  const [apiKey, setApiKey] = useState(import.meta.env.VITE_GEMINI_API_KEY || '');
  const [contextFiles, setContextFiles] = useState([]);
  const [queue, setQueue] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [rows, setRows] = useState([]);

  const addContext = (e) => {
    setContextFiles([...contextFiles, ...Array.from(e.target.files)]);
  };

  const addRequest = () => {
    setQueue([...queue, { prompt: '', files: [] }]);
  };

  const updateRequest = (idx, field, value) => {
    const newQueue = [...queue];
    newQueue[idx][field] = value;
    setQueue(newQueue);
  };

  const removeRequest = (idx) => {
    const newQueue = [...queue];
    newQueue.splice(idx, 1);
    setQueue(newQueue);
  };

  const processQueue = async () => {
    if (!apiKey || processing || queue.length === 0) return;
    setProcessing(true);
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: MODEL });
    let accumulated = [...rows];
    for (let i = 0; i < queue.length; i++) {
      const q = queue[i];
      setProgress((i / queue.length) * 100);
      const contents = [{ text: `${q.prompt}\nReturn a single CSV row following headers:\nPregunta,Opción correcta 1,Opción Correcta 2,Opción Correcta 3,Opción Incorrecta 1,Opción Incorrecta 2,Opción Incorrecta 3,Explicación` }];
      try {
        const result = await model.generateContent({ contents });
        const text = result.response.candidates[0]?.content.parts[0]?.text || '';
        const parsed = Papa.parse(text.trim(), { header: false });
        if (parsed.data && parsed.data.length > 0) {
          accumulated = [...accumulated, parsed.data[0]];
          setRows(accumulated);
        }
      } catch (err) {
        console.error('generation error', err);
      }
    }
    setProgress(100);
    setProcessing(false);
  };

  const downloadCSV = () => {
    const csv = Papa.unparse({
      fields: [
        'Pregunta',
        'Opción correcta 1',
        'Opción Correcta 2',
        'Opción Correcta 3',
        'Opción Incorrecta 1',
        'Opción Incorrecta 2',
        'Opción Incorrecta 3',
        'Explicación'
      ],
      data: rows,
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'questions.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="container">
      <h1>Gemini Question CSV Generator</h1>
      <div className="section">
        <h2>API Key</h2>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Google API Key"
        />
      </div>
      <div className="section">
        <h2>Context</h2>
        <input type="file" multiple onChange={addContext} disabled={processing} />
        <ul>
          {contextFiles.map((f, i) => (
            <li key={i}>{f.name}</li>
          ))}
        </ul>
      </div>
      <div className="section">
        <h2>Request Queue</h2>
        <button onClick={addRequest} disabled={processing}>Add Request</button>
        {queue.map((item, idx) => (
          <div key={idx} className="request">
            <textarea
              value={item.prompt}
              onChange={(e) => updateRequest(idx, 'prompt', e.target.value)}
              placeholder="Prompt"
              disabled={processing}
            />
            <input
              type="file"
              multiple
              disabled={processing}
              onChange={(e) =>
                updateRequest(idx, 'files', Array.from(e.target.files))
              }
            />
            <button onClick={() => removeRequest(idx)} disabled={processing}>Delete</button>
          </div>
        ))}
        <button onClick={processQueue} disabled={processing || queue.length === 0}>Process</button>
      </div>
      {processing && (
        <div className="section">
          <h2>Processing...</h2>
          <progress value={progress} max="100" />
        </div>
      )}
      {rows.length > 0 && (
        <div className="section">
          <h2>Generated Questions</h2>
          <table>
            <thead>
              <tr>
                <th>Pregunta</th>
                <th>Correcta 1</th>
                <th>Correcta 2</th>
                <th>Correcta 3</th>
                <th>Incorrecta 1</th>
                <th>Incorrecta 2</th>
                <th>Incorrecta 3</th>
                <th>Explicación</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={downloadCSV}>Download CSV</button>
        </div>
      )}
    </div>
  );
}

export default App;
