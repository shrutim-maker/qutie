interface Props {
  mood?: 'happy' | 'neutral' | 'worried' | 'scan';
  size?: number;
  className?: string;
}

export function QutieMark({ mood = 'happy', size = 64, className = '' }: Props) {
  const mouth =
    mood === 'happy' ? 'M25 45 q7 5 14 0'
    : mood === 'neutral' ? 'M26 46 h12'
    : mood === 'worried' ? 'M25 47 q7 -5 14 0'
    : 'M27 45 q5 3 10 0';

  const badgeColor = mood === 'happy' ? '#67B68F' : mood === 'neutral' ? '#E69A4F' : '#D76666';
  const badgeCheck = mood === 'happy' ? 'M45.6 18 l2.2 2.2 4.2-4.4' : mood === 'worried' ? 'M46 16 l6 4 M52 16 l-6 4' : 'M46 18 h6';

  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={`qutie-mark ${className}`}>
      <line x1="32" y1="7" x2="32" y2="15" stroke="#56E6FF" strokeWidth="2.6" strokeLinecap="round" />
      <circle className="q-antenna" cx="32" cy="6" r="3.1" fill="#56E6FF" />
      <rect x="5" y="29" width="4.5" height="11" rx="2.2" fill="#1D4069" />
      <rect x="54.5" y="29" width="4.5" height="11" rx="2.2" fill="#1D4069" />
      <rect x="10" y="15" width="44" height="39" rx="13" fill="#0B2A4A" stroke="#56E6FF" strokeWidth="2" />
      <rect x="16" y="23" width="32" height="17" rx="8.5" fill="#06192F" />
      <circle className="q-eye" cx="25.5" cy="31.5" r="3.4" fill="#56E6FF" />
      <circle className="q-eye" cx="38.5" cy="31.5" r="3.4" fill="#56E6FF" />
      <path d={mouth} stroke="#56E6FF" strokeWidth="2.3" fill="none" strokeLinecap="round" />
      <circle cx="17" cy="43" r="2" fill="#56E6FF" opacity=".45" />
      <circle cx="47" cy="43" r="2" fill="#56E6FF" opacity=".45" />
      <circle cx="49" cy="18" r="7" fill={badgeColor} />
      <path d={badgeCheck} stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
