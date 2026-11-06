import { AccountError, ChangeError } from './service';

const OFFLINE =
  'Sin conexión. Este cambio necesita red: vuelve a intentarlo cuando tengas conexión.';
const BUSY = 'Demasiados cambios seguidos. Espera unos minutos y vuelve a intentarlo.';
const FAILED = 'No se ha podido guardar el cambio. Comprueba la conexión y vuelve a intentarlo.';

/** What to tell the person when a change to the saved data fails. */
export function changeMessage(failure: unknown): string {
  const code =
    failure instanceof ChangeError || failure instanceof AccountError ? failure.code : 'failed';
  if (code === 'offline') return OFFLINE;
  if (code === 'rate-limited') return BUSY;
  return FAILED;
}

/** Runs a change; returns a message for the person when it could not be saved. */
export async function attempt(change: () => Promise<unknown>): Promise<string | null> {
  try {
    await change();
    return null;
  } catch (failure) {
    return changeMessage(failure);
  }
}
