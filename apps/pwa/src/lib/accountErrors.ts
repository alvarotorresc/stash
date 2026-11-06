import { AccountError } from './service';

const MESSAGES: Record<AccountError['code'], string> = {
  'invalid-credentials': 'El email o la contraseña no son correctos.',
  'email-taken': 'Ese email ya tiene cuenta. Entra con él o usa otro.',
  'weak-password': 'Elige una contraseña de al menos 10 caracteres que no sea muy común.',
  'invalid-code': 'El email o el código de recuperación no son correctos.',
  'wrong-password': 'La contraseña no es correcta.',
  offline: 'Sin conexión. Para entrar o crear la cuenta hace falta red.',
};

/** What to tell the person when an account action fails. */
export function accountMessage(failure: unknown): string {
  return failure instanceof AccountError
    ? MESSAGES[failure.code]
    : 'Algo ha fallado. Vuelve a intentarlo en un momento.';
}
