import { Injectable } from '@nestjs/common';
import type { SanitizationToken, SanitizedTextResult } from '../whatsapp.types';

@Injectable()
export class SanitizationService {
  sanitize(text: string): SanitizedTextResult {
    const tokens: SanitizationToken[] = [];
    let sanitizedText = text ?? '';

    const replacements: Array<{
      regex: RegExp;
      kind: SanitizationToken['kind'];
      placeholderPrefix: string;
    }> = [
      {
        regex: /\b(?:\+?\d[\d\s-]{7,})\b/g,
        kind: 'phone',
        placeholderPrefix: '[PHONE',
      },
      {
        regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
        kind: 'email',
        placeholderPrefix: '[EMAIL',
      },
      {
        regex:
          /\b(?:calle|avenida|av\.|col\.|colonia|cp\.?|c\.p\.|#)\s+[a-zA-Z0-9\s.#-]+/gi,
        kind: 'address',
        placeholderPrefix: '[ADDRESS',
      },
      {
        regex: /\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)+/g,
        kind: 'name',
        placeholderPrefix: '[NAME',
      },
    ];

    replacements.forEach(({ regex, kind, placeholderPrefix }) => {
      let match: RegExpExecArray | null;
      let index = 1;
      while ((match = regex.exec(sanitizedText)) !== null) {
        const placeholder = `${placeholderPrefix}_${kind.toUpperCase()}_${index}]`;
        tokens.push({ placeholder, rawValue: match[0], kind });
        sanitizedText = sanitizedText.replace(match[0], placeholder);
        index += 1;
      }
    });

    const normalizedText = sanitizedText
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();

    return {
      sanitizedText,
      normalizedText,
      tokens,
    };
  }
}
