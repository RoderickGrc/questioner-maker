
# Generador CSV de Preguntas para Questioner Base

Una aplicación web para generar bancos de preguntas en formato CSV, compatibles con la plataforma questioner.thecrimsonlegacy.com, utilizando la potencia de la IA de Google Gemini. Facilita la creación de material de estudio a partir de documentos, notas de clase y prompts específicos, agilizando el flujo de trabajo para educadores y creadores de contenido.

## ✨ Características Principales

-   **Generación de Preguntas con IA**: Utiliza el modelo `gemini-1.5-flash` de Google para crear preguntas a partir de un contexto general (texto y archivos) y solicitudes específicas.
-   **Cola de Solicitudes**: Organiza múltiples tareas de generación en una cola para procesarlas en lote de forma ordenada.
-   **Soporte Multimedia**: Carga archivos de contexto (`.txt`, `.md`, `.pdf`, `.json`, `.csv`, imágenes) tanto a nivel general como por solicitud específica.
-   **Editor de Preguntas Interactivo**: Visualiza las preguntas generadas en una tabla, edita cualquier campo en el momento (`in-place editing`), y añade o elimina preguntas manualmente.
-   **Clasificación Automática de Preguntas**: Identifica y etiqueta visualmente el tipo de cada pregunta (Selección Única, Múltiple, Verdadero/Falso, Abierta) basándose en las opciones completadas.
-   **Reescritura Asistida por IA**: Selecciona preguntas existentes y pide a la IA que las reescriba basándote en nuevas instrucciones, preservando su ID para una fácil actualización.
-   **Importación y Exportación CSV**: Carga un banco de preguntas existente desde un archivo CSV y exporta el resultado final en un formato compatible con "Questioner Base".
-   **Acciones en Lote**: Selecciona múltiples preguntas para eliminarlas o enviarlas a reescribir de una sola vez.
-   **Logging y Debugging Avanzado**: Incluye un panel de logs de actividad y un visualizador del stream de Gemini para un seguimiento detallado de todo el proceso.
-   **Configuración Flexible de API Key**: Permite usar una clave de API desde un archivo de entorno (`.env.local`) o guardarla de forma segura en el almacenamiento local del navegador para mayor comodidad.

## 🚀 Cómo Empezar

Sigue estos pasos para ejecutar la aplicación en tu entorno local.

### Prerrequisitos

-   [Node.js](https://nodejs.org/) (versión 18 o superior recomendada)
-   Un API Key de Google Gemini. Puedes obtener una en [Google AI Studio](https://aistudio.google.com/app/apikey).

### Instalación y Ejecución

1.  **Clona el repositorio:**
    ```bash
    git clone <URL_DEL_REPOSITORIO>
    cd questioner-maker
    ```

2.  **Instala las dependencias:**
    ```bash
    npm install
    ```

3.  **Configura tu API Key:**
    -   Crea un archivo llamado `.env.local` en la raíz del proyecto.
    -   Añade la siguiente línea, reemplazando `TU_API_KEY_AQUI` con tu clave real:
        ```
        GEMINI_API_KEY=TU_API_KEY_AQUI
        ```
    -   *Alternativamente, puedes dejar esto en blanco y configurar la clave directamente en la interfaz de la aplicación después de iniciarla.*

4.  **Ejecuta la aplicación en modo de desarrollo:**
    ```bash
    npm run dev
    ```

5.  Abre tu navegador y ve a la dirección que se muestra en la terminal (normalmente `http://localhost:5173`).

## 🛠️ Cómo Usar la Aplicación

1.  **Configura tu API Key**: Al iniciar la app, haz clic en el ícono de engranaje (⚙️) para introducir tu clave de API de Gemini si no la configuraste en el archivo `.env.local`.
2.  **Proporciona el Contexto General (Opcional)**: En la sección "1. Contexto General", pega texto o sube archivos (notas de clase, PDFs, etc.) que servirán como base de conocimiento para todas las preguntas que se generen.
3.  **Añade Solicitudes a la Cola**: En la sección "2. Cola de Solicitudes", escribe un *prompt* o instrucción específica (ej: "Crea 5 preguntas de selección única sobre el sistema solar"). Puedes adjuntar archivos relevantes solo para esa solicitud. Haz clic en "Añadir a Cola". Repite este paso para crear múltiples lotes de preguntas.
4.  **Inicia la Generación**: Una vez que tengas una o más solicitudes en la cola, haz clic en el botón verde "Generar Preguntas". La aplicación procesará cada solicitud en orden, mostrando el progreso.
5.  **Revisa y Edita**: Las preguntas generadas aparecerán en la tabla de la derecha.
    -   Haz clic en cualquier celda para **editar** su contenido.
    -   Usa los íconos para **expandir** filas, ver el tipo de pregunta o **eliminarlas**.
    -   Las preguntas con un formato no reconocido se marcarán en rojo para que las corrijas antes de guardar.
6.  **Realiza Acciones en Lote (Opcional)**: Selecciona varias preguntas usando las casillas de verificación. Aparecerá una barra de acciones para **Eliminar** o **Reescribir** las preguntas seleccionadas.
7.  **Importa/Añade Manualmente (Opcional)**: Usa los botones "Cargar CSV" para importar preguntas existentes o "Añadir Pregunta" para crear una fila vacía y llenarla manualmente.
8.  **Guarda el Resultado**: Cuando estés satisfecho, haz clic en "Guardar CSV" para descargar el archivo final, listo para ser utilizado.

## 📂 Estructura del Proyecto

```
questioner-maker/
├── components/          # Componentes reutilizables de React (EditableCell, iconos)
├── services/            # Lógica para interactuar con APIs externas (geminiService.ts)
├── utils/               # Funciones de ayuda y utilidades (csvHelper.ts)
├── App.tsx              # Componente principal que une toda la aplicación
├── types.ts             # Definiciones de tipos e interfaces de TypeScript
├── constants.ts         # Constantes globales (modelo de IA, nombres de archivo, etc.)
├── package.json         # Dependencias y scripts del proyecto
└── vite.config.ts       # Configuración del empaquetador Vite
```

## 🤖 Pila Tecnológica

-   **Framework**: React 19
-   **Lenguaje**: TypeScript
-   **Empaquetador**: Vite
-   **Estilos**: Tailwind CSS
-   **API de IA**: Google Gemini (`gemini-1.5-flash`)

---