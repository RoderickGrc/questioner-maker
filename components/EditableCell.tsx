
import React, { useState, useEffect, useRef } from 'react';

interface EditableCellProps {
  value: string | undefined;
  onSave: (newValue: string) => void;
  isInitiallyEditing?: boolean;
  multiline?: boolean; // If true, use textarea; otherwise, use input
  className?: string; // To pass Tailwind classes for sizing, truncation, etc.
  placeholder?: string;
}

const EditableCell: React.FC<EditableCellProps> = ({
  value,
  onSave,
  isInitiallyEditing = false,
  multiline = false,
  className = '',
  placeholder = "Editar..."
}) => {
  const [isEditing, setIsEditing] = useState(isInitiallyEditing);
  const [currentValue, setCurrentValue] = useState(value || ''); // Handle undefined by defaulting to empty string for input
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    setCurrentValue(value || ''); // Update if prop changes externally
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLInputElement) {
        inputRef.current.select();
      } else if (inputRef.current instanceof HTMLTextAreaElement) {
        inputRef.current.selectionStart = inputRef.current.value.length;
        inputRef.current.selectionEnd = inputRef.current.value.length;
      }
    }
  }, [isEditing]);

  const handleSave = () => {
    if (currentValue !== (value || '')) { // Only save if value changed
        onSave(currentValue);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      if (multiline && !e.shiftKey) { // For textarea, Enter saves unless Shift is pressed
        e.preventDefault(); // Prevent newline if it's not Shift+Enter
        handleSave();
      } else if (!multiline) { // For input, Enter always saves
        handleSave();
      }
    } else if (e.key === 'Escape') {
      setCurrentValue(value || ''); // Revert
      setIsEditing(false);
    }
  };

  if (isEditing) {
    const editElementProps = {
      ref: inputRef as any, 
      value: currentValue,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setCurrentValue(e.target.value),
      onBlur: handleSave,
      onKeyDown: handleKeyDown,
      className: `p-1 bg-neutral-700 border border-neutral-500 focus:border-sky-500 outline-none rounded-sm text-neutral-100 w-full h-full box-border ${multiline ? 'resize-none' : ''} ${className}`,
      placeholder: placeholder,
    };
    return multiline ? (
      <textarea {...editElementProps} rows={3} /> // rows is a fallback if h-full is not sufficient due to parent constraints
    ) : (
      <input type="text" {...editElementProps} />
    );
  }

  return (
    <div
      onClick={() => setIsEditing(true)}
      className={`cursor-text hover:bg-neutral-800 p-1 rounded-sm w-full h-full ${className}`} // className from App.tsx includes min-h, text styles, truncation/wrapping
      title={value || "Vacío (click para editar)"}
    >
      {value && value.trim() !== '' ? value : <span className="text-neutral-500 italic">{placeholder && placeholder !== "Editar..." ? `Vacío (${placeholder})` : "Vacío"}</span>}
    </div>
  );
};

export default EditableCell;
