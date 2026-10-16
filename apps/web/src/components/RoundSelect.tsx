import { useId } from 'react';
import type { RoundOption } from '../lib/ladder.ts';

export interface RoundSelectProps {
  options: readonly RoundOption[];
  value: number;
  onChange: (roundNo: number) => void;
}

export function RoundSelect({ options, value, onChange }: RoundSelectProps) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>Ladder after</label>
      <select id={id} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {options.map((o) => (
          <option key={o.roundNo} value={o.roundNo}>
            {o.roundLabel}
          </option>
        ))}
      </select>
    </div>
  );
}
