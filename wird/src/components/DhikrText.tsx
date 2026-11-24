import React from 'react';

interface DhikrTextProps {
  text: string;
  accentColor?: string;
}

/**
 * Renders Arabic Dhikr and Quranic verses cleanly, converting numbered Ayah
 * markers (`۝١`, `۝٢`, ..., `۝٢٥٥`) into crisp circular verse medallions.
 */
export const DhikrText: React.FC<DhikrTextProps> = ({ text, accentColor }) => {
  const parts = text.split(/(۝[٠-٩]+)/g);

  return (
    <>
      {parts.map((part, idx) => {
        if (part.startsWith('۝') && part.length > 1) {
          const digits = part.slice(1);
          return (
            <span
              key={idx}
              aria-label={`آية رقم ${digits}`}
              className="inline-flex items-center justify-center mx-1.5 align-middle rounded-full border font-numeric text-[0.56em] leading-none font-bold select-none"
              style={{
                minWidth: '1.75em',
                height: '1.75em',
                paddingInline: '0.35em',
                borderColor: accentColor || 'currentColor',
                color: accentColor || 'currentColor',
              }}
            >
              {digits}
            </span>
          );
        }
        return <React.Fragment key={idx}>{part}</React.Fragment>;
      })}
    </>
  );
};
