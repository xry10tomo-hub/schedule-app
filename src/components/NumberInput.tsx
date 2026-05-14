'use client';

import { useState, useEffect, useRef, InputHTMLAttributes } from 'react';

/**
 * Number input that allows clearing "0" to be empty.
 * - When value === 0 and the user focuses the field, the displayed text becomes empty.
 * - When user deletes all digits, it remains empty until blur, then commits 0.
 * - On blur with empty input, commits 0.
 */
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number;
  onChange: (v: number) => void;
};

export default function NumberInput({ value, onChange, onFocus, onBlur, ...rest }: Props) {
  const [text, setText] = useState<string>(value === 0 ? '' : String(value));
  const focusedRef = useRef(false);

  // Sync from prop changes when not focused
  useEffect(() => {
    if (!focusedRef.current) {
      setText(value === 0 ? '' : String(value));
    }
  }, [value]);

  return (
    <input
      type="number"
      value={text}
      onFocus={e => {
        focusedRef.current = true;
        // If text is "0", clear it on focus for easier entry
        if (text === '0') setText('');
        onFocus?.(e);
      }}
      onChange={e => {
        const v = e.target.value;
        setText(v);
        // Empty string treated as 0 internally but display stays empty until blur
        const num = v === '' || v === '-' ? 0 : Number(v);
        if (!Number.isNaN(num)) onChange(num);
      }}
      onBlur={e => {
        focusedRef.current = false;
        // On blur with empty, normalize to "0" only if value is 0 — otherwise display the number
        if (text === '' || text === '-') {
          setText(value === 0 ? '' : String(value));
          if (value !== 0) onChange(value);
          else onChange(0);
        }
        onBlur?.(e);
      }}
      {...rest}
    />
  );
}
